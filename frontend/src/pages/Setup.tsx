import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  ChevronLeft,
  Database,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Play,
  RefreshCcw,
  ServerCog,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import {
  auth,
  fetchApiJsonDetailed,
  getApiAvailabilityHint,
  type User,
} from '../api/client';
import {
  DATABASE_PROVIDERS,
  MAIL_PROVIDERS,
  getConnectionHostLabel,
  getDatabaseProvider,
  getMailProvider,
  getMailProviderKeyMismatch,
  inferDatabaseProviderFromUrl,
  inferMailProviderFromApiKey,
  isValidDatabaseUrl,
  requiresCustomMailEndpoint,
} from '../config/providers';
import './Setup.css';

type VerifyScreen = 'form' | 'verifying' | 'result';

type InfraCheck = {
  key: string;
  label: string;
  status: 'verified' | 'failed';
  detail: string;
  category?: 'success' | 'network' | 'config' | 'software';
  recommendation?: string | null;
};

type InfraVerifyResponse = {
  success: boolean;
  message: string;
  provider?: string;
  dbProtocol?: string;
  databaseTarget?: string;
  failingCheck?: string | null;
  failingCategory?: 'success' | 'network' | 'config' | 'software' | null;
  issueOwner?: 'connected' | 'user-config' | 'server-network' | 'velismail' | 'unknown' | string;
  checks?: InfraCheck[];
};

const VERIFY_STAGE_LABELS = [
  'Parsing database and mail configuration',
  'Resolving database host and testing live connectivity',
  'Verifying outbound provider credentials',
];

function buildSoftwareFailure(message: string): InfraVerifyResponse {
  return {
    success: false,
    message,
    checks: [
      {
        key: 'software',
        label: 'Software Runtime Check',
        status: 'failed',
        detail: message,
        category: 'software',
        recommendation: 'This looks like an application-side issue. Review the request/response path and redeploy the latest backend/frontend build.',
      },
    ],
  };
}

function normalizeVerifyResponse(
  payload: InfraVerifyResponse | null,
  fallbackMessage: string,
): InfraVerifyResponse {
  if (!payload) {
    return buildSoftwareFailure(fallbackMessage);
  }

  return {
    success: Boolean(payload.success),
    message: payload.message || fallbackMessage,
    provider: payload.provider,
    dbProtocol: payload.dbProtocol,
    databaseTarget: payload.databaseTarget,
    failingCheck: payload.failingCheck,
    failingCategory: payload.failingCategory,
    issueOwner: payload.issueOwner,
    checks: Array.isArray(payload.checks) ? payload.checks : [],
  };
}

function getCheckTone(check: InfraCheck): 'success' | 'network' | 'config' | 'software' {
  if (check.status === 'verified') {
    return 'success';
  }
  return check.category || 'config';
}

function getCheckIcon(check: InfraCheck) {
  const tone = getCheckTone(check);
  switch (tone) {
    case 'success':
      return ShieldCheck;
    case 'network':
      return WifiOff;
    case 'software':
      return Bug;
    case 'config':
    default:
      return AlertTriangle;
  }
}

function getToneLabel(tone: 'success' | 'network' | 'config' | 'software'): string {
  switch (tone) {
    case 'success':
      return 'Connected';
    case 'network':
      return 'Network issue';
    case 'software':
      return 'Software issue';
    case 'config':
    default:
      return 'Configuration issue';
  }
}

function getIssueOwnerLabel(owner?: string | null): string {
  switch (owner) {
    case 'user-config':
      return 'Your configuration';
    case 'server-network':
      return 'Server network path';
    case 'velismail':
      return 'VelisMail software';
    case 'connected':
      return 'Everything connected';
    default:
      return 'Needs review';
  }
}

export default function SetupPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [dbProvider, setDbProvider] = useState('postgresql');
  const [customDbUrl, setCustomDbUrl] = useState('');
  const [apiProvider, setApiProvider] = useState('sendgrid');
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [screen, setScreen] = useState<VerifyScreen>('form');
  const [error, setError] = useState('');
  const [verifyResult, setVerifyResult] = useState<InfraVerifyResponse | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState(0);

  useEffect(() => {
    const session = auth.getSession();
    if (!session) {
      navigate('/login');
      return;
    }

    if (session.isSetupComplete) {
      navigate('/dashboard');
      return;
    }

    setDbProvider(inferDatabaseProviderFromUrl(session.customDbUrl || ''));
    setApiProvider(session.mailProvider || 'sendgrid');
    setCustomDbUrl(session.customDbUrl || '');
    setApiKey(session.apiKey || '');
    setCustomApiUrl(session.mailProviderEndpoint || '');
    setUser(session);
  }, [navigate]);

  useEffect(() => {
    if (!verifying) {
      setActiveStageIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setActiveStageIndex((current) => (current + 1) % VERIFY_STAGE_LABELS.length);
    }, 900);

    return () => window.clearInterval(interval);
  }, [verifying]);

  const selectedDatabaseProvider = getDatabaseProvider(dbProvider);
  const selectedMailProvider = getMailProvider(apiProvider);

  const verificationChecks = verifyResult?.checks || [];
  const hasFailures = verificationChecks.some((check) => check.status !== 'verified');
  const dominantFailure = verificationChecks.find((check) => check.status !== 'verified');

  const resultSummary = useMemo(() => {
    if (!verifyResult) {
      return {
        title: 'Runtime diagnostics unavailable',
        description: 'VelisMail could not collect verification details from the backend.',
        tone: 'software' as const,
      };
    }

    if (verifyResult.success) {
      return {
        title: 'Infrastructure connected successfully',
        description: 'Your database and outbound provider both passed live runtime verification.',
        tone: 'success' as const,
      };
    }

    const tone = dominantFailure ? getCheckTone(dominantFailure) : 'software';
    return {
      title:
        tone === 'network'
          ? 'Connection failed at the network layer'
          : tone === 'config'
            ? 'Configuration needs correction'
            : 'A software-side validation problem was detected',
      description: verifyResult.message || 'Review the diagnostics below to identify the exact failing dependency.',
      tone,
    };
  }, [dominantFailure, verifyResult]);

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    const inferredProvider = inferMailProviderFromApiKey(value);
    if (inferredProvider && inferredProvider !== 'brevo_smtp' && inferredProvider !== apiProvider) {
      setApiProvider(inferredProvider);
    }
  };

  const resetToEdit = () => {
    setScreen('form');
    setVerifying(false);
    setVerifyResult(null);
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customDbUrl.trim() || !apiKey.trim()) {
      setError('Please provide both your Database Connection URI and your Provider API Key.');
      return;
    }

    if (!isValidDatabaseUrl(customDbUrl)) {
      setError('Invalid Database Connection schema. Expected protocol://user:pass@host/db');
      return;
    }

    if (apiKey.length < 8) {
      setError('Invalid Secret API Key format length.');
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
    setVerifyResult(null);
    setVerifying(true);
    setScreen('verifying');

    const finalDbUrl = customDbUrl.trim();
    const finalApiProvider = apiProvider;
    const finalApiEndpoint = requiresCustomMailEndpoint(apiProvider) ? customApiUrl.trim() : undefined;

    try {
      const allUsersRaw = localStorage.getItem('velismail_users') || '[]';
      const allUsers = JSON.parse(allUsersRaw);
      const dbConflict = allUsers.find(
        (existingUser: any) =>
          existingUser.id !== user?.id &&
          (existingUser.customDbUrl === finalDbUrl || existingUser.businessDbUrl === finalDbUrl),
      );

      if (dbConflict) {
        const conflictMessage =
          'This Database URL is already associated with another account. Each account requires an isolated database.';
        setError(conflictMessage);
        setVerifyResult(buildSoftwareFailure(conflictMessage));
        setScreen('result');
        setVerifying(false);
        return;
      }

      const payload = {
        dbProvider,
        dbUrl: finalDbUrl,
        apiProvider: finalApiProvider,
        apiEndpoint: finalApiEndpoint,
        apiKey: apiKey.trim(),
      };

      const apiResult = await fetchApiJsonDetailed<InfraVerifyResponse>('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const normalized = normalizeVerifyResponse(
        apiResult.data,
        apiResult.ok
          ? 'Infrastructure verified.'
          : `Verification failed with status ${apiResult.status}.`,
      );

      setVerifyResult(normalized);
      setVerifying(false);
      setScreen('result');

      if (!apiResult.ok || !normalized.success) {
        setError(normalized.message || `API Error ${apiResult.status}`);
        return;
      }

      const updateResult = auth.updateSettings({
        customDbUrl: finalDbUrl,
        mailProvider: finalApiProvider,
        mailProviderEndpoint: finalApiEndpoint,
        apiKey: apiKey.trim(),
        isSetupComplete: true,
      });

      if (!updateResult.success) {
        const failure = buildSoftwareFailure('Infrastructure connected, but local session settings could not be saved.');
        setVerifyResult(failure);
        setError(failure.message);
      }
    } catch (err) {
      const baseMessage = err instanceof Error ? err.message : 'Verification execution failed.';
      const messageWithHint = baseMessage.includes('VelisMail API URL')
        ? `${baseMessage} ${getApiAvailabilityHint()}`
        : baseMessage;
      setVerifyResult(buildSoftwareFailure(messageWithHint));
      setError(messageWithHint);
      setVerifying(false);
      setScreen('result');
    }
  };

  if (!user) return null;

  return (
    <div className="setup-page">
      <div className="setup-bg-orb setup-orb-1" />
      <div className="setup-bg-orb setup-orb-2" />
      <div className="setup-grid-bg" />

      <div className="setup-back-link" style={{ display: 'flex', justifyContent: 'space-between', width: '100%', paddingRight: '40px' }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600 }}>
          <img src="/ZeeResizer.png" className="logo-img" alt="ZeeResizer" style={{ height: '24px' }} />
          <span>VelisMail</span>
        </Link>
        <button className="btn btn-ghost btn-sm" onClick={() => { auth.logout(); navigate('/login'); }}>
          <LogOut size={16} /> Logout
        </button>
      </div>

      <div className="setup-container">
        <div className="setup-brand animate-fade">
          <h1>Infrastructure Setup.</h1>
          <p>
            Welcome, <strong>{user.displayName}</strong>. You&apos;ve elected to maintain complete privacy.
            Connect your isolated Database and Outbound Mail engine.
          </p>
          <div className="setup-features">
            <div className="setup-feature">
              <Lock size={18} color="var(--primary-400)" />
              <span>Setup is blocked until your runtime checks pass</span>
            </div>
            <div className="setup-feature">
              <Database size={18} color="var(--accent)" />
              <span>Bring Your Own Database (BYOD)</span>
            </div>
            <div className="setup-feature">
              <Mail size={18} color="#f472b6" />
              <span>Direct Outbound Dispatch proxies</span>
            </div>
          </div>
        </div>

        <div className="glass setup-card animate-scale">
          {screen === 'form' && (
            <form onSubmit={handleVerify} className="setup-form">
              {error && <div className="form-error">{error}</div>}

              <div className="form-group">
                <label>Database Provider</label>
                <select
                  className="input setup-select"
                  value={dbProvider}
                  onChange={(e) => setDbProvider(e.target.value)}
                >
                  {DATABASE_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
                <small>{selectedDatabaseProvider.description}</small>
              </div>

              <div className="form-group">
                <label>Connection String</label>
                <input
                  type="password"
                  className="input"
                  placeholder={selectedDatabaseProvider.placeholder}
                  value={customDbUrl}
                  onChange={(e) => setCustomDbUrl(e.target.value)}
                  required
                />
                <small className="setup-inline-note">
                  Paste the raw database URI here. Do not open the connection string in a browser tab. If your provider documents a pooled or direct app URI, use that exact value.
                </small>
              </div>

              <div className="divider" style={{ margin: '24px 0' }} />

              <div className="form-group">
                <label>Mail Relay Provider</label>
                <select
                  className="input setup-select"
                  value={apiProvider}
                  onChange={(e) => setApiProvider(e.target.value)}
                >
                  {MAIL_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
                <small>{selectedMailProvider.description}</small>
              </div>

              {requiresCustomMailEndpoint(apiProvider) && (
                <div className="form-group animate-slide-down">
                  <label>Custom Provider Endpoint</label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://api.yourmail.com/v1/send"
                    value={customApiUrl}
                    onChange={(e) => setCustomApiUrl(e.target.value)}
                    required={requiresCustomMailEndpoint(apiProvider)}
                  />
                </div>
              )}

              <div className="form-group">
                <label>Secret API Key</label>
                <input
                  type="password"
                  className="input"
                  placeholder={selectedMailProvider.placeholder}
                  value={apiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary w-full" style={{ marginTop: 12 }}>
                Initialize Connection <Play size={18} fill="currentColor" />
              </button>
            </form>
          )}

          {screen === 'verifying' && (
            <div className="verification-state animate-fade">
              <div className="verify-icon">
                <Loader2 size={48} className="animate-spin text-primary" />
              </div>
              <h3>Running live diagnostics...</h3>
              <p>
                VelisMail is checking your database host, provider credentials, and runtime path before any setup is saved.
              </p>

              <div className="verify-steps verify-steps-live">
                {VERIFY_STAGE_LABELS.map((label, index) => (
                  <div
                    key={label}
                    className={`v-step ${index < activeStageIndex ? 'complete' : index === activeStageIndex ? 'pulse' : 'pending'}`}
                  >
                    {index < activeStageIndex ? (
                      <CheckCircle2 size={16} />
                    ) : index === activeStageIndex ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ServerCog size={16} />
                    )}
                    {label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {screen === 'result' && verifyResult && (
            <div className="setup-diagnostics animate-fade">
              <div className={`setup-diag-hero tone-${resultSummary.tone}`}>
                <div className="setup-diag-hero-icon">
                  {resultSummary.tone === 'success' ? (
                    <CheckCircle2 size={28} />
                  ) : resultSummary.tone === 'network' ? (
                    <WifiOff size={28} />
                  ) : resultSummary.tone === 'software' ? (
                    <Bug size={28} />
                  ) : (
                    <AlertTriangle size={28} />
                  )}
                </div>
                <div>
                  <h3>{resultSummary.title}</h3>
                  <p>{resultSummary.description}</p>
                </div>
              </div>

              <div className="setup-overview-grid">
                <div className="setup-overview-card">
                  <span className="setup-overview-label">Database target</span>
                  <strong>{verifyResult.databaseTarget || getConnectionHostLabel(customDbUrl)}</strong>
                </div>
                <div className="setup-overview-card">
                  <span className="setup-overview-label">Database type</span>
                  <strong>{getDatabaseProvider(dbProvider).label}</strong>
                </div>
                <div className="setup-overview-card">
                  <span className="setup-overview-label">Mail provider</span>
                  <strong>{getMailProvider(apiProvider).label}</strong>
                </div>
                <div className="setup-overview-card">
                  <span className="setup-overview-label">Result source</span>
                  <strong>{hasFailures ? getToneLabel(resultSummary.tone) : 'All checks passed'}</strong>
                </div>
                <div className="setup-overview-card">
                  <span className="setup-overview-label">Likely owner</span>
                  <strong>{getIssueOwnerLabel(verifyResult.issueOwner)}</strong>
                </div>
                <div className="setup-overview-card">
                  <span className="setup-overview-label">Failing check</span>
                  <strong>{verifyResult.failingCheck || 'None'}</strong>
                </div>
              </div>

              <div className="setup-diag-list">
                {verificationChecks.map((check) => {
                  const Icon = getCheckIcon(check);
                  const tone = getCheckTone(check);
                  return (
                    <div key={check.key} className={`setup-diag-item tone-${tone}`}>
                      <div className="setup-diag-item-head">
                        <div className="setup-diag-title-wrap">
                          <span className="setup-diag-item-icon">
                            <Icon size={16} />
                          </span>
                          <div>
                            <h4>{check.label}</h4>
                            <span className="setup-diag-badge">{getToneLabel(tone)}</span>
                          </div>
                        </div>
                        <span className={`setup-diag-status ${check.status === 'verified' ? 'ok' : 'fail'}`}>
                          {check.status === 'verified' ? 'Passed' : 'Failed'}
                        </span>
                      </div>
                      <p className="setup-diag-detail">{check.detail}</p>
                      {check.recommendation && (
                        <p className="setup-diag-recommendation">
                          <strong>Recommended fix:</strong> {check.recommendation}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="setup-diag-footer">
                <button type="button" className="btn btn-ghost" onClick={resetToEdit}>
                  <ChevronLeft size={16} /> Edit Configuration
                </button>
                {!verifyResult.success ? (
                  <button type="button" className="btn btn-primary" onClick={() => { setError(''); setScreen('form'); }}>
                    <RefreshCcw size={16} /> Review and Retry
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard')}>
                    Continue to Dashboard <CheckCircle2 size={16} />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
