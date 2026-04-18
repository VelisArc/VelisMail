import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Database, Mail, CheckCircle2, Play, Loader2, Lock } from 'lucide-react';
import { auth, type User } from '../api/client';
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
      setUser(session);
    }
  }, [navigate]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customDbUrl.trim() || !apiKey.trim()) {
      setError('Please provide both your Database Connection URI and your Provider API Key.');
      return;
    }
    
    // Heuristic DB Routing Validation
    const dbRegex = /^(postgresql|postgres|mysql|sqlite|mongodb(\+srv)?|redis|custom):\/\/.+/i;
    if (!dbRegex.test(customDbUrl)) {
      setError('Invalid Database Connection schema. Expected protocol://user:pass@host/db');
      return;
    }

    // Heuristic API Token Validation
    if (apiKey.length < 8 && apiProvider !== 'others') {
      setError('Invalid Secret API Key format length.');
      return;
    }
    
    setError('');
    setVerifying(true);
    setStep(2);
    
    // Convert 'others' selection back to their custom typed variables if chosen
    const finalDbUrl = dbProvider === 'others' && customDbUrl.trim() ? customDbUrl : customDbUrl;
    const finalApiProvider = apiProvider === 'others' && customApiUrl.trim() ? customApiUrl : apiProvider;

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
      const payload = { dbUrl: finalDbUrl, apiProvider: finalApiProvider, apiKey: apiKey };
      const proxyTest = await fetch((import.meta.env.VITE_API_URL || '') + '/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!proxyTest.ok) {
        throw new Error("Proxy connection refused. Check your database IP whitelist and port mapping.");
      }

      // Successful verification
      const updateResult = auth.updateSettings({
        customDbUrl: finalDbUrl,
        mailProvider: finalApiProvider as any, 
        apiKey: apiKey,
        isSetupComplete: true
      });
      
      if (updateResult.success) {
        setTimeout(() => {
          navigate('/dashboard');
        }, 1500);
      } else {
        throw new Error('Failed to securely hash and cache local BYO settings.');
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

      <Link to="/" className="setup-back-link">
        <img src="/ZeeResizer.png" className="logo-img" alt="ZeeResizer" />
        <span>VelisMail</span>
      </Link>

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
                  <option value="postgresql">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="sqlite">SQLite</option>
                  <option value="mongodb">MongoDB</option>
                  <option value="redis">Redis Cluster</option>
                  <option value="others">Others (Custom Driver)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Connection String</label>
                <input
                  type="password"
                  className="input"
                  placeholder={dbProvider === 'others' ? "custom://user:pass@host:port/db" : `${dbProvider === 'others' ? 'mysql' : dbProvider}://user:pass@host:port/database`}
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
                  <option value="sendgrid">SendGrid</option>
                  <option value="resend">Resend</option>
                  <option value="mailgun">Mailgun</option>
                  <option value="postmark">Postmark</option>
                  <option value="ses">Amazon SES</option>
                  <option value="others">Others (Custom Webhook)</option>
                </select>
              </div>
              
              {apiProvider === 'others' && (
                <div className="form-group animate-slide-down">
                  <label>Custom Provider Endpoint</label>
                  <input
                    type="url"
                    className="input"
                    placeholder="https://api.yourmail.com/v1/send"
                    value={customApiUrl}
                    onChange={(e) => setCustomApiUrl(e.target.value)}
                    required={apiProvider === 'others'}
                  />
                </div>
              )}

              <div className="form-group">
                <label>Secret API Key</label>
                <input
                  type="password"
                  className="input"
                  placeholder="sk_live_..."
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
                {verifying ? "Tunneling Handshake..." : "Connection Established!"}
              </h3>
              <p>
                {verifying 
                  ? "We are verifying your data layer and testing your API credentials via a secure tunnel." 
                  : "Your infrastructure is connected. Initializing your secure dashboard now."}
              </p>
              
              <div className="verify-steps">
                <div className="v-step complete">
                  <CheckCircle2 size={16} /> Parsing connection driver
                </div>
                <div className={`v-step ${verifying ? 'pulse' : 'complete'}`}>
                  {verifying ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} 
                  Pinging Database Socket
                </div>
                <div className={`v-step ${verifying ? 'pending' : 'complete'}`}>
                  {!verifying && <CheckCircle2 size={16} />}
                  Validating Outbound API Proxy
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
