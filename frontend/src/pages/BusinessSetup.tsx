import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Database, Mail, CheckCircle2, Server, Loader2, Lock, Globe,
  Zap, Shield, ArrowRight, XCircle, Wifi, LogOut
} from 'lucide-react';
import { auth, domains, fetchApiJsonDetailed, fetchApiResponse, getApiAvailabilityHint, type DnsRecord, type User } from '../api/client';
import {
  DATABASE_PROVIDERS,
  MAIL_PROVIDERS,
  getConnectionHostLabel,
  getDatabaseProvider,
  getMailProvider,
  getMailProviderKeyMismatch,
  inferMailProviderFromApiKey,
  inferDatabaseProviderFromUrl,
  isValidDatabaseUrl,
  requiresCustomMailEndpoint,
} from '../config/providers';
import './BusinessSetup.css';

type VerifyStep = {
  label: string;
  icon: any;
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
  recordType: string;
  name: string;
  value: string;
  status?: string | null;
  priority?: number | null;
};

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
  const iconByKey: Record<string, any> = {
    request: Shield,
    database: Database,
    mailProvider: Mail,
    providerDomain: Globe,
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
  const [user, setUser] = useState<User | null>(null);
  const [step, setStep] = useState(1); // 1: DB+API, 2: Domain, 3: Verify scan, 4: Done

  // Step 1 — Infrastructure
  const [dbProvider, setDbProvider] = useState('postgresql');
  const [customDbUrl, setCustomDbUrl] = useState('');
  const [apiProvider, setApiProvider] = useState('sendgrid');
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Step 2 — Domain
  const [domainInput, setDomainInput] = useState('');
  const [currentDomainId, setCurrentDomainId] = useState('');
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);

  // Shared
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifySteps, setVerifySteps] = useState<VerifyStep[]>([]);
  const [providerDnsRecords, setProviderDnsRecords] = useState<ProviderDnsRecord[]>([]);

  useEffect(() => {
    const session = auth.getSession();
    if (!session) {
      navigate('/login');
    } else if (session.isBusinessSetupComplete) {
      navigate('/business');
    } else {
      const existingDomain = session.businessDomain || session.businessProfile?.domain || '';
      const existingDbUrl = session.businessDbUrl || session.businessProfile?.dbUrl || '';
      const existingApiKey = session.businessApiKey || session.businessProfile?.apiKey || '';
      const existingProvider = session.businessMailProvider || session.businessProfile?.mailProvider || 'sendgrid';
      const existingProviderEndpoint = session.businessMailProviderEndpoint || session.businessProfile?.mailProviderEndpoint || '';
      const domainEntry = existingDomain ? domains.getByDomain(existingDomain) : null;

      setUser(session);
      setDbProvider(inferDatabaseProviderFromUrl(existingDbUrl));
      setCustomDbUrl(existingDbUrl);
      setApiKey(existingApiKey);
      setApiProvider(existingProvider);
      setCustomApiUrl(existingProviderEndpoint);
      setDomainInput(existingDomain);
      if (domainEntry) {
        setCurrentDomainId(domainEntry.id);
        setDnsRecords(domainEntry.dnsRecords);
      }
      if (existingDbUrl && existingApiKey) {
        setStep(2);
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
      setError('Invalid Database Connection schema. Expected protocol://user:pass@host/db');
      return;
    }
    if (apiKey.length < 8) {
      setError('API Key too short.');
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
    setError('');
    setLoading(true);

    const finalProvider = apiProvider;
    const finalProviderEndpoint = requiresCustomMailEndpoint(apiProvider) ? customApiUrl.trim() : undefined;
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
        businessProfile: {
          ...user?.businessProfile,
          dbUrl: customDbUrl.trim(),
          apiKey: apiKey.trim(),
          mailProvider: finalProvider,
          mailProviderEndpoint: finalProviderEndpoint,
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
        businessProfile: {
          ...prev.businessProfile,
          dbUrl: customDbUrl.trim(),
          apiKey: apiKey.trim(),
          mailProvider: finalProvider,
          mailProviderEndpoint: finalProviderEndpoint,
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
  const handleDomainAdd = (e: React.FormEvent) => {
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
    auth.updateSettings({
      businessDomain: domainRecord.domain,
      businessDomainVerified: false,
      businessProfile: {
        ...user?.businessProfile,
        domain: domainRecord.domain,
        dbUrl: customDbUrl,
        apiKey,
        mailProvider: apiProvider,
        mailProviderEndpoint: requiresCustomMailEndpoint(apiProvider) ? customApiUrl.trim() : undefined,
        verified: false,
        dkimStatus: 'pending',
        spfStatus: 'pending',
        dmarcStatus: 'pending',
      },
    });
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
      { label: 'Inbound MX', icon: Mail, status: 'pending', detail: 'mx1.velismail.online / mx2.velismail.online' },
      { label: 'SPF', icon: Lock, status: 'pending', detail: 'v=spf1 include:velismail.online ~all' },
      { label: 'DKIM', icon: Zap, status: 'pending', detail: `velismail._domainkey.${domain}` },
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
          providerEndpoint: requiresCustomMailEndpoint(apiProvider) ? customApiUrl.trim() : undefined,
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
          mailProviderEndpoint: requiresCustomMailEndpoint(apiProvider) ? customApiUrl.trim() : undefined,
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

  if (!user) return null;

  return (
    <div className="bsetup-page">
      <nav className="bsetup-nav">
        <div className="container bsetup-nav-inner">
          <div className="dash-brand" onClick={() => navigate('/')}>
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '20px' }} />
            <div className="dash-brand-info">
              <span className="dash-brand-name">VelisMail</span>
              <span className="badge badge-accent dash-brand-sub" style={{ fontSize: '0.6rem' }}>Onboarding</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowLogoutConfirm(true)}>
            <LogOut size={16} /> Save & Exit
          </button>
        </div>
      </nav>

      <div className="bsetup-container">
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
                <input type="text" 
                  autoComplete="off" 
                  data-1p-ignore="true" 
                  data-lpignore="true" 
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
              <div className="form-group">
                <label>Secret API Key</label>
                <input type="text" 
                  autoComplete="off" 
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
                {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                Verify & Continue
              </button>
            </form>
          </div>
        )}

        {/* Step 2: Domain */}
        {step === 2 && (
          <div className="bsetup-card glass animate-fade">
            <h2><Globe size={22} /> Configure Business Domain</h2>
            <p className="bsetup-desc">Connect your custom domain to send and receive business emails.</p>
            {error && <div className="form-error">{error}</div>}

            {dnsRecords.length === 0 ? (
              <form onSubmit={handleDomainAdd} className="bsetup-form">
                <div className="form-group">
                  <label>Business Domain</label>
                  <input type="text" className="input" placeholder="yourbusiness.com" value={domainInput} onChange={e => setDomainInput(e.target.value)} required />
                </div>
                <button className="btn btn-primary" type="submit"><Globe size={16} /> Generate DNS Records</button>
              </form>
            ) : (
              <div className="bsetup-dns">
                <p className="dns-instruction-text">Add these DNS records to your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.):</p>
                <table className="dns-table">
                  <thead>
                    <tr><th>Type</th><th>Name</th><th>Value</th></tr>
                  </thead>
                  <tbody>
                    {dnsRecords.map((rec, i) => (
                      <tr key={i}>
                        <td><span className="dns-type">{rec.type}</span></td>
                        <td className="dns-name">{rec.name}</td>
                        <td className="dns-value">
                          {rec.value}
                          {rec.priority ? ` (priority ${rec.priority})` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn btn-primary" onClick={handleDomainVerify} style={{ marginTop: 24 }}>
                  <CheckCircle2 size={16} /> Verify Domain & Configure
                </button>
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
                      {vs.status === 'running' ? <Loader2 size={16} className="animate-spin" /> :
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
                <p className="dns-instruction-text">Provider-side DNS records still required before mail can send:</p>
                <table className="dns-table">
                  <thead>
                    <tr><th>Type</th><th>Name</th><th>Value</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {providerDnsRecords.map((rec, i) => (
                      <tr key={`${rec.name}-${i}`}>
                        <td><span className="dns-type">{rec.recordType}</span></td>
                        <td className="dns-name">{rec.name}</td>
                        <td className="dns-value">
                          {rec.value}
                          {rec.priority ? ` (priority ${rec.priority})` : ''}
                        </td>
                        <td>{rec.status || 'pending'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
      </div>
    </div>
  );
}
