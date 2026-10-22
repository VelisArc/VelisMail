import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  Mail,
  Lock,
  Building2,
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  Globe,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { auth, isBusinessSetupReady, teamAccess, type TeamAccessInvite, type User } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import './Login.css';

type Mode = 'login' | 'register';
type RegisterStep = 'form' | 'otp';
type LoginAccessMode = 'password' | 'team';
type TeamAccessStep = 'key' | 'email' | 'otp';

const TEAM_STEP_ORDER: TeamAccessStep[] = ['key', 'email', 'otp'];

function nextRouteForUser(user: User) {
  return isBusinessSetupReady(user) ? '/business?tab=inbox' : '/business';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [mode, setMode] = useState<Mode>(() =>
    searchParams.get('mode') === 'register' ? 'register' : 'login',
  );
  const [loginAccessMode, setLoginAccessMode] = useState<LoginAccessMode>('password');
  const [registerStep, setRegisterStep] = useState<RegisterStep>('form');
  const [forgotMode, setForgotMode] = useState(false);

  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetChallengeToken, setResetChallengeToken] = useState('');
  const [resetVerificationToken, setResetVerificationToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetHint, setResetHint] = useState('');
  const [teamStep, setTeamStep] = useState<TeamAccessStep>('key');
  const [teamToken, setTeamToken] = useState('');
  const [teamEmail, setTeamEmail] = useState('');
  const [teamOtp, setTeamOtp] = useState('');
  const [teamChallengeToken, setTeamChallengeToken] = useState('');
  const [teamInvite, setTeamInvite] = useState<TeamAccessInvite | null>(null);
  const [teamHint, setTeamHint] = useState('');

  const [regName, setRegName] = useState('');
  const [regRecoveryEmail, setRegRecoveryEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [regDomain, setRegDomain] = useState('');

  const [otp, setOtp] = useState('');
  const [otpChallengeToken, setOtpChallengeToken] = useState('');
  const [otpDeliveryHint, setOtpDeliveryHint] = useState('');
  const [verificationToken, setVerificationToken] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setMode(searchParams.get('mode') === 'register' ? 'register' : 'login');
  }, [searchParams]);
  const businessDomainValue = normalizeDomain(regDomain);
  const defaultBusinessMailboxAddress = businessDomainValue ? `admin@${businessDomainValue}` : '';
  const otpTargetEmail = regRecoveryEmail.trim().toLowerCase();
  const teamStepNumber = TEAM_STEP_ORDER.indexOf(teamStep) + 1;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await auth.login(loginIdentifier, loginPassword);
    if (res.success && res.user) {
      navigate(nextRouteForUser(res.user), { replace: true });
    } else {
      setError(res.error || 'Login failed');
    }
    setLoading(false);
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    const res = await auth.loginWithGoogle();
    if (res.success && res.user) {
      navigate(nextRouteForUser(res.user), { replace: true });
    } else {
      setError(res.error || 'Google sign-in failed');
    }
    setLoading(false);
  };

  const handleTeamKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const validation = await teamAccess.validateToken(teamToken);
      if (!validation.ok || !validation.invite) {
        throw new Error(validation.error || 'Invalid team access key.');
      }
      setTeamInvite(validation.invite);
      setTeamEmail('');
      setTeamOtp('');
      setTeamChallengeToken('');
      setTeamHint(`Key accepted for ${validation.invite.role} access. Verify the assigned email to continue.`);
      setTeamStep('email');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid team access key.');
    } finally {
      setLoading(false);
    }
  };

  const handleTeamEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await requestTeamOtp();
  };

  const requestTeamOtp = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await teamAccess.requestOtp(teamToken, teamEmail);
      setTeamChallengeToken(response.challengeToken);
      setTeamOtp('');
      setTeamHint(`Verification code sent to ${response.maskedEmail} via ${response.provider}.`);
      setTeamStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send team access OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleTeamOtpResend = async () => {
    await requestTeamOtp();
  };

  const handleTeamOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await teamAccess.completeLogin({
        token: teamToken,
        email: teamEmail,
        otp: teamOtp,
        challengeToken: teamChallengeToken,
      });
      if (!res.success || !res.user) {
        throw new Error(res.error || 'Team access login failed.');
      }
      navigate('/business');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid team access OTP.');
    } finally {
      setLoading(false);
    }
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
      navigate(nextRouteForUser(res.user), { replace: true });
    } else {
      throw new Error(res.error || 'Registration failed');
    }
  };

  const handlePasswordResetRequest = async (e: React.SyntheticEvent) => {
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
    setLoginAccessMode('password');
    setTeamStep('key');
    setTeamToken('');
    setTeamEmail('');
    setTeamOtp('');
    setTeamChallengeToken('');
    setTeamInvite(null);
    setTeamHint('');

    const nextParams = new URLSearchParams(searchParams);
    if (m === 'register') {
      nextParams.set('mode', 'register');
    } else {
      nextParams.delete('mode');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const startPasswordReset = () => {
    setForgotMode(true);
    setError('');
    setResetIdentifier(loginIdentifier);
  };

  const backToSignIn = () => {
    setForgotMode(false);
    setError('');
    setResetHint('');
  };

  const renderError = () =>
    error ? (
      <div className="login-alert login-alert-error" role="alert">
        <AlertCircle size={16} />
        <span>{error}</span>
      </div>
    ) : null;

  const renderSuccess = (message: string) => (
    <div className="login-alert login-alert-success" role="status">
      <CheckCircle2 size={16} />
      <span>{message}</span>
    </div>
  );

  return (
    <div className="login-page">
      <div className="login-grid-bg" aria-hidden="true" />

      {/* ─── Top bar ─── */}
      <header className="login-topbar">
        <Link to="/" className="login-brandmark" aria-label="VelisMail home">
          <img src="/ZeeResizer.png" alt="" className="login-brandmark-logo" />
          <span className="login-brandmark-name">VelisMail</span>
        </Link>
        <Link to="/" className="login-home-link">
          <ArrowLeft size={15} />
          <span>Back to site</span>
        </Link>
      </header>

      {/* ─── Main ─── */}
      <main className="login-container">
        {/* Brand / copy column */}
        <section className="login-brand animate-fade">
          <span className="login-eyebrow">
            <ShieldCheck size={13} />
            Secure business mail
          </span>

          <h1 className="login-headline">
            {mode === 'login'
              ? <>Welcome <span>back.</span></>
              : <>Initialize <span>workspace.</span></>}
          </h1>

          <p className="login-subcopy">
            {mode === 'login'
              ? 'Sign in to your secure enterprise workspace. Zero trust, maximum efficiency.'
              : 'Deploy your secure business communications in seconds.'}
          </p>

          <ul className="login-features">
            <li className="login-feature">
              <span className="login-feature-icon"><Lock size={16} /></span>
              <span className="login-feature-body">
                <strong>End-to-end encrypted</strong>
                <em>Messages protected in transit and at rest.</em>
              </span>
            </li>
            <li className="login-feature">
              <span className="login-feature-icon"><Fingerprint size={16} /></span>
              <span className="login-feature-body">
                <strong>Recovery-backed authentication</strong>
                <em>OTP verified identity for every new device.</em>
              </span>
            </li>
            <li className="login-feature">
              <span className="login-feature-icon"><ShieldCheck size={16} /></span>
              <span className="login-feature-body">
                <strong>Full compliance &amp; audit logging</strong>
                <em>Every action recorded and exportable.</em>
              </span>
            </li>
          </ul>
        </section>

        {/* Auth card */}
        <div className="login-card animate-scale">
          {mode === 'login' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap"><Mail size={21} /></div>
                <h2>{forgotMode ? 'Reset Password' : 'Sign In'}</h2>
                <p className="login-card-desc">
                  {forgotMode ? 'Verify your OTP and set a new password.' : 'Enter your credentials to continue'}
                </p>
              </div>

              {!forgotMode ? (
                <>
                  <div className="access-mode-switch" role="tablist" aria-label="Sign-in method">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={loginAccessMode === 'password'}
                      className={loginAccessMode === 'password' ? 'active' : ''}
                      onClick={() => { setLoginAccessMode('password'); setError(''); }}
                    >
                      <Lock size={15} /> Password
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={loginAccessMode === 'team'}
                      className={loginAccessMode === 'team' ? 'active' : ''}
                      onClick={() => { setLoginAccessMode('team'); setError(''); }}
                    >
                      <KeyRound size={15} /> Team Access
                    </button>
                  </div>

                  {loginAccessMode === 'password' ? (
                    <form onSubmit={handleLogin} className="login-form" autoComplete="off">
                      <div className="form-group">
                        <label htmlFor="login-email">Workspace Email</label>
                        <input
                          id="login-email"
                          type="text"
                          className="input"
                          placeholder="admin@yourcompany.com"
                          name="velismail-login-identifier"
                          autoComplete="username"
                          required
                          value={loginIdentifier}
                          onChange={e => setLoginIdentifier(e.target.value)}
                          autoFocus
                        />
                      </div>

                      <div className="form-group">
                        <div className="login-label-row">
                          <label htmlFor="login-pass">Password</label>
                          <button type="button" className="login-inline-link" onClick={startPasswordReset}>
                            Forgot password?
                          </button>
                        </div>
                        <div className="login-field">
                          <input
                            id="login-pass"
                            type={showLoginPassword ? 'text' : 'password'}
                            className="input"
                            placeholder="Enter password"
                            name="velismail-login-password"
                            autoComplete="current-password"
                            required
                            value={loginPassword}
                            onChange={e => setLoginPassword(e.target.value)}
                          />
                          <button
                            type="button"
                            className="login-field-action"
                            onClick={() => setShowLoginPassword(v => !v)}
                            aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                            tabIndex={-1}
                          >
                            {showLoginPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                          </button>
                        </div>
                      </div>

                      {renderError()}

                      <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                        {loading ? <LoadingSpinner size="sm" label="Signing in" /> : <>Sign In <ArrowRight size={18} /></>}
                      </button>

                      <div className="login-divider"><span>or continue with</span></div>

                      <button type="button" className="btn btn-secondary w-full google-signin-btn" onClick={handleGoogleLogin} disabled={loading}>
                        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
                          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
                          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z"/>
                        </svg>
                        Continue with Google
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="login-stepper" aria-label={`Step ${teamStepNumber} of 3`}>
                        <span className="login-stepper-label">Step {teamStepNumber} of 3</span>
                        <span className="login-stepper-track">
                          <span
                            className="login-stepper-fill"
                            style={{ width: `${(teamStepNumber / TEAM_STEP_ORDER.length) * 100}%` }}
                          />
                        </span>
                      </div>

                      {teamHint && renderSuccess(teamHint)}

                      {teamInvite && (
                        <div className="team-invite-summary">
                          <span>{teamInvite.name}</span>
                          <strong>{teamInvite.role}</strong>
                        </div>
                      )}

                      {teamStep === 'key' && (
                        <form onSubmit={handleTeamKeySubmit} className="login-form" autoComplete="off">
                          <div className="form-group">
                            <label htmlFor="team-token">Team Access Key</label>
                            <input
                              id="team-token"
                              type="text"
                              className="input secret-input"
                              placeholder="vmt_..."
                              name="velismail-access-key"
                              autoComplete="new-password"
                              autoCapitalize="none"
                              autoCorrect="off"
                              spellCheck={false}
                              data-1p-ignore="true"
                              data-lpignore="true"
                              required
                              value={teamToken}
                              onChange={e => setTeamToken(e.target.value.trim())}
                              autoFocus
                            />
                          </div>
                          {renderError()}
                          <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                            {loading ? <LoadingSpinner size="sm" label="Validating key" /> : <>Continue <ArrowRight size={18} /></>}
                          </button>
                        </form>
                      )}

                      {teamStep === 'email' && (
                        <form onSubmit={handleTeamEmailSubmit} className="login-form" autoComplete="off">
                          <div className="form-group">
                            <label htmlFor="team-email">Assigned Email</label>
                            <input
                              id="team-email"
                              type="email"
                              className="input"
                              placeholder="member@company.com"
                              name="velismail-team-assigned-email"
                              autoComplete="off"
                              required
                              value={teamEmail}
                              onChange={e => setTeamEmail(e.target.value)}
                              autoFocus
                            />
                          </div>
                          {renderError()}
                          <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                            {loading ? <LoadingSpinner size="sm" label="Sending OTP" /> : <>Send OTP <ArrowRight size={18} /></>}
                          </button>
                        </form>
                      )}

                      {teamStep === 'otp' && (
                        <form onSubmit={handleTeamOtpSubmit} className="login-form" autoComplete="off">
                          <div className="form-group">
                            <label htmlFor="team-otp">Verification Code</label>
                            <input
                              id="team-otp"
                              type="text"
                              className="input login-otp-input"
                              placeholder="000000"
                              name="velismail-team-otp"
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              maxLength={6}
                              required
                              value={teamOtp}
                              onChange={e => setTeamOtp(e.target.value.replace(/\D/g, ''))}
                              autoFocus
                            />
                          </div>
                          {renderError()}
                          <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                            {loading ? <LoadingSpinner size="sm" label="Opening dashboard" /> : <>Open Team Dashboard <ArrowRight size={18} /></>}
                          </button>
                          <button type="button" className="login-link resend-inline" onClick={handleTeamOtpResend} disabled={loading || !teamEmail.trim()}>
                            Resend OTP
                          </button>
                        </form>
                      )}
                    </>
                  )}

                  <div className="login-card-footer login-card-footer-split">
                    <span>
                      Don't have an account?{' '}
                      <button className="login-link" onClick={() => switchMode('register')}>Create Account</button>
                    </span>
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

                    {resetHint && renderSuccess(resetHint)}
                    {renderError()}

                    <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                      {loading ? <LoadingSpinner size="sm" label="Sending OTP" /> : <>Send OTP <ArrowRight size={18} /></>}
                    </button>
                  </form>

                  {resetChallengeToken && (
                    <form onSubmit={handlePasswordResetVerify} className="login-form login-form-stacked" autoComplete="off">
                      <div className="form-group">
                        <label htmlFor="reset-otp">Verification Code</label>
                        <input
                          id="reset-otp"
                          type="text"
                          className="input login-otp-input"
                          placeholder="000000"
                          name="velismail-reset-otp"
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          maxLength={6}
                          required
                          value={resetOtp}
                          onChange={e => setResetOtp(e.target.value)}
                        />
                      </div>
                      <button type="submit" className="btn btn-secondary w-full" disabled={loading || !!resetVerificationToken}>
                        {loading ? <LoadingSpinner size="sm" label="Verifying OTP" /> : 'Verify OTP'}
                      </button>
                      <button type="button" className="login-link resend-inline" onClick={(event) => handlePasswordResetRequest(event)} disabled={loading || !resetIdentifier.trim()}>
                        Resend OTP
                      </button>
                    </form>
                  )}

                  {resetVerificationToken && (
                    <form onSubmit={handlePasswordResetComplete} className="login-form login-form-stacked" autoComplete="off">
                      <div className="form-group">
                        <label htmlFor="reset-password">New Password</label>
                        <div className="login-field">
                          <input
                            id="reset-password"
                            type={showResetPassword ? 'text' : 'password'}
                            className="input"
                            placeholder="Enter new password"
                            name="velismail-reset-new-password"
                            autoComplete="new-password"
                            minLength={8}
                            required
                            value={resetPassword}
                            onChange={e => setResetPassword(e.target.value)}
                          />
                          <button
                            type="button"
                            className="login-field-action"
                            onClick={() => setShowResetPassword(v => !v)}
                            aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                            tabIndex={-1}
                          >
                            {showResetPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                          </button>
                        </div>
                      </div>
                      <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                        {loading ? <LoadingSpinner size="sm" label="Updating password" /> : 'Update Password'}
                      </button>
                    </form>
                  )}

                  <div className="login-card-footer">
                    <button className="login-link" onClick={backToSignIn}>
                      <ArrowLeft size={14} /> Back to Sign In
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {mode === 'register' && registerStep === 'form' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap"><Building2 size={21} /></div>
                <h2>Business Account</h2>
                <p className="login-card-desc">
                  Set up your organization email
                </p>
              </div>

              <form onSubmit={handleRegisterSubmit} className="login-form" autoComplete="new-password">
                <div className="form-group">
                  <label htmlFor="reg-name">Full Name</label>
                  <input
                    id="reg-name"
                    type="text"
                    className="input"
                    placeholder="Your full name"
                    name="velismail-new-account-display-name"
                    autoComplete="new-password"
                    required
                    value={regName}
                    onChange={e => setRegName(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="reg-domain">
                    <Globe size={14} className="login-label-icon" />
                    Custom Domain
                  </label>
                  <input
                    id="reg-domain"
                    type="text"
                    className="input"
                    placeholder="yourdomain.com"
                    name="velismail-signup-business-domain"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={regDomain}
                    onChange={e => setRegDomain(e.target.value)}
                  />
                  <span className="form-hint">
                    {defaultBusinessMailboxAddress
                      ? <>Mailbox <strong>{defaultBusinessMailboxAddress}</strong> activates after DNS verification.</>
                      : 'Your mailbox is created after DNS verification succeeds.'}
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="reg-recovery">Recovery Email *</label>
                  <input
                    id="reg-recovery"
                    type="email"
                    className="input"
                    placeholder="you@gmail.com"
                    name="velismail-new-account-recovery-contact"
                    autoComplete="email"
                    required
                    value={regRecoveryEmail}
                    onChange={e => setRegRecoveryEmail(e.target.value)}
                  />
                  <span className="form-hint">
                    Required. Verification codes and recovery links are sent here.
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="reg-pass">Password</label>
                  <div className="login-field">
                    <input
                      id="reg-pass"
                      type={showRegPassword ? 'text' : 'password'}
                      className="input"
                      placeholder="Create a strong password"
                      name="velismail-signup-password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={regPassword}
                      onChange={e => setRegPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="login-field-action"
                      onClick={() => setShowRegPassword(v => !v)}
                      aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                      tabIndex={-1}
                    >
                      {showRegPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {renderError()}

                <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                  {loading ? <LoadingSpinner size="sm" label="Sending verification code" /> : <>Send Verification Code <ArrowRight size={18} /></>}
                </button>
              </form>

              <div className="login-card-footer">
                <span>
                  Already have an account?{' '}
                  <button className="login-link" onClick={() => switchMode('login')}>Sign In</button>
                </span>
              </div>
            </>
          )}

          {mode === 'register' && registerStep === 'otp' && (
            <>
              <div className="login-card-header">
                <button type="button" className="back-step-btn" onClick={() => setRegisterStep('form')}>
                  <ArrowLeft size={16} /> Back
                </button>
                <div className="login-icon-wrap"><Mail size={21} /></div>
                <h2>Verify Email</h2>
                <p className="login-card-desc">Enter the 6-digit code sent to {otpTargetEmail}</p>
              </div>

              <form onSubmit={handleOtpSubmit} className="login-form" autoComplete="off">
                {otpDeliveryHint && renderSuccess(otpDeliveryHint)}
                {verificationToken && renderSuccess('Verification session is active. Finish account creation now.')}

                <div className="form-group">
                  <label htmlFor="otp-code">Verification Code</label>
                  <input
                    id="otp-code"
                    type="text"
                    className="input login-otp-input"
                    placeholder="000000"
                    name="velismail-signup-otp"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </div>

                {renderError()}

                <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading}>
                  {loading ? <LoadingSpinner size="sm" label="Completing registration" /> : <>Verify &amp; Complete <ArrowRight size={18} /></>}
                </button>
              </form>

              <div className="login-card-footer">
                <span>
                  Didn't receive the code?{' '}
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
                </span>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ─── Footer ─── */}
      <footer className="login-footer-links">
        <Link to="/privacy">Privacy Policy</Link>
        <span aria-hidden="true">•</span>
        <Link to="/terms">Terms of Service</Link>
        <span aria-hidden="true">•</span>
        <Link to="/security">Security</Link>
      </footer>
    </div>
  );
}
