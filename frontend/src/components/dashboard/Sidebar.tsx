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
  onShowDomain: () => void;
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
  onShowDomain,
}: SidebarProps) {
  const folderBadge = (f: BizFolder) => f.badge;

  const NavBtn = ({ tab, icon: Icon, label, onClick }: { tab?: BizTab; icon: any; label: string; onClick?: () => void }) => (
    <button
      type="button"
      className={`side-nav-btn ${tab && activeBizTab === tab ? 'active' : ''}`}
      onClick={onClick || (tab ? () => { setActiveBizTab(tab); setSidebarOpen(false); } : undefined)}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <>
      <div className="side-section-label">{label}</div>
      {children}
    </>
  );

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
            <NavBtn tab="mail" icon={Mail} label="Inbox" />
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
              <NavBtn tab="templates" icon={Layers} label="Templates" />
            </Section>
          )}

          {hasRoleAccess('queue') && (
            <Section label="Operations">
              <NavBtn tab="queue" icon={Server} label="Mail Queue" />
            </Section>
          )}

          <Section label="Organization">
            {user?.role === 'admin' && (
              <>
                <NavBtn tab="domains" icon={Globe} label="Domains" />
                <NavBtn tab="mailboxes" icon={Inbox} label="Mailboxes" />
                <NavBtn tab="groups" icon={Users} label="Groups" />
              </>
            )}
            {hasRoleAccess('team') && <NavBtn tab="team" icon={Shield} label="Team" />}
          </Section>

          <Section label="Administration">
            {hasRoleAccess('analytics') && <NavBtn tab="analytics" icon={BarChart3} label="Analytics" />}
            {user?.role === 'admin' && (
              <>
                <NavBtn tab="audit" icon={Activity} label="Audit Log" />
                <NavBtn tab="settings" icon={Settings} label="Settings" />
                <NavBtn tab="billing" icon={CreditCard} label="Billing" />
              </>
            )}
            {canAccessPlatformAdmin && <NavBtn tab="admin" icon={Crown} label="Platform Admin" />}
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
