import { useMemo } from 'react';
import { Activity, Menu } from 'lucide-react';
import type { DashboardState } from '../types';
import { formatRelative } from '../utils';

interface AuditPanelProps {
  state: DashboardState;
}

export default function AuditPanel({ state }: AuditPanelProps) {
  const displayAudit = useMemo(() => {
    if (state.auditFilter === 'all') return state.auditLog;
    return state.auditLog.filter(e => e.severity === state.auditFilter);
  }, [state.auditLog, state.auditFilter]);

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><Activity size={18} /> Audit Log</h3>
        <select className="input input-auto" value={state.auditFilter} onChange={e => state.setAuditFilter(e.target.value)}>
          <option value="all">All Events</option><option value="info">Info</option><option value="warning">Warning</option><option value="error">Error</option>
        </select>
      </div>
      {displayAudit.map(entry => (
        <div key={entry.id} className="audit-row-flex">
          <span className={`badge badge-${entry.severity === 'error' ? 'danger' : entry.severity === 'warning' ? 'neutral' : 'success'}`}>{entry.severity}</span>
          <span className="text-sm flex-1">{entry.action}</span>
          <span className="text-xs text-muted">{entry.actor}</span>
          <span className="text-xs text-muted">{formatRelative(entry.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
