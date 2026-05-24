import { Mail, Plus, Menu, CheckCircle2, Inbox, Trash2 } from 'lucide-react';
import { businessMailboxes } from '../../../api/client';
import type { DashboardState } from '../types';
import type { BusinessMailbox } from '../../../api/client';

interface MailboxesPanelProps {
  state: DashboardState;
}

export default function MailboxesPanel({ state }: MailboxesPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><Inbox size={16} /> Business Mailboxes</h3></div>
      <p className="text-sm text-muted panel-section">Create and manage mailbox addresses for your domain.</p>
      <div className="panel-inline-form">
        <input className="input input-max-170" placeholder="Local part (e.g., hello)" value={state.mailboxLocalPart} onChange={e => state.setMailboxLocalPart(e.target.value)} />
        <span className="text-muted">@{state.activeDomainName}</span>
        <input className="input input-max-170" placeholder="Display name" value={state.mailboxDisplayName} onChange={e => state.setMailboxDisplayName(e.target.value)} />
        <select className="input input-max-140" value={state.mailboxKind} onChange={e => state.setMailboxKind(e.target.value as BusinessMailbox['kind'])}>
          <option value="primary">Primary</option><option value="mailbox">Mailbox</option><option value="alias">Alias</option><option value="shared">Shared</option>
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => {
          try {
            businessMailboxes.create(state.activeDomainName, { localPart: state.mailboxLocalPart, displayName: state.mailboxDisplayName, kind: state.mailboxKind });
            state.refreshMailboxes();
            state.setMailboxLocalPart('');
            state.setMailboxDisplayName('');
            state.showToast('Mailbox created');
          } catch (e) {
            state.showToast(e instanceof Error ? e.message : 'Failed to create mailbox', 'error');
          }
        }}><Plus size={12} /> Add</button>
      </div>
      <div className="team-list">
        {state.domainMailboxes.map(mbx => (
          <div key={mbx.address} className="team-member-row" onClick={() => state.setMailboxDetails(mbx)}>
            <div className="avatar avatar-sm"><Mail size={14} /></div>
            <div className="team-member-info"><strong>{mbx.displayName || mbx.address}</strong><span className="text-muted">{mbx.address}</span></div>
            <span className="badge badge-neutral">{mbx.kind}</span>
            <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); state.setSelectedFromAddress(mbx.address); state.showToast('Sender set'); }}><CheckCircle2 size={14} /> Set Sender</button>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={e => { e.stopPropagation(); try { businessMailboxes.remove(state.activeDomainName, mbx.address); state.refreshMailboxes(); state.showToast('Deleted'); } catch (err) { console.error('delete mailbox failed', err); state.showToast('Delete failed', 'error'); } }}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
