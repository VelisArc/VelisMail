import { useMemo, useState } from 'react';
import { Shield, Plus, Menu, User, X } from 'lucide-react';
import { ROLE_ALLOWED_TABS } from '../constants';
import type { DashboardState } from '../types';

interface TeamPanelProps {
  state: DashboardState;
}

/**
 * The features of the console that every role can reach.
 *
 * The table is built from the same list the sidebar uses, so a role can never
 * be described as more powerful than it is.
 */
const PERMISSION_ROWS: { label: string; tab: string }[] = [
  { label: 'Send & Read Mail', tab: 'mail' },
  { label: 'Manage Templates', tab: 'templates' },
  { label: 'Queue Monitoring', tab: 'queue' },
  { label: 'Domain Management', tab: 'domains' },
  { label: 'Mailbox Management', tab: 'mailboxes' },
  { label: 'Distribution Groups', tab: 'groups' },
  { label: 'Team Management', tab: 'team' },
  { label: 'Analytics', tab: 'analytics' },
  { label: 'Audit Log', tab: 'audit' },
  { label: 'Billing', tab: 'billing' },
  { label: 'Settings', tab: 'settings' },
];

export default function TeamPanel({ state }: TeamPanelProps) {
  const [removing, setRemoving] = useState('');
  const displayTeam = useMemo(() => {
    if (state.teamFilter === 'all') return state.teamMembers;
    return state.teamMembers.filter(m => m.role === state.teamFilter);
  }, [state.teamMembers, state.teamFilter]);

  const handleRemove = async (email: string) => {
    if (!confirm(`Remove ${email} and revoke access?`)) return;
    setRemoving(email);
    try {
      // The member is removed in the database of the company, so the change
      // is real and survives a refresh.
      await state.removeTeamMember(email);
      state.showToast('Member removed and access revoked');
    } catch (error) {
      state.showToast(
        error instanceof Error ? error.message : 'Unable to remove the member.',
        'error',
      );
    } finally {
      setRemoving('');
    }
  };

  const can = (role: string, tab: string) =>
    (ROLE_ALLOWED_TABS[role] || []).includes(tab as never);

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><Shield size={16} /> Team Access</h3><button className="btn btn-primary btn-sm" onClick={() => state.setInviteOpen(true)}><Plus size={12} /> Invite Member</button></div>
      <div className="flex gap-2 panel-section">
        {['all', 'admin', 'member', 'viewer'].map(f => (
          <button key={f} className={`btn btn-sm ${state.teamFilter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => state.setTeamFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {displayTeam.length === 0 && (
        <div className="empty-state"><User size={48} className="text-muted" /><h3>No team members</h3><p className="text-muted">Invite a member to share the workspace.</p></div>
      )}
      {displayTeam.map(m => (
        <div key={m.email} className="team-member-row">
          <div className="avatar avatar-sm"><User size={14} /></div>
          <div className="team-member-info"><strong>{m.name || m.email}</strong><span className="text-muted">{m.email}</span></div>
          <select className="input input-auto" value={m.role} onChange={e => {
            if (e.target.value !== m.role) state.setPendingRoleChange({ id: m.email, role: e.target.value, step: 1 });
          }}>
            <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
          </select>
          <button className="btn btn-ghost btn-sm btn-danger" disabled={removing === m.email} onClick={() => void handleRemove(m.email)}><X size={12} /> Revoke</button>
        </div>
      ))}
      <div className="roles-info-detailed">
        <h4 className="roles-info-title">Role Permissions</h4>
        <table className="roles-permission-table">
          <thead>
            <tr><th>Feature</th><th>Admin</th><th>Member</th><th>Viewer</th></tr>
          </thead>
          <tbody>
            {PERMISSION_ROWS.map(row => (
              <tr key={row.label}>
                <td>{row.label}</td>
                {['admin', 'member', 'viewer'].map(role => (
                  <td key={role}>
                    <span className={`badge ${can(role, row.tab) ? 'badge-success' : 'badge-neutral'}`}>
                      {can(role, row.tab) ? '✓' : '—'}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
