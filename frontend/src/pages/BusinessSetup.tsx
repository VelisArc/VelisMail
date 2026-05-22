import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Database, Mail, CheckCircle2, Server, Lock, Globe,
  Zap, Shield, ArrowRight, ArrowLeft, XCircle, Wifi, LogOut, Copy, Check
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  auth,
  domains,
  fetchApiJsonDetailed,
  fetchApiResponse,
  getApiAvailabilityHint,
  isBusinessSetupReady,
  mergeDnsRecords,
  normalizeProviderDnsRecords,
  providerEndpointForRequest,
  type DnsRecord,
  type User,
} from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  DATABASE_PROVIDERS,
  MAIL_PROVIDERS,
  getConnectionHostLabel,
  getDatabaseProvider,
  getMailProvider,
  getMailProviderKeyMismatch,
  inferMailProviderFromApiKey,
  inferDatabaseProviderFromUrl,
  hasUnsafeCredentialPlaceholder,
  isValidDatabaseUrl,
  requiresCustomMailEndpoint,
} from '../config/providers';
import './BusinessSetup.css';

type VerifyStep = {
  label: string;
  icon: LucideIcon;
  status: 'pending' | 'running' | 'success' | 'error';
  detail?: string;
  ms?: number;
};

type RemoteVerificationCheck = {
  key: 'txt' | 'mx' | 'spf' | 'dkim' | 'dmarc';
  label: string;
  status: 'pending' | 'verified' | 'failed';
  expected: string;
  actual?: string;
};

type RuntimeVerificationCheck = {
  key: string;
  label: string;
  status: 'verified' | 'failed';
  detail: string;
  category?: 'success' | 'network' | 'config' | 'software';
  recommendation?: string | null;
};

type ProviderDnsRecord = {
  recordType?: string;
  record_type?: string;
  name: string;
  value: string;
  status?: string | null;
  priority?: number | null;
};

function providerRecordType(record: ProviderDnsRecord): string {
  return String(record.recordType || record.record_type || 'TXT').toUpperCase();
}

function mapCheckToStep(check: RemoteVerificationCheck): VerifyStep {
  const iconByKey = {
    txt: Shield,
    mx: Mail,
    spf: Lock,
    dkim: Zap,
    dmarc: Server,
  };

  return {
    label: check.label,
    icon: iconByKey[check.key],
    status: check.status === 'verified' ? 'success' : check.status === 'failed' ? 'error' : 'pending',
    detail: check.actual || check.expected,
  };
}

function mapRuntimeCheckToStep(check: RuntimeVerificationCheck): VerifyStep {
  const iconByKey: Record<string, LucideIcon> = {
    request: Shield,
    database: Database,
    mailProvider: Mail,
    providerDomain: Globe,
    resendInboundWebhook: Mail,
    inboundRoute: Server,
  };

  return {
    label: check.label,
    icon: iconByKey[check.key] || Server,
    status: check.status === 'verified' ? 'success' : 'error',
    detail: check.detail,
  };
}

export default function BusinessSetup() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(() => auth.getSession());
  const [step, setStep] = useState(1); // 1: DB+API, 2: Domain, 3: Verify scan, 4: Done

  // Step 1 — Infrastructure
  const [dbProvider, setDbProvider] = useState('neon');
  const [customDbUrl, setCustomDbUrl] = useState('');
  const [apiProvider, setApiProvider] = useState('resend');
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [apiKey, setApiKey] = useState('');

  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (copiedValue) timer = setTimeout(() => setCopiedValue(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedValue]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedValue(text);
  };

  // Step 2 — Domain
  const [domainInput, setDomainInput] = useState('');
  const [currentDomainId, setCurrentDomainId] = useState('');
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);

  // Shared
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [verifySteps, setVerifySteps] = useState<VerifyStep[]>([]);
  const [providerDnsRecords, setProviderDnsRecords] = useState<ProviderDnsRecord[]>([]);

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  useEffect(() => {
    const session = auth.getSession();
    if (!session) {
      navigate('/login', { replace: true });
    } else if (isBusinessSetupReady(session)) {
      navigate('/business', { replace: true });
    } else {
      // Only use primary fields for step determination — profile fallbacks can be stale
      const existingDbUrl = session.businessDbUrl?.trim() || '';
      const existingApiKey = session.businessApiKey?.trim() || '';
      const existingProvider = session.businessMailProvider || session.businessProfile?.mailProvider || 'resend';
      const existingProviderEndpoint = session.businessMailProviderEndpoint || session.businessProfile?.mailProviderEndpoint || '';
      const existingWebhookSecret = session.businessMailWebhookSecret || session.businessProfile?.mailWebhookSecret || '';
      const existingDomain = session.businessDomain || '';
      const domainEntry = existingDomain ? domains.getByDomain(existingDomain) : null;

      setUser(session);
      setDbProvider(existingDbUrl ? inferDatabaseProviderFromUrl(existingDbUrl) : 'neon');
      setCustomDbUrl(existingDbUrl);
      setApiKey(existingApiKey);
      setApiProvider(existingProvider);
      setCustomApiUrl(existingProviderEndpoint);
      setWebhookSecret(existingWebhookSecret);
      setDomainInput(existingDomain);
      if (domainEntry) {
        setCurrentDomainId(domainEntry.id);
        setDnsRecords(domainEntry.dnsRecords);
      }
      // Only advance to step 2 if BOTH DB and API key are present
      if (existingDbUrl && existingApiKey) {
        setStep(2);
      } else {
        setStep(1);
      }
    }
  }, [navigate]);

  const selectedDatabaseProvider = getDatabaseProvider(dbProvider);
  const selectedMailProvider = getMailProvider(apiProvider);

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    const inferredProvider = inferMailProviderFromApiKey(value);
    if (inferredProvider && inferredProvider !== 'brevo_smtp' && inferredProvider !== apiProvider) {
      setApiProvider(inferredProvider);
    }
  };

  // Step 1 — Verify Infrastructure
  const handleInfraVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDbUrl.trim() || !apiKey.trim()) {
      setError('Both Database Connection URI and API Key are required.');
      return;
    }
    if (!isValidDatabaseUrl(customDbUrl)) {
      setError('Invalid or placeholder database connection string. Paste the real provider URI with the actual host, user, password, and database.');
      return;
    }
    if (hasUnsafeCredentialPlaceholder(customDbUrl)) {
      setError('Database connection still contains placeholder values. Replace every example/user/password/token value with the real provider credentials.');
      return;
    }
    if (apiKey.length < 8) {
      setError('API Key too short.');
      return;
    }
    if (hasUnsafeCredentialPlaceholder(apiKey)) {
      setError('Provider API key looks like a placeholder. Paste the real key from your provider account.');
      return;
    }
    const providerMismatch = getMailProviderKeyMismatch(apiProvider, apiKey);
    if (providerMismatch) {
      setError(providerMismatch);
      return;
    }
    if (requiresCustomMailEndpoint(apiProvider) && !customApiUrl.trim()) {
      setError('Custom mail providers require a valid delivery endpoint URL.');
      return;
    }
    if (apiProvider === 'resend' && !webhookSecret.trim()) {
      setError('Resend receiving requires your Resend webhook signing secret.');
      return;
    }
    if (apiProvider === 'resend' && hasUnsafeCredentialPlaceholder(webhookSecret)) {
      setError('Resend webhook secret looks like a placeholder. Paste the real whsec_ signing secret from your Resend webhook.');
      return;
    }
    setError('');
    setLoading(true);

    const finalProvider = apiProvider;
    const finalProviderEndpoint = providerEndpointForRequest(apiProvider, customApiUrl);
    try {
      const proxyTest = await fetchApiResponse('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dbProvider,
          dbUrl: customDbUrl.trim(),
          apiProvider: finalProvider,
          apiEndpoint: finalProviderEndpoint,
          apiKey: apiKey.trim(),
        }),
      });

      const responseData = await proxyTest.json().catch(() => null);
      if (!proxyTest.ok || !responseData?.success) {
        throw new Error(responseData?.message || 'Business infrastructure validation failed.');
      }

      const result = auth.updateSettings({
        businessDbUrl: customDbUrl.trim(),
        businessApiKey: apiKey.trim(),
        businessMailProvider: finalProvider,
        businessMailProviderEndpoint: finalProviderEndpoint,
        businessMailWebhookSecret: finalProvider === 'resend' ? webhookSecret.trim() : undefined,
        businessProfile: {
          ...user?.businessProfile,
          dbUrl: customDbUrl.trim(),
          apiKey: apiKey.trim(),
          mailProvider: finalProvider,
          mailProviderEndpoint: finalProviderEndpoint,
          mailWebhookSecret: finalProvider === 'resend' ? webhookSecret.trim() : undefined,
        },
      });

      if (!result.success) {
        throw new Error(result.error || 'Unable to save infrastructure configuration.');
      }

      setUser((prev) => prev ? ({
        ...prev,
        businessDbUrl: customDbUrl.trim(),
        businessApiKey: apiKey.trim(),
        businessMailProvider: finalProvider,
        businessMailProviderEndpoint: finalProviderEndpoint,
        businessMailWebhookSecret: finalProvider === 'resend' ? webhookSecret.trim() : undefined,
        businessProfile: {
          ...prev.businessProfile,
          dbUrl: customDbUrl.trim(),
          apiKey: apiKey.trim(),
          mailProvider: finalProvider,
          mailProviderEndpoint: finalProviderEndpoint,
          mailWebhookSecret: finalProvider === 'resend' ? webhookSecret.trim() : undefined,
        },
      }) : prev);

      setStep(2);
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : 'Unable to verify business infrastructure.';
      setError(baseMessage.includes('VelisMail API URL') ? `${baseMessage} ${getApiAvailabilityHint()}` : baseMessage);
    } finally {
      setLoading(false);
    }
  };

  // Step 2 — Add domain and generate DNS records
  const handleDomainAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) {
      setError('Please enter your business domain.');
      return;
    }
    setError('');
    const domain = domainInput.trim().toLowerCase();
    const domainRecord = domains.addDomain(domain);
    setDomainInput(domainRecord.domain);
    setCurrentDomainId(domainRecord.id);
    setDnsRecords(domainRecord.dnsRecords);
    setProviderDnsRecords([]);
    auth.updateSettings({
      businessDomain: domainRecord.domain,
      businessDomainVerified: false,
      businessProfile: {
        ...user?.businessProfile,
        domain: domainRecord.domain,
        dbUrl: customDbUrl,
        apiKey,
        mailProvider: apiProvider,
        mailProviderEndpoint: providerEndpointForRequest(apiProvider, customApiUrl),
        mailWebhookSecret: apiProvider === 'resend' ? webhookSecret.trim() : undefined,
        verified: false,
        dkimStatus: 'pending',
        spfStatus: 'pending',
        dmarcStatus: 'pending',
      },
    });

    try {
      const response = await fetchApiJsonDetailed<{
        providerRecords?: ProviderDnsRecord[];
      }>('/tenants/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domainRecord.domain,
          domainId: domainRecord.id,
          verificationToken: domainRecord.verificationToken,
          dbProvider,
          dbUrl: customDbUrl,
          apiKey,
          provider: apiProvider,
          providerEndpoint: providerEndpointForRequest(apiProvider, customApiUrl),
          webhookSecret: apiProvider === 'resend' ? webhookSecret.trim() : undefined,
        }),
      });
      const providerRecords = Array.isArray(response.data?.providerRecords) ? response.data.providerRecords : [];
      if (providerRecords.length > 0) {
        setProviderDnsRecords(providerRecords);
        const mergedRecords = mergeDnsRecords(domainRecord.dnsRecords, normalizeProviderDnsRecords(providerRecords, domainRecord.domain));
        setDnsRecords(mergedRecords);
        domains.updateDnsRecords(domainRecord.id, mergedRecords);
      }
    } catch {
      setError('DNS records generated. Provider-specific MX will be refreshed during manual verification.');
    }
  };

  // Step 2 → 3 — Start verification scan
  const handleDomainVerify = async () => {
    if (!currentDomainId) {
      setError('Generate DNS records before starting verification.');
      return;
    }
    if (!user) {
      setError('Session expired. Please log in again.');
      navigate('/login');
      return;
    }

    setStep(3);

    const domain = domainInput.trim().toLowerCase();
    const currentDomain = domains.getById(currentDomainId);
    const steps: VerifyStep[] = [
      { label: 'Ownership TXT', icon: Shield, status: 'pending', detail: currentDomain?.verificationToken || `_velismail-verify.${domain}` },
      { label: 'Inbound MX', icon: Mail, status: 'pending', detail: 'Provider-listed inbound MX for this domain region' },
      { label: 'Provider SPF', icon: Lock, status: 'pending', detail: 'Checked through your mail provider' },
      { label: 'Provider DKIM', icon: Zap, status: 'pending', detail: 'Checked through your mail provider' },
      { label: 'DMARC', icon: Server, status: 'pending', detail: `_dmarc.${domain}` },
      { label: 'Database Config', icon: Database, status: 'pending', detail: getConnectionHostLabel(customDbUrl) },
      { label: 'Mail Provider Config', icon: Mail, status: 'pending', detail: getMailProvider(apiProvider).label },
      { label: 'Domain Activation', icon: CheckCircle2, status: 'pending', detail: domain },
    ];
    setVerifySteps([...steps]);
    setProviderDnsRecords([]);

    try {
      const verificationStartedAt = performance.now();
      const response = await fetchApiJsonDetailed<{
        success: boolean;
        message: string;
        checks?: RemoteVerificationCheck[];
        runtimeChecks?: RuntimeVerificationCheck[];
        providerRecords?: ProviderDnsRecord[];
      }>('/tenants/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          domainId: currentDomainId,
          verificationToken: currentDomain?.verificationToken,
          dbProvider,
          dbUrl: customDbUrl,
          apiKey,
          provider: apiProvider,
          providerEndpoint: providerEndpointForRequest(apiProvider, customApiUrl),
          webhookSecret: apiProvider === 'resend' ? webhookSecret.trim() : undefined,
        }),
      });

      const responseData = response.data;
      if (!response.ok || !responseData?.success) {
        const failedRemoteChecks = Array.isArray(responseData?.checks) ? responseData.checks as RemoteVerificationCheck[] : [];
        const failedRuntimeChecks = Array.isArray(responseData?.runtimeChecks) ? responseData.runtimeChecks as RuntimeVerificationCheck[] : [];
        const failedProviderDns = Array.isArray(responseData?.providerRecords) ? responseData.providerRecords as ProviderDnsRecord[] : [];
        if (failedRemoteChecks.length || failedRuntimeChecks.length) {
          setVerifySteps([
            ...failedRemoteChecks.map(mapCheckToStep),
            ...failedRuntimeChecks.map(mapRuntimeCheckToStep),
            { label: 'Domain Activation', icon: CheckCircle2, status: 'error', detail: domain },
          ]);
        }
        setProviderDnsRecords(failedProviderDns);
        const mergedRecords = mergeDnsRecords(dnsRecords, normalizeProviderDnsRecords(failedProviderDns, domain));
        setDnsRecords(mergedRecords);
        domains.updateDnsRecords(currentDomainId, mergedRecords);
        throw new Error(responseData?.message || 'Live DNS/database/provider verification failed.');
      }
      const elapsed = Math.max(1, Math.round(performance.now() - verificationStartedAt));
      const remoteChecks = Array.isArray(responseData.checks) ? responseData.checks as RemoteVerificationCheck[] : [];
      const runtimeChecks = Array.isArray(responseData.runtimeChecks) ? responseData.runtimeChecks as RuntimeVerificationCheck[] : [];
      const providerDns = Array.isArray(responseData.providerRecords) ? responseData.providerRecords as ProviderDnsRecord[] : [];
      const remoteSteps = remoteChecks.map(mapCheckToStep);
      const runtimeSteps = runtimeChecks.map(mapRuntimeCheckToStep);
      const domainPassed = remoteChecks.length > 0 && remoteChecks.every((check) => check.status === 'verified');
      const runtimePassed = runtimeChecks.every((check) => check.status === 'verified');
      const configStatus: VerifyStep['status'] = domainPassed && runtimePassed ? 'success' : 'error';

      setVerifySteps([
        ...remoteSteps.map((stepItem) => ({ ...stepItem, ms: elapsed })),
        ...runtimeSteps.map((stepItem) => ({ ...stepItem, ms: elapsed })),
        { label: 'Domain Activation', icon: CheckCircle2, status: configStatus, detail: domain, ms: elapsed },
      ]);
      setProviderDnsRecords(providerDns);
      const mergedRecords = mergeDnsRecords(dnsRecords, normalizeProviderDnsRecords(providerDns, domain));
      setDnsRecords(mergedRecords);
      domains.updateDnsRecords(currentDomainId, mergedRecords);

      if (!domainPassed || !runtimePassed) {
        const failedCheck = remoteChecks.find((check) => check.status !== 'verified');
        const failedRuntime = runtimeChecks.find((check) => check.status !== 'verified');
        throw new Error(
          failedRuntime?.detail ||
          failedCheck?.actual ||
          failedCheck?.expected ||
          'DNS verification is still incomplete.',
        );
      }

      const verifiedDomain = domains.runVerification(currentDomainId, remoteChecks);
      if (!verifiedDomain || verifiedDomain.status !== 'verified') {
        throw new Error('Domain verification state could not be saved.');
      }

      const businessMailboxAddress = `admin@${verifiedDomain.domain}`;
      const updateResult = auth.updateSettings({
        email: user.accountType === 'business' ? businessMailboxAddress : user.email,
        recoveryEmail: user.recoveryEmail || user.email,
        businessMailboxAddress,
        isBusinessSetupComplete: true,
        businessDomainVerified: true,
        businessDomain: verifiedDomain.domain,
        dkimStatus: 'verified',
        spfStatus: 'verified',
        dmarcStatus: 'verified',
        businessProfile: {
          ...user?.businessProfile,
          domain: verifiedDomain.domain,
          dbUrl: customDbUrl,
          apiKey,
          mailProvider: apiProvider,
          mailProviderEndpoint: providerEndpointForRequest(apiProvider, customApiUrl),
          mailWebhookSecret: apiProvider === 'resend' ? webhookSecret.trim() : undefined,
          verified: true,
          dkimStatus: 'verified',
          spfStatus: 'verified',
          dmarcStatus: 'verified',
        },
      });
      if (!updateResult.success || !updateResult.user) {
        throw new Error(updateResult.error || 'Business mailbox activation failed.');
      }
      setUser(updateResult.user);
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : 'Verification failed. Complete every DNS, database, and provider check before access is allowed.';
      const isNetworkFailure = /Failed to fetch|Network request failed|Unable to reach the VelisMail API/i.test(baseMessage);
      const finalMessage = isNetworkFailure
        ? `Unable to reach the domain verification service. ${getApiAvailabilityHint()}`
        : baseMessage.includes('VelisMail API URL')
          ? `${baseMessage} ${getApiAvailabilityHint()}`
          : baseMessage;
      setError(finalMessage);
      if (isNetworkFailure) {
        setVerifySteps((prev) => ([
          ...prev.slice(0, Math.max(prev.length - 1, 0)),
          {
            label: 'Verification Service',
            icon: Wifi,
            status: 'error',
            detail: finalMessage,
          },
          {
            label: 'Domain Activation',
            icon: CheckCircle2,
            status: 'error',
            detail: domain,
          },
        ]));
      }
      return;
    }

    setStep(4);
  };

  if (!user) return <Navigate to="/login" replace />;

  const displayedDnsRecords = mergeDnsRecords(dnsRecords, normalizeProviderDnsRecords(providerDnsRecords, domainInput));

  return (
    <div className="bsetup-page">
      <nav className="bsetup-nav">
        <div className="page-container bsetup-nav-inner">
          <div className="mobile-brand">
            <img src="/ZeeResizer.png" alt="VelisMail" />
            <span>VelisMail</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => auth.logout()}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </nav>

      <div className="page-container bsetup-container">
        {/* Progress Bar */}
        <div className="bsetup-progress">
          <div className={`bsetup-progress-step ${step === 1 ? 'active' : step > 1 ? 'done' : ''}`}>
            <div className="bsetup-step-num">{step > 1 ? <CheckCircle2 size={16} /> : '1'}</div>
            <span>Infrastructure</span>
          </div>
          <div className={`bsetup-progress-step ${step === 2 ? 'active' : step > 2 ? 'done' : ''}`}>
            <div className="bsetup-step-num">{step > 2 ? <CheckCircle2 size={16} /> : '2'}</div>
            <span>Domain Setup</span>
          </div>
          <div className={`bsetup-progress-step ${step === 3 ? 'active' : step > 3 ? 'done' : ''}`}>
            <div className="bsetup-step-num">{step > 3 ? <CheckCircle2 size={16} /> : '3'}</div>
            <span>Verification</span>
          </div>
          <div className={`bsetup-progress-step ${step === 4 ? 'active' : ''}`}>
            <div className="bsetup-step-num">4</div>
            <span>Ready</span>
          </div>
        </div>

        {/* Step 1: Infrastructure */}
        {step === 1 && (
          <div className="bsetup-card glass animate-fade">
            <h2><Database size={22} /> Business Infrastructure</h2>
            <p className="bsetup-desc">Configure your business database and outbound provider. Access stays blocked until the live runtime checks succeed.</p>
            {error && <div className="form-error">{error}</div>}
            <form onSubmit={handleInfraVerify} className="bsetup-form">
              <div className="form-group">
                <label>Database Provider</label>
                <select className="input" value={dbProvider} onChange={e => setDbProvider(e.target.value)}>
                  {DATABASE_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
                <small>{selectedDatabaseProvider.description}</small>
              </div>
              <div className="form-group">
                <label>Connection String</label>
                <input
                  type="text"
                  name="velismail-business-db-uri"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  className="input"
                  placeholder={selectedDatabaseProvider.placeholder}
                  value={customDbUrl}
                  onChange={e => setCustomDbUrl(e.target.value)}
                  required
                />
              </div>
              <div className="divider" />
              <div className="form-group">
                <label>Mail Relay Provider</label>
                <select className="input" value={apiProvider} onChange={e => setApiProvider(e.target.value)}>
                  {MAIL_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
                <small>{selectedMailProvider.description}</small>
              </div>
              {requiresCustomMailEndpoint(apiProvider) && (
                <div className="form-group animate-slide-down">
                  <label>Custom Endpoint</label>
                  <input type="url" className="input" placeholder="https://api.yourmail.com/v1/send" value={customApiUrl} onChange={e => setCustomApiUrl(e.target.value)} required />
                </div>
              )}
              {apiProvider === 'resend' && (
                <div className="form-group animate-slide-down">
                  <label>Resend Webhook Signing Secret</label>
                  <input
                    type="text"
                    name="velismail-resend-webhook-secret"
                    className="input"
                    placeholder="whsec_..."
                    value={webhookSecret}
                    onChange={e => setWebhookSecret(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                    required
                  />
                  <small>Add this webhook in your Resend account: https://api.velismail.online/api/v1/mail/inbound</small>
                </div>
              )}
              <div className="form-group">
                <label>Secret API Key</label>
                <input type="text"
                  name="velismail-provider-api-key"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-1p-ignore="true" 
                  data-lpignore="true" 
                  className="input" 
                  placeholder={selectedMailProvider.placeholder} 
                  value={apiKey} 
                  onChange={e => handleApiKeyChange(e.target.value)} 
                  required 
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? <LoadingSpinner size="sm" label="Saving setup" /> : <ArrowRight size={16} />}
                Verify & Continue
              </button>
            </form>
          </div>
        )}

        {/* Step 2: Domain */}
        {step === 2 && (
          <div className="bsetup-card glass animate-fade">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}><Globe size={22} /> Configure Business Domain</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => { setStep(1); setError(''); }}>
                <ArrowLeft size={14} /> Back to Infrastructure
              </button>
            </div>
            <p className="bsetup-desc">Connect your custom domain to send and receive business emails.</p>
            {error && <div className="form-error">{error}</div>}

            {displayedDnsRecords.length === 0 ? (
              <form onSubmit={handleDomainAdd} className="bsetup-form">
                <div className="form-group">
                  <label>Business Domain</label>
                  <input type="text" className="input" placeholder="yourbusiness.com" value={domainInput} onChange={e => setDomainInput(e.target.value)} required />
                </div>
                <button className="btn btn-primary" type="submit"><Globe size={16} /> Generate DNS Records</button>
              </form>
            ) : (
              <div className="bsetup-dns">
                <p className="dns-instruction-text">Add these DNS records manually at your domain registrar. The MX value is always loaded from your selected mail provider for the exact domain region.</p>
                <div className="dns-records-table">
                  <div className="dns-table-header">
                    <span className="dns-col-type">Type</span>
                    <span className="dns-col-name">Host / Name</span>
                    <span className="dns-col-value">Value / Points To</span>
                    <span className="dns-col-priority">Priority</span>
                    <span className="dns-col-ttl">TTL</span>
                  </div>
                  {displayedDnsRecords.map((rec, i) => {
                    const recordKey = `setup-${i}`;
                    return (
                      <div key={recordKey} className="dns-table-row">
                        <span className="dns-col-type">
                          <span className={`dns-type-badge dns-type-${rec.type.toLowerCase()}`}>{rec.type}</span>
                        </span>
                        <span className="dns-col-name">
                          <code className="dns-field-value">{rec.name}</code>
                          <button
                            className="dns-copy-btn"
                            onClick={() => handleCopy(rec.name)}
                            title="Copy host name"
                          >
                            {copiedValue === rec.name ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span className="dns-col-value">
                          <code className="dns-field-value">{rec.value}</code>
                          <button
                            className="dns-copy-btn"
                            onClick={() => handleCopy(rec.value)}
                            title="Copy value"
                          >
                            {copiedValue === rec.value ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span className="dns-col-priority">
                          {rec.priority ? (
                            <>
                              <code className="dns-field-value">{rec.priority}</code>
                              <button
                                className="dns-copy-btn"
                                onClick={() => handleCopy(String(rec.priority))}
                                title="Copy priority"
                              >
                                {copiedValue === String(rec.priority) ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                              </button>
                            </>
                          ) : <span className="dns-field-na">—</span>}
                        </span>
                        <span className="dns-col-ttl">
                          <code className="dns-field-value">{rec.ttl || 3600}</code>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={handleDomainVerify}>
                    <CheckCircle2 size={16} /> Verify Domain Manually
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Verification Scan */}
        {step === 3 && (
          <div className="bsetup-card glass animate-fade">
            <div className="diag-header" style={{ marginBottom: 20 }}>
              <Wifi size={16} className="animate-pulse" />
              <span>Domain Verification Scan</span>
              <span className="diag-status">Scanning…</span>
            </div>
            {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div className="diag-steps">
              {verifySteps.map((vs, i) => {
                const StepIcon = vs.icon;
                return (
                  <div key={i} className={`diag-step diag-${vs.status}`}>
                    <div className="diag-step-icon">
                      {vs.status === 'running' ? <LoadingSpinner size="sm" label="Running verification" /> :
                       vs.status === 'success' ? <CheckCircle2 size={16} /> :
                       vs.status === 'error' ? <XCircle size={16} /> :
                       <StepIcon size={16} />}
                    </div>
                    <div className="diag-step-info">
                      <span className="diag-step-label">{vs.label}</span>
                      <span className="diag-step-detail">{vs.detail}</span>
                    </div>
                    {vs.ms && <span className="diag-step-ms">{vs.ms}ms</span>}
                  </div>
                );
              })}
            </div>
            {providerDnsRecords.length > 0 && (
              <div className="bsetup-dns" style={{ marginTop: 20 }}>
                <p className="dns-instruction-text">Provider-side DNS records still required before mail can send and receive:</p>
                <div className="dns-records-table">
                  <div className="dns-table-header">
                    <span className="dns-col-type">Type</span>
                    <span className="dns-col-name">Host / Name</span>
                    <span className="dns-col-value">Value / Points To</span>
                    <span className="dns-col-priority">Priority</span>
                    <span className="dns-col-ttl">Status</span>
                  </div>
                  {providerDnsRecords.map((rec, i) => {
                    const recordKey = `s3-${i}`;
                    const recordType = providerRecordType(rec);
                    return (
                      <div key={recordKey} className="dns-table-row">
                        <span className="dns-col-type">
                          <span className={`dns-type-badge dns-type-${recordType.toLowerCase()}`}>{recordType}</span>
                        </span>
                        <span className="dns-col-name">
                          <code className="dns-field-value">{rec.name}</code>
                          <button className="dns-copy-btn" onClick={() => handleCopy(rec.name)} title="Copy name">
                            {copiedValue === rec.name ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span className="dns-col-value">
                          <code className="dns-field-value">{rec.value}</code>
                          <button className="dns-copy-btn" onClick={() => handleCopy(rec.value)} title="Copy value">
                            {copiedValue === rec.value ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span className="dns-col-priority">
                          {rec.priority ? <code className="dns-field-value">{rec.priority}</code> : <span className="dns-field-na">—</span>}
                        </span>
                        <span className="dns-col-ttl">
                          <span className={`badge badge-sm ${rec.status === 'verified' ? 'badge-accent' : 'badge-secondary'}`}>{rec.status || 'pending'}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn btn-ghost" onClick={() => setStep(2)}>Back to DNS Setup</button>
              <button className="btn btn-primary" onClick={handleDomainVerify}>
                <CheckCircle2 size={16} /> Retry Verification
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 4 && (
          <div className="bsetup-card glass animate-scale" style={{ textAlign: 'center' }}>
            <div className="bsetup-success-icon"><CheckCircle2 size={56} color="var(--accent)" /></div>
            <h2>Business Mail Activated!</h2>
            <p className="bsetup-desc">Your domain <strong>{domainInput}</strong> is now verified and connected. Your first business mailbox is <strong>{user.businessMailboxAddress || `admin@${domainInput}`}</strong>.</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 28 }}>
              <button className="btn btn-primary" onClick={() => navigate('/business')}>
                <Mail size={16} /> Open Business Dashboard
              </button>
            </div>
          </div>
        )}

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="logout-confirm-modal glass-card animate-scale" onClick={e => e.stopPropagation()}>
            <div className="logout-confirm-icon">
              <LogOut size={40} color="var(--danger)" />
            </div>
            <h3>Sign Out</h3>
            <p>Are you sure you want to sign out of the workspace setup?</p>
            <div className="logout-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleLogout}><LogOut size={16} /> Yes, Sign Out</button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
