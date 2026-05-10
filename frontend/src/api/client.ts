// VelisMail API Client — Fully local, no backend dependency
// Uses localStorage for session persistence

// VelisMail API Client
// Uses localStorage for client-side persistence alongside deployed API integrations.

import { getConnectionHostLabel } from '../config/providers';

// ---- Local Storage DB ----
const STORAGE_KEYS = {
  users: 'velismail_users',
  session: 'velismail_session',
  emails: 'velismail_emails',
  domains: 'velismail_domains',
  businessMailboxes: 'velismail_business_mailboxes',
  businessGroups: 'velismail_business_groups',
  businessTeam: 'velismail_business_team',
  businessTemplates: 'velismail_business_templates',
  businessQueue: 'velismail_business_queue',
  businessAudit: 'velismail_business_audit',
  contacts: 'velismail_contacts',
  theme: 'velismail_theme',
  signatures: 'velismail_signatures',
};

const TEAM_INVITES_KEY = 'velismail_team_access_invites';

const DURABLE_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.session,
  STORAGE_KEYS.theme,
  STORAGE_KEYS.users,
  STORAGE_KEYS.emails,
  STORAGE_KEYS.domains,
  STORAGE_KEYS.businessMailboxes,
  STORAGE_KEYS.businessGroups,
  STORAGE_KEYS.businessTeam,
  STORAGE_KEYS.businessTemplates,
  STORAGE_KEYS.businessQueue,
  STORAGE_KEYS.businessAudit,
  STORAGE_KEYS.contacts,
  STORAGE_KEYS.signatures,
  'velismail_token',
  'velismail_refresh',
  'velismail_users_db',
]);

// In-memory store for session-only caching (satisfies private DB policy: no local disk persistence)
const memoryDB: Record<string, unknown> = {};

function loadDB<T>(key: string, fallback: T): T {
  if (DURABLE_STORAGE_KEYS.has(key) || key.startsWith(`${STORAGE_KEYS.emails}_`) || key.startsWith(`${STORAGE_KEYS.domains}_`) || key.startsWith(`${STORAGE_KEYS.businessMailboxes}_`) || key.startsWith(`${STORAGE_KEYS.businessGroups}_`) || key.startsWith(`${STORAGE_KEYS.businessTeam}_`) || key.startsWith(`${STORAGE_KEYS.businessTemplates}_`) || key.startsWith(`${STORAGE_KEYS.businessQueue}_`) || key.startsWith(`${STORAGE_KEYS.businessAudit}_`) || key.startsWith(`${STORAGE_KEYS.contacts}_`) || key.startsWith(`${STORAGE_KEYS.signatures}_`)) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch { return fallback; }
  }
  // For other keys, use pure memory cache (stateless on refresh, API-reliant)
  return memoryDB[key] !== undefined ? memoryDB[key] as T : fallback;
}

function saveDB<T>(key: string, data: T) {
  if (DURABLE_STORAGE_KEYS.has(key) || key.startsWith(`${STORAGE_KEYS.emails}_`) || key.startsWith(`${STORAGE_KEYS.domains}_`) || key.startsWith(`${STORAGE_KEYS.businessMailboxes}_`) || key.startsWith(`${STORAGE_KEYS.businessGroups}_`) || key.startsWith(`${STORAGE_KEYS.businessTeam}_`) || key.startsWith(`${STORAGE_KEYS.businessTemplates}_`) || key.startsWith(`${STORAGE_KEYS.businessQueue}_`) || key.startsWith(`${STORAGE_KEYS.businessAudit}_`) || key.startsWith(`${STORAGE_KEYS.contacts}_`) || key.startsWith(`${STORAGE_KEYS.signatures}_`)) {
    localStorage.setItem(key, JSON.stringify(data));
  } else {
    // Save to memory cache only
    memoryDB[key] = data;
  }
}

// ---- Types ----
export type User = {
  id: string;
  tenantId?: string;
  email: string;
  displayName: string;
  plan: string;
  status?: 'active' | 'suspended' | 'deactivated';
  suspendedAt?: string;
  suspensionReason?: string;
  planStartedAt?: string;
  paidPlanPurchasedAt?: string;
  billingCycle?: 'monthly' | 'annual';
  lastPlanChangeAt?: string;
  accountType: 'business';
  customDomain?: string;
  mailProvider?: string;
  mailProviderEndpoint?: string;
  apiKey?: string;
  isSetupComplete: boolean;
  customDbUrl?: string;
  createdAt: string;
  recoveryEmail?: string;
  recoveryEmailVerified?: boolean;
  pendingRecoveryEmail?: string;
  businessMailboxAddress?: string;
  // Profile image URL (data URL or hosted URL)
  profileImageUrl?: string;
  // Business Mail fields
  isBusinessSetupComplete?: boolean;
  businessDomain?: string;
  businessDbUrl?: string;
  businessApiKey?: string;
  businessMailProvider?: string;
  businessMailProviderEndpoint?: string;
  businessDomainVerified?: boolean;
  teamAccessRole?: 'admin' | 'member' | 'viewer';
  teamAccessInviteId?: string;
  teamAccessOwnerEmail?: string;
  dkimStatus?: 'pending' | 'verified' | 'failed';
  spfStatus?: 'pending' | 'verified' | 'failed';
  dmarcStatus?: 'pending' | 'verified' | 'failed';
  // New structured profile for business-specific configuration (optional)
  businessProfile?: {
    domain?: string;
    dbUrl?: string;
    apiKey?: string;
    mailProvider?: string;
    mailProviderEndpoint?: string;
    verified?: boolean;
    dkimStatus?: 'pending' | 'verified' | 'failed';
    spfStatus?: 'pending' | 'verified' | 'failed';
    dmarcStatus?: 'pending' | 'verified' | 'failed';
  };
};

export type Contact = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  group: string;
  notes?: string;
  favorite: boolean;
  createdAt: string;
};

export type Signature = {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
};

export type DomainCheckStatus = 'pending' | 'verified' | 'failed';

export type DnsRecord = {
  type: 'TXT' | 'MX' | 'CNAME';
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
};

export type DomainCheck = {
  key: 'txt' | 'mx' | 'spf' | 'dkim' | 'dmarc';
  label: string;
  status: DomainCheckStatus;
  expected: string;
  actual?: string;
};

export type CustomDomain = {
  id: string;
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  verificationToken: string;
  dnsRecords: DnsRecord[];
  checks: DomainCheck[];
  addedAt: string;
  lastCheckedAt?: string;
  verifiedAt?: string;
};

export type BusinessMailbox = {
  id: string;
  domain: string;
  address: string;
  displayName: string;
  kind: 'primary' | 'mailbox' | 'alias' | 'shared';
  aliases: string[];
  active: boolean;
  source: 'system' | 'custom';
  createdAt: string;
  lastUsedAt?: string;
};

export type BusinessGroup = {
  id: string;
  domain: string;
  name: string;
  address: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
};

export type BusinessTeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  status?: 'pending' | 'active' | 'expired' | 'revoked';
  inviteToken?: string;
  inviteExpiresAt?: string | null;
  addedAt: string;
  lastActive: string;
};

export type TeamAccessInvite = {
  id: string;
  token: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string | null;
  acceptedAt?: string;
  issuerEmail: string;
  workspace: Pick<User,
    'tenantId' |
    'displayName' |
    'businessDomain' |
    'businessDbUrl' |
    'businessApiKey' |
    'businessMailProvider' |
    'businessMailProviderEndpoint' |
    'businessMailboxAddress' |
    'businessDomainVerified' |
    'businessProfile' |
    'isBusinessSetupComplete'
  >;
};

export type BusinessTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  lastUsed?: string;
  usageCount: number;
};

export type BusinessMailQueueItem = {
  id: string;
  domain: string;
  fromAddress: string;
  to: string;
  recipients: string[];
  subject: string;
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'deferred';
  queuedAt: string;
  updatedAt: string;
  retryCount: number;
  error?: string;
  scheduledAt?: string;
};

export type BusinessAuditEntry = {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  severity: 'info' | 'warn' | 'critical';
};

export type ActiveSession = {
  id: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent?: string | null;
  createdAt: string;
  expiresAt: string;
  lastActive: string;
  mfaVerified: boolean;
  current: boolean;
};

export type ConnectionUsage = {
  id: string;
  type: 'database' | 'mail-provider';
  fingerprint: string;
  label: string;
  maskedValue: string;
  provider?: string;
  ownerAccountId: string;
  ownerDisplayName: string;
  ownerEmail: string;
  accountType: 'personal' | 'business';
  domain?: string;
  mailbox?: string;
  createdAt: string;
};

export type PlatformAdminUserRecord = {
  user: User;
  status: 'active' | 'suspended' | 'deactivated';
  domain: string;
  plan: string;
  billingCycle: 'monthly' | 'annual';
  paidPlanPurchasedAt?: string;
  planStartedAt?: string;
  lastPlanChangeAt?: string;
  createdAt: string;
  lastActiveAt?: string;
  emailCount: number;
  domainCount: number;
  mailboxCount: number;
  queueCount: number;
  templateCount: number;
  teamMemberCount: number;
  auditCount: number;
  storageEstimateBytes: number;
  risk: 'low' | 'medium' | 'high';
};

export type Email = {
  id: string;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
  folder: string;
  unread: boolean;
  starred: boolean;
  labels: string[];
  hasAttachment: boolean;
  scheduledAt?: string;
};

export type OtpSendResponse = {
  success: boolean;
  challengeToken: string;
  expiresIn: number;
  maskedEmail: string;
  provider: string;
  messageId?: string | null;
};

export type OtpVerifyResponse = {
  success: boolean;
  verificationToken: string;
  expiresIn: number;
};

// ---- Seed Data ----
// Mailboxes start empty; registration and mail sync create real records.
const SEED_EMAILS: Email[] = [];


function normalizeConfiguredApiUrl(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.replace(/\.+$/, '');
    url.pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\.+$/, '');
  }
}

function expandApiBaseCandidates(input: string): string[] {
  const configured = normalizeConfiguredApiUrl(input);
  if (!configured) {
    return [];
  }

  const candidates: string[] = [];
  const pushCandidate = (value: string) => {
    const normalized = normalizeConfiguredApiUrl(value);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (configured.endsWith('/api/v1')) {
    pushCandidate(configured);
  } else if (configured.endsWith('/api')) {
    pushCandidate(`${configured}/v1`);
  } else if (configured.endsWith('/v1')) {
    pushCandidate(configured.replace(/\/v1$/, '/api/v1'));
  } else {
    pushCandidate(`${configured}/api/v1`);
  }

  return candidates;
}

function inferRuntimeApiOrigins(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const { hostname, origin } = window.location;
  const runtimeOrigins: string[] = [];
  const pushOrigin = (value: string) => {
    const normalized = normalizeConfiguredApiUrl(value);
    if (normalized && !runtimeOrigins.includes(normalized)) {
      runtimeOrigins.push(normalized);
    }
  };

  if (!hostname) {
    return runtimeOrigins;
  }

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    pushOrigin('http://127.0.0.1:3000');
    pushOrigin('http://localhost:3000');
  }

  if (hostname === 'api.velismail.online') {
    pushOrigin(origin);
  }

  if (
    hostname === 'velismail.online' ||
    hostname.endsWith('.velismail.online') ||
    hostname.endsWith('.pages.dev')
  ) {
    pushOrigin('https://api.velismail.online');
  }

  return runtimeOrigins;
}

export function getApiBaseCandidates(): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value: string) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  const configuredOrigins = [
    String(import.meta.env.VITE_API_URL || ''),
    ...inferRuntimeApiOrigins(),
  ];

  configuredOrigins.forEach((origin) => {
    expandApiBaseCandidates(origin).forEach(pushCandidate);
  });

  return candidates;
}

export function getPrimaryApiBase(): string {
  return getApiBaseCandidates()[0] || '';
}

export type ApiJsonDetailedResult<T = unknown> = {
  ok: boolean;
  status: number;
  baseUrl: string;
  data: T | null;
  rawText: string;
};

function friendlyApiError(endpoint: string, status: number, fallback: string): string {
  const route = endpoint.toLowerCase();
  if (status === 401) {
    if (route.includes('/auth/login')) {
      return 'Invalid workspace email/domain or password.';
    }
    if (route.includes('/auth/verify-otp')) {
      return 'Verification code expired or invalid. Request a new OTP and try again.';
    }
    if (route.includes('/auth/register')) {
      return 'Email verification expired. Request a new OTP before completing registration.';
    }
    return 'Your session is not authorized. Sign in again.';
  }
  if (status === 409) {
    if (route.includes('/auth/register')) {
      return 'This business mailbox or recovery email already has an account. Sign in, or reset the password if you own it.';
    }
    return 'This record already exists.';
  }
  if (status === 404) {
    if (route.includes('/auth/send-otp') || route.includes('/auth/otp/send') || route.includes('/auth/password-reset/request')) {
      return 'OTP service is not yet available. The backend auth service may still be deploying, or the OTP routes have not been configured. Please try again in a few minutes or contact support@velismail.online.';
    }
    return fallback || 'Requested VelisMail service route was not found on the backend.';
  }
  if (status === 429) {
    if (route.includes('/auth/send-otp') || route.includes('/auth/otp/send') || route.includes('/auth/password-reset/request')) {
      return 'Daily OTP limit reached. You can request up to 3 verification codes per email per day.';
    }
    return 'Too many attempts. Wait a moment and try again.';
  }
  if (status >= 500) {
    return 'VelisMail backend is temporarily unavailable. Retry after the service recovers.';
  }
  return fallback || `API Error ${status}`;
}

export async function fetchApiResponse(endpoint: string, options: RequestInit = {}) {
  const apiBaseCandidates = getApiBaseCandidates();

  if (apiBaseCandidates.length === 0) {
    throw new Error('Unable to resolve the VelisMail API URL. Set VITE_API_URL or open the app from velismail.online so the frontend can auto-detect api.velismail.online.');
  }

  const token = localStorage.getItem('velismail_token');
  const headers = new Headers(options.headers || {});

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let lastError: Error | null = null;

  for (let index = 0; index < apiBaseCandidates.length; index += 1) {
    const baseUrl = apiBaseCandidates[index];
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed.');
      continue;
    }

    if (response.ok) {
      return response;
    }

    const errorBody = await response.text();
    let errorMessage = `API Error ${response.status}`;
    try {
      const jsonError = JSON.parse(errorBody);
      const checkDetails = Array.isArray(jsonError.checks)
        ? jsonError.checks
            .filter((check: { status?: string }) => check?.status && check.status !== 'verified')
            .map((check: { label?: string; detail?: string; status?: string }) => {
              const label = check.label || 'Runtime check';
              const detail = check.detail || check.status || 'failed';
              return `${label}: ${detail}`;
            })
        : [];
      const prefix = jsonError.errorType ? `[${jsonError.errorType}] ` : '';
      errorMessage = `${prefix}${jsonError.message || errorMessage}${checkDetails.length ? ` ${checkDetails.join(' ')}` : ''}`;
    } catch {
      errorMessage = errorBody || errorMessage;
    }
    errorMessage = friendlyApiError(endpoint, response.status, errorMessage);

    if (response.status === 404 && index < apiBaseCandidates.length - 1) {
      lastError = new Error(errorMessage);
      continue;
    }

    throw new Error(errorMessage);
  }

  throw lastError || new Error('Unable to reach the VelisMail API.');
}

export async function fetchApiJsonDetailed<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<ApiJsonDetailedResult<T>> {
  const apiBaseCandidates = getApiBaseCandidates();

  if (apiBaseCandidates.length === 0) {
    throw new Error('Unable to resolve the VelisMail API URL. Set VITE_API_URL or open the app from velismail.online so the frontend can auto-detect api.velismail.online.');
  }

  const token = localStorage.getItem('velismail_token');
  const headers = new Headers(options.headers || {});

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let lastError: Error | null = null;

  for (let index = 0; index < apiBaseCandidates.length; index += 1) {
    const baseUrl = apiBaseCandidates[index];
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed.');
      continue;
    }

    const rawText = await response.text();
    let data: T | null = null;

    if (rawText.trim()) {
      try {
        data = JSON.parse(rawText) as T;
      } catch {
        const compactBody = rawText.replace(/\s+/g, ' ').trim();
        const preview = compactBody.slice(0, 180);
        throw new Error(
          preview
            ? `The VelisMail API returned an invalid JSON response: ${preview}`
            : 'The VelisMail API returned an invalid JSON response.',
        );
      }
    }

    if (response.status === 404 && index < apiBaseCandidates.length - 1) {
      lastError = new Error(friendlyApiError(endpoint, response.status, `API Error ${response.status}`));
      continue;
    }

    return {
      ok: response.ok,
      status: response.status,
      baseUrl,
      data,
      rawText,
    };
  }

  throw lastError || new Error('Unable to reach the VelisMail API.');
}

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const response = await fetchApiResponse(endpoint, options);
  const rawBody = await response.text();

  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    const compactBody = rawBody.replace(/\s+/g, ' ').trim();
    const preview = compactBody.slice(0, 180);
    throw new Error(
      preview
        ? `The VelisMail API returned an invalid JSON response: ${preview}`
        : 'The VelisMail API returned an invalid JSON response.',
    );
  }
}

export function getApiAvailabilityHint(): string {
  const primaryBase = getPrimaryApiBase();
  if (primaryBase) {
    return `Using API gateway ${primaryBase}.`;
  }

  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.pages.dev')) {
    return 'Pages preview detected. The frontend will target https://api.velismail.online automatically once the backend is reachable.';
  }

  return 'Set VITE_API_URL to your deployed gateway URL if automatic detection cannot determine the VelisMail API endpoint.';
}

// ---- Initialize DB ----
function getSessionSafe(): User | null {
  try {
    return loadDB<User | null>(STORAGE_KEYS.session, null);
  } catch {
    return null;
  }
}

function userScopedKey(key: string): string {
  const s = getSessionSafe();
  return s && s.id ? `${key}_${s.id}` : key;
}

function loadUserDB<T>(key: string, fallback: T): T {
  return loadDB<T>(userScopedKey(key), fallback);
}

function saveUserDB<T>(key: string, data: T) {
  saveDB(userScopedKey(key), data);
}

function loadTeamAccessInvites(): TeamAccessInvite[] {
  try {
    const raw = localStorage.getItem(TEAM_INVITES_KEY) || sessionStorage.getItem(TEAM_INVITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTeamAccessInvites(invites: TeamAccessInvite[]) {
  localStorage.setItem(TEAM_INVITES_KEY, JSON.stringify(invites));
  sessionStorage.setItem(TEAM_INVITES_KEY, JSON.stringify(invites));
}

function generateTeamAccessToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `vmt_${encoded}`;
}

type TeamAccessApiResponse = {
  success?: boolean;
  invite?: TeamAccessInvite;
  message?: string;
  error?: string;
};

type CreateTeamAccessInviteParams = {
  issuer: User;
  email: string;
  name: string;
  role: BusinessTeamMember['role'];
  expiresInHours: number;
};

function buildTeamAccessInvite(params: CreateTeamAccessInviteParams): TeamAccessInvite {
  const email = normalizeMailbox(params.email);
  const now = new Date();
  const expiresAt = params.expiresInHours <= 0
    ? null
    : new Date(now.getTime() + Math.max(params.expiresInHours, 1) * 60 * 60 * 1000).toISOString();
  return {
    id: crypto.randomUUID(),
    token: generateTeamAccessToken(),
    email,
    name: params.name.trim() || email.split('@')[0],
    role: params.role,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt,
    issuerEmail: params.issuer.email,
    workspace: {
      tenantId: params.issuer.tenantId,
      displayName: params.issuer.displayName,
      businessDomain: params.issuer.businessDomain,
      businessDbUrl: params.issuer.businessDbUrl,
      businessApiKey: params.issuer.businessApiKey,
      businessMailProvider: params.issuer.businessMailProvider,
      businessMailProviderEndpoint: params.issuer.businessMailProviderEndpoint,
      businessMailboxAddress: params.issuer.businessMailboxAddress,
      businessDomainVerified: params.issuer.businessDomainVerified,
      businessProfile: params.issuer.businessProfile,
      isBusinessSetupComplete: params.issuer.isBusinessSetupComplete,
    },
  };
}

function cacheTeamAccessInvite(invite: TeamAccessInvite) {
  const next = [
    invite,
    ...loadTeamAccessInvites().filter((entry) => entry.token !== invite.token && entry.email !== invite.email),
  ];
  saveTeamAccessInvites(next);
}

function hasTeamAccessWorkspace(invite?: TeamAccessInvite): invite is TeamAccessInvite {
  return Boolean(invite?.workspace?.businessDbUrl && invite.workspace.businessApiKey && invite.workspace.businessMailProvider);
}

function validateCachedTeamAccessToken(token: string): { ok: boolean; invite?: TeamAccessInvite; error?: string } {
  const normalized = token.trim();
  const invites = loadTeamAccessInvites();
  const invite = invites.find((entry) => entry.token === normalized);
  if (!invite) {
    return { ok: false, error: 'Invalid team access key.' };
  }
  if (invite.status === 'revoked') {
    return { ok: false, error: 'This team access key was revoked.' };
  }
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
    invite.status = 'expired';
    saveTeamAccessInvites(invites);
    return { ok: false, error: 'This team access key has expired.' };
  }
  return { ok: true, invite };
}

async function postTeamAccess(endpoint: string, body: unknown): Promise<{
  ok: boolean;
  status: number;
  data: TeamAccessApiResponse | null;
} | null> {
  try {
    const response = await fetchApiJsonDetailed<TeamAccessApiResponse>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      data: response.data,
    };
  } catch {
    return null;
  }
}

function teamAccessApiError(response: TeamAccessApiResponse | null, fallback: string): string {
  return response?.message || response?.error || fallback;
}

function warnBackendSyncFailure(err: unknown) {
  if (err instanceof Error && err.message.includes('route was not found')) return;
  console.warn('VelisMail backend sync failed:', err);
}

function saveUserToPersistentStore(user: User) {
  const users = loadDB<Record<string, User>>('velismail_users_db', {});
  users[user.email] = user;
  saveDB('velismail_users_db', users);
}

function loadPersistentUsers(): Record<string, User> {
  return loadDB<Record<string, User>>('velismail_users_db', {});
}

function savePersistentUsers(users: Record<string, User>) {
  saveDB('velismail_users_db', users);
}

function getUserFromPersistentStore(email: string): User | null {
  const users = loadDB<Record<string, User>>('velismail_users_db', {});
  return users[normalizeMailbox(email)] || null;
}

function initEmails(): Email[] {
  return loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
}

let emailsCache = initEmails();

function reloadAccountCaches() {
  emailsCache = initEmails();
}

function normalizeDomainInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^mail\./, '')
    .replace(/\/.*$/, '');
}

function normalizeLocalPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]/g, '');
}



function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeMailbox(value: string): string {
  return normalizeEmail(value);
}







function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function maskApiSecret(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'Not configured';
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function maskDatabaseSecret(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'Not configured';
  const protocol = trimmed.split('://')[0] || 'db';
  return `${protocol}://${getConnectionHostLabel(trimmed)}`;
}

function normalizeBusinessMailboxEntry(entry: Partial<BusinessMailbox>, domain: string): BusinessMailbox {
  const normalizedDomain = normalizeDomainInput(domain);
  const address = normalizeMailbox(entry.address || `admin@${normalizedDomain}`);
  return {
    id: entry.id || `mbx_${Math.random().toString(36).slice(2, 10)}`,
    domain: normalizedDomain,
    address,
    displayName: entry.displayName?.trim() || address.split('@')[0],
    kind: entry.kind || 'mailbox',
    aliases: Array.isArray(entry.aliases) ? entry.aliases.map((alias) => normalizeMailbox(alias)).filter(Boolean) : [],
    active: entry.active !== false,
    source: entry.source || 'custom',
    createdAt: entry.createdAt || new Date().toISOString(),
    lastUsedAt: entry.lastUsedAt,
  };
}

function normalizeBusinessGroupEntry(entry: Partial<BusinessGroup>, domain: string): BusinessGroup {
  const normalizedDomain = normalizeDomainInput(domain);
  const address = normalizeMailbox(entry.address || `team@${normalizedDomain}`);
  return {
    id: entry.id || `grp_${Math.random().toString(36).slice(2, 10)}`,
    domain: normalizedDomain,
    name: entry.name?.trim() || address.split('@')[0],
    address,
    members: Array.isArray(entry.members) ? entry.members.map((member) => normalizeMailbox(member)).filter(Boolean) : [],
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
}

function getSystemBusinessMailbox(domain: string): BusinessMailbox {
  const session = auth.getSession();
  const normalizedDomain = normalizeDomainInput(domain);
  const preferredAddress = normalizeMailbox(
    session?.businessMailboxAddress && session.businessMailboxAddress.endsWith(`@${normalizedDomain}`)
      ? session.businessMailboxAddress
      : `admin@${normalizedDomain}`,
  );
  return {
    id: `sys_${hashString(normalizedDomain)}`,
    domain: normalizedDomain,
    address: preferredAddress,
    displayName: session?.displayName?.trim() || 'Administrator',
    kind: 'primary',
    aliases: [],
    active: true,
    source: 'system',
    createdAt: session?.createdAt || new Date().toISOString(),
    lastUsedAt: undefined,
  };
}

function loadBusinessMailboxes(domain?: string): BusinessMailbox[] {
  const stored = loadUserDB<BusinessMailbox[]>(STORAGE_KEYS.businessMailboxes, []);
  const normalizedDomain = normalizeDomainInput(domain || '');
  const normalized = stored
    .map((entry) => normalizeBusinessMailboxEntry(entry, entry.domain || normalizedDomain))
    .filter((entry) => entry.domain);

  // Deduplicate by address first to prevent stale duplicates
  const deduped = Array.from(new Map(normalized.map(m => [m.address, m])).values());

  const byDomain = normalizedDomain
    ? deduped.filter((entry) => entry.domain === normalizedDomain)
    : deduped;

  if (!normalizedDomain) {
    return deduped;
  }

  const systemMailbox = getSystemBusinessMailbox(normalizedDomain);
  const existingPrimaryIndex = byDomain.findIndex((entry) => entry.kind === 'primary' || entry.address === systemMailbox.address);
  const domainEntries = byDomain.length > 0 ? [...byDomain] : [systemMailbox];

  if (existingPrimaryIndex === -1 && !domainEntries.some(e => e.address === systemMailbox.address)) {
    domainEntries.unshift(systemMailbox);
  } else if (existingPrimaryIndex >= 0) {
    domainEntries[existingPrimaryIndex] = {
      ...domainEntries[existingPrimaryIndex],
      ...systemMailbox,
      source: domainEntries[existingPrimaryIndex].source,
      aliases: domainEntries[existingPrimaryIndex].aliases,
      lastUsedAt: domainEntries[existingPrimaryIndex].lastUsedAt,
    };
  }

  const activeExists = domainEntries.some((entry) => entry.active);
  const normalizedActiveEntries = domainEntries.map((entry, index) => ({
    ...entry,
    kind: index === 0 ? 'primary' as const : entry.kind,
    active: activeExists ? entry.active : index === 0,
  }));

  // Final dedup before saving
  const finalEntries = Array.from(new Map(normalizedActiveEntries.map(m => [m.address, m])).values());

  const untouched = deduped.filter((entry) => entry.domain !== normalizedDomain);
  saveUserDB(STORAGE_KEYS.businessMailboxes, [...untouched, ...finalEntries]);
  return finalEntries;
}

function saveBusinessMailboxes(domain: string, entries: BusinessMailbox[]) {
  const normalizedDomain = normalizeDomainInput(domain);
  const untouched = loadUserDB<BusinessMailbox[]>(STORAGE_KEYS.businessMailboxes, [])
    .filter((entry) => normalizeDomainInput(entry.domain) !== normalizedDomain);
  const normalizedEntries = entries.map((entry, index) => ({
    ...normalizeBusinessMailboxEntry(entry, normalizedDomain),
    kind: index === 0 ? 'primary' as const : entry.kind,
    active: entries.some((candidate) => candidate.active) ? entry.active : index === 0,
  }));
  saveUserDB(STORAGE_KEYS.businessMailboxes, [...untouched, ...normalizedEntries]);
}

function loadBusinessGroups(domain?: string): BusinessGroup[] {
  const stored = loadUserDB<BusinessGroup[]>(STORAGE_KEYS.businessGroups, []);
  const normalizedDomain = normalizeDomainInput(domain || '');
  return stored
    .map((entry) => normalizeBusinessGroupEntry(entry, entry.domain || normalizedDomain))
    .filter((entry) => !normalizedDomain || entry.domain === normalizedDomain);
}

function saveBusinessGroups(domain: string, entries: BusinessGroup[]) {
  const normalizedDomain = normalizeDomainInput(domain);
  const untouched = loadUserDB<BusinessGroup[]>(STORAGE_KEYS.businessGroups, [])
    .filter((entry) => normalizeDomainInput(entry.domain) !== normalizedDomain);
  const normalizedEntries = entries.map((entry) => normalizeBusinessGroupEntry(entry, normalizedDomain));
  saveUserDB(STORAGE_KEYS.businessGroups, [...untouched, ...normalizedEntries]);
}

function loadBusinessTeamMembers(): BusinessTeamMember[] {
  return loadUserDB<BusinessTeamMember[]>(STORAGE_KEYS.businessTeam, []);
}

function saveBusinessTeamMembers(entries: BusinessTeamMember[]) {
  saveUserDB(STORAGE_KEYS.businessTeam, entries);
}

function loadBusinessTemplates(): BusinessTemplate[] {
  return loadUserDB<BusinessTemplate[]>(STORAGE_KEYS.businessTemplates, []);
}

function saveBusinessTemplates(entries: BusinessTemplate[]) {
  saveUserDB(STORAGE_KEYS.businessTemplates, entries);
}

function normalizeBusinessQueueEntry(entry: Partial<BusinessMailQueueItem>): BusinessMailQueueItem {
  const now = new Date().toISOString();
  const recipients = Array.isArray(entry.recipients)
    ? entry.recipients.map((recipient) => normalizeMailbox(recipient)).filter(Boolean)
    : String(entry.to || '').split(',').map((recipient) => normalizeMailbox(recipient)).filter(Boolean);
  return {
    id: entry.id || `queue_${Math.random().toString(36).slice(2, 10)}`,
    domain: normalizeDomainInput(entry.domain || ''),
    fromAddress: normalizeMailbox(entry.fromAddress || ''),
    to: recipients.join(', '),
    recipients,
    subject: String(entry.subject || '').trim(),
    body: String(entry.body || ''),
    status: entry.status || 'queued',
    queuedAt: entry.queuedAt || now,
    updatedAt: entry.updatedAt || now,
    retryCount: Number(entry.retryCount || 0),
    error: entry.error,
    scheduledAt: entry.scheduledAt,
  };
}

function loadBusinessQueue(domain?: string): BusinessMailQueueItem[] {
  const normalizedDomain = normalizeDomainInput(domain || '');
  return loadUserDB<BusinessMailQueueItem[]>(STORAGE_KEYS.businessQueue, [])
    .map(normalizeBusinessQueueEntry)
    .filter((entry) => !normalizedDomain || entry.domain === normalizedDomain)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function saveBusinessQueue(entries: BusinessMailQueueItem[]) {
  saveUserDB(STORAGE_KEYS.businessQueue, entries.map(normalizeBusinessQueueEntry));
}

function loadBusinessAuditEntries(): BusinessAuditEntry[] {
  return loadUserDB<BusinessAuditEntry[]>(STORAGE_KEYS.businessAudit, []);
}

function saveBusinessAuditEntries(entries: BusinessAuditEntry[]) {
  saveUserDB(STORAGE_KEYS.businessAudit, entries);
}

function buildConnectionUsage(type: 'database' | 'mail-provider', user: User, value: string, provider?: string): ConnectionUsage {
  const normalizedValue = String(value || '').trim();
  const fingerprintSource = `${type}:${provider || ''}:${normalizedValue.toLowerCase()}`;
  return {
    id: `${type}_${hashString(`${user.id}:${fingerprintSource}`)}`,
    type,
    fingerprint: hashString(fingerprintSource),
    label: type === 'database' ? 'Database connection' : 'Mail provider secret',
    maskedValue: type === 'database' ? maskDatabaseSecret(normalizedValue) : maskApiSecret(normalizedValue),
    provider,
    ownerAccountId: user.id,
    ownerDisplayName: user.displayName,
    ownerEmail: user.email,
    accountType: user.accountType,
    domain: user.businessDomain,
    mailbox: user.businessMailboxAddress || user.email,
    createdAt: user.createdAt,
  };
}



function buildDnsRecords(domain: string, verificationToken: string): DnsRecord[] {
  return [
    { type: 'TXT', name: `_velismail-verify.${domain}`, value: verificationToken, ttl: 300 },
    { type: 'MX', name: domain, value: 'mx1.velismail.online', priority: 10, ttl: 3600 },
    { type: 'MX', name: domain, value: 'mx2.velismail.online', priority: 20, ttl: 3600 },
    { type: 'TXT', name: domain, value: 'v=spf1 include:velismail.online ~all', ttl: 3600 },
    { type: 'CNAME', name: `velismail._domainkey.${domain}`, value: 'dkim.velismail.online', ttl: 3600 },
    { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, ttl: 3600 },
  ];
}

function buildDomainChecks(domain: string, verificationToken: string): DomainCheck[] {
  return [
    { key: 'txt', label: 'Ownership TXT', status: 'pending', expected: verificationToken },
    { key: 'mx', label: 'Inbound MX', status: 'pending', expected: 'mx1.velismail.online / mx2.velismail.online' },
    { key: 'spf', label: 'SPF', status: 'pending', expected: 'v=spf1 include:velismail.online ~all' },
    { key: 'dkim', label: 'DKIM', status: 'pending', expected: `velismail._domainkey.${domain}` },
    { key: 'dmarc', label: 'DMARC', status: 'pending', expected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}` },
  ];
}

function normalizeStoredDomain(domain: Partial<CustomDomain> & { id: string; domain: string; status?: 'pending' | 'verified' | 'failed' }): CustomDomain {
  const normalizedDomain = normalizeDomainInput(domain.domain);
  const verificationToken = domain.verificationToken || 'velismail-verify=' + Math.random().toString(36).slice(2, 14);
  const fallbackChecks = buildDomainChecks(normalizedDomain, verificationToken);
  const checks = Array.isArray(domain.checks) && domain.checks.length > 0 ? domain.checks : fallbackChecks;
  const dnsRecords = Array.isArray(domain.dnsRecords) && domain.dnsRecords.length > 0
    ? domain.dnsRecords
    : buildDnsRecords(normalizedDomain, verificationToken);

  return {
    id: domain.id,
    domain: normalizedDomain,
    status: domain.status || 'pending',
    verificationToken,
    dnsRecords,
    checks,
    addedAt: domain.addedAt || new Date().toISOString(),
    lastCheckedAt: domain.lastCheckedAt,
    verifiedAt: domain.verifiedAt,
  };
}

function sessionHasMismatch(session: User | null): boolean {
  if (!session) return false;
  if (session.teamAccessRole) return false;
  if (session.accountType === 'business') {
    // Only check mismatch if user has completed business setup.
    // New users or users mid-setup won't have domains stored yet — that's NOT a mismatch.
    if (!session.isBusinessSetupComplete) {
      return false;
    }
    const allDomains = loadUserDB<CustomDomain[]>(STORAGE_KEYS.domains, []);
    // If domains list is empty, the user may have cleared storage or is starting fresh — not a mismatch
    if (allDomains.length === 0) {
      return false;
    }
    const businessDomain = session.businessDomain;
    const profileDomain = session.businessProfile?.domain;
    if (businessDomain && !allDomains.find(d => normalizeDomainInput(d.domain) === normalizeDomainInput(businessDomain))) {
      return true;
    }
    if (profileDomain && !allDomains.find(d => normalizeDomainInput(d.domain) === normalizeDomainInput(profileDomain))) {
      return true;
    }
    if ((session.businessDomainVerified || session.businessProfile?.verified) && businessDomain) {
      const dom = allDomains.find(d => normalizeDomainInput(d.domain) === normalizeDomainInput(businessDomain));
      if (dom && dom.status !== 'verified') return true;
    }
  }
  return false;
}

function normalizeSessionUser(session: User): User {
  // Normalize any legacy fields or fix data inconsistencies
  const normalized = { ...session };
  // Ensure accountType is always present
  if (!normalized.accountType) {
    normalized.accountType = 'business';
  }
  if (!normalized.status) {
    normalized.status = 'active';
  }
  if (!normalized.billingCycle) {
    normalized.billingCycle = 'monthly';
  }
  if (!normalized.planStartedAt) {
    normalized.planStartedAt = normalized.createdAt || new Date().toISOString();
  }
  return normalized;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1] || '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

async function fetchAuthenticatedProfile(): Promise<Partial<User>> {
  try {
    const profile = await fetchAPI('/auth/me');
    const raw = profile?.user || profile || {};
    const settings = raw.settings || {};
    return {
      id: raw.id,
      tenantId: raw.tenant_id || raw.tenantId,
      email: raw.email,
      displayName: raw.display_name || raw.displayName,
      recoveryEmail: raw.recovery_email || raw.recoveryEmail || undefined,
      recoveryEmailVerified: Boolean(raw.recovery_email || raw.recoveryEmail),
      createdAt: raw.created_at || raw.createdAt,
      // Pull configuration from server settings JSON object to avoid re-verification
      businessDbUrl: settings.businessDbUrl || settings.business_db_url || raw.business_db_url || raw.businessDbUrl,
      businessApiKey: settings.businessApiKey || settings.business_api_key || raw.business_api_key || raw.businessApiKey,
      businessMailProvider: settings.businessMailProvider || settings.business_mail_provider || raw.business_mail_provider || raw.businessMailProvider,
      businessMailProviderEndpoint: settings.businessMailProviderEndpoint || settings.business_mail_provider_endpoint || raw.business_mail_provider_endpoint || raw.businessMailProviderEndpoint,
      businessDomain: settings.businessDomain || settings.business_domain || raw.business_domain || raw.businessDomain,
      isBusinessSetupComplete: settings.isBusinessSetupComplete ?? settings.is_business_setup_complete ?? raw.is_business_setup_complete ?? raw.isBusinessSetupComplete,
      businessDomainVerified: settings.businessDomainVerified ?? settings.business_domain_verified ?? raw.business_domain_verified ?? raw.businessDomainVerified,
      businessProfile: settings.businessProfile || settings.business_profile || raw.business_profile || raw.businessProfile,
    };
  } catch {
    return {};
  }
}

function buildSessionUser(params: {
  token: string;
  email: string;
  displayName?: string;
  recoveryEmail?: string;
  customDomain?: string;
  existing?: User | null;
  profile?: Partial<User>;
}): User {
  const tokenPayload = decodeJwtPayload(params.token);
  const profile = params.profile || {};
  const tokenEmail = stringFromRecord(tokenPayload, 'email');
  const tokenSubject = stringFromRecord(tokenPayload, 'sub');
  const tokenTenantId = stringFromRecord(tokenPayload, 'tenant_id');
  const email = normalizeMailbox(profile.email || tokenEmail || params.email);
  const domain = normalizeDomainInput(params.customDomain || email.split('@')[1] || params.existing?.businessDomain || '');
  const businessMailboxAddress = domain ? `admin@${domain}` : email;

  return normalizeSessionUser({
    ...params.existing,
    ...profile,
    id: String(profile.id || tokenSubject || params.existing?.id || `usr_${hashString(email)}`),
    tenantId: String(profile.tenantId || tokenTenantId || params.existing?.tenantId || ''),
    email,
    displayName: String(profile.displayName || params.displayName || params.existing?.displayName || email.split('@')[0] || 'Business User'),
    plan: params.existing?.plan || 'Starter',
    status: params.existing?.status || 'active',
    suspendedAt: params.existing?.suspendedAt,
    suspensionReason: params.existing?.suspensionReason,
    billingCycle: params.existing?.billingCycle || 'monthly',
    paidPlanPurchasedAt: params.existing?.paidPlanPurchasedAt,
    planStartedAt: params.existing?.planStartedAt || params.existing?.createdAt || new Date().toISOString(),
    lastPlanChangeAt: params.existing?.lastPlanChangeAt,
    accountType: 'business',
    customDomain: params.customDomain || params.existing?.customDomain,
    recoveryEmail: profile.recoveryEmail || params.recoveryEmail || params.existing?.recoveryEmail,
    recoveryEmailVerified: profile.recoveryEmailVerified ?? params.existing?.recoveryEmailVerified,
    isSetupComplete: profile.isSetupComplete ?? params.existing?.isSetupComplete ?? false,
    isBusinessSetupComplete: profile.isBusinessSetupComplete ?? params.existing?.isBusinessSetupComplete ?? false,
    businessDomain: profile.businessDomain || params.existing?.businessDomain || domain || undefined,
    businessDbUrl: profile.businessDbUrl || params.existing?.businessDbUrl,
    businessApiKey: profile.businessApiKey || params.existing?.businessApiKey,
    businessMailProvider: profile.businessMailProvider || params.existing?.businessMailProvider,
    businessMailProviderEndpoint: profile.businessMailProviderEndpoint || params.existing?.businessMailProviderEndpoint,
    businessMailboxAddress: profile.businessMailboxAddress || params.existing?.businessMailboxAddress || businessMailboxAddress,
    businessDomainVerified: profile.businessDomainVerified ?? params.existing?.businessDomainVerified ?? false,
    businessProfile: profile.businessProfile || params.existing?.businessProfile,
    dkimStatus: params.existing?.dkimStatus || 'pending',
    spfStatus: params.existing?.spfStatus || 'pending',
    dmarcStatus: params.existing?.dmarcStatus || 'pending',
    createdAt: String(profile.createdAt || params.existing?.createdAt || new Date().toISOString()),
  });
}

function loginIdentifierCandidates(identifier: string): string[] {
  const normalized = normalizeMailbox(identifier);
  const candidates = [normalized];
  if (normalized && !normalized.includes('@')) {
    candidates.push(`admin@${normalizeDomainInput(normalized)}`);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function scopedExistingSession(email: string): User | null {
  const normalizedEmail = normalizeMailbox(email);
  
  const storedUser = getUserFromPersistentStore(normalizedEmail);
  if (storedUser) return storedUser;

  const existing = getSessionSafe();
  if (!existing) return null;
  const existingValues = [
    existing.email,
    existing.recoveryEmail,
    existing.businessMailboxAddress,
  ].map(value => normalizeMailbox(value || '')).filter(Boolean);
  return existingValues.includes(normalizedEmail) ? existing : null;
}

// ---- Auth Functions ----
function getLocalOtpUsage(email: string, purpose: string) {
  const normalizedEmail = normalizeMailbox(email);
  const today = new Date().toISOString().slice(0, 10);
  const key = `velismail_otp_daily_${today}`;
  const usage = loadDB<Record<string, number>>(key, {});
  const usageKey = `${purpose}:${normalizedEmail}`;
  return { normalizedEmail, key, usage, usageKey };
}

function assertLocalOtpLimit(email: string, purpose: string) {
  const { normalizedEmail, usage, usageKey } = getLocalOtpUsage(email, purpose);
  if (!normalizedEmail) return;
  if ((usage[usageKey] || 0) >= 3) {
    throw new Error('Daily OTP limit reached. You can request up to 3 verification codes per email per day.');
  }
}

function recordLocalOtpSend(email: string, purpose: string) {
  const { normalizedEmail, key, usage, usageKey } = getLocalOtpUsage(email, purpose);
  if (!normalizedEmail) return;
  usage[usageKey] = (usage[usageKey] || 0) + 1;
  saveDB(key, usage);
}

export const auth = {
  async sendOtp(data: {
    email?: string;
    identifier?: string;
    displayName?: string;
    purpose?: 'register' | 'recovery_email' | 'password_reset';
  }): Promise<OtpSendResponse> {
    // Build payload with BOTH email and identifier for max backend compatibility
    const normalizedEmail = (data.email || data.identifier || '').trim().toLowerCase();
    const payload = JSON.stringify({
      ...data,
      email: normalizedEmail,
      identifier: normalizedEmail,
      purpose: data.purpose || 'register',
    });
    const purpose = data.purpose || 'register';
    assertLocalOtpLimit(normalizedEmail, purpose);
    const endpoints = [
      '/auth/send-otp',
      '/auth/otp/send',
      '/auth/password-reset/request',
    ];
    let lastError: Error | null = null;
    for (const endpoint of endpoints) {
      try {
        const response = await fetchAPI(endpoint, {
          method: 'POST',
          body: payload,
        });
        recordLocalOtpSend(normalizedEmail, purpose);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('OTP request failed.');
        if (!lastError.message.includes('OTP service is not') && !lastError.message.includes('route was not found')) {
          throw lastError;
        }
      }
    }
    throw lastError || new Error('OTP service is not yet available. Please try again later or contact support.');
  },

  async verifyOtp(data: {
    email: string;
    otp: string;
    challengeToken: string;
    purpose?: 'register' | 'recovery_email' | 'password_reset';
  }): Promise<OtpVerifyResponse> {
    return fetchAPI('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        purpose: data.purpose || 'register',
      }),
    });
  },

  async sendRegistrationOtp(data: {
    email: string;
    displayName: string;
    purpose?: 'register';
  }): Promise<OtpSendResponse> {
    const response = await this.sendOtp(data);
    if (
      !response ||
      typeof response.challengeToken !== 'string' ||
      typeof response.maskedEmail !== 'string'
    ) {
      throw new Error('OTP service returned an incomplete response. Please try again.');
    }
    return response;
  },

  async verifyRegistrationOtp(data: {
    email: string;
    otp: string;
    challengeToken: string;
    purpose?: 'register';
  }): Promise<OtpVerifyResponse> {
    const response = await this.verifyOtp(data);
    if (!response || typeof response.verificationToken !== 'string') {
      throw new Error('OTP verification service returned an incomplete response. Please retry the verification.');
    }
    return response;
  },

  async register(data: {
    email: string;
    password: string;
    displayName: string;
    accountType: 'business';
    customDomain?: string;
    recoveryEmail?: string;
    verificationToken?: string;
  }): Promise<{ success: boolean; error?: string; user?: User }> {
    const normalizedRecoveryEmail = normalizeMailbox(data.recoveryEmail || '');
    const primaryEmail = normalizeMailbox(data.email);

    if (!primaryEmail) {
      return { success: false, error: 'A valid account email is required.' };
    }

    try {
      const existingLocal = scopedExistingSession(primaryEmail);
      await fetchAPI('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: primaryEmail,
          display_name: data.displayName,
          password: data.password,
          custom_domain: data.customDomain || undefined,
          recovery_email: normalizedRecoveryEmail || undefined,
          verification_token: data.verificationToken || undefined,
        }),
      });

      const loginResponse = await fetchAPI('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: primaryEmail, password: data.password }),
      });

      if (!loginResponse || typeof loginResponse.access_token !== 'string') {
        return { success: false, error: 'Backend registration succeeded but login token was not returned.' };
      }

      localStorage.setItem('velismail_token', loginResponse.access_token);
      if (typeof loginResponse.refresh_token === 'string') {
        localStorage.setItem('velismail_refresh', loginResponse.refresh_token);
      }
      const profile = await fetchAuthenticatedProfile();
        const safeUser = buildSessionUser({
          token: loginResponse.access_token,
          email: primaryEmail,
        displayName: data.displayName,
        recoveryEmail: normalizedRecoveryEmail,
        customDomain: data.customDomain,
        existing: existingLocal,
          profile,
        });

      if (safeUser.status === 'suspended' || safeUser.status === 'deactivated') {
        this.logout();
        return { success: false, error: 'This account is not active. Contact VelisMail support for review or recovery.' };
      }
      
      // Temporarily stash user in localStorage to support synchronous getSession until React Query migration
      saveDB(STORAGE_KEYS.session, safeUser);
      saveUserToPersistentStore(safeUser);
      reloadAccountCaches();
      
      return { success: true, user: safeUser };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed.';
      if (message.includes('already has an account') || message.includes('already exists')) {
        const loginResult = await this.login(primaryEmail, data.password);
        if (loginResult.success && loginResult.user) {
          return { success: true, user: loginResult.user };
        }
        return {
          success: false,
          error: 'This account already exists. Sign in with the existing password, or use Forgot Password to recover access.',
        };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Registration failed.' };
    }
  },

  async login(email: string, password: string): Promise<{ success: boolean; error?: string; user?: User }> {
    let lastError = 'Login failed.';
    for (const candidate of loginIdentifierCandidates(email)) {
      try {
        const existingLocal = scopedExistingSession(candidate);
        const res = await fetchAPI('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: candidate, password }),
        });

        if (!res || typeof res.access_token !== 'string') {
          return { success: false, error: 'Backend authentication failed.' };
        }

        localStorage.setItem('velismail_token', res.access_token);
        if (typeof res.refresh_token === 'string') {
          localStorage.setItem('velismail_refresh', res.refresh_token);
        }
        const profile = await fetchAuthenticatedProfile();
        const safeUser = buildSessionUser({
          token: res.access_token,
          email: candidate,
          existing: existingLocal,
          profile,
        });

        if (safeUser.status === 'suspended' || safeUser.status === 'deactivated') {
          this.logout();
          return { success: false, error: 'This account is not active. Contact VelisMail support for review or recovery.' };
        }

        saveDB(STORAGE_KEYS.session, safeUser);
        saveUserToPersistentStore(safeUser);
        reloadAccountCaches();
        return { success: true, user: safeUser };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Login failed.';
      }
    }
    return { success: false, error: lastError };
  },

  loginPasskey(_email: string): { success: boolean; error?: string; user?: User } {
    return { success: false, error: 'Passkey login is not enabled on this deployment yet.' };
  },

  async requestPasswordReset(identifier: string): Promise<OtpSendResponse> {
    return this.sendOtp({
      identifier: identifier,
      purpose: 'password_reset',
    });
  },

  async resetPassword(data: {
    identifier: string;
    verificationToken: string;
    newPassword: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    const normalizedIdentifier = normalizeMailbox(data.identifier);

    await fetchAPI('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        identifier: normalizedIdentifier,
        verificationToken: data.verificationToken,
        newPassword: data.newPassword,
      }),
    });



    return {
      success: true,
      message: 'Password updated successfully.',
    };
  },

  logout() {
    // Clear all session-related storage
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem('velismail_token');
    localStorage.removeItem('velismail_refresh');
    sessionStorage.removeItem('velismail-session');
    emailsCache = [];
  },

  getSession(): User | null {
    const session = loadDB<User | null>(STORAGE_KEYS.session, null);
    const normalizedSession = session ? normalizeSessionUser(session) : null;
    if (session && normalizedSession && JSON.stringify(session) !== JSON.stringify(normalizedSession)) {
      saveDB(STORAGE_KEYS.session, normalizedSession);
    }
    if (normalizedSession && sessionHasMismatch(normalizedSession)) {
      // Session mismatch detected — logging out for safety
      this.logout();
      return null;
    }
    return normalizedSession;
  },

  isLoggedIn(): boolean {
    return !!this.getSession();
  },

  updateSettings(settings: Partial<User>): { success: boolean; user?: User; error?: string } {
    const session = this.getSession();
    if (!session) return { success: false };

    const nextUser = {
      ...session,
      ...settings,
    };

    saveDB(STORAGE_KEYS.session, nextUser);
    saveUserToPersistentStore(nextUser);
    reloadAccountCaches();

    // Push settings to the backend server so the config isn't lost on next login
    fetchAPI('/auth/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).catch(() => { /* Backend settings sync is best-effort */ });

    return { success: true, user: nextUser };
  },

  async changePassword(currentPassword: string, nextPassword: string): Promise<{ success: boolean; error?: string }> {
    const session = this.getSession();
    if (!session) return { success: false, error: 'Session not found.' };

    try {
      await fetchAPI('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          identifier: session.recoveryEmail || session.email,
          currentPassword,
          newPassword: nextPassword,
        }),
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Password update failed.' };
    }
  },

  async listSessions(): Promise<{ success: boolean; sessions: ActiveSession[]; error?: string }> {
    try {
      const response = await fetchAPI('/auth/sessions');
      return {
        success: Boolean(response?.success),
        sessions: Array.isArray(response?.sessions) ? response.sessions : [],
      };
    } catch (error) {
      return { success: false, sessions: [], error: error instanceof Error ? error.message : 'Unable to load sessions.' };
    }
  },

  async revokeSession(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await fetchAPI(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unable to revoke session.' };
    }
  },

  async revokeOtherSessions(): Promise<{ success: boolean; revoked?: number; error?: string }> {
    try {
      const response = await fetchAPI('/auth/sessions/revoke-others', { method: 'POST' });
      return { success: true, revoked: Number(response?.revoked || 0) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unable to revoke other sessions.' };
    }
  },

  async deleteAccount(): Promise<{ success: boolean; error?: string }> {
    const session = this.getSession();
    if (!session) return { success: false, error: 'No active session.' };

    const users = loadPersistentUsers();
    const normalizedEmail = normalizeMailbox(session.email);
    users[normalizedEmail] = normalizeSessionUser({
      ...session,
      status: 'deactivated',
      suspendedAt: new Date().toISOString(),
      suspensionReason: 'Account deactivated by owner. Data retained for recovery.',
    });
    savePersistentUsers(users);

    this.logout();
    return { success: true };
  },
};

// ---- Email Functions ----
function normalizeBusinessEmailFromDb(raw: Partial<Email> & {
  read?: boolean;
  fromName?: string;
  from_name?: string;
  createdAt?: string;
}): Email {
  return {
    id: String(raw.id || `bem_${Date.now()}`),
    from: normalizeMailbox(raw.from || ''),
    fromName: String(raw.fromName || raw.from_name || raw.from || 'Business Mail'),
    to: Array.isArray(raw.to) ? raw.to.map(normalizeMailbox).filter(Boolean) : [],
    subject: String(raw.subject || '(No subject)'),
    body: String(raw.body || ''),
    date: String(raw.date || raw.createdAt || new Date().toISOString()),
    folder: String(raw.folder || 'inbox'),
    unread: typeof raw.unread === 'boolean' ? raw.unread : !raw.read,
    starred: Boolean(raw.starred),
    labels: Array.isArray(raw.labels) ? raw.labels : [],
    hasAttachment: Boolean(raw.hasAttachment),
  };
}

function syncBusinessEmailToDb(email: Email) {
  const session = auth.getSession();
  if (!session?.businessDbUrl || businessEmailDbRouteUnavailable) return;
  const headers: Record<string, string> = {
    'x-business-db-url': session.businessDbUrl
  };
  fetchAPI('/mail/business-emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      dbUrl: session.businessDbUrl,
      email: {
        ...email,
        read: !email.unread,
        starred: email.starred,
      },
    }),
  }).catch(err => {
    if (err instanceof Error && err.message.includes('route was not found')) {
      businessEmailDbRouteUnavailable = true;
      return;
    }
    // Business email DB sync failed; sent message remains available in local dashboard cache
  });
}

let businessEmailDbRouteUnavailable = false;

function folderMatchesBusinessView(email: Email, folder: string): boolean {
  if (folder === 'starred') return email.starred && email.folder !== 'trash';
  if (folder === 'spam') return (email.folder === 'spam' || isScamEmail(email)) && email.folder !== 'trash';
  if (folder === 'priority') return (email.labels || []).includes('priority') && email.folder !== 'trash';
  if (folder === 'scheduled') return email.folder === 'scheduled';
  return email.folder === folder;
}

function mutateEmail(id: string, updater: (email: Email) => Email | void): Email | undefined {
  emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
  let changed: Email | undefined;
  emailsCache = emailsCache.map((entry) => {
    if (entry.id !== id) return entry;
    const updated = updater({ ...entry }) || entry;
    changed = updated;
    return updated;
  });
  saveUserDB(STORAGE_KEYS.emails, emailsCache);
  if (changed) syncBusinessEmailToDb(changed);
  return changed;
}

export const mail = {
  getByFolder(folder: string): Email[] {
    emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    return emailsCache.filter(e => folderMatchesBusinessView(e, folder));
  },

  // Business-specific helpers — operate on emails related to a business domain
  getBusinessByFolderSync(domain: string, folder: string): Email[] {
    const emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    const normalizeDomain = (addr: string) => (addr && addr.includes('@')) ? addr.split('@')[1].toLowerCase() : '';
    return emailsCache.filter(e => {
      if (!folderMatchesBusinessView(e, folder)) return false;
      const fromDomain = normalizeDomain(e.from || '');
      const toDomains = (e.to || []).map(t => normalizeDomain(t));
      return fromDomain === domain.toLowerCase() || toDomains.includes(domain.toLowerCase());
    });
  },

  async getBusinessByFolder(domain: string, folder: string): Promise<Email[]> {
    const session = auth.getSession();
    let sourceEmails = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    
    if (session?.businessDbUrl && !businessEmailDbRouteUnavailable) {
      const headers: Record<string, string> = {
        'x-business-db-url': session.businessDbUrl
      };
      const response = await fetchApiJsonDetailed<{ success?: boolean; emails?: Array<Partial<Email> & { read?: boolean }> }>('/mail/business-emails/query', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dbUrl: session.businessDbUrl }),
      });

      if (response.ok && response.data?.success && Array.isArray(response.data.emails)) {
        sourceEmails = response.data.emails.map((entry) => normalizeBusinessEmailFromDb(entry));
        saveUserDB(STORAGE_KEYS.emails, sourceEmails);
      } else if (response.status === 404) {
        businessEmailDbRouteUnavailable = true;
      } else if (!response.ok) {
        // Business email DB fetch failed — using local cache silently
      }
    }

    const normalizeDomain = (addr: string) => (addr && addr.includes('@')) ? addr.split('@')[1].toLowerCase() : '';
    return sourceEmails.filter((e: Email) => {
      if (!folderMatchesBusinessView(e, folder)) return false;
      const fromDomain = normalizeDomain(e.from || '');
      const toDomains = (e.to || []).map((t: string) => normalizeDomain(t));
      return fromDomain === domain.toLowerCase() || toDomains.includes(domain.toLowerCase());
    });
  },

  async sendBusiness(domain: string, to: string[], subject: string, body: string, fromAddress?: string, attachments?: { filename: string, content: string, contentType: string }[], scheduledAt?: string): Promise<Email> {
    const session = auth.getSession();
    const normalizedDomain = normalizeDomainInput(domain);
    const availableMailboxes = loadBusinessMailboxes(normalizedDomain);
    const selectedMailbox =
      availableMailboxes.find((mailbox) => mailbox.address === normalizeMailbox(fromAddress || '')) ||
      availableMailboxes.find((mailbox) => mailbox.active) ||
      availableMailboxes[0] ||
      getSystemBusinessMailbox(normalizedDomain);
    const groupEntries = loadBusinessGroups(normalizedDomain);
    const expandedRecipients = Array.from(new Set(
      to
        .map((recipient) => normalizeMailbox(recipient))
        .flatMap((recipient) => {
          const group = groupEntries.find((entry) => entry.address === recipient);
          return group ? group.members : [recipient];
        })
        .filter(Boolean),
    ));
    const fromAddr = selectedMailbox.address;
    if (expandedRecipients.length === 0) {
      throw new Error('Add at least one valid recipient.');
    }
    if (!subject.trim() || !body.trim()) {
      throw new Error('Subject and message body are required.');
    }
    const normalizedSchedule = scheduledAt ? new Date(scheduledAt).toISOString() : '';
    const queueEntry = businessQueue.enqueue({
      domain: normalizedDomain,
      fromAddress: fromAddr,
      to: expandedRecipients.join(', '),
      recipients: expandedRecipients,
      subject,
      body,
      status: normalizedSchedule ? 'queued' : 'sending',
      scheduledAt: normalizedSchedule || undefined,
    });

    if (normalizedSchedule && new Date(normalizedSchedule).getTime() > Date.now()) {
      const email: Email = {
        id: queueEntry.id,
        from: fromAddr,
        fromName: selectedMailbox.displayName || session?.displayName || 'Business',
        to: expandedRecipients,
        subject,
        body,
        date: new Date().toISOString(),
        folder: 'scheduled',
        unread: false,
        starred: false,
        labels: ['scheduled'],
        hasAttachment: attachments && attachments.length > 0 ? true : false,
        scheduledAt: normalizedSchedule,
      };
      emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
      emailsCache.unshift(email);
      saveUserDB(STORAGE_KEYS.emails, emailsCache);
      businessAudit.add({
        action: 'Scheduled business email',
        actor: fromAddr,
        target: expandedRecipients.join(', '),
        severity: 'info',
      });
      return email;
    }

    try {
      await fetchAPI('/mail/send', {
        method: 'POST',
        body: JSON.stringify({
          to: expandedRecipients,
          subject,
          body,
          from: fromAddr,
          fromName: selectedMailbox.displayName || session?.displayName || 'Business',
          provider: session?.businessMailProvider,
          apiKey: session?.businessApiKey,
          providerEndpoint: session?.businessMailProviderEndpoint,
          attachments: attachments?.map(a => ({
            filename: a.filename,
            content: a.content,
            mimeType: a.contentType,
          })),
        }),
      });
      businessQueue.mark(queueEntry.id, { status: 'sent', error: undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Business email delivery failed.';
      businessQueue.mark(queueEntry.id, {
        status: queueEntry.retryCount >= 2 ? 'failed' : 'deferred',
        error: message,
        retryCount: queueEntry.retryCount + 1,
      });
      businessAudit.add({
        action: 'Queued failed delivery',
        actor: fromAddr,
        target: expandedRecipients.join(', '),
        severity: 'warn',
      });
      throw error;
    }
    const email: Email = {
      id: 'bem_' + Math.random().toString(36).slice(2, 8),
      from: fromAddr,
      fromName: selectedMailbox.displayName || session?.displayName || 'Business',
      to: expandedRecipients, subject, body,
      date: new Date().toISOString(),
      folder: 'sent', unread: false, starred: false, labels: [], hasAttachment: attachments && attachments.length > 0 ? true : false,
    };
    emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    emailsCache = emailsCache.filter(existing => existing.id !== email.id);
    emailsCache.unshift(email);
    saveUserDB(STORAGE_KEYS.emails, emailsCache);

    if (session?.businessDbUrl) {
      syncBusinessEmailToDb(email);
    }
    businessMailboxes.touch(normalizedDomain, fromAddr);
    businessAudit.add({
      action: 'Sent business email',
      actor: fromAddr,
      target: expandedRecipients.join(', '),
      severity: 'info',
    });
    return email;
  },

  getBusinessUnreadCount(domain: string): number {
    emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    const normalizeDomain = (addr: string) => (addr && addr.includes('@')) ? addr.split('@')[1].toLowerCase() : '';
    return emailsCache.filter(e => {
      if (e.folder !== 'inbox' || !e.unread) return false;
      const fromDomain = normalizeDomain(e.from || '');
      const toDomains = (e.to || []).map(t => normalizeDomain(t));
      return fromDomain === domain.toLowerCase() || toDomains.includes(domain.toLowerCase());
    }).length;
  },

  async send(to: string[], subject: string, body: string): Promise<Email> {
    const session = auth.getSession();
    await fetchAPI('/mail/send', {
      method: 'POST',
      body: JSON.stringify({
        to,
        subject,
        body,
        from: session?.email || 'you@velismail.online',
        fromName: session?.displayName || 'You',
        provider: session?.mailProvider,
        apiKey: session?.apiKey,
        providerEndpoint: session?.mailProviderEndpoint,
      }),
    });
    const email: Email = {
      id: 'em_' + Math.random().toString(36).slice(2, 8),
      from: session?.email || 'you@velismail.online',
      fromName: session?.displayName || 'You',
      to, subject, body,
      date: new Date().toISOString(),
      folder: 'sent', unread: false, starred: false, labels: [], hasAttachment: false,
    };
    emailsCache.unshift(email);
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
    return email;
  },

  delete(id: string) {
    mutateEmail(id, e => ({ ...e, folder: 'trash' }));
  },

  toggleStar(id: string): boolean {
    const e = mutateEmail(id, entry => ({ ...entry, starred: !entry.starred }));
    return e?.starred ?? false;
  },

  markRead(id: string) {
    mutateEmail(id, e => ({ ...e, unread: false }));
  },

  markUnread(id: string) {
    mutateEmail(id, e => ({ ...e, unread: true }));
  },

  archive(id: string) {
    mutateEmail(id, e => ({ ...e, folder: 'archive' }));
  },

  moveFolder(id: string, folder: string) {
    mutateEmail(id, e => ({ ...e, folder }));
  },

  markSafe(id: string) {
    mutateEmail(id, e => ({
      ...e,
      folder: 'inbox',
      labels: Array.from(new Set((e.labels || []).filter(label => label !== 'spam' && label !== 'scam').concat('safe'))),
      unread: false,
    }));
  },

  togglePriority(id: string): boolean {
    const updated = mutateEmail(id, e => {
      const labels = new Set(e.labels || []);
      if (labels.has('priority')) labels.delete('priority'); else labels.add('priority');
      return { ...e, labels: Array.from(labels) };
    });
    return Boolean(updated?.labels?.includes('priority'));
  },

  markAllRead(folder: string) {
    emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    emailsCache = emailsCache.map(e => folderMatchesBusinessView(e, folder) ? { ...e, unread: false } : e);
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  async dispatchScheduledDue(domain?: string): Promise<number> {
    const session = auth.getSession();
    const dueItems = businessQueue.getAll(domain)
      .filter(item => item.status === 'queued' && item.scheduledAt && new Date(item.scheduledAt).getTime() <= Date.now());
    let delivered = 0;

    for (const item of dueItems) {
      businessQueue.mark(item.id, { status: 'sending', error: undefined });
      try {
        const recipients = item.recipients || item.to.split(',').map(recipient => recipient.trim()).filter(Boolean);
        await fetchAPI('/mail/send', {
          method: 'POST',
          body: JSON.stringify({
            to: recipients,
            subject: item.subject,
            body: item.body || '',
            from: item.fromAddress,
            fromName: session?.displayName || 'Business',
            provider: session?.businessMailProvider,
            apiKey: session?.businessApiKey,
            providerEndpoint: session?.businessMailProviderEndpoint,
          }),
        });
        businessQueue.mark(item.id, { status: 'sent', error: undefined });
        const sentEmail = mutateEmail(item.id, e => ({
          ...e,
          folder: 'sent',
          date: new Date().toISOString(),
          labels: (e.labels || []).filter(label => label !== 'scheduled'),
          scheduledAt: item.scheduledAt,
        }));
        if (!sentEmail) {
          const fallbackEmail: Email = {
            id: item.id,
            from: item.fromAddress,
            fromName: session?.displayName || 'Business',
            to: recipients,
            subject: item.subject,
            body: item.body || '',
            date: new Date().toISOString(),
            folder: 'sent',
            unread: false,
            starred: false,
            labels: [],
            hasAttachment: false,
            scheduledAt: item.scheduledAt,
          };
          emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
          emailsCache.unshift(fallbackEmail);
          saveUserDB(STORAGE_KEYS.emails, emailsCache);
          syncBusinessEmailToDb(fallbackEmail);
        }
        businessAudit.add({
          action: 'Delivered scheduled email',
          actor: item.fromAddress,
          target: item.to,
          severity: 'info',
        });
        delivered += 1;
      } catch (error) {
        businessQueue.mark(item.id, {
          status: item.retryCount >= 2 ? 'failed' : 'deferred',
          retryCount: item.retryCount + 1,
          error: error instanceof Error ? error.message : 'Scheduled delivery failed.',
        });
      }
    }

    return delivered;
  },

  getUnreadCount(): number {
    return emailsCache.filter(e => e.unread).length;
  },

};

export const businessMailboxes = {
  getByDomain(domain: string): BusinessMailbox[] {
    return loadBusinessMailboxes(domain);
  },

  getPrimary(domain: string): BusinessMailbox {
    return this.getByDomain(domain).find((entry) => entry.active) || this.getByDomain(domain)[0] || getSystemBusinessMailbox(domain);
  },

  create(domain: string, data: {
    localPart?: string;
    address?: string;
    displayName?: string;
    kind?: BusinessMailbox['kind'];
    aliases?: string[];
  }): BusinessMailbox {
    const normalizedDomain = normalizeDomainInput(domain);
    const entries = this.getByDomain(normalizedDomain);
    const normalizedAddress = normalizeMailbox(
      data.address || `${normalizeLocalPart(data.localPart || data.displayName || 'mailbox')}@${normalizedDomain}`,
    );
    if (!normalizedAddress.endsWith(`@${normalizedDomain}`)) {
      throw new Error(`Mailbox must use @${normalizedDomain}.`);
    }
    if (entries.some((entry) => entry.address === normalizedAddress)) {
      throw new Error('This mailbox already exists for the selected domain.');
    }

    const mailbox = normalizeBusinessMailboxEntry({
      address: normalizedAddress,
      displayName: data.displayName || normalizedAddress.split('@')[0],
      kind: data.kind || 'mailbox',
      aliases: data.aliases || [],
      active: entries.length === 0,
      source: 'custom',
    }, normalizedDomain);
    saveBusinessMailboxes(normalizedDomain, [...entries, mailbox]);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/mailboxes`, {
        method: 'POST',
        body: JSON.stringify(mailbox),
      }).catch(warnBackendSyncFailure);
    }

    businessAudit.add({
      action: 'Created mailbox',
      actor: session?.email || mailbox.address,
      target: mailbox.address,
      severity: 'info',
    });
    return mailbox;
  },

  setPrimary(domain: string, address: string): BusinessMailbox[] {
    const normalizedDomain = normalizeDomainInput(domain);
    const normalizedAddress = normalizeMailbox(address);
    const updated = this.getByDomain(normalizedDomain).map((entry) => ({
      ...entry,
      active: entry.address === normalizedAddress,
      kind: entry.address === normalizedAddress ? 'primary' as const : entry.kind === 'primary' ? 'mailbox' as const : entry.kind,
    }));
    saveBusinessMailboxes(normalizedDomain, updated);

    const session = auth.getSession();
    if (session?.businessDomain === normalizedDomain) {
      auth.updateSettings({ businessMailboxAddress: normalizedAddress });
    }
    return updated;
  },

  touch(domain: string, address: string) {
    const normalizedDomain = normalizeDomainInput(domain);
    const normalizedAddress = normalizeMailbox(address);
    const updated = this.getByDomain(normalizedDomain).map((entry) => (
      entry.address === normalizedAddress
        ? { ...entry, lastUsedAt: new Date().toISOString() }
        : entry
    ));
    saveBusinessMailboxes(normalizedDomain, updated);
  },

  remove(domain: string, address: string): BusinessMailbox[] {
    const normalizedDomain = normalizeDomainInput(domain);
    const normalizedAddress = normalizeMailbox(address);
    const current = this.getByDomain(normalizedDomain);
    const next = current.filter((entry) => entry.address !== normalizedAddress);
    if (next.length === 0) {
      throw new Error('At least one business mailbox must remain on the domain.');
    }
    if (!next.some((entry) => entry.active)) {
      next[0] = { ...next[0], active: true, kind: 'primary' };
    }
    saveBusinessMailboxes(normalizedDomain, next);
    const session = auth.getSession();
    if (session?.businessMailboxAddress === normalizedAddress) {
      auth.updateSettings({ businessMailboxAddress: next.find((entry) => entry.active)?.address || next[0].address });
    }
    businessAudit.add({
      action: 'Removed mailbox',
      actor: auth.getSession()?.email || normalizedAddress,
      target: normalizedAddress,
      severity: 'warn',
    });
    return next;
  },

  removeDomain(domain: string) {
    saveBusinessMailboxes(domain, []);
  },
};

export const businessGroups = {
  getByDomain(domain: string): BusinessGroup[] {
    return loadBusinessGroups(domain);
  },

  create(domain: string, data: { name: string; localPart?: string; members: string[] }): BusinessGroup {
    const normalizedDomain = normalizeDomainInput(domain);
    const entries = this.getByDomain(normalizedDomain);
    const address = normalizeMailbox(`${normalizeLocalPart(data.localPart || data.name)}@${normalizedDomain}`);
    if (entries.some((entry) => entry.address === address)) {
      throw new Error('This group mailbox already exists.');
    }
    const group = normalizeBusinessGroupEntry({
      name: data.name,
      address,
      members: data.members,
    }, normalizedDomain);
    saveBusinessGroups(normalizedDomain, [...entries, group]);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/groups`, {
        method: 'POST',
        body: JSON.stringify(group),
      }).catch(warnBackendSyncFailure);
    }

    businessAudit.add({
      action: 'Created group',
      actor: auth.getSession()?.email || address,
      target: address,
      severity: 'info',
    });
    return group;
  },

  update(domain: string, id: string, data: Partial<BusinessGroup>) {
    const normalizedDomain = normalizeDomainInput(domain);
    const updated = this.getByDomain(normalizedDomain).map((entry) => (
      entry.id === id
        ? normalizeBusinessGroupEntry({ ...entry, ...data, updatedAt: new Date().toISOString() }, normalizedDomain)
        : entry
    ));
    saveBusinessGroups(normalizedDomain, updated);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updated.find(e => e.id === id)),
      }).catch(warnBackendSyncFailure);
    }
  },

  remove(domain: string, id: string) {
    const normalizedDomain = normalizeDomainInput(domain);
    const current = this.getByDomain(normalizedDomain);
    const group = current.find((entry) => entry.id === id);
    saveBusinessGroups(normalizedDomain, current.filter((entry) => entry.id !== id));

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/groups/${id}`, {
        method: 'DELETE',
      }).catch(warnBackendSyncFailure);
    }
    if (group) {
      businessAudit.add({
        action: 'Removed group',
        actor: auth.getSession()?.email || group.address,
        target: group.address,
        severity: 'warn',
      });
    }
  },

  removeDomain(domain: string) {
    saveBusinessGroups(domain, []);
  },
};

export const businessTeam = {
  getAll(): BusinessTeamMember[] {
    return loadBusinessTeamMembers();
  },
  save(entries: BusinessTeamMember[]) {
    saveBusinessTeamMembers(entries);
  },
};

export const teamAccess = {
  async createInvite(params: CreateTeamAccessInviteParams): Promise<TeamAccessInvite> {
    const localInvite = buildTeamAccessInvite(params);
    const response = await postTeamAccess('/team/invites', {
      email: localInvite.email,
      name: localInvite.name,
      role: localInvite.role,
      expiresInHours: params.expiresInHours,
      issuerEmail: localInvite.issuerEmail,
      workspace: localInvite.workspace,
    });

    if (response?.ok && response.data?.invite) {
      cacheTeamAccessInvite(response.data.invite);
      return response.data.invite;
    }
    if (response && response.status !== 404) {
      throw new Error(teamAccessApiError(response.data, 'Unable to create team access key.'));
    }

    cacheTeamAccessInvite(localInvite);
    return localInvite;
  },

  async validateToken(token: string, email?: string): Promise<{ ok: boolean; invite?: TeamAccessInvite; error?: string }> {
    const cached = validateCachedTeamAccessToken(token);
    if (cached.ok && cached.invite) {
      const normalizedEmail = email ? normalizeMailbox(email) : '';
      if (normalizedEmail && normalizedEmail !== cached.invite.email) {
        return { ok: false, error: 'This email is not assigned to the provided team access key.' };
      }
      return cached;
    }
    if (cached.error && cached.error !== 'Invalid team access key.') {
      return cached;
    }

    const response = await postTeamAccess('/team/invites/validate', {
      token: token.trim(),
      email: email ? normalizeMailbox(email) : undefined,
    });

    if (response?.ok && response.data?.invite) {
      if (hasTeamAccessWorkspace(response.data.invite)) {
        cacheTeamAccessInvite(response.data.invite);
      }
      return { ok: true, invite: response.data.invite };
    }
    if (response && response.status !== 404) {
      return { ok: false, error: teamAccessApiError(response.data, 'Invalid team access key.') };
    }

    return validateCachedTeamAccessToken(token);
  },

  async requestOtp(token: string, email: string): Promise<OtpSendResponse> {
    const validation = await this.validateToken(token, email);
    if (!validation.ok || !validation.invite) {
      throw new Error(validation.error || 'Invalid team access key.');
    }
    const normalizedEmail = normalizeMailbox(email);
    if (normalizedEmail !== validation.invite.email) {
      throw new Error('This email is not assigned to the provided team access key.');
    }
    return auth.sendOtp({
      email: normalizedEmail,
      displayName: validation.invite.name,
      purpose: 'register',
    });
  },

  async completeLogin(params: {
    token: string;
    email: string;
    otp: string;
    challengeToken: string;
  }): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const validation = await this.validateToken(params.token, params.email);
      if (!validation.ok || !validation.invite) {
        throw new Error(validation.error || 'Invalid team access key.');
      }
      const normalizedEmail = normalizeMailbox(params.email);
      if (normalizedEmail !== validation.invite.email) {
        throw new Error('Team access key and email do not match.');
      }
      const otpResponse = await auth.verifyOtp({
        email: normalizedEmail,
        otp: params.otp,
        challengeToken: params.challengeToken,
        purpose: 'register',
      });

      let invite = validation.invite;
      const completion = await postTeamAccess('/team/invites/complete', {
        token: params.token.trim(),
        email: normalizedEmail,
        verificationToken: otpResponse.verificationToken,
      });

      if (completion?.ok && completion.data?.invite) {
        invite = completion.data.invite;
        if (hasTeamAccessWorkspace(invite)) {
          cacheTeamAccessInvite(invite);
        }
      } else if (completion && completion.status !== 404) {
        throw new Error(teamAccessApiError(completion.data, 'Unable to complete team access login.'));
      }

      if (!hasTeamAccessWorkspace(invite)) {
        throw new Error('Team workspace configuration is unavailable. Ask the admin to generate a fresh access key.');
      }

      const user: User = normalizeSessionUser({
        id: `team_${hashString(`${invite.id}:${normalizedEmail}`)}`,
        tenantId: invite.workspace.tenantId,
        email: normalizedEmail,
        displayName: invite.name,
        plan: 'Team Access',
        accountType: 'business',
        isSetupComplete: true,
        isBusinessSetupComplete: true,
        customDomain: invite.workspace.businessDomain,
        businessDomain: invite.workspace.businessDomain,
        businessDbUrl: invite.workspace.businessDbUrl,
        businessApiKey: invite.workspace.businessApiKey,
        businessMailProvider: invite.workspace.businessMailProvider,
        businessMailProviderEndpoint: invite.workspace.businessMailProviderEndpoint,
        businessMailboxAddress: normalizedEmail,
        businessDomainVerified: invite.workspace.businessDomainVerified ?? true,
        businessProfile: invite.workspace.businessProfile,
        teamAccessRole: invite.role,
        teamAccessInviteId: invite.id,
        teamAccessOwnerEmail: invite.issuerEmail,
        createdAt: new Date().toISOString(),
      });

      saveDB(STORAGE_KEYS.session, user);
      saveUserToPersistentStore(user);
      reloadAccountCaches();

      const invites = loadTeamAccessInvites();
      const saved = invites.find((entry) => entry.id === invite.id);
      if (saved) {
        saved.status = 'accepted';
        saved.acceptedAt = new Date().toISOString();
        saveTeamAccessInvites(invites);
      }

      return { success: true, user };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Team access login failed.' };
    }
  },

  async revoke(token: string) {
    await postTeamAccess('/team/invites/revoke', { token });
    const invites = loadTeamAccessInvites();
    const invite = invites.find((entry) => entry.token === token);
    if (invite) {
      invite.status = 'revoked';
      saveTeamAccessInvites(invites);
    }
  },
};

export const businessTemplates = {
  getAll(): BusinessTemplate[] {
    return loadBusinessTemplates();
  },
  save(entries: BusinessTemplate[]) {
    saveBusinessTemplates(entries);
  },
};

export const businessQueue = {
  getAll(domain?: string): BusinessMailQueueItem[] {
    return loadBusinessQueue(domain);
  },

  enqueue(entry: Partial<BusinessMailQueueItem>): BusinessMailQueueItem {
    const all = loadBusinessQueue();
    const normalized = normalizeBusinessQueueEntry({
      ...entry,
      status: entry.status || 'queued',
      queuedAt: entry.queuedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    saveBusinessQueue([normalized, ...all.filter((item) => item.id !== normalized.id)]);
    return normalized;
  },

  mark(id: string, updates: Partial<BusinessMailQueueItem>): BusinessMailQueueItem | null {
    let updatedItem: BusinessMailQueueItem | null = null;
    const now = new Date().toISOString();
    const next = loadBusinessQueue().map((entry) => {
      if (entry.id !== id) return entry;
      updatedItem = normalizeBusinessQueueEntry({ ...entry, ...updates, updatedAt: now });
      return updatedItem;
    });
    saveBusinessQueue(next);
    return updatedItem;
  },

  remove(id: string) {
    saveBusinessQueue(loadBusinessQueue().filter((entry) => entry.id !== id));
  },

  clearSent() {
    saveBusinessQueue(loadBusinessQueue().filter((entry) => entry.status !== 'sent'));
  },
};

export const businessAudit = {
  getAll(): BusinessAuditEntry[] {
    return loadBusinessAuditEntries();
  },
  save(entries: BusinessAuditEntry[]) {
    saveBusinessAuditEntries(entries);
  },
  add(entry: Omit<BusinessAuditEntry, 'id' | 'timestamp'> & Partial<Pick<BusinessAuditEntry, 'id' | 'timestamp'>>) {
    const all = this.getAll();
    const nextEntry: BusinessAuditEntry = {
      id: entry.id || `aud_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      action: entry.action,
      actor: entry.actor,
      target: entry.target,
      severity: entry.severity,
    };
    this.save([nextEntry, ...all]);
    return nextEntry;
  },
};

function scopedRecordCount<T>(key: string, userId: string): number {
  return loadDB<T[]>(`${key}_${userId}`, []).length;
}

function scopedEmailCount(userId: string): number {
  return scopedRecordCount<Email>(STORAGE_KEYS.emails, userId);
}

function estimateUserStorageBytes(user: User): number {
  const scopedKeys = [
    STORAGE_KEYS.emails,
    STORAGE_KEYS.domains,
    STORAGE_KEYS.businessMailboxes,
    STORAGE_KEYS.businessGroups,
    STORAGE_KEYS.businessTeam,
    STORAGE_KEYS.businessTemplates,
    STORAGE_KEYS.businessQueue,
    STORAGE_KEYS.businessAudit,
    STORAGE_KEYS.contacts,
    STORAGE_KEYS.signatures,
  ];

  return scopedKeys.reduce((total, key) => {
    try {
      return total + (localStorage.getItem(`${key}_${user.id}`)?.length || 0);
    } catch {
      return total;
    }
  }, JSON.stringify(user).length);
}

function userRisk(record: Omit<PlatformAdminUserRecord, 'risk'>): PlatformAdminUserRecord['risk'] {
  if (record.status === 'suspended' || record.status === 'deactivated') return 'high';
  if (record.auditCount > 25 || record.queueCount > 1000) return 'medium';
  return 'low';
}

export const platformAdmin = {
  isCurrentUserPlatformAdmin(): boolean {
    const session = auth.getSession();
    if (!session) return false;
    const hostAllowed = typeof window !== 'undefined' && window.location.hostname === 'velismail.online';
    return hostAllowed && normalizeMailbox(session.email).endsWith('@velismail.online');
  },

  getUsers(): PlatformAdminUserRecord[] {
    const users = Object.values(loadPersistentUsers()).map(normalizeSessionUser);
    return users
      .map((user): PlatformAdminUserRecord => {
        const base = {
          user,
          status: user.status || 'active',
          domain: user.businessDomain || user.customDomain || user.email.split('@')[1] || '',
          plan: user.plan || 'Starter',
          billingCycle: user.billingCycle || 'monthly',
          paidPlanPurchasedAt: user.paidPlanPurchasedAt,
          planStartedAt: user.planStartedAt || user.createdAt,
          lastPlanChangeAt: user.lastPlanChangeAt,
          createdAt: user.createdAt,
          lastActiveAt: undefined,
          emailCount: scopedEmailCount(user.id),
          domainCount: scopedRecordCount<CustomDomain>(STORAGE_KEYS.domains, user.id),
          mailboxCount: scopedRecordCount<BusinessMailbox>(STORAGE_KEYS.businessMailboxes, user.id),
          queueCount: scopedRecordCount<BusinessMailQueueItem>(STORAGE_KEYS.businessQueue, user.id),
          templateCount: scopedRecordCount<BusinessTemplate>(STORAGE_KEYS.businessTemplates, user.id),
          teamMemberCount: scopedRecordCount<BusinessTeamMember>(STORAGE_KEYS.businessTeam, user.id),
          auditCount: scopedRecordCount<BusinessAuditEntry>(STORAGE_KEYS.businessAudit, user.id),
          storageEstimateBytes: estimateUserStorageBytes(user),
        };
        return {
          ...base,
          risk: userRisk(base),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  updateUserStatus(email: string, status: 'active' | 'suspended' | 'deactivated', reason?: string): User | null {
    const users = loadPersistentUsers();
    const normalizedEmail = normalizeMailbox(email);
    const user = users[normalizedEmail];
    if (!user) return null;

    const next = normalizeSessionUser({
      ...user,
      status,
      suspendedAt: status === 'suspended' ? new Date().toISOString() : undefined,
      suspensionReason: status === 'suspended' ? reason?.trim() || 'Administrative suspension' : undefined,
    });
    users[normalizedEmail] = next;
    savePersistentUsers(users);

    const session = auth.getSession();
    businessAudit.add({
      action: status === 'suspended' ? 'Suspended user' : status === 'deactivated' ? 'Deactivated user' : 'Reactivated user',
      actor: session?.email || 'platform-admin',
      target: normalizedEmail,
      severity: status === 'suspended' ? 'critical' : 'warn',
    });

    return next;
  },

  updateUserPlan(email: string, plan: string, billingCycle: 'monthly' | 'annual'): User | null {
    const users = loadPersistentUsers();
    const normalizedEmail = normalizeMailbox(email);
    const user = users[normalizedEmail];
    if (!user) return null;

    const now = new Date().toISOString();
    const paidPlanPurchasedAt = plan === 'Free' ? undefined : user.paidPlanPurchasedAt || now;
    const next = normalizeSessionUser({
      ...user,
      plan,
      billingCycle,
      paidPlanPurchasedAt,
      planStartedAt: user.planStartedAt || user.createdAt || now,
      lastPlanChangeAt: now,
    });
    users[normalizedEmail] = next;
    savePersistentUsers(users);

    const session = auth.getSession();
    businessAudit.add({
      action: 'Updated user plan',
      actor: session?.email || 'platform-admin',
      target: `${normalizedEmail} -> ${plan} (${billingCycle})`,
      severity: 'warn',
    });

    return next;
  },
};

export const connections = {
  getUsage(): ConnectionUsage[] {
    const user = auth.getSession();
    if (!user) return [];
    const usages: ConnectionUsage[] = [];
    if (user.customDbUrl) {
      usages.push(buildConnectionUsage('database', user, user.customDbUrl));
    }
    if (user.businessDbUrl) {
      usages.push(buildConnectionUsage('database', user, user.businessDbUrl));
    }
    if (user.apiKey) {
      usages.push(buildConnectionUsage('mail-provider', user, user.apiKey, user.mailProvider));
    }
    if (user.businessApiKey) {
      usages.push(buildConnectionUsage('mail-provider', user, user.businessApiKey, user.businessMailProvider));
    }
    return usages;
  },

  revoke(id: string): boolean {
    const usage = this.getUsage().find((entry) => entry.id === id);
    if (!usage) return false;
    const session = auth.getSession();
    if (!session || session.id !== usage.ownerAccountId) return false;

    const next: Partial<User> = {};
    if (usage.type === 'database') {
      if (session.customDbUrl && hashString(`database::${session.customDbUrl.toLowerCase()}`) === usage.fingerprint) {
        next.customDbUrl = undefined;
        next.isSetupComplete = false;
      }
      if (session.businessDbUrl && hashString(`database::${session.businessDbUrl.toLowerCase()}`) === usage.fingerprint) {
        next.businessDbUrl = undefined;
        next.isBusinessSetupComplete = false;
      }
    } else {
      if (session.apiKey && hashString(`mail-provider:${session.mailProvider || ''}:${session.apiKey.toLowerCase()}`) === usage.fingerprint) {
        next.apiKey = undefined;
        next.isSetupComplete = false;
      }
      if (session.businessApiKey && hashString(`mail-provider:${session.businessMailProvider || ''}:${session.businessApiKey.toLowerCase()}`) === usage.fingerprint) {
        next.businessApiKey = undefined;
        next.isBusinessSetupComplete = false;
      }
    }

    auth.updateSettings(next);

    // Bridge: Async call to backend
    if (session.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/connections/${id}`, {
        method: 'DELETE',
      }).catch(warnBackendSyncFailure);
    }

    return true;
  },
};

// Basic heuristic scam detection. This is a client-side heuristic and should
// be complemented with backend spam-scoring in production.
export function isScamEmail(email: Email): boolean {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  const suspicious = ['win', 'winner', 'prize', 'congrat', 'urgent', 'password', 'account', 'verify', 'click', 'bank', 'transaction', 'limited time', 'claim', 'invoice', 'payment'];
  if (suspicious.some(w => text.includes(w))) return true;

  const urlRegex = /https?:\/\/[^\s]+/gi;
  const urls = (email.body || '').match(urlRegex) || [];
  if (urls.length >= 2) return true;

  // If sender looks like a generic no-reply with suspicious subject patterns
  if ((email.from || '').toLowerCase().includes('no-reply') && /verify|confirm|activate/.test(text)) return true;

  return false;
}

// ---- Domain Functions ----
export const domains = {
  getAll(): CustomDomain[] {
    const storedDomains = loadUserDB<(Partial<CustomDomain> & { id: string; domain: string; status?: 'pending' | 'verified' | 'failed' })[]>(STORAGE_KEYS.domains, []);
    const normalizedDomains = storedDomains.map(normalizeStoredDomain);

    const session = getSessionSafe();
    if (session?.businessDomain && session?.businessDomainVerified) {
      const normalizedDomainInput = normalizeDomainInput(session.businessDomain);
      if (!normalizedDomains.find(d => d.domain === normalizedDomainInput)) {
        const tokenHash = hashString(`domain-verify:${session.tenantId || 'local'}:${normalizedDomainInput}`).padStart(12, '0').slice(0, 12);
        const verificationToken = `velismail-verify=${tokenHash}`;
        const autoHydratedDomain: CustomDomain = {
          id: `dom_${hashString(normalizedDomainInput)}`,
          domain: normalizedDomainInput,
          status: 'verified',
          verificationToken,
          dnsRecords: buildDnsRecords(normalizedDomainInput, verificationToken),
          checks: buildDomainChecks(normalizedDomainInput, verificationToken).map(check => ({
            ...check,
            status: 'verified',
            actual: check.expected,
          })),
          addedAt: session.createdAt || new Date().toISOString(),
          lastCheckedAt: new Date().toISOString(),
          verifiedAt: new Date().toISOString(),
        };
        normalizedDomains.push(autoHydratedDomain);
      }
    }

    if (JSON.stringify(storedDomains) !== JSON.stringify(normalizedDomains)) {
      saveUserDB(STORAGE_KEYS.domains, normalizedDomains);
    }

    return normalizedDomains;
  },

  getById(id: string): CustomDomain | null {
    return this.getAll().find(domain => domain.id === id) || null;
  },

  getByDomain(domain: string): CustomDomain | null {
    const normalizedDomain = normalizeDomainInput(domain);
    return this.getAll().find(entry => entry.domain === normalizedDomain) || null;
  },

  addDomain(domain: string): CustomDomain {
    const allDomains = this.getAll();
    const normalizedDomain = normalizeDomainInput(domain);
    const existing = allDomains.find(entry => entry.domain === normalizedDomain);
    if (existing) {
      return existing;
    }

    const session = auth.getSession();
    const tokenHash = hashString(`domain-verify:${session?.tenantId || 'local'}:${normalizedDomain}`).padStart(12, '0').slice(0, 12);
    const verificationToken = `velismail-verify=${tokenHash}`;
    const newDomain: CustomDomain = {
      id: `dom_${hashString(normalizedDomain)}`,
      domain: normalizedDomain,
      status: 'pending',
      verificationToken,
      dnsRecords: buildDnsRecords(normalizedDomain, verificationToken),
      checks: buildDomainChecks(normalizedDomain, verificationToken),
      addedAt: new Date().toISOString(),
    };
    allDomains.push(newDomain);
    saveUserDB(STORAGE_KEYS.domains, allDomains);

    // Bridge: Async call to backend
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/domains`, {
        method: 'POST',
        body: JSON.stringify({ domain_name: normalizedDomain, verification_method: 'dns' }),
      }).catch(warnBackendSyncFailure);
    }

    return newDomain;
  },

  runVerification(id: string, verificationChecks?: Partial<DomainCheck>[]): CustomDomain | null {
    const allDomains = this.getAll();
    const domain = allDomains.find(entry => entry.id === id);
    if (!domain) return null;

    const now = new Date().toISOString();
    domain.checks = domain.checks.map(check => {
      const remoteCheck = verificationChecks?.find(item => item.key === check.key);
      if (!remoteCheck) {
        return verificationChecks ? check : {
          ...check,
          status: 'verified',
          actual: check.expected,
        };
      }

      return {
        ...check,
        label: remoteCheck.label || check.label,
        expected: remoteCheck.expected || check.expected,
        actual: remoteCheck.actual || check.actual,
        status: remoteCheck.status || check.status,
      };
    });
    domain.status = domain.checks.every(check => check.status === 'verified')
      ? 'verified'
      : domain.checks.some(check => check.status === 'failed')
        ? 'failed'
        : 'pending';
    domain.lastCheckedAt = now;
    domain.verifiedAt = domain.status === 'verified' ? now : undefined;

    saveUserDB(STORAGE_KEYS.domains, allDomains);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId && domain.status === 'verified') {
      fetchAPI(`/tenants/${session.tenantId}/domains/${domain.domain}/verify`, {
        method: 'POST',
      }).catch(warnBackendSyncFailure);
    }

    return domain;
  },

  verifyDomain(id: string, verificationChecks?: Partial<DomainCheck>[]): CustomDomain | null {
    return this.runVerification(id, verificationChecks);
  },

  setPrimary(id: string): CustomDomain | null {
    const domain = this.getById(id);
    if (!domain) return null;
    const session = auth.getSession();
    const dkimStatus = domain.checks.find(check => check.key === 'dkim')?.status === 'verified' ? 'verified' : 'pending';
    const spfStatus = domain.checks.find(check => check.key === 'spf')?.status === 'verified' ? 'verified' : 'pending';
    const dmarcStatus = domain.checks.find(check => check.key === 'dmarc')?.status === 'verified' ? 'verified' : 'pending';

    auth.updateSettings({
      businessDomain: domain.domain,
      businessDomainVerified: domain.status === 'verified',
      dkimStatus,
      spfStatus,
      dmarcStatus,
      businessProfile: {
        ...session?.businessProfile,
        domain: domain.domain,
        verified: domain.status === 'verified',
        dkimStatus,
        spfStatus,
        dmarcStatus,
      },
    });

    return domain;
  },

  deleteDomain(id: string) {
    const domainToDelete = this.getById(id);
    let allDomains = this.getAll();
    allDomains = allDomains.filter(d => d.id !== id);
    saveUserDB(STORAGE_KEYS.domains, allDomains);
    if (domainToDelete) {
      businessMailboxes.removeDomain(domainToDelete.domain);
      businessGroups.removeDomain(domainToDelete.domain);
      businessAudit.add({
        action: 'Deleted domain',
        actor: auth.getSession()?.email || domainToDelete.domain,
        target: domainToDelete.domain,
        severity: 'warn',
      });
    }

    const session = auth.getSession();
    if (session?.businessDomain && domainToDelete?.domain === session.businessDomain) {
      auth.updateSettings({
        businessDomain: undefined,
        businessDomainVerified: false,
        isBusinessSetupComplete: false,
        dkimStatus: 'pending',
        spfStatus: 'pending',
        dmarcStatus: 'pending',
        businessProfile: {
          ...session.businessProfile,
          domain: undefined,
          verified: false,
          dkimStatus: 'pending',
          spfStatus: 'pending',
          dmarcStatus: 'pending',
        },
      });
    }

    // Bridge: Async call to backend
    if (session?.tenantId && domainToDelete) {
      fetchAPI(`/tenants/${session.tenantId}/domains/${domainToDelete.domain}`, {
        method: 'DELETE',
      }).catch(warnBackendSyncFailure);
    }
  },
};

// ---- Contacts Functions ----
export const contacts = {
  getAll(): Contact[] {
    return loadUserDB<Contact[]>(STORAGE_KEYS.contacts, []);
  },

  add(data: Omit<Contact, 'id' | 'favorite' | 'createdAt'>): Contact {
    const all = this.getAll();
    const c: Contact = {
      id: 'ct_' + Math.random().toString(36).slice(2, 8),
      ...data,
      group: data.group || 'General',
      favorite: false,
      createdAt: new Date().toISOString(),
    };
    all.push(c);
    saveUserDB(STORAGE_KEYS.contacts, all);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/contacts`, {
        method: 'POST',
        body: JSON.stringify(c),
      }).catch(warnBackendSyncFailure);
    }

    return c;
  },

  update(id: string, data: Partial<Contact>) {
    const all = this.getAll();
    const idx = all.findIndex(c => c.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...data };
      saveUserDB(STORAGE_KEYS.contacts, all);

      // Bridge: Async call to backend
      const session = auth.getSession();
      if (session?.tenantId) {
        fetchAPI(`/tenants/${session.tenantId}/contacts/${id}`, {
          method: 'PUT',
          body: JSON.stringify(all[idx]),
        }).catch(warnBackendSyncFailure);
      }
    }
  },

  remove(id: string) {
    let all = this.getAll();
    all = all.filter(c => c.id !== id);
    saveUserDB(STORAGE_KEYS.contacts, all);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/contacts/${id}`, {
        method: 'DELETE',
      }).catch(warnBackendSyncFailure);
    }
  },

  toggleFavorite(id: string): boolean {
    const all = this.getAll();
    const c = all.find(c => c.id === id);
    if (c) c.favorite = !c.favorite;
    saveUserDB(STORAGE_KEYS.contacts, all);
    return c?.favorite ?? false;
  },

  search(query: string): Contact[] {
    const q = query.toLowerCase();
    return this.getAll().filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    );
  },
};

// ---- Signature Functions ----
export const signatures = {
  getAll(): Signature[] {
    return loadUserDB<Signature[]>(STORAGE_KEYS.signatures, []);
  },

  add(name: string, content: string): Signature {
    const all = this.getAll();
    const sig: Signature = {
      id: 'sig_' + Math.random().toString(36).slice(2, 8),
      name, content,
      isDefault: all.length === 0,
    };
    all.push(sig);
    saveUserDB(STORAGE_KEYS.signatures, all);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/signatures`, {
        method: 'POST',
        body: JSON.stringify(sig),
      }).catch(warnBackendSyncFailure);
    }

    return sig;
  },

  update(id: string, data: Partial<Signature>) {
    const all = this.getAll();
    const idx = all.findIndex(s => s.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...data };
      saveUserDB(STORAGE_KEYS.signatures, all);

      // Bridge: Async call to backend
      const session = auth.getSession();
      if (session?.tenantId) {
        fetchAPI(`/tenants/${session.tenantId}/signatures/${id}`, {
          method: 'PUT',
          body: JSON.stringify(all[idx]),
        }).catch(warnBackendSyncFailure);
      }
    }
  },

  remove(id: string) {
    let all = this.getAll();
    all = all.filter(s => s.id !== id);
    saveUserDB(STORAGE_KEYS.signatures, all);

    // Bridge: Async call to backend
    const session = auth.getSession();
    if (session?.tenantId) {
      fetchAPI(`/tenants/${session.tenantId}/signatures/${id}`, {
        method: 'DELETE',
      }).catch(warnBackendSyncFailure);
    }
  },

  getDefault(): Signature | null {
    return this.getAll().find(s => s.isDefault) || null;
  },

  setDefault(id: string) {
    const all = this.getAll();
    all.forEach(s => s.isDefault = s.id === id);
    saveUserDB(STORAGE_KEYS.signatures, all);
  },
};

// ---- Theme Functions ----
export const theme = {
  get(): 'light' | 'dark' {
    return loadUserDB<'light' | 'dark'>(STORAGE_KEYS.theme, 'light');
  },

  set(mode: 'light' | 'dark') {
    saveUserDB(STORAGE_KEYS.theme, mode);
    document.documentElement.setAttribute('data-theme', mode);
  },

  toggle(): 'light' | 'dark' {
    const current = this.get();
    const next = current === 'light' ? 'dark' : 'light';
    this.set(next);
    return next;
  },

  init() {
    let mode = this.get();
    if (!localStorage.getItem(STORAGE_KEYS.theme)) {
        mode = 'light';
        this.set(mode);
    }
    document.documentElement.setAttribute('data-theme', mode);
  },
};
