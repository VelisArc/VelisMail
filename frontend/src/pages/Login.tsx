import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Fingerprint, Mail, ArrowRight, Loader2, Lock, Eye, User, Globe, Building2, ArrowLeft } from 'lucide-react';
import { auth } from '../api/client';
import './Login.css';

type Mode = 'login' | 'register';
type RegisterStep = 'type' | 'form' | 'otp';
type AccountType = 'personal' | 'business';

function nextRouteForUser(user: { accountType: AccountType; isSetupComplete: boolean; isBusinessSetupComplete?: boolean }) {
  if (user.accountType === 'business') {
    return user.isBusinessSetupComplete ? '/business' : '/business-setup';
  }
  return user.isSetupComplete ? '/dashboard' : '/setup';
}

function normalizeMailboxLocalPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]/g, '');
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [registerStep, setRegisterStep] = useState<RegisterStep>('type');
  const [accountType, setAccountType] = useState<AccountType>('personal');

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regName, setRegName] = useState('');
  const [regMailboxLocalPart, setRegMailboxLocalPart] = useState('');
  const [regRecoveryEmail, setRegRecoveryEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regDomain, setRegDomain] = useState('');

  const [otp, setOtp] = useState('');
  const [otpChallengeToken, setOtpChallengeToken] = useState('');
  const [otpDeliveryHint, setOtpDeliveryHint] = useState('');
  const [verificationToken, setVerificationToken] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const personalMailboxAddress = `${normalizeMailboxLocalPart(regMailboxLocalPart) || 'yourname'}@velismail.online`;
  const otpTargetEmail = regRecoveryEmail.trim().toLowerCase();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = auth.login(loginIdentifier, loginPassword);
    if (res.success && res.user) {
      navigate(nextRouteForUser(res.user));
    } else {
      const passkey = auth.loginPasskey(loginIdentifier);
      if (passkey.success && passkey.user) {
        navigate(nextRouteForUser(passkey.user));
      } else {
        setError(res.error || 'Login failed');
      }
    }
    setLoading(false);
  };

  const sendRegistrationOtp = async () => {
    const existingUsers = JSON.parse(localStorage.getItem('velismail_users') || '[]');
    const expectedMailbox = accountType === 'personal' ? personalMailboxAddress : regRecoveryEmail.trim().toLowerCase();
    if (existingUsers.find((u: { email: string; recoveryEmail?: string; businessMailboxAddress?: string }) =>
      [u.email, u.recoveryEmail, u.businessMailboxAddress].filter(Boolean).includes(expectedMailbox),
    )) {
      throw new Error('An account with this mailbox or recovery email already exists.');
    }

    const response = await auth.sendRegistrationOtp({
      email: otpTargetEmail,
      displayName: regName,
    });

    setOtp('');
    setOtpChallengeToken(response.challengeToken);
    setOtpDeliveryHint(`Verification code sent to ${response.maskedEmail} via ${response.provider}.`);
    setVerificationToken('');
    setRegisterStep('otp');
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!regName.trim()) {
        throw new Error('Full name is required.');
      }
      if (accountType === 'personal' && !normalizeMailboxLocalPart(regMailboxLocalPart)) {
        throw new Error('Choose a mailbox name for your @velismail.online account.');
      }
      if (!otpTargetEmail) {
        throw new Error('Recovery email is required so we can send your verification code.');
      }
      if (accountType === 'business' && !regDomain.trim()) {
        throw new Error('Business domain is required.');
      }
      await sendRegistrationOtp();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!otpChallengeToken) {
        throw new Error('Verification session missing. Please request a new code.');
      }

      const verification = await auth.verifyRegistrationOtp({
        email: otpTargetEmail,
        otp,
        challengeToken: otpChallengeToken,
      });
      setVerificationToken(verification.verificationToken);

      const res = auth.register({
        email: accountType === 'personal' ? personalMailboxAddress : otpTargetEmail,
        password: regPassword,
        displayName: regName,
        accountType,
        customDomain: accountType === 'business' ? regDomain : undefined,
        recoveryEmail: otpTargetEmail,
        personalMailboxLocalPart: accountType === 'personal' ? regMailboxLocalPart : undefined,
      });
      if (res.success && res.user) {
        navigate(nextRouteForUser(res.user));
      } else {
        setError(res.error || 'Registration failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setOtp('');
    setOtpChallengeToken('');
    setOtpDeliveryHint('');
    setVerificationToken('');
    setRegisterStep('type');
    setLoginIdentifier('');
    setRegMailboxLocalPart('');
    setRegRecoveryEmail('');
    setRegDomain('');
    setRegPassword('');
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

        <div className="glass login-card animate-scale">
          {mode === 'login' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap"><Mail size={24} /></div>
                <h2>Sign In</h2>
                <p className="login-card-desc">Enter your credentials to continue</p>
              </div>

              <form onSubmit={handleLogin} className="login-form">
                <div className="form-group">
                  <label htmlFor="login-email">Email, username, or recovery email</label>
                  <input id="login-email" type="text" className="input" placeholder="you / you@velismail.online / admin@yourdomain.com"
                    required value={loginIdentifier} onChange={e => setLoginIdentifier(e.target.value)} autoFocus />
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
                  <p>Connect your own domain. Mailbox is created after domain verification.</p>
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

              <form onSubmit={handleRegisterSubmit} className="login-form">
                <div className="form-group">
                  <label htmlFor="reg-name">Full Name</label>
                  <input id="reg-name" type="text" className="input" placeholder="Your full name"
                    required value={regName} onChange={e => setRegName(e.target.value)} autoFocus />
                </div>

                {accountType === 'personal' ? (
                  <div className="form-group">
                    <label htmlFor="reg-email">VelisMail Username</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                      <input id="reg-email" type="text" className="input"
                        placeholder="yourname"
                        required value={regMailboxLocalPart} onChange={e => setRegMailboxLocalPart(e.target.value)} />
                      <input className="input" value="@velismail.online" disabled />
                    </div>
                    <span className="form-hint">Your personal mailbox will be locked to {personalMailboxAddress}.</span>
                  </div>
                ) : null}

                {accountType === 'business' && (
                  <div className="form-group">
                    <label htmlFor="reg-domain">
                      <Globe size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      Custom Domain
                    </label>
                    <input id="reg-domain" type="text" className="input" placeholder="yourdomain.com"
                      required value={regDomain} onChange={e => setRegDomain(e.target.value)} />
                    <span className="form-hint">We will create your business mailbox only after DNS verification succeeds.</span>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="reg-recovery">{accountType === 'business' ? 'Recovery Email' : 'Recovery Email for OTP'}</label>
                  <input id="reg-recovery" type="email" className="input"
                    placeholder="you@gmail.com"
                    required value={regRecoveryEmail} onChange={e => setRegRecoveryEmail(e.target.value)} />
                  <span className="form-hint">
                    {accountType === 'business'
                      ? 'This email is used for login recovery until your company mailbox is activated.'
                      : 'We send signup verification and account recovery codes here.'}
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="reg-pass">Password</label>
                  <input id="reg-pass" type="password" className="input" placeholder="Create a strong password"
                    required minLength={6} value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                </div>

                {error && <div className="form-error">{error}</div>}

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <>Send Verification Code <ArrowRight size={18} /></>}
                </button>
              </form>

              <div className="login-card-footer">
                <span>Already have an account? </span>
                <button className="login-link" onClick={() => switchMode('login')}>Sign In</button>
              </div>
            </>
          )}

          {mode === 'register' && registerStep === 'otp' && (
            <>
              <div className="login-card-header">
                <button className="back-step-btn" onClick={() => setRegisterStep('form')}>
                  <ArrowLeft size={16} /> Back
                </button>
                <div className="login-icon-wrap"><Mail size={24} /></div>
                <h2>Verify Email</h2>
                <p className="login-card-desc">Enter the 6-digit code sent to {otpTargetEmail}</p>
              </div>

              <form onSubmit={handleOtpSubmit} className="login-form">
                {otpDeliveryHint && <div className="form-success">{otpDeliveryHint}</div>}
                {verificationToken && <div className="form-success">Verification session is active. Finish account creation now.</div>}

                <div className="form-group">
                  <label htmlFor="otp-code">Verification Code</label>
                  <input id="otp-code" type="text" className="input" placeholder="000000"
                    maxLength={6} required value={otp} onChange={e => setOtp(e.target.value)} autoFocus />
                </div>

                {error && <div className="form-error">{error}</div>}

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <>Verify & Complete <ArrowRight size={18} /></>}
                </button>
              </form>

              <div className="login-card-footer">
                <span>Didn't receive the code? </span>
                <button
                  className="login-link"
                  onClick={async () => {
                    setLoading(true);
                    setError('');
                    try {
                      await sendRegistrationOtp();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Unable to resend verification code.');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Resend OTP
                </button>
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
