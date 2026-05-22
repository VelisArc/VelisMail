import { LogOut, Mail, Layers, Server, Globe, Inbox, Users, Shield, BarChart3, Activity, Settings, CreditCard, Crown, Plus, Sun, Moon, User } from 'lucide-react';
import type { User as UserType } from '../../api/client';
import { BIZ_FOLDERS } from './constants';
import type { BizTab, BizFolder } from './constants';

interface SidebarProps {
  activeBizTab: BizTab;
  setActiveBizTab: (tab: BizTab) => void;
  activeFolder: string;
  setActiveFolder: (f: string) => void;
  onCompose: () => void;
  user: UserType | null;
  themeMode: string;
  toggleTheme: () => void;
  onLogout: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  hasRoleAccess: (tab: BizTab) => boolean;
  canAccessPlatformAdmin: boolean;
  onShowDomain: () => void;
}

export default function Sidebar({
  activeBizTab,
  setActiveBizTab,
  activeFolder,
  setActiveFolder,
  onCompose,
  user,
  themeMode,
  toggleTheme,
  onLogout,
  sidebarOpen,
  setSidebarOpen,
  hasRoleAccess,
  canAccessPlatformAdmin,
  onShowDomain,
}: SidebarProps) {
  const folderBadge = (f: BizFolder) => {
    if (!f.badge) return undefined;
    return f.badge;
  };

  return (
    <>
      {sidebarOpen && (
        <div className="dash-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`biz-sidebar glass ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="dash-brand">
          <div className="nav-logo">
            <img src="/ZeeResizer.png" alt="" className="logo-img" />
            <span className="logo-text">VelisMail</span>
          </div>
          <span className="badge badge-neutral">Business</span>
        </div>

        <button type="button" className="btn btn-primary compose-btn" onClick={onCompose}>
          <Plus size={16} /> Compose
        </button>

        <nav className="sidebar-folders">
          <div className="sidebar-section-lbl">Management</div>
          {user?.role === 'admin' && (
            <button
              type="button"
              className={`folder-btn ${activeBizTab === 'domains' ? 'active' : ''}`}
              onClick={() => { onShowDomain(); setSidebarOpen(false); }}
            >
              <Plus size={14} /> Add Domain
            </button>
          )}

          <div className="sidebar-section-lbl">Mail &amp; Communications</div>
          <button
            type="button"
            className={`folder-btn ${activeBizTab === 'mail' ? 'active' : ''}`}
            onClick={() => { setActiveBizTab('mail'); setSidebarOpen(false); }}
          >
            <Mail size={14} /> Mailbox
          </button>

          {activeBizTab === 'mail' && (
            <div className="sidebar-sub-folders">
              {BIZ_FOLDERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`folder-btn sub ${activeFolder === f.id ? 'active' : ''}`}
                  onClick={() => { setActiveFolder(f.id); setSidebarOpen(false); }}
                >
                  <f.icon size={12} /> {f.label}
                  {folderBadge(f) && <span className="folder-badge">{folderBadge(f)}</span>}
                </button>
              ))}
            </div>
          )}

          {hasRoleAccess('templates') && (
            <button
              type="button"
              className={`folder-btn ${activeBizTab === 'templates' ? 'active' : ''}`}
              onClick={() => { setActiveBizTab('templates'); setSidebarOpen(false); }}
            >
              <Layers size={14} /> Templates
            </button>
          )}

          {hasRoleAccess('queue') && (
            <button
              type="button"
              className={`folder-btn ${activeBizTab === 'queue' ? 'active' : ''}`}
              onClick={() => { setActiveBizTab('queue'); setSidebarOpen(false); }}
            >
              <Server size={14} /> Mail Queue
            </button>
          )}

          <div className="sidebar-section-lbl">Organization</div>

          {user?.role === 'admin' && (
            <>
              <button
                type="button"
                className={`folder-btn ${activeBizTab === 'domains' ? 'active' : ''}`}
                onClick={() => { setActiveBizTab('domains'); setSidebarOpen(false); }}
              >
                <Globe size={14} /> Domains
              </button>
              <button
                type="button"
                className={`folder-btn ${activeBizTab === 'mailboxes' ? 'active' : ''}`}
                onClick={() => { setActiveBizTab('mailboxes'); setSidebarOpen(false); }}
              >
                <Inbox size={14} /> Business Mailboxes
              </button>
              <button
                type="button"
                className={`folder-btn ${activeBizTab === 'groups' ? 'active' : ''}`}
                onClick={() => { setActiveBizTab('groups'); setSidebarOpen(false); }}
              >
                <Users size={14} /> Groups
              </button>
            </>
          )}

          {hasRoleAccess('team') && (
            <button
              type="button"
              className={`folder-btn ${activeBizTab === 'team' ? 'active' : ''}`}
              onClick={() => { setActiveBizTab('team'); setSidebarOpen(false); }}
            >
              <Shield size={14} /> Team Access
            </button>
          )}

          <div className="sidebar-section-lbl">Administration</div>

          {hasRoleAccess('analytics') && (
            <button
              type="button"
              className={`folder-btn ${activeBizTab === 'analytics' ? 'active' : ''}`}
              onClick={() => { setActiveBizTab('analytics'); setSidebarOpen(false); }}
            >
              <BarChart3 size={14} /> Analytics
            </button>
          )}

          {user?.role === 'admin' && (
            <>
              <button
                type="button"
                className={`folder-btn ${activeBizTab === 'audit' ? 'active' : ''}`}
                onClick={() => { setActiveBizTab('audit'); setSidebarOpen(false); }}
              >
                <Activity size={14} /> Audit Log
              </button>
              <button
                type="button"
                className={`folder-btn ${activeBizTab === 'settings' ? 'active' : ''}`}
                onClick={() => { setActiveBizTab('settings'); setSidebarOpen(false); }}
              >
                <Settings size={14} /> Settings
              </button>
              <button
                type="button"
                className={`folder-btn ${activeBizTab === 'billing' ? 'active' : ''}`}
                onClick={() => { setActiveBizTab('billing'); setSidebarOpen(false); }}
              >
                <CreditCard size={14} /> Billing &amp; Premium
              </button>
            </>
          )}

          {canAccessPlatformAdmin && (
            <button
              type="button"
              className={`folder-btn ${activeBizTab === 'admin' ? 'active' : ''}`}
              onClick={() => { setActiveBizTab('admin'); setSidebarOpen(false); }}
            >
              <Crown size={14} /> Platform Admin
            </button>
          )}
        </nav>

        <div className="sidebar-bottom">
          <button type="button" className="btn btn-ghost btn-sm sidebar-theme-btn" onClick={toggleTheme}>
            {themeMode === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {themeMode === 'dark' ? 'Light' : 'Dark'}
          </button>
          <div className="sidebar-user-info">
            <div className="avatar avatar-sm">
              {user?.email?.charAt(0).toUpperCase() || <User size={14} />}
            </div>
            <div className="sidebar-user-text">
              <span className="sidebar-user-name">{user?.displayName || 'User'}</span>
              <span className="sidebar-user-role">{user?.role || 'member'}</span>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon sidebar-logout" onClick={onLogout} aria-label="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
}
