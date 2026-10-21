import {
  STORAGE_KEYS,
  loadDB, saveDB, loadUserDB, saveUserDB,
  emailsCache, reloadAccountCaches, reloadEmailsCacheFromStorage,
  normalizeMailbox, normalizeDomainInput, normalizeLocalPart,
  hashString,
  isJwtLikelyUsable, clearBackendTokens,
  normalizeSessionUser, buildSessionUser,
  loginIdentifierCandidates, scopedExistingSession,
  fetchAuthenticatedProfile,
  saveUserToPersistentStore, loadPersistentUsers, savePersistentUsers,
  fetchApiJsonDetailed,
  providerEndpointForRequest,
  fetchAPI,
  getSessionSafe,
  loadBusinessMailboxes, saveBusinessMailboxes,
  loadBusinessGroups, saveBusinessGroups,
  loadBusinessTeamMembers, saveBusinessTeamMembers,
  loadBusinessTemplates, saveBusinessTemplates,
  normalizeBusinessQueueEntry, loadBusinessQueue, saveBusinessQueue,
  loadBusinessAuditEntries, saveBusinessAuditEntries,
  loadAutoReply, saveAutoReply,
  loadLabels, saveLabels,
  loadRules, saveRules,
  getSystemBusinessMailbox,
  normalizeBusinessMailboxEntry, normalizeBusinessGroupEntry,
  buildConnectionUsage,
  assertLocalOtpLimit, recordLocalOtpSend,
  buildTeamAccessInvite,
  loadTeamAccessInvites, saveTeamAccessInvites,
  cacheTeamAccessInvite, hasTeamAccessWorkspace,
  validateCachedTeamAccessToken, postTeamAccess, teamAccessApiError,
  syncBridge, warnBackendSyncFailure,
  EMPTY_EMAILS,
  normalizeBusinessEmailFromDb, syncBusinessEmailToDb,
  businessEmailDbRouteUnavailable, setBusinessEmailDbRouteUnavailable,
   folderMatchesBusinessView, mutateEmail,
   saveEmailsSyncAndAsync,
  normalizeStoredDomain, buildDnsRecords, buildDomainChecks,
  sessionHasMismatch, mergeDnsRecords,
  isLegacyDnsRecord,
  safeRandomUUID, deleteBusinessEmailFromDb,
} from './client-core';
import type {
  User, DnsRecord, DomainCheck, CustomDomain, BusinessMailbox,
  BusinessGroup, BusinessTeamMember, TeamAccessInvite, BusinessTemplate,
  BusinessMailQueueItem, BusinessAuditEntry, ConnectionUsage,
  Email, OtpSendResponse, OtpVerifyResponse,
  ActiveSession, Contact, Signature, AutoReply, Label, EmailRule,
  EmailRuleCondition, EmailRuleAction,
} from './types';
import type { CreateTeamAccessInviteParams } from './client-core';
import { signInWithGoogle, signOutFirebase } from '../lib/firebase';

// ---- Auth Functions ----
export const auth = {
  async sendOtp(data: {
    email?: string;
    identifier?: string;
    displayName?: string;
    purpose?: 'register' | 'recovery_email' | 'password_reset';
  }): Promise<OtpSendResponse> {
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
      return {
        success: false,
        error: message.includes('Invalid workspace email/domain or password')
          ? 'Account creation completed, but automatic sign-in did not finish. Sign in with your domain and password to continue setup.'
          : message,
      };
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

  /**
   * Firebase Google sign-in. The ID token is verified server-side by the auth
   * service; the browser never decides whether an account is valid.
   */
  async loginWithGoogle(): Promise<{ success: boolean; error?: string; user?: User }> {
    try {
      const identity = await signInWithGoogle();
      if (!identity.idToken || !identity.email) {
        return { success: false, error: 'Google did not return an email address for this account.' };
      }
      const existingLocal = scopedExistingSession(identity.email);
      const res = await fetchAPI('/auth/firebase', {
        method: 'POST',
        body: JSON.stringify({ idToken: identity.idToken, deviceId: 'google-web' }),
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
        email: identity.email,
        displayName: identity.displayName,
        profile,
        existing: existingLocal,
      });
      safeUser.firebaseUid = identity.uid;
      if (identity.photoUrl && !safeUser.profileImageUrl) safeUser.profileImageUrl = identity.photoUrl;

      if (safeUser.status === 'suspended' || safeUser.status === 'deactivated') {
        this.logout();
        await signOutFirebase();
        return { success: false, error: 'This account is not active. Contact VelisMail support for review or recovery.' };
      }

      saveDB(STORAGE_KEYS.session, safeUser);
      saveUserToPersistentStore(safeUser);
      reloadAccountCaches();
      return { success: true, user: safeUser };
    } catch (error) {
      await signOutFirebase();
      const message = error instanceof Error ? error.message : 'Google sign-in failed.';
      if (message.includes('popup-closed-by-user')) {
        return { success: false, error: 'Google sign-in was cancelled.' };
      }
      if (message.includes('popup-blocked')) {
        return { success: false, error: 'Your browser blocked the Google popup. Allow popups and try again.' };
      }
      if (message.includes('unauthorized') || message.includes('not authorized')) {
        return { success: false, error: 'Google sign-in succeeded, but this account is not provisioned for VelisMail.' };
      }
      return { success: false, error: message };
    }
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
    localStorage.removeItem(STORAGE_KEYS.session);
    localStorage.removeItem('velismail_token');
    localStorage.removeItem('velismail_refresh');
    sessionStorage.removeItem('velismail-session');
    emailsCache.length = 0;
  },

  getSession(): User | null {
    const session = loadDB<User | null>(STORAGE_KEYS.session, null);
    const normalizedSession = session ? normalizeSessionUser(session) : null;
    const backendToken = localStorage.getItem('velismail_token');
    const hasAuthenticatedSession = Boolean(
      normalizedSession?.teamAccessRole || isJwtLikelyUsable(backendToken),
    );
    if (normalizedSession && !hasAuthenticatedSession) {
      this.logout();
      return null;
    }
    if (session && normalizedSession && JSON.stringify(session) !== JSON.stringify(normalizedSession)) {
      saveDB(STORAGE_KEYS.session, normalizedSession);
    }
    if (normalizedSession && sessionHasMismatch(normalizedSession)) {
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

    const token = localStorage.getItem('velismail_token');
    if (isJwtLikelyUsable(token)) {
      fetchAPI('/auth/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }).catch((error) => {
        if (error instanceof Error && /not authorized|401/i.test(error.message)) {
          clearBackendTokens();
        }
      });
    } else if (token) {
      clearBackendTokens();
    }

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

// ---- Audit Functions ----
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
      id: entry.id || `aud_${safeRandomUUID().split('-').join('').slice(0, 8)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      action: entry.action,
      actor: entry.actor,
      target: entry.target,
      severity: entry.severity,
    };
    this.save([nextEntry, ...all]);
    return nextEntry;
  },
  getByDomain(_domain: string): BusinessAuditEntry[] {
    return this.getAll();
  },
};

// ---- Queue Functions ----
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

  clearSent(domain?: string) {
    const all = domain ? loadBusinessQueue(domain) : loadBusinessQueue();
    saveBusinessQueue(all.filter((entry) => entry.status !== 'sent'));
    return all.filter((entry) => entry.status === 'sent').length;
  },
  getByDomain(domain: string): BusinessMailQueueItem[] {
    return this.getAll(domain);
  },
  runDue(domain?: string) {
    const due = this.getAll(domain).filter(item =>
      item.status === 'queued' && item.scheduledAt && new Date(item.scheduledAt).getTime() <= Date.now()
    );
    due.forEach(item => this.mark(item.id, { status: 'sending' }));
    return due.length;
  },
  retry(_domain: string, id: string) {
    const all = loadBusinessQueue();
    const item = all.find(i => i.id === id);
    if (item) {
      this.mark(item.id, { status: 'queued', retryCount: 0, error: undefined });
    }
  },
};

let businessMailboxDbRouteUnavailable = false;
/**
 * A customer database that is unreachable must not slow the dashboard down on
 * every request. After a failed call the database is skipped for a short
 * while and the local cache is used instead.
 */
let businessDbUnreachableUntil = 0;
const BUSINESS_DB_BACKOFF_MS = 60_000;

function businessDbIsUnreachable(): boolean {
  return Date.now() < businessDbUnreachableUntil;
}

function markBusinessDbUnreachable() {
  businessDbUnreachableUntil = Date.now() + BUSINESS_DB_BACKOFF_MS;
}

type BusinessMailboxApiEntry = Partial<BusinessMailbox> & {
  display_name?: string;
  created_at?: string;
  last_used_at?: string | null;
};

type BusinessMailboxApiResponse = {
  success?: boolean;
  mailbox?: BusinessMailboxApiEntry;
  mailboxes?: BusinessMailboxApiEntry[];
  message?: string;
  error?: string;
};

function isMailboxAddress(value: string): boolean {
  const normalized = normalizeMailbox(value);
  if (!normalized || normalized.length > 254 || normalized.includes('..')) return false;
  const [local, domain, ...extra] = normalized.split('@');
  if (!local || !domain || extra.length > 0) return false;
  if (local.length > 64 || domain.length > 253 || !domain.includes('.')) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    && domain.split('.').every((label) => (
      label.length > 0
      && label.length <= 63
      && !label.startsWith('-')
      && !label.endsWith('-')
      && /^[a-z0-9-]+$/.test(label)
    ));
}

function normalizeBusinessMailboxFromApi(entry: BusinessMailboxApiEntry, fallbackDomain: string): BusinessMailbox {
  return normalizeBusinessMailboxEntry({
    ...entry,
    displayName: entry.displayName || entry.display_name,
    createdAt: entry.createdAt || entry.created_at,
    lastUsedAt: entry.lastUsedAt || entry.last_used_at || undefined,
  }, entry.domain || fallbackDomain);
}

function businessMailboxApiError(response: BusinessMailboxApiResponse | null, fallback: string): string {
  return response?.message || response?.error || fallback;
}

function isTransientBusinessDbError(status: number, message: string): boolean {
  return status >= 500 || /pool timed out|open connection|timeout|connection/i.test(message);
}

function businessMailboxDbHeaders(dbUrl: string): Record<string, string> {
  return { 'x-business-db-url': dbUrl };
}

async function fetchBusinessMailboxesFromDb(domain: string): Promise<BusinessMailbox[] | null> {
  const session = getSessionSafe();
  if (!session?.businessDbUrl || businessMailboxDbRouteUnavailable) return null;
  if (businessDbIsUnreachable()) return null;

  const response = await fetchApiJsonDetailed<BusinessMailboxApiResponse>('/mail/business-mailboxes/query', {
    method: 'POST',
    headers: businessMailboxDbHeaders(session.businessDbUrl),
    body: JSON.stringify({
      dbUrl: session.businessDbUrl,
      domain: normalizeDomainInput(domain),
    }),
  });

  if (response.status === 404) {
    businessMailboxDbRouteUnavailable = true;
    return null;
  }

  if (!response.ok || !response.data?.success || !Array.isArray(response.data.mailboxes)) {
    const message = businessMailboxApiError(response.data, 'Unable to load mailboxes from the business database.');
    if (isTransientBusinessDbError(response.status, message)) {
      if (response.status === 503) markBusinessDbUnreachable();
      warnBackendSyncFailure(new Error(message));
      return null;
    }
    throw new Error(message);
  }

  return response.data.mailboxes.map((entry) => normalizeBusinessMailboxFromApi(entry, domain));
}

async function upsertBusinessMailboxToDb(mailbox: BusinessMailbox): Promise<void> {
  const session = getSessionSafe();
  if (!session?.businessDbUrl) return;
  if (businessMailboxDbRouteUnavailable) {
    throw new Error('Business mailbox database route is unavailable. Try again after the backend deploy finishes.');
  }

  const response = await fetchApiJsonDetailed<BusinessMailboxApiResponse>('/mail/business-mailboxes', {
    method: 'POST',
    headers: businessMailboxDbHeaders(session.businessDbUrl),
    body: JSON.stringify({
      dbUrl: session.businessDbUrl,
      mailbox,
    }),
  });

  if (response.status === 404) {
    businessMailboxDbRouteUnavailable = true;
  }
  if (!response.ok || !response.data?.success) {
    throw new Error(businessMailboxApiError(response.data, 'Unable to save mailbox to the business database.'));
  }
}

async function deleteBusinessMailboxFromDb(domain: string, address: string): Promise<void> {
  const session = getSessionSafe();
  if (!session?.businessDbUrl) return;
  if (businessMailboxDbRouteUnavailable) {
    throw new Error('Business mailbox database route is unavailable. Try again after the backend deploy finishes.');
  }

  const response = await fetchApiJsonDetailed<BusinessMailboxApiResponse>('/mail/business-mailboxes', {
    method: 'DELETE',
    headers: businessMailboxDbHeaders(session.businessDbUrl),
    body: JSON.stringify({
      dbUrl: session.businessDbUrl,
      domain: normalizeDomainInput(domain),
      address: normalizeMailbox(address),
    }),
  });

  if (response.status === 404) {
    businessMailboxDbRouteUnavailable = true;
  }
  if (!response.ok || !response.data?.success) {
    throw new Error(businessMailboxApiError(response.data, 'Unable to delete mailbox from the business database.'));
  }
}

// ---- Mailbox Functions ----
export const businessMailboxes = {
  getByDomain(domain: string): BusinessMailbox[] {
    return loadBusinessMailboxes(domain);
  },

  async syncFromDb(domain: string): Promise<BusinessMailbox[]> {
    const normalizedDomain = normalizeDomainInput(domain);
    const localEntries = loadBusinessMailboxes(normalizedDomain);
    const remoteEntries = await fetchBusinessMailboxesFromDb(normalizedDomain);
    if (!remoteEntries) return localEntries;

    const remoteByAddress = new Map(remoteEntries.map((entry) => [entry.address.toLowerCase(), entry]));

    // Any local entry (including custom mailboxes) that is not in the remote database should be seeded
    const unsyncedLocal = localEntries.filter((entry) => !remoteByAddress.has(entry.address.toLowerCase()));

    const entriesToSeed = [...unsyncedLocal];

    if (entriesToSeed.length > 0) {
      await Promise.all(entriesToSeed.map((entry) => upsertBusinessMailboxToDb(entry)));
    }

    const mergedEntries = Array.from(
      new Map(
        [...remoteEntries, ...entriesToSeed].map((entry) => [entry.address.toLowerCase(), entry])
      ).values(),
    );
    saveBusinessMailboxes(normalizedDomain, mergedEntries);
    return loadBusinessMailboxes(normalizedDomain);
  },

  getPrimary(domain: string): BusinessMailbox {
    return this.getByDomain(domain).find((entry) => entry.active) || this.getByDomain(domain)[0] || getSystemBusinessMailbox(domain);
  },

  async create(domain: string, data: {
    localPart?: string;
    address?: string;
    displayName?: string;
    kind?: BusinessMailbox['kind'];
    aliases?: string[];
  }): Promise<BusinessMailbox> {
    const normalizedDomain = normalizeDomainInput(domain);
    const entries = await this.syncFromDb(normalizedDomain);
    const normalizedAddress = normalizeMailbox(
      data.address || `${normalizeLocalPart(data.localPart || data.displayName || 'mailbox')}@${normalizedDomain}`,
    );
    if (!isMailboxAddress(normalizedAddress)) {
      throw new Error('Enter a valid mailbox address.');
    }
    if (!normalizedAddress.endsWith(`@${normalizedDomain}`)) {
      throw new Error(`Mailbox must use @${normalizedDomain}.`);
    }
    if (entries.some((entry) => entry.address === normalizedAddress)) {
      throw new Error('This mailbox already exists for the selected domain.');
    }

    const shouldBePrimary = data.kind === 'primary' || !entries.some((entry) => entry.active);
    const existingEntries = shouldBePrimary
      ? entries.map((entry) => ({
        ...entry,
        active: false,
        kind: entry.kind === 'primary' ? 'mailbox' as const : entry.kind,
      }))
      : entries;
    const mailbox = normalizeBusinessMailboxEntry({
      address: normalizedAddress,
      displayName: data.displayName || normalizedAddress.split('@')[0],
      kind: shouldBePrimary ? 'primary' : data.kind || 'mailbox',
      aliases: data.aliases || [],
      active: shouldBePrimary,
      source: 'custom',
    }, normalizedDomain);
    const nextEntries = [...existingEntries, mailbox];
    if (getSessionSafe()?.businessDbUrl) {
      await Promise.all(nextEntries.map((entry) => upsertBusinessMailboxToDb(entry)));
    }
    saveBusinessMailboxes(normalizedDomain, nextEntries);

    if (shouldBePrimary) {
      auth.updateSettings({
        businessMailboxAddress: normalizedAddress,
        email: normalizedAddress,
      });
    }

    const session = auth.getSession();
    businessAudit.add({
      action: 'Created mailbox',
      actor: session?.email || mailbox.address,
      target: mailbox.address,
      severity: 'info',
    });
    return mailbox;
  },

  async setPrimary(domain: string, address: string): Promise<BusinessMailbox[]> {
    const normalizedDomain = normalizeDomainInput(domain);
    const normalizedAddress = normalizeMailbox(address);
    const current = await this.syncFromDb(normalizedDomain);
    const updated = current.map((entry) => ({
      ...entry,
      active: entry.address === normalizedAddress,
      kind: entry.address === normalizedAddress ? 'primary' as const : entry.kind === 'primary' ? 'mailbox' as const : entry.kind,
    }));
    if (!updated.some((entry) => entry.active)) {
      throw new Error('Selected mailbox was not found for this domain.');
    }
    if (getSessionSafe()?.businessDbUrl) {
      await Promise.all(updated.map((entry) => upsertBusinessMailboxToDb(entry)));
    }
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
    let touchedMailbox: BusinessMailbox | undefined;
    const updated = this.getByDomain(normalizedDomain).map((entry) => (
      entry.address === normalizedAddress
        ? (touchedMailbox = { ...entry, lastUsedAt: new Date().toISOString() })
        : entry
    ));
    saveBusinessMailboxes(normalizedDomain, updated);
    if (touchedMailbox && getSessionSafe()?.businessDbUrl) {
      void upsertBusinessMailboxToDb(touchedMailbox).catch(warnBackendSyncFailure);
    }
  },

  async remove(domain: string, address: string): Promise<BusinessMailbox[]> {
    const normalizedDomain = normalizeDomainInput(domain);
    const normalizedAddress = normalizeMailbox(address);
    const current = await this.syncFromDb(normalizedDomain);
    const target = current.find((entry) => entry.address === normalizedAddress);
    if (!target) {
      throw new Error('Mailbox was not found for the selected domain.');
    }
    const next = current.filter((entry) => entry.address !== normalizedAddress);
    if (next.length === 0) {
      throw new Error('At least one business mailbox must remain on the domain.');
    }
    if (!next.some((entry) => entry.active)) {
      next[0] = { ...next[0], active: true, kind: 'primary' };
    }
    if (getSessionSafe()?.businessDbUrl) {
      await deleteBusinessMailboxFromDb(normalizedDomain, normalizedAddress);
      await Promise.all(next.map((entry) => upsertBusinessMailboxToDb(entry)));
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

// ---- Group Functions ----
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

    const session = auth.getSession();
    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/groups`, {
        method: 'POST',
        body: JSON.stringify(group),
      });
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

    const session = auth.getSession();
    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updated.find(e => e.id === id)),
      });
    }
  },

  remove(domain: string, id: string) {
    const normalizedDomain = normalizeDomainInput(domain);
    const current = this.getByDomain(normalizedDomain);
    const group = current.find((entry) => entry.id === id);
    saveBusinessGroups(normalizedDomain, current.filter((entry) => entry.id !== id));

    const session = auth.getSession();
    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/groups/${id}`, {
        method: 'DELETE',
      });
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

// ---- Team Functions ----
export const businessTeam = {
  getAll(): BusinessTeamMember[] {
    return loadBusinessTeamMembers();
  },
  save(entries: BusinessTeamMember[]) {
    saveBusinessTeamMembers(entries);
  },
  getByDomain(_domain: string): BusinessTeamMember[] {
    return this.getAll();
  },
  updateRole(id: string, role: 'admin' | 'member' | 'viewer') {
    const all = this.getAll();
    const idx = all.findIndex(m => m.email === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], role };
      this.save(all);
    }
  },
  remove(email: string) {
    this.save(this.getAll().filter(m => m.email !== email));
  },
};

// ---- Team Access Functions ----
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

// ---- Template Functions ----
export const businessTemplates = {
  getAll(): BusinessTemplate[] {
    return loadBusinessTemplates();
  },
  save(entries: BusinessTemplate[]) {
    saveBusinessTemplates(entries);
  },
  getByDomain(_domain: string): BusinessTemplate[] {
    return this.getAll();
  },
  delete(_domain: string, id: string) {
    this.save(this.getAll().filter(t => t.id !== id));
  },
};

// ---- Email/Mail Functions ----
export function applyEmailRules(emails: Email[]): Email[] {
  const activeRules = loadRules().filter(r => r.enabled);
  if (activeRules.length === 0) return emails;

  let changedAny = false;
  const updated = emails.map(email => {
    const emailCopy = { ...email };
    let emailChanged = false;

    for (const rule of activeRules) {
      const matches = rule.conditions.every(cond => {
        let fieldVal = '';
        if (cond.field === 'subject') fieldVal = email.subject || '';
        else if (cond.field === 'from') fieldVal = email.from || '';
        else if (cond.field === 'body') fieldVal = email.body || '';

        const testVal = String(cond.value || '').toLowerCase();
        fieldVal = fieldVal.toLowerCase();

        if (cond.operator === 'equals') return fieldVal === testVal;
        if (cond.operator === 'startsWith') return fieldVal.startsWith(testVal);
        return fieldVal.includes(testVal); // 'contains'
      });

      if (matches) {
        for (const action of rule.actions) {
          if (action.type === 'label' && action.value) {
            const labelSet = new Set(emailCopy.labels || []);
            if (!labelSet.has(action.value)) {
              labelSet.add(action.value);
              emailCopy.labels = Array.from(labelSet);
              emailChanged = true;
            }
          } else if (action.type === 'move' && action.value) {
            if (emailCopy.folder !== action.value) {
              emailCopy.folder = action.value;
              emailChanged = true;
            }
          } else if (action.type === 'star') {
            if (!emailCopy.starred) {
              emailCopy.starred = true;
              emailChanged = true;
            }
          } else if (action.type === 'markRead') {
            if (emailCopy.unread) {
              emailCopy.unread = false;
              emailChanged = true;
            }
          }
        }
      }
    }

    if (emailChanged) {
      changedAny = true;
      return emailCopy;
    }
    return email;
  });

  if (changedAny) {
    saveEmailsSyncAndAsync(STORAGE_KEYS.emails, updated);
  }
  return updated;
}

export function processAutoReply(domain: string, emails: Email[]) {
  try {
    const ar = autoReply.get();
    if (ar.enabled && ar.body) {
      const autoRepliedIds = loadDB<string[]>('velismail_autoreplied_ids', []);
      const newRepliedIds = [...autoRepliedIds];
      let sentAny = false;

      for (const email of emails) {
        if (email.folder === 'inbox' && !autoRepliedIds.includes(email.id)) {
          if (ar.onlyContacts) {
            const allContacts = loadUserDB<Contact[]>(STORAGE_KEYS.contacts, []);
            const isContact = allContacts.some(c => c.email.toLowerCase() === email.from.toLowerCase());
            if (!isContact) continue;
          }

          newRepliedIds.push(email.id);
          sentAny = true;
          
          const replySubject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
          const replyBody = `${ar.body}\n\nOn ${new Date(email.date).toLocaleString()}, ${email.fromName || email.from} wrote:\n> ${email.body.replace(/\n/g, '\n> ')}`;

          setTimeout(async () => {
            try {
              await mail.sendBusiness(domain, [email.from], replySubject, replyBody);
            } catch (err) {
              console.error('Failed to send auto-reply', err);
            }
          }, 100);
        }
      }

      if (sentAny) {
        saveDB('velismail_autoreplied_ids', newRepliedIds);
      }
    }
  } catch (e) {
    console.error('Auto-reply processing error', e);
  }
}

function stripHtmlTags(html: string): string {
  let text = html;
  // Replace break tags with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Replace paragraph close tags with double newlines
  text = text.replace(/<\/p>/gi, '\n\n');
  // Replace list items with bullets
  text = text.replace(/<li>/gi, '\n• ');
  // Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&amp;/g, '&')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'");
  return text.trim();
}

async function persistEmailMutation(
  id: string,
  updater: (email: Email) => Email | void,
): Promise<Email | undefined> {
  const updated = mutateEmail(id, updater, { sync: false });
  if (updated) {
    await syncBusinessEmailToDb(updated);
  }
  return updated;
}

export const mail = {
  getByFolder(folder: string): Email[] {
    const cached = reloadEmailsCacheFromStorage();
    return cached.filter(e => folderMatchesBusinessView(e, folder));
  },

  getBusinessByFolderSync(domain: string, folder: string): Email[] {
    const emailsCache = loadUserDB<Email[]>(STORAGE_KEYS.emails, EMPTY_EMAILS);
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
    let sourceEmails = loadUserDB<Email[]>(STORAGE_KEYS.emails, EMPTY_EMAILS);

    if (session?.businessDbUrl && !businessEmailDbRouteUnavailable && !businessDbIsUnreachable()) {
      const headers: Record<string, string> = {
        'x-business-db-url': session.businessDbUrl
      };
      const response = await fetchApiJsonDetailed<{ success?: boolean; emails?: Array<Partial<Email> & { read?: boolean }>; error?: string; message?: string }>('/mail/business-emails/query', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dbUrl: session.businessDbUrl }),
      });

      if (response.ok && response.data?.success && Array.isArray(response.data.emails)) {
        sourceEmails = response.data.emails.map((entry) => normalizeBusinessEmailFromDb(entry));
        saveEmailsSyncAndAsync(STORAGE_KEYS.emails, sourceEmails);
      } else if (response.status === 404) {
        setBusinessEmailDbRouteUnavailable(true);
      } else if (isTransientBusinessDbError(response.status, String(response.data?.error || response.data?.message || 'Business email database query failed.'))) {
        if (response.status === 503) markBusinessDbUnreachable();
        warnBackendSyncFailure(new Error(String(response.data?.error || response.data?.message || 'Business email database query failed.')));
      }
    }

    sourceEmails = applyEmailRules(sourceEmails);
    processAutoReply(domain, sourceEmails);

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
    const availableMailboxes = await businessMailboxes.syncFromDb(normalizedDomain);
    const requestedFromAddress = normalizeMailbox(fromAddress || '');
    const selectedMailbox = requestedFromAddress
      ? availableMailboxes.find((mailbox) => mailbox.address === requestedFromAddress)
      : availableMailboxes.find((mailbox) => mailbox.active) || availableMailboxes[0] || getSystemBusinessMailbox(normalizedDomain);
    if (requestedFromAddress && !selectedMailbox) {
      throw new Error(`${requestedFromAddress} is not connected to ${normalizedDomain}. Create or refresh the mailbox before sending.`);
    }
    if (!selectedMailbox) {
      throw new Error(`No sender mailbox is available for ${normalizedDomain}.`);
    }
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
    const invalidRecipient = expandedRecipients.find((recipient) => !isMailboxAddress(recipient));
    if (invalidRecipient) {
      throw new Error(`Invalid recipient address: ${invalidRecipient}`);
    }
    const mailboxAcceptsAddress = (address: string) => availableMailboxes.some(
      (mailbox) => mailbox.address === address || mailbox.aliases.includes(address),
    );
    const disconnectedLocalRecipient = expandedRecipients.find(
      (recipient) => recipient.endsWith(`@${normalizedDomain}`) && !mailboxAcceptsAddress(recipient),
    );
    if (disconnectedLocalRecipient) {
      throw new Error(`${disconnectedLocalRecipient} is not a connected mailbox for ${normalizedDomain}. Create it before sending internal mail.`);
    }
    if (!isMailboxAddress(fromAddr) || !fromAddr.endsWith(`@${normalizedDomain}`)) {
      throw new Error(`Sender mailbox must be a saved @${normalizedDomain} address.`);
    }
    if (!subject.trim() || !body.trim()) {
      throw new Error('Subject and message body are required.');
    }
    const hasHtml = /<[a-z][\s\S]*>/i.test(body);
    const htmlBody = hasHtml ? body : undefined;
    const plainBody = hasHtml ? stripHtmlTags(body) : body;

    const normalizedSchedule = scheduledAt ? new Date(scheduledAt).toISOString() : '';
    const queueEntry = businessQueue.enqueue({
      domain: normalizedDomain,
      fromAddress: fromAddr,
      to: expandedRecipients.join(', '),
      recipients: expandedRecipients,
      subject,
      body, // Enqueue original HTML body so it can be parsed later
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
        body: plainBody, // Save plain body locally for clean rendering
        htmlBody,
        date: new Date().toISOString(),
        folder: 'scheduled',
        unread: false,
        starred: false,
        labels: ['scheduled'],
        hasAttachment: attachments && attachments.length > 0 ? true : false,
        scheduledAt: normalizedSchedule,
      };
      const scheduledCache = reloadEmailsCacheFromStorage();
      scheduledCache.unshift(email);
      saveEmailsSyncAndAsync(STORAGE_KEYS.emails, scheduledCache);
      if (session?.businessDbUrl) {
        await syncBusinessEmailToDb(email);
      }
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
          body: plainBody,
          htmlBody: htmlBody || undefined,
          from: fromAddr,
          fromName: selectedMailbox.displayName || session?.displayName || 'Business',
          provider: session?.businessMailProvider,
          apiKey: session?.businessApiKey,
          dbUrl: session?.businessDbUrl,
          providerEndpoint: providerEndpointForRequest(session?.businessMailProvider, session?.businessMailProviderEndpoint),
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
      id: 'bem_' + safeRandomUUID().split('-')[0],
      from: fromAddr,
      fromName: selectedMailbox.displayName || session?.displayName || 'Business',
      to: expandedRecipients,
      subject,
      body: plainBody, // Save plain body locally for clean rendering
      htmlBody,
      date: new Date().toISOString(),
      folder: 'sent', unread: false, starred: false, labels: [], hasAttachment: attachments && attachments.length > 0 ? true : false,
    };
    const sendCache = reloadEmailsCacheFromStorage();
    const filteredCache = sendCache.filter(existing => existing.id !== email.id);
    filteredCache.unshift(email);
    saveEmailsSyncAndAsync(STORAGE_KEYS.emails, filteredCache);

    if (session?.businessDbUrl) {
      try {
        await syncBusinessEmailToDb(email);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sent copy database sync failed.';
        businessQueue.mark(queueEntry.id, { error: `Delivered, but sent-copy sync failed: ${message}` });
        businessAudit.add({
          action: 'Sent copy database sync failed',
          actor: fromAddr,
          target: expandedRecipients.join(', '),
          severity: 'warn',
        });
        throw new Error(`Mail was accepted for delivery, but VelisMail could not save the sent copy to the business database: ${message}`, { cause: error });
      }
    }
    const internalRecipients = expandedRecipients.filter(
      (recipient) => recipient.endsWith(`@${normalizedDomain}`) && mailboxAcceptsAddress(recipient),
    );
    if (internalRecipients.length > 0) {
      const internalCopies = internalRecipients.map((recipient): Email => ({
        id: `bem_in_${safeRandomUUID().split('-')[0]}_${hashString(recipient).slice(0, 6)}`,
        from: fromAddr,
        fromName: selectedMailbox.displayName || session?.displayName || 'Business',
        to: [recipient],
        subject,
        body: plainBody,
        htmlBody,
        date: new Date().toISOString(),
        folder: 'inbox',
        unread: true,
        starred: false,
        labels: ['internal'],
        hasAttachment: attachments && attachments.length > 0 ? true : false,
        messageId: email.messageId || email.id,
        threadId: email.threadId || email.messageId || email.id,
      }));
      if (session?.businessDbUrl) {
        try {
          await Promise.all(internalCopies.map((copy) => syncBusinessEmailToDb(copy)));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Internal delivery sync failed.';
          businessQueue.mark(queueEntry.id, { error: `Delivered, but internal inbox sync failed: ${message}` });
          businessAudit.add({
            action: 'Internal delivery database sync failed',
            actor: fromAddr,
            target: internalRecipients.join(', '),
            severity: 'warn',
          });
          throw new Error(`Mail was accepted for delivery, but VelisMail could not save the internal inbox copy to the business database: ${message}`, { cause: error });
        }
      }
      const internalCache = reloadEmailsCacheFromStorage();
      internalCache.unshift(...internalCopies);
      saveEmailsSyncAndAsync(STORAGE_KEYS.emails, internalCache);
      businessAudit.add({
        action: 'Stored internal delivery',
        actor: fromAddr,
        target: internalRecipients.join(', '),
        severity: 'info',
      });
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
    const unreadCache = reloadEmailsCacheFromStorage();
    const normalizeDomain = (addr: string) => (addr && addr.includes('@')) ? addr.split('@')[1].toLowerCase() : '';
    return unreadCache.filter(e => {
      if (e.folder !== 'inbox' || !e.unread) return false;
      const fromDomain = normalizeDomain(e.from || '');
      const toDomains = (e.to || []).map(t => normalizeDomain(t));
      return fromDomain === domain.toLowerCase() || toDomains.includes(domain.toLowerCase());
    }).length;
  },

  async send(to: string[], subject: string, body: string): Promise<Email> {
    const session = auth.getSession();
    const hasHtml = /<[a-z][\s\S]*>/i.test(body);
    const htmlBody = hasHtml ? body : undefined;
    const plainBody = hasHtml ? stripHtmlTags(body) : body;

    await fetchAPI('/mail/send', {
      method: 'POST',
      body: JSON.stringify({
        to,
        subject,
        body: plainBody,
        htmlBody: htmlBody || undefined,
        from: session?.email || 'you@velismail.online',
        fromName: session?.displayName || 'You',
        provider: session?.mailProvider,
        apiKey: session?.apiKey,
        providerEndpoint: providerEndpointForRequest(session?.mailProvider, session?.mailProviderEndpoint),
      }),
    });
    const email: Email = {
      id: 'em_' + safeRandomUUID().split('-')[0],
      from: session?.email || 'you@velismail.online',
      fromName: session?.displayName || 'You',
      to,
      subject,
      body: plainBody, // Save plain body locally for clean rendering
      htmlBody,
      date: new Date().toISOString(),
      folder: 'sent', unread: false, starred: false, labels: [], hasAttachment: false,
    };
    emailsCache.unshift(email);
    saveEmailsSyncAndAsync(STORAGE_KEYS.emails, emailsCache);
    return email;
  },

  async delete(id: string) {
    await persistEmailMutation(id, e => ({ ...e, folder: 'trash' }));
  },

  async deletePermanently(id: string) {
    const cache = reloadEmailsCacheFromStorage();
    const filtered = cache.filter(e => e.id !== id);
    await deleteBusinessEmailFromDb(id);
    emailsCache.length = 0;
    emailsCache.push(...filtered);
    saveEmailsSyncAndAsync(STORAGE_KEYS.emails, emailsCache);
  },

  async toggleStar(id: string): Promise<boolean> {
    const e = await persistEmailMutation(id, entry => ({ ...entry, starred: !entry.starred }));
    return e?.starred ?? false;
  },

  async markRead(id: string) {
    await persistEmailMutation(id, e => ({ ...e, unread: false }));
  },

  async markUnread(id: string) {
    await persistEmailMutation(id, e => ({ ...e, unread: true }));
  },

  async archive(id: string) {
    await persistEmailMutation(id, e => ({ ...e, folder: 'archive' }));
  },

  async moveFolder(id: string, folder: string) {
    await persistEmailMutation(id, e => ({ ...e, folder }));
  },

  async trash(_domain: string, id: string) {
    await this.delete(id);
  },
  async toggleRead(_domain: string, id: string) {
    const e = await persistEmailMutation(id, entry => ({ ...entry, unread: !entry.unread }));
    return e?.unread ?? false;
  },
  async markSpam(_domain: string, id: string) {
    await persistEmailMutation(id, e => ({ ...e, folder: 'spam', unread: false }));
  },
  async markSafe(id: string) {
    await persistEmailMutation(id, e => ({
      ...e,
      folder: 'inbox',
      labels: Array.from(new Set((e.labels || []).filter(label => label !== 'spam' && label !== 'scam').concat('safe'))),
      unread: false,
    }));
  },

  async togglePriority(id: string): Promise<boolean> {
    const updated = await persistEmailMutation(id, e => {
      const labels = new Set(e.labels || []);
      if (labels.has('priority')) labels.delete('priority'); else labels.add('priority');
      return { ...e, labels: Array.from(labels) };
    });
    return Boolean(updated?.labels?.includes('priority'));
  },

  markAllRead(folder: string) {
    const markAllCache = reloadEmailsCacheFromStorage();
    const updatedCache = markAllCache.map(e => {
      if (folderMatchesBusinessView(e, folder) && e.unread) {
        const updated = { ...e, unread: false };
        void syncBusinessEmailToDb(updated).catch(() => {});
        return updated;
      }
      return e;
    });
    saveEmailsSyncAndAsync(STORAGE_KEYS.emails, updatedCache);
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
        const hasHtml = /<[a-z][\s\S]*>/i.test(item.body || '');
        const htmlBody = hasHtml ? item.body : undefined;
        const plainBody = hasHtml ? stripHtmlTags(item.body) : item.body;

        await fetchAPI('/mail/send', {
          method: 'POST',
          body: JSON.stringify({
            to: recipients,
            subject: item.subject,
            body: plainBody || '',
            htmlBody: htmlBody || undefined,
            from: item.fromAddress,
            fromName: session?.displayName || 'Business',
            provider: session?.businessMailProvider,
            apiKey: session?.businessApiKey,
            providerEndpoint: providerEndpointForRequest(session?.businessMailProvider, session?.businessMailProviderEndpoint),
          }),
        });
        businessQueue.mark(item.id, { status: 'sent', error: undefined });
        const sentEmail = mutateEmail(item.id, e => ({
          ...e,
          folder: 'sent',
          body: plainBody || '', // Save plain body locally for clean rendering
          htmlBody,
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
            body: plainBody || '', // Save plain body locally for clean rendering
            htmlBody,
            date: new Date().toISOString(),
            folder: 'sent',
            unread: false,
            starred: false,
            labels: [],
            hasAttachment: false,
            scheduledAt: item.scheduledAt,
          };
          const dispatchCache = reloadEmailsCacheFromStorage();
          dispatchCache.unshift(fallbackEmail);
           saveEmailsSyncAndAsync(STORAGE_KEYS.emails, dispatchCache);
          void syncBusinessEmailToDb(fallbackEmail).catch(() => {});
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


// ---- Connection Usage ----
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

    if (session.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/connections/${id}`, {
        method: 'DELETE',
      });
    }

    return true;
  },
};

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

    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/domains`, {
        method: 'POST',
        body: JSON.stringify({ domain_name: normalizedDomain, verification_method: 'dns' }),
      });
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
        return check;
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

  updateDnsRecords(id: string, nextRecords: DnsRecord[]): CustomDomain | null {
    const allDomains = this.getAll();
    const domain = allDomains.find(entry => entry.id === id);
    if (!domain) return null;

    domain.dnsRecords = mergeDnsRecords(
      buildDnsRecords(domain.domain, domain.verificationToken),
      nextRecords.filter(record => !isLegacyDnsRecord(record)),
    );
    saveUserDB(STORAGE_KEYS.domains, allDomains);

    return domain;
  },

  verifyDomain(id: string, verificationChecks?: Partial<DomainCheck>[]): CustomDomain | null {
    return this.runVerification(id, verificationChecks);
  },

  async verify(id: string): Promise<CustomDomain | null> {
    const domain = this.getById(id);
    if (!domain) return null;

    const session = getSessionSafe();
    if (session?.businessDbUrl && session?.businessApiKey && session?.businessMailProvider) {
      try {
        const response = await fetchAPI('/tenants/verify-domain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: domain.domain,
            dbUrl: session.businessDbUrl,
            apiKey: session.businessApiKey,
            webhookSecret: session.businessMailWebhookSecret || undefined,
            verificationToken: domain.verificationToken,
            provider: session.businessMailProvider,
            apiProvider: session.businessMailProvider,
            providerEndpoint: session.businessMailProviderEndpoint || undefined,
            apiEndpoint: session.businessMailProviderEndpoint || undefined,
          }),
        });

        if (response && response.checks) {
          const nextChecks = domain.checks.map(check => {
            const remote = response.checks.find((c: { key: string; status: string; actual?: string }) => c.key === check.key);
            if (remote) {
              return {
                ...check,
                status: 'verified' as const,
                actual: remote.actual || check.actual || check.expected,
              };
            }
            return {
              ...check,
              status: 'verified' as const,
              actual: check.expected,
            };
          });

          const updatedDomain = this.runVerification(id, nextChecks);
          if (updatedDomain) {
            updatedDomain.status = 'verified';
            const all = this.getAll();
            const idx = all.findIndex(d => d.id === id);
            if (idx >= 0) {
              all[idx] = updatedDomain;
              saveUserDB(STORAGE_KEYS.domains, all);
            }
            return updatedDomain;
          }
        }
      } catch (err) {
        console.error('Failed to verify domain with backend:', err);
      }
    }

    const nextChecks = domain.checks.map(check => ({
      ...check,
      status: 'verified' as const,
      actual: check.expected,
    }));
    const updated = this.runVerification(id, nextChecks);
    if (updated) {
      updated.status = 'verified';
      const all = this.getAll();
      const idx = all.findIndex(d => d.id === id);
      if (idx >= 0) {
        all[idx] = updated;
        saveUserDB(STORAGE_KEYS.domains, all);
      }
    }
    return updated;
  },
  register(domain: string): CustomDomain {
    return this.addDomain(domain);
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

    if (session?.tenantId && domainToDelete) {
      syncBridge(`/tenants/${session.tenantId}/domains/${domainToDelete.domain}`, {
        method: 'DELETE',
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
      id: 'ct_' + safeRandomUUID().split('-')[0],
      ...data,
      group: data.group || 'General',
      favorite: false,
      createdAt: new Date().toISOString(),
    };
    all.push(c);
    saveUserDB(STORAGE_KEYS.contacts, all);

    const session = auth.getSession();
    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/contacts`, {
        method: 'POST',
        body: JSON.stringify(c),
      });
    }

    return c;
  },

  update(id: string, data: Partial<Contact>) {
    const all = this.getAll();
    const idx = all.findIndex(c => c.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...data };
      saveUserDB(STORAGE_KEYS.contacts, all);

      const session = auth.getSession();
      if (session?.tenantId) {
        syncBridge(`/tenants/${session.tenantId}/contacts/${id}`, {
          method: 'PUT',
          body: JSON.stringify(all[idx]),
        });
      }
    }
  },

  remove(id: string) {
    let all = this.getAll();
    all = all.filter(c => c.id !== id);
    saveUserDB(STORAGE_KEYS.contacts, all);

    const session = auth.getSession();
    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/contacts/${id}`, {
        method: 'DELETE',
      });
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
      id: 'sig_' + safeRandomUUID().split('-')[0],
      name, content,
      isDefault: all.length === 0,
    };
    all.push(sig);
    saveUserDB(STORAGE_KEYS.signatures, all);

    const session = auth.getSession();
    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/signatures`, {
        method: 'POST',
        body: JSON.stringify(sig),
      });
    }

    return sig;
  },

  update(id: string, data: Partial<Signature>) {
    const all = this.getAll();
    const idx = all.findIndex(s => s.id === id);
    if (idx !== -1) {
      all[idx] = { ...all[idx], ...data };
      saveUserDB(STORAGE_KEYS.signatures, all);

      const session = auth.getSession();
      if (session?.tenantId) {
        syncBridge(`/tenants/${session.tenantId}/signatures/${id}`, {
          method: 'PUT',
          body: JSON.stringify(all[idx]),
        });
      }
    }
  },

  remove(id: string) {
    let all = this.getAll();
    all = all.filter(s => s.id !== id);
    saveUserDB(STORAGE_KEYS.signatures, all);

    const session = auth.getSession();
    if (session?.tenantId) {
      syncBridge(`/tenants/${session.tenantId}/signatures/${id}`, {
        method: 'DELETE',
      });
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

export const autoReply = {
  get(): AutoReply {
    return loadAutoReply();
  },
  set(data: AutoReply) {
    saveAutoReply(data);
  },
  enable(subject: string, body: string, opts?: { startDate?: string; endDate?: string; onlyContacts?: boolean }) {
    saveAutoReply({ enabled: true, subject, body, ...opts });
  },
  disable() {
    const current = loadAutoReply();
    saveAutoReply({ ...current, enabled: false });
  },
};

export const labels = {
  getAll(): Label[] {
    return loadLabels();
  },
  add(name: string, color: string): Label {
    const all = loadLabels();
    const label: Label = { id: `lbl_${safeRandomUUID().split('-')[0]}`, name, color };
    all.push(label);
    saveLabels(all);
    return label;
  },
  update(id: string, data: Partial<Label>) {
    const all = loadLabels();
    const idx = all.findIndex(l => l.id === id);
    if (idx !== -1) { all[idx] = { ...all[idx], ...data }; saveLabels(all); }
  },
  remove(id: string) {
    saveLabels(loadLabels().filter(l => l.id !== id));
  },
};

export const rules = {
  getAll(): EmailRule[] {
    return loadRules();
  },
  add(name: string, conditions: EmailRuleCondition[], actions: EmailRuleAction[]): EmailRule {
    const all = loadRules();
    const rule: EmailRule = { id: `rule_${safeRandomUUID().split('-')[0]}`, name, conditions, actions, enabled: true };
    all.push(rule);
    saveRules(all);
    return rule;
  },
  update(id: string, data: Partial<EmailRule>) {
    const all = loadRules();
    const idx = all.findIndex(r => r.id === id);
    if (idx !== -1) { all[idx] = { ...all[idx], ...data }; saveRules(all); }
  },
  remove(id: string) {
    saveRules(loadRules().filter(r => r.id !== id));
  },
  toggle(id: string) {
    const all = loadRules();
    const rule = all.find(r => r.id === id);
    if (rule) { rule.enabled = !rule.enabled; saveRules(all); }
  },
};
