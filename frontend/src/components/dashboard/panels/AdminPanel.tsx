import { Crown, RefreshCcw, User, Menu, Shield, Trash2 } from 'lucide-react';
import { platformAdmin } from '../../../api/client';
import type { DashboardState } from '../types';

interface AdminPanelProps {
  state: DashboardState;
}

export default function AdminPanel({ state }: AdminPanelProps) {
  const filtered = state.adminUsers.filter(u => {
    const q = state.adminSearch.toLowerCase();
    if (q && !u.user.email.toLowerCase().includes(q) && !(u.user.displayName || '').toLowerCase().includes(q)) return false;
    if (state.adminPlanFilter !== 'all' && u.plan !== state.adminPlanFilter) return false;
    if (state.adminStatusFilter !== 'all' && u.status !== state.adminStatusFilter) return false;
    return true;
  });

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(state.adminPage, totalPages);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><Crown size={16} /> Platform Admin</h3><button className="btn btn-ghost btn-sm" onClick={() => { state.setAdminUsers(platformAdmin.getUsers()); state.showToast('Refreshed'); }}><RefreshCcw size={12} /></button></div>
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
          <option value="all">All Status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option>
        </select>
      </div>
      <div className="admin-list-header">
        <span className="text-xs text-muted admin-list-count">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
      </div>
      {paginated.map(u => (
        <div key={u.user.email} className="team-member-row" onClick={() => state.setSelectedAdminUser(u)}>
          <div className="avatar avatar-sm"><User size={14} /></div>
          <div className="team-member-info"><strong>{u.user.displayName || u.user.email}</strong><span className="text-muted">{u.user.email} · {u.user.role || 'member'}</span></div>
          <span className="badge badge-neutral">{u.plan}</span>
          <span className={`badge badge-${u.status === 'active' ? 'success' : 'danger'}`}>{u.status}</span>
          <div className="flex gap-1">
            <button className="btn btn-ghost btn-sm" title="Change role" onClick={e => { e.stopPropagation(); const roles = ['admin', 'member', 'viewer']; const idx = roles.indexOf(u.user.role || 'member'); const next = roles[(idx + 1) % roles.length]; platformAdmin.updateUserRole(u.user.email, next as 'admin' | 'member' | 'viewer'); state.setAdminUsers(platformAdmin.getUsers()); state.showToast(`Role set to ${next}`); }}><Shield size={12} /></button>
            <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); state.setAdminStatusConfirm({ record: u, status: u.status === 'active' ? 'suspended' : 'active', step: 1 }); }}>
              {u.status === 'active' ? 'Suspend' : 'Reactivate'}
            </button>
            <button className="btn btn-ghost btn-sm btn-danger" title="Delete user" onClick={e => { e.stopPropagation(); state.setConfirmAction({ title: 'Delete User', message: `Permanently delete ${u.user.email}? This cannot be undone.`, onConfirm: () => { platformAdmin.deleteUser(u.user.email); state.setAdminUsers(platformAdmin.getUsers()); state.showToast('User deleted'); } }); }}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
      {totalPages > 1 && (
        <div className="admin-pagination">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => state.setAdminPage(page - 1)}>Prev</button>
          <span className="text-xs text-muted">Page {page} of {totalPages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => state.setAdminPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
