import { useState, useEffect, useRef } from 'react';
import {
  Settings, Menu, X, Plus, Edit3, Star, Trash2, Copy, Shield, Search, Power,
  Bell, Users, RotateCcw, Tag, Sliders, Link, ShieldCheck, CheckCircle2, AlertCircle
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { auth, autoReply, labels, rules } from '../../../api/client';
import { workspaceApi } from '../../../api/company';
import type { DashboardState } from '../types';
import type { Signature, Contact, EmailRule, EmailRuleCondition, EmailRuleAction, Label } from '../../../api/client';
import LoadingSpinner from '../../LoadingSpinner';
import { canEditWorkspaceContent, canManageWorkspace } from '../constants';

interface SettingsPanelProps {
  state: DashboardState;
}

function ToggleSwitch({ checked, onChange, label, sublabel }: { checked: boolean; onChange: (v: boolean) => void; label: string; sublabel?: string }) {
  return (
    <div className="flex items-center justify-between w-full max-w-lg py-3 px-4 rounded-xl bg-hover-light border border-primary-10/5 backdrop-blur-sm transition-all hover:border-primary-10/20">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-primary">{label}</span>
        {sublabel && <span className="text-xs text-muted">{sublabel}</span>}
      </div>
      <button
        type="button"
        className={`toggle-switch ${checked ? 'active' : ''}`}
        onClick={() => onChange(!checked)}
        aria-label={label}
        aria-pressed={checked}
      >
        <div className="toggle-knob" />
      </button>
    </div>
  );
}

function SignatureEditor({ state, sig }: { state: DashboardState; sig?: Signature }) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (sig) {
      setName(sig.name);
      setContent(sig.content);
    } else {
      setName('');
      setContent('');
    }
  }, [sig, state.signatureEditorOpen]);

  const isEdit = !!sig;
  if (!state.signatureEditorOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => { state.setSignatureEditorOpen(false); state.setEditingSignatureId(null); }}>
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header">
          <h3>{isEdit ? 'Edit Signature' : 'New Signature'}</h3>
          <button className="btn btn-ghost btn-icon" onClick={() => { state.setSignatureEditorOpen(false); state.setEditingSignatureId(null); }}><X size={16} /></button>
        </div>
        <div className="invite-form">
          <label className="text-xs font-semibold text-muted mb-2 block" htmlFor="signature-name">Signature Name</label>
          <input id="signature-name" className="input" placeholder="e.g. Professional, Personal" value={name} onChange={e => setName(e.target.value)} />
          
          <label className="text-xs font-semibold text-muted mt-4 mb-2 block" htmlFor="signature-content">Content (HTML or Text)</label>
          <textarea id="signature-content" className="input" rows={6} placeholder="Kind regards,&#10;John Doe" value={content} onChange={e => setContent(e.target.value)} />
          
          <button className="btn btn-primary mt-6" onClick={async () => {
            try {
              // The signature is stored with the company, so it is available
              // on every device and after a refresh.
              await workspaceApi.saveSignature({
                id: isEdit ? state.editingSignatureId || undefined : undefined,
                name,
                content,
              });
              await state.refreshSignatures();
              state.setSignatureEditorOpen(false);
              state.setEditingSignatureId(null);
              state.showToast(isEdit ? 'Signature updated' : 'Signature created');
            } catch (e) {
              console.error('save signature failed', e);
              state.showToast(e instanceof Error ? e.message : 'Failed to save signature', 'error');
            }
          }}>{isEdit ? 'Update' : 'Create'} Signature</button>
        </div>
      </div>
    </div>
  );
}

function ContactEditor({ state, contact }: { state: DashboardState; contact?: Contact }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');

  useEffect(() => {
    if (contact) {
      setName(contact.name);
      setEmail(contact.email);
      setPhone(contact.phone || '');
      setCompany(contact.company || '');
    } else {
      setName('');
      setEmail('');
      setPhone('');
      setCompany('');
    }
  }, [contact, state.contactEditorOpen]);

  const isEdit = !!contact;
  if (!state.contactEditorOpen) return null;

  return (
    <div className="modal-overlay" onClick={() => { state.setContactEditorOpen(false); state.setEditingContactId(null); }}>
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header">
          <h3>{isEdit ? 'Edit Contact' : 'New Contact'}</h3>
          <button className="btn btn-ghost btn-icon" onClick={() => { state.setContactEditorOpen(false); state.setEditingContactId(null); }}><X size={16} /></button>
        </div>
        <div className="invite-form">
          <label className="text-xs font-semibold text-muted mb-2 block" htmlFor="contact-name">Full name</label>
          <input id="contact-name" className="input" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
          <label className="text-xs font-semibold text-muted mt-4 mb-2 block" htmlFor="contact-email">Email address</label>
          <input id="contact-email" className="input" placeholder="Email address" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
          <label className="text-xs font-semibold text-muted mt-4 mb-2 block" htmlFor="contact-phone">Phone</label>
          <input id="contact-phone" className="input" placeholder="Phone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} />
          <label className="text-xs font-semibold text-muted mt-4 mb-2 block" htmlFor="contact-company">Company</label>
          <input id="contact-company" className="input" placeholder="Company" autoComplete="organization" value={company} onChange={e => setCompany(e.target.value)} />
          <button className="btn btn-primary mt-4" onClick={async () => {
            try {
              if (!name.trim() || !email.trim().includes('@')) {
                state.showToast('A contact needs a name and a valid email address.', 'error');
                return;
              }
              // The contact is stored with the company, so the dashboard, the
              // inbox and every other device see the same list.
              await workspaceApi.saveContact({
                id: isEdit ? state.editingContactId || undefined : undefined,
                name: name.trim(),
                email: email.trim(),
                phone,
                company,
                group: 'General',
              });
              await state.refreshContacts();
              state.setContactEditorOpen(false);
              state.setEditingContactId(null);
              state.showToast(isEdit ? 'Contact updated' : 'Contact created');
            } catch (e) {
              console.error('save contact failed', e);
              state.showToast(e instanceof Error ? e.message : 'Failed to save contact', 'error');
            }
          }}>{isEdit ? 'Update' : 'Create'} Contact</button>
        </div>
      </div>
    </div>
  );
}

function RuleEditorModal({
  open,
  onClose,
  rule,
  onSave,
  customLabels
}: {
  open: boolean;
  onClose: () => void;
  rule: EmailRule | null;
  onSave: (name: string, conditions: EmailRuleCondition[], actions: EmailRuleAction[]) => void;
  customLabels: Label[];
}) {
  const [name, setName] = useState('');
  const [condField, setCondField] = useState<EmailRuleCondition['field']>('subject');
  const [condOp, setCondOp] = useState<EmailRuleCondition['operator']>('contains');
  const [condVal, setCondVal] = useState('');
  const [actType, setActType] = useState<EmailRuleAction['type']>('label');
  const [actVal, setActVal] = useState('');

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      const cond = rule.conditions[0] || { field: 'subject', operator: 'contains', value: '' };
      setCondField(cond.field);
      setCondOp(cond.operator);
      setCondVal(cond.value);
      const act = rule.actions[0] || { type: 'label', value: '' };
      setActType(act.type);
      setActVal(act.value || '');
    } else {
      setName('');
      setCondField('subject');
      setCondOp('contains');
      setCondVal('');
      setActType('label');
      setActVal('');
    }
  }, [rule, open]);

  // Adjust action value when type changes
  useEffect(() => {
    if (!rule) {
      if (actType === 'move') setActVal('inbox');
      else if (actType === 'label') setActVal(customLabels[0]?.name || 'Work');
      else setActVal('');
    }
  }, [actType, customLabels, rule]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
        <div className="compose-header">
          <h3>{rule ? 'Edit Filtering Rule' : 'New Filtering Rule'}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="invite-form">
          <label className="text-xs font-semibold text-muted mb-2 block">Rule Name</label>
          <input className="input mb-4" placeholder="e.g. Move Spams, Label Work" value={name} onChange={e => setName(e.target.value)} />
          
          <div className="divider mb-4" />
          
          <label className="text-xs font-semibold text-primary mb-2 block">Condition</label>
          <div className="flex flex-col gap-2 mb-4">
            <select className="input" value={condField} onChange={e => setCondField(e.target.value as EmailRuleCondition['field'])}>
              <option value="subject">Subject</option>
              <option value="from">From Address</option>
              <option value="body">Body Content</option>
            </select>
            <select className="input" value={condOp} onChange={e => setCondOp(e.target.value as EmailRuleCondition['operator'])}>
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="startsWith">Starts With</option>
            </select>
            <input className="input" placeholder="Value to match..." value={condVal} onChange={e => setCondVal(e.target.value)} />
          </div>

          <div className="divider mb-4" />

          <label className="text-xs font-semibold text-primary mb-2 block">Action</label>
          <div className="flex flex-col gap-2">
            <select className="input" value={actType} onChange={e => setActType(e.target.value as EmailRuleAction['type'])}>
              <option value="label">Add Label</option>
              <option value="move">Move to Folder</option>
              <option value="star">Star Email</option>
              <option value="markRead">Mark as Read</option>
            </select>
            
            {actType === 'label' && (
              <select className="input" value={actVal} onChange={e => setActVal(e.target.value)}>
                {customLabels.length > 0 ? (
                  customLabels.map(l => <option key={l.id} value={l.name}>{l.name}</option>)
                ) : (
                  <>
                    <option value="Work">Work</option>
                    <option value="Personal">Personal</option>
                    <option value="Urgent">Urgent</option>
                  </>
                )}
              </select>
            )}

            {actType === 'move' && (
              <select className="input" value={actVal} onChange={e => setActVal(e.target.value)}>
                <option value="inbox">Inbox</option>
                <option value="archive">Archive</option>
                <option value="trash">Trash</option>
                <option value="spam">Spam</option>
                <option value="priority">Priority</option>
              </select>
            )}
          </div>

          <button className="btn btn-primary mt-6 w-full" disabled={!name.trim() || !condVal.trim()} onClick={() => {
            onSave(
              name.trim(),
              [{ field: condField, operator: condOp, value: condVal.trim() }],
              [{ type: actType, value: (actType === 'star' || actType === 'markRead') ? '' : actVal }]
            );
          }}>
            Save Rule
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPanel({ state }: SettingsPanelProps) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<'notifications' | 'signatures' | 'contacts' | 'security' | 'autoreply' | 'labels' | 'rules' | 'connections'>('notifications');
  const canEdit = canEditWorkspaceContent(state.user?.role);
  const canManage = canManageWorkspace(state.user?.role);
  
  // Email Private Logo states and handlers
  const [emailLogo, setEmailLogo] = useState<string | null>(state.user?.emailLogoUrl || null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const result = auth.updateSettings({ emailLogoUrl: dataUrl });
      if (result.success && result.user) {
        setEmailLogo(result.user.emailLogoUrl || null);
        state.showToast('Email private logo updated');
      } else {
        state.showToast('Failed to save email logo', 'error');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    const result = auth.updateSettings({ emailLogoUrl: undefined });
    if (result.success && result.user) {
      setEmailLogo(null);
      state.showToast('Email private logo removed');
    } else {
      state.showToast('Failed to remove email logo', 'error');
    }
  };

  // Custom states
  const [newLabelName, setNewLabelName] = useState('');
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [autoReplyState, setAutoReplyState] = useState(() => autoReply.get());
  
  // Rule editor modal states
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<EmailRule | null>(null);

  // Authenticator app (TOTP) states
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState(Boolean(state.user?.totpEnabled));
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [showMfaDisable, setShowMfaDisable] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');

  useEffect(() => {
    setMfaEnabled(Boolean(state.user?.totpEnabled));
  }, [state.user?.totpEnabled]);

  const handleStartMfaSetup = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await auth.startMfaSetup();
      if (!result.success || !result.secret || !result.otpauthUrl) {
        throw new Error('Unable to start the authenticator setup.');
      }
      setMfaSetup({ secret: result.secret, otpauthUrl: result.otpauthUrl });
      setMfaCode('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start the authenticator setup.';
      setMfaError(message);
      state.showToast(message, 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleEnableMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await auth.enableMfa(mfaCode.trim());
      if (!result.success) {
        throw new Error('Invalid authenticator code.');
      }
      setMfaSetup(null);
      setMfaCode('');
      setMfaEnabled(true);
      state.showToast('Authenticator enabled');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid authenticator code.';
      setMfaError(message);
      state.showToast(message, 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleCancelMfaSetup = () => {
    setMfaSetup(null);
    setMfaCode('');
    setMfaError(null);
  };

  const handleDisableMfa = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const result = await auth.disableMfa(mfaDisablePassword, mfaDisableCode.trim());
      if (!result.success) {
        throw new Error('Unable to disable the authenticator.');
      }
      setShowMfaDisable(false);
      setMfaDisablePassword('');
      setMfaDisableCode('');
      setMfaEnabled(false);
      state.showToast('Authenticator disabled');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to disable the authenticator.';
      setMfaError(message);
      state.showToast(message, 'error');
    } finally {
      setMfaBusy(false);
    }
  };

  const filteredContacts = state.contacts.filter(c =>
    !state.contactsSearch || c.name.toLowerCase().includes(state.contactsSearch.toLowerCase()) || c.email.toLowerCase().includes(state.contactsSearch.toLowerCase())
  );

  const handleToggleAutoReply = (enabled: boolean) => {
    if (enabled) {
      autoReply.enable(autoReplyState.subject || 'Out of office', autoReplyState.body || '');
    } else {
      autoReply.disable();
    }
    setAutoReplyState(autoReply.get());
    state.showToast(enabled ? 'Auto-reply responder enabled' : 'Auto-reply responder disabled');
  };

  const handleSaveAutoReplyText = () => {
    autoReply.set(autoReplyState);
    state.showToast('Vacation responder messages saved');
  };

  const handleRuleSave = (name: string, conditions: EmailRuleCondition[], actions: EmailRuleAction[]) => {
    if (selectedRule) {
      rules.update(selectedRule.id, { name, conditions, actions });
      state.showToast('Filtering rule updated');
    } else {
      rules.add(name, conditions, actions);
      state.showToast('New filtering rule created');
    }
    setRuleModalOpen(false);
    setSelectedRule(null);
  };

  const TABS = [
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'signatures', label: 'Signatures', icon: Edit3 },
    { id: 'contacts', label: 'Contacts', icon: Users },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'autoreply', label: 'Auto-Reply', icon: RotateCcw },
    { id: 'labels', label: 'Labels', icon: Tag },
    { id: 'rules', label: 'Filtering Rules', icon: Sliders },
    { id: 'connections', label: 'Connections', icon: Link },
  ] as const;

  return (
    <div className="dash-panel">
      <div className="panel-header">
        <button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}>
          <Menu size={16} />
        </button>
        <h3><Settings size={16} /> Settings</h3>
      </div>

      <div className="settings-body">
        <nav className="settings-tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`tab-btn ${activeSettingsTab === id ? 'active' : ''}`}
              onClick={() => setActiveSettingsTab(id)}
            >
              <Icon size={15} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {activeSettingsTab === 'notifications' && (
            <div className="glass-card animate-fade">
              <div className="settings-section-header mb-6">
                <h4>System Notifications</h4>
                <p className="text-xs text-muted">Configure desktop alerts and sound cues for incoming messages.</p>
              </div>
              <div className="flex flex-col gap-4 mt-6">
                <ToggleSwitch
                  checked={state.notificationEnabled}
                  onChange={state.setNotificationEnabled}
                  label="Desktop Notifications"
                  sublabel="Display banner alerts on your screen when new emails arrive."
                />
                <ToggleSwitch
                  checked={state.soundEnabled}
                  onChange={state.setSoundEnabled}
                  label="Play Alerts Sound"
                  sublabel="Play a pleasant notification chime for new emails."
                />
              </div>
              <div className="divider my-6" />
              <div className="mt-6 max-w-md">
                <h5 className="text-sm font-semibold text-primary mb-2">Default Sending Domain</h5>
                <p className="text-xs text-muted mb-4">Choose which custom domain is selected by default in your composer.</p>
                <select className="input" value={state.activeDomainName} onChange={e => state.setActiveDomain(e.target.value)}>
                  {state.domainsList.map(d => <option key={d.id} value={d.domain}>{d.domain}</option>)}
                </select>
              </div>

              <div className="divider my-6" />

              <div className="mt-6 max-w-md">
                <h5 className="text-sm font-semibold text-primary mb-2">Email Private Logo</h5>
                <p className="text-xs text-muted mb-4">This logo will be automatically appended as your professional brand logo in outgoing emails.</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '12px' }}>
                  <div className="email-logo-preview">
                    {emailLogo ? <img src={emailLogo} alt="email logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', fontWeight: 'bold' }}>NO LOGO</span>}
                  </div>
                  <div>
                    <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={handleLogoChange} />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => logoInputRef.current?.click()}>Upload Logo</button>
                    {emailLogo && <button type="button" className="btn btn-sm btn-ghost settings-ml-xs" onClick={handleRemoveLogo}>Remove</button>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSettingsTab === 'signatures' && (
            <div className="glass-card animate-fade">
              <div className="settings-section-header flex items-center justify-between mb-6">
                <div>
                  <h4>Email Signatures</h4>
                  <p className="text-xs text-muted">Create default endings to attach automatically to outgoing emails.</p>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => { state.setEditingSignatureId(null); state.setSignatureEditorOpen(true); }} disabled={!canEdit} title={canEdit ? undefined : 'Viewers cannot edit signatures'}><Plus size={12} /> Add Signature</button>
              </div>
              
              {state.signatures.length === 0 ? (
                <div className="empty-state-sm py-8"><p className="text-sm text-muted">No signatures created yet.</p></div>
              ) : (
                <div className="flex flex-col gap-3">
                  {state.signatures.map(sig => (
                    <div key={sig.id} className="team-member-row hover:border-accent-20 transition-all">
                      <div className="team-member-info">
                        <strong>{sig.name}</strong>
                        <span className="text-xs text-muted text-block line-clamp-1 mt-1 font-mono bg-primary-5/5 p-1 rounded border border-primary-5/10">{sig.content.slice(0, 100)}{sig.content.length > 100 ? '...' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {sig.isDefault ? (
                          <span className="badge badge-success">Default</span>
                        ) : canEdit ? (
                          <button className="btn btn-ghost btn-sm" title="Set as default" onClick={async () => { try { await workspaceApi.saveSignature({ id: sig.id, name: sig.name, content: sig.content, isDefault: true }); await state.refreshSignatures(); state.showToast('Default signature updated'); } catch (e) { state.showToast(e instanceof Error ? e.message : 'Update failed', 'error'); } }}><Star size={12} /></button>
                        ) : null}
                        {canEdit && (
                          <>
                            <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => { state.setEditingSignatureId(sig.id); state.setSignatureEditorOpen(true); }}><Edit3 size={12} /></button>
                            <button className="btn btn-ghost btn-sm btn-danger" title="Delete" onClick={async () => { try { await workspaceApi.deleteSignature(sig.id); await state.refreshSignatures(); state.showToast('Deleted signature'); } catch (e) { console.error('delete signature failed', e); state.showToast(e instanceof Error ? e.message : 'Delete failed', 'error'); } }}><Trash2 size={12} /></button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSettingsTab === 'contacts' && (
            <div className="glass-card animate-fade">
              <div className="settings-section-header flex items-center justify-between mb-6">
                <div>
                  <h4>Contacts Directory</h4>
                  <p className="text-xs text-muted">Manage your addresses book and shortcut suggestions.</p>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => { state.setEditingContactId(null); state.setContactEditorOpen(true); }} disabled={!canEdit} title={canEdit ? undefined : 'Viewers cannot edit contacts'}><Plus size={12} /> Add Contact</button>
              </div>

              <div className="dash-search mail-search-bar" style={{ padding: 0, marginBottom: 12 }}>
                <div className="mail-search-input">
                  <Search size={14} className="search-icon" />
                  <input className="input search-input" placeholder="Search contacts..." value={state.contactsSearch} onChange={e => state.setContactsSearch(e.target.value)} />
                </div>
              </div>

              {filteredContacts.length === 0 ? (
                <div className="empty-state-sm py-8"><p className="text-sm text-muted">No contacts found.</p></div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1">
                  {filteredContacts.map(c => (
                    <div key={c.id} className="team-member-row py-2">
                      <div className="avatar avatar-sm" style={{ background: `hsl(${c.name.charCodeAt(0) * 7 % 360}, 60%, 85%)`, color: `hsl(${c.name.charCodeAt(0) * 7 % 360}, 60%, 35%)` }}>{c.name.charAt(0).toUpperCase()}</div>
                      <div className="team-member-info">
                        <strong>{c.name}</strong>
                        <span className="text-xs text-muted">{c.email}{c.company ? ` · ${c.company}` : ''}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <button className="btn btn-ghost btn-sm" title={c.favorite ? 'Remove favourite' : 'Mark favourite'} onClick={async () => { try { await workspaceApi.saveContact({ id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.company, group: c.group, favorite: !c.favorite }); await state.refreshContacts(); } catch (e) { state.showToast(e instanceof Error ? e.message : 'Update failed', 'error'); } }}><Star size={12} className={c.favorite ? 'text-primary fill-primary' : 'text-muted'} /></button>
                        )}
                        {canEdit && (
                          <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => { state.setEditingContactId(c.id); state.setContactEditorOpen(true); }}><Edit3 size={12} /></button>
                        )}
                        <button className="btn btn-ghost btn-sm" title="Copy Address" onClick={() => { state.copyToClipboard(c.email); }}><Copy size={12} /></button>
                        {canEdit && (
                          <button className="btn btn-ghost btn-sm btn-danger" title="Delete" onClick={async () => { try { await workspaceApi.deleteContact(c.id); await state.refreshContacts(); state.showToast('Deleted contact'); } catch (e) { console.error('delete contact failed', e); state.showToast(e instanceof Error ? e.message : 'Delete failed', 'error'); } }}><Trash2 size={12} /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSettingsTab === 'security' && (
            <div className="flex flex-col gap-4">
              <div className="glass-card animate-fade">
                <div className="settings-section-header mb-6">
                  <h4>Two-Factor Authentication</h4>
                  <p className="text-xs text-muted">
                    Add an extra layer of security. When it is on, every sign-in asks for a
                    6-digit code from your authenticator app.
                  </p>
                </div>

                {mfaBusy ? (
                  <div className="form-success">
                    <LoadingSpinner size="sm" label="Working on the authenticator" />
                  </div>
                ) : mfaEnabled ? (
                  <>
                    <div className="form-success">
                      <ShieldCheck size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
                      <strong>Authenticator is enabled.</strong> A 6-digit code is required on every sign-in.
                    </div>
                    <button
                      className="btn btn-danger btn-sm mt-4"
                      type="button"
                      onClick={() => { setMfaError(null); setShowMfaDisable(true); }}
                    >
                      <Trash2 size={14} /> Disable Authenticator
                    </button>
                  </>
                ) : mfaSetup ? (
                  <>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ margin: '16px auto', display: 'inline-block' }}>
                        <QRCodeSVG value={mfaSetup.otpauthUrl} size={200} />
                      </div>
                      <p className="text-xs text-muted">
                        Scan with Google Authenticator, Authy, 1Password, or enter this key manually:
                      </p>
                      <code style={{ display: 'block', padding: 12, background: 'var(--bg-elevated)', borderRadius: 8, fontSize: 14, letterSpacing: 2, textAlign: 'center', wordBreak: 'break-all', marginBottom: 16 }}>
                        {mfaSetup.secret}
                      </code>
                    </div>
                    <div className="flex flex-col gap-3 max-w-md">
                      <input
                        className="input"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6-digit code from authenticator app"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                    {mfaError && <div className="form-error mt-2">{mfaError}</div>}
                    <div className="flex items-center gap-3 mt-4">
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={handleEnableMfa}
                        disabled={!mfaCode.trim()}
                      >
                        <CheckCircle2 size={16} /> Enable Authenticator
                      </button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={handleCancelMfaSetup}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted mb-4">
                      Requires a verified recovery email. {state.user?.recoveryEmailVerified
                        ? 'Your recovery email is verified, so you can set this up now.'
                        : 'Verify your recovery email first, then come back here.'}
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={handleStartMfaSetup}
                      disabled={!state.user?.recoveryEmailVerified}
                    >
                      <ShieldCheck size={16} /> Set Up Authenticator
                    </button>
                  </>
                )}
              </div>

              <div className="glass-card animate-fade">
                <div className="settings-section-header mb-6">
                  <h4>Active Sessions</h4>
                  <p className="text-xs text-muted">Review and disconnect devices that are signed into your workspace.</p>
                </div>
                {state.activeSessions.length === 0 ? (
                  <div className="empty-state-sm py-8">
                    <p className="text-sm text-muted">No active sessions loaded.</p>
                    <button className="btn btn-ghost btn-sm mt-4 border border-primary-10/20" onClick={state.refreshSessions}>Load Active Sessions</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {state.activeSessions.map(s => (
                      <div key={s.id} className="team-member-row hover:border-accent-20 transition-all">
                        <div className="avatar avatar-sm bg-primary-10/10 text-primary"><Shield size={12} /></div>
                        <div className="team-member-info">
                          <strong>{s.userAgent ? s.userAgent.slice(0, 45) : 'Unknown device'}</strong>
                          <span className="text-xs text-muted">{s.ipAddress || 'IP not recorded'}{s.current ? ' - Active now' : ''}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted font-mono">{new Date(s.lastActive).toLocaleDateString()}</span>
                          {!s.current && (
                            <button className="btn btn-ghost btn-sm btn-danger px-2" onClick={async () => { try { await auth.revokeSession(s.id); state.refreshSessions(); state.showToast('Session revoked'); } catch (e) { console.error('revoke session failed', e); state.showToast('Failed', 'error'); } }}><X size={12} /> Revoke</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {showMfaDisable && (
                <div className="modal-overlay" onClick={() => setShowMfaDisable(false)}>
                  <div className="glass-card animate-scale" style={{ maxWidth: 420, width: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
                    <h3 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertCircle size={20} color="var(--danger)" /> Disable Authenticator?
                    </h3>
                    <p className="text-xs text-muted" style={{ margin: '0 0 16px' }}>
                      Your account falls back to the password alone. Confirm with your current
                      password and a 6-digit code from the authenticator app.
                    </p>
                    <div className="flex flex-col gap-3">
                      <input
                        className="input"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Current password"
                        value={mfaDisablePassword}
                        onChange={(e) => setMfaDisablePassword(e.target.value)}
                      />
                      <input
                        className="input"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6-digit authenticator code"
                        value={mfaDisableCode}
                        onChange={(e) => setMfaDisableCode(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                    {mfaError && <div className="form-error mt-2">{mfaError}</div>}
                    <div className="flex items-center gap-3 mt-4">
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowMfaDisable(false)} disabled={mfaBusy}>
                        Cancel
                      </button>
                      <button className="btn btn-danger btn-sm" type="button" onClick={handleDisableMfa} disabled={mfaBusy || !mfaDisableCode.trim()}>
                        {mfaBusy ? <LoadingSpinner size="sm" label="Disabling" /> : <Trash2 size={16} />} Disable
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeSettingsTab === 'autoreply' && (
            <div className="glass-card animate-fade">
              <div className="settings-section-header mb-6">
                <h4>Auto-Reply Responder</h4>
                <p className="text-xs text-muted">Automatically send vacation responses to incoming messages during out-of-office hours.</p>
              </div>
              <div className="flex flex-col gap-6">
                <ToggleSwitch
                  checked={autoReplyState.enabled}
                  onChange={handleToggleAutoReply}
                  label="Enable Out-of-Office Responder"
                  sublabel="Turn on automatic email replies when a message is received in your inbox."
                />
                
                <div className="flex flex-col gap-4 mt-2 max-w-xl">
                  <div>
                    <label className="text-xs font-semibold text-muted mb-2 block">Response Subject</label>
                    <input className="input" placeholder="Subject (e.g. Out of office)" value={autoReplyState.subject || ''} onChange={e => {
                      setAutoReplyState(prev => ({ ...prev, subject: e.target.value }));
                    }} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted mb-2 block">Response Message Body</label>
                    <textarea className="input font-sans" rows={5} placeholder="Thank you for contacting me. I am currently out of office..." value={autoReplyState.body || ''} onChange={e => {
                      setAutoReplyState(prev => ({ ...prev, body: e.target.value }));
                    }} />
                  </div>
                  
                  <div className="flex items-center gap-3 py-2">
                    <button
                      type="button"
                      className={`toggle-switch toggle-switch-sm ${autoReplyState.onlyContacts ? 'active' : ''}`}
                      onClick={() => setAutoReplyState(prev => ({ ...prev, onlyContacts: !prev.onlyContacts }))}
                    >
                      <div className="toggle-knob" />
                    </button>
                    <span className="text-xs font-medium text-muted">Only send auto-replies to saved contacts</span>
                  </div>

                  <button className="btn btn-primary mt-2" onClick={handleSaveAutoReplyText}>Save Message Texts</button>
                </div>
              </div>
            </div>
          )}

          {activeSettingsTab === 'labels' && (
            <div className="glass-card animate-fade">
              <div className="settings-section-header flex items-center justify-between mb-6">
                <div>
                  <h4>Inbox Labels</h4>
                  <p className="text-xs text-muted">Create colored badges to categorize and organize your mailbox threads.</p>
                </div>
                <div className="flex items-center gap-2">
                  {showLabelInput ? (
                    <>
                      <input className="input input-max-140" placeholder="Label name" value={newLabelName} onChange={e => setNewLabelName(e.target.value)} autoFocus />
                      <button className="btn btn-primary btn-sm" onClick={() => {
                        const name = newLabelName.trim();
                        if (name) { labels.add(name, '#0d9488'); state.showToast('Label created'); setNewLabelName(''); setShowLabelInput(false); }
                      }}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setNewLabelName(''); setShowLabelInput(false); }}><X size={12} /></button>
                    </>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={() => setShowLabelInput(true)}><Plus size={12} /> Add Label</button>
                  )}
                </div>
              </div>

              {labels.getAll().length === 0 ? (
                <div className="empty-state-sm py-8"><p className="text-sm text-muted">No custom labels created yet.</p></div>
              ) : (
                <div className="flex flex-col gap-2">
                  {labels.getAll().map(lbl => (
                    <div key={lbl.id} className="team-member-row">
                      <div className="avatar avatar-sm font-semibold" style={{ background: lbl.color + '20', color: lbl.color }}>{lbl.name.charAt(0).toUpperCase()}</div>
                      <div className="team-member-info"><strong>{lbl.name}</strong></div>
                      <div className="flex items-center gap-3">
                        <input type="color" value={lbl.color} onChange={e => { labels.update(lbl.id, { color: e.target.value }); state.refreshDomains(); }} className="color-picker-sm cursor-pointer" />
                        <button className="btn btn-ghost btn-sm btn-danger" onClick={() => { labels.remove(lbl.id); state.showToast('Deleted label'); }}><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSettingsTab === 'rules' && (
            <div className="glass-card animate-fade">
              <div className="settings-section-header flex items-center justify-between mb-6">
                <div>
                  <h4>Email Filtering Rules</h4>
                  <p className="text-xs text-muted">Automate your inbox by triggering events like labeling, starring, or moving folders based on criteria.</p>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => { setSelectedRule(null); setRuleModalOpen(true); }}><Plus size={12} /> Add Rule</button>
              </div>

              {rules.getAll().length === 0 ? (
                <div className="empty-state-sm py-8"><p className="text-sm text-muted">No email routing rules configured.</p></div>
              ) : (
                <div className="flex flex-col gap-4">
                  {rules.getAll().map(rule => (
                    <div key={rule.id} className="glass-card p-4 border border-primary-5/10 relative hover:border-primary-10/20 transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button className="btn btn-ghost btn-sm p-1" title={rule.enabled ? 'Disable' : 'Enable'} onClick={() => { rules.toggle(rule.id); state.refreshDomains(); }}>
                            <Power size={14} className={rule.enabled ? 'text-success' : 'text-muted'} />
                          </button>
                          <strong className="text-sm font-semibold text-primary">{rule.name}</strong>
                        </div>
                        <div className="flex gap-1">
                          <button className="btn btn-ghost btn-sm" title="Edit Rule" onClick={() => { setSelectedRule(rule); setRuleModalOpen(true); }}><Edit3 size={12} /></button>
                          <button className="btn btn-ghost btn-sm btn-danger" title="Delete Rule" onClick={() => { rules.remove(rule.id); state.showToast('Deleted filtering rule'); }}><Trash2 size={12} /></button>
                        </div>
                      </div>
                      
                      <div className="mt-3 p-3 rounded-lg bg-primary-5/5 border border-primary-5/10 flex flex-col gap-2">
                        <div className="text-xs text-muted flex items-center gap-2">
                          <span className="font-semibold text-primary">IF</span>
                          {rule.conditions.map((c, i) => (
                            <span key={i} className="bg-primary-5/10 py-1 px-2 rounded border border-primary-5/20 font-mono">
                              <strong>{c.field}</strong> {c.operator === 'startsWith' ? 'starts with' : c.operator} <span className="text-primary font-sans">"{c.value}"</span>
                              {i < rule.conditions.length - 1 ? ' AND ' : ''}
                            </span>
                          ))}
                        </div>
                        <div className="text-xs text-muted flex items-center gap-2">
                          <span className="font-semibold text-success">THEN</span>
                          {rule.actions.map((a, i) => (
                            <span key={i} className="bg-success-5/10 py-1 px-2 rounded border border-success-5/20 font-mono text-success">
                              {a.type === 'label' ? 'add label' : a.type === 'move' ? 'move to' : a.type === 'star' ? 'star email' : 'mark read'}
                              {a.value ? `: ${a.value}` : ''}
                              {i < rule.actions.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSettingsTab === 'connections' && (
            <div className="glass-card animate-fade">
              <div className="settings-section-header mb-6">
                <h4>Infrastructure Credentials</h4>
                <p className="text-xs text-muted">Manage keys and database urls for custom database integrations.</p>
              </div>
              {state.connectionUsage.length === 0 ? (
                <div className="empty-state-sm py-8"><p className="text-sm text-muted">No infrastructure connections configured.</p></div>
              ) : (
                <div className="flex flex-col gap-3">
                  {state.connectionUsage.map(c => (
                    <div key={c.id} className="flex items-center justify-between connection-row p-3 rounded-lg bg-hover-light border border-primary-5/5">
                      <div>
                        <strong className="text-sm font-semibold text-primary">{c.label}</strong>
                        <span className="text-xs text-muted font-mono block mt-1">{c.maskedValue} ({c.provider || 'N/A'})</span>
                      </div>
                      <button className="btn btn-ghost btn-sm btn-danger border border-danger/10 hover:bg-danger-glow" disabled={!canManage} title={canManage ? undefined : 'Only owners and admins can revoke a connection'} onClick={() => state.setConfirmRevokeId(c.id)}><X size={12} /> Revoke</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {canEdit && <SignatureEditor state={state} sig={state.editingSignatureId ? state.signatures.find(s => s.id === state.editingSignatureId) : undefined} />}
      {canEdit && <ContactEditor state={state} contact={state.editingContactId ? state.contacts.find(c => c.id === state.editingContactId) : undefined} />}
      
      <RuleEditorModal
        open={ruleModalOpen}
        onClose={() => { setRuleModalOpen(false); setSelectedRule(null); }}
        rule={selectedRule}
        onSave={handleRuleSave}
        customLabels={labels.getAll()}
      />
    </div>
  );
}
