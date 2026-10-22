/**
 * Company workspace API.
 *
 * These endpoints belong to the customer: they expose the signed-in
 * company's own team, domains, mailboxes, delivery queue, audit trail,
 * templates, contacts and signatures. Every response is scoped to the
 * tenant that the gateway derives from the verified session, so a company
 * can never read another company's workspace.
 *
 * The platform control plane lives in `admin.ts` and is a separate
 * ecosystem: the VelisMail operator manages every company from there.
 */

import { fetchApiJsonDetailed } from './client-core';
import type {
  BusinessAuditEntry,
  BusinessMailbox,
  BusinessTeamMember,
  BusinessTemplate,
  Contact,
  Signature,
} from './types';

export type WorkspaceMember = {
  id: string;
  userId?: string | null;
  email: string;
  name: string;
  role: string;
  status: string;
  invitedBy?: string | null;
  joinedAt?: string | null;
  lastActiveAt?: string | null;
  plan?: string;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  status: string;
  expiresAt?: string | null;
  createdAt?: string | null;
};

export type WorkspaceDomain = {
  id: string;
  domain: string;
  /** The first domain of the workspace is the primary one. */
  primary?: boolean;
  status: string;
  method?: string | null;
  dnsRecords: Array<Record<string, unknown>>;
  mxRecords: Array<Record<string, unknown>>;
  spfRecord?: string | null;
  dkimRecord?: string | null;
  dmarcRecord?: string | null;
  createdAt?: string | null;
  verifiedAt?: string | null;
  mailboxes?: number;
};

/** A DNS record the customer has to publish. */
export type DnsRequirement = {
  recordType: 'MX' | 'TXT' | string;
  /** The name to enter in the DNS provider (`@` for the root domain). */
  name: string;
  /** The fully qualified host the record lives on. */
  host: string;
  /** The value to publish. */
  value: string;
  ttl: number;
  /** What the record is for. */
  purpose: string;
  /** verified, missing, mismatch, pending or unknown. */
  status: string;
  /** What the DNS currently returns. */
  actual: string;
  /** What the customer has to do to make the record active. */
  detail: string;
  /** How the value is compared: exact, prefix, exists, spf or resend_inbound. */
  matchMode: string;
};

export type DnsRequirements = {
  success: boolean;
  domain: string;
  provider: string;
  /** The host that actually sends the mail. */
  sendingDomain: string;
  /** The stored verification state of the domain. */
  domainStatus: string;
  /** True when every record is published and matches. */
  complete: boolean;
  records: DnsRequirement[];
  missing: string[];
  message: string;
};

export type WorkspaceAuditEntry = {
  id: string;
  actor: string;
  actorRole: string;
  action: string;
  category: string;
  resourceType: string;
  resourceId?: string | null;
  details: Record<string, unknown>;
  severity: string;
  createdAt?: string | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApiJsonDetailed<T>(path, init);
  if (!response.ok) {
    const body = response.data as { error?: string; message?: string } | null;
    throw new Error(
      body?.error || body?.message || `Request failed with status ${response.status}`,
    );
  }
  return (response.data ?? ({} as T)) as T;
}

export type WorkspaceBusiness = {
  id: string;
  name: string;
  email: string;
  plan: string;
  status: string;
  role: string;
  primaryDomain?: string | null;
  members: number;
  createdAt: string;
};

export const workspaceApi = {
  businesses: () =>
    request<{
      success: boolean;
      businesses: WorkspaceBusiness[];
      activeBusinessId: string;
    }>('/company/businesses'),

  createBusiness: (payload: { name: string; domain: string; plan?: string }) =>
    request<{
      success: boolean;
      business: WorkspaceBusiness;
      domain: string;
      verificationToken: string;
    }>('/company/businesses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  switchBusiness: (businessId: string) =>
    request<{ success: boolean; business: WorkspaceBusiness; role: string }>(
      '/company/businesses/switch',
      { method: 'POST', body: JSON.stringify({ businessId }) },
    ),

  team: () =>
    request<{
      success: boolean;
      members: WorkspaceMember[];
      invitations: WorkspaceInvitation[];
      seatLimit: { used: number; max: number; capped: boolean };
    }>('/company/team'),

  invite: (payload: { email: string; role: string; expiresInHours?: number }) =>
    request<{ success: boolean; id: string; email: string; role: string; expiresAt: string }>(
      '/company/team/invitations',
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  revokeInvitation: (id: string) =>
    request<{ success: boolean }>(`/company/team/invitations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  removeTeamMember: (email: string) =>
    request<{ success: boolean; email: string }>('/company/team/remove', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  domains: () =>
    request<{ success: boolean; domains: WorkspaceDomain[] }>('/company/domains'),

  createDomain: (payload: { domain: string }) =>
    request<{ success: boolean; id: string; domain: string; verificationToken: string; existing?: boolean }>(
      '/company/domains',
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  deleteDomain: (id: string) =>
    request<{ success: boolean; domain: string }>(
      `/company/domains/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  /**
   * The exact DNS records the domain needs, with the live status of every
   * record. The records come from the mail provider, so the name and the
   * value are always the ones that have to be published.
   */
  dnsRequirements: (domain: string) =>
    request<DnsRequirements>(`/company/domains/dns-requirements?domain=${encodeURIComponent(domain)}`),

  /**
   * Check a domain against the live DNS and store the result. The domain is
   * only marked as verified when every record is published and active.
   */
  verifyDomain: (id: string) =>
    request<DnsRequirements & { domainStatus: string }>(
      `/company/domains/${encodeURIComponent(id)}/verify`,
      { method: 'POST' },
    ),

  mailboxes: () =>
    request<{ success: boolean; mailboxes: BusinessMailbox[] }>('/company/mailboxes'),

  createMailbox: (payload: {
    domain: string;
    address: string;
    displayName: string;
    kind?: string;
    aliases?: string[];
    active?: boolean;
  }) =>
    request<{ success: boolean; id: string; address: string }>('/company/mailboxes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteMailbox: (domain: string, address: string) =>
    request<{ success: boolean }>(
      `/company/mailboxes/delete?domain=${encodeURIComponent(domain)}&address=${encodeURIComponent(address)}`,
      { method: 'DELETE' },
    ),

  queue: (params: { status?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.status) search.set('status', params.status);
    if (params.limit) search.set('limit', String(params.limit));
    const suffix = search.toString();
    return request<{ success: boolean; items: Array<Record<string, unknown>> }>(
      `/company/queue${suffix ? `?${suffix}` : ''}`,
    );
  },

  groups: (domain?: string) =>
    request<{
      success: boolean;
      groups: Array<{
        id: string;
        domain: string;
        name: string;
        address: string;
        members: string[];
        createdAt?: string | null;
        updatedAt?: string | null;
      }>;
    }>(`/company/groups${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`),

  saveGroup: (payload: { domain: string; name: string; address: string; members?: string[] }) =>
    request<{ success: boolean; id: string }>('/company/groups', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteGroup: (id: string) =>
    request<{ success: boolean }>(`/company/groups/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  audit: (params: { limit?: number } = {}) => {
    const suffix = params.limit ? `?limit=${params.limit}` : '';
    return request<{ success: boolean; entries: WorkspaceAuditEntry[] }>(`/company/audit${suffix}`);
  },

  templates: () =>
    request<{ success: boolean; templates: BusinessTemplate[] }>('/company/templates'),

  saveTemplate: (payload: { name: string; subject: string; body: string }) =>
    request<{ success: boolean; id: string }>('/company/templates', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteTemplate: (id: string) =>
    request<{ success: boolean }>(`/company/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  contacts: (params: { search?: string; group?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.search) search.set('search', params.search);
    if (params.group) search.set('group', params.group);
    const suffix = search.toString();
    return request<{ success: boolean; contacts: Contact[]; groups: Array<{ name: string; count: number }> }>(
      `/company/contacts${suffix ? `?${suffix}` : ''}`,
    );
  },

  saveContact: (payload: {
    id?: string;
    name: string;
    email: string;
    phone?: string;
    company?: string;
    group?: string;
    notes?: string;
    favorite?: boolean;
  }) =>
    request<{ success: boolean; id: string }>('/company/contacts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteContact: (id: string) =>
    request<{ success: boolean }>(`/company/contacts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  signatures: () =>
    request<{ success: boolean; signatures: Signature[] }>('/company/signatures'),

  saveSignature: (payload: { id?: string; name: string; content: string; isDefault?: boolean }) =>
    request<{ success: boolean; id: string }>('/company/signatures', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteSignature: (id: string) =>
    request<{ success: boolean }>(`/company/signatures/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

/** Map a workspace member onto the dashboard team shape. */
export function toTeamMember(member: WorkspaceMember): BusinessTeamMember {
  return {
    id: member.id,
    name: member.name || member.email,
    email: member.email,
    role: (member.role === 'owner' ? 'admin' : member.role) as BusinessTeamMember['role'],
    status: (member.status === 'active' ? 'active' : member.status) as BusinessTeamMember['status'],
    addedAt: member.joinedAt || member.lastActiveAt || '',
    lastActive: member.lastActiveAt || '',
  };
}

/** Map a workspace audit entry onto the dashboard audit shape. */
export function toAuditEntry(entry: WorkspaceAuditEntry): BusinessAuditEntry {
  return {
    id: entry.id,
    action: entry.action.replace(/[._]/g, ' '),
    actor: entry.actor,
    target: entry.resourceType,
    timestamp: entry.createdAt || new Date().toISOString(),
    severity: (entry.severity === 'critical'
      ? 'critical'
      : entry.severity === 'warning'
        ? 'warn'
        : 'info') as BusinessAuditEntry['severity'],
  };
}

/** Map a workspace queue item onto the dashboard queue shape. */
export function toQueueItem(item: Record<string, unknown>) {
  return {
    id: String(item.id || ''),
    to: String(item.to || ''),
    subject: String(item.subject || ''),
    status: String(item.status || 'queued'),
    queuedAt: String(item.queuedAt || ''),
    scheduledAt: item.nextRetryAt ? String(item.nextRetryAt) : undefined,
    retries: Number(item.retries || 0),
    error: item.error ? String(item.error) : undefined,
    from: String(item.from || ''),
  };
}

/** Map a workspace template onto the dashboard template shape. */
export function toTemplate(template: {
  id: string;
  name: string;
  subject: string;
  body: string;
  usageCount?: number;
  updatedAt?: string | null;
}): BusinessTemplate {
  return {
    id: template.id,
    name: template.name,
    subject: template.subject,
    body: template.body,
    usageCount: template.usageCount || 0,
    lastUsed: template.updatedAt || undefined,
  };
}
