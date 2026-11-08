import {
  type Env,
  HttpError,
  base64UrlEncode,
  json,
  nowIso,
  parseJsonObject,
  randomToken,
  sha256Hex,
  utf8,
  uuid,
} from './util';
import { type AccessClaims, signJwt, verifyJwt } from './crypto';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  plan: string;
  status: string;
  tenant_id: string | null;
  recovery_email: string | null;
  recovery_email_verified: number;
  totp_secret: string | null;
  totp_enabled: number;
  phone_country_code: string | null;
  phone_number: string | null;
  phone_e164: string | null;
  phone_verified: number;
  profile_image_url: string | null;
  email_logo_url: string | null;
  append_email_logo: number;
  is_platform_admin: number;
  firebase_uid: string | null;
  last_login_at: string | null;
  failed_logins: number;
  locked_until: string | null;
  settings: string;
  created_at: string;
  updated_at: string;
}

export interface TenantRow {
  id: string;
  name: string;
  slug: string | null;
  plan: string;
  status: string;
  owner_user_id: string | null;
  seat_limit: number;
  settings: string;
  created_at: string;
  updated_at: string;
}

export interface AuthContext {
  user: UserRow;
  claims: AccessClaims;
  token: string;
}

export function jwtSecret(env: Env): string {
  const secret = env.JWT_SECRET || env.OTP_SIGNING_SECRET;
  if (secret && secret.length >= 16) return secret;
  if ((env.ENVIRONMENT || 'production') === 'development') {
    return 'velismail-development-only-secret-change-me';
  }
  throw new HttpError(500, 'JWT_SECRET is not configured on the Worker.');
}

export function accessTtl(env: Env): number {
  const value = Number(env.JWT_ACCESS_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : 900;
}

export function refreshTtl(env: Env): number {
  const value = Number(env.JWT_REFRESH_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : 30 * 86_400;
}

export async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').bind(email).first<UserRow>();
}

export async function getUserById(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function getTenant(env: Env, id: string): Promise<TenantRow | null> {
  return env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first<TenantRow>();
}

async function createRefreshToken(
  env: Env,
  user: UserRow,
  options: { deviceId?: string; ip?: string; userAgent?: string; mfaVerified?: boolean },
): Promise<{ token: string; id: string; expiresAt: string }> {
  const token = randomToken(32);
  const id = uuid();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + refreshTtl(env) * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, ip, user_agent, mfa_verified, created_at, last_active, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    user.id,
    await sha256Hex(token),
    options.deviceId ?? null,
    options.ip ?? null,
    options.userAgent ?? null,
    options.mfaVerified ? 1 : 0,
    createdAt,
    createdAt,
    expiresAt,
  ).run();
  return { token, id, expiresAt };
}

export async function issueSession(
  env: Env,
  user: UserRow,
  options: { deviceId?: string; ip?: string; userAgent?: string; mfaVerified?: boolean } = {},
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer'; session_id: string }> {
  const session = await createRefreshToken(env, user, options);
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresIn = accessTtl(env);
  const claims: AccessClaims = {
    sub: user.id,
    email: user.email,
    tenant_id: user.tenant_id ?? '',
    role: user.role,
    is_platform_admin: Boolean(user.is_platform_admin),
    session_id: session.id,
    jti: uuid(),
    iat: issuedAt,
    exp: issuedAt + expiresIn,
    typ: 'access',
  };
  const accessToken = await signJwt(claims as unknown as Record<string, unknown>, jwtSecret(env));
  return {
    access_token: accessToken,
    refresh_token: session.token,
    expires_in: expiresIn,
    token_type: 'Bearer',
    session_id: session.id,
  };
}

export async function rotateRefreshToken(
  env: Env,
  refreshToken: string,
  deviceId?: string,
): Promise<{ user: UserRow; access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer'; session_id: string } | null> {
  const hash = await sha256Hex(refreshToken);
  const row = await env.DB.prepare(
    'SELECT * FROM refresh_tokens WHERE token_hash = ?',
  ).bind(hash).first<{
    id: string;
    user_id: string;
    device_id: string | null;
    mfa_verified: number;
    expires_at: string;
    revoked_at: string | null;
  }>();
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  // Rotate: the presented refresh token dies, the new one is bound to the same device.
  await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  const user = await getUserById(env, row.user_id);
  if (!user || user.status !== 'active') return null;
  const issued = await issueSession(env, user, {
    deviceId: deviceId ?? row.device_id ?? undefined,
    mfaVerified: Boolean(row.mfa_verified),
  });
  return {
    user,
    access_token: issued.access_token,
    refresh_token: issued.refresh_token,
    expires_in: issued.expires_in,
    token_type: 'Bearer',
    session_id: issued.session_id,
  };
}

export async function revokeRefreshToken(env: Env, refreshToken: string): Promise<void> {
  const hash = await sha256Hex(refreshToken);
  await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(nowIso(), hash)
    .run();
}

export async function bearerToken(request: Request): Promise<string | null> {
  const header = request.headers.get('Authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const token = await bearerToken(request);
  if (!token) throw new HttpError(401, 'Missing bearer token.', 'unauthorized');
  const claims = await verifyJwt<AccessClaims>(token, jwtSecret(env));
  if (!claims || claims.typ !== 'access') throw new HttpError(401, 'Session token is invalid or expired.', 'unauthorized');
  const user = await getUserById(env, claims.sub);
  if (!user) throw new HttpError(401, 'Account no longer exists.', 'unauthorized');
  if (user.status !== 'active') throw new HttpError(403, 'This account is not active.', 'forbidden');
  const session = await env.DB.prepare(
    'SELECT id, revoked_at, expires_at FROM refresh_tokens WHERE id = ?',
  ).bind(claims.session_id).first<{ id: string; revoked_at: string | null; expires_at: string }>();
  if (!session || session.revoked_at) throw new HttpError(401, 'Session was revoked. Sign in again.', 'unauthorized');
  await env.DB.prepare('UPDATE refresh_tokens SET last_active = ? WHERE id = ?').bind(nowIso(), claims.session_id).run();
  return { user, claims, token };
}

export async function requirePlatformAdmin(request: Request, env: Env): Promise<AuthContext> {
  const context = await requireAuth(request, env);
  if (!context.user.is_platform_admin) {
    throw new HttpError(403, 'Platform operator access is required.', 'forbidden');
  }
  return context;
}

export function isTenantOwner(user: UserRow, tenant: TenantRow | null): boolean {
  if (!tenant) return false;
  return tenant.owner_user_id === user.id;
}

export async function tenantRole(env: Env, userId: string, tenantId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT role FROM tenant_members WHERE tenant_id = ? AND user_id = ?',
  ).bind(tenantId, userId).first<{ role: string }>();
  return row?.role ?? null;
}

export async function canManageTenant(env: Env, user: UserRow, tenantId: string): Promise<boolean> {
  if (user.is_platform_admin) return true;
  const tenant = await getTenant(env, tenantId);
  if (isTenantOwner(user, tenant)) return true;
  const role = await tenantRole(env, user.id, tenantId);
  return role === 'owner' || role === 'admin';
}

export async function logAudit(
  env: Env,
  options: {
    tenantId?: string | null;
    actor: string;
    actorRole?: string;
    action: string;
    category?: string;
    resourceType?: string;
    resourceId?: string | null;
    details?: Record<string, unknown>;
    severity?: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_entries (id, tenant_id, actor, actor_role, action, category, resource_type, resource_id, details, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uuid(),
    options.tenantId ?? null,
    options.actor,
    options.actorRole ?? 'member',
    options.action,
    options.category ?? 'workspace',
    options.resourceType ?? 'workspace',
    options.resourceId ?? null,
    JSON.stringify(options.details ?? {}),
    options.severity ?? 'info',
    nowIso(),
  ).run();
}

export async function logPlatformAudit(
  env: Env,
  options: {
    actor: string;
    actorRole?: string;
    action: string;
    category?: string;
    resourceType?: string;
    resourceId?: string | null;
    tenantId?: string | null;
    details?: Record<string, unknown>;
    severity?: string;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO platform_audit (id, actor, actor_role, action, category, resource_type, resource_id, tenant_id, details, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uuid(),
    options.actor,
    options.actorRole ?? 'operator',
    options.action,
    options.category ?? 'platform',
    options.resourceType ?? '',
    options.resourceId ?? null,
    options.tenantId ?? null,
    JSON.stringify(options.details ?? {}),
    options.severity ?? 'info',
    nowIso(),
  ).run();
}

/**
 * The `/auth/me` payload. The frontend reads both camelCase and snake_case,
 * so the snake_case wire shape is the canonical one.
 */
export function publicUser(user: UserRow, tenant: TenantRow | null, managedInfrastructure = false): Record<string, unknown> {
  const settings = parseJsonObject(user.settings);
  const mergedSettings: Record<string, unknown> = {
    ...settings,
    role: user.role,
    isPlatformAdmin: Boolean(user.is_platform_admin),
    businessDomain: tenant ? (settings.businessDomain as string ?? '') : (settings.businessDomain as string ?? ''),
    isBusinessSetupComplete: settings.isBusinessSetupComplete ?? false,
    businessDomainVerified: settings.businessDomainVerified ?? false,
    managedInfrastructure,
  };
  return {
    id: user.id,
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    tenant_id: user.tenant_id,
    role: user.role,
    plan: user.plan,
    status: user.status,
    account_type: 'business',
    created_at: user.created_at,
    recovery_email: user.recovery_email,
    recovery_email_verified: Boolean(user.recovery_email_verified),
    totp_enabled: Boolean(user.totp_enabled),
    phone_country_code: user.phone_country_code,
    phone_number: user.phone_number,
    phone_e164: user.phone_e164,
    phone_verified: Boolean(user.phone_verified),
    profile_image_url: user.profile_image_url,
    email_logo_url: user.email_logo_url,
    append_email_logo: Boolean(user.append_email_logo),
    firebase_uid: user.firebase_uid,
    is_platform_admin: Boolean(user.is_platform_admin),
    last_login_at: user.last_login_at,
    settings: mergedSettings,
    business_domain: mergedSettings.businessDomain,
    business_domain_verified: mergedSettings.businessDomainVerified,
    is_business_setup_complete: mergedSettings.isBusinessSetupComplete,
    business_mail_provider: mergedSettings.businessMailProvider ?? (managedInfrastructure ? 'velismail' : null),
    business_mail_provider_endpoint: mergedSettings.businessMailProviderEndpoint ?? null,
    business_mail_webhook_secret: mergedSettings.businessMailWebhookSecret ?? null,
    managed_infrastructure: managedInfrastructure,
    business_db_url: null,
    business_api_key: null,
  };
}

export function unauthenticated(): Response {
  return json({ success: false, error: { code: 'unauthorized', message: 'Sign in required.' } }, 401);
}

export async function hashIp(request: Request): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  return base64UrlEncode(utf8(ip));
}
