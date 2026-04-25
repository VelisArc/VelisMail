// VelisMail API Client — Fully local, no backend dependency
// Uses localStorage for session persistence

// ---- Local Storage DB ----
const STORAGE_KEYS = {
  users: 'velismail_users',
  session: 'velismail_session',
  emails: 'velismail_emails',
  domains: 'velismail_domains',
  contacts: 'velismail_contacts',
  theme: 'velismail_theme',
  signatures: 'velismail_signatures',
};

const PERSONAL_MAIL_DOMAIN = 'velismail.online';

function loadDB<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch { return fallback; }
}

function saveDB<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ---- Types ----
export type User = {
  id: string;
  email: string;
  displayName: string;
  plan: string;
  accountType: 'personal' | 'business';
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
  personalMailboxLocalPart?: string;
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
// No dummy emails — real welcome email is created dynamically during registration in auth.register()
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

function resolveApiBaseCandidates(): string[] {
  const configured = normalizeConfiguredApiUrl(String(import.meta.env.VITE_API_URL || ''));
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
    pushCandidate(configured.replace(/\/api\/v1$/, '/v1'));
  } else if (configured.endsWith('/api')) {
    pushCandidate(`${configured}/v1`);
    pushCandidate(configured.replace(/\/api$/, '/v1'));
  } else if (configured.endsWith('/v1')) {
    pushCandidate(configured.replace(/\/v1$/, '/api/v1'));
    pushCandidate(configured);
  } else {
    pushCandidate(`${configured}/api/v1`);
    pushCandidate(`${configured}/v1`);
  }

  return candidates;
}

const API_BASE_CANDIDATES = resolveApiBaseCandidates();

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  if (API_BASE_CANDIDATES.length === 0) {
    throw new Error('VITE_API_URL is missing. Point the frontend to your deployed VM API before using auth, setup, or mail actions.');
  }

  const token = localStorage.getItem('velismail_token');
  const headers = new Headers(options.headers || {});

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let lastError: Error | null = null;

  for (let index = 0; index < API_BASE_CANDIDATES.length; index += 1) {
    const baseUrl = API_BASE_CANDIDATES[index];
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
      return response.json();
    }

    const errorBody = await response.text();
    let errorMessage = `API Error ${response.status}`;
    try {
      const jsonError = JSON.parse(errorBody);
      errorMessage = jsonError.message || errorMessage;
    } catch {
      errorMessage = errorBody || errorMessage;
    }

    if (response.status === 404 && index < API_BASE_CANDIDATES.length - 1) {
      lastError = new Error(errorMessage);
      continue;
    }

    throw new Error(errorMessage);
  }

  throw lastError || new Error('Unable to reach the VelisMail API.');
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

function buildPersonalMailbox(localPart: string): string {
  return `${normalizeLocalPart(localPart)}@${PERSONAL_MAIL_DOMAIN}`;
}

function normalizeEmail(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeMailbox(value: string): string {
  return normalizeEmail(value);
}

function getLoginCandidates(user: Partial<User>): string[] {
  const candidates = new Set<string>();
  const pushCandidate = (value?: string) => {
    const normalized = normalizeMailbox(value || '');
    if (normalized) {
      candidates.add(normalized);
    }
  };

  pushCandidate(user.email);
  pushCandidate(user.recoveryEmail);
  pushCandidate(user.pendingRecoveryEmail);
  pushCandidate(user.businessMailboxAddress);

  if (user.accountType === 'personal') {
    const localPart = user.personalMailboxLocalPart || normalizeLocalPart((user.email || '').split('@')[0] || '');
    if (localPart) {
      candidates.add(localPart);
      candidates.add(buildPersonalMailbox(localPart));
    }
  }

  return Array.from(candidates);
}

function normalizeStoredUser(user: User & { password: string }): User & { password: string } {
  const normalizedEmail = normalizeMailbox(user.email);
  const normalizedBusinessDomain = normalizeDomainInput(user.businessDomain || user.businessProfile?.domain || user.customDomain || '');
  const businessMailboxAddress = normalizeMailbox(
    user.businessMailboxAddress ||
    (normalizedBusinessDomain && normalizedEmail.endsWith(`@${normalizedBusinessDomain}`) ? normalizedEmail : ''),
  );
  const recoveryEmail = normalizeMailbox(
    user.recoveryEmail ||
    (user.accountType === 'business' && normalizedEmail !== businessMailboxAddress ? normalizedEmail : ''),
  );

  return {
    ...user,
    email: normalizedEmail,
    customDomain: user.customDomain ? normalizeDomainInput(user.customDomain) : user.customDomain,
    recoveryEmail: recoveryEmail || undefined,
    recoveryEmailVerified: Boolean(user.recoveryEmailVerified || recoveryEmail),
    pendingRecoveryEmail: normalizeMailbox(user.pendingRecoveryEmail || '') || undefined,
    personalMailboxLocalPart: user.accountType === 'personal'
      ? (user.personalMailboxLocalPart || normalizeLocalPart((normalizedEmail || '').split('@')[0] || ''))
      : undefined,
    businessDomain: normalizedBusinessDomain || undefined,
    businessMailboxAddress: businessMailboxAddress || undefined,
    businessProfile: user.businessProfile ? {
      ...user.businessProfile,
      domain: user.businessProfile.domain ? normalizeDomainInput(user.businessProfile.domain) : user.businessProfile.domain,
    } : user.businessProfile,
  };
}

function loadUsers(): (User & { password: string })[] {
  const rawUsers = loadDB<(User & { password: string })[]>(STORAGE_KEYS.users, []);
  const normalizedUsers = rawUsers.map(normalizeStoredUser);
  if (JSON.stringify(rawUsers) !== JSON.stringify(normalizedUsers)) {
    saveDB(STORAGE_KEYS.users, normalizedUsers);
  }
  return normalizedUsers;
}

function saveUsers(users: (User & { password: string })[]) {
  saveDB(STORAGE_KEYS.users, users);
}

function findUserByLogin(users: (User & { password: string })[], identifier: string) {
  const normalizedIdentifier = normalizeMailbox(identifier);
  const personalMailboxCandidate = identifier.includes('@') ? normalizedIdentifier : buildPersonalMailbox(identifier);
  const localPartCandidate = normalizeLocalPart(identifier);

  return users.find((user) => {
    const candidates = getLoginCandidates(user);
    return (
      candidates.includes(normalizedIdentifier) ||
      candidates.includes(personalMailboxCandidate) ||
      candidates.includes(localPartCandidate)
    );
  });
}

function hasLoginConflict(users: (User & { password: string })[], userId: string | undefined, values: string[]) {
  const normalizedValues = values
    .map((value) => normalizeMailbox(value))
    .filter(Boolean);

  return users.find((user) => {
    if (user.id === userId) {
      return false;
    }
    const candidates = getLoginCandidates(user);
    return normalizedValues.some((value) => candidates.includes(value));
  });
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
    if (session.accountType === 'business') {
      const allDomains = loadUserDB<CustomDomain[]>(STORAGE_KEYS.domains, []);
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

// ---- Auth Functions ----
export const auth = {
  async sendOtp(data: {
    email?: string;
    identifier?: string;
    displayName?: string;
    purpose?: 'register' | 'recovery_email' | 'password_reset';
  }): Promise<OtpSendResponse> {
    return fetchAPI('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        purpose: data.purpose || 'register',
      }),
    });
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
    return this.sendOtp(data);
  },

  async verifyRegistrationOtp(data: {
    email: string;
    otp: string;
    challengeToken: string;
    purpose?: 'register';
  }): Promise<OtpVerifyResponse> {
    return this.verifyOtp(data);
  },

  async register(data: {
    email: string;
    password: string;
    displayName: string;
    accountType: 'personal' | 'business';
    customDomain?: string;
    recoveryEmail?: string;
    personalMailboxLocalPart?: string;
  }): Promise<{ success: boolean; error?: string; user?: User }> {
    const users = loadUsers();
    const normalizedRecoveryEmail = normalizeMailbox(data.recoveryEmail || '');
    const normalizedCustomDomain = data.customDomain ? normalizeDomainInput(data.customDomain) : undefined;
    const primaryEmail = data.accountType === 'personal'
      ? buildPersonalMailbox(data.personalMailboxLocalPart || data.email)
      : normalizeMailbox(data.email);

    if (!primaryEmail) {
      return { success: false, error: 'A valid account email is required.' };
    }

    if (data.accountType === 'personal' && !primaryEmail.endsWith(`@${PERSONAL_MAIL_DOMAIN}`)) {
      return { success: false, error: `Personal mailboxes must use @${PERSONAL_MAIL_DOMAIN}.` };
    }

    if (data.accountType === 'business' && !normalizedRecoveryEmail) {
      return { success: false, error: 'Business signup requires a recovery email for verification.' };
    }

    const conflict = hasLoginConflict(users, undefined, [primaryEmail, normalizedRecoveryEmail]);
    if (conflict) {
      return { success: false, error: 'An account with this email already exists.' };
    }

    const newUser: User & { password: string } = {
      id: 'usr_' + Math.random().toString(36).slice(2, 8),
      email: primaryEmail,
      displayName: data.displayName,
      password: data.password,
      plan: 'Starter',
      accountType: data.accountType,
      customDomain: normalizedCustomDomain,
      mailProvider: 'velismail',
      isSetupComplete: false,
      recoveryEmail: normalizedRecoveryEmail || undefined,
      recoveryEmailVerified: Boolean(normalizedRecoveryEmail),
      personalMailboxLocalPart: data.accountType === 'personal'
        ? normalizeLocalPart(data.personalMailboxLocalPart || data.email)
        : undefined,
      createdAt: new Date().toISOString(),
    };
    try {
      await fetchAPI('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: primaryEmail,
          display_name: data.displayName,
          password: data.password,
          recovery_email: normalizedRecoveryEmail || undefined,
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
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Registration failed.' };
    }

    users.push(newUser);
    saveUsers(users);

    // Auto-login
    const { password: _, ...safeUser } = newUser;
    saveDB(STORAGE_KEYS.session, safeUser);
    reloadAccountCaches();

    // Add welcome email
    const welcomeEmail: Email = {
      id: 'em_welcome_' + Math.random().toString(36).slice(2, 6),
      from: 'welcome@velismail.online',
      fromName: 'VelisMail',
      to: [safeUser.businessMailboxAddress || safeUser.email],
      subject: `🎉 Welcome to VelisMail, ${data.displayName}!`,
      body: `Hello ${data.displayName},\n\nYour secure mailbox is ready.\n\nPrimary mailbox: ${safeUser.businessMailboxAddress || safeUser.email}\nAccount type: ${data.accountType === 'business' ? 'Business' : 'Personal'}\n${normalizedCustomDomain ? `Custom domain: ${normalizedCustomDomain}` : ''}\n${normalizedRecoveryEmail ? `Recovery email: ${normalizedRecoveryEmail}` : ''}\n\nYou can now:\n• Send and receive encrypted emails\n• Configure custom domains in Settings\n• Manage your security preferences\n\nWelcome aboard!\n— VelisMail Team`,
      date: new Date().toISOString(),
      folder: 'inbox', unread: true, starred: false, labels: ['welcome'], hasAttachment: false,
    };
    emailsCache.unshift(welcomeEmail);
    saveUserDB(STORAGE_KEYS.emails, emailsCache);

    return { success: true, user: safeUser };
  },

  async login(email: string, password: string): Promise<{ success: boolean; error?: string; user?: User }> {
    const users = loadUsers();
    const found = findUserByLogin(users, email);
    if (!found || found.password !== password) {
      return { success: false, error: 'Invalid email or password.' };
    }
    try {
      const res = await fetchAPI('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: found.recoveryEmail || found.email,
          password,
        }),
      });

      if (!res || typeof res.access_token !== 'string') {
        return { success: false, error: 'Backend authentication failed.' };
      }

      localStorage.setItem('velismail_token', res.access_token);
      if (typeof res.refresh_token === 'string') {
        localStorage.setItem('velismail_refresh', res.refresh_token);
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Login failed.' };
    }
    const { password: _, ...safeUser } = found;
    saveDB(STORAGE_KEYS.session, safeUser);
    reloadAccountCaches();
    return { success: true, user: safeUser };
/*
    // Exchange credentials with the VM backend for a real JWT. The previous
    // build sent a hard-coded "password" string which meant the backend
    // never actually authenticated the user — only the local store did.
    fetchAPI('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: safeUser.businessMailboxAddress || safeUser.email,
        password,
      }),
    })
      .then((res) => {
        if (res && typeof res.access_token === 'string') {
          localStorage.setItem('velismail_token', res.access_token);
          if (typeof res.refresh_token === 'string') {
            localStorage.setItem('velismail_refresh', res.refresh_token);
          }
        }
      })
      .catch(() => {
        // Backend unreachable — frontend still works in offline/localStorage mode.
      });
*/
  },

  loginPasskey(_email: string): { success: boolean; error?: string; user?: User } {
    return { success: false, error: 'Passkey login is not enabled on this deployment yet.' };
  },

  async requestPasswordReset(identifier: string): Promise<OtpSendResponse> {
    const matchedUser = findUserByLogin(loadUsers(), identifier);
    return this.sendOtp({
      identifier: matchedUser?.recoveryEmail || matchedUser?.email || identifier,
      purpose: 'password_reset',
    });
  },

  async resetPassword(data: {
    identifier: string;
    verificationToken: string;
    newPassword: string;
  }): Promise<{ success: boolean; message?: string; error?: string }> {
    const normalizedIdentifier = normalizeMailbox(data.identifier);
    const matchedUser = findUserByLogin(loadUsers(), normalizedIdentifier);
    const backendIdentifier = matchedUser?.recoveryEmail || matchedUser?.email || normalizedIdentifier;

    await fetchAPI('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        identifier: backendIdentifier,
        verificationToken: data.verificationToken,
        newPassword: data.newPassword,
      }),
    });

    const users = loadUsers();
    const userToUpdate = findUserByLogin(users, normalizedIdentifier);
    if (userToUpdate) {
      userToUpdate.password = data.newPassword;
      saveUsers(users);
    }

    return {
      success: true,
      message: 'Password updated successfully.',
    };
  },

  logout() {
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem('velismail_token');
    localStorage.removeItem('velismail_refresh');
    emailsCache = [];
  },

  getSession(): User | null {
    const session = loadDB<User | null>(STORAGE_KEYS.session, null);
    if (session && sessionHasMismatch(session)) {
      console.warn('Session mismatch detected — logging out for safety.');
      this.logout();
      return null;
    }
    return session;
  },

  isLoggedIn(): boolean {
    return !!this.getSession();
  },

  updateSettings(settings: Partial<User>): { success: boolean; user?: User; error?: string } {
    const session = this.getSession();
    if (!session) return { success: false };
    
    // Update users DB
    const users = loadUsers();
    const userIndex = users.findIndex(u => u.id === session.id);
    if (userIndex === -1) return { success: false };

    const nextUser = normalizeStoredUser({
      ...users[userIndex],
      ...settings,
      email: settings.email ? normalizeMailbox(settings.email) : users[userIndex].email,
      recoveryEmail: Object.prototype.hasOwnProperty.call(settings, 'recoveryEmail')
        ? normalizeMailbox(settings.recoveryEmail || '')
        : users[userIndex].recoveryEmail,
      pendingRecoveryEmail: Object.prototype.hasOwnProperty.call(settings, 'pendingRecoveryEmail')
        ? normalizeMailbox(settings.pendingRecoveryEmail || '')
        : users[userIndex].pendingRecoveryEmail,
      businessMailboxAddress: Object.prototype.hasOwnProperty.call(settings, 'businessMailboxAddress')
        ? normalizeMailbox(settings.businessMailboxAddress || '')
        : users[userIndex].businessMailboxAddress,
      customDomain: Object.prototype.hasOwnProperty.call(settings, 'customDomain')
        ? normalizeDomainInput(settings.customDomain || '')
        : users[userIndex].customDomain,
      businessDomain: Object.prototype.hasOwnProperty.call(settings, 'businessDomain')
        ? normalizeDomainInput(settings.businessDomain || '')
        : users[userIndex].businessDomain,
    });
    const wantsPersonalComplete = settings.isSetupComplete === true;
    const wantsBusinessComplete = settings.isBusinessSetupComplete === true;

    const loginConflict = hasLoginConflict(users, session.id, [
      nextUser.email,
      nextUser.recoveryEmail || '',
      nextUser.pendingRecoveryEmail || '',
      nextUser.businessMailboxAddress || '',
    ]);
    if (loginConflict) {
      return { success: false, error: 'That email is already being used by another VelisMail account.' };
    }

    if (
      wantsPersonalComplete &&
      (!nextUser.customDbUrl ||
        !nextUser.apiKey ||
        (nextUser.mailProvider === 'custom_webhook' && !nextUser.mailProviderEndpoint))
    ) {
      return { success: false, error: 'Personal setup is incomplete.' };
    }

    if (
      wantsBusinessComplete &&
      (!nextUser.businessDbUrl ||
        !nextUser.businessApiKey ||
        (nextUser.businessMailProvider === 'custom_webhook' && !nextUser.businessMailProviderEndpoint) ||
        !nextUser.businessDomain ||
        !nextUser.businessDomainVerified ||
        nextUser.dkimStatus !== 'verified' ||
        nextUser.spfStatus !== 'verified' ||
        nextUser.dmarcStatus !== 'verified')
    ) {
      return { success: false, error: 'Business setup is incomplete or your domain is not fully verified.' };
    }

    const updatedUser = nextUser;
    users[userIndex] = updatedUser;
    saveUsers(users);

    // Update Session
    const { password: _, ...safeUser } = updatedUser;
    saveDB(STORAGE_KEYS.session, safeUser);
    
    return { success: true, user: safeUser };
  },

  async changePassword(currentPassword: string, nextPassword: string): Promise<{ success: boolean; error?: string }> {
    const session = this.getSession();
    if (!session) return { success: false, error: 'Session not found.' };

    const users = loadUsers();
    const userIndex = users.findIndex(u => u.id === session.id);
    if (userIndex === -1) return { success: false, error: 'User not found.' };
    if (users[userIndex].password !== currentPassword) {
      return { success: false, error: 'Current password incorrect hai.' };
    }

    try {
      await fetchAPI('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          identifier: session.recoveryEmail || session.email,
          currentPassword,
          newPassword: nextPassword,
        }),
      });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Password update failed.' };
    }

    users[userIndex] = {
      ...users[userIndex],
      password: nextPassword,
    };
    saveUsers(users);

    return { success: true };
  },

  deleteAccount(): { success: boolean } {
    const session = this.getSession();
    if (!session) return { success: false };

    const users = loadUsers();
    const remainingUsers = users.filter(user => user.id !== session.id);
    saveUsers(remainingUsers);

    const sessionEmail = session.email.toLowerCase();
    const remainingEmails = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS).filter(email => {
      const fromMatch = (email.from || '').toLowerCase() === sessionEmail;
      const toMatch = (email.to || []).some(recipient => recipient.toLowerCase() === sessionEmail);
      return !fromMatch && !toMatch;
    });
    emailsCache = remainingEmails;
    saveUserDB(STORAGE_KEYS.emails, remainingEmails);

    const currentDomains = loadUserDB<CustomDomain[]>(STORAGE_KEYS.domains, []).filter(domain => domain.domain !== session.businessDomain);
    saveUserDB(STORAGE_KEYS.domains, currentDomains);

    this.logout();
    return { success: true };
  },
};

// ---- Email Functions ----
export const mail = {
  getByFolder(folder: string): Email[] {
    emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    if (folder === 'starred') return emailsCache.filter(e => e.starred && e.folder !== 'trash');
    if (folder === 'spam') return emailsCache.filter(e => (e.folder === 'spam' || isScamEmail(e)) && e.folder !== 'trash');
    return emailsCache.filter(e => e.folder === folder);
  },

  // Business-specific helpers — operate on emails related to a business domain
  getBusinessByFolder(domain: string, folder: string): Email[] {
    emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, SEED_EMAILS);
    const normalizeDomain = (addr: string) => (addr && addr.includes('@')) ? addr.split('@')[1].toLowerCase() : '';
    return emailsCache.filter(e => {
      const folderMatches = folder === 'spam'
        ? (e.folder === 'spam' || isScamEmail(e)) && e.folder !== 'trash'
        : e.folder === folder;
      if (!folderMatches) return false;
      const fromDomain = normalizeDomain(e.from || '');
      const toDomains = (e.to || []).map(t => normalizeDomain(t));
      return fromDomain === domain.toLowerCase() || toDomains.includes(domain.toLowerCase());
    });
  },

  async sendBusiness(domain: string, to: string[], subject: string, body: string): Promise<Email> {
    const session = auth.getSession();
    const fromAddr = `admin@${domain}`;
    await fetchAPI('/mail/send', {
      method: 'POST',
      body: JSON.stringify({
        to,
        subject,
        body,
        from: fromAddr,
        fromName: session?.displayName || 'Business',
        provider: session?.businessMailProvider,
        apiKey: session?.businessApiKey,
        providerEndpoint: session?.businessMailProviderEndpoint,
      }),
    });
    const email: Email = {
      id: 'bem_' + Math.random().toString(36).slice(2, 8),
      from: fromAddr,
      fromName: session?.displayName || 'Business',
      to, subject, body,
      date: new Date().toISOString(),
      folder: 'sent', unread: false, starred: false, labels: [], hasAttachment: false,
    };
    emailsCache.unshift(email);
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
    return email;
  },

  getBusinessUnreadCount(domain: string): number {
    return this.getBusinessByFolder(domain, 'inbox').filter(e => e.unread).length;
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
    const e = emailsCache.find(e => e.id === id);
    if (e) e.folder = 'trash';
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  toggleStar(id: string): boolean {
    const e = emailsCache.find(e => e.id === id);
    if (e) e.starred = !e.starred;
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
    return e?.starred ?? false;
  },

  markRead(id: string) {
    const e = emailsCache.find(e => e.id === id);
    if (e) e.unread = false;
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  markUnread(id: string) {
    const e = emailsCache.find(e => e.id === id);
    if (e) e.unread = true;
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  archive(id: string) {
    const e = emailsCache.find(e => e.id === id);
    if (e) e.folder = 'archive';
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  moveFolder(id: string, folder: string) {
    const e = emailsCache.find(e => e.id === id);
    if (e) e.folder = folder;
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  permanentDelete(id: string) {
    emailsCache = emailsCache.filter(e => e.id !== id);
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  markAllRead(folder: string) {
    emailsCache.forEach(e => {
      if (e.folder === folder) e.unread = false;
    });
    saveUserDB(STORAGE_KEYS.emails, emailsCache);
  },

  getUnreadCount(): number {
    return emailsCache.filter(e => e.unread).length;
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

    const verificationToken = 'velismail-verify=' + Math.random().toString(36).slice(2, 14);
    const newDomain: CustomDomain = {
      id: 'dom_' + Math.random().toString(36).slice(2, 8),
      domain: normalizedDomain,
      status: 'pending',
      verificationToken,
      dnsRecords: buildDnsRecords(normalizedDomain, verificationToken),
      checks: buildDomainChecks(normalizedDomain, verificationToken),
      addedAt: new Date().toISOString(),
    };
    allDomains.push(newDomain);
    saveUserDB(STORAGE_KEYS.domains, allDomains);
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
    return c;
  },

  update(id: string, data: Partial<Contact>) {
    const all = this.getAll();
    const idx = all.findIndex(c => c.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...data };
      saveUserDB(STORAGE_KEYS.contacts, all);
    }
  },

  remove(id: string) {
    let all = this.getAll();
    all = all.filter(c => c.id !== id);
    saveUserDB(STORAGE_KEYS.contacts, all);
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
    return sig;
  },

  update(id: string, data: Partial<Signature>) {
    const all = this.getAll();
    const idx = all.findIndex(s => s.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...data };
      saveUserDB(STORAGE_KEYS.signatures, all);
    }
  },

  remove(id: string) {
    let all = this.getAll();
    all = all.filter(s => s.id !== id);
    saveUserDB(STORAGE_KEYS.signatures, all);
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
    const mode = this.get();
    document.documentElement.setAttribute('data-theme', mode);
  },
};
