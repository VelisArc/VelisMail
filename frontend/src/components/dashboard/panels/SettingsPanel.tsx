import { Settings, Menu, X } from 'lucide-react';
import type { DashboardState } from '../types';

interface SettingsPanelProps {
  state: DashboardState;
}

export default function SettingsPanel({ state }: SettingsPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><Settings size={18} /> Settings</h3></div>
      <div className="glass-card settings-card-mb">
        <h4>Notifications</h4>
        <div className="flex items-center gap-4 mt-8">
          <label className="flex items-center gap-2"><input type="checkbox" checked={state.notificationEnabled} onChange={e => state.setNotificationEnabled(e.target.checked)} /> <span className="text-sm">Enable notifications</span></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={state.soundEnabled} onChange={e => state.setSoundEnabled(e.target.checked)} /> <span className="text-sm">Play sounds</span></label>
        </div>
      </div>
      <div className="glass-card settings-card-mb">
        <h4>Default Sending Domain</h4>
        <select className="input input-auto mt-8" value={state.activeDomainName} onChange={e => state.setActiveDomain(state.domainsList.find(d => d.domain === e.target.value)?.id || '')}>
          {state.domainsList.map(d => <option key={d.id} value={d.domain}>{d.domain}</option>)}
        </select>
      </div>
      <div className="glass-card">
        <h4>Connected Infrastructure</h4>
        {state.connectionUsage.map(c => (
          <div key={c.id} className="flex items-center justify-between connection-row">
            <div><strong className="text-sm">{c.label}</strong><span className="text-xs text-muted"> {c.maskedValue} ({c.provider || 'N/A'})</span></div>
            <button className="btn btn-ghost btn-sm btn-danger" onClick={() => state.setConfirmRevokeId(c.id)}><X size={12} /> Revoke</button>
          </div>
        ))}
      </div>
    </div>
  );
}
