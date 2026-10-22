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
  HelpCircle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { auth, isBusinessSetupReady, teamAccess, type TeamAccessInvite, type User } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import './Login.css';

type Mode = 'login' | 'register';
type RegisterStep = 'intro' | 'form' | 'otp';
type LoginAccessMode = 'password' | 'team';
type TeamAccessStep = 'key' | 'email' | 'otp';
type MfaStep = 'none' | 'code' | 'recovery-email' | 'recovery-otp' | 'recovery-setup';

const TEAM_STEP_ORDER: TeamAccessStep[] = ['key', 'email', 'otp'];

// Common country codes for phone input
const COUNTRY_CODES = [
  { code: 'IN', label: 'India', dial: '+91' },
  { code: 'US', label: 'United States', dial: '+1' },
  { code: 'GB', label: 'United Kingdom', dial: '+44' },
  { code: 'CA', label: 'Canada', dial: '+1' },
  { code: 'AU', label: 'Australia', dial: '+61' },
  { code: 'DE', label: 'Germany', dial: '+49' },
  { code: 'FR', label: 'France', dial: '+33' },
  { code: 'JP', label: 'Japan', dial: '+81' },
  { code: 'CN', label: 'China', dial: '+86' },
  { code: 'BR', label: 'Brazil', dial: '+55' },
  { code: 'MX', label: 'Mexico', dial: '+52' },
  { code: 'ES', label: 'Spain', dial: '+34' },
  { code: 'IT', label: 'Italy', dial: '+39' },
  { code: 'NL', label: 'Netherlands', dial: '+31' },
  { code: 'SG', label: 'Singapore', dial: '+65' },
  { code: 'AE', label: 'UAE', dial: '+971' },
  { code: 'SA', label: 'Saudi Arabia', dial: '+966' },
  { code: 'ZA', label: 'South Africa', dial: '+27' },
  { code: 'NG', label: 'Nigeria', dial: '+234' },
  { code: 'KE', label: 'Kenya', dial: '+254' },
  { code: 'EG', label: 'Egypt', dial: '+20' },
  { code: 'PK', label: 'Pakistan', dial: '+92' },
  { code: 'BD', label: 'Bangladesh', dial: '+880' },
  { code: 'PH', label: 'Philippines', dial: '+63' },
  { code: 'ID', label: 'Indonesia', dial: '+62' },
  { code: 'MY', label: 'Malaysia', dial: '+60' },
  { code: 'TH', label: 'Thailand', dial: '+66' },
  { code: 'VN', label: 'Vietnam', dial: '+84' },
  { code: 'KR', label: 'South Korea', dial: '+82' },
  { code: 'TW', label: 'Taiwan', dial: '+886' },
  { code: 'HK', label: 'Hong Kong', dial: '+852' },
  { code: 'NZ', label: 'New Zealand', dial: '+64' },
  { code: 'CH', label: 'Switzerland', dial: '+41' },
  { code: 'AT', label: 'Austria', dial: '+43' },
  { code: 'BE', label: 'Belgium', dial: '+32' },
  { code: 'SE', label: 'Sweden', dial: '+46' },
  { code: 'NO', label: 'Norway', dial: '+47' },
  { code: 'DK', label: 'Denmark', dial: '+45' },
  { code: 'FI', label: 'Finland', dial: '+358' },
  { code: 'PL', label: 'Poland', dial: '+48' },
  { code: 'IE', label: 'Ireland', dial: '+353' },
  { code: 'PT', label: 'Portugal', dial: '+351' },
  { code: 'GR', label: 'Greece', dial: '+30' },
  { code: 'CZ', label: 'Czech Republic', dial: '+420' },
  { code: 'HU', label: 'Hungary', dial: '+36' },
  { code: 'RO', label: 'Romania', dial: '+40' },
  { code: 'IL', label: 'Israel', dial: '+972' },
  { code: 'TR', label: 'Turkey', dial: '+90' },
  { code: 'AR', label: 'Argentina', dial: '+54' },
  { code: 'CL', label: 'Chile', dial: '+56' },
  { code: 'CO', label: 'Colombia', dial: '+57' },
  { code: 'PE', label: 'Peru', dial: '+51' },
  { code: 'VE', label: 'Venezuela', dial: '+58' },
  { code: 'EC', label: 'Ecuador', dial: '+593' },
  { code: 'UY', label: 'Uruguay', dial: '+598' },
  { code: 'CR', label: 'Costa Rica', dial: '+506' },
  { code: 'PA', label: 'Panama', dial: '+507' },
];

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
  const [regPhoneCountryCode, setRegPhoneCountryCode] = useState('+91');
  const [regPhoneNumber, setRegPhoneNumber] = useState('');

  const [otp, setOtp] = useState('');
  const [otpChallengeToken, setOtpChallengeToken] = useState('');
  const [otpDeliveryHint, setOtpDeliveryHint] = useState('');
  const [verificationToken, setVerificationToken] = useState('');

  // MFA Authenticator state
  const [mfaStep, setMfaStep] = useState<MfaStep>('none');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaRecoveryEmail, setMfaRecoveryEmail] = useState('');
  const [mfaRecoveryChallenge, setMfaRecoveryChallenge] = useState('');
  const [mfaRecoveryOtp, setMfaRecoveryOtp] = useState('');
  const [mfaRecoveryToken, setMfaRecoveryToken] = useState('');
  const [mfaRecoverySetup, setMfaRecoverySetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const nextMode = searchParams.get('mode') === 'register' ? 'register' : 'login';
    setMode(nextMode);
    if (nextMode === 'register') {
      setRegisterStep('intro');
    }
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
    } else if (res.mfaRequired && res.mfaToken) {
      setMfaToken(res.mfaToken);
      setMfaRecoveryEmail(res.recoveryEmailMasked || '');
      setMfaStep('code');
      setLoading(false);
      return;
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
    } else if (res.mfaRequired && res.mfaToken) {
      setMfaToken(res.mfaToken);
      setMfaRecoveryEmail(res.recoveryEmailMasked || '');
      setMfaStep('code');
      setLoading(false);
      return;
    } else {
      setError(res.error || 'Google sign-in failed');
    }
    setLoading(false);
  };

  // MFA Authenticator handlers
  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await auth.verifyMfa(mfaToken, mfaCode);
      if (res.success && res.user) {
        navigate(nextRouteForUser(res.user), { replace: true });
      } else {
        setError(res.error || 'Invalid authenticator code');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid authenticator code');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaRecoverySend = async () => {
    if (!mfaToken) return;
    setLoading(true);
    setError('');
    try {
      const res = await auth.sendMfaRecoveryOtp(mfaToken);
      setMfaRecoveryChallenge(res.challengeToken);
      setMfaRecoveryEmail(res.maskedEmail);
      setMfaStep('recovery-otp');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send recovery code');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaRecoveryVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken || !mfaRecoveryChallenge || !mfaRecoveryOtp) return;
    setLoading(true);
    setError('');
    try {
      const res = await auth.verifyMfaRecovery(mfaToken, mfaRecoveryChallenge, mfaRecoveryOtp);
      setMfaRecoveryToken(res.recoveryToken);
      setMfaRecoverySetup({ secret: res.secret, otpauthUrl: res.otpauthUrl });
      setMfaRecoveryEmail(res.recoveryEmail || '');
      setMfaStep('recovery-setup');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid recovery code');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaRecoveryComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaRecoveryToken || !mfaCode) return;
    setLoading(true);
    setError('');
    try {
      const res = await auth.completeMfaRecovery(mfaRecoveryToken, mfaCode);
      if (res.success && res.user) {
        navigate(nextRouteForUser(res.user), { replace: true });
      } else {
        setError(res.error || 'Failed to complete recovery');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete recovery');
    } finally {
      setLoading(false);
    }
  };

  const cancelMfa = () => {
    setMfaStep('none');
    setMfaToken('');
    setMfaCode('');
    setMfaRecoveryEmail('');
    setMfaRecoveryChallenge('');
    setMfaRecoveryOtp('');
    setMfaRecoveryToken('');
    setMfaRecoverySetup(null);
    setError('');
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
      phoneCountryCode: regPhoneCountryCode || undefined,
      phoneNumber: regPhoneNumber || undefined,
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
    setRegisterStep(m === 'register' ? 'intro' : 'form');
    setRegRecoveryEmail('');
    setRegDomain('');
    setRegPassword('');
    setRegPhoneCountryCode('+91');
    setRegPhoneNumber('');
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
                  {mfaStep !== 'none' ? (
                    <>
                      <div className="login-stepper" aria-label="MFA verification">
                        <span className="login-stepper-label">
                          {mfaStep === 'code' ? 'Step 1 of 2' : mfaStep === 'recovery-otp' ? 'Step 1 of 3' : mfaStep === 'recovery-setup' ? 'Step 2 of 3' : 'Step 2 of 2'}
                        </span>
                      </div>

                      {mfaStep === 'code' && (
                        <form onSubmit={handleMfaVerify} className="login-form login-form-stacked" autoComplete="off">
                          <div className="login-card-header">
                            <div className="login-icon-wrap"><ShieldCheck size={21} /></div>
                            <h2>Two-Factor Authentication</h2>
                            <p className="login-card-desc">
                              Enter the 6-digit code from your authenticator app.
                            </p>
                          </div>

                          {mfaRecoveryEmail && (
                            <p className="form-hint">
                              Recovery email: <strong>{mfaRecoveryEmail}</strong>
                            </p>
                          )}

                          <div className="form-group">
                            <label htmlFor="mfa-code">Verification Code</label>
                            <input
                              id="mfa-code"
                              type="text"
                              className="input login-otp-input"
                              placeholder="000000"
                              name="velismail-mfa-code"
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              maxLength={6}
                              required
                              value={mfaCode}
                              onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                              autoFocus
                            />
                          </div>
                          {renderError()}

                          <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading || !mfaCode.trim()}>
                            {loading ? <LoadingSpinner size="sm" label="Verifying" /> : <>Verify &amp; Sign In <ArrowRight size={18} /></>}
                          </button>

                          <div className="login-card-footer">
                            <button className="login-link" onClick={() => { setMfaStep('recovery-otp'); setError(''); }}>
                              Can't use your authenticator? Use recovery email
                            </button>
                            <button className="login-link" onClick={cancelMfa}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {mfaStep === 'recovery-otp' && (
                        <form onSubmit={handleMfaRecoverySend} className="login-form login-form-stacked" autoComplete="off">
                          <div className="login-card-header">
                            <div className="login-icon-wrap"><Mail size={21} /></div>
                            <h2>Recovery Email Verification</h2>
                            <p className="login-card-desc">
                              Send a verification code to your recovery email to reset your authenticator.
                            </p>
                          </div>

                          <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading || !mfaToken}>
                            {loading ? <LoadingSpinner size="sm" label="Sending OTP" /> : <>Send Recovery OTP <ArrowRight size={18} /></>}
                          </button>
                          {mfaRecoveryChallenge && (
                            <form onSubmit={handleMfaRecoveryVerify} className="login-form login-form-stacked" autoComplete="off" style={{ marginTop: '16px' }}>
                              <div className="form-group">
                                <label htmlFor="mfa-recovery-otp">Verification Code</label>
                                <input
                                  id="mfa-recovery-otp"
                                  type="text"
                                  className="input login-otp-input"
                                  placeholder="000000"
                                  name="velismail-mfa-recovery-otp"
                                  autoComplete="one-time-code"
                                  inputMode="numeric"
                                  maxLength={6}
                                  required
                                  value={mfaRecoveryOtp}
                                  onChange={e => setMfaRecoveryOtp(e.target.value.replace(/\D/g, ''))}
                                  autoFocus
                                />
                              </div>
                              {renderError()}
                              <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading || !mfaRecoveryOtp.trim()}>
                                {loading ? <LoadingSpinner size="sm" label="Verifying" /> : <>Verify &amp; Continue <ArrowRight size={18} /></>}
                              </button>
                            </form>
                          )}
                          <div className="login-card-footer">
                            <button className="login-link" onClick={() => { setMfaStep('code'); setError(''); }}>
                              Back to authenticator code
                            </button>
                            <button className="login-link" onClick={cancelMfa}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {mfaStep === 'recovery-setup' && (
                        <form onSubmit={handleMfaRecoveryComplete} className="login-form login-form-stacked" autoComplete="off">
                          <div className="login-card-header">
                            <div className="login-icon-wrap"><ShieldCheck size={21} /></div>
                            <h2>Set Up New Authenticator</h2>
                            <p className="login-card-desc">
                              Scan the QR code with your authenticator app, then enter the 6-digit code.
                            </p>
                          </div>

                          {mfaRecoverySetup && (
                            <div className="mfa-setup" style={{ textAlign: 'center', marginBottom: '20px' }}>
                              <div className="mfa-qr" style={{ margin: '0 auto', display: 'inline-block' }}>
                                <QRCodeSVG value={mfaRecoverySetup.otpauthUrl} size={200} />
                              </div>
                              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                                Scan with Google Authenticator, Authy, 1Password, or enter this key manually:
                              </p>
                              <code style={{ display: 'block', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '14px', letterSpacing: '2px', textAlign: 'center', wordBreak: 'break-all', marginBottom: '16px' }}>
                                {mfaRecoverySetup.secret}
                              </code>
                            </div>
                          )}

                          <div className="form-group">
                            <label htmlFor="mfa-recovery-code">6-Digit Code</label>
                            <input
                              id="mfa-recovery-code"
                              type="text"
                              className="input login-otp-input"
                              placeholder="000000"
                              name="velismail-mfa-recovery-code"
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              maxLength={6}
                              required
                              value={mfaCode}
                              onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                              autoFocus
                            />
                          </div>
                          {renderError()}

                          <button type="submit" className="btn btn-primary w-full login-submit" disabled={loading || !mfaRecoveryToken || !mfaCode.trim()}>
                            {loading ? <LoadingSpinner size="sm" label="Completing recovery" /> : <>Complete Recovery <ArrowRight size={18} /></>}
                          </button>

                          <div className="login-card-footer">
                            <button className="login-link" onClick={cancelMfa}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}
                    </>
                  ) : (
                    <>
                    <div className="access-mode-switch" role="tablist" aria-label="Sign-in method">
                    <button
                      type="button"
                      role="tab"
                      id="login-tab-password"
                      aria-controls="login-panel-password"
                      aria-selected={loginAccessMode === 'password'}
                      className={loginAccessMode === 'password' ? 'active' : ''}
                      onClick={() => { setLoginAccessMode('password'); setError(''); }}
                    >
                      <Lock size={15} /> Password
                    </button>
                    <button
                      type="button"
                      role="tab"
                      id="login-tab-team"
                      aria-controls="login-panel-team"
                      aria-selected={loginAccessMode === 'team'}
                      className={loginAccessMode === 'team' ? 'active' : ''}
                      onClick={() => { setLoginAccessMode('team'); setError(''); }}
                    >
                      <KeyRound size={15} /> Team Access
                    </button>
                  </div>

                  {loginAccessMode === 'password' ? (
                    <form id="login-panel-password" role="tabpanel" aria-labelledby="login-tab-password" onSubmit={handleLogin} className="login-form" autoComplete="off">
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
                        <form id="login-panel-team" role="tabpanel" aria-labelledby="login-tab-team" onSubmit={handleTeamKeySubmit} className="login-form" autoComplete="off">
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

          {mode === 'register' && registerStep === 'intro' && (
            <>
              <div className="login-card-header">
                <div className="login-icon-wrap"><HelpCircle size={21} /></div>
                <h2>Welcome to VelisMail</h2>
                <p className="login-card-desc">
                  Before you create your account, here's what you need to know:
                </p>
              </div>

              <div className="login-form" style={{ textAlign: 'left' }}>
                <div className="form-group" style={{ marginBottom: '16px', padding: '16px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px' }}>How VelisMail Works</h3>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: '1.8', color: 'var(--text-secondary)' }}>
                    <li><strong>Bring your own domain:</strong> VelisMail does not sell domains. You can use a domain you already own, or buy one from any registrar (Namecheap, GoDaddy, Cloudflare, Porkbun, etc.).</li>
                    <li><strong>DNS setup is guided:</strong> After adding your domain, we'll show you the exact DNS records to add (MX for mail delivery, SPF/DKIM/DMARC for authentication, and a TXT record for ownership verification).</li>
                    <li><strong>No separate mail server needed:</strong> VelisMail handles all mail infrastructure. Once DNS is verified, you can create mailboxes like <code>you@yourdomain.com</code> and send/receive immediately.</li>
                    <li><strong>Optional phone for recovery:</strong> Add a mobile number with country code for future account recovery via SMS (optional).</li>
                  </ul>
                </div>
                <button
                  type="button"
                  className="btn btn-primary w-full login-submit"
                  onClick={() => setRegisterStep('form')}
                  style={{ marginTop: '20px' }}
                >
                  <CheckCircle2 size={16} /> I understand, continue to setup
                </button>
              </div>
            </>
          )}

          {mode === 'register' && registerStep === 'form' && (
            <>
              <div className="login-card-header">
                <button type="button" className="back-step-btn" onClick={() => setRegisterStep('intro')}>
                  <ArrowLeft size={16} /> Back
                </button>
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
                    autoComplete="name"
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
                  <label htmlFor="reg-phone">Mobile Number (optional)</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      id="reg-phone-country"
                      className="input"
                      style={{ width: '110px', minWidth: '110px' }}
                      value={regPhoneCountryCode}
                      onChange={e => setRegPhoneCountryCode(e.target.value)}
                    >
                      {COUNTRY_CODES.map(c => (
                        <option key={c.code} value={c.dial}>
                          {c.dial} {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      id="reg-phone"
                      type="tel"
                      className="input"
                      placeholder="Phone number"
                      name="velismail-new-account-phone"
                      autoComplete="tel"
                      value={regPhoneNumber}
                      onChange={e => setRegPhoneNumber(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>
                  <span className="form-hint">
                    Optional. Used for future account recovery via SMS.
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
