import { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import {
  Shield, ArrowLeft, CheckCircle2, AlertCircle,
  RefreshCw, User as UserIcon, Lock, Mail, Trash2,
  Sun, Moon, LogOut, Monitor, Smartphone,
} from 'lucide-react';
import { auth, isBusinessSetupReady, type ActiveSession, type User } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import './Settings.css';

type Tab = 'profile' | 'security' | 'appearance' | 'account';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(auth.getSession());
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [profileName, setProfileName] = useState(user?.displayName || '');
  const [profileImage, setProfileImage] = useState<string | null>(user?.profileImageUrl || null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [recoveryEmailDraft, setRecoveryEmailDraft] = useState(user?.recoveryEmail || '');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryChallengeToken, setRecoveryChallengeToken] = useState('');
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const [recoverySaving, setRecoverySaving] = useState(false);
  const [recoveryVerifying, setRecoveryVerifying] = useState(false);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    const session = auth.getSession();
    if (!session) {
      navigate('/login');
      return;
    } else if (!isBusinessSetupReady(session)) {
      navigate('/business-setup');
      return;
    }
    setUser(session);
    setProfileName(session.displayName || '');
    setRecoveryEmailDraft(session.recoveryEmail || '');
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

  const handleDeleteAccount = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDeleteAccount = async () => {
    const result = await auth.deleteAccount();
    if (!result.success) {
      showToast(result.error || 'Account deactivation failed', 'error');
      setShowDeleteConfirm(false);
      return;
    }
    navigate('/login');
  };

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
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
      await auth.verifyOtp({
        email: recoveryEmailDraft.trim(),
        otp: recoveryOtp.trim(),
        challengeToken: recoveryChallengeToken,
        purpose: 'recovery_email',
      });
      const result = auth.updateSettings({
        recoveryEmail: recoveryEmailDraft.trim(),
        recoveryEmailVerified: true,
        pendingRecoveryEmail: undefined,
      });
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

  const setTheme = (theme: 'light' | 'dark' | 'system') => {
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      localStorage.removeItem('velismail_theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('velismail_theme', theme);
    }
    showToast(`Theme set to ${theme}`);
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!isBusinessSetupReady(user)) return <Navigate to="/business-setup" replace />;

  const currentTheme = localStorage.getItem('velismail_theme') || 'light';
  const primaryMailbox = user.businessMailboxAddress || user.email;

  return (
    <div className="settings-page">
      <header className="settings-header glass">
        <div className="page-container section-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="settings-header-left">
            <Link to="/business" className="btn btn-ghost btn-sm">
              <ArrowLeft size={16} /> Back to Inbox
            </Link>
            <h1>Settings</h1>
          </div>
          <div className="settings-header-right">
            <div className="user-avatar">{user.displayName?.charAt(0) || 'U'}</div>
            <span>{user.displayName}</span>
          </div>
        </div>
      </header>

      <div className="section-container">
        <div className="settings-body">
          <nav className="settings-tabs glass">
          <button className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
            <UserIcon size={18} /> Profile
          </button>
          <button className={`tab-btn ${activeTab === 'security' ? 'active' : ''}`} onClick={() => setActiveTab('security')}>
            <Lock size={18} /> Security
          </button>
          <button className={`tab-btn ${activeTab === 'appearance' ? 'active' : ''}`} onClick={() => setActiveTab('appearance')}>
            <Sun size={18} /> Appearance
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
              <form className="glass-card profile-card" onSubmit={handleProfileSave}>
                <div className="profile-row">
                  <div className="profile-avatar-lg">
                    {profileImage ? <img src={profileImage} alt="avatar" /> : (user.displayName?.charAt(0) || 'U')}
                  </div>
                  <div>
                    <h3>{user.displayName}</h3>
                    <span className="badge badge-primary">{user.plan} Plan</span>
                    <div style={{ marginTop: 8 }}>
                      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
                      <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>Upload Image</button>
                      {profileImage && <button className="btn btn-sm btn-ghost" onClick={handleRemoveImage} style={{ marginLeft: 8 }}>Remove</button>}
                    </div>
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
                {profileError && <div className="form-error" style={{ marginTop: 12 }}>{profileError}</div>}
                <button className="btn btn-primary" type="submit" style={{ marginTop: 16 }} disabled={profileSaving}>
                  {profileSaving ? <LoadingSpinner size="sm" label="Saving profile" /> : <CheckCircle2 size={16} />}
                  Save Changes
                </button>
              </form>
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
                  {securityError && <div className="form-error" style={{ marginTop: 12 }}>{securityError}</div>}
                  <button className="btn btn-primary btn-sm" type="submit" style={{ marginTop: 12 }} disabled={passwordSaving}>
                    {passwordSaving ? <LoadingSpinner size="sm" label="Updating password" /> : <CheckCircle2 size={16} />}
                    Update Password
                  </button>
                </form>
              </div>
              <div className="glass-card security-card">
                <h3><Shield size={18} /> Encryption Keys</h3>
                <p>Your encryption keys are stored locally on your device. We never have access to them.</p>
                <div className="key-info">
                  <div className="key-row">
                    <span>Key Algorithm</span><span className="badge badge-accent">AES-256-GCM</span>
                  </div>
                  <div className="key-row">
                    <span>Key Derivation</span><span className="badge badge-accent">HKDF-SHA256</span>
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
                {recoveryHint && <div className="form-success" style={{ marginTop: 12 }}>{recoveryHint}</div>}
                {recoveryChallengeToken && (
                  <div className="security-fields" style={{ marginTop: 12 }}>
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
                  <div className="form-success" style={{ marginTop: 12 }}>
                    Verified recovery email: {user.recoveryEmail}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="animate-fade">
              <div className="settings-section-header">
                <h2>Appearance</h2>
                <p>Customize how VelisMail looks on your device</p>
              </div>
              <div className="glass-card appearance-card">
                <h3><Sun size={18} /> Theme</h3>
                <p>Choose your preferred color scheme</p>
                <div className="theme-options">
                  <button
                    className={`theme-option ${currentTheme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    <Monitor size={24} />
                    <span>Light</span>
                  </button>
                  <button
                    className={`theme-option ${currentTheme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    <Moon size={24} />
                    <span>Dark</span>
                  </button>
                  <button
                    className={`theme-option ${currentTheme === 'system' ? 'active' : ''}`}
                    onClick={() => setTheme('system')}
                  >
                    <Smartphone size={24} />
                    <span>System</span>
                  </button>
                </div>
              </div>
              <div className="glass-card appearance-card">
                <h3><Sun size={18} /> Accent Color</h3>
                <p>Customize the primary color used throughout the app</p>
                <div className="accent-options">
                  {[
                    { name: 'Purple', value: '#8b5cf6' },
                    { name: 'Rose', value: '#f43f5e' },
                    { name: 'Amber', value: '#f59e0b' },
                  ].map(color => (
                    <button
                      key={color.value}
                      className="accent-option"
                      style={{ '--accent-preview': color.value } as React.CSSProperties}
                      title={color.name}
                      onClick={() => {
                        document.documentElement.style.setProperty('--primary', color.value);
                        document.documentElement.style.setProperty('--primary-400', color.value);
                        localStorage.setItem('velismail-accent', color.value);
                        showToast(`Accent color changed to ${color.name}`);
                      }}
                    />
                  ))}
                </div>
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
                <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => setShowLogoutConfirm(true)}>
                  <LogOut size={16} /> Log Out
                </button>
              </div>

              <div className="glass-card security-card">
                <h3><Monitor size={18} /> Active Sessions</h3>
                <p>Review and revoke signed-in devices connected to your account.</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button className="btn btn-secondary btn-sm" onClick={loadSessions} disabled={sessionsLoading}>
                    {sessionsLoading ? <LoadingSpinner size="sm" label="Loading sessions" /> : <RefreshCw size={14} />}
                    {sessionsLoading ? 'Loading' : 'Refresh'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleRevokeOtherSessions} disabled={sessionsLoading || sessions.filter(session => !session.current).length === 0}>
                    <Shield size={14} /> Revoke Others
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
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
                <h3><AlertCircle size={18} color="var(--danger)" /> Account Access</h3>
                <p>Deactivate your account access while retaining workspace data for administrator-assisted recovery.</p>
                <button className="btn btn-danger btn-sm" style={{ marginTop: 8 }} onClick={handleDeleteAccount}>
                  <Trash2 size={14} /> Deactivate Account
                </button>
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

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="logout-confirm-modal glass-card animate-scale" onClick={e => e.stopPropagation()}>
            <div className="logout-confirm-icon">
              <AlertCircle size={40} color="var(--danger)" />
            </div>
            <h3>Deactivate Account?</h3>
            <p>Your sign-in access will be disabled and you will be logged out. Workspace data is retained so the account can be reviewed and recovered later.</p>
            <div className="logout-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDeleteAccount}><Trash2 size={16} /> Deactivate</button>
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
