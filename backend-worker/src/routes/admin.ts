import {
  type Env,
  HttpError,
  asNumber,
  asString,
  json,
  normalizeEmail,
  nowIso,
  parseJsonArray,
  parseJsonObject,
  readJson,
  today,
  uuid,
} from '../lib/util';
import {
  type TenantRow,
  type UserRow,
  canManageTenant,
  getTenant,
  logPlatformAudit,
  requireAuth,
  requirePlatformAdmin,
} from '../lib/auth';

const PLAN_LIMITS: Record<string, { seats: number; emailsPerMonth: number; storageBytes: number; apiRequestsPerMinute: number }> = {
  Free: { seats: 2, emailsPerMonth: 500, storageBytes: 250 * 1024 * 1024, apiRequestsPerMinute: 30 },
  Starter: { seats: 5, emailsPerMonth: 10_000, storageBytes: 2 * 1024 * 1024 * 1024, apiRequestsPerMinute: 120 },
  Growth: { seats: 15, emailsPerMonth: 50_000, storageBytes: 10 * 1024 * 1024 * 1024, apiRequestsPerMinute: 300 },
  Scale: { seats: 50, emailsPerMonth: 250_000, storageBytes: 50 * 1024 * 1024 * 1024, apiRequestsPerMinute: 900 },
  Enterprise: { seats: 500, emailsPerMonth: 1_000_000, storageBytes: 500 * 1024 * 1024 * 1024, apiRequestsPerMinute: 3000 },
  'Team Access': { seats: 5, emailsPerMonth: 10_000, storageBytes: 2 * 1024 * 1024 * 1024, apiRequestsPerMinute: 120 },
};

const PLAN_CATALOG = [
  { key: 'Free', name: 'Free', monthlyPaise: 0, annualPaise: 0, contactOnly: false, negotiated: false },
  { key: 'Starter', name: 'Starter', monthlyPaise: 49_900, annualPaise: 499_000, contactOnly: false, negotiated: false },
  { key: 'Growth', name: 'Growth', monthlyPaise: 149_900, annualPaise: 1_499_000, contactOnly: false, negotiated: false },
  { key: 'Scale', name: 'Scale', monthlyPaise: 399_900, annualPaise: 3_999_000, contactOnly: false, negotiated: false },
  { key: 'Enterprise', name: 'Enterprise', monthlyPaise: 999_900, annualPaise: 9_999_000, contactOnly: true, negotiated: true },
];

const SCOPES = [
  { id: 'mail.send', label: 'Send mail', detail: 'Send messages from a workspace mailbox.', risk: 'medium' as const },
  { id: 'mail.read', label: 'Read mail', detail: 'Read the workspace inbox.', risk: 'high' as const },
  { id: 'domains.manage', label: 'Manage domains', detail: 'Add, verify and remove sending domains.', risk: 'high' as const },
  { id: 'team.manage', label: 'Manage team', detail: 'Invite and remove workspace members.', risk: 'high' as const },
  { id: 'billing.read', label: 'Read billing', detail: 'Read invoices and plan information.', risk: 'low' as const },
];

const API_PRESETS = [
  { id: 'sender', name: 'Transactional sender', summary: 'Send mail only.', detail: 'Best for product notification services.', scopes: ['mail.send'], recommended: true },
  { id: 'inbox', name: 'Inbox reader', summary: 'Read and send mail.', detail: 'Best for helpdesk integrations.', scopes: ['mail.send', 'mail.read'], recommended: false },
];

function limitsFor(plan: string) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free;
}

function planMonthly(plan: string): number {
  const found = PLAN_CATALOG.find((entry) => entry.key.toLowerCase() === plan.toLowerCase());
  return found ? found.monthlyPaise / 100 : 0;
}

function daysSeries(days: number): string[] {
  const output: string[] = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    output.push(new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10));
  }
  return output;
}

async function count(env: Env, sql: string, ...values: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...values).first<{ count: number }>();
  return row?.count ?? 0;
}

async function tenantCounts(env: Env, tenantId: string): Promise<{
  users: number;
  members: number;
  domains: number;
  mailboxes: number;
  storageBytes: number;
  sent: number;
  queueDepth: number;
  invoices: number;
  openCases: number;
}> {
  const [members, domains, mailboxes, sent, queueDepth, invoices, openCases] = await Promise.all([
    count(env, "SELECT COUNT(*) AS count FROM tenant_members WHERE tenant_id = ? AND status = 'active'", tenantId),
    count(env, 'SELECT COUNT(*) AS count FROM domains WHERE tenant_id = ?', tenantId),
    count(env, 'SELECT COUNT(*) AS count FROM mailboxes WHERE tenant_id = ?', tenantId),
    count(env, "SELECT COUNT(*) AS count FROM emails WHERE tenant_id = ? AND direction = 'outbound'", tenantId),
    count(env, "SELECT COUNT(*) AS count FROM mail_queue WHERE tenant_id = ? AND status IN ('queued','sending','deferred')", tenantId),
    count(env, 'SELECT COUNT(*) AS count FROM payments WHERE tenant_id = ?', tenantId),
    count(env, "SELECT COUNT(*) AS count FROM investigations WHERE tenant_id = ? AND status NOT IN ('resolved','closed')", tenantId),
  ]);
  return { users: members, members, domains, mailboxes, storageBytes: mailboxes * 1024 * 512, sent, queueDepth, invoices, openCases };
}

// ---------------------------------------------------------------------------
// Platform: identity and overview
// ---------------------------------------------------------------------------

export async function platformMe(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  return json({
    success: true,
    owner: true,
    roleOwner: true,
    admin: { email: user.email, role: 'owner', permissions: SCOPES.map((scope) => scope.id) },
  });
}

export async function platformOverview(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const [companies, activeCompanies, users, activeUsers, newUsers30d, emails30d, queueDepth, queueFailed, investigations, recentAudit, paidCompanies] = await Promise.all([
    count(env, 'SELECT COUNT(*) AS count FROM tenants'),
    count(env, "SELECT COUNT(*) AS count FROM tenants WHERE status = 'active'"),
    count(env, 'SELECT COUNT(*) AS count FROM users'),
    count(env, "SELECT COUNT(*) AS count FROM users WHERE status = 'active'"),
    count(env, "SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now','-30 days')"),
    count(env, "SELECT COUNT(*) AS count FROM emails WHERE direction = 'outbound' AND created_at >= datetime('now','-30 days')"),
    count(env, "SELECT COUNT(*) AS count FROM mail_queue WHERE status IN ('queued','sending','deferred')"),
    count(env, "SELECT COUNT(*) AS count FROM mail_queue WHERE status = 'failed'"),
    env.DB.prepare('SELECT * FROM investigations ORDER BY created_at DESC LIMIT 10').all<Record<string, unknown>>(),
    env.DB.prepare('SELECT * FROM platform_audit ORDER BY created_at DESC LIMIT 15').all<Record<string, unknown>>(),
    count(env, "SELECT COUNT(*) AS count FROM tenants WHERE plan NOT IN ('Free','')"),
  ]);

  const days = daysSeries(14);
  const growthRows = await env.DB.prepare(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS value FROM users GROUP BY day",
  ).all<{ day: string; value: number }>();
  const growthMap = new Map((growthRows.results ?? []).map((row) => [row.day, row.value]));
  const emailRows = await env.DB.prepare(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS value FROM emails GROUP BY day",
  ).all<{ day: string; value: number }>();
  const emailMap = new Map((emailRows.results ?? []).map((row) => [row.day, row.value]));

  const planRows = await env.DB.prepare('SELECT plan, COUNT(*) AS count FROM tenants GROUP BY plan').all<{ plan: string; count: number }>();
  const topRows = await env.DB.prepare('SELECT * FROM tenants ORDER BY created_at ASC LIMIT 5').all<TenantRow>();
  const topCompanies = [];
  for (const tenant of topRows.results ?? []) {
    const stats = await tenantCounts(env, tenant.id);
    topCompanies.push({ id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status, users: stats.users, sent: stats.sent });
  }

  const mrr = (planRows.results ?? []).reduce((sum, row) => sum + planMonthly(row.plan) * row.count, 0);
  return json({
    success: true,
    generatedAt: nowIso(),
    actor: { email: 'operator', role: 'owner' },
    kpis: {
      companies,
      activeCompanies,
      paidCompanies,
      users,
      activeUsers,
      newUsers30d,
      activeUsers24h: activeUsers,
      emails30d,
      storageBytes: 0,
      queueDepth,
      queueFailed,
      delivered: emails30d,
      openInvestigations: count0(investigations.results),
      criticalInvestigations: (investigations.results ?? []).filter((row) => row.severity === 'critical').length,
      paidSubscriptions: paidCompanies,
      mrr,
      arr: mrr * 12,
      requestsToday: 0,
      errorsToday: queueFailed,
      avgLatencyMs: 0,
    },
    growth: {
      companies: days.map((day) => ({ date: day, value: 0 })),
      users: days.map((day) => ({ date: day, value: growthMap.get(day) ?? 0 })),
      emails: days.map((day) => ({ date: day, value: emailMap.get(day) ?? 0 })),
    },
    planDistribution: (planRows.results ?? []).map((row) => ({ plan: row.plan, count: row.count })),
    topCompanies,
    investigations: (investigations.results ?? []).map(investigationJson),
    recentAudit: (recentAudit.results ?? []).map(platformAuditJson),
    health: { database: true, queueBacklog: queueDepth, queueFailed },
  });
}

function count0(rows: Record<string, unknown>[] | undefined): number {
  return (rows ?? []).filter((row) => !['resolved', 'closed'].includes(String(row.status))).length;
}

function investigationJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    caseNumber: row.case_number,
    title: row.title,
    type: row.type,
    severity: row.severity,
    status: row.status,
    priority: row.priority,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    reporterEmail: row.reporter_email,
    assigneeEmail: row.assignee_email,
    summary: row.summary,
    description: row.description,
    evidence: parseJsonArray(row.evidence),
    tags: parseJsonArray(row.tags),
    slaDueAt: row.sla_due_at,
    resolvedAt: row.resolved_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    eventCount: 0,
  };
}

function platformAuditJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    actor: row.actor,
    actorRole: row.actor_role,
    action: row.action,
    category: row.category,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name ?? null,
    details: parseJsonObject(row.details),
    severity: row.severity,
    createdAt: row.created_at,
  };
}

export async function platformAnalytics(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const url = new URL(request.url);
  const rangeDays = Math.min(Math.max(asNumber(url.searchParams.get('days'), 30), 1), 365);
  const days = daysSeries(rangeDays);
  const rows = await env.DB.prepare(
    'SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS value FROM emails GROUP BY day',
  ).all<{ day: string; value: number }>();
  const map = new Map((rows.results ?? []).map((row) => [row.day, row.value]));
  const tenants = await env.DB.prepare('SELECT * FROM tenants').all<TenantRow>();
  const leaderboard = [];
  for (const tenant of (tenants.results ?? []).slice(0, 10)) {
    const stats = await tenantCounts(env, tenant.id);
    leaderboard.push({
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      users: stats.users,
      domains: stats.domains,
      storage: stats.storageBytes,
      sent: stats.sent,
    });
  }
  return json({
    success: true,
    rangeDays,
    series: {
      signups: days.map((day) => ({ date: day, value: 0 })),
      companies: days.map((day) => ({ date: day, value: 0 })),
      sent: days.map((day) => ({ date: day, value: map.get(day) ?? 0 })),
      delivered: days.map((day) => ({ date: day, value: map.get(day) ?? 0 })),
      failed: days.map((day) => ({ date: day, value: 0 })),
      traffic: days.map((day) => ({ date: day, requests: 0, errors: 0, rateLimited: 0, overloads: 0, avgLatencyMs: 0 })),
    },
    leaderboard,
  });
}

// ---------------------------------------------------------------------------
// Platform: companies and users
// ---------------------------------------------------------------------------

function companyJson(tenant: TenantRow, stats: Awaited<ReturnType<typeof tenantCounts>>, domains: string[]): Record<string, unknown> {
  const settings = parseJsonObject(tenant.settings);
  return {
    id: tenant.id,
    name: tenant.name,
    email: String(settings.billingEmail ?? ''),
    plan: tenant.plan,
    status: tenant.status,
    createdAt: tenant.created_at,
    updatedAt: tenant.updated_at,
    settings,
    limits: limitsFor(tenant.plan),
    slug: tenant.slug,
    industry: null,
    country: null,
    timezone: 'UTC',
    legalName: tenant.name,
    billingEmail: settings.billingEmail ?? null,
    technicalEmail: settings.billingEmail ?? null,
    seatLimit: tenant.seat_limit,
    logoUrl: null,
    users: stats.users,
    members: stats.members,
    domains: stats.domains,
    storageBytes: stats.storageBytes,
    sent: stats.sent,
    queueDepth: stats.queueDepth,
    invoices: stats.invoices,
    openCases: stats.openCases,
    domainList: domains,
    mailboxes: stats.mailboxes,
    lastActivity: tenant.updated_at,
  };
}

async function domainList(env: Env, tenantId: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT domain FROM domains WHERE tenant_id = ?').bind(tenantId).all<{ domain: string }>();
  return (rows.results ?? []).map((row) => row.domain);
}

export async function platformCompanies(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').toLowerCase();
  const plan = url.searchParams.get('plan') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const limit = Math.min(asNumber(url.searchParams.get('limit'), 100), 200);
  const offset = Math.max(asNumber(url.searchParams.get('offset'), 0), 0);

  const rows = await env.DB.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all<TenantRow>();
  const filtered = (rows.results ?? []).filter((tenant) => {
    if (plan && tenant.plan !== plan) return false;
    if (status && tenant.status !== status) return false;
    if (search && !`${tenant.name} ${tenant.id}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const page = filtered.slice(offset, offset + limit);
  const companies = [];
  for (const tenant of page) {
    const [stats, domains] = await Promise.all([tenantCounts(env, tenant.id), domainList(env, tenant.id)]);
    companies.push(companyJson(tenant, stats, domains));
  }
  return json({ success: true, companies, pagination: { total: filtered.length, limit, offset } });
}

export async function platformCompanyDetail(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const tenant = await getTenant(env, id);
  if (!tenant) throw new HttpError(404, 'Company was not found.');
  const stats = await tenantCounts(env, id);
  const domains = await domainList(env, id);
  const members = await env.DB.prepare('SELECT * FROM tenant_members WHERE tenant_id = ?').bind(id).all<Record<string, unknown>>();
  const invoices = await env.DB.prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50').bind(id).all<Record<string, unknown>>();
  const mailboxes = await env.DB.prepare('SELECT * FROM mailboxes WHERE tenant_id = ?').bind(id).all<Record<string, unknown>>();
  const apiKeys = await env.DB.prepare('SELECT * FROM api_keys WHERE tenant_id = ?').bind(id).all<Record<string, unknown>>();
  const recentAudit = await env.DB.prepare('SELECT * FROM audit_entries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 25').bind(id).all<Record<string, unknown>>();
  const domainsRows = await env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ?').bind(id).all<Record<string, unknown>>();

  return json({
    success: true,
    company: companyJson(tenant, stats, domains),
    members: (members.results ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      invitedBy: row.invited_by,
      joinedAt: row.joined_at ?? row.created_at,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    })),
    domains: (domainsRows.results ?? []).map((row) => ({
      id: row.id,
      domain: row.domain,
      status: row.status,
      addedAt: row.added_at,
      verifiedAt: row.verified_at,
    })),
    invoices: (invoices.results ?? []).map(paymentJson),
    investigations: [],
    mailboxes: (mailboxes.results ?? []).map((row) => ({
      id: row.id,
      domain: row.domain,
      address: row.address,
      name: row.display_name,
      kind: row.kind,
      active: Boolean(row.active),
      source: row.source,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    })),
    apiKeys: (apiKeys.results ?? []).map(apiKeyJson),
    sessions: [],
    usage: [],
    recentAudit: (recentAudit.results ?? []).map((row) => ({
      id: row.id,
      actor: row.actor,
      actorRole: row.actor_role,
      action: row.action,
      category: row.category,
      resourceType: row.resource_type,
      severity: row.severity,
      createdAt: row.created_at,
    })),
  });
}

function paymentJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    number: `INV-${String(row.id).slice(0, 8).toUpperCase()}`,
    company: row.email ?? '',
    email: row.email ?? '',
    plan: row.plan,
    billingCycle: row.billing_cycle,
    amountPaise: row.amount_paise,
    currency: row.currency,
    status: row.status,
    issuedAt: row.created_at,
    dueAt: null,
    paidAt: row.paid_at,
    gateway: row.gateway,
    paymentRef: row.payment_ref,
    lineItems: [],
  };
}

function apiKeyJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parseJsonArray(row.scopes),
    createdBy: row.created_by,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export async function platformCompanyAction(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const action = asString(body.action);
  const tenant = await getTenant(env, id);
  if (!tenant) throw new HttpError(404, 'Company was not found.');
  let affected = 0;

  if (action === 'suspend' || action === 'activate') {
    const status = action === 'suspend' ? 'suspended' : 'active';
    await env.DB.prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), id).run();
    affected = 1;
  } else if (action === 'set_plan') {
    const plan = asString(body.plan, tenant.plan);
    await env.DB.prepare('UPDATE tenants SET plan = ?, updated_at = ? WHERE id = ?').bind(plan, nowIso(), id).run();
    affected = 1;
  } else if (action === 'set_seats') {
    const seats = Math.max(asNumber(body.seatLimit ?? body.seat_limit, tenant.seat_limit), 1);
    await env.DB.prepare('UPDATE tenants SET seat_limit = ?, updated_at = ? WHERE id = ?').bind(seats, nowIso(), id).run();
    affected = 1;
  } else if (action === 'revoke_api_keys') {
    const result = await env.DB.prepare('UPDATE api_keys SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL')
      .bind(nowIso(), id).run();
    affected = result.meta.changes ?? 0;
  } else if (action === 'terminate_sessions') {
    const result = await env.DB.prepare(
      'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id IN (SELECT user_id FROM tenant_members WHERE tenant_id = ?) AND revoked_at IS NULL',
    ).bind(nowIso(), id).run();
    affected = result.meta.changes ?? 0;
  } else if (action === 'close_cases') {
    const result = await env.DB.prepare(
      "UPDATE investigations SET status = 'closed', updated_at = ? WHERE tenant_id = ? AND status NOT IN ('closed')",
    ).bind(nowIso(), id).run();
    affected = result.meta.changes ?? 0;
  } else {
    throw new HttpError(400, 'Unknown company action.');
  }

  await logPlatformAudit(env, {
    actor: user.email,
    actorRole: 'owner',
    action: `company.${action}`,
    resourceType: 'tenant',
    resourceId: id,
    tenantId: id,
    details: body,
    severity: action === 'suspend' || action === 'revoke_api_keys' || action === 'terminate_sessions' ? 'warning' : 'info',
  });
  return json({ success: true, action, affected });
}

export async function platformUpdateCompany(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const tenant = await getTenant(env, id);
  if (!tenant) throw new HttpError(404, 'Company was not found.');
  const settings = { ...parseJsonObject(tenant.settings), ...body };
  const name = asString(body.name, tenant.name);
  const plan = asString(body.plan, tenant.plan);
  const status = asString(body.status, tenant.status);
  await env.DB.prepare('UPDATE tenants SET name = ?, plan = ?, status = ?, settings = ?, updated_at = ? WHERE id = ?')
    .bind(name, plan, status, JSON.stringify(settings), nowIso(), id).run();
  return json({ success: true });
}

export async function platformUsers(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').toLowerCase();
  const status = url.searchParams.get('status') ?? '';
  const plan = url.searchParams.get('plan') ?? '';
  const rows = await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 500').all<UserRow>();
  const users = [];
  for (const user of rows.results ?? []) {
    if (status && user.status !== status) continue;
    if (plan && user.plan !== plan) continue;
    if (search && !`${user.email} ${user.display_name}`.toLowerCase().includes(search)) continue;
    const tenant = user.tenant_id ? await getTenant(env, user.tenant_id) : null;
    const [domains, sent, sessions] = await Promise.all([
      user.tenant_id ? domainList(env, user.tenant_id) : Promise.resolve([]),
      count(env, "SELECT COUNT(*) AS count FROM emails WHERE tenant_id = ? AND direction = 'outbound'", user.tenant_id ?? ''),
      count(env, "SELECT COUNT(*) AS count FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?", user.id, nowIso()),
    ]);
    users.push({
      id: user.id,
      email: user.email,
      recoveryEmail: user.recovery_email ?? undefined,
      displayName: user.display_name,
      status: user.status,
      tenantId: user.tenant_id,
      company: tenant?.name ?? null,
      companyEmail: user.email,
      plan: user.plan,
      billingCycle: 'monthly',
      role: user.role,
      companyRole: user.role,
      domains,
      isPlatformAdmin: Boolean(user.is_platform_admin),
      createdAt: user.created_at,
      lastLogin: user.last_login_at,
      sent,
      activeSessions: sessions,
      failedLogins: user.failed_logins,
      risk: user.failed_logins >= 5 ? 'high' : user.status !== 'active' ? 'medium' : 'low',
    });
  }
  return json({ success: true, users });
}

export async function platformUserAction(request: Request, env: Env, id: string): Promise<Response> {
  const { user: actor } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const action = asString(body.action);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!user) throw new HttpError(404, 'User was not found.');
  let affected = 0;
  if (action === 'suspend' || action === 'activate') {
    await env.DB.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
      .bind(action === 'suspend' ? 'suspended' : 'active', nowIso(), id).run();
    affected = 1;
  } else if (action === 'terminate_sessions') {
    const result = await env.DB.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(nowIso(), id).run();
    affected = result.meta.changes ?? 0;
  } else if (action === 'set_role') {
    await env.DB.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .bind(asString(body.role, user.role), nowIso(), id).run();
    affected = 1;
  } else {
    throw new HttpError(400, 'Unknown user action.');
  }
  await logPlatformAudit(env, {
    actor: actor.email,
    action: `user.${action}`,
    resourceType: 'user',
    resourceId: id,
    tenantId: user.tenant_id,
    details: body,
  });
  return json({ success: true, action, affected });
}

// ---------------------------------------------------------------------------
// Platform: audit, investigations, team, keys, billing, flags, announcements
// ---------------------------------------------------------------------------

export async function platformAudit(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const url = new URL(request.url);
  const limit = Math.min(asNumber(url.searchParams.get('limit'), 100), 500);
  const rows = await env.DB.prepare('SELECT * FROM platform_audit ORDER BY created_at DESC LIMIT ?').bind(limit)
    .all<Record<string, unknown>>();
  return json({ success: true, entries: (rows.results ?? []).map(platformAuditJson) });
}

export async function platformInvestigations(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? '';
  const severity = url.searchParams.get('severity') ?? '';
  const search = (url.searchParams.get('search') ?? '').toLowerCase();
  const rows = await env.DB.prepare('SELECT * FROM investigations ORDER BY created_at DESC LIMIT 200')
    .all<Record<string, unknown>>();
  const all = (rows.results ?? []).filter((row) => {
    if (status && row.status !== status) return false;
    if (severity && row.severity !== severity) return false;
    if (search && !`${row.title} ${row.case_number}`.toLowerCase().includes(search)) return false;
    return true;
  });
  return json({
    success: true,
    investigations: all.map(investigationJson),
    counts: {
      total: all.length,
      open: all.filter((row) => row.status === 'open').length,
      investigating: all.filter((row) => row.status === 'investigating').length,
      critical: all.filter((row) => row.severity === 'critical').length,
      overdue: all.filter((row) => row.sla_due_at && new Date(String(row.sla_due_at)).getTime() < Date.now()).length,
    },
  });
}

export async function platformInvestigationDetail(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const row = await env.DB.prepare('SELECT * FROM investigations WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, 'Investigation was not found.');
  const events = await env.DB.prepare('SELECT * FROM investigation_events WHERE investigation_id = ? ORDER BY created_at ASC')
    .bind(id).all<Record<string, unknown>>();
  return json({
    success: true,
    investigation: investigationJson(row),
    events: (events.results ?? []).map((event) => ({
      id: event.id,
      actor: event.actor,
      kind: event.kind,
      message: event.message,
      metadata: parseJsonObject(event.metadata),
      createdAt: event.created_at,
    })),
  });
}

export async function createInvestigation(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const id = uuid();
  const now = nowIso();
  const caseNumber = asString(body.caseNumber) || `CASE-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const tenantId = asString(body.tenantId) || null;
  const tenant = tenantId ? await getTenant(env, tenantId) : null;
  await env.DB.prepare(
    `INSERT INTO investigations (id, case_number, title, type, severity, status, priority, tenant_id, tenant_name,
       reporter_email, assignee_email, summary, description, evidence, tags, sla_due_at, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    caseNumber,
    asString(body.title, 'Untitled investigation'),
    asString(body.type, 'security'),
    asString(body.severity, 'medium'),
    asString(body.priority, 'P3'),
    tenantId,
    tenant?.name ?? asString(body.tenantName) ?? null,
    asString(body.reporterEmail) || user.email,
    asString(body.assigneeEmail) || user.email,
    asString(body.summary),
    asString(body.description),
    JSON.stringify(Array.isArray(body.evidence) ? body.evidence : []),
    JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
    asString(body.slaDueAt) || null,
    user.email,
    now,
    now,
  ).run();
  const row = await env.DB.prepare('SELECT * FROM investigations WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return json({ success: true, investigation: row ? investigationJson(row) : null }, 201);
}

export async function updateInvestigation(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const row = await env.DB.prepare('SELECT * FROM investigations WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, 'Investigation was not found.');
  const updates: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, string> = {
    title: 'title', type: 'type', severity: 'severity', status: 'status', priority: 'priority',
    assigneeEmail: 'assignee_email', summary: 'summary', description: 'description', tags: 'tags', evidence: 'evidence',
  };
  for (const [key, column] of Object.entries(map)) {
    if (!(key in body)) continue;
    updates.push(`${column} = ?`);
    values.push(Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key]);
  }
  if (body.status === 'resolved' || body.status === 'closed') {
    updates.push('resolved_at = ?');
    values.push(nowIso());
  }
  if (updates.length === 0) return json({ success: true, investigation: investigationJson(row) });
  updates.push('updated_at = ?');
  values.push(nowIso(), id);
  await env.DB.prepare(`UPDATE investigations SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  const updated = await env.DB.prepare('SELECT * FROM investigations WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return json({ success: true, investigation: updated ? investigationJson(updated) : null });
}

export async function addInvestigationEvent(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  await env.DB.prepare(
    'INSERT INTO investigation_events (id, investigation_id, actor, kind, message, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(uuid(), id, user.email, asString(body.kind, 'note'), asString(body.message), '{}', nowIso()).run();
  return json({ success: true });
}

export async function platformTeam(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM users WHERE is_platform_admin = 1 ORDER BY created_at ASC')
    .all<UserRow>();
  const invites = await env.DB.prepare("SELECT * FROM team_invites WHERE scope = 'platform' AND status = 'pending' ORDER BY created_at DESC")
    .all<Record<string, unknown>>();
  return json({
    success: true,
    admins: (rows.results ?? []).map((admin) => ({
      email: admin.email,
      displayName: admin.display_name,
      role: admin.role,
      roleName: 'Owner',
      roleDescription: 'Full control plane access.',
      status: admin.status,
      permissions: SCOPES.map((scope) => scope.id),
      mfaEnabled: Boolean(admin.totp_enabled),
      lastSeenAt: admin.last_login_at,
      createdAt: admin.created_at,
    })),
    invitations: (invites.results ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      invitedBy: row.issuer_email,
      accessKey: row.token,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      createdAt: row.created_at,
    })),
    roles: [
      { key: 'owner', name: 'Owner', description: 'Full control plane access.', permissions: SCOPES.map((scope) => scope.id), isSystem: true, ownerOnly: true },
      { key: 'operator', name: 'Operator', description: 'Day to day support access.', permissions: ['mail.read', 'billing.read'], isSystem: true },
      { key: 'support', name: 'Support', description: 'Read accounts and replies.', permissions: ['mail.read'], isSystem: true },
    ],
    viewerRole: 'owner',
    isOwner: true,
  });
}

export async function addPlatformAdmin(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(body.email);
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').bind(email).first<UserRow>();
  if (!existing) throw new HttpError(404, 'That account does not exist yet. Invite them instead.');
  await env.DB.prepare('UPDATE users SET is_platform_admin = 1, role = ?, updated_at = ? WHERE id = ?')
    .bind(asString(body.role, 'owner'), nowIso(), existing.id).run();
  await logPlatformAudit(env, { actor: user.email, action: 'admin.added', resourceType: 'user', resourceId: existing.id, details: { email } });
  return json({ success: true });
}

export async function updatePlatformAdmin(request: Request, env: Env, email: string): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const target = await env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').bind(email).first<UserRow>();
  if (!target) throw new HttpError(404, 'Admin was not found.');
  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.role) { updates.push('role = ?'); values.push(asString(body.role)); }
  if (body.status) { updates.push('status = ?'); values.push(asString(body.status)); }
  if (body.displayName) { updates.push('display_name = ?'); values.push(asString(body.displayName)); }
  if (updates.length === 0) return json({ success: true });
  updates.push('updated_at = ?');
  values.push(nowIso(), target.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  await logPlatformAudit(env, { actor: user.email, action: 'admin.updated', resourceType: 'user', resourceId: target.id, details: body });
  return json({ success: true });
}

export async function removePlatformAdmin(request: Request, env: Env, email: string): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  if (email === user.email) throw new HttpError(400, 'You cannot remove your own platform access.');
  const target = await env.DB.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').bind(email).first<UserRow>();
  if (!target) throw new HttpError(404, 'Admin was not found.');
  await env.DB.prepare('UPDATE users SET is_platform_admin = 0, updated_at = ? WHERE id = ?').bind(nowIso(), target.id).run();
  return json({ success: true });
}

export async function invitePlatformAdmin(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const email = normalizeEmail(body.email);
  const role = asString(body.role, 'operator');
  const expiresInHours = Math.max(asNumber(body.expiresInHours, 168), 1);
  const id = uuid();
  const token = `vmt_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO team_invites (id, token, email, name, role, scope, tenant_id, workspace, issuer_email, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'platform', NULL, '{}', ?, 'pending', ?, ?)`,
  ).bind(id, token, email, asString(body.displayName) || email.split('@')[0], role, user.email, now, expiresAt).run();
  return json({
    success: true,
    emailSent: false,
    emailError: null,
    invite: {
      id,
      token,
      email,
      name: asString(body.displayName) || email.split('@')[0],
      role,
      status: 'pending',
      createdAt: now,
      expiresAt,
      issuerEmail: user.email,
    },
  }, 201);
}

export async function revokePlatformInvitation(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  await env.DB.prepare("UPDATE team_invites SET status = 'revoked' WHERE id = ? AND scope = 'platform'").bind(id).run();
  return json({ success: true });
}

export async function platformApiKeys(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  return apiKeysResponse(env, null);
}

export async function companyApiKeys(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  return apiKeysResponse(env, user.tenant_id);
}

async function apiKeysResponse(env: Env, tenantId: string | null): Promise<Response> {
  const rows = tenantId
    ? await env.DB.prepare('SELECT * FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC').bind(tenantId).all<Record<string, unknown>>()
    : await env.DB.prepare('SELECT * FROM api_keys WHERE tenant_id IS NULL ORDER BY created_at DESC').all<Record<string, unknown>>();
  return json({
    success: true,
    keys: (rows.results ?? []).map(apiKeyJson),
    apiKeysEnabled: true,
    scopes: SCOPES,
    presets: API_PRESETS,
  });
}

export async function createApiKey(request: Request, env: Env, tenantId: string | null): Promise<Response> {
  const { user } = tenantId ? await requireAuth(request, env) : await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes.map(String) : ['mail.send'];
  const raw = `vmk_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const prefix = raw.slice(0, 12);
  const expiresInDays = asNumber(body.expiresInDays, 0);
  const expiresAt = expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const keyHash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare(
    `INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scopes, created_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uuid(), tenantId, asString(body.name, 'API key'), prefix, keyHash, JSON.stringify(scopes), user.email, expiresAt, nowIso()).run();
  return json({ success: true, key: raw, prefix, scopes, expiresAt }, 201);
}

export async function revokeApiKey(request: Request, env: Env, id: string, tenantId: string | null): Promise<Response> {
  if (tenantId) await requireAuth(request, env);
  else await requirePlatformAdmin(request, env);
  const result = tenantId
    ? await env.DB.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ?').bind(nowIso(), id, tenantId).run()
    : await env.DB.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id IS NULL').bind(nowIso(), id).run();
  if (!result.meta.changes) throw new HttpError(404, 'API key was not found.');
  return json({ success: true });
}

export async function platformBilling(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 200').all<Record<string, unknown>>();
  const plans = await env.DB.prepare('SELECT plan, COUNT(*) AS count FROM tenants GROUP BY plan').all<{ plan: string; count: number }>();
  const mrr = (plans.results ?? []).reduce((sum, row) => sum + planMonthly(row.plan) * row.count, 0);
  const paid = (rows.results ?? []).filter((row) => row.status === 'paid');
  return json({
    success: true,
    summary: {
      mrr,
      arr: mrr * 12,
      paidSubscriptions: paid.length,
      totalCollectedPaise: paid.reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0),
      invoiceCount: (rows.results ?? []).length,
      currency: 'INR',
    },
    planDistribution: (plans.results ?? []).map((row) => ({ plan: row.plan, count: row.count })),
    invoices: (rows.results ?? []).map(paymentJson),
  });
}

export async function platformFlags(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM feature_flags ORDER BY name ASC').all<Record<string, unknown>>();
  return json({
    success: true,
    flags: (rows.results ?? []).map((row) => ({
      key: row.key,
      name: row.name,
      description: row.description,
      enabled: Boolean(row.enabled),
      rolloutPercent: row.rollout_percent,
      audience: parseJsonObject(row.audience),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    })),
  });
}

export async function updateFlag(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const key = asString(body.key);
  const updates: string[] = [];
  const values: unknown[] = [];
  if ('enabled' in body) { updates.push('enabled = ?'); values.push(body.enabled ? 1 : 0); }
  if ('rolloutPercent' in body) { updates.push('rollout_percent = ?'); values.push(asNumber(body.rolloutPercent)); }
  if (updates.length === 0) throw new HttpError(400, 'Nothing to update.');
  updates.push('updated_by = ?', 'updated_at = ?');
  values.push(user.email, nowIso(), key);
  await env.DB.prepare(`UPDATE feature_flags SET ${updates.join(', ')} WHERE key = ?`).bind(...values).run();
  return json({ success: true });
}

export async function platformAnnouncements(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all<Record<string, unknown>>();
  return json({
    success: true,
    announcements: (rows.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      severity: row.severity,
      audience: row.audience,
      status: row.status,
      publishedAt: row.published_at,
      expiresAt: row.expires_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
    })),
  });
}

export async function createAnnouncement(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  await env.DB.prepare(
    `INSERT INTO announcements (id, title, body, severity, audience, status, published_at, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uuid(),
    asString(body.title, 'Announcement'),
    asString(body.body),
    asString(body.severity, 'info'),
    asString(body.audience, 'all'),
    asString(body.status, 'draft'),
    body.publishedAt ? asString(body.publishedAt) : null,
    asString(body.expiresAt) || null,
    user.email,
    nowIso(),
  ).run();
  return json({ success: true }, 201);
}

export async function updateAnnouncement(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const status = asString(body.status, 'draft');
  await env.DB.prepare('UPDATE announcements SET status = ?, published_at = CASE WHEN ? = \'published\' THEN ? ELSE published_at END WHERE id = ?')
    .bind(status, status, nowIso(), id).run();
  return json({ success: true });
}

export async function deleteAnnouncement(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();
  return json({ success: true });
}

export async function platformSupport(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 200').all<Record<string, unknown>>();
  return json({
    success: true,
    tickets: (rows.results ?? []).map((row) => ({
      id: row.id,
      subject: row.subject,
      category: row.category,
      priority: row.priority,
      status: row.status,
      requester: row.requester,
      assignee: row.assignee,
      lastMessage: row.last_message,
      messageCount: row.message_count,
      company: row.tenant_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    })),
  });
}

export async function updateTicket(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(asString(body.status)); }
  if (body.assigneeEmail) { updates.push('assignee = ?'); values.push(asString(body.assigneeEmail)); }
  if (body.priority) { updates.push('priority = ?'); values.push(asString(body.priority)); }
  if (updates.length === 0) return json({ success: true });
  updates.push('updated_at = ?');
  values.push(nowIso(), id);
  await env.DB.prepare(`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return json({ success: true });
}

export async function platformSystem(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const [users, tenants, emails, queue] = await Promise.all([
    count(env, 'SELECT COUNT(*) AS count FROM users'),
    count(env, 'SELECT COUNT(*) AS count FROM tenants'),
    count(env, 'SELECT COUNT(*) AS count FROM emails'),
    count(env, "SELECT COUNT(*) AS count FROM mail_queue WHERE status IN ('queued','sending','deferred')"),
  ]);
  return json({
    success: true,
    service: {
      name: 'velismail-api',
      version: '5.3.0',
      uptimeSeconds: Math.floor(performance.now() / 1000),
      databaseConnected: true,
      databaseLatencyMs: 0,
      paymentGatewayConfigured: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
      firebaseOwnerGate: Boolean(env.FIREBASE_PROJECT_ID),
    },
    live: {
      requestsTotal: 0,
      requestsInFlight: 0,
      responses4xx: 0,
      responses5xx: 0,
      avgLatencyMs: 0,
      rateLimited: 0,
      overloads: 0,
      upstreamErrors: 0,
    },
    counts: { users, tenants, emails, queue },
    traffic: daysSeries(14).map((date) => ({ date, requests: 0, errors: 0, rateLimited: 0, overloads: 0, avgLatencyMs: 0 })),
  });
}

export async function platformFeedback(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 300').all<Record<string, unknown>>();
  return json({
    success: true,
    feedback: (rows.results ?? []).map((row) => ({
      id: row.id,
      tenantId: null,
      userId: row.user_id,
      userEmail: row.email,
      subject: row.subject,
      body: row.message,
      category: row.category,
      priority: row.escalated ? 'high' : 'normal',
      hasImage: false,
      imageBase64: null,
      status: row.status,
      assigneeEmail: null,
      reply: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: null,
    })),
    counts: {
      total: (rows.results ?? []).length,
      open: (rows.results ?? []).filter((row) => row.status === 'open').length,
    },
  });
}

export async function updateFeedback(request: Request, env: Env, id: string): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(asString(body.status)); }
  if (body.priority) { updates.push('escalated = ?'); values.push(body.priority === 'high' ? 1 : 0); }
  if (updates.length === 0) return json({ success: true });
  updates.push('updated_at = ?');
  values.push(nowIso(), id);
  await env.DB.prepare(`UPDATE feedback SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  return json({ success: true });
}

export async function escalateFeedback(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const row = await env.DB.prepare('SELECT * FROM feedback WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) throw new HttpError(404, 'Feedback was not found.');
  const caseNumber = `CASE-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  await env.DB.prepare('UPDATE feedback SET escalated = 1, status = ?, updated_at = ? WHERE id = ?')
    .bind('escalated', nowIso(), id).run();
  await env.DB.prepare(
    `INSERT INTO investigations (id, case_number, title, type, severity, status, priority, reporter_email, assignee_email,
       summary, description, evidence, tags, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'support', 'high', 'open', 'P2', ?, ?, ?, ?, '[]', '[]', ?, ?, ?)`,
  ).bind(
    uuid(), caseNumber, `Escalated feedback: ${row.subject}`, row.email, user.email,
    String(row.message).slice(0, 300), String(row.message), user.email, nowIso(), nowIso(),
  ).run();
  return json({ success: true, caseNumber });
}

export async function platformSettings(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM platform_settings ORDER BY key ASC').all<Record<string, unknown>>();
  return json({
    success: true,
    settings: (rows.results ?? []).map((row) => ({
      key: row.key,
      value: parseJsonObject({ value: row.value }).value ?? null,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    })),
  });
}

export async function updateSetting(request: Request, env: Env): Promise<Response> {
  const { user } = await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const key = asString(body.key);
  if (!key) throw new HttpError(400, 'Setting key is required.');
  await env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(key, JSON.stringify(body.value ?? null), user.email, nowIso()).run();
  return json({ success: true });
}

export async function platformBroadcastSenders(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  return json({
    success: true,
    defaultSender: { address: env.PLATFORM_FROM_EMAIL || 'noreply@velismail.online', name: env.PLATFORM_FROM_NAME || 'VelisMail' },
    mailboxes: [],
  });
}

export async function platformBroadcasts(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  return json({ success: true, broadcasts: [] });
}

export async function platformBroadcast(request: Request, env: Env): Promise<Response> {
  await requirePlatformAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const rows = await env.DB.prepare("SELECT email, display_name FROM users WHERE status = 'active' LIMIT 500")
    .all<{ email: string; display_name: string }>();
  const recipients = (rows.results ?? []).map((row) => ({ email: row.email, name: row.display_name }));
  if (body.dryRun) {
    return json({ success: true, dryRun: true, recipientCount: recipients.length, accountCount: recipients.length, additionalCount: 0, recipients });
  }
  const { sendPlatformEmail } = await import('../lib/email.js');
  let deliveredCount = 0;
  const failures: Array<{ email: string; error: string }> = [];
  for (const recipient of recipients) {
    const result = await sendPlatformEmail(env, {
      to: [recipient.email],
      subject: asString(body.subject, 'VelisMail update'),
      text: asString(body.body),
      from: asString(body.from) || undefined,
    });
    if (result.ok) deliveredCount += 1;
    else failures.push({ email: recipient.email, error: result.error ?? 'failed' });
  }
  return json({
    success: true,
    recipientCount: recipients.length,
    accountCount: recipients.length,
    additionalCount: 0,
    deliveredCount,
    failedCount: failures.length,
    status: failures.length === 0 ? 'sent' : 'partial',
    failures,
  });
}

// ---------------------------------------------------------------------------
// Company admin (tenant scoped)
// ---------------------------------------------------------------------------

async function requireCompanyAdmin(request: Request, env: Env): Promise<{ user: UserRow; tenantId: string }> {
  const { user } = await requireAuth(request, env);
  if (!user.tenant_id) throw new HttpError(409, 'This account has no workspace.');
  if (!(await canManageTenant(env, user, user.tenant_id))) {
    throw new HttpError(403, 'Workspace admin access is required.');
  }
  return { user, tenantId: user.tenant_id };
}

export async function companyOverview(request: Request, env: Env): Promise<Response> {
  const { user, tenantId } = await requireCompanyAdmin(request, env);
  const tenant = await getTenant(env, tenantId);
  if (!tenant) throw new HttpError(404, 'Workspace was not found.');
  const stats = await tenantCounts(env, tenantId);
  const limits = limitsFor(tenant.plan);
  const audit = await env.DB.prepare('SELECT * FROM audit_entries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10')
    .bind(tenantId).all<Record<string, unknown>>();
  const members = await env.DB.prepare('SELECT email, name, role, status, last_active_at FROM tenant_members WHERE tenant_id = ? LIMIT 20')
    .bind(tenantId).all<Record<string, unknown>>();
  const emailsThisMonth = await count(env,
    "SELECT COUNT(*) AS count FROM emails WHERE tenant_id = ? AND direction = 'outbound' AND created_at >= datetime('now','start of month')",
    tenantId);
  const usage = daysSeries(14).map((date) => ({ date, sent: 0, delivered: 0, failed: 0 }));

  return json({
    success: true,
    company: {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      role: user.role,
      email: user.email,
      isPlatformAdmin: Boolean(user.is_platform_admin),
    },
    counts: {
      members: stats.members,
      domains: stats.domains,
      apiKeys: await count(env, 'SELECT COUNT(*) AS count FROM api_keys WHERE tenant_id = ? AND revoked_at IS NULL', tenantId),
      invoices: stats.invoices,
      storageBytes: stats.storageBytes,
      activeSessions: 0,
      openCases: stats.openCases,
      sent30d: stats.sent,
      queueDepth: stats.queueDepth,
      failed30d: 0,
    },
    limits,
    quotas: [
      { key: 'seats', label: 'Team seats', used: stats.members, limit: limits.seats, unit: 'members', period: 'current', source: 'members' },
      { key: 'emails', label: 'Emails per month', used: emailsThisMonth, limit: limits.emailsPerMonth, unit: 'emails', period: 'month', source: 'emails' },
      { key: 'storage', label: 'Storage', used: stats.storageBytes, limit: limits.storageBytes, unit: 'bytes', period: 'current', source: 'storage' },
    ],
    trial: { active: tenant.plan === 'Free', label: 'Free plan', detail: 'Upgrade for higher sending and storage limits.' },
    usage: {
      emailPercent: Math.min(100, Math.round((emailsThisMonth / Math.max(limits.emailsPerMonth, 1)) * 100)),
      storagePercent: Math.min(100, Math.round((stats.storageBytes / Math.max(limits.storageBytes, 1)) * 100)),
    },
    activity: usage,
    members: (members.results ?? []).map((row) => ({
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      lastActiveAt: row.last_active_at,
    })),
    recentActivity: (audit.results ?? []).map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      category: row.category,
      severity: row.severity,
      createdAt: row.created_at,
    })),
    generatedAt: nowIso(),
  });
}

export async function companyMembers(request: Request, env: Env): Promise<Response> {
  const { tenantId } = await requireCompanyAdmin(request, env);
  const tenant = await getTenant(env, tenantId);
  const members = await env.DB.prepare('SELECT * FROM tenant_members WHERE tenant_id = ? ORDER BY created_at ASC')
    .bind(tenantId).all<Record<string, unknown>>();
  const invites = await env.DB.prepare("SELECT * FROM team_invites WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at DESC")
    .bind(tenantId).all<Record<string, unknown>>();
  const used = (members.results ?? []).length;
  const max = tenant?.seat_limit ?? 5;
  return json({
    success: true,
    members: (members.results ?? []).map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      status: row.status,
      invitedBy: row.invited_by,
      joinedAt: row.joined_at ?? row.created_at,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    })),
    invitations: (invites.results ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      invitedBy: row.issuer_email,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
    seatLimit: { used, max, capped: used >= max },
  });
}

export async function updateCompanyMember(request: Request, env: Env, id: string): Promise<Response> {
  const { tenantId } = await requireCompanyAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.role) { updates.push('role = ?'); values.push(asString(body.role)); }
  if (body.status) { updates.push('status = ?'); values.push(asString(body.status)); }
  if (updates.length === 0) return json({ success: true });
  values.push(id, tenantId);
  await env.DB.prepare(`UPDATE tenant_members SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  return json({ success: true });
}

export async function companyRoles(request: Request, env: Env): Promise<Response> {
  const { user } = await requireCompanyAdmin(request, env);
  return json({
    success: true,
    roles: [
      { key: 'owner', name: 'Owner', description: 'Full workspace control.', permissions: ['*'] },
      { key: 'admin', name: 'Admin', description: 'Manage mailboxes, domains and team.', permissions: ['domains.manage', 'team.manage', 'mail.send'] },
      { key: 'member', name: 'Member', description: 'Send and read mail.', permissions: ['mail.send', 'mail.read'] },
      { key: 'viewer', name: 'Viewer', description: 'Read-only access.', permissions: ['mail.read'] },
    ],
    currentRole: user.role,
  });
}

export async function companyUsage(request: Request, env: Env): Promise<Response> {
  const { tenantId } = await requireCompanyAdmin(request, env);
  const tenant = await getTenant(env, tenantId);
  const url = new URL(request.url);
  const rangeDays = Math.min(Math.max(asNumber(url.searchParams.get('days'), 30), 1), 365);
  const rows = await env.DB.prepare('SELECT * FROM usage_daily WHERE tenant_id = ? ORDER BY day ASC').bind(tenantId)
    .all<Record<string, unknown>>();
  const byDay = new Map((rows.results ?? []).map((row) => [row.day, row]));
  const series = daysSeries(rangeDays).map((date) => {
    const row = byDay.get(date);
    return {
      date,
      sent: Number(row?.sent ?? 0),
      delivered: Number(row?.sent ?? 0),
      failed: 0,
      bounced: Number(row?.bounces ?? 0),
    };
  });
  const totals = {
    sent30d: series.reduce((sum, row) => sum + row.sent, 0),
    delivered30d: series.reduce((sum, row) => sum + row.delivered, 0),
    failed30d: 0,
    storageBytes: 0,
    messages: series.reduce((sum, row) => sum + row.sent, 0),
  };
  const limits = limitsFor(tenant?.plan ?? 'Free');
  return json({
    success: true,
    rangeDays,
    plan: tenant?.plan ?? 'Free',
    limits,
    totals,
    usagePercent: Math.min(100, Math.round((totals.sent30d / Math.max(limits.emailsPerMonth, 1)) * 100)),
    series,
    history: [],
  });
}

export async function companyAudit(request: Request, env: Env): Promise<Response> {
  const { tenantId } = await requireCompanyAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM audit_entries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 300')
    .bind(tenantId).all<Record<string, unknown>>();
  return json({
    success: true,
    entries: (rows.results ?? []).map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      source: 'workspace',
      category: row.category,
      severity: row.severity,
      resourceType: row.resource_type,
      details: parseJsonObject(row.details),
      createdAt: row.created_at,
    })),
  });
}

export async function companySecurity(request: Request, env: Env): Promise<Response> {
  const { tenantId } = await requireCompanyAdmin(request, env);
  const rows = await env.DB.prepare(
    `SELECT r.*, u.email FROM refresh_tokens r JOIN users u ON u.id = r.user_id
     WHERE u.tenant_id = ? AND r.revoked_at IS NULL AND r.expires_at > ? ORDER BY r.last_active DESC LIMIT 100`,
  ).bind(tenantId, nowIso()).all<Record<string, unknown>>();
  const keys = await env.DB.prepare('SELECT * FROM api_keys WHERE tenant_id = ? AND revoked_at IS NULL').bind(tenantId)
    .all<Record<string, unknown>>();
  return json({
    success: true,
    sessions: (rows.results ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      device: row.device_id ?? 'web',
      ip: row.ip,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      lastActive: row.last_active,
      expiresAt: row.expires_at,
      mfaVerified: Boolean(row.mfa_verified),
    })),
    failedLogins: [],
    events: [],
    apiKeys: (keys.results ?? []).map((row) => ({
      prefix: row.prefix,
      name: row.name,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
    })),
    mfaPolicyRequired: false,
    sessionCount: (rows.results ?? []).length,
  });
}

export async function companyBilling(request: Request, env: Env): Promise<Response> {
  const { tenantId } = await requireCompanyAdmin(request, env);
  const tenant = await getTenant(env, tenantId);
  const rows = await env.DB.prepare('SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(tenantId).all<Record<string, unknown>>();
  const paid = (rows.results ?? []).filter((row) => row.status === 'paid');
  return json({
    success: true,
    plan: tenant?.plan ?? 'Free',
    status: tenant?.status ?? 'active',
    limits: limitsFor(tenant?.plan ?? 'Free'),
    summary: {
      totalPaidPaise: paid.reduce((sum, row) => sum + Number(row.amount_paise ?? 0), 0),
      invoiceCount: (rows.results ?? []).length,
      nextInvoiceAt: null,
      currency: 'INR',
    },
    catalog: PLAN_CATALOG.map((plan) => ({ ...plan, limits: limitsFor(plan.key) })),
    invoices: (rows.results ?? []).map(paymentJson),
    paymentGateway: { configured: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), provider: 'razorpay' },
  });
}

export async function companyIntegrations(request: Request, env: Env): Promise<Response> {
  const { tenantId } = await requireCompanyAdmin(request, env);
  const domains = await env.DB.prepare('SELECT * FROM domains WHERE tenant_id = ?').bind(tenantId)
    .all<Record<string, unknown>>();
  return json({
    success: true,
    domains: (domains.results ?? []).map((row) => ({
      id: row.id,
      domain: row.domain,
      status: row.status,
      method: row.provider,
      verifiedAt: row.verified_at,
      dnsRecords: parseJsonArray(row.dns_records),
    })),
    providers: [],
    webhooks: [],
  });
}

export async function companyAnnouncements(request: Request, env: Env): Promise<Response> {
  await requireCompanyAdmin(request, env);
  const rows = await env.DB.prepare("SELECT * FROM announcements WHERE status = 'published' ORDER BY published_at DESC LIMIT 20")
    .all<Record<string, unknown>>();
  return json({
    success: true,
    announcements: (rows.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      severity: row.severity,
      audience: row.audience,
      status: row.status,
      publishedAt: row.published_at,
      createdAt: row.created_at,
    })),
  });
}

export async function submitCompanyFeedback(request: Request, env: Env): Promise<Response> {
  const { user, tenantId } = await requireCompanyAdmin(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const id = uuid();
  const caseNumber = `FB-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
  await env.DB.prepare(
    `INSERT INTO feedback (id, case_number, user_id, email, category, subject, message, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  ).bind(
    id,
    caseNumber,
    user.id,
    user.email,
    asString(body.category, 'general'),
    asString(body.subject, 'Workspace feedback'),
    asString(body.message ?? body.body),
    nowIso(),
    nowIso(),
  ).run();
  await logPlatformAudit(env, {
    actor: user.email,
    action: 'feedback.received',
    resourceType: 'feedback',
    resourceId: id,
    tenantId,
    details: body,
  });
  return json({ success: true, id, caseNumber }, 201);
}

export async function companyFeedback(request: Request, env: Env): Promise<Response> {
  const { user } = await requireCompanyAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(user.id).all<Record<string, unknown>>();
  return json({
    success: true,
    feedback: (rows.results ?? []).map((row) => ({
      id: row.id,
      subject: row.subject,
      body: row.message,
      category: row.category,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

export async function companyPlatformFeedback(request: Request, env: Env): Promise<Response> {
  const { user, tenantId } = await requireCompanyAdmin(request, env);
  const rows = await env.DB.prepare('SELECT * FROM feedback WHERE email = ? ORDER BY created_at DESC LIMIT 100')
    .bind(user.email).all<Record<string, unknown>>();
  return json({
    success: true,
    feedback: (rows.results ?? []).map((row) => ({
      id: row.id,
      subject: row.subject,
      body: row.message,
      category: row.category,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    tenantId,
  });
}
