import { LogOut, Mail, Layers, Server, Globe, Inbox, Users, Shield, BarChart3, Activity, Settings, CreditCard, Crown, Plus, User, Menu } from 'lucide-react';
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
  onLogout: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  hasRoleAccess: (tab: BizTab) => boolean;
  canAccessPlatformAdmin: boolean;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="side-section-label">{label}</div>
      {children}
    </>
  );
}

export default function Sidebar({
  activeBizTab,
  setActiveBizTab,
  activeFolder,
  setActiveFolder,
  onCompose,
  user,
  onLogout,
  sidebarOpen,
  setSidebarOpen,
  hasRoleAccess,
  canAccessPlatformAdmin,
}: SidebarProps) {
  const folderBadge = (f: BizFolder) => f.badge;

  const handleNav = (tab: BizTab) => {
    setActiveBizTab(tab);
    setSidebarOpen(false);
  };

  return (
    <>
      <div className="dash-mobile-header">
        <button type="button" className="dash-mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
          <Menu size={20} />
        </button>
        <div className="dash-mobile-brand">
          <img src="/ZeeResizer.png" alt="" />
          <span>VelisMail</span>
        </div>
      </div>

      {sidebarOpen && <div className="dash-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`dash-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="side-header">
          <div className="side-logo">
            <img src="/ZeeResizer.png" alt="" />
            <div>
              <span className="side-logo-name">VelisMail</span>
              <span className="side-logo-badge">Business</span>
            </div>
          </div>
        </div>

        <button type="button" className="btn btn-primary side-compose" onClick={onCompose}>
          <Plus size={16} /> New Message
        </button>

        <nav className="side-nav">
          <Section label="Mail">
            <button
              type="button"
              className={`side-nav-btn ${activeBizTab === 'mail' ? 'active' : ''}`}
              onClick={() => handleNav('mail')}
            >
              <Mail size={16} /> Inbox
            </button>
            {activeBizTab === 'mail' && (
              <div className="side-sub-nav">
                {BIZ_FOLDERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`side-sub-btn ${activeFolder === f.id ? 'active' : ''}`}
                    onClick={() => { setActiveFolder(f.id); setSidebarOpen(false); }}
                  >
                    <f.icon size={13} />
                    <span>{f.label}</span>
                    {folderBadge(f) && <span className="side-badge">{folderBadge(f)}</span>}
                  </button>
                ))}
              </div>
            )}
          </Section>

          {hasRoleAccess('templates') && (
            <Section label="Content">
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'templates' ? 'active' : ''}`}
                onClick={() => handleNav('templates')}
              >
                <Layers size={16} /> Templates
              </button>
            </Section>
          )}

          {hasRoleAccess('queue') && (
            <Section label="Operations">
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'queue' ? 'active' : ''}`}
                onClick={() => handleNav('queue')}
              >
                <Server size={16} /> Mail Queue
              </button>
            </Section>
          )}

          <Section label="Organization">
            {user?.role === 'admin' && (
              <>
                <button
                  type="button"
                  className={`side-nav-btn ${activeBizTab === 'domains' ? 'active' : ''}`}
                  onClick={() => handleNav('domains')}
                >
                  <Globe size={16} /> Domains
                </button>
                <button
                  type="button"
                  className={`side-nav-btn ${activeBizTab === 'mailboxes' ? 'active' : ''}`}
                  onClick={() => handleNav('mailboxes')}
                >
                  <Inbox size={16} /> Mailboxes
                </button>
                <button
                  type="button"
                  className={`side-nav-btn ${activeBizTab === 'groups' ? 'active' : ''}`}
                  onClick={() => handleNav('groups')}
                >
                  <Users size={16} /> Groups
                </button>
              </>
            )}
            {hasRoleAccess('team') && (
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'team' ? 'active' : ''}`}
                onClick={() => handleNav('team')}
              >
                <Shield size={16} /> Team
              </button>
            )}
          </Section>

          <Section label="Administration">
            {hasRoleAccess('analytics') && (
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'analytics' ? 'active' : ''}`}
                onClick={() => handleNav('analytics')}
              >
                <BarChart3 size={16} /> Analytics
              </button>
            )}
            {user?.role === 'admin' && (
              <>
                <button
                  type="button"
                  className={`side-nav-btn ${activeBizTab === 'audit' ? 'active' : ''}`}
                  onClick={() => handleNav('audit')}
                >
                  <Activity size={16} /> Audit Log
                </button>
                <button
                  type="button"
                  className={`side-nav-btn ${activeBizTab === 'settings' ? 'active' : ''}`}
                  onClick={() => handleNav('settings')}
                >
                  <Settings size={16} /> Settings
                </button>
                <button
                  type="button"
                  className={`side-nav-btn ${activeBizTab === 'billing' ? 'active' : ''}`}
                  onClick={() => handleNav('billing')}
                >
                  <CreditCard size={16} /> Billing
                </button>
              </>
            )}
            {canAccessPlatformAdmin && (
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'admin' ? 'active' : ''}`}
                onClick={() => handleNav('admin')}
              >
                <Crown size={16} /> Platform Admin
              </button>
            )}
          </Section>
        </nav>

        <div className="side-footer">
          <div className="side-user">
            <div className="side-avatar">{user?.email?.charAt(0).toUpperCase() || <User size={14} />}</div>
            <div className="side-user-info">
              <span className="side-user-name">{user?.displayName || 'User'}</span>
              <span className="side-user-role">{user?.role || 'member'}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onLogout} aria-label="Log out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
