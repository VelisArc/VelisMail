import { useMemo } from 'react';
import { Server, Filter, RefreshCcw, Zap, Trash2, Menu, X } from 'lucide-react';
import { businessQueue } from '../../../api/client';
import type { DashboardState } from '../types';
import { formatRelative } from '../utils';

interface QueuePanelProps {
  state: DashboardState;
}

export default function QueuePanel({ state }: QueuePanelProps) {
  const displayQueue = useMemo(() => {
    const q = state.mailQueue;
    if (state.queueStatusFilter === 'all') return q;
    return q.filter(i => i.status === state.queueStatusFilter);
  }, [state.mailQueue, state.queueStatusFilter]);

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><Server size={16} /> Mail Queue</h3><div className="panel-header-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => state.setShowQueueFilters(!state.showQueueFilters)}><Filter size={12} /></button>
        <button className="btn btn-ghost btn-sm" onClick={state.refreshQueue}><RefreshCcw size={12} /></button>
        <button className="btn btn-primary btn-sm" onClick={() => { businessQueue.runDue(state.activeDomainName); state.refreshQueue(); state.showToast('Due items triggered'); }}><Zap size={12} /> Run Due</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { const c = businessQueue.clearSent(state.activeDomainName); state.refreshQueue(); state.showToast(`Cleared ${c} sent items`); }}><Trash2 size={12} /> Clear Sent</button>
      </div></div>
      {state.showQueueFilters && (
        <div className="flex gap-2 queue-filters-bar">
          {['all', 'queued', 'scheduled', 'sending', 'failed', 'deferred'].map(f => (
            <button key={f} className={`btn btn-sm ${state.queueStatusFilter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => state.setQueueStatusFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>
      )}
      <div className="queue-stats">
        {[{ label: 'Queued', count: state.mailQueue.filter(i => i.status === 'queued').length }, { label: 'Scheduled', count: state.mailQueue.filter(i => i.status === 'scheduled').length }, { label: 'Sending', count: state.mailQueue.filter(i => i.status === 'sending').length }, { label: 'Failed', count: state.mailQueue.filter(i => i.status === 'failed').length }, { label: 'Deferred', count: state.mailQueue.filter(i => i.status === 'deferred').length }].map(s => (
          <div key={s.label} className="glass-card queue-stat-item"><strong className="queue-stat-value">{s.count}</strong><span className="text-muted text-sm">{s.label}</span></div>
        ))}
      </div>
      {displayQueue.map(item => (
        <div key={item.id} className="queue-row-flex">
          <span className={`badge badge-${item.status === 'failed' ? 'danger' : item.status === 'sent' ? 'success' : 'neutral'}`}>{item.status}</span>
          <span className="text-sm truncate flex-1">{item.to}</span>
          <span className="text-sm truncate flex-2">{item.subject}</span>
          <span className="text-xs text-muted">{formatRelative(item.queuedAt)}</span>
          {item.error && <span className="text-xs text-danger">{item.error}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => { businessQueue.retry(state.activeDomainName, item.id); state.refreshQueue(); }}><RefreshCcw size={12} /></button>
          <button className="btn btn-ghost btn-sm" onClick={() => { businessQueue.remove(item.id); state.refreshQueue(); }}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}
