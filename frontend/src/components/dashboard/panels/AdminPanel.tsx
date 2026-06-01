import { useState } from 'react';
import { Activity, AlertTriangle, Crown, CreditCard, Database, LockKeyhole, Mail, Menu, RefreshCcw, Shield, ShieldCheck, Trash2, User, Users } from 'lucide-react';
import { platformAdmin } from '../../../api/client';
import type { DashboardState } from '../types';

interface AdminPanelProps {
  state: DashboardState;
}

const normalizeEmail = (value = '') => value.trim().toLowerCase();

type PendingAdminAction = {
  title: string;
  message: string;
  confirmLabel: string;
  success: string;
  tone: 'primary' | 'danger';
  step: number;
  action: () => void;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function AdminPanel({ state }: AdminPanelProps) {
  const [pendingAdminAction, setPendingAdminAction] = useState<PendingAdminAction | null>(null);
  const refresh = () => state.setAdminUsers(platformAdmin.getUsers());
  const planOptions = ['Free', 'Starter', 'Business', 'Enterprise'];
  const selfEmail = normalizeEmail(state.user?.email || '');
  const ownerDomain = platformAdmin.ownerDomain;

  const filtered = state.adminUsers.filter(u => {
    const q = state.adminSearch.toLowerCase();
    const plan = (u.plan || 'Free').toLowerCase();
    if (q && !u.user.email.toLowerCase().includes(q) && !(u.user.displayName || '').toLowerCase().includes(q)) return false;
    if (state.adminPlanFilter !== 'all' && plan !== state.adminPlanFilter) return false;
    if (state.adminStatusFilter !== 'all' && u.status !== state.adminStatusFilter) return false;
    if (state.adminRiskFilter !== 'all' && u.risk !== state.adminRiskFilter) return false;
    return true;
  });

  const totals = {
    users: state.adminUsers.length,
    active: state.adminUsers.filter(u => u.status === 'active').length,
    admins: state.adminUsers.filter(u => u.user.isPlatformAdmin).length,
    paid: state.adminUsers.filter(u => (u.plan || 'Free').toLowerCase() !== 'free').length,
    mailboxes: state.adminUsers.reduce((sum, u) => sum + u.mailboxCount, 0),
    storage: state.adminUsers.reduce((sum, u) => sum + u.storageEstimateBytes, 0),
  };

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(state.adminPage, totalPages);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const queueAdminAction = (action: Omit<PendingAdminAction, 'step'>) => {
    setPendingAdminAction({ ...action, step: 1 });
  };

  const confirmPendingAction = () => {
    if (!pendingAdminAction) return;
    if (pendingAdminAction.step === 1) {
      setPendingAdminAction({ ...pendingAdminAction, step: 2 });
      return;
    }
    try {
      pendingAdminAction.action();
      refresh();
      state.showToast(pendingAdminAction.success);
    } catch (error) {
      state.showToast(error instanceof Error ? error.message : 'Admin action failed', 'error');
    } finally {
      setPendingAdminAction(null);
    }
  };

  return (
    <div className="dash-panel">
      <div className="panel-header">
        <button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button>
        <h3><Crown size={16} /> Platform Admin</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => { refresh(); state.showToast('Refreshed'); }}><RefreshCcw size={12} /> Refresh</button>
      </div>

      <div className="admin-owner-lock">
        <LockKeyhole size={16} />
        <div>
          <strong>Platform-domain console</strong>
          <span>Only @{ownerDomain} accounts can open Platform Admin. All admin changes require two confirmations.</span>
        </div>
      </div>

      <div className="admin-command-grid">
        {[
          { label: 'Users', value: totals.users, icon: Users },
          { label: 'Active', value: totals.active, icon: Activity },
          { label: 'Platform Admins', value: totals.admins, icon: ShieldCheck },
          { label: 'Paid Plans', value: totals.paid, icon: CreditCard },
          { label: 'Mailboxes', value: totals.mailboxes, icon: Mail },
          { label: 'Storage', value: formatBytes(totals.storage), icon: Database },
        ].map(item => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="admin-command-card">
              <Icon size={16} />
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>

      <div className="admin-controls-bar">
        <input className="input input-max-250" placeholder="Search users..." value={state.adminSearch} onChange={e => { state.setAdminSearch(e.target.value); state.setAdminPage(1); }} />
        <select className="input input-auto" value={state.adminPlanFilter} onChange={e => { state.setAdminPlanFilter(e.target.value); state.setAdminPage(1); }}>
          <option value="all">All Plans</option><option value="free">Free</option><option value="starter">Starter</option><option value="business">Business</option><option value="enterprise">Enterprise</option>
        </select>
        <select className="input input-auto" value={state.adminStatusFilter} onChange={e => { state.setAdminStatusFilter(e.target.value); state.setAdminPage(1); }}>
          <option value="all">All Status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deactivated">Deactivated</option>
        </select>
        <select className="input input-auto" value={state.adminRiskFilter} onChange={e => { state.setAdminRiskFilter(e.target.value); state.setAdminPage(1); }}>
          <option value="all">All Risk</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
      </div>

      <div className="admin-list-header">
        <span className="text-xs text-muted admin-list-count">{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {paginated.map(u => {
        const isSelf = normalizeEmail(u.user.email) === selfEmail;
        const isPlatformDomain = platformAdmin.isOwnerEmail(u.user.email);
        const riskBadge = u.risk === 'high' ? 'danger' : u.risk === 'medium' ? 'neutral' : 'success';
        return (
          <div key={u.user.email} className="team-member-row admin-user-row" onClick={() => state.setSelectedAdminUser(u)}>
            <div className="avatar avatar-sm"><User size={14} /></div>
            <div className="team-member-info admin-user-info">
              <strong>{u.user.displayName || u.user.email}</strong>
              <span className="text-muted">{u.user.email} - {u.domain || 'no domain'}</span>
              <div className="admin-user-metrics">
                <span><Mail size={12} /> {u.emailCount} mail</span>
                <span><Database size={12} /> {formatBytes(u.storageEstimateBytes)}</span>
                <span><Users size={12} /> {u.teamMemberCount} team</span>
              </div>
            </div>

            <span className={`badge badge-${u.status === 'active' ? 'success' : 'danger'}`}>{u.status}</span>
            <span className={`badge badge-${riskBadge}`}>{u.risk} risk</span>
            {isPlatformDomain && <span className="badge badge-primary">platform</span>}

            <div className="admin-row-actions" onClick={e => e.stopPropagation()}>
              <select className="admin-mini-select" value={u.user.role || 'member'} disabled={isPlatformDomain} onChange={e => {
                const nextRole = e.target.value as 'admin' | 'member' | 'viewer';
                queueAdminAction({
                  title: 'Review Role Change',
                  message: `Change ${u.user.email} from ${u.user.role || 'member'} to ${nextRole}?`,
                  confirmLabel: 'Apply Role',
                  success: `Role set to ${nextRole}`,
                  tone: 'primary',
                  action: () => { platformAdmin.updateUserRole(u.user.email, nextRole); },
                });
              }}>
                <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
              </select>
              <select className="admin-mini-select" value={u.plan || 'Free'} onChange={e => {
                const nextPlan = e.target.value;
                queueAdminAction({
                  title: 'Review Plan Change',
                  message: `Change ${u.user.email} from ${u.plan || 'Free'} to ${nextPlan}? Billing and limits can be affected.`,
                  confirmLabel: 'Apply Plan',
                  success: `Plan set to ${nextPlan}`,
                  tone: 'primary',
                  action: () => { platformAdmin.updateUserPlan(u.user.email, nextPlan, u.billingCycle); },
                });
              }}>
                {planOptions.map(plan => <option key={plan} value={plan}>{plan}</option>)}
              </select>
              <select className="admin-mini-select" value={u.billingCycle} onChange={e => {
                const nextCycle = e.target.value as 'monthly' | 'annual';
                queueAdminAction({
                  title: 'Review Billing Cycle',
                  message: `Change ${u.user.email} billing cycle from ${u.billingCycle} to ${nextCycle}?`,
                  confirmLabel: 'Apply Billing',
                  success: `Billing set to ${nextCycle}`,
                  tone: 'primary',
                  action: () => { platformAdmin.updateUserPlan(u.user.email, u.plan || 'Free', nextCycle); },
                });
              }}>
                <option value="monthly">Monthly</option><option value="annual">Annual</option>
              </select>
              <button className="btn btn-ghost btn-sm" disabled={isPlatformDomain} onClick={() => {
                const nextStatus = u.status === 'active' ? 'suspended' : 'active';
                queueAdminAction({
                  title: 'Review Status Change',
                  message: `${nextStatus === 'suspended' ? 'Suspend' : 'Reactivate'} ${u.user.email}? This affects login and workspace access.`,
                  confirmLabel: nextStatus === 'suspended' ? 'Confirm Suspend' : 'Confirm Reactivate',
                  success: `User ${nextStatus}`,
                  tone: nextStatus === 'suspended' ? 'danger' : 'primary',
                  action: () => { platformAdmin.updateUserStatus(u.user.email, nextStatus); },
                });
              }}>
                <Shield size={12} /> {u.status === 'active' ? 'Suspend' : 'Reactivate'}
              </button>
              <button className="btn btn-ghost btn-sm btn-danger" title={isSelf || isPlatformDomain ? 'Protected platform/current admin account' : 'Delete user'} disabled={isSelf || isPlatformDomain} onClick={() => {
                queueAdminAction({
                  title: 'Review User Deletion',
                  message: `Permanently delete ${u.user.email}? This cannot be undone.`,
                  confirmLabel: 'Delete User',
                  success: 'User deleted',
                  tone: 'danger',
                  action: () => { platformAdmin.deleteUser(u.user.email); },
                });
              }}><Trash2 size={12} /></button>
            </div>
          </div>
        );
      })}

      {paginated.length === 0 && (
        <div className="empty-state admin-empty-state">
          <ShieldCheck size={42} className="text-muted" />
          <h3>No users match these filters</h3>
          <p className="text-muted">Clear filters or refresh the platform directory.</p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="admin-pagination">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => state.setAdminPage(page - 1)}>Prev</button>
          <span className="text-xs text-muted">Page {page} of {totalPages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => state.setAdminPage(page + 1)}>Next</button>
        </div>
      )}

      {pendingAdminAction && (
        <div className="modal-overlay" onClick={() => setPendingAdminAction(null)} role="dialog" aria-modal="true" aria-label="Confirm admin action">
          <div className="biz-form-modal glass animate-scale admin-status-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-body-center">
              <div className={pendingAdminAction.tone === 'danger' ? 'modal-icon-danger' : 'modal-icon-warning'}>
                <AlertTriangle size={24} />
              </div>
              <h3 className="admin-status-title">
                {pendingAdminAction.step === 1 ? pendingAdminAction.title : 'Final Confirmation'}
              </h3>
              <p className="text-sm text-muted">
                {pendingAdminAction.step === 1 ? pendingAdminAction.message : 'This is the second confirmation. Apply this Platform Admin change now?'}
              </p>
            </div>
            <div className="modal-actions-border">
              <button className="btn btn-ghost" onClick={() => setPendingAdminAction(null)}>Cancel</button>
              <button className={pendingAdminAction.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'} onClick={confirmPendingAction}>
                {pendingAdminAction.step === 1 ? 'Continue' : pendingAdminAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
