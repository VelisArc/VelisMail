import { Link } from 'react-router-dom';
import { LogOut, Mail, Layers, Server, Globe, Inbox, Users, Shield, BarChart3, Activity, Settings, CreditCard, Crown, Plus, User, Contact as ContactIcon } from 'lucide-react';
import type { User as UserType } from '../../api/client';
import { domains } from '../../api/client';
import { BIZ_FOLDERS } from './constants';
import type { BizTab, BizFolder } from './constants';
import type { DashboardState } from './types';

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
  onProfileClick?: () => void;
  state?: DashboardState;
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
  onProfileClick,
  state,
}: SidebarProps) {
  const folderBadge = (f: BizFolder) => f.badge;

  const handleNav = (tab: BizTab) => {
    setActiveBizTab(tab);
    setSidebarOpen(false);
  };

  return (
    <>
      {sidebarOpen && <div className="dash-overlay open" onClick={() => setSidebarOpen(false)} />}

      <aside className={`dash-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="side-header">
          <Link to="/" className="side-logo" style={{ textDecoration: 'none' }}>
            <img src="/ZeeResizer.png" alt="VelisMail" />
            <div>
              <span className="side-logo-name">VelisMail</span>
              <span className="side-logo-badge">Business</span>
            </div>
          </Link>
        </div>
        {state && state.domainsList.length > 0 && (
          <div className="side-domain-select-container" style={{ padding: '4px 12px 8px 12px', borderBottom: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span className="side-section-label" style={{ padding: 0 }}>Active Domain</span>
            <select
              className="input input-sm"
              value={state.activeDomainName}
              onChange={(e) => {
                const domName = e.target.value;
                state.setActiveDomain(domName);
                const matched = state.domainsList.find(d => d.domain === domName);
                if (matched) {
                  domains.setPrimary(matched.id);
                }
                state.showToast(`Switched active domain to ${domName}`);
              }}
              style={{ fontSize: '11px', height: '28px', padding: '4px 8px', width: '100%' }}
            >
              {state.domainsList.map(dom => (
                <option key={dom.id} value={dom.domain}>
                  {dom.domain} ({dom.status})
                </option>
              ))}
            </select>
          </div>
        )}

        <button type="button" className="btn btn-primary side-compose" onClick={onCompose}>
          <Plus size={16} /> New Message
        </button>

        <nav className="side-nav">
          <Section label="Mail">
            <button
              type="button"
              className={`side-nav-btn ${activeBizTab === 'mail' ? 'active' : ''}`}
              aria-current={activeBizTab === 'mail' ? 'page' : undefined}
              onClick={() => handleNav('mail')}
            >
              <Mail size={16} /> <span>Inbox</span>
            </button>
            {activeBizTab === 'mail' && (
              <div className="side-sub-nav">
                {BIZ_FOLDERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`side-sub-btn ${activeFolder === f.id ? 'active' : ''}`}
                    aria-current={activeFolder === f.id ? 'page' : undefined}
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

          <Section label="Content">
            {hasRoleAccess('templates') && (
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'templates' ? 'active' : ''}`}
                onClick={() => handleNav('templates')}
              >
                <Layers size={16} /> <span>Templates</span>
              </button>
            )}
          </Section>

          <Section label="Operations">
            {hasRoleAccess('queue') && (
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'queue' ? 'active' : ''}`}
                onClick={() => handleNav('queue')}
              >
                <Server size={16} /> <span>Mail Queue</span>
              </button>
            )}
            {hasRoleAccess('deliverability') && (
              <button
                type="button"
                className={`side-nav-btn ${activeBizTab === 'deliverability' ? 'active' : ''}`}
                onClick={() => handleNav('deliverability')}
              >
                <Activity size={16} /> <span>Deliverability</span>
              </button>
            )}
          </Section>

          <Section label="Organization">
            {hasRoleAccess('contacts') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'contacts' ? 'active' : ''}`} onClick={() => handleNav('contacts')}>
                <ContactIcon size={16} /> <span>Contacts</span>
              </button>
            )}
            {hasRoleAccess('domains') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'domains' ? 'active' : ''}`} onClick={() => handleNav('domains')}>
                <Globe size={16} /> <span>Domains</span>
              </button>
            )}
            {hasRoleAccess('mailboxes') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'mailboxes' ? 'active' : ''}`} onClick={() => handleNav('mailboxes')}>
                <Inbox size={16} /> <span>Mailboxes</span>
              </button>
            )}
            {hasRoleAccess('groups') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'groups' ? 'active' : ''}`} onClick={() => handleNav('groups')}>
                <Users size={16} /> <span>Groups</span>
              </button>
            )}
            {hasRoleAccess('team') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'team' ? 'active' : ''}`} onClick={() => handleNav('team')}>
                <Shield size={16} /> <span>Team</span>
              </button>
            )}
          </Section>

          <Section label="Administration">
            {hasRoleAccess('analytics') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'analytics' ? 'active' : ''}`} onClick={() => handleNav('analytics')}>
                <BarChart3 size={16} /> <span>Analytics</span>
              </button>
            )}
            {hasRoleAccess('audit') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'audit' ? 'active' : ''}`} onClick={() => handleNav('audit')}>
                <Activity size={16} /> <span>Audit Log</span>
              </button>
            )}
            {hasRoleAccess('settings') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'settings' ? 'active' : ''}`} onClick={() => handleNav('settings')}>
                <Settings size={16} /> <span>Settings</span>
              </button>
            )}
            {hasRoleAccess('billing') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'billing' ? 'active' : ''}`} onClick={() => handleNav('billing')}>
                <CreditCard size={16} /> <span>Billing</span>
              </button>
            )}
            {hasRoleAccess('admin') && canAccessPlatformAdmin && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'admin' ? 'active' : ''}`} onClick={() => handleNav('admin')}>
                <Crown size={16} /> <span>Platform Admin</span>
              </button>
            )}
          </Section>
        </nav>

        <div className="side-footer">
          <div className="side-user" onClick={onProfileClick} style={{ cursor: onProfileClick ? 'pointer' : 'default' }}>
            <div className="side-avatar">
              {user?.profileImageUrl ? (
                <img src={user.profileImageUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                user?.displayName?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || <User size={14} />
              )}
            </div>
            <div className="side-user-info">
              <span className="side-user-name" title={user?.displayName || 'User'}>{user?.displayName || 'User'}</span>
              <span className="side-user-role">{user?.role || 'member'}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={e => { e.stopPropagation(); onLogout(); }} aria-label="Log out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
