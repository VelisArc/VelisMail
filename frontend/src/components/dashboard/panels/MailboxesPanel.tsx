import { useState } from 'react';
import { ArrowRight, Database, Info, Mail, Plus, Menu, CheckCircle2, Inbox, Trash2 } from 'lucide-react';
import { businessMailboxes } from '../../../api/client';
import type { DashboardState } from '../types';
import type { BusinessMailbox } from '../../../api/client';

interface MailboxesPanelProps {
  state: DashboardState;
}

export default function MailboxesPanel({ state }: MailboxesPanelProps) {
  const [savingMailbox, setSavingMailbox] = useState(false);
  const [deletingAddress, setDeletingAddress] = useState('');

  const handleCreateMailbox = async () => {
    setSavingMailbox(true);
    try {
      const mailbox = await businessMailboxes.create(state.activeDomainName, {
        localPart: state.mailboxLocalPart,
        displayName: state.mailboxDisplayName,
        kind: state.mailboxKind,
      });
      await state.refreshMailboxes();
      state.setMailboxLocalPart('');
      state.setMailboxDisplayName('');
      state.setActiveMailboxAddress(mailbox.address);
      state.setSelectedFromAddress(mailbox.address);
      state.setActiveFolder('inbox');
      state.setActiveBizTab('mail');
      state.showToast('Mailbox created and inbox opened');
    } catch (e) {
      state.showToast(e instanceof Error ? e.message : 'Failed to create mailbox', 'error');
    } finally {
      setSavingMailbox(false);
    }
  };

  const handleDeleteMailbox = async (address: string) => {
    setDeletingAddress(address);
    try {
      await businessMailboxes.remove(state.activeDomainName, address);
      await state.refreshMailboxes();
      if (state.activeMailboxAddress === address) {
        state.setActiveMailboxAddress('');
      }
      state.showToast('Deleted');
    } catch (err) {
      console.error('delete mailbox failed', err);
      state.showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setDeletingAddress('');
    }
  };

  const openMailboxInbox = (mailbox: BusinessMailbox) => {
    state.setActiveMailboxAddress(mailbox.address);
    state.setSelectedFromAddress(mailbox.address);
    state.setActiveFolder('inbox');
    state.setActiveBizTab('mail');
    state.setSelectedEmails(new Set());
    state.showToast(`Showing inbox for ${mailbox.address}`);
  };

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><Inbox size={16} /> Business Mailboxes</h3></div>
      <div className="mailbox-panel-summary panel-section">
        <p className="text-sm text-muted">Create and manage mailbox addresses for your domain. Click a mailbox to open its filtered inbox.</p>
        <span className={`badge ${state.user?.businessDbUrl ? 'badge-success' : 'badge-neutral'} mailbox-db-status`}>
          <Database size={12} /> {state.user?.businessDbUrl ? 'Database synced' : 'Local setup'}
        </span>
      </div>
      <div className="panel-inline-form">
        <input className="input input-max-200" placeholder="Local part (e.g., hello)" value={state.mailboxLocalPart} onChange={e => state.setMailboxLocalPart(e.target.value)} />
        <span className="text-muted">@{state.activeDomainName}</span>
        <input className="input input-max-200" placeholder="Display name" value={state.mailboxDisplayName} onChange={e => state.setMailboxDisplayName(e.target.value)} />
        <select className="input input-max-140" value={state.mailboxKind} onChange={e => state.setMailboxKind(e.target.value as BusinessMailbox['kind'])}>
          <option value="primary">Primary</option><option value="mailbox">Mailbox</option><option value="alias">Alias</option><option value="shared">Shared</option>
        </select>
        <button className="btn btn-primary btn-sm" disabled={savingMailbox} onClick={handleCreateMailbox}><Plus size={12} /> {savingMailbox ? 'Saving' : 'Add'}</button>
      </div>
      <div className="team-list">
        {state.domainMailboxes.map(mbx => (
          <div key={mbx.address} className={`team-member-row mailbox-row ${state.activeMailboxAddress === mbx.address ? 'active' : ''}`} onClick={() => openMailboxInbox(mbx)} role="button" tabIndex={0}>
            <div className="avatar avatar-sm"><Mail size={14} /></div>
            <div className="team-member-info"><strong>{mbx.displayName || mbx.address}</strong><span className="text-muted">{mbx.address}</span></div>
            <span className="badge badge-neutral">{mbx.kind}</span>
            <div className="mailbox-row-actions">
              <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openMailboxInbox(mbx); }}><ArrowRight size={14} /> Inbox</button>
              <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); state.setSelectedFromAddress(mbx.address); state.showToast('Sender set'); }}><CheckCircle2 size={14} /> Sender</button>
              <button className="btn btn-ghost btn-sm" title="Mailbox details" onClick={e => { e.stopPropagation(); state.setMailboxDetails(mbx); }}><Info size={14} /></button>
              <button className="btn btn-ghost btn-sm btn-danger" disabled={deletingAddress === mbx.address} onClick={e => { e.stopPropagation(); void handleDeleteMailbox(mbx.address); }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
