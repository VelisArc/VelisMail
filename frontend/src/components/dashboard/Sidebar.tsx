import { Link } from 'react-router-dom';
import { LogOut, Mail, Layers, Server, Globe, Inbox, Users, Shield, BarChart3, Activity, Settings, CreditCard, Crown, Plus, User, Contact as ContactIcon, Building2, FileText, LifeBuoy, Flag, Gauge, Send } from 'lucide-react';
import type { User as UserType } from '../../api/client';
import { BIZ_FOLDERS } from './constants';
import type { BizTab, BizFolder } from './constants';
import type { PlatformSection } from './panels/PlatformAdminPanel';

interface SidebarProps {
  activeBizTab: BizTab;
  setActiveBizTab: (tab: BizTab) => void;
  activeFolder: string;
  setActiveFolder: (f: string) => void;
  user: UserType | null;
  onLogout: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  hasRoleAccess: (tab: BizTab) => boolean;
  /** True when the signed-in staff member is the configured platform owner. */
  isPlatformOwner?: boolean;
  viewMode: 'workspace' | 'control-plane';
  platformSection: PlatformSection;
  onPlatformSectionChange: (section: PlatformSection) => void;
  onProfileClick?: () => void;
  onCompose: () => void;
}

const PLATFORM_NAV: Array<{ group: string; items: Array<{ id: PlatformSection; label: string; icon: typeof Activity; ownerOnly?: boolean }> }> = [
  {
    group: 'Control Plane',
    items: [{ id: 'overview', label: 'Overview', icon: Gauge }],
  },
  {
    group: 'Customers',
    items: [
      { id: 'companies', label: 'Companies', icon: Building2 },
      { id: 'users', label: 'Users', icon: Users },
    ],
  },
  {
    group: 'Trust & Safety',
    items: [{ id: 'investigations', label: 'Investigations', icon: Shield }],
  },
  {
    group: 'Operations',
    items: [
      { id: 'usage', label: 'Usage & Load', icon: Activity },
      { id: 'broadcast', label: 'Broadcast', icon: Send, ownerOnly: true },
    ],
  },
  {
    group: 'Business',
    items: [
      { id: 'revenue', label: 'Revenue', icon: CreditCard },
      { id: 'support', label: 'Support', icon: LifeBuoy },
    ],
  },
  {
    group: 'Administration',
    items: [
      { id: 'team', label: 'Platform Team', icon: Crown },
      { id: 'audit', label: 'Audit Trail', icon: FileText },
      { id: 'config', label: 'Configuration', icon: Flag },
      { id: 'health', label: 'System Health', icon: Server },
    ],
  },
];

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
  user,
  onLogout,
  sidebarOpen,
  setSidebarOpen,
  hasRoleAccess,
  isPlatformOwner = false,
  viewMode,
  platformSection,
  onPlatformSectionChange,
  onProfileClick,
  onCompose,
}: SidebarProps) {
  const folderBadge = (f: BizFolder) => f.badge;
  const isControlPlane = viewMode === 'control-plane';

  const handleNav = (tab: BizTab) => {
    setActiveBizTab(tab);
    setSidebarOpen(false);
  };

  const handlePlatformNav = (section: PlatformSection) => {
    onPlatformSectionChange(section);
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
        {!isControlPlane && (
          <button type="button" className="btn btn-primary side-compose" onClick={onCompose}>
            <Plus size={16} /> New Message
          </button>
        )}

        <nav className="side-nav">
          {!isControlPlane && (
            <>
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
            {hasRoleAccess('company-admin') && (
              <button type="button" className={`side-nav-btn ${activeBizTab === 'company-admin' ? 'active' : ''}`} onClick={() => handleNav('company-admin')}>
                <Building2 size={16} /> <span>Company Admin</span>
              </button>
            )}
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
          </Section>
            </>
          )}

          {isControlPlane && (
            <>
              {PLATFORM_NAV.map((group) => {
                // Owner-only entries stay hidden for everybody else.
                const items = group.items.filter((item) => !item.ownerOnly || isPlatformOwner);
                if (items.length === 0) return null;
                return (
                  <Section key={group.group} label={group.group}>
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`side-nav-btn ${platformSection === item.id ? 'active' : ''}`}
                        aria-current={platformSection === item.id ? 'page' : undefined}
                        onClick={() => handlePlatformNav(item.id)}
                      >
                        <item.icon size={16} /> <span>{item.label}</span>
                      </button>
                    ))}
                  </Section>
                );
              })}
            </>
          )}
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
