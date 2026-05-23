import { useMemo } from 'react';
import { Shield, Plus, Menu, User, KeyRound, X } from 'lucide-react';
import { businessTeam } from '../../../api/client';
import type { DashboardState } from '../types';

interface TeamPanelProps {
  state: DashboardState;
}

export default function TeamPanel({ state }: TeamPanelProps) {
  const displayTeam = useMemo(() => {
    if (state.teamFilter === 'all') return state.teamMembers;
    return state.teamMembers.filter(m => m.role === state.teamFilter);
  }, [state.teamMembers, state.teamFilter]);

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><Shield size={16} /> Team Access</h3><button className="btn btn-primary btn-sm" onClick={() => state.setInviteOpen(true)}><Plus size={12} /> Invite Member</button></div>
      <div className="flex gap-2 panel-section">
        {['all', 'admin', 'member', 'viewer'].map(f => (
          <button key={f} className={`btn btn-sm ${state.teamFilter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => state.setTeamFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {displayTeam.map(m => (
        <div key={m.email} className="team-member-row">
          <div className="avatar avatar-sm"><User size={14} /></div>
          <div className="team-member-info"><strong>{m.name || m.email}</strong><span className="text-muted">{m.email}</span></div>
          <select className="input input-auto" value={m.role} onChange={e => {
            if (e.target.value !== m.role) state.setPendingRoleChange({ id: m.email, role: e.target.value, step: 1 });
          }}>
            <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
          </select>
          {m.apiKey && <button className="btn btn-ghost btn-sm" onClick={() => { state.copyToClipboard(m.apiKey!); state.showToast('API key copied'); }}><KeyRound size={12} /></button>}
          <button className="btn btn-ghost btn-sm btn-danger" onClick={() => {
            if (confirm(`Remove ${m.email}?`)) { businessTeam.remove(m.email); state.refreshTeam(); state.showToast('Member removed'); }
          }}><X size={12} /></button>
        </div>
      ))}
      <div className="roles-info-detailed">
        <h4 className="roles-info-title">Role Permissions</h4>
        <table className="roles-permission-table">
          <thead>
            <tr><th>Feature</th><th>Admin</th><th>Member</th><th>Viewer</th></tr>
          </thead>
          <tbody>
            <tr><td>Send & Read Mail</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td></tr>
            <tr><td>Manage Templates</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-neutral">—</span></td></tr>
            <tr><td>Queue Monitoring</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td></tr>
            <tr><td>Domain Management</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-neutral">—</span></td><td><span className="badge badge-neutral">—</span></td></tr>
            <tr><td>Mailbox Management</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-neutral">—</span></td><td><span className="badge badge-neutral">—</span></td></tr>
            <tr><td>Team Management</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-neutral">—</span></td><td><span className="badge badge-neutral">—</span></td></tr>
            <tr><td>Analytics</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td></tr>
            <tr><td>Billing</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-neutral">—</span></td><td><span className="badge badge-neutral">—</span></td></tr>
            <tr><td>Settings</td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-success">✓</span></td><td><span className="badge badge-neutral">—</span></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
