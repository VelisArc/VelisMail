import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Database, Mail, CheckCircle2, Play, Loader2, Lock, LogOut } from 'lucide-react';
import { auth, type User } from '../api/client';
import {
  DATABASE_PROVIDERS,
  MAIL_PROVIDERS,
  getDatabaseProvider,
  getMailProvider,
  inferDatabaseProviderFromUrl,
  isValidDatabaseUrl,
  requiresCustomMailEndpoint,
} from '../config/providers';
import './Setup.css';

export default function SetupPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  
  // Database State
  const [dbProvider, setDbProvider] = useState('postgresql');
  const [customDbUrl, setCustomDbUrl] = useState('');
  
  // API Provider State
  const [apiProvider, setApiProvider] = useState('sendgrid');
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // Step 1: Input, Step 2: Verifying/Done

  useEffect(() => {
    const session = auth.getSession();
    if (!session) {
      navigate('/login');
    } else if (session.isSetupComplete) {
      navigate('/dashboard');
    } else {
      setDbProvider(inferDatabaseProviderFromUrl(session.customDbUrl || ''));
      setApiProvider(session.mailProvider || 'sendgrid');
      setCustomDbUrl(session.customDbUrl || '');
      setApiKey(session.apiKey || '');
      setCustomApiUrl(session.mailProviderEndpoint || '');
      setUser(session);
    }
  }, [navigate]);

  const selectedDatabaseProvider = getDatabaseProvider(dbProvider);
  const selectedMailProvider = getMailProvider(apiProvider);

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

    if (requiresCustomMailEndpoint(apiProvider) && !customApiUrl.trim()) {
      setError('Custom mail providers require a valid delivery endpoint URL.');
      return;
    }
    
    setError('');
    setVerifying(true);
    setStep(2);

    const finalDbUrl = customDbUrl.trim();
    const finalApiProvider = apiProvider;
    const finalApiEndpoint = requiresCustomMailEndpoint(apiProvider) ? customApiUrl.trim() : undefined;

    try {
      // Prevent re-using the same DB URL across multiple accounts (frontend guard)
      const allUsersRaw = localStorage.getItem('velismail_users') || '[]';
      const allUsers = JSON.parse(allUsersRaw);
      const dbConflict = allUsers.find((u: any) => u.id !== user?.id && (u.customDbUrl === finalDbUrl || u.businessDbUrl === finalDbUrl));
      if (dbConflict) {
        setError('This Database URL is already associated with another account. Each account requires an isolated database.');
        setStep(1);
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
      // If no remote API configured, treat verification as local-only success
      if (!import.meta.env.VITE_API_URL) {
        const updateResult = auth.updateSettings({
          customDbUrl: finalDbUrl,
          mailProvider: finalApiProvider,
          mailProviderEndpoint: finalApiEndpoint,
          apiKey: apiKey.trim(),
          isSetupComplete: true,
        });
        if (updateResult.success) {
          setTimeout(() => {
            navigate('/dashboard');
          }, 1500);
        } else {
          throw new Error('Failed to securely hash and cache local BYO settings.');
        }
      } else {
        const proxyTest = await fetch((import.meta.env.VITE_API_URL || 'http://localhost:3000') + '/api/v1/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        let responseData;
        try {
          responseData = await proxyTest.json();
        } catch (_e) {
          // Fallback for non-JSON errors (like 502 Bad Gateway or CORS failures)
          throw new Error("Proxy connection refused or network error. Ensure the backend gateway is running.");
        }

        if (!proxyTest.ok || !responseData.success) {
          // Extract specific error message if available
          const errorMsg = responseData.message || "Failed to verify infrastructure connection.";
          const errorType = responseData.errorType ? `[${responseData.errorType}] ` : "";
          throw new Error(`${errorType}${errorMsg}`);
        }

        // Successful verification
        const updateResult = auth.updateSettings({
          customDbUrl: finalDbUrl,
          mailProvider: finalApiProvider,
          mailProviderEndpoint: finalApiEndpoint,
          apiKey: apiKey.trim(),
          isSetupComplete: true
        });
        
        if (updateResult.success) {
          setTimeout(() => {
            navigate('/dashboard');
          }, 1500);
        } else {
          throw new Error('Failed to securely hash and cache local BYO settings.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Verification execution failed.');
      setStep(1);
      setVerifying(false);
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
        
        {/* Left Side: Text and Branding */}
        <div className="setup-brand animate-fade">
          <h1>Infrastructure Setup.</h1>
          <p>
            Welcome, <strong>{user.displayName}</strong>. You've elected to maintain complete privacy. 
            Connect your isolated Database and Outbound Mail engine.
          </p>
          <div className="setup-features">
            <div className="setup-feature">
              <Lock size={18} color="var(--primary-400)" />
              <span>We store nothing on our servers</span>
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

        {/* Right Side: Configuration Card */}
        <div className="glass setup-card animate-scale">
          {step === 1 ? (
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
                  onChange={(e) => setApiKey(e.target.value)}
                  required
                />
              </div>
              
              <button type="submit" className="btn btn-primary w-full" style={{ marginTop: 12 }}>
                Initialize Connection <Play size={18} fill="currentColor" />
              </button>
            </form>
          ) : (
            /* Verification Screen */
            <div className="verification-state animate-fade">
              <div className="verify-icon">
                {verifying ? (
                  <Loader2 size={48} className="animate-spin text-primary" />
                ) : (
                  <CheckCircle2 size={48} className="text-accent animate-scale" />
                )}
              </div>
              <h3>
                {verifying ? "Validating Configuration..." : "Configuration Saved!"}
              </h3>
              <p>
                {verifying 
                  ? "We are validating your database URL format and mail provider credentials before saving them." 
                  : "Your infrastructure settings were accepted. Initializing your secure dashboard now."}
              </p>
              
              <div className="verify-steps">
                <div className="v-step complete">
                  <CheckCircle2 size={16} /> Parsing configuration
                </div>
                <div className={`v-step ${verifying ? 'pulse' : 'complete'}`}>
                  {verifying ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} 
                  Validating database URL
                </div>
                <div className={`v-step ${verifying ? 'pending' : 'complete'}`}>
                  {!verifying && <CheckCircle2 size={16} />}
                  Validating outbound mail provider
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
