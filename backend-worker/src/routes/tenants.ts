import { type Env, HttpError, asString, json, normalizeDomain, nowIso, parseJsonArray, readJson, uuid } from '../lib/util';
import { requireAuth } from '../lib/auth';
import { checkDns, overallStatus } from '../lib/dns';

export async function createTenantDomain(request: Request, env: Env, tenantId: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  if (user.tenant_id !== tenantId && !user.is_platform_admin) {
    throw new HttpError(403, 'You do not have access to this workspace.');
  }
  const body = await readJson<Record<string, unknown>>(request);
  const domain = normalizeDomain(body.domain_name ?? body.domain);
  if (!domain || !domain.includes('.')) throw new HttpError(400, 'Enter a valid domain name.');

  const existing = await env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ? AND domain = ? COLLATE NOCASE')
    .bind(tenantId, domain).first<{ id: string; verification_token: string }>();
  if (existing) {
    return json({ success: true, id: existing.id, domain, verification_token: existing.verification_token, existing: true });
  }

  const id = uuid();
  const verificationToken = `velismail-verify=${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO domains (id, tenant_id, domain, status, verification_token, dns_records, checks, provider, added_at)
     VALUES (?, ?, ?, 'pending', ?, ?, '[]', 'resend', ?)`,
  ).bind(
    id,
    tenantId,
    domain,
    verificationToken,
    JSON.stringify([
      { type: 'TXT', name: `_velismail-verify.${domain}`, value: verificationToken, ttl: 300 },
      { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, ttl: 3600 },
    ]),
    now,
  ).run();
  return json({ success: true, id, domain, verification_token: verificationToken }, 201);
}

export async function verifyTenantDomain(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const domain = normalizeDomain(body.domain);
  if (!domain) throw new HttpError(400, 'A domain is required.');

  const row = await env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ? AND domain = ? COLLATE NOCASE')
    .bind(user.tenant_id, domain).first<{ id: string; verification_token: string }>();
  const token = asString(body.verificationToken) || row?.verification_token || '';
  if (!token) throw new HttpError(404, 'This domain is not attached to your workspace.');

  const checks = await checkDns(domain, token);
  const status = overallStatus(checks);
  if (row) {
    await env.DB.prepare('UPDATE domains SET status = ?, checks = ?, last_checked_at = ?, verified_at = COALESCE(verified_at, ?) WHERE id = ?')
      .bind(status, JSON.stringify(checks), nowIso(), status === 'verified' ? nowIso() : null, row.id).run();
  }
  return json({
    success: true,
    domain,
    status,
    checks,
    dns_records: parseJsonArray(JSON.stringify(checks)),
  });
}
