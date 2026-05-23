import { X, UserCheck, CheckCircle2, Copy, Shield, AlertTriangle, LogOut, Mail, Send, Globe, Users, Layers, Check, AlertCircle, RefreshCcw } from 'lucide-react';
import Composer from '../Composer';
import type { DashboardState } from './types';
import { formatRelative, copyToClipboard, providerRecordType } from './utils';
import { businessTemplates, platformAdmin, teamAccess } from '../../api/client';

interface ModalsProps {
  state: DashboardState;
  handleVerifyDomain: (id: string) => void;
  confirmRoleChangeStep: () => void;
}

function ComposeModal({ state }: { state: DashboardState }) {
  return (
    <div className="modal-overlay" onClick={() => state.setComposeOpen(false)}>
      <div className="compose-modal compose-modal-fixed" onClick={e => e.stopPropagation()}>
        <Composer
          initialTo={state.composeTo}
          initialSubject={state.composeSubject}
          initialBody={state.composeBody}
          fromControl={
            <select className="input input-auto" value={state.selectedFromAddress} onChange={e => state.setSelectedFromAddress(e.target.value)}>
              <option value="">Default</option>
              {state.domainMailboxes.map(m => <option key={m.address} value={m.address}>{m.address}</option>)}
            </select>
          }
          onSend={(to, subject, body) => {
            state.setComposeTo(to);
            state.setComposeSubject(subject);
            state.setComposeBody(body);
            state.handleSendEmail();
          }}
          onClose={() => state.setComposeOpen(false)}
          sending={state.sending}
        />
      </div>
    </div>
  );
}

function InviteModal({ state }: { state: DashboardState }) {
  return (
    <div className="modal-overlay" onClick={() => { state.setInviteOpen(false); }}>
      <div className="biz-form-modal glass" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><UserCheck size={16} /> Invite Team Member</h3><button className="btn btn-ghost btn-icon" onClick={() => { state.setInviteOpen(false); }}><X size={18} /></button></div>
        {!state.issuedInvite ? (
          <div className="invite-form">
            <input className="input" placeholder="Full name" value={state.inviteName} onChange={e => state.setInviteName(e.target.value)} />
            <input className="input" placeholder="Email address" type="email" value={state.inviteEmail} onChange={e => state.setInviteEmail(e.target.value)} />
            <select className="input" value={state.inviteRole} onChange={e => state.setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}>
              <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
            </select>
            <select className="input" value={state.inviteExpiresHours} onChange={e => state.setInviteExpiresHours(Number(e.target.value))}>
              <option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option>
            </select>
            <button className="btn btn-primary" onClick={async () => { try { const invite = await teamAccess.createInvite({ issuer: state.user!, name: state.inviteName, email: state.inviteEmail, role: state.inviteRole, expiresInHours: state.inviteExpiresHours }); state.setIssuedInvite(invite); state.showToast('Invite created'); } catch { state.showToast('Failed to create invite', 'error'); } }}>Generate Invite</button>
          </div>
        ) : (
          <div className="invite-success">
            <CheckCircle2 size={40} className="text-success invite-success-icon" />
            <p className="text-sm">Share this link with your team member:</p>
            <div className="invite-link-row">
              <input className="input" readOnly value={state.issuedInvite!.token} onClick={e => (e.target as HTMLInputElement).select()} />
              <button className="btn btn-primary btn-sm" onClick={() => { copyToClipboard(state.issuedInvite!.token); state.showToast('Copied'); }}><Copy size={14} /></button>
            </div>
            <p className="text-xs text-muted invite-expiry">Expires in {state.inviteExpiresHours} hours</p>
            <button className="btn btn-ghost btn-sm invite-done-btn" onClick={() => { state.setIssuedInvite(null); state.setInviteOpen(false); }}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateEditorModal({ state }: { state: DashboardState }) {
  return (
    <div className="modal-overlay" onClick={() => state.setTemplateEditorOpen(false)}>
      <div className="biz-form-modal glass" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Layers size={16} /> {state.previewTemplate ? 'Template Preview' : (state.templateName ? 'Edit Template' : 'New Template')}</h3><button className="btn btn-ghost btn-icon" onClick={() => { state.setTemplateEditorOpen(false); state.setPreviewTemplate(null); }}><X size={18} /></button></div>
        {state.previewTemplate ? (
          <div className="template-preview-body"><h4>{state.previewTemplate.name}</h4><p className="text-sm text-muted">{state.previewTemplate.subject}</p><div className="reader-body template-preview-content">{state.previewTemplate.body}</div></div>
        ) : (
          <div className="template-editor-form">
            <input className="input" placeholder="Template name" value={state.templateName} onChange={e => state.setTemplateName(e.target.value)} />
            <input className="input" placeholder="Subject line" value={state.templateSubject} onChange={e => state.setTemplateSubject(e.target.value)} />
            <textarea className="input" rows={8} placeholder="Email body..." value={state.templateBody} onChange={e => state.setTemplateBody(e.target.value)} />
            <button className="btn btn-primary" onClick={() => { const all = businessTemplates.getAll(); const newTemplate = { id: 'tpl_' + Math.random().toString(36).slice(2, 8), name: state.templateName, subject: state.templateSubject, body: state.templateBody, usageCount: 0 }; all.unshift(newTemplate); businessTemplates.save(all); state.refreshTemplates(); state.setTemplateEditorOpen(false); state.showToast('Template saved'); }}>Save Template</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminUserModal({ state }: { state: DashboardState }) {
  if (!state.selectedAdminUser) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setSelectedAdminUser(null)}>
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><UserCheck size={16} /> {state.selectedAdminUser.user.displayName || state.selectedAdminUser.user.email}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setSelectedAdminUser(null)}><X size={18} /></button></div>
        <div className="detail-grid-2">
          {Object.entries({ Email: state.selectedAdminUser.user.email, Role: state.selectedAdminUser.user.role || 'member', Plan: state.selectedAdminUser.plan, Status: state.selectedAdminUser.status, Domain: state.selectedAdminUser.domain, Created: formatRelative(state.selectedAdminUser.createdAt) }).map(([k, v]) => (
            <div key={k}><span className="text-xs text-muted">{k}</span><strong className="text-sm text-block">{v}</strong></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DomainDetailsModal({ state, handleVerifyDomain }: { state: DashboardState; handleVerifyDomain: (id: string) => void }) {
  if (!state.domainDetails) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setDomainDetails(null)}>
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Globe size={16} /> {state.domainDetails.domain}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setDomainDetails(null)}><X size={18} /></button></div>
        <div className="detail-grid-2">
          <div><span className="text-xs text-muted">Status</span><strong className="text-sm text-block">{state.domainDetails.status}</strong></div>
          <div><span className="text-xs text-muted">Reputation</span><strong className="text-sm text-block">{state.domainDetails.reputation}/100</strong></div>
          <div><span className="text-xs text-muted">Sent</span><strong className="text-sm text-block">{state.domainDetails.mailCount}</strong></div>
          <div><span className="text-xs text-muted">Added</span><strong className="text-sm text-block">{formatRelative(state.domainDetails.addedAt)}</strong></div>
        </div>
        <div className="px-20 py-20">
          {state.domainDetails.health.map(h => (
            <div key={h.key} className="flex items-center gap-2 health-row">
              <Shield size={14} />
              <div className="health-row-info"><strong className="text-sm">{h.label}</strong><span className="text-xs text-muted"> {h.detail}</span></div>
              <span className={`badge badge-${h.status === 'verified' ? 'success' : 'neutral'}`}>{h.status}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-20 py-20">
          <button className="btn btn-ghost btn-sm" onClick={() => { copyToClipboard(state.domainDetails!.domain); state.showToast('Copied'); }}><Copy size={14} /> Copy Domain</button>
          <button className="btn btn-primary btn-sm" onClick={() => handleVerifyDomain(state.domainDetails!.id)}><RefreshCcw size={14} /> Verify</button>
        </div>
      </div>
    </div>
  );
}

function MailboxDetailsModal({ state }: { state: DashboardState }) {
  if (!state.mailboxDetails) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setMailboxDetails(null)}>
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Mail size={16} /> {state.mailboxDetails.displayName}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setMailboxDetails(null)}><X size={18} /></button></div>
        <div className="detail-grid-2">
          <div><span className="text-xs text-muted">Address</span><strong className="text-sm text-block">{state.mailboxDetails.address}</strong></div>
          <div><span className="text-xs text-muted">Type</span><strong className="text-sm text-block">{state.mailboxDetails.kind}</strong></div>
          <div><span className="text-xs text-muted">Active</span><strong className="text-sm text-block">{state.mailboxDetails.active ? 'Yes' : 'No'}</strong></div>
          <div><span className="text-xs text-muted">Created</span><strong className="text-sm text-block">{formatRelative(state.mailboxDetails.createdAt)}</strong></div>
        </div>
        <div className="flex gap-2 px-20 py-20">
          <button className="btn btn-ghost btn-sm" onClick={() => { copyToClipboard(state.mailboxDetails!.address); state.showToast('Copied'); }}><Copy size={14} /> Copy</button>
          <button className="btn btn-primary btn-sm" onClick={() => { state.setSelectedFromAddress(state.mailboxDetails!.address); state.setMailboxDetails(null); state.showToast('Sender set'); }}><CheckCircle2 size={14} /> Set Sender</button>
        </div>
      </div>
    </div>
  );
}

function GroupDetailsModal({ state }: { state: DashboardState }) {
  if (!state.groupDetails) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setGroupDetails(null)}>
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Users size={16} /> {state.groupDetails.name}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setGroupDetails(null)}><X size={18} /></button></div>
        <div className="detail-grid-2">
          <div><span className="text-xs text-muted">Address</span><strong className="text-sm text-block">{state.groupDetails.address}</strong></div>
          <div><span className="text-xs text-muted">Members</span><strong className="text-sm text-block">{state.groupDetails.members.length}</strong></div>
        </div>
        <div className="px-20 py-20">
          {state.groupDetails.members.map(m => (
            <div key={m} className="flex items-center gap-2 member-row">
              <Mail size={14} className="text-muted" />
              <span className="text-sm">{m}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 px-20 py-20">
          <button className="btn btn-ghost btn-sm" onClick={() => { copyToClipboard(state.groupDetails!.address); state.showToast('Copied'); }}><Copy size={14} /> Copy Group</button>
          <button className="btn btn-primary btn-sm" onClick={() => { state.openComposeWith(state.groupDetails!.address); state.setGroupDetails(null); }}><Send size={14} /> Email Group</button>
        </div>
      </div>
    </div>
  );
}

function LogoutConfirmModal({ state }: { state: DashboardState }) {
  return (
    <div className="modal-overlay" onClick={() => state.setShowLogoutConfirm(false)}>
      <div className="biz-form-modal glass animate-scale logout-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-icon-danger">
          <AlertTriangle size={28} />
        </div>
        <h3 className="logout-title">Confirm Logout</h3>
        <p className="text-sm text-muted logout-text">Are you sure you want to disconnect your business session?</p>
        <div className="flex gap-3 justify-center">
          <button className="btn btn-secondary" onClick={() => state.setShowLogoutConfirm(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={state.handleLogout}><LogOut size={16} /> Yes, Log Out</button>
        </div>
      </div>
    </div>
  );
}

function RoleChangeConfirmModal({ state, confirmRoleChangeStep }: { state: DashboardState; confirmRoleChangeStep: () => void }) {
  if (!state.pendingRoleChange) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setPendingRoleChange(null)}>
      <div className="biz-form-modal glass animate-scale role-change-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-body-center">
          <div className="modal-icon-warning">
            <Shield size={28} />
          </div>
          <h3 className="role-change-title">{state.pendingRoleChange.step === 1 ? 'Review role change' : 'Final confirmation'}</h3>
          <p className="text-sm text-muted">
            {state.pendingRoleChange.step === 1 ? `You are changing this user to ${state.pendingRoleChange.role}. Review permissions before continuing.` : `This is the second confirmation. Apply ${state.pendingRoleChange.role} access now?`}
          </p>
        </div>
        <div className="modal-actions-border">
          <button className="btn btn-ghost" onClick={() => state.setPendingRoleChange(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={confirmRoleChangeStep}>{state.pendingRoleChange.step === 1 ? 'Continue' : 'Apply Role'}</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmActionModal({ state }: { state: DashboardState }) {
  if (!state.confirmAction) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setConfirmAction(null)}>
      <div className="biz-form-modal glass animate-scale confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-body-center">
          <div className="modal-icon-danger">
            <AlertTriangle size={28} />
          </div>
          <h3 className="confirm-title">{state.confirmAction.title}</h3>
          <p className="text-sm text-muted">{state.confirmAction.message}</p>
        </div>
        <div className="modal-actions-border">
          <button className="btn btn-ghost confirm-btn-cancel" onClick={() => state.setConfirmAction(null)}>Cancel</button>
          <button className="btn btn-primary confirm-btn-danger" onClick={() => { state.confirmAction!.onConfirm(); state.setConfirmAction(null); }}>Yes, Continue</button>
        </div>
      </div>
    </div>
  );
}

function AdminStatusConfirmModal({ state }: { state: DashboardState }) {
  if (!state.adminStatusConfirm) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setAdminStatusConfirm(null)}>
      <div className="biz-form-modal glass animate-scale admin-status-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-body-center">
          <div className="modal-icon-warning">
            <Shield size={28} />
          </div>
          <h3 className="admin-status-title">
            {state.adminStatusConfirm.step === 1 ? 'Review status change' : `Confirm ${state.adminStatusConfirm.status === 'suspended' ? 'Suspend' : 'Reactivate'}`}
          </h3>
        </div>
        <div className="modal-actions-border">
          <button className="btn btn-ghost" onClick={() => state.setAdminStatusConfirm(null)}>Cancel</button>
          <button className={state.adminStatusConfirm.status === 'suspended' ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => {
            if (state.adminStatusConfirm!.step === 1) { state.setAdminStatusConfirm({ ...state.adminStatusConfirm!, step: 2 }); return; }
            platformAdmin.updateUserStatus(state.adminStatusConfirm!.record.user.email, state.adminStatusConfirm!.status as 'active' | 'suspended' | 'deactivated');
            state.refreshQueue(); state.setAdminStatusConfirm(null); state.showToast(`User ${state.adminStatusConfirm!.status}`);
          }}>
            {state.adminStatusConfirm.step === 1 ? 'Continue' : state.adminStatusConfirm.status === 'suspended' ? 'Confirm Suspend' : 'Confirm Reactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DomainVerifyModal({ state, handleVerifyDomain }: { state: DashboardState; handleVerifyDomain: (id: string) => void }) {
  if (!state.domainVerifyOpen) return null;
  const isVerifying = state.domainVerifySteps.length > 0 && state.domainVerifySteps.some(s => s.status === 'pending' || s.status === 'checking');
  return (
    <div className="modal-overlay" onClick={() => state.setDomainVerifyOpen(false)}>
      <div className="biz-form-modal glass animate-scale domain-verify-modal" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><CheckCircle2 size={16} /> Domain Verification</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setDomainVerifyOpen(false)}><X size={18} /></button></div>
        <div className="domain-verify-body">
          {isVerifying && <div className="verify-loading-bar" />}
          {state.domainVerifySteps.map(step => (
            <div key={step.key} className={`flex items-center gap-3 verify-step-row ${step.status === 'checking' ? 'verify-step-checking' : ''}`}>
              <div className={`verify-step-icon ${step.status === 'verified' ? 'verify-step-success' : step.status === 'checking' ? 'verify-step-spinner' : 'verify-step-pending'}`}>
                {step.status === 'verified' ? <Check size={16} className="text-success" /> : step.status === 'checking' ? <div className="spinner-xs" /> : <AlertCircle size={16} className="verify-step-pending-icon" />}
              </div>
              <div className="verify-step-info"><strong className="text-sm">{step.label}</strong><p className="text-xs text-muted">{step.detail}</p></div>
              <span className={`badge badge-${step.status === 'verified' ? 'success' : step.status === 'failed' ? 'danger' : step.status === 'checking' ? 'neutral' : 'neutral'}`}>{step.status === 'checking' ? 'Checking...' : step.status}</span>
            </div>
          ))}
          {state.domainVerifyProviderRecords.length > 0 && (
            <div className="dns-records-section">
              <h4 className="dns-records-title">Required DNS Records</h4>
              {state.domainVerifyProviderRecords.map((rec: Record<string, string>, i: number) => (
                <div key={i} className="flex items-center gap-2 dns-record-row-flex">
                  <span className="dns-type-badge dns-type-txt">{providerRecordType(rec)}</span>
                  <span className="text-xs truncate dns-record-name">{rec.name || rec.host || '-'}</span>
                  <span className="text-xs truncate dns-record-value">{rec.value || rec.data || '-'}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => { copyToClipboard(rec.value || rec.data || ''); state.showToast('Copied'); }}><Copy size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-20 py-20">
          <button className="btn btn-primary" onClick={() => { const dom = state.domainsList.find(d => d.id === state.verifyingDomainId); if (dom) handleVerifyDomain(dom.id); }}><RefreshCcw size={14} /> Re-check</button>
          <button className="btn btn-ghost" onClick={() => state.setDomainVerifyOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ToastNotification({ state }: { state: DashboardState }) {
  if (!state.toast) return null;
  return (
    <div className="toast-container">
      <div className={`toast toast-${state.toast.type} toast-flex`}>
        <CheckCircle2 size={18} />
        {state.toast.msg}
      </div>
    </div>
  );
}

export default function Modals({ state, handleVerifyDomain, confirmRoleChangeStep }: ModalsProps) {
  return (
    <>
      {state.composeOpen && <ComposeModal state={state} />}
      {state.inviteOpen && <InviteModal state={state} />}
      {state.templateEditorOpen && <TemplateEditorModal state={state} />}
      {state.selectedAdminUser && <AdminUserModal state={state} />}
      {state.domainDetails && <DomainDetailsModal state={state} handleVerifyDomain={handleVerifyDomain} />}
      {state.mailboxDetails && <MailboxDetailsModal state={state} />}
      {state.groupDetails && <GroupDetailsModal state={state} />}
      {state.showLogoutConfirm && <LogoutConfirmModal state={state} />}
      {state.pendingRoleChange && <RoleChangeConfirmModal state={state} confirmRoleChangeStep={confirmRoleChangeStep} />}
      {state.confirmAction && <ConfirmActionModal state={state} />}
      {state.adminStatusConfirm && <AdminStatusConfirmModal state={state} />}
      {state.domainVerifyOpen && <DomainVerifyModal state={state} handleVerifyDomain={handleVerifyDomain} />}
      <ToastNotification state={state} />
    </>
  );
}
