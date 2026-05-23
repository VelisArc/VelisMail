import { Layers, Plus, Menu, Eye, Trash2 } from 'lucide-react';
import { businessTemplates } from '../../../api/client';
import type { DashboardState } from '../types';

interface TemplatesPanelProps {
  state: DashboardState;
}

export default function TemplatesPanel({ state }: TemplatesPanelProps) {
  return (
    <div className="dash-panel">
      <div className="panel-header"><button className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={16} /></button><h3><Layers size={16} /> Templates</h3><button className="btn btn-primary btn-sm" onClick={() => { state.setTemplateEditorOpen(true); state.setTemplateName(''); state.setTemplateSubject(''); state.setTemplateBody(''); }}><Plus size={12} /> New Template</button></div>
      <input className="input mb-16" placeholder="Search templates..." value={state.templateSearch} onChange={e => state.setTemplateSearch(e.target.value)} />
      <div className="templates-grid">
        {state.templates.filter(t => t.name.toLowerCase().includes(state.templateSearch.toLowerCase())).map(t => (
          <div key={t.id} className="glass-card cursor-pointer">
            <strong>{t.name}</strong>
            <span className="text-sm text-muted truncate text-block">{t.subject}</span>
            <p className="text-xs text-muted">{t.body?.slice(0, 100)}...</p>
            <div className="flex gap-2 mt-8">
              <button className="btn btn-ghost btn-sm" onClick={() => state.setPreviewTemplate(t)}><Eye size={12} /> Preview</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { try { businessTemplates.delete(state.activeDomainName, t.id); state.refreshTemplates(); state.showToast('Deleted'); } catch (e) { console.error('delete template failed', e); state.showToast('Delete failed', 'error'); } }}><Trash2 size={12} /> Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
