import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Database,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Webhook,
} from 'lucide-react';
import {
  auth,
  fetchAPI,
  fetchApiResponse,
  providerEndpointForRequest,
  type User,
} from '../../api/client';
import { workspaceApi, type DnsRequirement } from '../../api/company';
import {
  DATABASE_PROVIDERS,
  MAIL_PROVIDERS,
  getConnectionHostLabel,
  getDatabaseProvider,
  getMailProvider,
  getMailProviderEndpointPlaceholder,
  getMailProviderKeyMismatch,
  hasUnsafeCredentialPlaceholder,
  inferDatabaseProviderFromUrl,
  inferMailProviderFromApiKey,
  isValidDatabaseUrl,
  requiresCustomMailEndpoint,
} from '../../config/providers';
import type { SetupCheck, SetupCheckKey, WorkspaceReadiness } from './useWorkspaceReadiness';
import './SetupRequired.css';

interface SetupRequiredProps {
  user: User | null;
  /** The live state of the setup. */
  readiness: WorkspaceReadiness;
  /** Persist the account fields after an inline change. */
  onUserUpdate?: (user: User) => void;
  onLogout?: () => void;
}

/**
 * The order of the setup steps.
 *
 * The DNS records come before the domain confirmation: the records have to be
 * published before a domain can be verified, so the customer sees the records
 * first and the domain turns green on its own afterwards.
 */
const STEP_ORDER: SetupCheckKey[] = [
  'database',
  'apiKey',
  'provider',
  'webhook',
  'dns',
  'domain',
  'receiving',
];

const INFRA_KEYS: SetupCheckKey[] = ['database', 'apiKey', 'provider', 'webhook'];

const RECORD_LABELS: Record<string, string> = {
  verified: 'Active',
  missing: 'Missing',
  mismatch: 'Conflict',
  unknown: 'Unavailable',
  pending: 'Pending',
};

function firstIncomplete(checks: SetupCheck[]): SetupCheck | undefined {
  return STEP_ORDER.map((key) => checks.find((check) => check.key === key)).find(
    (check): check is SetupCheck => Boolean(check && !check.done),
  );
}

function maskSecret(value: string): string {
  if (!value) return 'Not set';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••••${value.slice(-4)}`;
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

/**
 * Guided setup gate.
 *
 * Nothing in the workspace opens before every item is verified. The panel
 * walks through the missing items one at a time, keeps configuration that is
 * already in place, shows the exact DNS records - with the exact value - and
 * unlocks the dashboard automatically as soon as the live checks pass.
 */
export default function SetupRequired({
  user,
  readiness,
  onUserUpdate,
  onLogout,
}: SetupRequiredProps) {
  const { checks, loaded, records, error, loading, refreshing, reload } = readiness;
  const [activeKey, setActiveKey] = useState<SetupCheckKey>('database');
  const [hasUserSelected, setHasUserSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [editingInfra, setEditingInfra] = useState(false);

  // Infrastructure form - seeded from the existing configuration so a
  // completed item is never cleared or asked for again.
  const [dbProvider, setDbProvider] = useState(() =>
    inferDatabaseProviderFromUrl(user?.businessDbUrl || ''),
  );
  const [customDbUrl, setCustomDbUrl] = useState(user?.businessDbUrl || '');
  const [apiProvider, setApiProvider] = useState(user?.businessMailProvider || 'resend');
  const [customApiUrl, setCustomApiUrl] = useState(user?.businessMailProviderEndpoint || '');
  const [webhookSecret, setWebhookSecret] = useState(user?.businessMailWebhookSecret || '');
  const [apiKey, setApiKey] = useState(user?.businessApiKey || '');

  const [domainInput, setDomainInput] = useState(user?.businessDomain || '');
  const [lastResult, setLastResult] = useState<DnsRequirement[]>([]);

  const completed = checks.filter((check) => check.done).length;
  const progress = checks.length ? Math.round((completed / checks.length) * 100) : 0;
  const allDone = checks.length > 0 && checks.every((check) => check.done);
  const current = checks.find((check) => check.key === activeKey) || checks[0];

  const firstBlocked = useMemo(() => firstIncomplete(checks), [checks]);
  const primary = readiness.primaryDomain;
  // The live requirements from the hook are always the source of truth; the
  // last verify response is only a fallback while the refresh is in flight.
  const displayedRecords = records.length > 0 ? records : lastResult;
  const dnsCheck = checks.find((check) => check.key === 'dns');
  const pendingRecords = displayedRecords.filter((record) => record.status !== 'verified');
  const isInfraStep = INFRA_KEYS.includes(activeKey);
  const infraDone = INFRA_KEYS.every(
    (key) => checks.find((check) => check.key === key)?.done,
  );
  // A domain that is attached is not automatically verified: the DNS step is
  // the place where the customer can see and fix the remaining records. Skip
  // the domain confirmation step while that is the real blocker.
  const dnsNeedsWork = Boolean(primary && dnsCheck && !dnsCheck.done);
  // Without a domain there are no records either, so the domain is attached
  // first and the records are published afterwards.
  const nextActionable = !primary && infraDone
    ? checks.find((check) => check.key === 'domain')
    : firstBlocked?.key === 'domain' && dnsNeedsWork
      ? dnsCheck
      : firstBlocked;
  // The progress line should say what to do, not repeat the status label.
  const nextActionLabel = nextActionable
    ? nextActionable.key === 'dns'
      ? 'Fix DNS records'
      : nextActionable.key === 'domain'
        ? primary
          ? 'Verify domain'
          : 'Add your domain'
        : nextActionable.key === 'receiving'
          ? 'Verify receiving'
          : `Finish ${nextActionable.label.toLowerCase()}`
    : null;

  const currentDone = Boolean(current?.done);

  useEffect(() => {
    if (!hasUserSelected && loaded && nextActionable) {
      setActiveKey(nextActionable.key);
    }
  }, [nextActionable, hasUserSelected, loaded]);

  useEffect(() => {
    setMessage(null);
  }, [activeKey]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // Keep the form in sync when the account fields arrive after the first render.
  useEffect(() => {
    if (!user) return;
    setCustomDbUrl((value) => value || user.businessDbUrl || '');
    setApiKey((value) => value || user.businessApiKey || '');
    setApiProvider((value) => value || user.businessMailProvider || 'resend');
    setCustomApiUrl((value) => value || user.businessMailProviderEndpoint || '');
    setWebhookSecret((value) => value || user.businessMailWebhookSecret || '');
    setDomainInput((value) => value || user.businessDomain || '');
    if (user.businessDbUrl) {
      setDbProvider((value) => (value === 'postgresql' && user.businessDbUrl?.includes('neon'))
        ? 'neon'
        : value || inferDatabaseProviderFromUrl(user.businessDbUrl || ''));
    }
  }, [user]);

  const copy = (value: string, key = value) => {
    if (!value) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopied(key))
      .catch(() => undefined);
  };

  const copyAllRecords = () => {
    const text = displayedRecords
      .map((record) => `${record.recordType}\t${record.name}\t${record.value || ''}\t${record.ttl}`)
      .join('\n');
    copy(text, '__all__');
  };

  // Save the account fields and wait for the gateway to store them. The DNS
  // report is built from the account settings on the server, so moving on
  // before the write lands would make the next step read the old provider.
  const persistAccountSettings = async (settings: Partial<User>) => {
    const updated = auth.updateSettings(settings);
    if (!updated.success || !updated.user) {
      throw new Error(updated.error || 'The configuration could not be saved.');
    }
    try {
      await fetchAPI('/auth/account', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
    } catch {
      throw new Error(
        'The connection was verified, but your account could not be updated. Check your network and try again.',
      );
    }
    onUserUpdate?.(updated.user);
    return updated.user;
  };

  const advance = () => {
    setHasUserSelected(false);
    if (nextActionable) setActiveKey(nextActionable.key);
  };

  const selectStep = (key: SetupCheckKey) => {
    setHasUserSelected(true);
    setActiveKey(key);
  };

  const stepUnlocked = (key: SetupCheckKey) => {
    const check = checks.find((entry) => entry.key === key);
    if (check?.done) return true;
    // The domain step stays reachable at all times: it is where a domain is
    // attached, and the DNS records of a domain cannot exist before that.
    if (key === 'domain') return true;
    // DNS and receiving only make sense once a domain is attached.
    if ((key === 'dns' || key === 'receiving') && !primary) return false;
    // Once a domain is attached and the infrastructure is configured, the DNS
    // step is the actionable one even while the domain is still pending. It
    // must never be locked behind the domain's verification flag.
    if ((key === 'dns' || key === 'receiving') && primary && infraDone) return true;
    if (!firstBlocked) return true;
    return STEP_ORDER.indexOf(key) <= STEP_ORDER.indexOf(firstBlocked.key);
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    const inferred = inferMailProviderFromApiKey(value);
    if (inferred && inferred !== apiProvider) setApiProvider(inferred);
  };

  const validateInfrastructure = (): string | null => {
    if (!customDbUrl.trim() || !apiKey.trim()) {
      return 'Both the database connection URI and the mail API key are required.';
    }
    if (!isValidDatabaseUrl(customDbUrl)) {
      return 'Enter the real database connection string, including the host, user, password and database.';
    }
    if (hasUnsafeCredentialPlaceholder(customDbUrl)) {
      return 'The database connection still contains placeholder values. Replace every example value with the real provider credentials.';
    }
    if (apiKey.trim().length < 8) {
      return 'The mail API key is too short.';
    }
    if (hasUnsafeCredentialPlaceholder(apiKey)) {
      return 'The mail API key looks like a placeholder. Paste the real key from your provider.';
    }
    const mismatch = getMailProviderKeyMismatch(apiProvider, apiKey);
    if (mismatch) return mismatch;
    if (requiresCustomMailEndpoint(apiProvider) && !customApiUrl.trim()) {
      return apiProvider === 'amazonses'
        ? 'Amazon SES requires an AWS region such as us-east-1.'
        : 'Custom mail providers require a delivery endpoint URL.';
    }
    if (apiProvider === 'amazonses' && !/^[a-z0-9-]{3,32}$/.test(customApiUrl.trim())) {
      return 'Enter a valid AWS region, for example us-east-1 or eu-west-1.';
    }
    if (apiProvider === 'resend' && !webhookSecret.trim()) {
      return 'Resend receiving needs the webhook signing secret.';
    }
    if (apiProvider === 'resend' && hasUnsafeCredentialPlaceholder(webhookSecret)) {
      return 'The Resend webhook secret looks like a placeholder. Paste the real whsec_ secret.';
    }
    return null;
  };

  const submitInfrastructure = async () => {
    const validationError = validateInfrastructure();
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const endpoint = providerEndpointForRequest(apiProvider, customApiUrl);
      const response = await fetchApiResponse('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dbProvider,
          dbUrl: customDbUrl.trim(),
          apiProvider,
          apiEndpoint: endpoint,
          apiKey: apiKey.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || 'The database or the mail provider could not be verified.');
      }

      const nextProfile = {
        ...user?.businessProfile,
        dbUrl: customDbUrl.trim(),
        apiKey: apiKey.trim(),
        mailProvider: apiProvider,
        mailProviderEndpoint: endpoint,
        mailWebhookSecret: apiProvider === 'resend' ? webhookSecret.trim() : undefined,
      };
      await persistAccountSettings({
        businessDbUrl: customDbUrl.trim(),
        businessApiKey: apiKey.trim(),
        businessMailProvider: apiProvider,
        businessMailProviderEndpoint: endpoint,
        businessMailWebhookSecret: apiProvider === 'resend' ? webhookSecret.trim() : undefined,
        businessProfile: nextProfile,
      });
      setEditingInfra(false);
      setMessage({ type: 'success', text: 'Connection verified and saved. Moving to the domain step.' });
      setHasUserSelected(false);
    } catch (err) {
      setMessage({ type: 'error', text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  const addDomain = async () => {
    const domain = domainInput.trim().toLowerCase();
    if (!domain.includes('.') || domain.length < 3) {
      setMessage({ type: 'error', text: 'Enter a valid domain, for example acme.com.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await workspaceApi.createDomain({ domain });
      const updated = auth.updateSettings({
        businessDomain: domain,
        businessDomainVerified: false,
        businessProfile: {
          ...user?.businessProfile,
          domain,
          verified: false,
        },
      });
      if (updated.user) onUserUpdate?.(updated.user);
      await reload();
      setMessage({ type: 'success', text: `${domain} is connected. Publish its DNS records next.` });
      setHasUserSelected(false);
    } catch (err) {
      setMessage({ type: 'error', text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  const verifyDomain = async () => {
    if (!primary) {
      setMessage({ type: 'error', text: 'Add the primary domain before verifying it.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await workspaceApi.verifyDomain(primary.id);
      setLastResult(result.records);
      await reload();
      const missing = result.records.filter((record) => record.status !== 'verified');
      if (result.complete) {
        const updated = auth.updateSettings({
          businessDomain: primary.domain,
          businessDomainVerified: true,
          isBusinessSetupComplete: true,
          dkimStatus: 'verified',
          spfStatus: 'verified',
          dmarcStatus: 'verified',
          businessProfile: {
            ...user?.businessProfile,
            domain: primary.domain,
            verified: true,
            dkimStatus: 'verified',
            spfStatus: 'verified',
            dmarcStatus: 'verified',
          },
        });
        if (updated.user) onUserUpdate?.(updated.user);
        setMessage({ type: 'success', text: `${primary.domain} is verified. All DNS records are live.` });
        setHasUserSelected(false);
      } else {
        const firstProblem = missing[0];
        setMessage({
          type: 'error',
          text:
            missing.length > 0
              ? `${missing.length} record${missing.length === 1 ? '' : 's'} still need attention. ${
                  firstProblem?.detail || `${firstProblem?.recordType} ${firstProblem?.name} is not active yet.`
                }`
              : 'The domain could not be verified. Check the records and try again.',
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  const verifyReceiving = async () => {
    if (!primary) {
      setMessage({ type: 'error', text: 'Add the primary domain before enabling receiving.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await workspaceApi.verifyDomain(primary.id);
      setLastResult(result.records);
      await reload();
      const mx = result.records.find(
        (record) =>
          record.recordType === 'MX' && record.purpose.toLowerCase().includes('receiv'),
      );
      if (mx?.status === 'verified') {
        setMessage({ type: 'success', text: 'Inbound mail is enabled for this domain.' });
        setHasUserSelected(false);
      } else {
        setMessage({
          type: 'error',
          text: mx?.detail || 'The inbound MX record is not active yet. Publish it and check again.',
        });
      }
    } catch (err) {
      setMessage({ type: 'error', text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  const runPrimaryAction = () => {
    if (allDone) {
      window.location.reload();
      return;
    }
    if (isInfraStep) {
      if (infraDone && !editingInfra) {
        advance();
        return;
      }
      void submitInfrastructure();
      return;
    }
    if (activeKey === 'domain') {
      if (!primary) {
        void addDomain();
      } else if (dnsNeedsWork) {
        // The user cannot verify the domain until the live records are fixed.
        // Take them straight to the exact records instead of running a check
        // that is guaranteed to fail without an explanation.
        selectStep('dns');
      } else {
        void verifyDomain();
      }
      return;
    }
    if (activeKey === 'dns') {
      void verifyDomain();
      return;
    }
    if (activeKey === 'receiving') {
      void verifyReceiving();
    }
  };

  const actionLabel = (() => {
    if (allDone) return 'Open dashboard';
    if (isInfraStep) return infraDone && !editingInfra ? 'Continue' : 'Verify & continue';
    if (activeKey === 'domain') {
      if (!primary) return 'Add domain';
      return dnsNeedsWork ? 'Open DNS records' : 'Verify domain';
    }
    if (activeKey === 'dns') return 'Verify DNS records';
    if (activeKey === 'receiving') return 'Verify receiving';
    return 'Continue';
  })();

  const previousStep = () => {
    const index = STEP_ORDER.indexOf(activeKey);
    const previous = STEP_ORDER
      .slice(0, Math.max(0, index))
      .reverse()
      .map((key) => checks.find((check) => check.key === key))
      .find((check): check is SetupCheck => Boolean(check));
    if (previous) selectStep(previous.key);
  };

  const displayName = user?.displayName || user?.email || 'your workspace';
  const activeIndex = STEP_ORDER.indexOf(activeKey);

  return (
    <div className="setup-gate">
      <section className="setup-wizard" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <header className="setup-wizard-head">
          <div className="setup-wizard-brand">
            <span className="setup-wizard-mark"><ShieldCheck size={18} /></span>
            <div>
              <span className="setup-wizard-eyebrow">Secure workspace activation</span>
              <h1 id="setup-title">Finish your setup</h1>
            </div>
          </div>
          <div className="setup-wizard-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void reload()}
              disabled={loading || refreshing}
            >
              <RefreshCw size={13} className={loading || refreshing ? 'spin' : ''} />
              <span>{refreshing ? 'Checking…' : 'Re-check'}</span>
            </button>
            {onLogout && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
                <LogOut size={13} /> <span>Sign out</span>
              </button>
            )}
          </div>
        </header>

        <div className="setup-wizard-progress">
          <div className="setup-wizard-progress-copy">
            <strong>{allDone ? 'Everything is verified' : `${completed} of ${checks.length} steps complete`}</strong>
            <span>
              {allDone
                ? 'Opening your dashboard automatically.'
                : nextActionLabel
                  ? `Next: ${nextActionLabel}`
                  : 'The dashboard stays locked until every step is green.'}
            </span>
          </div>
          <div className="setup-progress">
            <div className="setup-progress-bar"><span style={{ width: `${progress}%` }} /></div>
            <span className="setup-progress-label">{progress}%</span>
          </div>
        </div>

        <div className="setup-wizard-body">
          <nav className="setup-wizard-rail" aria-label="Setup steps">
            {STEP_ORDER.map((key, index) => {
              const check = checks.find((entry) => entry.key === key);
              if (!check) return null;
              const Icon = check.icon;
              const unlocked = stepUnlocked(key);
              const active = key === activeKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={`setup-step ${check.done ? 'done' : ''} ${active ? 'active' : ''} ${!unlocked ? 'locked' : ''}`}
                  onClick={() => unlocked && selectStep(key)}
                  disabled={!unlocked}
                  aria-current={active ? 'step' : undefined}
                >
                  <span className="setup-step-index">
                    {check.done ? <Check size={13} /> : <Icon size={13} />}
                  </span>
                  <span className="setup-step-copy">
                    <strong>{check.label}</strong>
                    <span>{check.done ? 'Already set up' : check.detail}</span>
                  </span>
                  <span className="setup-step-marker" aria-hidden="true">
                    {check.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                  </span>
                  {index < STEP_ORDER.length - 1 && <span className="setup-step-line" aria-hidden="true" />}
                </button>
              );
            })}
          </nav>

          <div className="setup-wizard-main">
            {error && (
              <div className="setup-callout error">
                <AlertTriangle size={15} />
                <div>
                  <strong>The live check could not finish</strong>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {!loaded ? (
              <div className="setup-loading-card">
                <Loader2 size={22} className="spin" />
                <div>
                  <strong>Reading the live state of {displayName}</strong>
                  <p>Checking the database, provider, domain and DNS records.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="setup-content-head">
                  <span className="setup-content-icon">
                    {current?.icon ? <current.icon size={18} /> : <Sparkles size={18} />}
                  </span>
                  <div>
                    <span className="setup-content-kicker">
                      {currentDone ? 'Already configured' : `Step ${activeIndex + 1} of ${checks.length}`}
                    </span>
                    <h2>{current?.label || 'Workspace setup'}</h2>
                    <p>{current?.description}</p>
                  </div>
                  <span className={`setup-content-state ${currentDone ? 'ok' : 'todo'}`}>
                    {currentDone ? 'Verified' : 'Needs verification'}
                  </span>
                </div>

                {message && (
                  <div className={`setup-callout ${message.type}`}>
                    {message.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                    <div>
                      <strong>{message.type === 'success' ? 'Verified' : 'Action needed'}</strong>
                      <p>{message.text}</p>
                    </div>
                  </div>
                )}

                {isInfraStep && (
                  <div className="setup-panel">
                    {infraDone && !editingInfra ? (
                      <>
                        <div className="setup-summary-grid">
                          <div className="setup-summary-card">
                            <span><Database size={14} /> Database</span>
                            <strong>{getConnectionHostLabel(customDbUrl)}</strong>
                            <small>Connected</small>
                          </div>
                          <div className="setup-summary-card">
                            <span><Mail size={14} /> Mail provider</span>
                            <strong>{getMailProvider(apiProvider).label}</strong>
                            <small>Ready to send</small>
                          </div>
                          <div className="setup-summary-card">
                            <span><KeyRound size={14} /> API key</span>
                            <strong>{showSecrets ? apiKey : maskSecret(apiKey)}</strong>
                            <small>Stored securely</small>
                          </div>
                          <div className="setup-summary-card">
                            <span><Webhook size={14} /> Inbound webhook</span>
                            <strong>
                              {apiProvider === 'resend'
                                ? showSecrets
                                  ? webhookSecret
                                  : maskSecret(webhookSecret)
                                : 'Not required'}
                            </strong>
                            <small>{apiProvider === 'resend' ? 'Receiving enabled' : 'Provider managed'}</small>
                          </div>
                        </div>
                        <div className="setup-inline-actions">
                          <p>This configuration stays exactly as it is. You only have to replace it if a key was revoked.</p>
                          <div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setShowSecrets((value) => !value)}
                            >
                              {showSecrets ? <EyeOff size={13} /> : <Eye size={13} />}
                              {showSecrets ? 'Hide secrets' : 'Show secrets'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setEditingInfra(true)}
                            >
                              Replace credentials
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <form
                        id="setup-infra-form"
                        className="setup-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitInfrastructure();
                        }}
                      >
                        <div className="setup-form-note">
                          <LockKeyhole size={14} />
                          <p>
                            These values are stored only for this workspace. Existing values are
                            pre-filled - change only the fields that are missing or revoked.
                          </p>
                        </div>

                        <div className="setup-form-grid">
                          <div className="form-group">
                            <label htmlFor="setup-db-provider">Database provider</label>
                            <select
                              id="setup-db-provider"
                              className="input"
                              value={dbProvider}
                              onChange={(event) => setDbProvider(event.target.value)}
                            >
                              {DATABASE_PROVIDERS.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.label}</option>
                              ))}
                            </select>
                            <small>{getDatabaseProvider(dbProvider).description}</small>
                          </div>
                          <div className="form-group setup-form-wide">
                            <label htmlFor="setup-db-url">Database connection URI</label>
                            <input
                              id="setup-db-url"
                              className="input"
                              type="text"
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={getDatabaseProvider(dbProvider).placeholder}
                              value={customDbUrl}
                              onChange={(event) => setCustomDbUrl(event.target.value)}
                            />
                            <small>{dbProvider === 'neon' ? 'Use the pooled connection string from Neon.' : 'Include the host, user, password and database name.'}</small>
                          </div>

                          <div className="form-group">
                            <label htmlFor="setup-mail-provider">Mail provider</label>
                            <select
                              id="setup-mail-provider"
                              className="input"
                              value={apiProvider}
                              onChange={(event) => setApiProvider(event.target.value)}
                            >
                              {MAIL_PROVIDERS.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.label}</option>
                              ))}
                            </select>
                            <small>{getMailProvider(apiProvider).description}</small>
                          </div>
                          {requiresCustomMailEndpoint(apiProvider) && (
                            <div className="form-group">
                              <label htmlFor="setup-mail-endpoint">
                                {apiProvider === 'amazonses' ? 'AWS region' : 'Delivery endpoint'}
                              </label>
                              <input
                                id="setup-mail-endpoint"
                                className="input"
                                type={apiProvider === 'amazonses' ? 'text' : 'url'}
                                placeholder={getMailProviderEndpointPlaceholder(apiProvider)}
                                value={customApiUrl}
                                onChange={(event) => setCustomApiUrl(event.target.value)}
                              />
                            </div>
                          )}
                          <div className="form-group">
                            <label htmlFor="setup-mail-key">Mail API key</label>
                            <div className="setup-secret-field">
                              <input
                                id="setup-mail-key"
                                className="input"
                                type={showSecrets ? 'text' : 'password'}
                                autoComplete="new-password"
                                spellCheck={false}
                                placeholder={getMailProvider(apiProvider).placeholder}
                                value={apiKey}
                                onChange={(event) => handleApiKeyChange(event.target.value)}
                              />
                              <button
                                type="button"
                                className="setup-secret-toggle"
                                onClick={() => setShowSecrets((value) => !value)}
                                aria-label={showSecrets ? 'Hide API key' : 'Show API key'}
                              >
                                {showSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                          </div>
                          {apiProvider === 'resend' && (
                            <div className="form-group">
                              <label htmlFor="setup-webhook-secret">Webhook signing secret</label>
                              <div className="setup-secret-field">
                                <input
                                  id="setup-webhook-secret"
                                  className="input"
                                  type={showSecrets ? 'text' : 'password'}
                                  autoComplete="new-password"
                                  spellCheck={false}
                                  placeholder="whsec_..."
                                  value={webhookSecret}
                                  onChange={(event) => setWebhookSecret(event.target.value)}
                                />
                                <button
                                  type="button"
                                  className="setup-secret-toggle"
                                  onClick={() => setShowSecrets((value) => !value)}
                                  aria-label={showSecrets ? 'Hide webhook secret' : 'Show webhook secret'}
                                >
                                  {showSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                              </div>
                              <small>
                                Resend → Webhooks → add <code>https://api.velismail.online/api/v1/mail/inbound</code>
                              </small>
                            </div>
                          )}
                        </div>

                        <div className="setup-form-actions">
                          {infraDone && (
                            <button type="button" className="btn btn-ghost" onClick={() => setEditingInfra(false)}>
                              Keep current values
                            </button>
                          )}
                          <button type="submit" className="btn btn-primary" disabled={busy}>
                            {busy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
                            {busy ? 'Testing connection…' : 'Test & save connection'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {activeKey === 'domain' && (
                  <div className="setup-panel">
                    {primary ? (
                      <>
                        <div className="setup-domain-card">
                          <span className="setup-domain-icon"><Globe size={20} /></span>
                          <div>
                            <span className="setup-content-kicker">Primary sending domain</span>
                            <strong>{primary.domain}</strong>
                            <small>
                              {dnsNeedsWork
                                ? 'Connected. The remaining DNS records must be fixed before this domain can be verified.'
                                : currentDone
                                  ? 'Verified and ready to send and receive mail.'
                                  : 'Connected. All DNS records are active. Verify the domain to finish.'}
                            </small>
                          </div>
                          <span className={`setup-status ${dnsNeedsWork || !currentDone ? 'pending' : 'ok'}`}>
                            {dnsNeedsWork ? 'DNS needed' : currentDone ? 'Verified' : primary.status}
                          </span>
                        </div>

                        {dnsNeedsWork && pendingRecords.length > 0 && (
                          <div className="setup-callout warn">
                            <AlertTriangle size={15} />
                            <div>
                              <strong>
                                {pendingRecords.length === 1
                                  ? 'One DNS record still needs attention'
                                  : `${pendingRecords.length} DNS records still need attention`}
                              </strong>
                              <p>
                                Open the DNS records step to see the exact name, value and conflict.
                                Fix it in your DNS provider, then press “Verify DNS records”.
                              </p>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm setup-callout-action"
                                onClick={() => selectStep('dns')}
                              >
                                Open DNS records <ArrowRight size={13} />
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="setup-guidance">
                          <Server size={15} />
                          <p>
                            {dnsNeedsWork
                              ? 'Verifying now would fail until the records in the DNS step are active. That step shows exactly what to add or remove.'
                              : 'The domain is attached to this workspace. Verifying it checks SPF, DKIM, DMARC and the inbound MX record against the live DNS.'}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="setup-domain-empty">
                          <span className="setup-domain-icon"><Globe size={20} /></span>
                          <div>
                            <strong>Connect your primary domain</strong>
                            <p>Use the domain you want your business mail to come from. You can add more domains later.</p>
                          </div>
                        </div>
                        <div className="form-group">
                          <label htmlFor="setup-domain">Business domain</label>
                          <div className="setup-inline-field">
                            <input
                              id="setup-domain"
                              className="input"
                              placeholder="yourbusiness.com"
                              value={domainInput}
                              onChange={(event) => setDomainInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void addDomain();
                                }
                              }}
                            />
                            <button type="button" className="btn btn-primary" onClick={() => void addDomain()} disabled={busy}>
                              {busy ? <Loader2 size={14} className="spin" /> : <Globe size={14} />}
                              Connect domain
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {(activeKey === 'dns' || activeKey === 'receiving') && (
                  <div className="setup-panel">
                    {activeKey === 'receiving' && (
                      <div className="setup-guidance">
                        <Mail size={15} />
                        <p>
                          Receiving is enabled by the inbound MX record. It is checked together
                          with the rest of the DNS so the result always reflects the live zone.
                        </p>
                      </div>
                    )}

                    {activeKey === 'dns' && pendingRecords.length > 0 && (
                      <div className="setup-callout warn">
                        <AlertTriangle size={15} />
                        <div>
                          <strong>
                            {pendingRecords.length === 1
                              ? 'One DNS record needs a fix'
                              : `${pendingRecords.length} DNS records need a fix`}
                          </strong>
                          <p>
                            The records marked Conflict, Missing or Unavailable below are not active
                            yet. Fix them in your DNS provider — the cards show the exact name, value
                            and conflict. Then press “Verify DNS records”.
                          </p>
                        </div>
                      </div>
                    )}

                    {displayedRecords.length === 0 ? (
                      <div className="setup-empty">
                        <Globe size={28} />
                        <strong>No DNS records to check yet</strong>
                        <p>Connect the primary domain first. The exact records will appear here automatically.</p>
                      </div>
                    ) : (
                      <>
                        <div className="setup-record-toolbar">
                          <span>
                            <strong>{displayedRecords.filter((record) => record.status === 'verified').length}</strong>
                            {' '}of {displayedRecords.length} records active
                          </span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={copyAllRecords}>
                            {copied === '__all__' ? <Check size={13} /> : <Copy size={13} />}
                            {copied === '__all__' ? 'Copied all' : 'Copy all'}
                          </button>
                        </div>
                        <div className="setup-records">
                          {displayedRecords.map((record) => {
                            const active = record.status === 'verified';
                            const copyKey = `${record.recordType}-${record.host}`;
                            return (
                              <article
                                key={`${record.recordType}-${record.host}-${record.name}`}
                                className={`setup-record ${active ? 'is-active' : record.status === 'mismatch' ? 'is-conflict' : ''}`}
                              >
                                <div className="setup-record-head">
                                  <span className={`setup-record-type ${record.recordType.toLowerCase()}`}>
                                    {record.recordType}
                                  </span>
                                  <div className="setup-record-title">
                                    <strong>{record.purpose}</strong>
                                    <code>{record.name}</code>
                                  </div>
                                  <span className={`setup-record-state ${active ? 'ok' : record.status}`}>
                                    {RECORD_LABELS[record.status] || record.status}
                                  </span>
                                </div>

                                <div className="setup-record-fields">
                                  <div>
                                    <span>Name / host</span>
                                    <code>{record.host}</code>
                                    <button type="button" onClick={() => copy(record.host, `${copyKey}-host`)} title="Copy host">
                                      {copied === `${copyKey}-host` ? <Check size={12} /> : <Copy size={12} />}
                                    </button>
                                  </div>
                                  <div>
                                    <span>Value</span>
                                    <code>{record.value || 'Read from your mail provider'}</code>
                                    {record.value && (
                                      <button type="button" onClick={() => copy(record.value, `${copyKey}-value`)} title="Copy value">
                                        {copied === `${copyKey}-value` ? <Check size={12} /> : <Copy size={12} />}
                                      </button>
                                    )}
                                  </div>
                                  <div>
                                    <span>TTL</span>
                                    <code>{record.ttl}</code>
                                  </div>
                                </div>

                                {record.detail && !active && (
                                  <p className={`setup-record-detail ${record.status === 'mismatch' ? 'conflict' : ''}`}>
                                    <AlertTriangle size={13} />
                                    {record.detail}
                                  </p>
                                )}
                                {record.actual && !active && (
                                  <p className="setup-record-actual">
                                    <span>Published now</span>
                                    <code>{record.actual}</code>
                                  </p>
                                )}
                                {active && record.actual && (
                                  <p className="setup-record-actual ok">
                                    <span>Live answer</span>
                                    <code>{record.actual}</code>
                                  </p>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {allDone && (
                  <div className="setup-complete">
                    <span className="setup-complete-icon"><Sparkles size={24} /></span>
                    <h2>Your workspace is ready</h2>
                    <p>Every live check passed. The dashboard opens automatically — no refresh needed.</p>
                  </div>
                )}

                <footer className="setup-wizard-footer">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={previousStep}
                    disabled={activeIndex <= 0 || busy}
                  >
                    <ArrowLeft size={14} /> Back
                  </button>
                  <div className="setup-wizard-footer-right">
                    {isInfraStep && infraDone && !editingInfra && (
                      <span className="setup-footer-note">
                        <CheckCircle2 size={13} /> Existing connection kept
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={runPrimaryAction}
                      disabled={busy || !!current && !currentDone && isInfraStep && infraDone && !editingInfra}
                    >
                      {busy ? <Loader2 size={14} className="spin" /> : allDone ? <Sparkles size={14} /> : <ArrowRight size={14} />}
                      {busy ? 'Verifying…' : actionLabel}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </div>
        </div>

        <footer className="setup-wizard-footnote">
          <span>Signed in as <strong>{user?.email}</strong></span>
          <span className="setup-wizard-secure"><LockKeyhole size={12} /> Live checks run against your real DNS and provider</span>
        </footer>
      </section>
    </div>
  );
}
