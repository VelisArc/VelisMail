import { Layers, Plus, Menu, Eye, Trash2 } from 'lucide-react';
import { workspaceApi } from '../../../api/company';
import type { DashboardState } from '../types';
import { canEditWorkspaceContent } from '../constants';

interface TemplatesPanelProps {
  state: DashboardState;
}

export default function TemplatesPanel({ state }: TemplatesPanelProps) {
  const canEdit = canEditWorkspaceContent(state.user?.role);
  const handleDelete = async (id: string) => {
    try {
      // The template is removed from the database of the company, so it does
      // not come back with the next refresh.
      await workspaceApi.deleteTemplate(id);
      await state.refreshTemplates();
      state.showToast('Template deleted');
    } catch (error) {
      state.showToast(error instanceof Error ? error.message : 'Delete failed', 'error');
    }
  };

  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><Layers size={16} /> Templates</h3>{canEdit && (<button className="btn btn-primary btn-sm" onClick={() => { state.setTemplateEditorOpen(true); state.setTemplateName(''); state.setTemplateSubject(''); state.setTemplateBody(''); }}><Plus size={12} /> New Template</button>)}</div>
      <input className="input mb-16" placeholder="Search templates..." value={state.templateSearch} onChange={e => state.setTemplateSearch(e.target.value)} />
      <div className="templates-grid">
        {state.templates.filter(t => t.name.toLowerCase().includes(state.templateSearch.toLowerCase())).map(t => (
          <div key={t.id} className="glass-card cursor-pointer">
            <strong>{t.name}</strong>
            <span className="text-sm text-muted truncate text-block">{t.subject}</span>
            <p className="text-xs text-muted">{t.body?.slice(0, 100)}...</p>
            <div className="flex gap-2 mt-8">
              <button className="btn btn-ghost btn-sm" onClick={() => state.setPreviewTemplate(t)}><Eye size={12} /> Preview</button>
              {canEdit && (<button className="btn btn-ghost btn-sm" onClick={() => void handleDelete(t.id)}><Trash2 size={12} /> Delete</button>)}
            </div>
          </div>
        ))}
      </div>
      {state.templates.length === 0 && (
        <div className="empty-state"><Layers size={48} className="text-muted" /><h3>No templates</h3><p className="text-muted">Save a message you send often as a template.</p></div>
      )}
    </div>
  );
}
