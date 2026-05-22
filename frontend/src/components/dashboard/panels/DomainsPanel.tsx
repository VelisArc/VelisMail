import { Globe, Plus, Menu, RefreshCcw, Copy, Shield } from 'lucide-react';
import type { DashboardState } from '../types';

interface DomainsPanelProps {
  state: DashboardState;
  handleAddDomain: () => void;
  handleVerifyDomain: (id: string) => void;
}

export default function DomainsPanel({ state, handleAddDomain, handleVerifyDomain }: DomainsPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header">
        <button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button>
        <h3><Globe size={18} /> Domains</h3>
        <button className="btn btn-primary btn-sm" onClick={() => state.setShowAddDomain(!state.showAddDomain)}><Plus size={14} /> Add Domain</button>
      </div>
      {state.showAddDomain && (
        <div className="panel-inline-form">
          <input className="input" placeholder="example.com" value={state.newDomainInput} onChange={e => state.setNewDomainInput(e.target.value)} />
          <button className="btn btn-primary" onClick={handleAddDomain}><Plus size={14} /> Add</button>
          <button className="btn btn-ghost" onClick={() => { state.setShowAddDomain(false); state.setNewDomainInput(''); }}>Cancel</button>
        </div>
      )}
      {state.domainsList.length === 0 ? (
        <div className="empty-state"><Globe size={48} className="text-muted" /><h3>No domains</h3><p className="text-muted">Add your first domain to get started.</p></div>
      ) : (
        <div className="domain-grid">
          {state.domainsList.map(dom => (
            <div key={dom.id} className="domain-card glass-card" onClick={() => state.setDomainDetails(dom)}>
              <div className="domain-card-header"><strong>{dom.domain}</strong><span className={`badge badge-${dom.status === 'active' ? 'success' : 'neutral'}`}>{dom.status}</span></div>
              <div className="domain-metrics"><span>{dom.mailCount} sent</span><span>{dom.reputation}% rep</span></div>
              <div className="domain-health">
                {dom.health.map(h => (
                  <div key={h.key} className={`health-item ${h.status}`}><Shield size={12} /><span>{h.label}</span></div>
                ))}
              </div>
              <div className="domain-card-actions">
                <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); handleVerifyDomain(dom.id); }}><RefreshCcw size={12} /> Verify</button>
                <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); state.copyToClipboard(dom.domain); state.showToast('Copied'); }}><Copy size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
