import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Fingerprint, Mail, ArrowRight, Loader2, Lock, Eye, User, Globe, Building2, ArrowLeft } from 'lucide-react';
import { auth } from '../api/client';
import './Login.css';

type Mode = 'login' | 'register';
type RegisterStep = 'type' | 'form';
type AccountType = 'personal' | 'business';

function nextRouteForUser(user: { accountType: AccountType; isSetupComplete: boolean; isBusinessSetupComplete?: boolean }) {
  if (user.accountType === 'business') {
    return user.isBusinessSetupComplete ? '/business' : '/business-setup';
  }
  return user.isSetupComplete ? '/dashboard' : '/setup';
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [registerStep, setRegisterStep] = useState<RegisterStep>('type');
  const [accountType, setAccountType] = useState<AccountType>('personal');

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regDomain, setRegDomain] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = auth.login(loginEmail, loginPassword);
    if (res.success && res.user) {
      navigate(nextRouteForUser(res.user));
    } else {
      // Try passkey fallback (no auto-create) — prompt to register if not found
      const passkey = auth.loginPasskey(loginEmail);
      if (passkey.success && passkey.user) {
        navigate(nextRouteForUser(passkey.user));
      } else {
        setError(res.error || 'Login failed');
      }
    }
    setLoading(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = auth.register({
      email: regEmail,
      password: regPassword,
      displayName: regName,
      accountType,
      customDomain: accountType === 'business' ? regDomain : undefined,
    });
    if (res.success && res.user) {
      navigate(nextRouteForUser(res.user));
    } else {
      setError(res.error || 'Registration failed');
    }
    setLoading(false);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setRegisterStep('type');
  };

  return (
    <div className="login-page">
      <div className="login-bg-orb login-orb-1" />
      <div className="login-bg-orb login-orb-2" />
      <div className="login-grid-bg" />

      <Link to="/" className="login-back-link">
        <img src="/ZeeResizer.png" className="logo-img" alt="ZeeResizer" />
        <span>VelisMail</span>
      </Link>

      <div className="login-container">
        {/* Left Branding */}
        <div className="login-brand animate-fade">
          <h1>{mode === 'login' ? 'Welcome back.' : 'Get started.'}</h1>
          <p>{mode === 'login'
            ? 'Sign in to your encrypted inbox. Your keys, your privacy.'
            : 'Create your secure email account in seconds.'}</p>
          <div className="login-features">
            <div className="login-feature">
              <Lock size={18} color="var(--primary-400)" />
              <span>End-to-end encrypted</span>
            </div>
            <div className="login-feature">
              <Fingerprint size={18} color="var(--accent)" />
              <span>Passwordless authentication</span>
            </div>
            <div className="login-feature">
              <Eye size={18} color="#f472b6" />
              <span>Zero-knowledge architecture</span>
            </div>
          </div>
        </div>

        {/* Right Card */}
        <div className="glass login-card animate-scale">

          {/* -------- LOGIN -------- */}
          {mode === 'login' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap"><Mail size={24} /></div>
                <h2>Sign In</h2>
                <p className="login-card-desc">Enter your credentials to continue</p>
              </div>

              <form onSubmit={handleLogin} className="login-form">
                <div className="form-group">
                  <label htmlFor="login-email">Email address</label>
                  <input id="login-email" type="email" className="input" placeholder="you@company.com"
                    required value={loginEmail} onChange={e => setLoginEmail(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label htmlFor="login-pass">Password</label>
                  <input id="login-pass" type="password" className="input" placeholder="Enter password"
                    required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} />
                </div>

                {error && <div className="form-error">{error}</div>}

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <>Sign In <ArrowRight size={18} /></>}
                </button>
              </form>

              <div className="login-card-footer">
                <span>Don't have an account? </span>
                <button className="login-link" onClick={() => switchMode('register')}>Create Account</button>
              </div>
            </>
          )}

          {/* -------- REGISTER - Step 1: Choose type -------- */}
          {mode === 'register' && registerStep === 'type' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap"><User size={24} /></div>
                <h2>Create Account</h2>
                <p className="login-card-desc">Choose your account type</p>
              </div>

              <div className="account-type-grid">
                <button
                  className={`account-type-card glass-card ${accountType === 'personal' ? 'selected' : ''}`}
                  onClick={() => setAccountType('personal')}
                >
                  <Mail size={28} color="var(--primary-400)" />
                  <h3>Personal</h3>
                  <p>Free @velismail.online address. Perfect for individuals.</p>
                  <span className="account-type-tag">Free</span>
                </button>

                <button
                  className={`account-type-card glass-card ${accountType === 'business' ? 'selected' : ''}`}
                  onClick={() => setAccountType('business')}
                >
                  <Building2 size={28} color="var(--accent)" />
                  <h3>Business</h3>
                  <p>Connect your own domain. you@yourdomain.com</p>
                  <span className="account-type-tag tag-pro">Pro</span>
                </button>
              </div>

              <button className="btn btn-primary w-full" onClick={() => setRegisterStep('form')}>
                Continue <ArrowRight size={18} />
              </button>

              <div className="login-card-footer">
                <span>Already have an account? </span>
                <button className="login-link" onClick={() => switchMode('login')}>Sign In</button>
              </div>
            </>
          )}

          {/* -------- REGISTER - Step 2: Form -------- */}
          {mode === 'register' && registerStep === 'form' && (
            <>
              <div className="login-card-header">
                <button className="back-step-btn" onClick={() => setRegisterStep('type')}>
                  <ArrowLeft size={16} /> Back
                </button>
                <div className="login-icon-wrap">
                  {accountType === 'business' ? <Building2 size={24} /> : <User size={24} />}
                </div>
                <h2>{accountType === 'business' ? 'Business Account' : 'Personal Account'}</h2>
                <p className="login-card-desc">
                  {accountType === 'business'
                    ? 'Set up your organization email'
                    : 'Create your free @velismail.online account'}
                </p>
              </div>

              <form onSubmit={handleRegister} className="login-form">
                <div className="form-group">
                  <label htmlFor="reg-name">Full Name</label>
                  <input id="reg-name" type="text" className="input" placeholder="Your full name"
                    required value={regName} onChange={e => setRegName(e.target.value)} autoFocus />
                </div>

                <div className="form-group">
                  <label htmlFor="reg-email">Email Address</label>
                  <input id="reg-email" type="email" className="input"
                    placeholder={accountType === 'business' ? 'you@yourdomain.com' : 'you@velismail.online'}
                    required value={regEmail} onChange={e => setRegEmail(e.target.value)} />
                </div>

                {accountType === 'business' && (
                  <div className="form-group">
                    <label htmlFor="reg-domain">
                      <Globe size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      Custom Domain
                    </label>
                    <input id="reg-domain" type="text" className="input" placeholder="yourdomain.com"
                      required value={regDomain} onChange={e => setRegDomain(e.target.value)} />
                    <span className="form-hint">We'll generate DNS records for you to verify ownership.</span>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="reg-pass">Password</label>
                  <input id="reg-pass" type="password" className="input" placeholder="Create a strong password"
                    required minLength={6} value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                </div>

                {error && <div className="form-error">{error}</div>}

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <>Create Account <ArrowRight size={18} /></>}
                </button>
              </form>

              <div className="login-card-footer">
                <span>Already have an account? </span>
                <button className="login-link" onClick={() => switchMode('login')}>Sign In</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="login-footer-links">
        <Link to="/privacy">Privacy Policy</Link>
        <span>•</span>
        <Link to="/terms">Terms of Service</Link>
      </div>
    </div>
  );
}
