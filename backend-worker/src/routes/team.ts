import { type Env, HttpError, asString, json, normalizeEmail, nowIso, parseJsonObject, readJson, uuid } from '../lib/util';
import { getUserByEmail, issueSession, publicUser, requireAuth, revokeRefreshToken, getTenant } from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/crypto';

interface InviteRow {
  id: string;
  token: string;
  email: string;
  name: string;
  role: string;
  scope: string;
  tenant_id: string | null;
  workspace: string;
  issuer_email: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  accepted_at: string | null;
}

function inviteJson(row: InviteRow): Record<string, unknown> {
  return {
    id: row.id,
    token: row.token,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    issuerEmail: row.issuer_email,
    scope: row.scope,
    workspace: parseJsonObject(row.workspace),
  };
}

async function loadInvite(env: Env, token: string): Promise<InviteRow | null> {
  return env.DB.prepare('SELECT * FROM team_invites WHERE token = ?').bind(token.trim()).first<InviteRow>();
}

function assertUsable(invite: InviteRow | null): InviteRow {
  if (!invite) throw new HttpError(404, 'Invalid team access key.');
  if (invite.status === 'revoked') throw new HttpError(403, 'This team access key was revoked.');
  if (invite.status === 'expired') throw new HttpError(403, 'This team access key has expired.');
  if (invite.status === 'accepted') throw new HttpError(409, 'This team access key has already been used.');
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    throw new HttpError(403, 'This team access key has expired.');
  }
  return invite;
}

export async function createInvite(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(body.email);
  const role = asString(body.role, 'member');
  const expiresInHours = Number(body.expiresInHours ?? body.expires_in_hours ?? 168);
  if (!email.includes('@')) throw new HttpError(400, 'A valid email is required.');

  const tenantId = user.tenant_id;
  if (!tenantId) throw new HttpError(400, 'Create a workspace before inviting teammates.');
  const tenant = await getTenant(env, tenantId);

  const id = uuid();
  const token = `vmt_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = nowIso();
  const expiresAt = expiresInHours > 0 ? new Date(Date.now() + expiresInHours * 3_600_000).toISOString() : null;
  const workspace = {
    tenantId,
    displayName: tenant?.name ?? '',
    businessDomain: parseJsonObject(tenant?.settings ?? '{}').businessDomain ?? '',
    businessDomainVerified: Boolean(parseJsonObject(tenant?.settings ?? '{}').businessDomainVerified),
    isBusinessSetupComplete: true,
  };

  await env.DB.prepare(
    `INSERT INTO team_invites (id, token, email, name, role, scope, tenant_id, workspace, issuer_email, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'workspace', ?, ?, ?, 'pending', ?, ?)`,
  ).bind(
    id,
    token,
    email,
    asString(body.name) || email.split('@')[0],
    role,
    tenantId,
    JSON.stringify(workspace),
    user.email,
    now,
    expiresAt,
  ).run();

  return json({
    success: true,
    invite: inviteJson({
      id,
      token,
      email,
      name: asString(body.name) || email.split('@')[0],
      role,
      scope: 'workspace',
      tenant_id: tenantId,
      workspace: JSON.stringify(workspace),
      issuer_email: user.email,
      status: 'pending',
      created_at: now,
      expires_at: expiresAt,
      accepted_at: null,
    }),
  }, 201);
}

export async function validateInvite(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const token = asString(body.token);
  const email = normalizeEmail(body.email);
  const invite = assertUsable(await loadInvite(env, token));
  if (email && email !== invite.email.toLowerCase()) {
    return json({ success: false, error: 'This email is not assigned to the provided team access key.' }, 403);
  }
  return json({ success: true, invite: inviteJson(invite) });
}

export async function completeInvite(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const token = asString(body.token);
  const email = normalizeEmail(body.email);
  const password = asString(body.password);
  const invite = assertUsable(await loadInvite(env, token));
  if (email !== invite.email.toLowerCase()) throw new HttpError(403, 'Team access key and email do not match.');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');

  let user = await getUserByEmail(env, email);
  if (user) {
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(401, 'Password is incorrect for this account.');
    }
    if (invite.tenant_id) {
      await env.DB.prepare(
        `INSERT INTO tenant_members (id, tenant_id, user_id, email, name, role, status, invited_by, joined_at, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
         ON CONFLICT(tenant_id, email) DO UPDATE SET user_id = excluded.user_id, role = excluded.role, status = 'active'`,
      ).bind(uuid(), invite.tenant_id, user.id, email, invite.name, invite.role, invite.issuer_email, nowIso(), nowIso(), nowIso()).run();
      await env.DB.prepare('UPDATE users SET tenant_id = ?, updated_at = ? WHERE id = ?')
        .bind(invite.tenant_id, nowIso(), user.id).run();
      user = await getUserByEmail(env, email);
    }
  } else {
    const now = nowIso();
    const userId = uuid();
    await env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, role, plan, status, tenant_id, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'Team Access', 'active', ?, '{}', ?, ?)`,
    ).bind(
      userId,
      email,
      await hashPassword(password),
      invite.name || email.split('@')[0],
      invite.role,
      invite.scope === 'platform' ? null : invite.tenant_id,
      now,
      now,
    ).run();
    if (invite.tenant_id) {
      await env.DB.prepare(
        `INSERT INTO tenant_members (id, tenant_id, user_id, email, name, role, status, invited_by, joined_at, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(uuid(), invite.tenant_id, userId, email, invite.name, invite.role, invite.issuer_email, now, now, now).run();
    }
    user = await getUserByEmail(env, email);
  }

  if (!user) throw new HttpError(500, 'Account provisioning failed.');
  await env.DB.prepare("UPDATE team_invites SET status = 'accepted', accepted_at = ? WHERE id = ?")
    .bind(nowIso(), invite.id).run();

  const session = await issueSession(env, user, {
    deviceId: asString(body.deviceId) || asString(body.device_id) || undefined,
    ip: request.headers.get('CF-Connecting-IP') || undefined,
    userAgent: request.headers.get('User-Agent') || undefined,
  });
  const tenant = user.tenant_id ? await getTenant(env, user.tenant_id) : null;
  return json({
    success: true,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    tokenType: 'Bearer',
    invite: inviteJson({ ...invite, status: 'accepted', accepted_at: nowIso() }),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      tenantId: user.tenant_id,
      profile: publicUser(user, tenant, env.MANAGED_INFRASTRUCTURE === 'true'),
    },
  });
}

export async function revokeInvite(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const token = asString(body.token);
  const invite = await loadInvite(env, token);
  if (!invite) throw new HttpError(404, 'Invalid team access key.');
  if (!user.is_platform_admin && invite.tenant_id !== user.tenant_id && invite.issuer_email !== user.email) {
    throw new HttpError(403, 'You cannot revoke this team access key.');
  }
  await env.DB.prepare("UPDATE team_invites SET status = 'revoked' WHERE id = ?").bind(invite.id).run();
  return json({ success: true });
}

export async function logoutEverywhere(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .bind(nowIso(), user.id).run();
  return json({ success: true });
}
