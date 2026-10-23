import { useState } from 'react';
import { Users, Plus, Menu, Trash2 } from 'lucide-react';
import { workspaceApi } from '../../../api/company';
import type { DashboardState } from '../types';
import { canManageWorkspace } from '../constants';

interface GroupsPanelProps {
  state: DashboardState;
}

export default function GroupsPanel({ state }: GroupsPanelProps) {
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const canManage = canManageWorkspace(state.user?.role);

  const handleCreate = async () => {
    const name = state.groupName.trim();
    const localPart = state.groupLocalPart.trim();
    if (!name || !localPart) {
      state.showToast('Enter a group name and a local part.', 'error');
      return;
    }
    setSaving(true);
    try {
      // The group is written to the database of the company, so it survives a
      // refresh and can be used as a recipient.
      await workspaceApi.saveGroup({
        domain: state.activeDomainName,
        name,
        address: `${localPart}@${state.activeDomainName}`.toLowerCase(),
        members: state.groupMembers.split(',').map((member) => member.trim()).filter(Boolean),
      });
      await state.refreshGroups();
      state.setGroupName('');
      state.setGroupLocalPart('');
      state.setGroupMembers('');
      state.showToast('Group created');
    } catch (error) {
      state.showToast(error instanceof Error ? error.message : 'Failed to create group', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await workspaceApi.deleteGroup(id);
      await state.refreshGroups();
      state.showToast('Group deleted');
    } catch (error) {
      state.showToast(error instanceof Error ? error.message : 'Delete failed', 'error');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><Users size={16} /> Distribution Groups</h3></div>
      {canManage ? (
        <div className="panel-inline-form flex-wrap">
          <input className="input input-max-180" placeholder="Group name" value={state.groupName} onChange={e => state.setGroupName(e.target.value)} />
          <input className="input input-max-160" placeholder="Local part" value={state.groupLocalPart} onChange={e => state.setGroupLocalPart(e.target.value)} />
          <span className="text-muted">@{state.activeDomainName}</span>
          <input className="input flex-1" placeholder="Members (comma-separated emails)" value={state.groupMembers} onChange={e => state.setGroupMembers(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => void handleCreate()}>
            <Plus size={12} /> {saving ? 'Creating' : 'Create'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted panel-section">Only owners and admins can create or delete groups.</p>
      )}
      {state.domainGroups.length === 0 ? (
        <div className="empty-state"><Users size={48} className="text-muted" /><h3>No groups</h3><p className="text-muted">Create a group to send to many people at once.</p></div>
      ) : (
        <div className="groups-grid">
          {state.domainGroups.map(g => (
            <div key={g.id || g.address} className="glass-card cursor-pointer" onClick={() => state.setGroupDetails(g)}>
              <strong>{g.name || g.address}</strong>
              <span className="text-muted text-sm">{g.address}</span>
              <span className="text-xs text-muted">{g.members.length} members</span>
              {canManage && (
                <button className="btn btn-ghost btn-sm btn-danger mt-8" disabled={deletingId === g.id} onClick={e => { e.stopPropagation(); void handleDelete(g.id); }}><Trash2 size={12} /> Delete</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
