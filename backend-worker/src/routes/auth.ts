import {
  type Env,
  HttpError,
  asString,
  base64UrlEncode,
  fail,
  isEmail,
  json,
  maskEmail,
  normalizeEmail,
  nowIso,
  parseJsonObject,
  randomDigits,
  randomToken,
  readJson,
  sha256Hex,
  today,
  uuid,
  utf8,
} from '../lib/util';
import {
  type AuthContext,
  type UserRow,
  getTenant,
  getUserByEmail,
  getUserById,
  issueSession,
  jwtSecret,
  logAudit,
  publicUser,
  requireAuth,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../lib/auth';
import { generateTotpSecret, hashPassword, signJwt, totpUri, verifyJwt, verifyPassword, verifyTotp } from '../lib/crypto';
import { otpEmail, sendPlatformEmail } from '../lib/email';

const OTP_TTL_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const OTP_DAILY_LIMIT = 3;

function otpHash(env: Env, challenge: string, code: string): Promise<string> {
  return sha256Hex(`${challenge}:${code}:${env.OTP_SIGNING_SECRET || jwtSecret(env)}`);
}

function deviceIdFrom(body: Record<string, unknown>): string | undefined {
  const value = asString(body.device_id) || asString(body.deviceId);
  return value || undefined;
}

interface OtpMeta {
  userId?: string;
  mfaToken?: string;
}

async function issueOtp(
  request: Request,
  env: Env,
  identifier: string,
  purpose: string,
  meta: OtpMeta = {},
): Promise<Response> {
  if (!isEmail(identifier)) throw new HttpError(400, 'Enter a valid email address.');

  const day = today();
  const usage = await env.DB.prepare(
    'SELECT count FROM otp_daily WHERE identifier = ? AND day = ? AND purpose = ?',
  ).bind(identifier, day, purpose).first<{ count: number }>();
  if ((usage?.count ?? 0) >= OTP_DAILY_LIMIT) {
    return fail('Daily OTP limit reached. You can request up to 3 verification codes per email per day.', 429, 'rate_limited');
  }

  const user = await getUserByEmail(env, identifier);
  if (purpose === 'register' && user) {
    return fail('This email already has an account. Sign in, or reset the password if you own it.', 409, 'conflict');
  }
  if (purpose === 'password_reset' && !user) {
    // Do not disclose whether the account exists.
    return json({
      success: true,
      challengeToken: randomToken(24),
      expiresIn: OTP_TTL_SECONDS,
      maskedEmail: maskEmail(identifier),
      provider: 'resend',
      messageId: null,
    });
  }

  const challenge = randomToken(24);
  const code = randomDigits(6);
  const id = uuid();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO otp_challenges (id, identifier, purpose, challenge_token, otp_hash, attempts, meta, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).bind(id, identifier, purpose, challenge, await otpHash(env, challenge, code), JSON.stringify(meta), createdAt, expiresAt).run();

  await env.DB.prepare(
    `INSERT INTO otp_daily (identifier, day, purpose, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(identifier, day, purpose) DO UPDATE SET count = count + 1`,
  ).bind(identifier, day, purpose).run();

  const email = otpEmail(env, code, purpose);
  const delivered = await sendPlatformEmail(env, {
    to: [identifier],
    subject: email.subject,
    html: email.html,
    text: email.text,
    from: env.OTP_FROM_EMAIL || env.PLATFORM_FROM_EMAIL,
    fromName: env.PLATFORM_FROM_NAME,
  });

  if (!delivered.ok && env.AUTH_DEV_OTP !== 'true') {
    return fail(
      delivered.error || 'Verification email could not be sent. Ask the operator to configure RESEND_API_KEY.',
      503,
      'email_unavailable',
    );
  }

  return json({
    success: true,
    challengeToken: challenge,
    expiresIn: OTP_TTL_SECONDS,
    maskedEmail: maskEmail(identifier),
    provider: delivered.provider,
    messageId: delivered.messageId ?? null,
    ...(env.AUTH_DEV_OTP === 'true' ? { devCode: code } : {}),
  });
}

export async function sendOtp(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const identifier = normalizeEmail(body.email ?? body.identifier);
  const purpose = asString(body.purpose, 'register');
  if (!['register', 'recovery_email', 'password_reset'].includes(purpose)) {
    throw new HttpError(400, 'Unknown verification purpose.');
  }
  return issueOtp(request, env, identifier, purpose);
}

export async function verifyOtp(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const identifier = normalizeEmail(body.email ?? body.identifier);
  const code = String(body.otp ?? '').replace(/\D/g, '');
  const challenge = asString(body.challengeToken) || asString(body.challenge_token);
  const purpose = asString(body.purpose, 'register');
  if (!identifier || !challenge || code.length !== 6) {
    throw new HttpError(400, 'A valid email, challenge token and 6-digit code are required.');
  }

  const row = await env.DB.prepare(
    'SELECT * FROM otp_challenges WHERE challenge_token = ? AND identifier = ? COLLATE NOCASE AND purpose = ?',
  ).bind(challenge, identifier, purpose).first<{
    id: string;
    otp_hash: string;
    attempts: number;
    meta: string;
    expires_at: string;
    consumed_at: string | null;
  }>();

  if (!row || row.consumed_at) throw new HttpError(401, 'Verification code expired or invalid. Request a new one.');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(401, 'Verification code expired. Request a new one.');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'Too many attempts. Request a new code.');

  const expected = await otpHash(env, challenge, code);
  if (expected !== row.otp_hash) {
    await env.DB.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    throw new HttpError(401, 'Verification code is invalid.');
  }

  await env.DB.prepare('UPDATE otp_challenges SET consumed_at = ? WHERE id = ?').bind(nowIso(), row.id).run();

  const verificationToken = randomToken(24);
  const meta = parseJsonObject(row.meta);
  await env.DB.prepare(
    `INSERT INTO verification_tokens (id, identifier, purpose, token_hash, meta, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uuid(),
    identifier,
    purpose,
    await sha256Hex(verificationToken),
    JSON.stringify(meta),
    nowIso(),
    new Date(Date.now() + 15 * 60_000).toISOString(),
  ).run();

  return json({ success: true, verificationToken, expiresIn: 900 });
}

async function consumeVerificationToken(env: Env, identifier: string, purpose: string, token: string): Promise<Record<string, unknown> | null> {
  const hash = await sha256Hex(token.trim());
  const row = await env.DB.prepare(
    'SELECT * FROM verification_tokens WHERE token_hash = ? AND identifier = ? COLLATE NOCASE AND purpose = ?',
  ).bind(hash, identifier, purpose).first<{ id: string; meta: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  await env.DB.prepare('UPDATE verification_tokens SET used_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  return parseJsonObject(row.meta);
}

export async function register(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(body.email);
  const password = asString(body.password);
  const displayName = asString(body.displayName) || email.split('@')[0] || 'Business User';
  const recoveryEmail = normalizeEmail(body.recoveryEmail) || null;
  const verificationToken = asString(body.verificationToken);

  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (password.length < 8 || password.length > 128) throw new HttpError(400, 'Password must be between 8 and 128 characters.');

  const existing = await getUserByEmail(env, email);
  if (existing) throw new HttpError(409, 'An account with this email already exists.');

  if (verificationToken) {
    const verified = await consumeVerificationToken(env, email, 'register', verificationToken);
    if (!verified) throw new HttpError(401, 'Email verification expired. Request a new code before registering.');
  }

  const now = nowIso();
  const tenantId = uuid();
  const userId = uuid();
  const settings: Record<string, unknown> = {};
  const customDomain = asString(body.customDomain).trim();
  if (customDomain) {
    settings.businessDomain = customDomain.toLowerCase();
    settings.businessDomainVerified = false;
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tenants (id, name, slug, plan, status, owner_user_id, seat_limit, settings, created_at, updated_at)
       VALUES (?, ?, ?, 'Free', 'active', ?, 5, '{}', ?, ?)`,
    ).bind(tenantId, displayName, displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48), userId, now, now),
    env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, plan, status, tenant_id, recovery_email,
        recovery_email_verified, phone_country_code, phone_number, phone_e164, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'owner', 'Free', 'active', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      userId,
      email,
      await hashPassword(password),
      displayName,
      tenantId,
      recoveryEmail,
      asString(body.phoneCountryCode) || null,
      asString(body.phoneNumber) || null,
      asString(body.phoneNumber) || null,
      JSON.stringify(settings),
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO tenant_members (id, tenant_id, user_id, email, name, role, status, invited_by, joined_at, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?, ?, ?, ?)`,
    ).bind(uuid(), tenantId, userId, email, displayName, email, now, now, now),
  ]);

  await logAudit(env, {
    tenantId,
    actor: email,
    actorRole: 'owner',
    action: 'account.registered',
    category: 'account',
    resourceType: 'user',
    resourceId: userId,
    severity: 'info',
  });

  const user = await getUserById(env, userId);
  return json({ success: true, user: user ? publicUser(user, await getTenant(env, tenantId), env.MANAGED_INFRASTRUCTURE === 'true') : null }, 201);
}

async function loginSuccess(
  request: Request,
  env: Env,
  user: UserRow,
  body: Record<string, unknown>,
  mfaVerified = false,
): Promise<Response> {
  const session = await issueSession(env, user, {
    deviceId: deviceIdFrom(body),
    ip: request.headers.get('CF-Connecting-IP') || undefined,
    userAgent: request.headers.get('User-Agent') || undefined,
    mfaVerified,
  });
  await env.DB.prepare('UPDATE users SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?')
    .bind(nowIso(), user.id)
    .run();
  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: 'Bearer',
    mfa_required: false,
    user: publicUser(user, user.tenant_id ? await getTenant(env, user.tenant_id) : null, env.MANAGED_INFRASTRUCTURE === 'true'),
  });
}

export async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(body.email ?? body.identifier);
  const password = asString(body.password);
  if (!isEmail(email) || !password) throw new HttpError(401, 'Invalid email or password.');

  const user = await getUserByEmail(env, email);
  if (!user) throw new HttpError(401, 'Invalid email or password.');
  if (user.status !== 'active') throw new HttpError(403, 'This account is not active. Contact support.');
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new HttpError(429, 'Too many failed sign-in attempts. Try again later.');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const failures = user.failed_logins + 1;
    const lockedUntil = failures >= 10 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(failures, lockedUntil, user.id)
      .run();
    throw new HttpError(401, 'Invalid email or password.');
  }

  if (user.totp_enabled && user.totp_secret) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const mfaToken = await signJwt(
      { sub: user.id, typ: 'mfa', iat: issuedAt, exp: issuedAt + 300 },
      jwtSecret(env),
    );
    return json({
      success: true,
      mfa_required: true,
      mfaRequired: true,
      mfa_token: mfaToken,
      mfaToken,
      recovery_email_masked: user.recovery_email ? maskEmail(user.recovery_email) : null,
      recoveryEmailMasked: user.recovery_email ? maskEmail(user.recovery_email) : null,
    });
  }

  return loginSuccess(request, env, user, body);
}

export async function refreshSession(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const token = asString(body.refresh_token) || asString(body.refreshToken);
  if (!token) throw new HttpError(401, 'Refresh token is required.');
  const rotated = await rotateRefreshToken(env, token, deviceIdFrom(body));
  if (!rotated) throw new HttpError(401, 'Refresh token is invalid or expired.');
  return json({
    access_token: rotated.access_token,
    refresh_token: rotated.refresh_token,
    expires_in: rotated.expires_in,
    token_type: 'Bearer',
    user: publicUser(rotated.user, rotated.user.tenant_id ? await getTenant(env, rotated.user.tenant_id) : null, env.MANAGED_INFRASTRUCTURE === 'true'),
  });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  try {
    const context = await requireAuth(request, env);
    await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?')
      .bind(nowIso(), context.claims.session_id)
      .run();
  } catch {
    // Logging out must always succeed for the caller.
  }
  const body = await readJson<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
  const refresh = asString(body.refresh_token);
  if (refresh) await revokeRefreshToken(env, refresh);
  return json({ success: true });
}

export async function me(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const tenant = context.user.tenant_id ? await getTenant(env, context.user.tenant_id) : null;
  return json({ success: true, user: publicUser(context.user, tenant, env.MANAGED_INFRASTRUCTURE === 'true') });
}

export async function updateAccount(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const user = context.user;
  const settings = parseJsonObject(user.settings);
  const updates: string[] = [];
  const values: unknown[] = [];

  const camelToSetting: Record<string, string> = {
    businessDomain: 'businessDomain',
    businessDbUrl: 'businessDbUrl',
    businessApiKey: 'businessApiKey',
    businessMailProvider: 'businessMailProvider',
    businessMailProviderEndpoint: 'businessMailProviderEndpoint',
    businessMailWebhookSecret: 'businessMailWebhookSecret',
    isBusinessSetupComplete: 'isBusinessSetupComplete',
    businessDomainVerified: 'businessDomainVerified',
    businessProfile: 'businessProfile',
    emailLogoUrl: 'emailLogoUrl',
    appendEmailLogo: 'appendEmailLogo',
    profileImageUrl: 'profileImageUrl',
    dkimStatus: 'dkimStatus',
    spfStatus: 'spfStatus',
    dmarcStatus: 'dmarcStatus',
    businessMailboxAddress: 'businessMailboxAddress',
  };
  for (const [key, settingKey] of Object.entries(camelToSetting)) {
    if (key in body) settings[settingKey] = body[key];
  }

  const recoveryEmail = normalizeEmail(body.recoveryEmail);
  if (recoveryEmail) {
    const token = asString(body.recoveryVerificationToken);
    if (token) {
      const verified = await consumeVerificationToken(env, recoveryEmail, 'recovery_email', token);
      if (!verified) throw new HttpError(401, 'Recovery email verification expired. Request a new code.');
    }
    updates.push('recovery_email = ?', 'recovery_email_verified = ?');
    values.push(recoveryEmail, token ? 1 : user.recovery_email_verified);
  }
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    updates.push('display_name = ?');
    values.push(body.displayName.trim());
  }
  if (typeof body.phoneCountryCode === 'string') {
    updates.push('phone_country_code = ?');
    values.push(body.phoneCountryCode);
  }
  if (typeof body.phoneNumber === 'string') {
    updates.push('phone_number = ?', 'phone_e164 = ?');
    values.push(body.phoneNumber, body.phoneNumber);
  }

  updates.push('settings = ?', 'updated_at = ?');
  values.push(JSON.stringify(settings), nowIso());
  values.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await getUserById(env, user.id);
  const tenant = updated?.tenant_id ? await getTenant(env, updated.tenant_id) : null;
  return json({ success: true, user: updated ? publicUser(updated, tenant, env.MANAGED_INFRASTRUCTURE === 'true') : null });
}

export async function changePassword(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const currentPassword = asString(body.currentPassword);
  const newPassword = asString(body.newPassword);
  if (newPassword.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
  const identifier = normalizeEmail(body.identifier) || context.user.email;

  const user = (await getUserByEmail(env, identifier)) ?? context.user;
  if (user.id !== context.user.id) throw new HttpError(403, 'You can only change your own password.');
  if (user.password_hash && !(await verifyPassword(currentPassword, user.password_hash))) {
    throw new HttpError(401, 'Current password is incorrect.');
  }

  await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(newPassword), nowIso(), user.id)
    .run();
  await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL')
    .bind(nowIso(), user.id, context.claims.session_id)
    .run();
  await logAudit(env, {
    tenantId: user.tenant_id,
    actor: user.email,
    action: 'account.password_changed',
    category: 'account',
    resourceType: 'user',
    resourceId: user.id,
    severity: 'warning',
  });
  return json({ success: true });
}

export async function resetPassword(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const identifier = normalizeEmail(body.identifier ?? body.email);
  const token = asString(body.verificationToken);
  const newPassword = asString(body.newPassword);
  if (newPassword.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');

  const user = await getUserByEmail(env, identifier);
  if (!user) throw new HttpError(401, 'Password reset is not valid for this account.');
  const verified = await consumeVerificationToken(env, identifier, 'password_reset', token);
  if (!verified) throw new HttpError(401, 'Password reset code expired. Request a new one.');

  await env.DB.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .bind(await hashPassword(newPassword), nowIso(), user.id)
    .run();
  await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(nowIso(), user.id)
    .run();
  return json({ success: true, message: 'Password updated successfully.' });
}

export async function listSessions(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const rows = await env.DB.prepare(
    `SELECT id, device_id, ip, user_agent, mfa_verified, created_at, last_active, expires_at
     FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_active DESC`,
  ).bind(context.user.id, nowIso()).all<{
    id: string;
    device_id: string | null;
    ip: string | null;
    user_agent: string | null;
    mfa_verified: number;
    created_at: string;
    last_active: string;
    expires_at: string;
  }>();

  return json({
    success: true,
    sessions: (rows.results ?? []).map((row) => ({
      id: row.id,
      deviceFingerprint: row.device_id || 'web',
      ipAddress: row.ip || 'unknown',
      userAgent: row.user_agent,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastActive: row.last_active,
      mfaVerified: Boolean(row.mfa_verified),
      current: row.id === context.claims.session_id,
    })),
  });
}

export async function revokeSession(request: Request, env: Env, id: string): Promise<Response> {
  const context = await requireAuth(request, env);
  const row = await env.DB.prepare('SELECT user_id FROM refresh_tokens WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!row || row.user_id !== context.user.id) throw new HttpError(404, 'Session was not found.');
  await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').bind(nowIso(), id).run();
  return json({ success: true });
}

export async function revokeOtherSessions(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const result = await env.DB.prepare(
    'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL',
  ).bind(nowIso(), context.user.id, context.claims.session_id).run();
  return json({ success: true, revoked: result.meta.changes ?? 0 });
}

// ---------------------------------------------------------------------------
// MFA
// ---------------------------------------------------------------------------

export async function mfaSetup(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const secret = await generateTotpSecret();
  await env.DB.prepare('UPDATE users SET totp_secret = ?, updated_at = ? WHERE id = ?')
    .bind(secret, nowIso(), context.user.id)
    .run();
  return json({ success: true, secret, otpauth_url: totpUri(secret, context.user.email) });
}

export async function mfaEnable(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const code = String(body.code ?? '');
  const secret = context.user.totp_secret;
  if (!secret) throw new HttpError(400, 'Start the authenticator setup first.');
  if (!(await verifyTotp(secret, code))) throw new HttpError(401, 'Invalid authenticator code.');

  await env.DB.prepare('UPDATE users SET totp_enabled = 1, updated_at = ? WHERE id = ?')
    .bind(nowIso(), context.user.id)
    .run();
  const user = await getUserById(env, context.user.id);
  if (!user) throw new HttpError(500, 'Account lookup failed.');
  const session = await issueSession(env, user, {
    deviceId: undefined,
    ip: request.headers.get('CF-Connecting-IP') || undefined,
    userAgent: request.headers.get('User-Agent') || undefined,
    mfaVerified: true,
  });
  return json({
    success: true,
    totp_enabled: true,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: 'Bearer',
    mfa_required: false,
  });
}

export async function mfaDisable(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const password = asString(body.password);
  const code = String(body.code ?? '');
  if (password && !(await verifyPassword(password, context.user.password_hash))) {
    throw new HttpError(401, 'Password is incorrect.');
  }
  if (context.user.totp_secret && !(await verifyTotp(context.user.totp_secret, code))) {
    throw new HttpError(401, 'Invalid authenticator code.');
  }
  await env.DB.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, updated_at = ? WHERE id = ?')
    .bind(nowIso(), context.user.id)
    .run();
  const user = await getUserById(env, context.user.id);
  if (!user) throw new HttpError(500, 'Account lookup failed.');
  const session = await issueSession(env, user, { mfaVerified: true });
  return json({
    success: true,
    totp_enabled: false,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: 'Bearer',
    mfa_required: false,
  });
}

export async function mfaVerify(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const mfaToken = asString(body.mfa_token) || asString(body.mfaToken);
  const code = String(body.code ?? '');
  const claims = await verifyJwt<{ sub: string; typ: string }>(mfaToken, jwtSecret(env));
  if (!claims || claims.typ !== 'mfa') throw new HttpError(401, 'MFA challenge expired. Sign in again.');
  const user = await getUserById(env, claims.sub);
  if (!user || !user.totp_secret) throw new HttpError(401, 'Authenticator is not configured.');
  if (!(await verifyTotp(user.totp_secret, code))) throw new HttpError(401, 'Invalid authenticator code.');
  return loginSuccess(request, env, user, body, true);
}

export async function mfaRecoverySendOtp(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const mfaToken = asString(body.mfa_token) || asString(body.mfaToken);
  const claims = await verifyJwt<{ sub: string; typ: string }>(mfaToken, jwtSecret(env));
  if (!claims || claims.typ !== 'mfa') throw new HttpError(401, 'MFA challenge expired. Sign in again.');
  const user = await getUserById(env, claims.sub);
  if (!user?.recovery_email) throw new HttpError(400, 'No verified recovery email is set for this account.');

  const response = await issueOtp(request, env, user.recovery_email, 'password_reset', { userId: user.id, mfaToken });
  if (!response.ok) return response;
  const payload = (await response.json()) as Record<string, unknown>;
  return json({
    success: true,
    challenge_token: payload.challengeToken,
    expires_in: payload.expiresIn,
    masked_email: maskEmail(user.recovery_email),
    ...(payload.devCode ? { devCode: payload.devCode } : {}),
  });
}

export async function mfaRecoveryVerify(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const mfaToken = asString(body.mfa_token) || asString(body.mfaToken);
  const challenge = asString(body.challenge_token) || asString(body.challengeToken);
  const otp = String(body.otp ?? '').replace(/\D/g, '');
  const claims = await verifyJwt<{ sub: string; typ: string }>(mfaToken, jwtSecret(env));
  if (!claims || claims.typ !== 'mfa') throw new HttpError(401, 'MFA challenge expired. Sign in again.');
  const user = await getUserById(env, claims.sub);
  if (!user?.recovery_email) throw new HttpError(400, 'No verified recovery email is set.');

  const row = await env.DB.prepare(
    'SELECT * FROM otp_challenges WHERE challenge_token = ? AND identifier = ? COLLATE NOCASE AND purpose = ?',
  ).bind(challenge, user.recovery_email, 'password_reset').first<{
    id: string;
    otp_hash: string;
    attempts: number;
    expires_at: string;
    consumed_at: string | null;
  }>();
  if (!row || row.consumed_at) throw new HttpError(401, 'Recovery code expired. Request a new one.');
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'Too many attempts. Request a new code.');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(401, 'Recovery code expired.');
  if ((await otpHash(env, challenge, otp)) !== row.otp_hash) {
    await env.DB.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    throw new HttpError(401, 'Recovery code is invalid.');
  }
  await env.DB.prepare('UPDATE otp_challenges SET consumed_at = ? WHERE id = ?').bind(nowIso(), row.id).run();

  const secret = await generateTotpSecret();
  const recoveryToken = randomToken(24);
  await env.DB.prepare(
    `INSERT INTO verification_tokens (id, identifier, purpose, token_hash, meta, created_at, expires_at)
     VALUES (?, ?, 'mfa_recovery', ?, ?, ?, ?)`,
  ).bind(
    uuid(),
    user.email,
    await sha256Hex(recoveryToken),
    JSON.stringify({ userId: user.id, secret }),
    nowIso(),
    new Date(Date.now() + 15 * 60_000).toISOString(),
  ).run();

  return json({
    success: true,
    recovery_token: recoveryToken,
    secret,
    otpauth_url: totpUri(secret, user.email),
    recovery_email: user.recovery_email,
  });
}

export async function mfaRecoveryComplete(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const recoveryToken = asString(body.recovery_token) || asString(body.recoveryToken);
  const code = String(body.code ?? '');
  const hash = await sha256Hex(recoveryToken);
  const row = await env.DB.prepare(
    "SELECT * FROM verification_tokens WHERE token_hash = ? AND purpose = 'mfa_recovery'",
  ).bind(hash).first<{ id: string; meta: string; expires_at: string; used_at: string | null }>();
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    throw new HttpError(401, 'Recovery session expired. Start again.');
  }
  const meta = parseJsonObject(row.meta);
  const secret = asString(meta.secret);
  const userId = asString(meta.userId);
  if (!secret || !userId) throw new HttpError(400, 'Recovery session is corrupted.');
  if (!(await verifyTotp(secret, code))) throw new HttpError(401, 'Invalid authenticator code.');

  await env.DB.batch([
    env.DB.prepare('UPDATE verification_tokens SET used_at = ? WHERE id = ?').bind(nowIso(), row.id),
    env.DB.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, updated_at = ? WHERE id = ?')
      .bind(secret, nowIso(), userId),
    env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(nowIso(), userId),
  ]);

  const user = await getUserById(env, userId);
  if (!user) throw new HttpError(500, 'Account lookup failed.');
  return loginSuccess(request, env, user, body, true);
}

export async function submitFeedback(request: Request, env: Env): Promise<Response> {
  const context = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const subject = asString(body.subject, 'Feedback').slice(0, 200);
  const message = asString(body.message ?? body.body ?? body.details).slice(0, 8000);
  const category = asString(body.category, 'general').slice(0, 40);
  if (!message.trim()) throw new HttpError(400, 'Feedback message is required.');
  const id = uuid();
  const caseNumber = `FB-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  await env.DB.prepare(
    `INSERT INTO feedback (id, case_number, user_id, email, category, subject, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).bind(id, caseNumber, context.user.id, context.user.email, category, subject, message, nowIso(), nowIso()).run();

  if (env.FEEDBACK_EMAIL_TO) {
    await sendPlatformEmail(env, {
      to: [env.FEEDBACK_EMAIL_TO],
      subject: `[VelisMail ${caseNumber}] ${subject}`,
      text: `From: ${context.user.email}\nCategory: ${category}\n\n${message}`,
      replyTo: context.user.email,
    });
  }
  return json({ success: true, caseNumber, id });
}

// ---------------------------------------------------------------------------
// Firebase (Google) sign-in
// ---------------------------------------------------------------------------

async function verifyFirebaseIdToken(idToken: string, projectId: string): Promise<{ uid: string; email: string; name?: string; picture?: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Google token is malformed.');
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64UrlBytes(headerB64))) as { kid?: string; alg?: string };
  const payload = JSON.parse(new TextDecoder().decode(base64UrlBytes(payloadB64))) as {
    aud?: string;
    iss?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    picture?: string;
  };
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'Google token algorithm is not supported.');
  if (payload.aud !== projectId) throw new HttpError(401, 'Google token audience does not match this project.');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new HttpError(401, 'Google token has expired.');
  if (!payload.email || payload.email_verified === false) throw new HttpError(401, 'Google account email is not verified.');

  const certsResponse = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const certs = (await certsResponse.json()) as { keys: Array<JsonWebKey & { kid: string }> };
  const jwk = certs.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Google signing key was not found.');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlBytes(signatureB64),
    utf8(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new HttpError(401, 'Google token signature is invalid.');
  return {
    uid: String(payload.sub),
    email: normalizeEmail(payload.email),
    name: payload.name,
    picture: payload.picture,
  };
}

function base64UrlBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function firebaseLogin(request: Request, env: Env): Promise<Response> {
  if (!env.FIREBASE_PROJECT_ID) throw new HttpError(400, 'Google sign-in is not configured on this backend.');
  const body = await readJson<Record<string, unknown>>(request);
  const idToken = asString(body.idToken) || asString(body.id_token);
  if (!idToken) throw new HttpError(400, 'Firebase ID token is required.');
  const identity = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);

  let user = await getUserByEmail(env, identity.email);
  if (!user) {
    const now = nowIso();
    const tenantId = uuid();
    const userId = uuid();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tenants (id, name, plan, status, owner_user_id, seat_limit, settings, created_at, updated_at)
         VALUES (?, ?, 'Free', 'active', ?, 5, '{}', ?, ?)`,
      ).bind(tenantId, identity.name || identity.email.split('@')[0], userId, now, now),
      env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, role, plan, status, tenant_id, profile_image_url,
          firebase_uid, is_platform_admin, settings, created_at, updated_at)
         VALUES (?, ?, '', ?, 'owner', 'Free', 'active', ?, ?, ?, 0, '{}', ?, ?)`,
      ).bind(userId, identity.email, identity.name || identity.email.split('@')[0], tenantId, identity.picture ?? null, identity.uid, now, now),
      env.DB.prepare(
        `INSERT INTO tenant_members (id, tenant_id, user_id, email, name, role, status, joined_at, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?, ?, ?)`,
      ).bind(uuid(), tenantId, userId, identity.email, identity.name || identity.email.split('@')[0], now, now, now),
    ]);
    user = await getUserById(env, userId);
  }

  if (!user) throw new HttpError(500, 'Account provisioning failed.');
  if (user.totp_enabled) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const mfaToken = await signJwt({ sub: user.id, typ: 'mfa', iat: issuedAt, exp: issuedAt + 300 }, jwtSecret(env));
    return json({ success: true, mfa_required: true, mfaRequired: true, mfa_token: mfaToken, mfaToken });
  }
  return loginSuccess(request, env, user, body);
}

export async function health(): Promise<Response> {
  return json({
    status: 'ok',
    service: 'velismail-worker',
    version: '5.3.0',
    runtime: 'cloudflare-workers',
    time: nowIso(),
  });
}

export async function ready(env: Env): Promise<Response> {
  try {
    await env.DB.prepare('SELECT 1 AS ok').first();
    return json({ status: 'ready', database: 'ok', time: nowIso() });
  } catch (error) {
    return json({ status: 'degraded', database: 'unavailable', error: error instanceof Error ? error.message : 'unknown' }, 503);
  }
}

export async function publicConfig(env: Env): Promise<Response> {
  return json({
    success: true,
    firebase: {
      apiKey: env.FIREBASE_API_KEY || '',
      projectId: env.FIREBASE_PROJECT_ID || '',
      authDomain: env.FIREBASE_AUTH_DOMAIN || (env.FIREBASE_PROJECT_ID ? `${env.FIREBASE_PROJECT_ID}.firebaseapp.com` : ''),
      appId: env.FIREBASE_APP_ID || '',
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
      storageBucket: env.FIREBASE_STORAGE_BUCKET || (env.FIREBASE_PROJECT_ID ? `${env.FIREBASE_PROJECT_ID}.firebasestorage.app` : ''),
    },
    features: {
      googleSignIn: Boolean(env.FIREBASE_PROJECT_ID),
      payments: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    },
  });
}
