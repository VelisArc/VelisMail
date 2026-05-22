import { BarChart3, RefreshCcw, Send, Globe, Users, Layers, Server, Activity, Menu } from 'lucide-react';
import type { DashboardState } from '../types';

interface AnalyticsPanelProps {
  state: DashboardState;
}

export default function AnalyticsPanel({ state }: AnalyticsPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><BarChart3 size={18} /> Analytics</h3><button className="btn btn-ghost btn-sm" onClick={state.refreshQueue}><RefreshCcw size={14} /></button></div>
      <div className="analytics-grid">
        {[
          { label: 'Emails Sent', value: state.mailQueue.filter(i => i.status === 'sent').length, icon: Send },
          { label: 'Active Domains', value: state.domainsList.length, icon: Globe },
          { label: 'Team Members', value: state.teamMembers.length, icon: Users },
          { label: 'Templates', value: state.templates.length, icon: Layers },
          { label: 'Queue Items', value: state.mailQueue.length, icon: Server },
          { label: 'Audit Events', value: state.auditLog.length, icon: Activity },
        ].map(s => (
          <div key={s.label} className="glass-card analytics-stat">
            <s.icon size={24} className="text-primary analytics-stat-icon" />
            <strong className="analytics-stat-value">{s.value}</strong>
            <span className="text-muted text-sm">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="glass-card mt-16">
        <h4>Connection Status</h4>
        <div className="flex gap-4 mt-8">
          {[{ label: 'Mail Provider', ok: true }, { label: 'Database', ok: true }, { label: 'Primary Domain', ok: state.activeDomainName !== '' }].map(s => (
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
