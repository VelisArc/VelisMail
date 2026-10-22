import { BarChart3, RefreshCcw, Send, Globe, Users, Layers, Server, Activity, Menu } from 'lucide-react';
import type { DashboardState } from '../types';

interface AnalyticsPanelProps {
  state: DashboardState;
}

export default function AnalyticsPanel({ state }: AnalyticsPanelProps) {
  const primaryDomain = state.domainsList.find((domain) => domain.domain === state.activeDomainName);
  const connections = [
    { label: 'Mail Provider', ok: Boolean(state.user?.businessMailProvider) },
    { label: 'Database', ok: Boolean(state.user?.businessDbUrl) },
    { label: 'Primary Domain', ok: Boolean(primaryDomain && primaryDomain.status === 'active') },
  ];

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><BarChart3 size={16} /> Analytics</h3><button className="btn btn-ghost btn-sm" onClick={state.refreshQueue}><RefreshCcw size={12} /></button></div>
      <div className="analytics-grid">
        {[
          // Every figure is counted from the loaded workspace data. The label
          // says so, so a limited list is never presented as a total.
          { label: 'Delivered (loaded)', value: state.mailQueue.filter(i => i.status === 'sent').length, icon: Send },
          { label: 'Active Domains', value: state.domainsList.length, icon: Globe },
          { label: 'Team Members', value: state.teamMembers.length, icon: Users },
          { label: 'Templates', value: state.templates.length, icon: Layers },
          { label: 'Queue Items (loaded)', value: state.mailQueue.length, icon: Server },
          { label: 'Audit Events (loaded)', value: state.auditLog.length, icon: Activity },
        ].map(s => (
          <div key={s.label} className="glass-card analytics-stat">
            <s.icon size={18} className="text-primary analytics-stat-icon" />
            <strong className="analytics-stat-value">{s.value}</strong>
            <span className="text-muted text-sm">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="glass-card mt-16">
        <h4>Connection Status</h4>
        <p className="text-xs text-muted mt-1">Read from the workspace configuration. A dot turns green only when the value is really set.</p>
        <div className="flex gap-4 mt-8 flex-wrap">
          {connections.map(s => (
            <div key={s.label} className="flex items-center gap-2">
              <div className={`status-dot ${s.ok ? 'status-dot-success' : 'status-dot-danger'}`} />
              <span className="text-sm">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
