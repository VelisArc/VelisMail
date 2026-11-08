import {
  type Env,
  HttpError,
  asString,
  json,
  normalizeDomain,
  normalizeEmail,
  nowIso,
  parseJsonArray,
  parseJsonObject,
  readJson,
  uuid,
} from '../lib/util';
import {
  type TenantRow,
  type UserRow,
  canManageTenant,
  getTenant,
  logAudit,
  requireAuth,
} from '../lib/auth';
import { checkDns, overallStatus, type DnsCheck } from '../lib/dns';

interface DomainRow {
  id: string;
  tenant_id: string;
  domain: string;
  status: string;
  verification_token: string;
  dns_records: string;
  checks: string;
  provider: string | null;
  primary_domain: number;
  added_at: string;
  last_checked_at: string | null;
  verified_at: string | null;
}

interface MailboxRow {
  id: string;
  tenant_id: string;
  domain: string;
  address: string;
  display_name: string;
  kind: string;
  aliases: string;
  active: number;
  source: string;
  created_at: string;
  last_used_at: string | null;
}

function tenantIdOf(user: UserRow): string {
  if (!user.tenant_id) throw new HttpError(409, 'This account has no workspace. Create a business first.');
  return user.tenant_id;
}

async function requireTenantAdmin(env: Env, user: UserRow): Promise<string> {
  const tenantId = tenantIdOf(user);
  if (!(await canManageTenant(env, user, tenantId))) {
    throw new HttpError(403, 'Only workspace owners and admins can perform this action.');
  }
  return tenantId;
}

function buildVerificationToken(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `velismail-verify=${hex.slice(0, 12)}`;
}

function baseDnsRecords(domain: string, token: string): Array<Record<string, unknown>> {
  return [
    { type: 'TXT', name: `_velismail-verify.${domain}`, value: token, ttl: 300 },
    { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, ttl: 3600 },
  ];
}

function buildChecks(domain: string, token: string): DnsCheck[] {
  return [
    { key: 'txt', label: 'Ownership TXT', status: 'pending', expected: token },
    { key: 'mx', label: 'Inbound MX', status: 'pending', expected: 'Inbound MX record from your mail provider' },
    { key: 'spf', label: 'Provider SPF', status: 'pending', expected: 'v=spf1 include:... ~all' },
    { key: 'dkim', label: 'Provider DKIM', status: 'pending', expected: 'Provider DKIM TXT record' },
    { key: 'dmarc', label: 'DMARC', status: 'pending', expected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}` },
  ];
}

function domainJson(row: DomainRow, mailboxCount: number): Record<string, unknown> {
  const records = parseJsonArray(row.dns_records) as Array<Record<string, string>>;
  const checks = parseJsonArray(row.checks) as Array<Record<string, unknown>>;
  return {
    id: row.id,
    domain: row.domain,
    primary: Boolean(row.primary_domain),
    status: row.status,
    method: 'dns',
    dnsRecords: records,
    mxRecords: records.filter((record) => record.type === 'MX'),
    spfRecord: records.find((record) => record.type === 'TXT' && String(record.value).startsWith('v=spf1'))?.value ?? null,
    dkimRecord: records.find((record) => String(record.name).includes('_domainkey'))?.value ?? null,
    dmarcRecord: records.find((record) => record.type === 'TXT' && String(record.value).startsWith('v=DMARC1'))?.value ?? null,
    verificationToken: row.verification_token,
    checks,
    createdAt: row.added_at,
    lastCheckedAt: row.last_checked_at,
    verifiedAt: row.verified_at,
    webhookVerified: checks.find((check) => check.key === 'mx')?.status === 'verified',
    mailboxes: mailboxCount,
  };
}

function mailboxJson(row: MailboxRow): Record<string, unknown> {
  return {
    id: row.id,
    domain: row.domain,
    address: row.address,
    displayName: row.display_name,
    display_name: row.display_name,
    kind: row.kind,
    aliases: parseJsonArray(row.aliases),
    active: Boolean(row.active),
    source: row.source,
    createdAt: row.created_at,
    created_at: row.created_at,
    lastUsedAt: row.last_used_at,
    last_used_at: row.last_used_at,
  };
}

function businessJson(tenant: TenantRow, role: string, extras: { primaryDomain?: string | null; members: number }): Record<string, unknown> {
  const settings = parseJsonObject(tenant.settings);
  return {
    id: tenant.id,
    name: tenant.name,
    email: String(settings.billingEmail ?? settings.email ?? ''),
    plan: tenant.plan,
    status: tenant.status,
    role,
    primaryDomain: extras.primaryDomain ?? null,
    members: extras.members,
    createdAt: tenant.created_at,
  };
}

async function membershipRole(env: Env, tenantId: string, userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT role FROM tenant_members WHERE tenant_id = ? AND user_id = ?')
    .bind(tenantId, userId)
    .first<{ role: string }>();
  return row?.role ?? 'member';
}

async function primaryDomain(env: Env, tenantId: string): Promise<DomainRow | null> {
  return env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ? ORDER BY primary_domain DESC, added_at ASC LIMIT 1')
    .bind(tenantId)
    .first<DomainRow>();
}

// ---------------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------------

export async function listBusinesses(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const rows = await env.DB.prepare(
    `SELECT t.*, m.role AS member_role FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
     WHERE m.user_id = ? AND m.status = 'active' ORDER BY t.created_at ASC`,
  ).bind(user.id).all<TenantRow & { member_role: string }>();

  const businesses = [];
  for (const tenant of rows.results ?? []) {
    const [domain, members] = await Promise.all([
      primaryDomain(env, tenant.id),
      env.DB.prepare("SELECT COUNT(*) AS count FROM tenant_members WHERE tenant_id = ? AND status = 'active'")
        .bind(tenant.id).first<{ count: number }>(),
    ]);
    businesses.push(businessJson(tenant, tenant.member_role, {
      primaryDomain: domain?.domain ?? null,
      members: members?.count ?? 0,
    }));
  }
  return json({ success: true, businesses, activeBusinessId: user.tenant_id ?? '' });
}

export async function createBusiness(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const name = asString(body.name).trim();
  const domain = normalizeDomain(body.domain);
  if (!name) throw new HttpError(400, 'Business name is required.');
  if (!domain || !domain.includes('.')) throw new HttpError(400, 'A valid business domain is required.');

  const now = nowIso();
  const tenantId = uuid();
  const settings = { billingEmail: user.email, businessDomain: domain, businessDomainVerified: false };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tenants (id, name, slug, plan, status, owner_user_id, seat_limit, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, 5, ?, ?, ?)`,
    ).bind(
      tenantId,
      name,
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48),
      asString(body.plan, 'Free'),
      user.id,
      JSON.stringify(settings),
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO tenant_members (id, tenant_id, user_id, email, name, role, status, joined_at, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'owner', 'active', ?, ?, ?)`,
    ).bind(uuid(), tenantId, user.id, user.email, user.display_name, now, now, now),
  ]);

  const verificationToken = buildVerificationToken();
  const domainId = uuid();
  await env.DB.prepare(
    `INSERT INTO domains (id, tenant_id, domain, status, verification_token, dns_records, checks, provider, primary_domain, added_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, 1, ?)`,
  ).bind(
    domainId,
    tenantId,
    domain,
    verificationToken,
    JSON.stringify(baseDnsRecords(domain, verificationToken)),
    JSON.stringify(buildChecks(domain, verificationToken)),
    asString(body.provider, 'resend'),
    now,
  ).run();

  await env.DB.prepare('UPDATE users SET tenant_id = ?, updated_at = ? WHERE id = ?').bind(tenantId, now, user.id).run();
  await logAudit(env, {
    tenantId,
    actor: user.email,
    actorRole: 'owner',
    action: 'business.created',
    category: 'workspace',
    resourceType: 'tenant',
    resourceId: tenantId,
  });

  const tenant = await getTenant(env, tenantId);
  return json({
    success: true,
    business: tenant ? businessJson(tenant, 'owner', { primaryDomain: domain, members: 1 }) : null,
    domain,
    verificationToken,
  }, 201);
}

export async function switchBusiness(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const businessId = asString(body.businessId) || asString(body.business_id);
  const role = await env.DB.prepare(
    "SELECT role FROM tenant_members WHERE tenant_id = ? AND user_id = ? AND status = 'active'",
  ).bind(businessId, user.id).first<{ role: string }>();
  if (!role) throw new HttpError(404, 'Business was not found for this account.');

  await env.DB.prepare('UPDATE users SET tenant_id = ?, updated_at = ? WHERE id = ?')
    .bind(businessId, nowIso(), user.id)
    .run();
  const tenant = await getTenant(env, businessId);
  const domain = await primaryDomain(env, businessId);
  const members = await env.DB.prepare("SELECT COUNT(*) AS count FROM tenant_members WHERE tenant_id = ? AND status = 'active'")
    .bind(businessId).first<{ count: number }>();
  return json({
    success: true,
    business: tenant ? businessJson(tenant, role.role, { primaryDomain: domain?.domain ?? null, members: members?.count ?? 0 }) : null,
    role: role.role,
  });
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function team(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const members = await env.DB.prepare(
    'SELECT * FROM tenant_members WHERE tenant_id = ? ORDER BY created_at ASC',
  ).bind(tenantId).all<Record<string, unknown>>();
  const invites = await env.DB.prepare(
    "SELECT * FROM team_invites WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at DESC",
  ).bind(tenantId).all<Record<string, unknown>>();
  const tenant = await getTenant(env, tenantId);

  return json({
    success: true,
    members: (members.results ?? []).map((row) => ({
      id: String(row.id),
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      invitedBy: row.invited_by,
      joinedAt: row.joined_at,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    })),
    invitations: (invites.results ?? []).map((row) => ({
      id: String(row.id),
      email: row.email,
      role: row.role,
      invitedBy: row.issuer_email,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      accessKey: row.token,
    })),
    seatLimit: {
      used: (members.results ?? []).length,
      max: tenant?.seat_limit ?? 5,
      capped: (members.results ?? []).length >= (tenant?.seat_limit ?? 5),
    },
  });
}

export async function inviteMember(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(body.email);
  const role = asString(body.role, 'member');
  const expiresInHours = Number(body.expiresInHours ?? body.expires_in_hours ?? 168);
  if (!email.includes('@')) throw new HttpError(400, 'A valid email is required.');
  if (!['admin', 'member', 'viewer'].includes(role)) throw new HttpError(400, 'Unknown role.');

  const existing = await env.DB.prepare('SELECT id FROM tenant_members WHERE tenant_id = ? AND email = ? COLLATE NOCASE')
    .bind(tenantId, email).first();
  if (existing) throw new HttpError(409, 'This person is already a workspace member.');

  const id = uuid();
  const token = `vmt_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = nowIso();
  const expiresAt = expiresInHours > 0 ? new Date(Date.now() + expiresInHours * 3_600_000).toISOString() : null;
  const tenant = await getTenant(env, tenantId);
  await env.DB.prepare(
    `INSERT INTO team_invites (id, token, email, name, role, scope, tenant_id, workspace, issuer_email, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'workspace', ?, ?, ?, 'pending', ?, ?)`,
  ).bind(
    id,
    token,
    email,
    email.split('@')[0],
    role,
    tenantId,
    JSON.stringify({
      tenantId,
      displayName: tenant?.name,
      businessDomain: parseJsonObject(tenant?.settings ?? '{}').businessDomain ?? '',
      businessDomainVerified: parseJsonObject(tenant?.settings ?? '{}').businessDomainVerified ?? false,
      isBusinessSetupComplete: true,
    }),
    user.email,
    now,
    expiresAt,
  ).run();
  await logAudit(env, {
    tenantId,
    actor: user.email,
    actorRole: 'admin',
    action: 'team.invited',
    category: 'team',
    resourceType: 'invitation',
    resourceId: id,
    details: { email, role },
  });
  return json({ success: true, id, email, role, expiresAt: expiresAt ?? now, accessKey: token }, 201);
}

export async function revokeInvitation(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const result = await env.DB.prepare(
    "UPDATE team_invites SET status = 'revoked' WHERE id = ? AND tenant_id = ?",
  ).bind(id, tenantId).run();
  if (!result.meta.changes) throw new HttpError(404, 'Invitation was not found.');
  return json({ success: true });
}

export async function removeMember(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(body.email);
  if (email === user.email) throw new HttpError(400, 'You cannot remove your own account from the workspace.');
  const result = await env.DB.prepare(
    "DELETE FROM tenant_members WHERE tenant_id = ? AND email = ? COLLATE NOCASE AND role != 'owner'",
  ).bind(tenantId, email).run();
  if (!result.meta.changes) throw new HttpError(404, 'Member was not found.');
  return json({ success: true, email });
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export async function listDomains(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const rows = await env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ? ORDER BY primary_domain DESC, added_at ASC')
    .bind(tenantId).all<DomainRow>();
  const counts = await env.DB.prepare('SELECT domain, COUNT(*) AS count FROM mailboxes WHERE tenant_id = ? GROUP BY domain')
    .bind(tenantId).all<{ domain: string; count: number }>();
  const countMap = new Map((counts.results ?? []).map((row) => [row.domain, row.count]));
  return json({
    success: true,
    domains: (rows.results ?? []).map((row) => domainJson(row, countMap.get(row.domain) ?? 0)),
  });
}

export async function createDomain(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const body = await readJson<Record<string, unknown>>(request);
  const domain = normalizeDomain(body.domain);
  if (!domain || !domain.includes('.')) throw new HttpError(400, 'Enter a valid domain name.');

  const existing = await env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ? AND domain = ? COLLATE NOCASE')
    .bind(tenantId, domain).first<DomainRow>();
  if (existing) {
    return json({ success: true, id: existing.id, domain: existing.domain, verificationToken: existing.verification_token, existing: true });
  }

  const verificationToken = buildVerificationToken();
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO domains (id, tenant_id, domain, status, verification_token, dns_records, checks, provider, primary_domain, added_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, 'resend', 0, ?)`,
  ).bind(
    id,
    tenantId,
    domain,
    verificationToken,
    JSON.stringify(baseDnsRecords(domain, verificationToken)),
    JSON.stringify(buildChecks(domain, verificationToken)),
    nowIso(),
  ).run();
  return json({ success: true, id, domain, verificationToken }, 201);
}

export async function deleteDomain(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const row = await env.DB.prepare('SELECT * FROM domains WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<DomainRow>();
  if (!row) throw new HttpError(404, 'Domain was not found.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM domains WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM mailboxes WHERE tenant_id = ? AND domain = ?').bind(tenantId, row.domain),
    env.DB.prepare('DELETE FROM mail_groups WHERE tenant_id = ? AND domain = ?').bind(tenantId, row.domain),
  ]);
  return json({ success: true, domain: row.domain });
}

export async function dnsRequirements(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const url = new URL(request.url);
  const domain = normalizeDomain(url.searchParams.get('domain') ?? '');
  const row = await env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ? AND domain = ? COLLATE NOCASE')
    .bind(tenantId, domain).first<DomainRow>();
  if (!row) throw new HttpError(404, 'Add this domain to the workspace first.');

  const checks = await checkDns(row.domain, row.verification_token);
  const settings = parseJsonObject(user.settings);
  const provider = String(settings.businessMailProvider ?? row.provider ?? 'resend');
  const records = checks.map((check) => ({
    recordType: check.key === 'mx' ? 'MX' : 'TXT',
    name: check.key === 'txt' ? `_velismail-verify.${row.domain}` : check.key === 'dmarc' ? `_dmarc.${row.domain}` : check.key === 'dkim' ? `resend._domainkey.${row.domain}` : row.domain,
    host: check.key === 'txt' ? `_velismail-verify.${row.domain}` : check.key === 'dmarc' ? `_dmarc.${row.domain}` : check.key === 'dkim' ? `resend._domainkey.${row.domain}` : row.domain,
    value: check.expected,
    ttl: 3600,
    purpose: check.label,
    status: check.status,
    actual: check.actual ?? '',
    detail: check.status === 'verified' ? 'Record is live.' : 'Publish this record, then verify again.',
    matchMode: check.key === 'spf' ? 'spf' : check.key === 'mx' ? 'resend_inbound' : 'exact',
  }));
  const missing = checks.filter((check) => check.status !== 'verified').map((check) => check.label);
  return json({
    success: true,
    domain: row.domain,
    provider,
    sendingDomain: row.domain,
    domainStatus: row.status,
    complete: missing.length === 0,
    records,
    missing,
    message: missing.length === 0 ? 'Every DNS record is verified.' : `Missing or mismatched: ${missing.join(', ')}.`,
    webhook: provider === 'resend'
      ? {
          status: Boolean(settings.businessMailWebhookSecret) ? 'verified' : 'pending',
          detail: Boolean(settings.businessMailWebhookSecret)
            ? 'Receiving webhook secret is stored for this workspace.'
            : 'Save a Resend webhook secret to finish setup.',
          recommendation: null,
        }
      : { status: 'verified', detail: 'This provider delivers through the configured endpoint.' },
  });
}

export async function verifyDomain(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const row = await env.DB.prepare('SELECT * FROM domains WHERE id = ? AND tenant_id = ?')
    .bind(id, tenantId).first<DomainRow>();
  if (!row) throw new HttpError(404, 'Domain was not found.');

  const checks = await checkDns(row.domain, row.verification_token);
  const status = overallStatus(checks);
  const checkedAt = nowIso();
  await env.DB.prepare(
    'UPDATE domains SET status = ?, checks = ?, last_checked_at = ?, verified_at = COALESCE(verified_at, ?) WHERE id = ?',
  ).bind(status, JSON.stringify(checks), checkedAt, status === 'verified' ? checkedAt : null, id).run();

  if (status === 'verified') {
    const settings = parseJsonObject(user.settings);
    settings.businessDomain = row.domain;
    settings.businessDomainVerified = true;
    settings.isBusinessSetupComplete = Boolean(settings.businessMailProvider);
    await env.DB.prepare('UPDATE users SET settings = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(settings), checkedAt, user.id).run();
    await env.DB.prepare('UPDATE domains SET primary_domain = CASE WHEN domain = ? THEN 1 ELSE 0 END WHERE tenant_id = ?')
      .bind(row.domain, tenantId).run();
  }

  const missing = checks.filter((check) => check.status !== 'verified').map((check) => check.label);
  const settings = parseJsonObject(user.settings);
  const provider = String(settings.businessMailProvider ?? row.provider ?? 'resend');
  return json({
    success: true,
    domain: row.domain,
    provider,
    sendingDomain: row.domain,
    domainStatus: status,
    complete: status === 'verified',
    records: checks.map((check) => ({
      recordType: check.key === 'mx' ? 'MX' : 'TXT',
      name: check.key === 'txt' ? `_velismail-verify.${row.domain}` : check.key === 'dmarc' ? `_dmarc.${row.domain}` : check.key === 'dkim' ? `resend._domainkey.${row.domain}` : row.domain,
      host: check.key === 'txt' ? `_velismail-verify.${row.domain}` : check.key === 'dmarc' ? `_dmarc.${row.domain}` : check.key === 'dkim' ? `resend._domainkey.${row.domain}` : row.domain,
      value: check.expected,
      ttl: 3600,
      purpose: check.label,
      status: check.status,
      actual: check.actual ?? '',
      detail: check.status === 'verified' ? 'Record is live.' : 'Publish this record, then verify again.',
      matchMode: 'exact',
    })),
    missing,
    message: status === 'verified' ? 'Domain verified.' : `Missing or mismatched: ${missing.join(', ')}.`,
    webhook: provider === 'resend'
      ? { status: Boolean(settings.businessMailWebhookSecret) ? 'verified' : (status === 'verified' ? 'verified' : 'pending'), detail: 'Receiving webhook checked.' }
      : { status: 'verified', detail: 'Provider endpoint deliveries are enabled.' },
  });
}

export async function setupState(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = user.tenant_id;
  if (!tenantId) {
    return json({ success: true, complete: false, verifiedDomain: false, webhookVerified: false, provider: '' });
  }
  const verified = await env.DB.prepare("SELECT COUNT(*) AS count FROM domains WHERE tenant_id = ? AND status = 'verified'")
    .bind(tenantId).first<{ count: number }>();
  const settings = parseJsonObject(user.settings);
  const provider = String(settings.businessMailProvider ?? '');
  const verifiedDomain = (verified?.count ?? 0) > 0;
  const webhookVerified = provider === 'resend' ? Boolean(settings.businessMailWebhookSecret) : Boolean(provider);
  return json({
    success: true,
    complete: verifiedDomain && Boolean(provider),
    verifiedDomain,
    webhookVerified,
    provider,
  });
}

// ---------------------------------------------------------------------------
// Mailboxes and groups
// ---------------------------------------------------------------------------

export async function listMailboxes(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const rows = await env.DB.prepare('SELECT * FROM mailboxes WHERE tenant_id = ? ORDER BY created_at ASC')
    .bind(tenantId).all<MailboxRow>();
  return json({ success: true, mailboxes: (rows.results ?? []).map(mailboxJson) });
}

export async function createMailbox(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const body = await readJson<Record<string, unknown>>(request);
  const domain = normalizeDomain(body.domain);
  const address = normalizeEmail(body.address || `${asString(body.localPart)}@${domain}`);
  if (!address.endsWith(`@${domain}`)) throw new HttpError(400, `Mailbox must use @${domain}.`);

  const domainRow = await env.DB.prepare('SELECT id FROM domains WHERE tenant_id = ? AND domain = ? COLLATE NOCASE')
    .bind(tenantId, domain).first();
  if (!domainRow) throw new HttpError(400, 'Add the domain to this workspace before creating mailboxes.');

  const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE tenant_id = ? AND address = ? COLLATE NOCASE')
    .bind(tenantId, address).first();
  if (existing) throw new HttpError(409, 'This mailbox already exists for the selected domain.');

  const kind = asString(body.kind, 'mailbox');
  const active = body.active === false ? 0 : 1;
  if (active) {
    await env.DB.prepare('UPDATE mailboxes SET active = 0, kind = CASE WHEN kind = \'primary\' THEN \'mailbox\' ELSE kind END WHERE tenant_id = ? AND domain = ?')
      .bind(tenantId, domain).run();
  }
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO mailboxes (id, tenant_id, domain, address, display_name, kind, aliases, active, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?)`,
  ).bind(
    id,
    tenantId,
    domain,
    address,
    asString(body.displayName) || address.split('@')[0],
    active ? (kind === 'mailbox' ? 'primary' : kind) : kind,
    JSON.stringify(Array.isArray(body.aliases) ? body.aliases : []),
    active,
    nowIso(),
  ).run();
  return json({ success: true, id, address }, 201);
}

export async function deleteMailbox(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const url = new URL(request.url);
  const domain = normalizeDomain(url.searchParams.get('domain'));
  const address = normalizeEmail(url.searchParams.get('address'));
  const result = await env.DB.prepare('DELETE FROM mailboxes WHERE tenant_id = ? AND domain = ? AND address = ? COLLATE NOCASE')
    .bind(tenantId, domain, address).run();
  if (!result.meta.changes) throw new HttpError(404, 'Mailbox was not found.');
  return json({ success: true });
}

export async function listGroups(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const url = new URL(request.url);
  const domain = normalizeDomain(url.searchParams.get('domain'));
  const rows = domain
    ? await env.DB.prepare('SELECT * FROM mail_groups WHERE tenant_id = ? AND domain = ? ORDER BY created_at ASC').bind(tenantId, domain).all<Record<string, unknown>>()
    : await env.DB.prepare('SELECT * FROM mail_groups WHERE tenant_id = ? ORDER BY created_at ASC').bind(tenantId).all<Record<string, unknown>>();
  return json({
    success: true,
    groups: (rows.results ?? []).map((row) => ({
      id: row.id,
      domain: row.domain,
      name: row.name,
      address: row.address,
      members: parseJsonArray(row.members),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

export async function saveGroup(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const body = await readJson<Record<string, unknown>>(request);
  const domain = normalizeDomain(body.domain);
  const address = normalizeEmail(body.address);
  if (!address.includes('@')) throw new HttpError(400, 'A group address is required.');
  const existing = await env.DB.prepare('SELECT id FROM mail_groups WHERE tenant_id = ? AND address = ? COLLATE NOCASE')
    .bind(tenantId, address).first<{ id: string }>();
  const id = existing?.id ?? uuid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO mail_groups (id, tenant_id, domain, name, address, members, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address, members = excluded.members, updated_at = excluded.updated_at`,
  ).bind(
    id,
    tenantId,
    domain,
    asString(body.name) || address.split('@')[0],
    address,
    JSON.stringify(Array.isArray(body.members) ? body.members : []),
    now,
    now,
  ).run();
  return json({ success: true, id }, 201);
}

export async function deleteGroup(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const result = await env.DB.prepare('DELETE FROM mail_groups WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!result.meta.changes) throw new HttpError(404, 'Group was not found.');
  return json({ success: true });
}

// ---------------------------------------------------------------------------
// Queue, audit
// ---------------------------------------------------------------------------

export async function listQueue(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 500);
  const rows = status
    ? await env.DB.prepare('SELECT * FROM mail_queue WHERE tenant_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?').bind(tenantId, status, limit).all<Record<string, unknown>>()
    : await env.DB.prepare('SELECT * FROM mail_queue WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT ?').bind(tenantId, limit).all<Record<string, unknown>>();
  return json({
    success: true,
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      domain: row.domain,
      fromAddress: row.from_address,
      to: parseJsonArray(row.recipients).join(', '),
      recipients: parseJsonArray(row.recipients),
      subject: row.subject,
      body: row.body,
      status: row.status,
      queuedAt: row.queued_at,
      updatedAt: row.updated_at,
      retryCount: row.retry_count,
      error: row.error,
      scheduledAt: row.scheduled_at,
    })),
  });
}

export async function listAudit(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 500);
  const rows = await env.DB.prepare('SELECT * FROM audit_entries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(tenantId, limit).all<Record<string, unknown>>();
  return json({
    success: true,
    entries: (rows.results ?? []).map((row) => ({
      id: row.id,
      actor: row.actor,
      actorRole: row.actor_role,
      action: row.action,
      category: row.category,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: parseJsonObject(row.details),
      severity: row.severity,
      createdAt: row.created_at,
    })),
  });
}

// ---------------------------------------------------------------------------
// Templates, contacts, signatures
// ---------------------------------------------------------------------------

export async function listTemplates(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const rows = await env.DB.prepare('SELECT * FROM templates WHERE tenant_id = ? ORDER BY created_at DESC')
    .bind(tenantId).all<Record<string, unknown>>();
  return json({
    success: true,
    templates: (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      subject: row.subject,
      body: row.body,
      lastUsed: row.last_used,
      usageCount: row.usage_count,
    })),
  });
}

export async function saveTemplate(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const body = await readJson<Record<string, unknown>>(request);
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO templates (id, tenant_id, name, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, tenantId, asString(body.name), asString(body.subject), asString(body.body), nowIso()).run();
  return json({ success: true, id }, 201);
}

export async function deleteTemplate(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = await requireTenantAdmin(env, user);
  const result = await env.DB.prepare('DELETE FROM templates WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!result.meta.changes) throw new HttpError(404, 'Template was not found.');
  return json({ success: true });
}

export async function listContacts(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.toLowerCase() ?? '';
  const group = url.searchParams.get('group') ?? '';
  const rows = await env.DB.prepare('SELECT * FROM contacts WHERE tenant_id = ? ORDER BY name ASC')
    .bind(tenantId).all<Record<string, unknown>>();
  const all = (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? '',
    company: row.company ?? '',
    group: row.group_name,
    notes: row.notes ?? '',
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
  }));
  const filtered = all.filter((contact) => {
    if (group && contact.group !== group) return false;
    if (!search) return true;
    return `${contact.name} ${contact.email} ${contact.company}`.toLowerCase().includes(search);
  });
  const groups = Object.entries(
    all.reduce<Record<string, number>>((acc, contact) => {
      const groupName = String(contact.group ?? '');
      acc[groupName] = (acc[groupName] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([name, count]) => ({ name, count }));
  return json({ success: true, contacts: filtered, groups });
}

export async function saveContact(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request);
  const id = asString(body.id) || uuid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO contacts (id, tenant_id, name, email, phone, company, group_name, notes, favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, phone = excluded.phone,
       company = excluded.company, group_name = excluded.group_name, notes = excluded.notes,
       favorite = excluded.favorite, updated_at = excluded.updated_at`,
  ).bind(
    id,
    tenantId,
    asString(body.name),
    normalizeEmail(body.email),
    asString(body.phone) || null,
    asString(body.company) || null,
    asString(body.group, 'General') || 'General',
    asString(body.notes) || null,
    body.favorite ? 1 : 0,
    now,
    now,
  ).run();
  return json({ success: true, id }, 201);
}

export async function deleteContact(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const result = await env.DB.prepare('DELETE FROM contacts WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!result.meta.changes) throw new HttpError(404, 'Contact was not found.');
  return json({ success: true });
}

export async function listSignatures(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const rows = await env.DB.prepare('SELECT * FROM signatures WHERE tenant_id = ? ORDER BY is_default DESC, created_at ASC')
    .bind(tenantId).all<Record<string, unknown>>();
  return json({
    success: true,
    signatures: (rows.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      content: row.content,
      isDefault: Boolean(row.is_default),
    })),
  });
}

export async function saveSignature(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request);
  const id = asString(body.id) || uuid();
  if (body.isDefault) {
    await env.DB.prepare('UPDATE signatures SET is_default = 0 WHERE tenant_id = ?').bind(tenantId).run();
  }
  await env.DB.prepare(
    `INSERT INTO signatures (id, tenant_id, name, content, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, content = excluded.content, is_default = excluded.is_default`,
  ).bind(id, tenantId, asString(body.name), asString(body.content), body.isDefault ? 1 : 0, nowIso()).run();
  return json({ success: true, id }, 201);
}

export async function deleteSignature(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const result = await env.DB.prepare('DELETE FROM signatures WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!result.meta.changes) throw new HttpError(404, 'Signature was not found.');
  return json({ success: true });
}
