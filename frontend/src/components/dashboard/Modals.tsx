import { X, UserCheck, CheckCircle2, Copy, Shield, AlertTriangle, LogOut, Mail, Send, Globe, Users, Layers, Check, AlertCircle, RefreshCcw } from 'lucide-react';
import Composer from '../Composer';
import type { DashboardState } from './types';
import { providerRecordType } from './utils';
import { connections, teamAccess } from '../../api/client';
import { workspaceApi } from '../../api/company';

interface ModalsProps {
  state: DashboardState;
  handleVerifyDomain: (id: string) => void;
  confirmRoleChangeStep: () => void;
}

function ComposeModal({ state }: { state: DashboardState }) {
  return (
    <div className="modal-overlay-compose" role="dialog" aria-modal="true" aria-label="Compose email">
      <div className="compose-modal compose-modal-fixed" onClick={e => e.stopPropagation()}>
        <Composer
          initialTo={state.composeTo}
          initialSubject={state.composeSubject}
          initialBody={state.composeBody}
          initialReplyQuote={state.composeReplyQuote}
          fromControl={
            <select className="input input-auto" value={state.selectedFromAddress} onChange={e => state.setSelectedFromAddress(e.target.value)}>
              {state.domainMailboxes && state.domainMailboxes.length > 0 ? (
                state.domainMailboxes.map(m => <option key={m.address} value={m.address}>{m.address}</option>)
              ) : (
                <option value="">no-reply@{state.activeDomainName}</option>
              )}
            </select>
          }
          onSend={(to, subject, body, attachments, scheduledAt) => {
            state.setComposeTo(to);
            state.setComposeSubject(subject);
            state.setComposeBody(body);
            state.handleSendEmail(to, subject, body, attachments, scheduledAt);
          }}
          onClose={() => state.setComposeOpen(false)}
          sending={state.sending}
        />
      </div>
    </div>
  );
}

/**
 * What a member can do once they joined with a given role.
 *
 * The invitation is issued for a specific role and the access follows from
 * that role, so the issuer always sees exactly what the joiner receives.
 */
const INVITE_ROLE_LABELS: Record<string, string> = {
  admin: 'Workspace Admin',
  member: 'Member',
  viewer: 'Viewer',
};

const INVITE_ROLE_ACCESS: Record<string, string> = {
  admin: 'Full workspace access: mailboxes, domains, groups, templates, team management, billing and audit log.',
  member: 'Sends and receives mail, manages templates and the queue, and can view domains, mailboxes, groups and the audit log.',
  viewer: 'Read-only access to mail, domains, mailboxes, groups, analytics, billing and the audit log. Cannot change anything.',
};

function InviteModal({ state }: { state: DashboardState }) {  return (
    <div className="modal-overlay" onClick={() => { state.setInviteOpen(false); }} role="dialog" aria-modal="true" aria-label="Invite team member">
      <div className="biz-form-modal glass" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><UserCheck size={16} /> Invite Team Member</h3><button className="btn btn-ghost btn-icon" onClick={() => { state.setInviteOpen(false); }}><X size={16} /></button></div>
        {!state.issuedInvite ? (
          <div className="invite-form">
            <input className="input" placeholder="Full name" value={state.inviteName} onChange={e => state.setInviteName(e.target.value)} />
            <input className="input" placeholder="Email address" type="email" value={state.inviteEmail} onChange={e => state.setInviteEmail(e.target.value)} />
            <select className="input" value={state.inviteRole} onChange={e => state.setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}>
              <option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
            </select>
            <div className="invite-role-access">
              <strong>{INVITE_ROLE_LABELS[state.inviteRole] || state.inviteRole}</strong>
              <span>{INVITE_ROLE_ACCESS[state.inviteRole]}</span>
            </div>
            <select className="input" value={state.inviteExpiresHours} onChange={e => state.setInviteExpiresHours(Number(e.target.value))}>
              <option value={24}>24 hours</option><option value={48}>48 hours</option><option value={72}>72 hours</option><option value={168}>7 days</option>
            </select>
            <button className="btn btn-primary" disabled={state.inviteSending} onClick={async () => {
              const email = state.inviteEmail.trim();
              if (!email || !email.includes('@')) {
                state.showToast('Enter a valid email address.', 'error');
                return;
              }
              state.setInviteSending(true);
              try {
                // The invitation is stored with the company and the member
                // receives it by mail.
                const invitation = await workspaceApi.invite({
                  email,
                  role: state.inviteRole,
                  expiresInHours: state.inviteExpiresHours,
                });

                // Also mint a Team Access Key (vmt_…) so the invitee can sign
                // in through the Login → Team Access tab without any setup.
                let accessKey = '';
                if (state.user) {
                  try {
                    const teamInvite = await teamAccess.createInvite({
                      issuer: state.user,
                      email,
                      name: state.inviteName.trim() || email.split('@')[0],
                      role: state.inviteRole,
                      expiresInHours: state.inviteExpiresHours,
                    });
                    accessKey = teamInvite.token;
                  } catch {
                    // The workspace invitation still succeeded; the key is
                    // best-effort (it may be unavailable if the backend is
                    // unreachable, but the email invitation was sent).
                  }
                }

                state.setIssuedInvite({
                  id: invitation.id,
                  email: invitation.email,
                  role: invitation.role,
                  invitedBy: state.user?.email || '',
                  status: 'pending',
                  expiresAt: invitation.expiresAt,
                  accessKey,
                });
                state.showToast(`Invitation sent to ${invitation.email}`);
                state.refreshTeam();
              } catch (error) {
                state.showToast(
                  error instanceof Error ? error.message : 'Failed to create invite',
                  'error',
                );
              } finally {
                state.setInviteSending(false);
              }
            }}>{state.inviteSending ? 'Sending...' : 'Send invitation'}</button>
          </div>
        ) : (
          <div className="invite-success">
            <CheckCircle2 size={32} className="text-success invite-success-icon" />
            <p className="text-sm">The invitation was sent to {state.issuedInvite?.email}.</p>
            <p className="text-xs text-muted invite-expiry">
              It is valid until {state.issuedInvite?.expiresAt ? new Date(state.issuedInvite.expiresAt).toLocaleString() : 'it expires'}.
            </p>

            {state.issuedInvite?.accessKey && (
              <div className="invite-access-key">
                <p className="invite-access-key-label">
                  <Shield size={14} /> Team Access Key
                </p>
                <p className="invite-access-key-hint">
                  Share this key with <strong>{state.issuedInvite.email}</strong>. They enter it first on the Login page (Team Access tab), then their email, then the OTP — and they land in your workspace with <strong>{state.issuedInvite.role}</strong> access. No separate setup needed.
                </p>
                <div className="invite-access-key-row">
                  <code className="invite-access-key-value" title="Team Access Key">{state.issuedInvite.accessKey}</code>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(state.issuedInvite?.accessKey || '').then(
                        () => state.showToast('Access key copied to clipboard.'),
                        () => state.showToast('Unable to copy. Select the key manually.', 'error'),
                      );
                    }}
                  >
                    <Copy size={14} /> Copy
                  </button>
                </div>
              </div>
            )}

            <button className="btn btn-ghost btn-sm invite-done-btn" onClick={() => {
              state.setIssuedInvite(null);
              state.setInviteName('');
              state.setInviteEmail('');
            }}>Invite Another</button>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateEditorModal({ state }: { state: DashboardState }) {
  return (
    <div className="modal-overlay" onClick={() => state.setTemplateEditorOpen(false)} role="dialog" aria-modal="true" aria-label="Template editor">
      <div className="biz-form-modal glass" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Layers size={16} /> {state.previewTemplate ? 'Template Preview' : (state.templateName ? 'Edit Template' : 'New Template')}</h3><button className="btn btn-ghost btn-icon" onClick={() => { state.setTemplateEditorOpen(false); state.setPreviewTemplate(null); }}><X size={16} /></button></div>
        {state.previewTemplate ? (
          <div className="template-preview-body"><h4>{state.previewTemplate.name}</h4><p className="text-sm text-muted">{state.previewTemplate.subject}</p><div className="reader-body template-preview-content">{state.previewTemplate.body}</div></div>
        ) : (
          <div className="template-editor-form">
            <input className="input" placeholder="Template name" value={state.templateName} onChange={e => state.setTemplateName(e.target.value)} />
            <input className="input" placeholder="Subject line" value={state.templateSubject} onChange={e => state.setTemplateSubject(e.target.value)} />
            <textarea className="input" rows={8} placeholder="Email body..." value={state.templateBody} onChange={e => state.setTemplateBody(e.target.value)} />
            <button className="btn btn-primary" disabled={state.templateSaving} onClick={async () => {
              if (!state.templateName.trim() || !state.templateSubject.trim()) {
                state.showToast('A template needs a name and a subject.', 'error');
                return;
              }
              state.setTemplateSaving(true);
              try {
                // The template is stored with the company, so it is available
                // on every device and after a refresh.
                await workspaceApi.saveTemplate({
                  name: state.templateName.trim(),
                  subject: state.templateSubject.trim(),
                  body: state.templateBody,
                });
                await state.refreshTemplates();
                state.setTemplateEditorOpen(false);
                state.showToast('Template saved');
              } catch (error) {
                state.showToast(error instanceof Error ? error.message : 'Failed to save the template', 'error');
              } finally {
                state.setTemplateSaving(false);
              }
            }}>{state.templateSaving ? 'Saving...' : 'Save Template'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminUserModal({ state }: { state: DashboardState }) {
  if (!state.selectedAdminUser) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setSelectedAdminUser(null)} role="dialog" aria-modal="true" aria-label="Admin user details">
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><UserCheck size={16} /> {state.selectedAdminUser.user.displayName || state.selectedAdminUser.user.email}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setSelectedAdminUser(null)}><X size={16} /></button></div>
        <div className="detail-grid-2">
          {Object.entries({
            Email: state.selectedAdminUser.user.email,
            Role: state.selectedAdminUser.user.role || 'member',
            Platform: state.selectedAdminUser.user.isPlatformAdmin ? 'Yes' : 'No',
            Plan: `${state.selectedAdminUser.plan} (${state.selectedAdminUser.billingCycle})`,
            Status: state.selectedAdminUser.status,
            Risk: state.selectedAdminUser.risk,
            Domain: state.selectedAdminUser.domain || 'Not configured',
            Mailboxes: state.selectedAdminUser.mailboxCount,
            Emails: state.selectedAdminUser.emailCount,
            Queue: state.selectedAdminUser.queueCount,
          }).map(([k, v]) => (
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
    <div className="modal-overlay" onClick={() => state.setDomainDetails(null)} role="dialog" aria-modal="true" aria-label="Domain details">
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Globe size={16} /> {state.domainDetails.domain}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setDomainDetails(null)}><X size={16} /></button></div>
        <div className="detail-grid-2">
          <div><span className="text-xs text-muted">Status</span><strong className="text-sm text-block">{state.domainDetails.status}</strong></div>
          <div><span className="text-xs text-muted">DNS setup</span><strong className="text-sm text-block">{state.domainDetails.reputation}/100</strong></div>
          <div><span className="text-xs text-muted">Mailboxes</span><strong className="text-sm text-block">{state.domainDetails.mailCount}</strong></div>
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
          <button className="btn btn-ghost btn-sm" onClick={() => { void state.copyToClipboard(state.domainDetails!.domain); }}><Copy size={14} /> Copy Domain</button>
          <button className="btn btn-primary btn-sm" onClick={() => handleVerifyDomain(state.domainDetails!.id)}><RefreshCcw size={14} /> Verify</button>
        </div>
      </div>
    </div>
  );
}

function MailboxDetailsModal({ state }: { state: DashboardState }) {
  if (!state.mailboxDetails) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setMailboxDetails(null)} role="dialog" aria-modal="true" aria-label="Mailbox details">
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Mail size={16} /> {state.mailboxDetails.displayName}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setMailboxDetails(null)}><X size={16} /></button></div>
        <div className="detail-grid-2">
          <div><span className="text-xs text-muted">Address</span><strong className="text-sm text-block">{state.mailboxDetails.address}</strong></div>
          <div><span className="text-xs text-muted">Type</span><strong className="text-sm text-block">{state.mailboxDetails.kind}</strong></div>
          <div><span className="text-xs text-muted">Active</span><strong className="text-sm text-block">{state.mailboxDetails.active ? 'Yes' : 'No'}</strong></div>
        </div>
        <div className="flex gap-2 px-20 py-20">
          <button className="btn btn-ghost btn-sm" onClick={() => { void state.copyToClipboard(state.mailboxDetails!.address); }}><Copy size={14} /> Copy</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { state.setActiveMailboxAddress(state.mailboxDetails!.address); state.setSelectedFromAddress(state.mailboxDetails!.address); state.setActiveFolder('inbox'); state.setActiveBizTab('mail'); state.setMailboxDetails(null); }}><Mail size={14} /> Open Inbox</button>
          <button className="btn btn-primary btn-sm" onClick={() => { state.setSelectedFromAddress(state.mailboxDetails!.address); state.setMailboxDetails(null); state.showToast('Sender set'); }}><CheckCircle2 size={14} /> Set Sender</button>
        </div>
      </div>
    </div>
  );
}

function GroupDetailsModal({ state }: { state: DashboardState }) {
  if (!state.groupDetails) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setGroupDetails(null)} role="dialog" aria-modal="true" aria-label="Group details">
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><Users size={16} /> {state.groupDetails.name}</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setGroupDetails(null)}><X size={16} /></button></div>
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
          <button className="btn btn-ghost btn-sm" onClick={() => { void state.copyToClipboard(state.groupDetails!.address); }}><Copy size={14} /> Copy Group</button>
          <button className="btn btn-primary btn-sm" onClick={() => { state.openComposeWith(state.groupDetails!.address); state.setGroupDetails(null); }}><Send size={14} /> Email Group</button>
        </div>
      </div>
    </div>
  );
}

function LogoutConfirmModal({ state }: { state: DashboardState }) {
  return (
    <div className="modal-overlay" onClick={() => state.setShowLogoutConfirm(false)} role="dialog" aria-modal="true" aria-label="Confirm logout">
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
    <div className="modal-overlay" onClick={() => state.setPendingRoleChange(null)} role="dialog" aria-modal="true" aria-label="Confirm role change">
      <div className="biz-form-modal glass animate-scale role-change-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-body-center">
          <div className="modal-icon-warning">
            <Shield size={24} />
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
  const action = state.confirmAction;
  if (!action) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setConfirmAction(null)} role="dialog" aria-modal="true" aria-label="Confirm action">
      <div className="biz-form-modal glass animate-scale confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-body-center">
          <div className="modal-icon-danger">
<AlertTriangle size={24} />
          </div>
          <h3 className="confirm-title">{action.title}</h3>
          <p className="text-sm text-muted">{action.message}</p>
        </div>
        <div className="modal-actions-border">
          <button className="btn btn-ghost confirm-btn-cancel" onClick={() => state.setConfirmAction(null)}>Cancel</button>
          <button className="btn btn-danger confirm-btn-confirm" onClick={() => { action.onConfirm(); state.setConfirmAction(null); }}>Yes, Continue</button>
        </div>
      </div>
    </div>
  );
}

function DomainVerifyModal({ state, handleVerifyDomain }: { state: DashboardState; handleVerifyDomain: (id: string) => void }) {
  if (!state.domainVerifyOpen) return null;
  const isVerifying = state.domainVerifyBusy;
  return (
    <div className="modal-overlay" onClick={() => state.setDomainVerifyOpen(false)} role="dialog" aria-modal="true" aria-label="Domain verification">
      <div className="biz-form-modal glass animate-scale domain-verify-modal" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3><CheckCircle2 size={16} /> Domain Verification</h3><button className="btn btn-ghost btn-icon" onClick={() => state.setDomainVerifyOpen(false)}><X size={16} /></button></div>
        <div className="domain-verify-body">
          {isVerifying && <div className="verify-loading-bar" />}
          {state.domainVerifySteps.map(step => (
            <div key={step.key} className={`flex items-center gap-3 verify-step-row ${step.status === 'checking' ? 'verify-step-checking' : ''}`}>
              <div className={`verify-step-icon ${step.status === 'verified' ? 'verify-step-success' : step.status === 'checking' ? 'verify-step-spinner' : 'verify-step-pending'}`}>
                {step.status === 'verified' ? <Check size={16} className="text-success" /> : step.status === 'checking' ? <span className="spinner spinner-sm" /> : <AlertCircle size={16} className="verify-step-pending-icon" />}
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
                  <button className="btn btn-ghost btn-sm" onClick={() => { void state.copyToClipboard(rec.value || rec.data || ''); }}><Copy size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-2 px-20 py-20">
          <button className="btn btn-primary" disabled={isVerifying} onClick={() => { if (state.verifyingDomainId) handleVerifyDomain(state.verifyingDomainId); }}><RefreshCcw size={14} /> {isVerifying ? 'Checking...' : 'Re-check'}</button>
          <button className="btn btn-ghost" onClick={() => state.setDomainVerifyOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}

function RevokeConnectionModal({ state }: { state: DashboardState }) {
  if (!state.confirmRevokeId) return null;
  return (
    <div className="modal-overlay" onClick={() => state.setConfirmRevokeId(null)} role="dialog" aria-modal="true" aria-label="Revoke connection">
      <div className="biz-form-modal glass animate-scale confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-body-center">
          <div className="modal-icon-danger"><AlertTriangle size={24} /></div>
          <h3 className="confirm-title">Revoke Connection</h3>
          <p className="text-sm text-muted">Are you sure you want to revoke this connection? This action cannot be undone.</p>
        </div>
        <div className="modal-actions-border">
          <button className="btn btn-ghost confirm-btn-cancel" onClick={() => state.setConfirmRevokeId(null)}>Cancel</button>
          <button className="btn btn-danger confirm-btn-confirm" onClick={() => { try { connections.revoke(state.confirmRevokeId!); state.setConfirmRevokeId(null); state.showToast('Connection revoked'); } catch (e) { console.error('revoke connection failed', e); state.showToast('Revoke failed', 'error'); } }}>Yes, Revoke</button>
        </div>
      </div>
    </div>
  );
}

function ToastNotification({ state }: { state: DashboardState }) {
  if (!state.toast) return null;
  const isError = state.toast.type === 'error';
  return (
    <div className="toast-container" role="alert" aria-live="polite">
      <div className={`toast toast-${state.toast.type} toast-flex`}>
        {isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
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
      {state.confirmRevokeId && <RevokeConnectionModal state={state} />}
      {state.domainVerifyOpen && <DomainVerifyModal state={state} handleVerifyDomain={handleVerifyDomain} />}
      <ToastNotification state={state} />
    </>
  );
}
