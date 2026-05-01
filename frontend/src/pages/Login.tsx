import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Building2, ArrowRight, Eye, Loader2, ArrowLeft, Globe, Fingerprint } from 'lucide-react';
import { auth } from '../api/client';
import './Login.css';

type Mode = 'login' | 'register';
type RegisterStep = 'form' | 'otp';
function nextRouteForUser(user: { email?: string; isBusinessSetupComplete?: boolean }) {
  return user.isBusinessSetupComplete ? '/business' : '/business-setup';
}



function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^mail\./, '')
    .replace(/\/.*$/, '');
}

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [registerStep, setRegisterStep] = useState<RegisterStep>('form');
  const [forgotMode, setForgotMode] = useState(false);

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetChallengeToken, setResetChallengeToken] = useState('');
  const [resetVerificationToken, setResetVerificationToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetHint, setResetHint] = useState('');

  const [regName, setRegName] = useState('');
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
  const businessDomainValue = normalizeDomain(regDomain);
  const defaultBusinessMailboxAddress = businessDomainValue ? `admin@${businessDomainValue}` : '';
  const otpTargetEmail = regRecoveryEmail.trim().toLowerCase();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await auth.login(loginIdentifier, loginPassword);
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
    const expectedMailbox = (regRecoveryEmail.trim().toLowerCase() || defaultBusinessMailboxAddress);
    const candidateValues = [expectedMailbox, otpTargetEmail]
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    if (existingUsers.find((u: { email: string; recoveryEmail?: string; businessMailboxAddress?: string }) => {
      const existingValues = [u.email, u.recoveryEmail, u.businessMailboxAddress]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      return candidateValues.some(value => existingValues.includes(value));
    })) {
      throw new Error('An account with this mailbox or recovery email already exists.');
    }

    const response = await auth.sendRegistrationOtp({
      email: otpTargetEmail,
      displayName: regName,
    });

    if (!response.success || !response.challengeToken) {
      throw new Error('OTP request succeeded but no verification challenge was returned.');
    }

    setOtp('');
    setOtpChallengeToken(response.challengeToken);
    setOtpDeliveryHint(`Verification code sent to ${response.maskedEmail} via ${response.provider}.`);
    setVerificationToken('');
    setRegisterStep('otp');
  };

  const completeRegistration = async (verifiedToken?: string) => {
    const res = await auth.register({
      email: defaultBusinessMailboxAddress || otpTargetEmail,
      password: regPassword,
      displayName: regName,
      accountType: 'business',
      customDomain: businessDomainValue,
      recoveryEmail: otpTargetEmail || undefined,
      verificationToken: verifiedToken || verificationToken || undefined,
    });
    if (res.success && res.user) {
      navigate(nextRouteForUser(res.user));
    } else {
      throw new Error(res.error || 'Registration failed');
    }
  };

  const handlePasswordResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!resetIdentifier.trim()) {
        throw new Error('Enter your mailbox or recovery email first.');
      }

      const response = await auth.requestPasswordReset(resetIdentifier.trim());
      setResetChallengeToken(response.challengeToken);
      setResetVerificationToken('');
      setResetOtp('');
      setResetPassword('');
      setResetHint(`Verification code sent to ${response.maskedEmail} via ${response.provider}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start password reset.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!resetChallengeToken) {
        throw new Error('Reset session missing. Request a new code.');
      }
      if (!resetOtp.trim()) {
        throw new Error('Enter the verification code.');
      }

      const verification = await auth.verifyOtp({
        email: resetIdentifier.trim().toLowerCase(),
        otp: resetOtp.trim(),
        challengeToken: resetChallengeToken,
        purpose: 'password_reset',
      });
      setResetVerificationToken(verification.verificationToken);
      setResetHint('Code verified. Set your new password now.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid reset code.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!resetVerificationToken) {
        throw new Error('Verify your reset code before changing the password.');
      }
      if (resetPassword.trim().length < 8) {
        throw new Error('New password must be at least 8 characters.');
      }

      await auth.resetPassword({
        identifier: resetIdentifier.trim(),
        verificationToken: resetVerificationToken,
        newPassword: resetPassword,
      });

      setForgotMode(false);
      setResetHint('');
      setResetChallengeToken('');
      setResetVerificationToken('');
      setResetOtp('');
      setResetPassword('');
      setLoginIdentifier(resetIdentifier.trim());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!regName.trim()) {
        throw new Error('Full name is required.');
      }
      if (!businessDomainValue) {
        throw new Error('Business domain is required.');
      }
      if (regPassword.trim().length < 8) {
        throw new Error('Password must be at least 8 characters.');
      }
      if (otpTargetEmail) {
        await sendRegistrationOtp();
      } else {
        await completeRegistration();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your account.');
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
      if (!verification.success || !verification.verificationToken) {
        throw new Error('OTP verification succeeded but no verification token was returned.');
      }
      setVerificationToken(verification.verificationToken);

      await completeRegistration(verification.verificationToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setForgotMode(false);
    setError('');
    setOtp('');
    setOtpChallengeToken('');
    setOtpDeliveryHint('');
    setVerificationToken('');
    setRegisterStep('form');
    setRegRecoveryEmail('');
    setRegDomain('');
    setRegPassword('');
    setResetIdentifier('');
    setResetOtp('');
    setResetChallengeToken('');
    setResetVerificationToken('');
    setResetPassword('');
    setResetHint('');
  };

  return (
    <div className="login-page">
      <div className="login-bg-orb login-orb-1" />
      <div className="login-bg-orb login-orb-2" />
      <div className="login-grid-bg" />

      <Link to="/" className="login-back-link">
        <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '24px', width: 'auto' }} />
        <span>VelisMail</span>
      </Link>

      <div className="login-container">
        <div className="login-brand animate-fade">
          <h1>{mode === 'login' ? 'Welcome back.' : 'Initialize Workspace.'}</h1>
          <p>{mode === 'login'
            ? 'Sign in to your secure enterprise workspace. Zero trust, maximum efficiency.'
            : 'Deploy your secure business communications in seconds.'}</p>
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
              <span>Full compliance & audit logging</span>
            </div>
          </div>
        </div>

        <div className="glass login-card animate-scale">
          {mode === 'login' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap"><Mail size={24} /></div>
                <h2>{forgotMode ? 'Reset Password' : 'Sign In'}</h2>
                <p className="login-card-desc">
                  {forgotMode ? 'Verify your OTP and set a new password.' : 'Enter your credentials to continue'}
                </p>
              </div>

              {!forgotMode ? (
                <>
              <form onSubmit={handleLogin} className="login-form" autoComplete="off">
                <div className="form-group">
                  <label htmlFor="login-email">Workspace Email</label>
                  <input id="login-email" type="text" className="input" placeholder="admin@yourcompany.com"
                    name="velismail-login-identifier" autoComplete="username" required value={loginIdentifier} onChange={e => setLoginIdentifier(e.target.value)} autoFocus />
                </div>
                <div className="form-group">
                  <label htmlFor="login-pass">Password</label>
                  <input id="login-pass" type="password" className="input" placeholder="Enter password"
                    name="velismail-login-password" autoComplete="current-password" required value={loginPassword} onChange={e => setLoginPassword(e.target.value)} />
                </div>

                    {error && <div className="form-error">{error}</div>}

                    <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                      {loading ? <Loader2 size={18} className="animate-spin" /> : <>Sign In <ArrowRight size={18} /></>}
                    </button>
                  </form>

                  <div className="login-card-footer" style={{ justifyContent: 'space-between', gap: 12 }}>
                    <button className="login-link" onClick={() => { setForgotMode(true); setError(''); setResetIdentifier(loginIdentifier); }}>
                      Forgot Password?
                    </button>
                    <span>Don't have an account? <button className="login-link" onClick={() => switchMode('register')}>Create Account</button></span>
                  </div>
                </>
              ) : (
                <>
                  <form onSubmit={handlePasswordResetRequest} className="login-form" autoComplete="off">
                    <div className="form-group">
                      <label htmlFor="reset-identifier">Workspace Email</label>
                      <input
                        id="reset-identifier"
                        type="text"
                        className="input"
                        placeholder="admin@yourcompany.com"
                        name="velismail-reset-identifier"
                        autoComplete="off"
                        required
                        value={resetIdentifier}
                        onChange={e => setResetIdentifier(e.target.value)}
                        autoFocus
                      />
                    </div>
                    {resetHint && <div className="form-success">{resetHint}</div>}
                    {error && <div className="form-error">{error}</div>}
                    <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                      {loading ? <Loader2 size={18} className="animate-spin" /> : <>Send OTP <ArrowRight size={18} /></>}
                    </button>
                  </form>

                  {resetChallengeToken && (
                    <form onSubmit={handlePasswordResetVerify} className="login-form" style={{ marginTop: 12 }} autoComplete="off">
                      <div className="form-group">
                        <label htmlFor="reset-otp">Verification Code</label>
                        <input
                          id="reset-otp"
                          type="text"
                          className="input"
                          placeholder="000000"
                          name="velismail-reset-otp"
                          autoComplete="one-time-code"
                          maxLength={6}
                          required
                          value={resetOtp}
                          onChange={e => setResetOtp(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="btn btn-secondary w-full" disabled={loading || !!resetVerificationToken}>
                        {loading ? <Loader2 size={18} className="animate-spin" /> : 'Verify OTP'}
                      </button>
                    </form>
                  )}

                  {resetVerificationToken && (
                    <form onSubmit={handlePasswordResetComplete} className="login-form" style={{ marginTop: 12 }} autoComplete="off">
                      <div className="form-group">
                        <label htmlFor="reset-password">New Password</label>
                        <input
                          id="reset-password"
                          type="password"
                          className="input"
                          placeholder="Enter new password"
                          name="velismail-reset-new-password"
                          autoComplete="new-password"
                          minLength={8}
                          required
                          value={resetPassword}
                          onChange={e => setResetPassword(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                        {loading ? <Loader2 size={18} className="animate-spin" /> : 'Update Password'}
                      </button>
                    </form>
                  )}

                  <div className="login-card-footer">
                    <button className="login-link" onClick={() => { setForgotMode(false); setError(''); setResetHint(''); }}>
                      Back to Sign In
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {mode === 'register' && registerStep === 'form' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap">
                  <Building2 size={24} />
                </div>
                <h2>Business Account</h2>
                <p className="login-card-desc">
                  Set up your organization email
                </p>
              </div>

              <form onSubmit={handleRegisterSubmit} className="login-form" autoComplete="new-password">
                <div className="form-group">
                  <label htmlFor="reg-name">Full Name</label>
                  <input id="reg-name" type="text" className="input" placeholder="Your full name"
                    name="velismail-new-account-display-name" autoComplete="new-password" required value={regName} onChange={e => setRegName(e.target.value)} autoFocus />
                </div>




                  <div className="form-group">
                    <label htmlFor="reg-domain">
                      <Globe size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      Custom Domain
                    </label>
                    <input id="reg-domain" type="text" className="input" placeholder="yourdomain.com"
                      name="velismail-signup-business-domain"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required value={regDomain} onChange={e => setRegDomain(e.target.value)} />
                    <span className="form-hint">We will create your business mailbox only after DNS verification succeeds.</span>
                  </div>

                <div className="form-group">
                  <label htmlFor="reg-recovery">Recovery Email</label>
                  <input id="reg-recovery" type="email" className="input"
                    placeholder="you@gmail.com"
                    name="velismail-new-account-recovery-contact"
                    autoComplete="new-password"
                    value={regRecoveryEmail} onChange={e => setRegRecoveryEmail(e.target.value)} />
                  <span className="form-hint">
                    Optional. If added, OTP and recovery codes go here until your business mailbox is active.
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="reg-pass">Password</label>
                  <input id="reg-pass" type="password" className="input" placeholder="Create a strong password"
                    name="velismail-signup-password"
                    autoComplete="new-password"
                    required minLength={8} value={regPassword} onChange={e => setRegPassword(e.target.value)} />
                </div>

                {error && <div className="form-error">{error}</div>}

                <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <>{otpTargetEmail ? 'Send Verification Code' : 'Create Account'} <ArrowRight size={18} /></>}
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

              <form onSubmit={handleOtpSubmit} className="login-form" autoComplete="off">
                {otpDeliveryHint && <div className="form-success">{otpDeliveryHint}</div>}
                {verificationToken && <div className="form-success">Verification session is active. Finish account creation now.</div>}

                <div className="form-group">
                  <label htmlFor="otp-code">Verification Code</label>
                  <input id="otp-code" type="text" className="input" placeholder="000000"
                    name="velismail-signup-otp"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6} required value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} autoFocus />
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
