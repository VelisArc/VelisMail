import { Users, Plus, Menu } from 'lucide-react';
import { businessGroups } from '../../../api/client';
import type { DashboardState } from '../types';

interface GroupsPanelProps {
  state: DashboardState;
}

export default function GroupsPanel({ state }: GroupsPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={20} /></button><h3><Users size={18} /> Distribution Groups</h3></div>
      <div className="panel-inline-form flex-wrap">
        <input className="input input-max-180" placeholder="Group name" value={state.groupName} onChange={e => state.setGroupName(e.target.value)} />
        <input className="input input-max-160" placeholder="Local part" value={state.groupLocalPart} onChange={e => state.setGroupLocalPart(e.target.value)} />
        <span className="text-muted">@{state.activeDomainName}</span>
        <input className="input flex-1" placeholder="Members (comma-separated emails)" value={state.groupMembers} onChange={e => state.setGroupMembers(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={() => {
          try {
            businessGroups.create(state.activeDomainName, { name: state.groupName, localPart: state.groupLocalPart, members: state.groupMembers.split(',').map(s => s.trim()).filter(Boolean) });
            state.refreshGroups();
            state.setGroupName('');
            state.setGroupLocalPart('');
            state.setGroupMembers('');
            state.showToast('Group created');
          } catch (e) {
            state.showToast(e instanceof Error ? e.message : 'Failed to create group', 'error');
          }
        }}><Plus size={14} /> Create</button>
      </div>
      {state.domainGroups.length === 0 ? (
        <div className="empty-state"><Users size={48} className="text-muted" /><h3>No groups</h3></div>
      ) : (
        <div className="groups-grid">
          {state.domainGroups.map(g => (
            <div key={g.address} className="glass-card cursor-pointer" onClick={() => state.setGroupDetails(g)}>
              <strong>{g.name || g.address}</strong>
              <span className="text-muted text-sm">{g.address}</span>
              <span className="text-xs text-muted">{g.members.length} members</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
