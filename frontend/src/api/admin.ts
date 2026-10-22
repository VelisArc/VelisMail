import { fetchApiJsonDetailed } from './client-core';

export class AdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
  }
}

async function call<T>(endpoint: string, options: RequestInit = {}, retried = false): Promise<T> {
  const response = await fetchApiJsonDetailed<T>(endpoint, options);
  if (!response.ok) {
    if (
      response.status === 401
      && !retried
      && !endpoint.includes('/auth/token/refresh')
      && await refreshAdminSession()
    ) {
      return call<T>(endpoint, options, true);
    }
    const body = response.data as Record<string, unknown> | null;
    const errorValue = body?.error;
    const message =
      typeof errorValue === 'string'
        ? errorValue
        : typeof body?.message === 'string'
          ? body.message
          : `Request failed with status ${response.status}`;
    throw new AdminApiError(message, response.status);
  }
  return (response.data ?? ({} as T)) as T;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Rotate the stored admin session using the refresh token. */
export function refreshAdminSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refresh = localStorage.getItem('velismail_refresh');
      if (!refresh) return false;
      const response = await fetchApiJsonDetailed<{
        access_token?: string;
        refresh_token?: string;
      }>('/auth/token/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh, device_id: 'admin-web' }),
      });
      if (!response.ok || !response.data?.access_token) return false;
      localStorage.setItem('velismail_token', response.data.access_token);
      if (response.data.refresh_token) {
        localStorage.setItem('velismail_refresh', response.data.refresh_token);
      }
      return true;
    })().catch(() => false).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) };
}

function patchBody(value: unknown): RequestInit {
  return { method: 'PATCH', body: JSON.stringify(value) };
}

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

export type AdminMe = {
  success: boolean;
  /** True when the account is the configured platform owner. */
  owner: boolean;
  /** True when the account holds the owner role. */
  roleOwner?: boolean;
  admin: { email: string; role: string; permissions: string[] };
};

export type PlatformOverview = {
  success: boolean;
  generatedAt: string;
  actor: { email: string; role: string };
  kpis: {
    companies: number;
    activeCompanies: number;
    paidCompanies: number;
    users: number;
    activeUsers: number;
    newUsers30d: number;
    activeUsers24h: number;
    emails30d: number;
    storageBytes: number;
    queueDepth: number;
    queueFailed: number;
    delivered: number;
    openInvestigations: number;
    criticalInvestigations: number;
    paidSubscriptions: number;
    mrr: number;
    arr: number;
    requestsToday: number;
    errorsToday: number;
    avgLatencyMs: number;
  };
  growth: {
    companies: Array<{ date: string; value: number }>;
    users: Array<{ date: string; value: number }>;
    emails: Array<{ date: string; value: number }>;
  };
  planDistribution: Array<{ plan: string; count: number }>;
  topCompanies: Array<{
    id: string;
    name: string;
    plan: string;
    status: string;
    users: number;
    sent: number;
  }>;
  investigations: Investigation[];
  recentAudit: AuditEntry[];
  health: { database: boolean; queueBacklog: number; queueFailed: number };
};

export type PlatformAnalytics = {
  success: boolean;
  rangeDays: number;
  series: {
    signups: Array<{ date: string; value: number }>;
    companies: Array<{ date: string; value: number }>;
    sent: Array<{ date: string; value: number }>;
    delivered: Array<{ date: string; value: number }>;
    failed: Array<{ date: string; value: number }>;
    traffic: Array<{
      date: string;
      requests: number;
      errors: number;
      rateLimited: number;
      overloads: number;
      avgLatencyMs: number;
    }>;
  };
  leaderboard: Array<{
    id: string;
    name: string;
    plan: string;
    users: number;
    domains: number;
    storage: number;
    sent: number;
  }>;
};

export type Company = {
  id: string;
  name: string;
  email: string;
  plan: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  settings: Record<string, unknown>;
  limits: Record<string, unknown>;
  slug?: string | null;
  industry?: string | null;
  country?: string | null;
  timezone?: string | null;
  legalName?: string | null;
  billingEmail?: string | null;
  technicalEmail?: string | null;
  seatLimit: number;
  logoUrl?: string | null;
  users: number;
  members: number;
  domains: number;
  storageBytes: number;
  sent: number;
  queueDepth: number;
  invoices: number;
  openCases: number;
  /** Every email domain the company owns. */
  domainList: string[];
  mailboxes: number;
  lastActivity?: string | null;
};

export type CompanyDetail = {
  success: boolean;
  company: Company;
  members: CompanyMember[];
  domains: Array<{
    id: string;
    domain: string;
    status: string;
    addedAt: string;
    verifiedAt?: string | null;
  }>;
  invoices: Invoice[];
  investigations: Investigation[];
  mailboxes: Array<{
    id: string;
    domain: string;
    address: string;
    name: string;
    kind: string;
    active: boolean;
    source: string;
    createdAt?: string | null;
    lastUsedAt?: string | null;
  }>;
  apiKeys: Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    createdBy: string;
    lastUsedAt?: string | null;
    expiresAt?: string | null;
    revokedAt?: string | null;
    createdAt?: string | null;
  }>;
  sessions: Array<{
    id: string;
    email: string;
    device: string;
    ip?: string | null;
    userAgent?: string | null;
    createdAt?: string | null;
    lastActive?: string | null;
    expiresAt?: string | null;
    mfaVerified: boolean;
  }>;
  usage: Array<{
    date: string;
    sent: number;
    received: number;
    apiRequests: number;
    storageBytes: number;
    activeUsers: number;
    queueDepth: number;
    bounces: number;
    spamBlocked: number;
    avgLatencyMs: number;
    errorRate: number;
  }>;
  recentAudit: Array<{
    id: string;
    actor: string;
    actorRole: string;
    action: string;
    category: string;
    resourceType: string;
    severity: string;
    createdAt?: string | null;
  }>;
};

export type CompanyMember = {
  id: string;
  userId?: string | null;
  email: string;
  name: string;
  role: string;
  status: string;
  invitedBy?: string | null;
  joinedAt: string;
  lastActiveAt?: string | null;
  createdAt?: string;
};

export type PlatformUser = {
  id: string;
  email: string;
  /** The address the account is reached on. Alerts go here, never to the
   * company mailbox. */
  recoveryEmail?: string;
  displayName: string;
  status: string;
  tenantId?: string | null;
  company?: string | null;
  companyEmail?: string | null;
  plan: string;
  billingCycle: string;
  role: string;
  companyRole?: string | null;
  /** Email domains owned by the company of this account. */
  domains: string[];
  isPlatformAdmin: boolean;
  createdAt: string;
  lastLogin?: string | null;
  sent: number;
  activeSessions: number;
  failedLogins: number;
  risk: 'low' | 'medium' | 'high';
};

export type Investigation = {
  id: string;
  caseNumber: string;
  title: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'contained' | 'resolved' | 'closed';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  tenantId?: string | null;
  tenantName?: string | null;
  reporterEmail?: string | null;
  assigneeEmail?: string | null;
  summary: string;
  description: string;
  evidence: unknown[];
  tags: string[];
  slaDueAt?: string | null;
  resolvedAt?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
};

export type InvestigationDetail = {
  success: boolean;
  investigation: Investigation;
  events: Array<{
    id: string;
    actor: string;
    kind: string;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
};

export type AuditEntry = {
  id: string;
  actor: string;
  actorRole?: string;
  action: string;
  category: string;
  resourceType?: string;
  resourceId?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  details: Record<string, unknown>;
  severity: string;
  createdAt: string;
};

export type Invoice = {
  id: string;
  number: string;
  company?: string;
  email?: string;
  plan: string;
  billingCycle: string;
  amountPaise: number;
  currency: string;
  status: string;
  issuedAt: string;
  dueAt?: string | null;
  paidAt?: string | null;
  gateway: string;
  paymentRef?: string | null;
  lineItems?: unknown[];
};

export type PlatformBroadcast = {
  id: string;
  subject: string;
  body: string;
  category: string;
  audience: string;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  status: string;
  fromAddress?: string | null;
  createdBy: string;
  createdAt: string;
};

export type PlatformBroadcastSender = {
  address: string;
  displayName: string;
  domain: string;
  company: string;
  source: string;
  domainStatus: string;
};

export type PlatformTeam = {
  success: boolean;
  admins: Array<{
    email: string;
    displayName: string;
    role: string;
    roleName?: string | null;
    roleDescription?: string | null;
    status: string;
    permissions: string[];
    mfaEnabled: boolean;
    lastSeenAt?: string | null;
    createdAt: string;
  }>;
  roles: Array<{
    key: string;
    name: string;
    description: string;
    permissions: string[];
    isSystem: boolean;
    /** Only the platform owner may hand this role out. */
    ownerOnly?: boolean;
  }>;
  /** The role the signed-in staff member holds. */
  viewerRole?: string;
  /** True when the signed-in staff member is the platform owner. */
  isOwner?: boolean;
};

export type FeatureFlag = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  audience: Record<string, unknown>;
  updatedBy?: string | null;
  updatedAt: string;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  severity: string;
  audience: string;
  status: string;
  publishedAt?: string | null;
  expiresAt?: string | null;
  createdBy: string;
  createdAt: string;
};

export type SupportTicket = {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  requester: string;
  assignee?: string | null;
  lastMessage: string;
  messageCount: number;
  company?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
};

export type SystemInfo = {
  success: boolean;
  service: {
    name: string;
    version: string;
    uptimeSeconds: number;
    databaseConnected: boolean;
    databaseLatencyMs: number;
    paymentGatewayConfigured: boolean;
    firebaseOwnerGate: boolean;
  };
  live: {
    requestsTotal: number;
    requestsInFlight: number;
    responses4xx: number;
    responses5xx: number;
    avgLatencyMs: number;
    rateLimited: number;
    overloads: number;
    upstreamErrors: number;
  };
  counts: Record<string, number>;
  traffic: Array<{
    date: string;
    requests: number;
    errors: number;
    rateLimited: number;
    overloads: number;
    avgLatencyMs: number;
  }>;
};

export type PlatformSetting = {
  key: string;
  value: unknown;
  updatedBy?: string | null;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Platform control plane
// ---------------------------------------------------------------------------

export const platformAdminApi = {
  me: () => call<AdminMe>('/admin/platform/me'),

  overview: () => call<PlatformOverview>('/admin/platform/overview'),

  analytics: (days = 30) =>
    call<PlatformAnalytics>(`/admin/platform/analytics${query({ days })}`),

  companies: (params: { search?: string; plan?: string; status?: string; limit?: number; offset?: number } = {}) =>
    call<{ success: boolean; companies: Company[]; pagination: { total: number; limit: number; offset: number } }>(
      `/admin/platform/companies${query(params)}`,
    ),

  company: (id: string) => call<CompanyDetail>(`/admin/platform/companies/${encodeURIComponent(id)}`),

  /**
   * Platform operator actions on a company: suspend it, move it between
   * plans, change its seat limit, cut its API keys, force every session
   * closed or close its open investigations.
   */
  companyAction: (
    id: string,
    payload: {
      action: 'suspend' | 'activate' | 'set_plan' | 'set_seats' | 'revoke_api_keys' | 'terminate_sessions' | 'close_cases';
      plan?: string;
      seatLimit?: number;
      reason?: string;
    },
  ) =>
    call<{ success: boolean; action: string; affected: number }>(
      `/admin/platform/companies/${encodeURIComponent(id)}/actions`,
      jsonBody(payload),
    ),

  updateCompany: (id: string, payload: Record<string, unknown>) =>
    call<{ success: boolean }>(`/admin/platform/companies/${encodeURIComponent(id)}`, patchBody(payload)),

  users: (params: { search?: string; status?: string; plan?: string } = {}) =>
    call<{ success: boolean; users: PlatformUser[] }>(`/admin/platform/users${query(params)}`),

  /** Platform operator actions on an account. */
  userAction: (
    id: string,
    payload: {
      action: 'suspend' | 'activate' | 'terminate_sessions' | 'set_role';
      role?: string;
      reason?: string;
    },
  ) =>
    call<{ success: boolean; action: string; affected: number }>(
      `/admin/platform/users/${encodeURIComponent(id)}/actions`,
      jsonBody(payload),
    ),

  investigations: (params: { search?: string; status?: string; severity?: string; assignee?: string } = {}) =>
    call<{
      success: boolean;
      investigations: Investigation[];
      counts: { total: number; open: number; investigating: number; critical: number; overdue: number };
    }>(`/admin/platform/investigations${query(params)}`),

  investigation: (id: string) =>
    call<InvestigationDetail>(`/admin/platform/investigations/${encodeURIComponent(id)}`),

  createInvestigation: (payload: Record<string, unknown>) =>
    call<{ success: boolean; investigation: Investigation }>(
      '/admin/platform/investigations',
      jsonBody(payload),
    ),

  updateInvestigation: (id: string, payload: Record<string, unknown>) =>
    call<{ success: boolean; investigation: Investigation }>(
      `/admin/platform/investigations/${encodeURIComponent(id)}`,
      patchBody(payload),
    ),

  addInvestigationEvent: (id: string, payload: { message: string; kind?: string }) =>
    call<{ success: boolean }>(
      `/admin/platform/investigations/${encodeURIComponent(id)}/events`,
      jsonBody(payload),
    ),

  audit: (params: { category?: string; severity?: string; search?: string; tenantId?: string } = {}) =>
    call<{ success: boolean; logs: AuditEntry[]; categories: string[] }>(
      `/admin/platform/audit${query(params)}`,
    ),

  team: () => call<PlatformTeam>('/admin/platform/team'),

  broadcast: (payload: {
    subject: string;
    body: string;
    category?: string;
    audience?: string;
    search?: string;
    recipientIds?: string[];
    additionalEmails?: string[];
    from?: string;
    dryRun?: boolean;
    maxRecipients?: number;
  }) =>
    call<{
      success: boolean;
      dryRun?: boolean;
      recipientCount?: number;
      accountCount?: number;
      additionalCount?: number;
      deliveredCount?: number;
      failedCount?: number;
      status?: string;
      recipients?: Array<{ email: string; name: string }>;
      failures?: Array<{ email: string; error: string }>;
    }>('/admin/platform/broadcast', jsonBody(payload)),

  broadcastSenders: () =>
    call<{
      success: boolean;
      defaultSender: { address: string; name: string };
      mailboxes: PlatformBroadcastSender[];
    }>('/admin/platform/broadcast/senders'),

  broadcasts: () =>
    call<{ success: boolean; broadcasts: PlatformBroadcast[] }>('/admin/platform/broadcasts'),

  addAdmin: (payload: { email: string; role?: string; displayName?: string }) =>
    call<{ success: boolean }>('/admin/platform/team', jsonBody(payload)),

  updateAdmin: (email: string, payload: { role?: string; status?: string; displayName?: string }) =>
    call<{ success: boolean }>(
      `/admin/platform/team/${encodeURIComponent(email)}`,
      patchBody(payload),
    ),

  billing: () =>
    call<{
      success: boolean;
      summary: {
        mrr: number;
        arr: number;
        paidSubscriptions: number;
        totalCollectedPaise: number;
        invoiceCount: number;
        currency: string;
      };
      planDistribution: Array<{ plan: string; count: number }>;
      invoices: Invoice[];
    }>('/admin/platform/billing'),

  flags: () => call<{ success: boolean; flags: FeatureFlag[] }>('/admin/platform/feature-flags'),

  updateFlag: (payload: { key: string; enabled?: boolean; rolloutPercent?: number }) =>
    call<{ success: boolean }>('/admin/platform/feature-flags', patchBody(payload)),

  announcements: () =>
    call<{ success: boolean; announcements: Announcement[] }>('/admin/platform/announcements'),

  createAnnouncement: (payload: Record<string, unknown>) =>
    call<{ success: boolean }>('/admin/platform/announcements', jsonBody(payload)),

  updateAnnouncement: (id: string, status: string) =>
    call<{ success: boolean }>(
      `/admin/platform/announcements/${encodeURIComponent(id)}`,
      patchBody({ status }),
    ),

  support: () => call<{ success: boolean; tickets: SupportTicket[] }>('/admin/platform/support'),

  updateTicket: (id: string, payload: { status?: string; assigneeEmail?: string; priority?: string }) =>
    call<{ success: boolean }>(
      `/admin/platform/support/${encodeURIComponent(id)}`,
      patchBody(payload),
    ),

  system: () => call<SystemInfo>('/admin/platform/system'),

  settings: () =>
    call<{ success: boolean; settings: PlatformSetting[] }>('/admin/platform/settings'),

  updateSetting: (key: string, value: unknown) =>
    call<{ success: boolean }>('/admin/platform/settings', patchBody({ key, value })),
};

// ---------------------------------------------------------------------------
// Company control plane
// ---------------------------------------------------------------------------

export type CompanyOverview = {
  success: boolean;
  company: {
    id: string;
    name: string;
    plan: string;
    status: string;
    role: string;
    email: string;
    isPlatformAdmin: boolean;
  };
  counts: {
    members: number;
    domains: number;
    apiKeys: number;
    invoices: number;
    storageBytes: number;
    activeSessions: number;
    openCases: number;
    sent30d: number;
    queueDepth: number;
    failed30d: number;
  };
  limits: {
    seats: number;
    emailsPerMonth: number;
    storageBytes: number;
    apiRequestsPerMinute: number;
  };
  /** Every allowance of the plan with the real consumption. */
  quotas: Array<{
    key: string;
    label: string;
    used: number;
    limit: number;
    unit: string;
    period: string;
    source: string;
  }>;
  /** Free trial information for workspaces that never upgraded. */
  trial: { active: boolean; label: string; detail: string };
  usage: { emailPercent: number; storagePercent: number };
  activity: Array<{ date: string; sent: number; delivered: number; failed: number }>;
  members: Array<{ email: string; name: string; role: string; status: string; lastActiveAt?: string | null }>;
  recentActivity: Array<{
    id: string;
    actor: string;
    action: string;
    category: string;
    severity: string;
    createdAt: string;
  }>;
  generatedAt: string;
};

export const companyAdminApi = {
  overview: () => call<CompanyOverview>('/admin/company/overview'),

  members: () =>
    call<{
      success: boolean;
      members: CompanyMember[];
      invitations: Array<{
        id: string;
        email: string;
        role: string;
        status: string;
        invitedBy: string;
        expiresAt: string;
        createdAt: string;
      }>;
      seatLimit: { used: number; max: number; capped: boolean };
    }>('/admin/company/members'),

  updateMember: (id: string, payload: { role?: string; status?: string }) =>
    call<{ success: boolean }>(
      `/admin/company/members/${encodeURIComponent(id)}`,
      patchBody(payload),
    ),

  roles: () =>
    call<{
      success: boolean;
      roles: Array<{ key: string; name: string; description: string; permissions: string[] }>;
      currentRole: string;
    }>('/admin/company/roles'),

  usage: (days = 30) =>
    call<{
      success: boolean;
      rangeDays: number;
      plan: string;
      limits: CompanyOverview['limits'];
      totals: {
        sent30d: number;
        delivered30d: number;
        failed30d: number;
        storageBytes: number;
        messages: number;
      };
      usagePercent: number;
      series: Array<{ date: string; sent: number; delivered: number; failed: number; bounced: number }>;
      history: Array<Record<string, unknown>>;
    }>(`/admin/company/usage${query({ days })}`),

  audit: () =>
    call<{
      success: boolean;
      entries: Array<{
        id: string;
        actor: string;
        action: string;
        source: string;
        category: string;
        severity: string;
        resourceType: string;
        details: Record<string, unknown>;
        createdAt: string;
      }>;
    }>('/admin/company/audit'),

  security: () =>
    call<{
      success: boolean;
      sessions: Array<{
        id: string;
        email: string;
        device: string;
        ip?: string | null;
        userAgent?: string | null;
        createdAt: string;
        lastActive: string;
        expiresAt: string;
        mfaVerified: boolean;
      }>;
      failedLogins: Array<{ id: string; email: string; ip?: string | null; attemptedAt: string }>;
      events: Array<{
        id: string;
        eventType: string;
        severity: string;
        ip?: string | null;
        userAgent?: string | null;
        details: Record<string, unknown>;
        createdAt: string;
      }>;
      apiKeys: Array<{
        prefix: string;
        name: string;
        lastUsedAt?: string | null;
        expiresAt?: string | null;
      }>;
      mfaPolicyRequired: boolean;
      sessionCount: number;
    }>('/admin/company/security'),

  apiKeys: () =>
    call<{
      success: boolean;
      keys: Array<{
        id: string;
        name: string;
        prefix: string;
        scopes: string[];
        createdBy: string;
        lastUsedAt?: string | null;
        expiresAt?: string | null;
        revokedAt?: string | null;
        createdAt: string;
      }>;
      apiKeysEnabled: boolean;
      /** Every scope a key can carry, with what it unlocks. */
      scopes: Array<{
        id: string;
        label: string;
        detail: string;
        risk: 'low' | 'medium' | 'high';
      }>;
      /** Ready made key templates. */
      presets: Array<{
        id: string;
        name: string;
        summary: string;
        detail: string;
        scopes: string[];
        recommended: boolean;
      }>;
    }>('/admin/company/api-keys'),

  createApiKey: (payload: { name: string; scopes?: string[]; expiresInDays?: number }) =>
    call<{ success: boolean; key: string; prefix: string; scopes: string[]; expiresAt?: string | null }>(
      '/admin/company/api-keys',
      jsonBody(payload),
    ),

  revokeApiKey: (id: string) =>
    call<{ success: boolean }>(`/admin/company/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  billing: () =>
    call<{
      success: boolean;
      plan: string;
      status: string;
      limits: CompanyOverview['limits'];
      summary: {
        totalPaidPaise: number;
        invoiceCount: number;
        nextInvoiceAt?: string | null;
        currency: string;
      };
      catalog: Array<{
        key: string;
        name: string;
        monthlyPaise: number;
        annualPaise: number;
        /** A plan that is only available on request. */
        contactOnly: boolean;
        /** A plan without published limits: the allowance is negotiated. */
        negotiated: boolean;
        limits: CompanyOverview['limits'];
      }>;
      invoices: Invoice[];
      paymentGateway: { configured: boolean; provider: string };
    }>('/admin/company/billing'),

  integrations: () =>
    call<{
      success: boolean;
      domains: Array<{
        id: string;
        domain: string;
        status: string;
        method?: string | null;
        dnsRecords: unknown[];
        mxRecords: unknown[];
        spfRecord?: string | null;
        dkimRecord?: string | null;
        dmarcRecord?: string | null;
        addedAt: string;
        verifiedAt?: string | null;
      }>;
      features: Array<{ key: string; name: string; enabled: boolean }>;
      apiKeys: number;
      mailboxes: { outboundConfigured: boolean; inboundConfigured: boolean; provider: string };
      webhooks: unknown[];
      smtp: Record<string, unknown>;
    }>('/admin/company/integrations'),

  announcements: () =>
    call<{
      success: boolean;
      announcements: Array<{
        id: string;
        title: string;
        body: string;
        severity: string;
        audience: string;
        publishedAt?: string | null;
        expiresAt?: string | null;
      }>;
    }>('/admin/company/announcements'),
};

// ---------------------------------------------------------------------------
// Admin authentication
//
// The platform control plane lives inside the business dashboard, so it uses
// the same session as the rest of the app. Only the transport helpers below
// are specific to the administration APIs.
// ---------------------------------------------------------------------------

