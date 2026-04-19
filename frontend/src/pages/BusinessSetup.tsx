import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Database, Mail, CheckCircle2, Server, Loader2, Lock, Globe,
  Zap, Shield, ArrowLeft, ArrowRight, XCircle, Wifi
} from 'lucide-react';
import { auth, domains, type DnsRecord, type User } from '../api/client';
import './BusinessSetup.css';

type VerifyStep = {
  label: string;
  icon: any;
  status: 'pending' | 'running' | 'success' | 'error';
  detail?: string;
  ms?: number;
};

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
      const domainEntry = existingDomain ? domains.getByDomain(existingDomain) : null;

      setUser(session);
      setCustomDbUrl(existingDbUrl);
      setApiKey(existingApiKey);
      setApiProvider(existingProvider);
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

  // Step 1 — Verify Infrastructure
  const handleInfraVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDbUrl.trim() || !apiKey.trim()) {
      setError('Both Database Connection URI and API Key are required.');
      return;
    }
    const dbRegex = /^(postgresql|postgres|mysql|sqlite|mongodb(\+srv)?|redis|custom):\/\/.+/i;
    if (!dbRegex.test(customDbUrl)) {
      setError('Invalid Database Connection schema. Expected protocol://user:pass@host/db');
      return;
    }
    if (apiKey.length < 8) {
      setError('API Key too short.');
      return;
    }
    setError('');
    setLoading(true);

    const finalProvider = apiProvider === 'others' && customApiUrl.trim() ? customApiUrl : apiProvider;
    auth.updateSettings({
      businessDbUrl: customDbUrl,
      businessApiKey: apiKey,
      businessMailProvider: finalProvider,
    });

    setLoading(false);
    setStep(2);
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

    setStep(3);

    const domain = domainInput.trim().toLowerCase();
    const steps: VerifyStep[] = [
      { label: 'DNS Propagation Check', icon: Globe, status: 'pending', detail: domain },
      { label: 'TXT Record Verification', icon: Shield, status: 'pending', detail: '_velismail-verify.' + domain },
      { label: 'MX Record Validation', icon: Mail, status: 'pending', detail: 'mx1.velismail.online' },
      { label: 'SPF Policy Check', icon: Lock, status: 'pending', detail: 'v=spf1 include:velismail.online' },
      { label: 'DKIM Key Exchange', icon: Zap, status: 'pending', detail: 'dkim._domainkey.' + domain },
      { label: 'DMARC Policy Enforcement', icon: Server, status: 'pending', detail: '_dmarc.' + domain },
      { label: 'Database Connectivity', icon: Database, status: 'pending', detail: user?.businessDbUrl?.split('@')[1]?.split('/')[0] || 'localhost' },
      { label: 'SMTP Relay Handshake', icon: Mail, status: 'pending', detail: (user?.businessMailProvider || 'sendgrid') + ':587' },
      { label: 'Domain Activation', icon: CheckCircle2, status: 'pending', detail: domain },
    ];
    setVerifySteps([...steps]);

    try {
      const verificationStartedAt = performance.now();
      const response = await fetch((import.meta.env.VITE_API_URL || '') + '/api/business/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          domainId: currentDomainId,
          dbUrl: customDbUrl,
          apiKey,
          provider: apiProvider,
        }),
      });

      if (!response.ok) {
        throw new Error('Live DNS/database/provider verification failed.');
      }

      const elapsed = Math.max(1, Math.round(performance.now() - verificationStartedAt));
      for (let i = 0; i < steps.length; i++) {
        steps[i].status = 'success';
        steps[i].ms = elapsed;
      }
      setVerifySteps([...steps]);
    } catch (err) {
      steps.forEach(stepItem => {
        stepItem.status = 'error';
      });
      setVerifySteps([...steps]);
      setError(err instanceof Error ? err.message : 'Verification failed. Complete every DNS, database, and provider check before access is allowed.');
      setStep(2);
      return;
    }

    const verifiedDomain = domains.runVerification(currentDomainId);
    if (!verifiedDomain) {
      setError('Domain verification state could not be saved.');
      setStep(2);
      return;
    }

    // Mark business setup as complete
    auth.updateSettings({
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
        verified: true,
        dkimStatus: 'verified',
        spfStatus: 'verified',
        dmarcStatus: 'verified',
      },
    });
    setUser(prev => prev ? ({
      ...prev,
      isBusinessSetupComplete: true,
      businessDomain: verifiedDomain.domain,
      businessDomainVerified: true,
      dkimStatus: 'verified',
      spfStatus: 'verified',
      dmarcStatus: 'verified',
    }) : prev);

    setStep(4);
  };

  if (!user) return null;

  return (
    <div className="bsetup-page">
      <nav className="bsetup-nav">
        <div className="container bsetup-nav-inner">
          <Link to="/dashboard" className="nav-logo">
            <img src="/ZeeResizer.png" className="logo-img" alt="VelisMail" />
            <span className="logo-text">VelisMail</span>
            <span className="badge badge-primary" style={{ marginLeft: 8 }}>Business</span>
          </Link>
          <Link to="/dashboard" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back to Normal Mail</Link>
        </div>
      </nav>

      <div className="bsetup-container">
        {/* Progress Bar */}
        <div className="bsetup-progress">
          {['Infrastructure', 'Domain Setup', 'Verification', 'Complete'].map((label, i) => (
            <div key={i} className={`bsetup-progress-step ${step > i + 1 ? 'done' : step === i + 1 ? 'active' : ''}`}>
              <div className="bsetup-step-num">{step > i + 1 ? <CheckCircle2 size={16} /> : i + 1}</div>
              <span>{label}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Infrastructure */}
        {step === 1 && (
          <div className="bsetup-card glass animate-fade">
            <h2><Database size={22} /> Business Infrastructure</h2>
            <p className="bsetup-desc">Configure your private database and mail relay for your business domain.</p>
            {error && <div className="form-error">{error}</div>}
            <form onSubmit={handleInfraVerify} className="bsetup-form">
              <div className="form-group">
                <label>Database Provider</label>
                <select className="input" value={dbProvider} onChange={e => setDbProvider(e.target.value)}>
                  <option value="postgresql">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="sqlite">SQLite</option>
                  <option value="mongodb">MongoDB</option>
                  <option value="redis">Redis Cluster</option>
                  <option value="others">Others (Custom)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Connection String</label>
                <input type="password" className="input" placeholder={`${dbProvider}://user:pass@host:port/database`} value={customDbUrl} onChange={e => setCustomDbUrl(e.target.value)} required />
              </div>
              <div className="divider" />
              <div className="form-group">
                <label>Mail Relay Provider</label>
                <select className="input" value={apiProvider} onChange={e => setApiProvider(e.target.value)}>
                  <option value="sendgrid">SendGrid</option>
                  <option value="resend">Resend</option>
                  <option value="mailgun">Mailgun</option>
                  <option value="postmark">Postmark</option>
                  <option value="ses">Amazon SES</option>
                  <option value="others">Others (Custom)</option>
                </select>
              </div>
              {apiProvider === 'others' && (
                <div className="form-group animate-slide-down">
                  <label>Custom Endpoint</label>
                  <input type="url" className="input" placeholder="https://api.yourmail.com/v1/send" value={customApiUrl} onChange={e => setCustomApiUrl(e.target.value)} required />
                </div>
              )}
              <div className="form-group">
                <label>Secret API Key</label>
                <input type="password" className="input" placeholder="sk_live_..." value={apiKey} onChange={e => setApiKey(e.target.value)} required />
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
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 4 && (
          <div className="bsetup-card glass animate-scale" style={{ textAlign: 'center' }}>
            <div className="bsetup-success-icon"><CheckCircle2 size={56} color="var(--accent)" /></div>
            <h2>Business Mail Activated!</h2>
            <p className="bsetup-desc">Your domain <strong>{domainInput}</strong> is now verified and connected. All DNS records are live.</p>
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
