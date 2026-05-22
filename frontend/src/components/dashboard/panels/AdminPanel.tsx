import { Crown, RefreshCcw, User, Menu } from 'lucide-react';
import type { DashboardState } from '../types';

interface AdminPanelProps {
  state: DashboardState;
}

export default function AdminPanel({ state }: AdminPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><Crown size={18} /> Platform Admin</h3><button className="btn btn-ghost btn-sm" onClick={state.refreshQueue}><RefreshCcw size={14} /></button></div>
      <div className="admin-grid-4">
        {[ { label: 'Total Users', value: state.adminUsers.length }, { label: 'Active', value: state.adminUsers.filter(u => u.status === 'active').length }, { label: 'Suspended', value: state.adminUsers.filter(u => u.status === 'suspended').length }, { label: 'Paid Plans', value: state.adminUsers.filter(u => u.plan !== 'free').length }].map(s => (
          <div key={s.label} className="glass-card admin-stat"><strong className="queue-stat-value">{s.value}</strong><span className="text-muted text-sm">{s.label}</span></div>
        ))}
      </div>
      <div className="admin-controls-bar">
        <input className="input input-max-250" placeholder="Search users..." value={state.adminSearch} onChange={e => state.setAdminSearch(e.target.value)} />
        <select className="input input-auto" value={state.adminPlanFilter} onChange={e => state.setAdminPlanFilter(e.target.value)}>
          <option value="all">All Plans</option><option value="free">Free</option><option value="starter">Starter</option><option value="business">Business</option><option value="enterprise">Enterprise</option>
        </select>
        <select className="input input-auto" value={state.adminStatusFilter} onChange={e => state.setAdminStatusFilter(e.target.value)}>
          <option value="all">All Status</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </select>
      </div>
      {state.adminUsers.map(u => (
        <div key={u.email} className="team-member-row" onClick={() => state.setSelectedAdminUser(u)}>
          <div className="avatar avatar-sm"><User size={14} /></div>
          <div className="team-member-info"><strong>{u.businessName || u.email}</strong><span className="text-muted">{u.email} · {u.role}</span></div>
          <span className="badge badge-neutral">{u.plan}</span>
          <span className={`badge badge-${u.status === 'active' ? 'success' : 'danger'}`}>{u.status}</span>
          <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); state.setAdminStatusConfirm({ record: u, status: u.status === 'active' ? 'suspended' : 'active', step: 1 }); }}>
            {u.status === 'active' ? 'Suspend' : 'Reactivate'}
          </button>
        </div>
      ))}
    </div>
  );
}
