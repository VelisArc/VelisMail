import { getConnectionHostLabel } from '../config/providers';
import type {
  User, DnsRecord,
  ProviderDnsRecordInput, DomainCheck, CustomDomain, BusinessMailbox,
  BusinessGroup, BusinessTeamMember, TeamAccessInvite, BusinessTemplate,
  BusinessMailQueueItem, BusinessAuditEntry, ConnectionUsage,
  PlatformAdminUserRecord, Email,
  ApiJsonDetailedResult,
} from './types';

// ---- Local Storage DB ----
export const STORAGE_KEYS = {
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
  signatures: 'velismail_signatures',
};

export const TEAM_INVITES_KEY = 'velismail_team_access_invites';

export const DURABLE_STORAGE_KEYS = new Set<string>([
  STORAGE_KEYS.session,
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

export const memoryDB: Record<string, unknown> = {};

export function loadDB<T>(key: string, fallback: T): T {
  if (DURABLE_STORAGE_KEYS.has(key) || key.startsWith(`${STORAGE_KEYS.emails}_`) || key.startsWith(`${STORAGE_KEYS.domains}_`) || key.startsWith(`${STORAGE_KEYS.businessMailboxes}_`) || key.startsWith(`${STORAGE_KEYS.businessGroups}_`) || key.startsWith(`${STORAGE_KEYS.businessTeam}_`) || key.startsWith(`${STORAGE_KEYS.businessTemplates}_`) || key.startsWith(`${STORAGE_KEYS.businessQueue}_`) || key.startsWith(`${STORAGE_KEYS.businessAudit}_`) || key.startsWith(`${STORAGE_KEYS.contacts}_`) || key.startsWith(`${STORAGE_KEYS.signatures}_`)) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch { return fallback; }
  }
  return memoryDB[key] !== undefined ? memoryDB[key] as T : fallback;
}

export function saveDB<T>(key: string, data: T) {
  if (DURABLE_STORAGE_KEYS.has(key) || key.startsWith(`${STORAGE_KEYS.emails}_`) || key.startsWith(`${STORAGE_KEYS.domains}_`) || key.startsWith(`${STORAGE_KEYS.businessMailboxes}_`) || key.startsWith(`${STORAGE_KEYS.businessGroups}_`) || key.startsWith(`${STORAGE_KEYS.businessTeam}_`) || key.startsWith(`${STORAGE_KEYS.businessTemplates}_`) || key.startsWith(`${STORAGE_KEYS.businessQueue}_`) || key.startsWith(`${STORAGE_KEYS.businessAudit}_`) || key.startsWith(`${STORAGE_KEYS.contacts}_`) || key.startsWith(`${STORAGE_KEYS.signatures}_`)) {
    localStorage.setItem(key, JSON.stringify(data));
  } else {
    memoryDB[key] = data;
  }
}

// ---- Seed Data ----
export const SEED_EMAILS: Email[] = [];

export function normalizeConfiguredApiUrl(value: string): string {
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

export function expandApiBaseCandidates(input: string): string[] {
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

export function inferRuntimeApiOrigins(): string[] {
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

export function friendlyApiError(endpoint: string, status: number, fallback: string): string {
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

export function isJwtLikelyUsable(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payloadPart = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = payloadPart.padEnd(payloadPart.length + ((4 - (payloadPart.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(paddedPayload));
    if (typeof payload.exp !== 'number') return true;
    return payload.exp * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
}

export function clearBackendTokens() {
  localStorage.removeItem('velismail_token');
  localStorage.removeItem('velismail_refresh');
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
    throw new Error('Unable to resolve the VelisMail API URL.');
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

export async function fetchAPI(endpoint: string, options: RequestInit = {}) {
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
export function getSessionSafe(): User | null {
  try {
    return loadDB<User | null>(STORAGE_KEYS.session, null);
  } catch {
    return null;
  }
}

export function userScopedKey(key: string): string {
  const s = getSessionSafe();
  return s && s.id ? `${key}_${s.id}` : key;
}

export function loadUserDB<T>(key: string, fallback: T): T {
  return loadDB<T>(userScopedKey(key), fallback);
}

export function saveUserDB<T>(key: string, data: T) {
  saveDB(userScopedKey(key), data);
}

export function loadTeamAccessInvites(): TeamAccessInvite[] {
  try {
    const raw = localStorage.getItem(TEAM_INVITES_KEY) || sessionStorage.getItem(TEAM_INVITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTeamAccessInvites(invites: TeamAccessInvite[]) {
  localStorage.setItem(TEAM_INVITES_KEY, JSON.stringify(invites));
  sessionStorage.setItem(TEAM_INVITES_KEY, JSON.stringify(invites));
}

export function generateTeamAccessToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `vmt_${encoded}`;
}

export type TeamAccessApiResponse = {
  success?: boolean;
  invite?: TeamAccessInvite;
  message?: string;
  error?: string;
};

export type CreateTeamAccessInviteParams = {
  issuer: User;
  email: string;
  name: string;
  role: BusinessTeamMember['role'];
  expiresInHours: number;
};

export function buildTeamAccessInvite(params: CreateTeamAccessInviteParams): TeamAccessInvite {
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
      businessMailWebhookSecret: params.issuer.businessMailWebhookSecret,
      businessMailboxAddress: params.issuer.businessMailboxAddress,
      businessDomainVerified: params.issuer.businessDomainVerified,
      businessProfile: params.issuer.businessProfile,
      isBusinessSetupComplete: params.issuer.isBusinessSetupComplete,
    },
  };
}

export function cacheTeamAccessInvite(invite: TeamAccessInvite) {
  const next = [
    invite,
    ...loadTeamAccessInvites().filter((entry) => entry.token !== invite.token && entry.email !== invite.email),
  ];
  saveTeamAccessInvites(next);
}

export function hasTeamAccessWorkspace(invite?: TeamAccessInvite): invite is TeamAccessInvite {
  return Boolean(invite?.workspace?.businessDbUrl && invite.workspace.businessApiKey && invite.workspace.businessMailProvider);
}

export function validateCachedTeamAccessToken(token: string): { ok: boolean; invite?: TeamAccessInvite; error?: string } {
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

export async function postTeamAccess(endpoint: string, body: unknown): Promise<{
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

export function teamAccessApiError(response: TeamAccessApiResponse | null, fallback: string): string {
  return response?.message || response?.error || fallback;
}

export function warnBackendSyncFailure(err: unknown) {
  if (
    err instanceof Error
    && (
      err.message.includes('route was not found')
      || err.message.includes('API Error 404')
      || err.message.includes('API Error 401')
    )
  ) return;
  console.warn('VelisMail backend sync failed:', err);
}

export function providerEndpointForRequest(provider?: string, endpoint?: string): string | undefined {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (normalizedProvider !== 'custom_webhook' && normalizedProvider !== 'amazonses') {
    return undefined;
  }
  const trimmedEndpoint = String(endpoint || '').trim();
  if (!trimmedEndpoint) {
    return undefined;
  }
  try {
    const url = new URL(trimmedEndpoint);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return undefined;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function syncBridge(endpoint: string, options: RequestInit = {}) {
  void fetchAPI(endpoint, options).catch(warnBackendSyncFailure);
}

export function isBusinessSetupReady(user?: Pick<User,
  'businessDbUrl' |
  'businessApiKey' |
  'businessDomain' |
  'businessMailProvider' |
  'businessMailWebhookSecret' |
  'isBusinessSetupComplete' |
  'businessDomainVerified'
> | null): boolean {
  if (!user) return false;
  const hasCoreInfrastructure = Boolean(
    user.businessDbUrl?.trim()
    && user.businessApiKey?.trim()
    && user.businessDomain?.trim()
    && user.businessMailProvider?.trim()
    && user.isBusinessSetupComplete
    && user.businessDomainVerified,
  );
  if (!hasCoreInfrastructure) return false;
  if (user.businessMailProvider === 'resend') {
    return Boolean(user.businessMailWebhookSecret?.trim());
  }
  return true;
}

export function saveUserToPersistentStore(user: User) {
  const users = loadDB<Record<string, User>>('velismail_users_db', {});
  users[user.email] = user;
  saveDB('velismail_users_db', users);
}

export function loadPersistentUsers(): Record<string, User> {
  return loadDB<Record<string, User>>('velismail_users_db', {});
}

export function savePersistentUsers(users: Record<string, User>) {
  saveDB('velismail_users_db', users);
}

export function getUserFromPersistentStore(email: string): User | null {
  const users = loadDB<Record<string, User>>('velismail_users_db', {});
  return users[normalizeMailbox(email)] || null;
}

export function initEmails(): Email[] {
  return loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
}

export let emailsCache = initEmails();

export function reloadAccountCaches() {
  emailsCache = initEmails();
}

export function reloadEmailsCacheFromStorage(): Email[] {
  emailsCache = initEmails();
  return emailsCache;
}

export function normalizeDomainInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^mail\./, '')
    .replace(/\/.*$/, '');
}

export function normalizeLocalPart(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]/g, '');
}

export function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeMailbox(value: string): string {
  return normalizeEmail(value);
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function maskApiSecret(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'Not configured';
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function maskDatabaseSecret(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'Not configured';
  const protocol = trimmed.split('://')[0] || 'db';
  return `${protocol}://${getConnectionHostLabel(trimmed)}`;
}

export function normalizeBusinessMailboxEntry(entry: Partial<BusinessMailbox>, domain: string): BusinessMailbox {
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

export function normalizeBusinessGroupEntry(entry: Partial<BusinessGroup>, domain: string): BusinessGroup {
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

export function getSystemBusinessMailbox(domain: string): BusinessMailbox {
  const session = getSessionSafe();
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

export function loadBusinessMailboxes(domain?: string): BusinessMailbox[] {
  const stored = loadUserDB<BusinessMailbox[]>(STORAGE_KEYS.businessMailboxes, []);
  const normalizedDomain = normalizeDomainInput(domain || '');
  const normalized = stored
    .map((entry) => normalizeBusinessMailboxEntry(entry, entry.domain || normalizedDomain))
    .filter((entry) => entry.domain);
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
  const finalEntries = Array.from(new Map(normalizedActiveEntries.map(m => [m.address, m])).values());
  const untouched = deduped.filter((entry) => entry.domain !== normalizedDomain);
  saveUserDB(STORAGE_KEYS.businessMailboxes, [...untouched, ...finalEntries]);
  return finalEntries;
}

export function saveBusinessMailboxes(domain: string, entries: BusinessMailbox[]) {
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

export function loadBusinessGroups(domain?: string): BusinessGroup[] {
  const stored = loadUserDB<BusinessGroup[]>(STORAGE_KEYS.businessGroups, []);
  const normalizedDomain = normalizeDomainInput(domain || '');
  return stored
    .map((entry) => normalizeBusinessGroupEntry(entry, entry.domain || normalizedDomain))
    .filter((entry) => !normalizedDomain || entry.domain === normalizedDomain);
}

export function saveBusinessGroups(domain: string, entries: BusinessGroup[]) {
  const normalizedDomain = normalizeDomainInput(domain);
  const untouched = loadUserDB<BusinessGroup[]>(STORAGE_KEYS.businessGroups, [])
    .filter((entry) => normalizeDomainInput(entry.domain) !== normalizedDomain);
  const normalizedEntries = entries.map((entry) => normalizeBusinessGroupEntry(entry, normalizedDomain));
  saveUserDB(STORAGE_KEYS.businessGroups, [...untouched, ...normalizedEntries]);
}

export function loadBusinessTeamMembers(): BusinessTeamMember[] {
  return loadUserDB<BusinessTeamMember[]>(STORAGE_KEYS.businessTeam, []);
}

export function saveBusinessTeamMembers(entries: BusinessTeamMember[]) {
  saveUserDB(STORAGE_KEYS.businessTeam, entries);
}

export function loadBusinessTemplates(): BusinessTemplate[] {
  return loadUserDB<BusinessTemplate[]>(STORAGE_KEYS.businessTemplates, []);
}

export function saveBusinessTemplates(entries: BusinessTemplate[]) {
  saveUserDB(STORAGE_KEYS.businessTemplates, entries);
}

export function normalizeBusinessQueueEntry(entry: Partial<BusinessMailQueueItem>): BusinessMailQueueItem {
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

export function loadBusinessQueue(domain?: string): BusinessMailQueueItem[] {
  const normalizedDomain = normalizeDomainInput(domain || '');
  return loadUserDB<BusinessMailQueueItem[]>(STORAGE_KEYS.businessQueue, [])
    .map(normalizeBusinessQueueEntry)
    .filter((entry) => !normalizedDomain || entry.domain === normalizedDomain)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function saveBusinessQueue(entries: BusinessMailQueueItem[]) {
  saveUserDB(STORAGE_KEYS.businessQueue, entries.map(normalizeBusinessQueueEntry));
}

export function loadBusinessAuditEntries(): BusinessAuditEntry[] {
  return loadUserDB<BusinessAuditEntry[]>(STORAGE_KEYS.businessAudit, []);
}

export function saveBusinessAuditEntries(entries: BusinessAuditEntry[]) {
  saveUserDB(STORAGE_KEYS.businessAudit, entries);
}

export function buildConnectionUsage(type: 'database' | 'mail-provider', user: User, value: string, provider?: string): ConnectionUsage {
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

export const RESEND_INBOUND_MX_HOST = 'inbound-smtp.us-east-1.amazonaws.com';
export const RESEND_INBOUND_MX_EXPECTED = 'The inbound MX record listed by your mail provider for this domain region';

export function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function normalizeDnsValue(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

export function dnsRecordIdentity(record: DnsRecord): string {
  return [
    record.type.toUpperCase(),
    normalizeDnsName(record.name),
    normalizeDnsValue(record.value),
  ].join(':');
}

export function isLegacyDnsRecord(record: DnsRecord): boolean {
  const value = `${record.name} ${record.value}`.toLowerCase();
  return (
    value.includes('mx1.velismail.online') ||
    value.includes('mx2.velismail.online') ||
    value.includes('include:velismail.online') ||
    value.includes('velismail._domainkey') ||
    (record.type === 'MX' && normalizeDnsValue(record.value) === RESEND_INBOUND_MX_HOST)
  );
}

export function isResendInboundMxValue(value: string): boolean {
  const normalized = normalizeDnsValue(value);
  return normalized === RESEND_INBOUND_MX_HOST ||
    (normalized.startsWith('inbound-smtp.') && normalized.endsWith('.amazonaws.com'));
}

export function hasRequiredManualDnsRecords(records: DnsRecord[], domain: string): boolean {
  const normalizedDomain = normalizeDnsName(domain);
  return (
    records.some(record => record.type === 'TXT' && normalizeDnsName(record.name) === `_velismail-verify.${normalizedDomain}`) &&
    records.some(record => record.type === 'MX' && normalizeDnsName(record.name) === normalizedDomain && isResendInboundMxValue(record.value)) &&
    records.some(record => record.type === 'TXT' && normalizeDnsName(record.name) === `_dmarc.${normalizedDomain}`)
  );
}

export function mergeDnsRecords(baseRecords: DnsRecord[], extraRecords: DnsRecord[]): DnsRecord[] {
  const merged: DnsRecord[] = [];
  const seen = new Set<string>();
  const combinedRecords = [...baseRecords, ...extraRecords];
  const providerRegionMxNames = new Set(
    combinedRecords
      .filter((record) => record.type === 'MX' && isResendInboundMxValue(record.value) && normalizeDnsValue(record.value) !== RESEND_INBOUND_MX_HOST)
      .map((record) => normalizeDnsName(record.name)),
  );
  combinedRecords.forEach((record) => {
    const name = record.name.trim().replace(/\.$/, '');
    const value = record.value.trim().replace(/\.$/, '');
    if (!name || !value) return;
    const normalized: DnsRecord = {
      ...record,
      type: record.type.toUpperCase() as DnsRecord['type'],
      name,
      value,
      ttl: record.ttl || 3600,
      priority: record.priority || undefined,
    };
    if (
      normalized.type === 'MX' &&
      normalizeDnsValue(normalized.value) === RESEND_INBOUND_MX_HOST &&
      providerRegionMxNames.has(normalizeDnsName(normalized.name))
    ) {
      return;
    }
    const key = dnsRecordIdentity(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(normalized);
  });
  return merged;
}

export function normalizeProviderDnsRecords(records: ProviderDnsRecordInput[], domain?: string): DnsRecord[] {
  const normalizedDomain = domain ? normalizeDnsName(domain) : '';
  return records
    .map((record): DnsRecord | null => {
      const type = String(record.recordType || record.record_type || record.type || '').trim().toUpperCase();
      if (type !== 'TXT' && type !== 'MX' && type !== 'CNAME') {
        return null;
      }
      const rawName = String(record.name || record.host || '').trim().replace(/\.$/, '');
      const name = rawName === '@' && normalizedDomain ? normalizedDomain : rawName;
      const value = String(record.value || record.content || record.data || '').trim().replace(/\.$/, '');
      if (!name || !value) {
        return null;
      }
      return {
        type,
        name,
        value,
        priority: typeof record.priority === 'number' ? record.priority : undefined,
        ttl: typeof record.ttl === 'number' ? record.ttl : 3600,
      };
    })
    .filter((record): record is DnsRecord => Boolean(record));
}

export function buildDnsRecords(domain: string, verificationToken: string): DnsRecord[] {
  return [
    { type: 'TXT', name: `_velismail-verify.${domain}`, value: verificationToken, ttl: 300 },
    { type: 'TXT', name: `_dmarc.${domain}`, value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`, ttl: 3600 },
  ];
}

export function hasLegacyDnsRecords(records: DnsRecord[]): boolean {
  return records.some(isLegacyDnsRecord);
}

export function buildDomainChecks(domain: string, verificationToken: string): DomainCheck[] {
  return [
    { key: 'txt', label: 'Ownership TXT', status: 'pending', expected: verificationToken },
    { key: 'mx', label: 'Inbound MX', status: 'pending', expected: RESEND_INBOUND_MX_EXPECTED },
    { key: 'spf', label: 'Provider SPF', status: 'pending', expected: 'Verified by mail provider' },
    { key: 'dkim', label: 'Provider DKIM', status: 'pending', expected: 'Verified by mail provider' },
    { key: 'dmarc', label: 'DMARC', status: 'pending', expected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}` },
  ];
}

export function normalizeStoredDomain(domain: Partial<CustomDomain> & { id: string; domain: string; status?: 'pending' | 'verified' | 'failed' }): CustomDomain {
  const normalizedDomain = normalizeDomainInput(domain.domain);
  const verificationToken = domain.verificationToken || 'velismail-verify=' + Math.random().toString(36).slice(2, 14);
  const fallbackChecks = buildDomainChecks(normalizedDomain, verificationToken);
  const checks = Array.isArray(domain.checks) && domain.checks.length > 0 ? domain.checks : fallbackChecks;
  const storedDnsRecords = Array.isArray(domain.dnsRecords) ? domain.dnsRecords : [];
  const cleanedStoredRecords = storedDnsRecords.filter(record => !isLegacyDnsRecord(record));
  const dnsRecords = storedDnsRecords.length > 0 && !hasLegacyDnsRecords(storedDnsRecords) && hasRequiredManualDnsRecords(storedDnsRecords, normalizedDomain)
    ? mergeDnsRecords([], storedDnsRecords)
    : mergeDnsRecords(
        buildDnsRecords(normalizedDomain, verificationToken),
        cleanedStoredRecords,
      );
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

export function sessionHasMismatch(session: User | null): boolean {
  if (!session) return false;
  if (session.teamAccessRole) return false;
  if (session.accountType === 'business') {
    if (!session.isBusinessSetupComplete) {
      return false;
    }
    const allDomains = loadUserDB<CustomDomain[]>(STORAGE_KEYS.domains, []);
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

export function normalizeSessionUser(session: User): User {
  const normalized = { ...session };
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
  if ((normalized.plan || 'Free').toLowerCase() === 'free') {
    delete normalized.paidPlanPurchasedAt;
    delete normalized.paidPlanExpiresAt;
    normalized.subscriptionStatus = 'active';
  } else {
    const purchasedAt = normalized.paidPlanPurchasedAt || normalized.planStartedAt || normalized.createdAt || new Date().toISOString();
    normalized.paidPlanPurchasedAt = purchasedAt;
    normalized.paidPlanExpiresAt = normalized.paidPlanExpiresAt || addBillingPeriod(purchasedAt, normalized.billingCycle);
    normalized.subscriptionStatus = new Date(normalized.paidPlanExpiresAt).getTime() < Date.now() ? 'expired' : (normalized.subscriptionStatus || 'active');
  }
  return normalized;
}

export function addBillingPeriod(startIso: string, billingCycle: 'monthly' | 'annual'): string {
  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) {
    return addBillingPeriod(new Date().toISOString(), billingCycle);
  }
  if (billingCycle === 'annual') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    date.setMonth(date.getMonth() + 1);
  }
  return date.toISOString();
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1] || '';
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

export function stringFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export async function fetchAuthenticatedProfile(): Promise<Partial<User>> {
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
      businessDbUrl: settings.businessDbUrl || settings.business_db_url || raw.business_db_url || raw.businessDbUrl,
      businessApiKey: settings.businessApiKey || settings.business_api_key || raw.business_api_key || raw.businessApiKey,
      businessMailProvider: settings.businessMailProvider || settings.business_mail_provider || raw.business_mail_provider || raw.businessMailProvider,
      businessMailProviderEndpoint: settings.businessMailProviderEndpoint || settings.business_mail_provider_endpoint || raw.business_mail_provider_endpoint || raw.businessMailProviderEndpoint,
      businessMailWebhookSecret: settings.businessMailWebhookSecret || settings.business_mail_webhook_secret || raw.business_mail_webhook_secret || raw.businessMailWebhookSecret,
      businessDomain: settings.businessDomain || settings.business_domain || raw.business_domain || raw.businessDomain,
      isBusinessSetupComplete: settings.isBusinessSetupComplete ?? settings.is_business_setup_complete ?? raw.is_business_setup_complete ?? raw.isBusinessSetupComplete,
      businessDomainVerified: settings.businessDomainVerified ?? settings.business_domain_verified ?? raw.business_domain_verified ?? raw.businessDomainVerified,
      businessProfile: settings.businessProfile || settings.business_profile || raw.business_profile || raw.businessProfile,
    };
  } catch {
    return {};
  }
}

export function buildSessionUser(params: {
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
    businessMailWebhookSecret: profile.businessMailWebhookSecret || params.existing?.businessMailWebhookSecret,
    businessMailboxAddress: profile.businessMailboxAddress || params.existing?.businessMailboxAddress || businessMailboxAddress,
    businessDomainVerified: profile.businessDomainVerified ?? params.existing?.businessDomainVerified ?? false,
    businessProfile: profile.businessProfile || params.existing?.businessProfile,
    dkimStatus: params.existing?.dkimStatus || 'pending',
    spfStatus: params.existing?.spfStatus || 'pending',
    dmarcStatus: params.existing?.dmarcStatus || 'pending',
    createdAt: String(profile.createdAt || params.existing?.createdAt || new Date().toISOString()),
  });
}

export function loginIdentifierCandidates(identifier: string): string[] {
  const normalized = normalizeMailbox(identifier);
  if (normalized && !normalized.includes('@')) {
    return [`admin@${normalizeDomainInput(normalized)}`];
  }
  return normalized ? [normalized] : [];
}

export function scopedExistingSession(email: string): User | null {
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

// ---- OTP Helpers ----
export function getLocalOtpUsage(email: string, purpose: string) {
  const normalizedEmail = normalizeMailbox(email);
  const today = new Date().toISOString().slice(0, 10);
  const key = `velismail_otp_daily_${today}`;
  const usage = loadDB<Record<string, number>>(key, {});
  const usageKey = `${purpose}:${normalizedEmail}`;
  return { normalizedEmail, key, usage, usageKey };
}

export function assertLocalOtpLimit(email: string, purpose: string) {
  const { normalizedEmail, usage, usageKey } = getLocalOtpUsage(email, purpose);
  if (!normalizedEmail) return;
  if ((usage[usageKey] || 0) >= 3) {
    throw new Error('Daily OTP limit reached. You can request up to 3 verification codes per email per day.');
  }
}

export function recordLocalOtpSend(email: string, purpose: string) {
  const { normalizedEmail, key, usage, usageKey } = getLocalOtpUsage(email, purpose);
  if (!normalizedEmail) return;
  usage[usageKey] = (usage[usageKey] || 0) + 1;
  saveDB(key, usage);
}

// ---- Business Email Internals ----
export function normalizeBusinessEmailFromDb(raw: Partial<Email> & {
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

export function syncBusinessEmailToDb(email: Email) {
  const session = getSessionSafe();
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
  });
}

export let businessEmailDbRouteUnavailable = false;

export function setBusinessEmailDbRouteUnavailable(val: boolean) {
  businessEmailDbRouteUnavailable = val;
}

export function folderMatchesBusinessView(email: Email, folder: string): boolean {
  if (folder === 'starred') return email.starred && email.folder !== 'trash';
  if (folder === 'spam') return (email.folder === 'spam' || isScamEmail(email)) && email.folder !== 'trash';
  if (folder === 'priority') return (email.labels || []).includes('priority') && email.folder !== 'trash';
  if (folder === 'scheduled') return email.folder === 'scheduled';
  return email.folder === folder;
}

export function mutateEmail(id: string, updater: (email: Email) => Email | void): Email | undefined {
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

export function isScamEmail(email: Email): boolean {
  const text = `${email.subject} ${email.body}`.toLowerCase();
  const suspicious = ['win', 'winner', 'prize', 'congrat', 'urgent', 'password', 'account', 'verify', 'click', 'bank', 'transaction', 'limited time', 'claim', 'invoice', 'payment'];
  if (suspicious.some(w => text.includes(w))) return true;
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const urls = (email.body || '').match(urlRegex) || [];
  if (urls.length >= 2) return true;
  if ((email.from || '').toLowerCase().includes('no-reply') && /verify|confirm|activate/.test(text)) return true;
  return false;
}

// ---- Admin Helpers ----
export function scopedRecordCount<T>(key: string, userId: string): number {
  return loadDB<T[]>(`${key}_${userId}`, []).length;
}

export function scopedEmailCount(userId: string): number {
  return scopedRecordCount<Email>(STORAGE_KEYS.emails, userId);
}

export function estimateUserStorageBytes(user: User): number {
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

export function userRisk(record: Omit<PlatformAdminUserRecord, 'risk'>): PlatformAdminUserRecord['risk'] {
  if (record.status === 'suspended' || record.status === 'deactivated') return 'high';
  if (record.auditCount > 25 || record.queueCount > 1000) return 'medium';
  return 'low';
}
