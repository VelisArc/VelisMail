import { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import {
  Shield, ArrowLeft, CheckCircle2, AlertCircle,
  RefreshCw, User as UserIcon, Lock, Mail, Trash2,
  LogOut, Monitor, Smartphone, ShieldCheck
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { auth, isBusinessSetupReady, type ActiveSession, type User } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import './Settings.css';

type Tab = 'profile' | 'security' | 'account';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(auth.getSession());
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [profileName, setProfileName] = useState(user?.displayName || '');
  const [profileImage, setProfileImage] = useState<string | null>(user?.profileImageUrl || null);
  const [emailLogo, setEmailLogo] = useState<string | null>(user?.emailLogoUrl || null);
  const [appendEmailLogo, setAppendEmailLogo] = useState(Boolean(user?.appendEmailLogo));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [recoveryEmailDraft, setRecoveryEmailDraft] = useState(user?.recoveryEmail || '');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryChallengeToken, setRecoveryChallengeToken] = useState('');
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const [recoverySaving, setRecoverySaving] = useState(false);
  const [recoveryVerifying, setRecoveryVerifying] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState<boolean>(Boolean(user?.totpEnabled));
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [showMfaDisable, setShowMfaDisable] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');

  useEffect(() => {
    const session = auth.getSession();
    if (!session) {
      navigate('/login');
      return;
    } else if (!isBusinessSetupReady(session)) {
      navigate('/business');
      return;
    }
    setUser(session);
    setProfileName(session.displayName || '');
    setRecoveryEmailDraft(session.recoveryEmail || '');
    setEmailLogo(session.emailLogoUrl || null);
    setAppendEmailLogo(Boolean(session.appendEmailLogo));
  }, [navigate]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (toast) {
      timer = setTimeout(() => setToast(null), 3000);
    }
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    const result = await auth.listSessions();
    setSessionsLoading(false);
    if (!result.success) {
      setToast({ message: result.error || 'Unable to load sessions', type: 'error' });
      return;
    }
    setSessions(result.sessions);
  }, []);

  useEffect(() => {
    if (activeTab !== 'account') return;
    loadSessions();
  }, [activeTab, loadSessions]);

  const handleProfileSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim()) {
      setProfileError('Full name is required.');
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    
    const result = auth.updateSettings({ displayName: profileName.trim() });
    if (!result.success || !result.user) {
      setProfileSaving(false);
      setProfileError('Profile update failed. Please try again.');
      showToast('Profile update failed', 'error');
      return;
    }
    setUser(result.user);
    setProfileSaving(false);
    showToast('Profile updated successfully');
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const result = auth.updateSettings({ profileImageUrl: dataUrl });
      if (result.success && result.user) {
        setUser(result.user);
        setProfileImage(result.user.profileImageUrl || null);
        showToast('Profile image updated');
      } else {
        showToast('Failed to save profile image', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    const result = auth.updateSettings({ profileImageUrl: undefined });
    if (result.success && result.user) {
      setUser(result.user);
      setProfileImage(null);
      showToast('Profile image removed');
    } else {
      showToast('Failed to remove profile image', 'error');
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const result = auth.updateSettings({ emailLogoUrl: dataUrl });
      if (result.success && result.user) {
        setUser(result.user);
        setEmailLogo(result.user.emailLogoUrl || null);
        showToast('Email private logo updated');
      } else {
        showToast('Failed to save email logo', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    const result = auth.updateSettings({ emailLogoUrl: undefined });
    if (result.success && result.user) {
      setUser(result.user);
      setEmailLogo(null);
      showToast('Email private logo removed');
    } else {
      showToast('Failed to remove email logo', 'error');
    }
  };

  const handleAppendEmailLogo = (value: boolean) => {
    const result = auth.updateSettings({ appendEmailLogo: value });
    if (result.success && result.user) {
      setUser(result.user);
      setAppendEmailLogo(value);
      showToast(value ? 'Logo will be appended to outgoing mail' : 'Automatic logo disabled');
    } else {
      showToast('Failed to save the logo preference', 'error');
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setSecurityError('All password fields are required.');
      return;
    }
    if (newPassword.length < 8) {
      setSecurityError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setSecurityError('New password and confirm password do not match.');
      return;
    }
    setPasswordSaving(true);
    setSecurityError(null);
    const result = await auth.changePassword(currentPassword, newPassword);
    setPasswordSaving(false);
    if (!result.success) {
      setSecurityError(result.error || 'Password update failed.');
      showToast(result.error || 'Password update failed', 'error');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    showToast('Password updated successfully');
  };

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  const handleStartMfaSetup = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await auth.startMfaSetup();
      if (!result.success || !result.secret || !result.otpauthUrl) {
        throw new Error('Unable to start the authenticator setup.');
      }
      setMfaSetup({ secret: result.secret, otpauthUrl: result.otpauthUrl });
      setMfaCode('');
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : 'Unable to start the authenticator setup.');
      showToast(err instanceof Error ? err.message : 'Unable to start the authenticator setup.', 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleEnableMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await auth.enableMfa(mfaCode.trim());
      if (!result.success) {
        throw new Error('Invalid authenticator code.');
      }
      setMfaSetup(null);
      setMfaCode('');
      setMfaEnabled(true);
      setUser(prev => (prev ? { ...prev, totpEnabled: true } : prev));
      showToast('Authenticator enabled');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid authenticator code.';
      setMfaError(message);
      showToast(message, 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleCancelMfaSetup = () => {
    setMfaSetup(null);
    setMfaCode('');
    setMfaError(null);
  };

  const handleDisableMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await auth.disableMfa(mfaDisablePassword, mfaDisableCode.trim());
      if (!result.success) {
        throw new Error('Unable to disable the authenticator.');
      }
      setShowMfaDisable(false);
      setMfaDisablePassword('');
      setMfaDisableCode('');
      setMfaEnabled(false);
      setUser(prev => (prev ? { ...prev, totpEnabled: false } : prev));
      showToast('Authenticator disabled');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to disable the authenticator.';
      setMfaError(message);
      showToast(message, 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleRevokeSession = async (sessionId: string, current: boolean) => {
    const result = await auth.revokeSession(sessionId);
    if (!result.success) {
      showToast(result.error || 'Unable to revoke session', 'error');
      return;
    }
    if (current) {
      auth.logout();
      navigate('/login');
      return;
    }
    setSessions(prev => prev.filter(session => session.id !== sessionId));
    showToast('Session revoked');
  };

  const handleRevokeOtherSessions = async () => {
    const result = await auth.revokeOtherSessions();
    if (!result.success) {
      showToast(result.error || 'Unable to revoke other sessions', 'error');
      return;
    }
    setSessions(prev => prev.filter(session => session.current));
    showToast(`Revoked ${result.revoked || 0} other session${result.revoked === 1 ? '' : 's'}`);
  };

  const handleSendRecoveryOtp = async () => {
    if (!recoveryEmailDraft.trim()) {
      showToast('Recovery email is required.', 'error');
      return;
    }

    setRecoverySaving(true);
    setRecoveryHint(null);
    try {
      const response = await auth.sendOtp({
        email: recoveryEmailDraft.trim(),
        displayName: user?.displayName || 'VelisMail user',
        purpose: 'recovery_email',
      });
      setRecoveryChallengeToken(response.challengeToken);
      setRecoveryHint(`Verification code sent to ${response.maskedEmail}.`);
      showToast('Recovery verification code sent');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send recovery code.', 'error');
    } finally {
      setRecoverySaving(false);
    }
  };

  const handleVerifyRecoveryEmail = async () => {
    if (!recoveryChallengeToken) {
      showToast('Please send a verification code first.', 'error');
      return;
    }
    if (!recoveryOtp.trim()) {
      showToast('Please enter the verification code.', 'error');
      return;
    }

    setRecoveryVerifying(true);
    try {
      const verification = await auth.verifyOtp({
        email: recoveryEmailDraft.trim(),
        otp: recoveryOtp.trim(),
        challengeToken: recoveryChallengeToken,
        purpose: 'recovery_email',
      });
      const result = await auth.updateRecoveryEmail(
        recoveryEmailDraft.trim(),
        verification.verificationToken,
      );
      if (!result.success || !result.user) {
        throw new Error(result.error || 'Failed to save recovery email.');
      }
      setUser(result.user);
      setRecoveryOtp('');
      setRecoveryChallengeToken('');
      setRecoveryHint('Recovery email verified and saved.');
      showToast('Recovery email verified');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to verify recovery email.', 'error');
    } finally {
      setRecoveryVerifying(false);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!isBusinessSetupReady(user)) return <Navigate to="/business" replace />;

  const primaryMailbox = user.businessMailboxAddress || user.email;

  return (
    <div className="settings-page">
      <header className="settings-header glass">
        <div className="container settings-header-row">
          <div className="settings-header-left">
            <Link to="/business" className="btn btn-ghost btn-sm">
              <ArrowLeft size={16} /> Back to Inbox
            </Link>
            <h1>Settings</h1>
          </div>
          <div className="settings-header-right">
            <div className="user-avatar">
              {user.profileImageUrl ? (
                <img src={user.profileImageUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '0' }} />
              ) : (
                user.displayName?.charAt(0) || 'U'
              )}
            </div>
            <span>{user.displayName}</span>
          </div>
        </div>
      </header>

      <div className="container">
        <div className="settings-body">
          <nav className="settings-tabs glass">
          <button className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
            <UserIcon size={18} /> Profile
          </button>
          <button className={`tab-btn ${activeTab === 'security' ? 'active' : ''}`} onClick={() => setActiveTab('security')}>
            <Lock size={18} /> Security
          </button>

          <button className={`tab-btn ${activeTab === 'account' ? 'active' : ''}`} onClick={() => setActiveTab('account')}>
            <Mail size={18} /> Account
          </button>
        </nav>

        <div className="settings-content">
          {activeTab === 'profile' && (
            <div className="animate-fade">
              <div className="settings-section-header">
                <h2>Profile</h2>
                <p>Manage your account information</p>
              </div>
              <div className="profile-tab-grid">
                <form className="glass-card profile-card" onSubmit={handleProfileSave} style={{ margin: 0 }}>
                  <div className="profile-row">
                    <div className="profile-avatar-lg">
                      {profileImage ? <img src={profileImage} alt="avatar" /> : (user.displayName?.charAt(0) || 'U')}
                    </div>
                    <div>
                      <h3>{user.displayName}</h3>
                      <span className="badge badge-primary">{user.plan} Plan</span>
                      <div className="settings-spacer-xs">
                        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} />
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>Upload Image</button>
                        {profileImage && <button type="button" className="btn btn-sm btn-ghost settings-ml-xs" onClick={handleRemoveImage}>Remove</button>}
                      </div>
                    </div>
                  </div>

                  <div className="divider" style={{ margin: '16px 0' }} />

                  <div className="profile-row" style={{ alignItems: 'center' }}>
                    <div className="email-logo-preview">
                      {emailLogo ? <img src={emailLogo} alt="email logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', fontWeight: 'bold' }}>NO LOGO</span>}
                    </div>
                    <div>
                      <h4 style={{ textTransform: 'uppercase', fontSize: 'var(--text-xs)', fontWeight: 'bold', margin: '0 0 4px 0' }}>Email Private Logo</h4>
                      <p style={{ fontSize: '10px', color: 'var(--text-muted)', margin: '0 0 8px 0', lineHeight: '1.3' }}>Upload a brand logo. It is never appended automatically until you enable the option below.</p>
                      <div>
                        <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={handleLogoChange} />
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => logoInputRef.current?.click()}>Upload Logo</button>
                        {emailLogo && <button type="button" className="btn btn-sm btn-ghost settings-ml-xs" onClick={handleRemoveLogo}>Remove</button>}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={appendEmailLogo} onChange={e => handleAppendEmailLogo(e.target.checked)} />
                        Append logo to outgoing mail
                      </label>
                    </div>
                  </div>

                  <div className="divider" />
                  <div className="profile-fields">
                    <div className="profile-field">
                      <label>Full Name</label>
                      <input className="input" value={profileName} onChange={e => setProfileName(e.target.value)} />
                    </div>
                    <div className="profile-field">
                      <label>Primary Mailbox</label>
                      <input className="input" value={primaryMailbox} disabled />
                    </div>
                    <div className="profile-field">
                      <label>Recovery Email</label>
                      <input className="input" value={user.recoveryEmail || 'Not configured'} disabled />
                    </div>

                    <div className="profile-field">
                      <label>Member Since</label>
                      <input className="input" value={new Date(user.createdAt).toLocaleDateString()} disabled />
                    </div>
                  </div>
                  {profileError && <div className="form-error settings-spacer-sm">{profileError}</div>}
                  <button className="btn btn-primary settings-spacer-md" type="submit" disabled={profileSaving}>
                    {profileSaving ? <LoadingSpinner size="sm" label="Saving profile" /> : <CheckCircle2 size={16} />}
                    Save Changes
                  </button>
                </form>

                <div className="glass-card profile-sidebar-card">
                  <h3>System & Subscription</h3>
                  
                  <div className="system-info-rows">
                    <div>
                      <span className="info-row-label">Workspace Domain</span>
                      <strong className="info-row-value">{user.businessDomain || 'No Domain Set'}</strong>
                    </div>
                    <div>
                      <span className="info-row-label">Subscription Plan</span>
                      <span className={`badge ${user.plan === 'Premium' ? 'badge-primary' : 'badge-neutral'}`}>
                        {user.plan || 'Free'} Plan
                      </span>
                    </div>
                    <div>
                      <span className="info-row-label">Workspace Role</span>
                      <strong className="info-row-value capitalize">{user.role || 'Member'}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="animate-fade">
              <div className="settings-section-header">
                <h2>Security</h2>
                <p>Manage your password and encryption settings</p>
              </div>
              <div className="glass-card security-card">
                <h3><Lock size={18} /> Password</h3>
                <p>Change your account password.</p>
                <form onSubmit={handlePasswordUpdate}>
                  <div className="security-fields">
                    <input className="input" type="password" placeholder="Current password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                    <input className="input" type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                    <input className="input" type="password" placeholder="Confirm new password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                  </div>
                  {securityError && <div className="form-error settings-spacer-sm">{securityError}</div>}
                  <button className="btn btn-primary btn-sm settings-spacer-sm" type="submit" disabled={passwordSaving}>
                    {passwordSaving ? <LoadingSpinner size="sm" label="Updating password" /> : <CheckCircle2 size={16} />}
                    Update Password
                  </button>
                </form>
              </div>
              <div className="glass-card security-card">
                <h3><ShieldCheck size={18} /> Authenticator App (2FA)</h3>
                <p>
                  Add an extra layer of security. When it is on, every sign-in asks for a
                  6-digit code from your authenticator app.
                </p>

                {mfaBusy ? (
                  <div className="form-success settings-spacer-sm">
                    <LoadingSpinner size="sm" label="Working on the authenticator" />
                  </div>
                ) : mfaEnabled ? (
                  <>
                    <div className="form-success settings-spacer-sm">
                      <ShieldCheck size={16} style={{ marginRight: '8px' }} />
                      <strong>Authenticator is enabled.</strong> A 6-digit code is required on every sign-in.
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      type="button"
                      onClick={() => setShowMfaDisable(true)}
                    >
                      <Trash2 size={14} /> Disable Authenticator
                    </button>
                  </>
                ) : mfaSetup ? (
                  <>
                    <div className="mfa-setup" style={{ textAlign: 'center' }}>
                      <div className="mfa-qr" style={{ margin: '16px auto', display: 'inline-block' }}>
                        <QRCodeSVG value={mfaSetup.otpauthUrl} size={200} />
                      </div>
                      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                        Scan with Google Authenticator, Authy, 1Password, or enter this key manually:
                      </p>
                      <code style={{ display: 'block', padding: '12px', background: 'var(--bg-elevated)', borderRadius: '8px', fontSize: '14px', letterSpacing: '2px', textAlign: 'center', wordBreak: 'break-all', marginBottom: '16px' }}>
                        {mfaSetup.secret}
                      </code>
                    </div>
                    <div className="security-fields">
                      <input
                        className="input"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6-digit code from authenticator app"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                    {mfaError && <div className="form-error settings-spacer-sm">{mfaError}</div>}
                    <button
                      className="btn btn-primary btn-sm settings-spacer-sm"
                      type="button"
                      onClick={handleEnableMfa}
                      disabled={!mfaCode.trim()}
                    >
                      <CheckCircle2 size={16} /> Enable Authenticator
                    </button>
                    <button className="btn btn-ghost btn-sm settings-spacer-xs" type="button" onClick={handleCancelMfaSetup}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <p className="settings-spacer-sm" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Requires a verified recovery email. {user.recoveryEmailVerified
                        ? 'Your recovery email is verified, so you can set this up now.'
                        : 'Verify your recovery email first, then come back here.'}
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={handleStartMfaSetup}
                      disabled={!user.recoveryEmailVerified}
                    >
                      <ShieldCheck size={16} /> Set Up Authenticator
                    </button>
                  </>
                )}
              </div>

              {showMfaDisable && (
                <div className="modal-overlay" onClick={() => setShowMfaDisable(false)}>
                  <div className="glass-card animate-scale" style={{ maxWidth: '420px', width: '100%', padding: '24px' }} onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertCircle size={20} color="var(--danger)" /> Disable Authenticator?
                    </h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 16px' }}>
                      Your account falls back to the password alone. Confirm with your current
                      password and a 6-digit code from the authenticator app.
                    </p>
                    <div className="security-fields">
                      <input
                        className="input"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Current password"
                        value={mfaDisablePassword}
                        onChange={(e) => setMfaDisablePassword(e.target.value)}
                      />
                      <input
                        className="input"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6-digit authenticator code"
                        value={mfaDisableCode}
                        onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                    {mfaError && <div className="form-error settings-spacer-sm">{mfaError}</div>}
                    <div className="settings-actions-row settings-spacer-sm">
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowMfaDisable(false)} disabled={mfaBusy}>
                        Cancel
                      </button>
                      <button className="btn btn-danger btn-sm" type="button" onClick={handleDisableMfa} disabled={mfaBusy || !mfaDisableCode.trim()}>
                        {mfaBusy ? <LoadingSpinner size="sm" label="Disabling" /> : <Trash2 size={16} />} Disable
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="glass-card security-card">
                <h3><Shield size={18} /> Account Security</h3>
                <p>Your password is hashed with Argon2id and never stored in plain text. Email codes protect registration and password reset.</p>
                <div className="key-info">
                  <div className="key-row">
                    <span>Password hashing</span><span className="badge badge-accent">Argon2id</span>
                  </div>
                  <div className="key-row">
                    <span>Sessions</span><span className="badge badge-accent">Signed, expiring tokens</span>
                  </div>
                  <div className="key-row">
                    <span>Auth Method</span><span className="badge badge-primary">Password + recovery OTP</span>
                  </div>
                </div>
              </div>
              <div className="glass-card security-card">
                <h3><Mail size={18} /> Recovery Email</h3>
                <p>Use a personal email for OTP, recovery, and two-step verification approvals.</p>
                <div className="security-fields">
                  <input
                    className="input"
                    type="email"
                    placeholder="you@gmail.com"
                    value={recoveryEmailDraft}
                    onChange={(e) => setRecoveryEmailDraft(e.target.value)}
                  />
                  <button className="btn btn-secondary btn-sm" type="button" onClick={handleSendRecoveryOtp} disabled={recoverySaving}>
                    {recoverySaving ? <LoadingSpinner size="sm" label="Sending recovery code" /> : <Mail size={16} />}
                    Send Code
                  </button>
                </div>
                {recoveryHint && <div className="form-success settings-spacer-sm">{recoveryHint}</div>}
                {recoveryChallengeToken && (
                  <div className="security-fields settings-spacer-sm">
                    <input
                      className="input"
                      type="text"
                      placeholder="Enter verification code"
                      value={recoveryOtp}
                      onChange={(e) => setRecoveryOtp(e.target.value)}
                    />
                    <button className="btn btn-primary btn-sm" type="button" onClick={handleVerifyRecoveryEmail} disabled={recoveryVerifying}>
                      {recoveryVerifying ? <LoadingSpinner size="sm" label="Verifying recovery email" /> : <CheckCircle2 size={16} />}
                      Verify Email
                    </button>
                  </div>
                )}
                {user.recoveryEmailVerified && user.recoveryEmail && (
                  <div className="form-success settings-spacer-sm">
                    Verified recovery email: {user.recoveryEmail}
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'account' && (
            <div className="animate-fade">
              <div className="settings-section-header">
                <h2>Account</h2>
                <p>Manage your account access and session</p>
              </div>



              <div className="glass-card security-card">
                <h3><LogOut size={18} /> Session</h3>
                <p>Log out of your current browser session.</p>
                <button className="btn btn-secondary settings-spacer-sm" onClick={() => setShowLogoutConfirm(true)}>
                  <LogOut size={16} /> Log Out
                </button>
              </div>

              <div className="glass-card security-card">
                <h3><Monitor size={18} /> Active Sessions</h3>
                <p>Review and revoke signed-in devices connected to your account.</p>
                <div className="settings-actions-row">
                  <button className="btn btn-secondary btn-sm" onClick={loadSessions} disabled={sessionsLoading}>
                    {sessionsLoading ? <LoadingSpinner size="sm" label="Loading sessions" /> : <RefreshCw size={14} />}
                    {sessionsLoading ? 'Loading' : 'Refresh'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleRevokeOtherSessions} disabled={sessionsLoading || sessions.filter(session => !session.current).length === 0}>
                    <Shield size={14} /> Revoke Others
                  </button>
                </div>
                <div className="settings-sessions-grid">
                  {sessions.length === 0 && (
                    <p>{sessionsLoading ? 'Loading active sessions...' : 'No active sessions returned by the server.'}</p>
                  )}
                  {sessions.map(session => (
                    <div key={session.id} className="session-row">
                      <div>
                        <strong>{session.current ? 'Current session' : 'Signed-in device'}</strong>
                        <p>{session.userAgent || 'Unknown browser'} · {session.ipAddress}</p>
                        <p>Last active {new Date(session.lastActive).toLocaleString()}</p>
                      </div>
                      <button className="btn btn-danger btn-sm" onClick={() => handleRevokeSession(session.id, session.current)}>
                        <Smartphone size={14} /> Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-card security-card danger-zone">
                <h3><AlertCircle size={18} color="var(--danger)" /> Account Deletion</h3>
                <p>Account deletion is handled by the VelisMail team so that workspace data and audit history are not lost by accident. Email support from your registered admin address to request it.</p>
                <a className="btn btn-danger btn-sm settings-spacer-xs" href="mailto:support@velismail.online?subject=Account%20deletion%20request">
                  <Trash2 size={14} /> Request Account Deletion
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="logout-confirm-modal glass-card animate-scale" onClick={e => e.stopPropagation()}>
            <div className="logout-confirm-icon">
              <AlertCircle size={40} color="var(--danger)" />
            </div>
            <h3>Confirm Logout</h3>
            <p>Are you sure you want to log out of VelisMail?</p>
            <div className="logout-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleLogout}><LogOut size={16} /> Yes, Log Out</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}><CheckCircle2 size={16} />{toast.message}</div>
        </div>
      )}
    </div>
  );
}

