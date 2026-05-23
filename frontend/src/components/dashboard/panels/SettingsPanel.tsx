import { useState } from 'react';
import { Settings, Menu, X, Plus, Edit3, Star, Trash2, Copy, Shield, Search, Power } from 'lucide-react';
import { signatures, contacts, auth, autoReply, labels, rules } from '../../../api/client';
import type { DashboardState } from '../types';
import type { Signature, Contact } from '../../../api/client';

interface SettingsPanelProps {
  state: DashboardState;
}

function SignatureEditor({ state, sig }: { state: DashboardState; sig?: Signature }) {
  const isEdit = !!sig;
  if (!state.signatureEditorOpen) return null;
  return (
    <div className="modal-overlay" onClick={() => { state.setSignatureEditorOpen(false); state.setEditingSignatureId(null); }}>
      <div className="biz-form-modal glass" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3>{isEdit ? 'Edit Signature' : 'New Signature'}</h3><button className="btn btn-ghost btn-icon" onClick={() => { state.setSignatureEditorOpen(false); state.setEditingSignatureId(null); }}><X size={16} /></button></div>
        <div className="invite-form">
          <input className="input" placeholder="Signature name" value={state.signatureEditorName} onChange={e => state.setSignatureEditorName(e.target.value)} />
          <textarea className="input" rows={5} placeholder="Signature HTML or plain text..." value={state.signatureEditorContent} onChange={e => state.setSignatureEditorContent(e.target.value)} />
          <button className="btn btn-primary" onClick={() => {
            try {
              if (isEdit && state.editingSignatureId) {
                signatures.update(state.editingSignatureId, { name: state.signatureEditorName, content: state.signatureEditorContent });
              } else {
                signatures.add(state.signatureEditorName, state.signatureEditorContent);
              }
              state.refreshSignatures();
              state.setSignatureEditorOpen(false);
              state.setEditingSignatureId(null);
              state.setSignatureEditorName('');
              state.setSignatureEditorContent('');
              state.showToast(isEdit ? 'Signature updated' : 'Signature created');
            } catch { state.showToast('Failed to save signature', 'error'); }
          }}>{isEdit ? 'Update' : 'Create'} Signature</button>
        </div>
      </div>
    </div>
  );
}

function ContactEditor({ state, contact }: { state: DashboardState; contact?: Contact }) {
  const isEdit = !!contact;
  if (!state.contactEditorOpen) return null;
  return (
    <div className="modal-overlay" onClick={() => { state.setContactEditorOpen(false); state.setEditingContactId(null); }}>
      <div className="biz-form-modal glass" onClick={e => e.stopPropagation()}>
        <div className="compose-header"><h3>{isEdit ? 'Edit Contact' : 'New Contact'}</h3><button className="btn btn-ghost btn-icon" onClick={() => { state.setContactEditorOpen(false); state.setEditingContactId(null); }}><X size={16} /></button></div>
        <div className="invite-form">
          <input className="input" placeholder="Full name" value={state.contactEditorName} onChange={e => state.setContactEditorName(e.target.value)} />
          <input className="input" placeholder="Email address" type="email" value={state.contactEditorEmail} onChange={e => state.setContactEditorEmail(e.target.value)} />
          <input className="input" placeholder="Phone" value={state.contactEditorPhone} onChange={e => state.setContactEditorPhone(e.target.value)} />
          <input className="input" placeholder="Company" value={state.contactEditorCompany} onChange={e => state.setContactEditorCompany(e.target.value)} />
          <button className="btn btn-primary" onClick={() => {
            try {
              if (isEdit && state.editingContactId) {
                contacts.update(state.editingContactId, { name: state.contactEditorName, email: state.contactEditorEmail, phone: state.contactEditorPhone, company: state.contactEditorCompany });
              } else {
                contacts.add({ name: state.contactEditorName, email: state.contactEditorEmail, phone: state.contactEditorPhone, company: state.contactEditorCompany, group: 'default' });
              }
              state.refreshContacts();
              state.setContactEditorOpen(false);
              state.setEditingContactId(null);
              state.setContactEditorName('');
              state.setContactEditorEmail('');
              state.setContactEditorPhone('');
              state.setContactEditorCompany('');
              state.showToast(isEdit ? 'Contact updated' : 'Contact created');
            } catch { state.showToast('Failed to save contact', 'error'); }
          }}>{isEdit ? 'Update' : 'Create'} Contact</button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPanel({ state }: SettingsPanelProps) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<'notifications' | 'signatures' | 'contacts' | 'security' | 'connections' | 'autoreply' | 'labels' | 'rules'>('notifications');

  const filteredContacts = state.contacts.filter(c =>
    !state.contactsSearch || c.name.toLowerCase().includes(state.contactsSearch.toLowerCase()) || c.email.toLowerCase().includes(state.contactsSearch.toLowerCase())
  );

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><Settings size={16} /> Settings</h3></div>

      <div className="settings-tabs">
        {(['notifications', 'signatures', 'contacts', 'security', 'autoreply', 'labels', 'rules', 'connections'] as const).map(tab => (
          <button key={tab} className={`btn btn-sm ${activeSettingsTab === tab ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveSettingsTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeSettingsTab === 'notifications' && (
        <div className="glass-card settings-card-mb">
          <h4>Notifications</h4>
          <div className="flex items-center gap-4 mt-8">
            <label className="flex items-center gap-2"><input type="checkbox" checked={state.notificationEnabled} onChange={e => state.setNotificationEnabled(e.target.checked)} /> <span className="text-sm">Enable notifications</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={state.soundEnabled} onChange={e => state.setSoundEnabled(e.target.checked)} /> <span className="text-sm">Play sounds</span></label>
          </div>
          <div className="mt-12">
            <h5 className="text-sm mb-4">Default Sending Domain</h5>
            <select className="input input-auto" value={state.activeDomainName} onChange={e => state.setActiveDomain(state.domainsList.find(d => d.domain === e.target.value)?.id || '')}>
              {state.domainsList.map(d => <option key={d.id} value={d.domain}>{d.domain}</option>)}
            </select>
          </div>
        </div>
      )}

      {activeSettingsTab === 'signatures' && (
        <div className="glass-card settings-card-mb">
          <div className="flex items-center justify-between mb-8">
            <h4>Email Signatures</h4>
            <button className="btn btn-primary btn-sm" onClick={() => { state.setEditingSignatureId(null); state.setSignatureEditorName(''); state.setSignatureEditorContent(''); state.setSignatureEditorOpen(true); }}><Plus size={12} /> Add</button>
          </div>
          {state.signatures.length === 0 ? (
            <div className="empty-state-sm"><p className="text-sm text-muted">No signatures yet.</p></div>
          ) : (
            state.signatures.map(sig => (
              <div key={sig.id} className="team-member-row">
                <div className="team-member-info"><strong>{sig.name}</strong><span className="text-xs text-muted text-block">{sig.content.slice(0, 60)}...</span></div>
                {sig.isDefault && <span className="badge badge-success">Default</span>}
                <button className="btn btn-ghost btn-sm" onClick={() => { signatures.setDefault(sig.id); state.refreshSignatures(); }}><Star size={12} /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => { state.setEditingSignatureId(sig.id); state.setSignatureEditorName(sig.name); state.setSignatureEditorContent(sig.content); state.setSignatureEditorOpen(true); }}><Edit3 size={12} /></button>
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => { try { signatures.remove(sig.id); state.refreshSignatures(); state.showToast('Deleted'); } catch { state.showToast('Delete failed', 'error'); } }}><Trash2 size={12} /></button>
              </div>
            ))
          )}
        </div>
      )}

      {activeSettingsTab === 'contacts' && (
        <div className="glass-card settings-card-mb">
          <div className="flex items-center justify-between mb-8">
            <h4>Contacts</h4>
            <button className="btn btn-primary btn-sm" onClick={() => { state.setEditingContactId(null); state.setContactEditorName(''); state.setContactEditorEmail(''); state.setContactEditorPhone(''); state.setContactEditorCompany(''); state.setContactEditorOpen(true); }}><Plus size={12} /> Add</button>
          </div>
          <div className="dash-search mail-search-bar" style={{ padding: 0, marginBottom: 8 }}>
            <div className="mail-search-input">
              <Search size={14} className="search-icon" />
              <input className="input search-input" placeholder="Search contacts..." value={state.contactsSearch} onChange={e => state.setContactsSearch(e.target.value)} />
            </div>
          </div>
          {filteredContacts.length === 0 ? (
            <div className="empty-state-sm"><p className="text-sm text-muted">No contacts found.</p></div>
          ) : (
            filteredContacts.map(c => (
              <div key={c.id} className="team-member-row">
                <div className="avatar avatar-sm">{c.name.charAt(0).toUpperCase()}</div>
                <div className="team-member-info"><strong>{c.name}</strong><span className="text-muted">{c.email}{c.company ? ` · ${c.company}` : ''}</span></div>
                <button className="btn btn-ghost btn-sm" onClick={() => { contacts.toggleFavorite(c.id); state.refreshContacts(); }}><Star size={12} className={c.favorite ? 'text-primary' : ''} /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => { state.setEditingContactId(c.id); state.setContactEditorName(c.name); state.setContactEditorEmail(c.email); state.setContactEditorPhone(c.phone || ''); state.setContactEditorCompany(c.company || ''); state.setContactEditorOpen(true); }}><Edit3 size={12} /></button>
                <button className="btn btn-ghost btn-sm" onClick={() => { state.copyToClipboard(c.email); state.showToast('Email copied'); }}><Copy size={12} /></button>
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => { try { contacts.remove(c.id); state.refreshContacts(); state.showToast('Deleted'); } catch { state.showToast('Delete failed', 'error'); } }}><X size={12} /></button>
              </div>
            ))
          )}
        </div>
      )}

      {activeSettingsTab === 'security' && (
        <div className="glass-card settings-card-mb">
          <h4>Active Sessions</h4>
          <p className="text-sm text-muted mb-8">Manage devices and sessions connected to your account.</p>
          {state.activeSessions.length === 0 ? (
            <div className="empty-state-sm"><p className="text-sm text-muted">No active sessions. Click refresh to load.</p>
              <button className="btn btn-ghost btn-sm mt-4" onClick={state.refreshSessions}>Load Sessions</button>
            </div>
          ) : (
            state.activeSessions.map(s => (
              <div key={s.id} className="team-member-row">
                <div className="avatar avatar-sm"><Shield size={12} /></div>
                <div className="team-member-info">
                  <strong>{s.userAgent ? s.userAgent.slice(0, 40) : 'Unknown device'}</strong>
                  <span className="text-muted">{s.ipAddress}{s.current ? ' · Current' : ''}</span>
                </div>
                <span className="text-xs text-muted">{new Date(s.lastActive).toLocaleDateString()}</span>
                {!s.current && (
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={async () => { try { await auth.revokeSession(s.id); state.refreshSessions(); state.showToast('Session revoked'); } catch { state.showToast('Failed', 'error'); } }}><X size={12} /> Revoke</button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeSettingsTab === 'autoreply' && (
        <div className="glass-card settings-card-mb">
          <h4>Auto-Reply / Vacation Responder</h4>
          <div className="mt-8">
            <label className="flex items-center gap-2 mb-8">
              <input type="checkbox" checked={autoReply.get().enabled} onChange={e => {
                const cur = autoReply.get();
                if (e.target.checked) { autoReply.enable(cur.subject || 'Out of office', cur.body || ''); }
                else { autoReply.disable(); }
              }} />
              <span className="text-sm">Enable auto-reply</span>
            </label>
            <input className="input mb-4" placeholder="Subject (e.g., Out of office)" value={autoReply.get().subject} onChange={e => {
              const cur = autoReply.get(); autoReply.set({ ...cur, subject: e.target.value });
            }} />
            <textarea className="input mb-4" rows={4} placeholder="Body message..." value={autoReply.get().body} onChange={e => {
              const cur = autoReply.get(); autoReply.set({ ...cur, body: e.target.value });
            }} />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoReply.get().onlyContacts || false} onChange={e => {
                const cur = autoReply.get(); autoReply.set({ ...cur, onlyContacts: e.target.checked });
              }} /> Only send to contacts</label>
            </div>
          </div>
        </div>
      )}

      {activeSettingsTab === 'labels' && (
        <div className="glass-card settings-card-mb">
          <div className="flex items-center justify-between mb-8">
            <h4>Labels</h4>
            <button className="btn btn-primary btn-sm" onClick={() => {
              const name = prompt('Label name:');
              if (name) { labels.add(name, '#0d9488'); state.showToast('Label created'); }
            }}><Plus size={12} /> Add</button>
          </div>
          {labels.getAll().length === 0 ? (
            <div className="empty-state-sm"><p className="text-sm text-muted">No labels yet.</p></div>
          ) : (
            labels.getAll().map(lbl => (
              <div key={lbl.id} className="team-member-row">
                <div className="avatar avatar-sm" style={{ background: lbl.color + '30', color: lbl.color }}>{lbl.name.charAt(0).toUpperCase()}</div>
                <div className="team-member-info"><strong>{lbl.name}</strong></div>
                <input type="color" value={lbl.color} onChange={e => { labels.update(lbl.id, { color: e.target.value }); }} className="color-picker-sm" />
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => { labels.remove(lbl.id); state.showToast('Deleted'); }}><Trash2 size={12} /></button>
              </div>
            ))
          )}
        </div>
      )}

      {activeSettingsTab === 'rules' && (
        <div className="glass-card settings-card-mb">
          <div className="flex items-center justify-between mb-8">
            <h4>Email Filtering Rules</h4>
            <button className="btn btn-primary btn-sm" onClick={() => {
              const name = prompt('Rule name:');
              if (name) {
                rules.add(name, [{ field: 'subject', operator: 'contains', value: '' }], [{ type: 'label', value: '' }]);
                state.showToast('Rule created. Edit conditions below.');
              }
            }}><Plus size={12} /> Add Rule</button>
          </div>
          {rules.getAll().length === 0 ? (
            <div className="empty-state-sm"><p className="text-sm text-muted">No rules configured.</p></div>
          ) : (
            rules.getAll().map(rule => (
              <div key={rule.id} className="glass-card mb-8" style={{ padding: 12 }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={() => { rules.toggle(rule.id); }}><Power size={12} className={rule.enabled ? 'text-success' : 'text-muted'} /></button>
                    <strong className="text-sm">{rule.name}</strong>
                  </div>
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => { rules.remove(rule.id); }}><Trash2 size={12} /></button>
                </div>
                <div className="text-xs text-muted mt-4">
                  {rule.conditions.map((c, i) => (
                    <span key={i}>If <strong>{c.field}</strong> {c.operator} "{c.value}"{i < rule.conditions.length - 1 ? ' AND ' : ''}</span>
                  ))}
                  <span> → </span>
                  {rule.actions.map((a, i) => (
                    <span key={i}>{a.type}{a.value ? `: ${a.value}` : ''}{i < rule.actions.length - 1 ? ', ' : ''}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeSettingsTab === 'connections' && (
        <div className="glass-card">
          <h4>Connected Infrastructure</h4>
          {state.connectionUsage.length === 0 ? (
            <div className="empty-state-sm"><p className="text-sm text-muted">No connections configured.</p></div>
          ) : (
            state.connectionUsage.map(c => (
              <div key={c.id} className="flex items-center justify-between connection-row">
                <div><strong className="text-sm">{c.label}</strong><span className="text-xs text-muted"> {c.maskedValue} ({c.provider || 'N/A'})</span></div>
                <button className="btn btn-ghost btn-sm btn-danger" onClick={() => state.setConfirmRevokeId(c.id)}><X size={12} /> Revoke</button>
              </div>
            ))
          )}
        </div>
      )}

      <SignatureEditor state={state} sig={state.editingSignatureId ? state.signatures.find(s => s.id === state.editingSignatureId) : undefined} />
      <ContactEditor state={state} contact={state.editingContactId ? state.contacts.find(c => c.id === state.editingContactId) : undefined} />
    </div>
  );
}
