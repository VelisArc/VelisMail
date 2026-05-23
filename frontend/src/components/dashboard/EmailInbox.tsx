import { useState, useMemo, useDeferredValue, memo, useCallback, type FC } from 'react';
import {
  Mail, Star, Archive, Trash2, Search, Paperclip, ArrowLeft,
  Reply, Forward, RefreshCcw, List as ListIcon, Grid,
  SortAsc, SortDesc, Menu, CheckSquare, Square, Trash,
  Eye, EyeOff, Shield, AlertTriangle,
} from 'lucide-react';
import type { Email } from '../../api/client';
import { mail } from '../../api/client';
import { parseEmailConversation, getEmailPreview } from './utils';
import type { DashboardState } from './types';

interface EmailInboxProps {
  emails: Email[];
  isLoading?: boolean;
  state: DashboardState;
  onRefresh: () => void;
  onToggleStar: (id: string) => void;
  onArchive: (ids: string[]) => void;
  onTrash: (ids: string[]) => void;
  onReply: (email: Email) => void;
  onForward: (email: Email) => void;
  onToggleRead?: (id: string, unread: boolean) => void;
  onMarkSpam?: (id: string) => void;
  onTogglePriority?: (id: string) => void;
}

const AVATAR_COLORS = ['#0d9488','#0891b2','#2563eb','#7c3aed','#db2777','#dc2626','#ea580c','#ca8a04','#16a34a','#059669'];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function avatarInitial(name: string): string {
  return (name || '?').charAt(0).toUpperCase();
}

const EmailRow = memo(({ email, state, onOpen }: {
  email: Email;
  state: DashboardState;
  onOpen: (e: Email) => void;
}) => (
  <div className="mail-row-wrapper" onClick={() => onOpen(email)}>
    <div className={`mail-row ${email.unread ? 'unread' : ''}`}>
      <div className="mail-row-select" onClick={e => e.stopPropagation()}>
        <input type="checkbox" aria-label={`Select email from ${email.fromName || email.from}`} checked={state.selectedEmails.has(email.id)} onChange={() => {
          const next = new Set(state.selectedEmails);
          if (next.has(email.id)) next.delete(email.id); else next.add(email.id);
          state.setSelectedEmails(next);
        }} />
      </div>
      <div className="avatar avatar-sm" style={{ background: avatarColor(email.fromName || email.from) + '20', color: avatarColor(email.fromName || email.from) }}>
        {avatarInitial(email.fromName || email.from)}
      </div>
      <div className="mail-row-main">
        <div className="mail-row-headline">
          <strong className="mail-from">{email.fromName || email.from}</strong>
          <span className="mail-subj">{email.subject || '(No subject)'}</span>
        </div>
        <span className="mail-preview">{getEmailPreview(email.body, 140)}</span>
      </div>
      <div className="mail-row-meta">
        <span className="mail-date">{new Date(email.date).toLocaleDateString()}</span>
        {email.starred && <Star size={12} className="text-primary" />}
        {email.hasAttachment && <Paperclip size={12} className="text-muted" />}
      </div>
    </div>
  </div>
));

const EmailInbox: FC<EmailInboxProps> = ({
  emails, isLoading, state, onRefresh, onToggleStar,
  onArchive, onTrash, onReply, onForward,
  onToggleRead, onMarkSpam, onTogglePriority,
}) => {
  const [focusedEmail, setFocusedEmail] = useState<Email | null>(null);
  const deferredQuery = useDeferredValue(state.searchQuery);

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase();
    const withTimestamps = emails.map(e => ({
      email: e,
      time: new Date(e.date).getTime(),
    }));
    const matched = withTimestamps.filter(({ email }) => {
      if (state.mailStatusFilter === 'unread' && !email.unread) return false;
      if (state.mailStatusFilter === 'read' && email.unread) return false;
      if (state.mailStatusFilter === 'starred' && !email.starred) return false;
      if (state.mailStatusFilter === 'attachments' && !email.hasAttachment) return false;
      if (!q) return true;
      return email.subject?.toLowerCase().includes(q) || email.from?.toLowerCase().includes(q) || email.body?.toLowerCase().includes(q) || email.fromName?.toLowerCase().includes(q);
    });
    matched.sort((a, b) => state.sortOrder === 'desc' ? b.time - a.time : a.time - b.time);
    return matched;
  }, [emails, deferredQuery, state.mailStatusFilter, state.sortOrder]);

  const openEmail = useCallback((email: Email) => setFocusedEmail(email), []);
  const closeReader = useCallback(() => setFocusedEmail(null), []);

  const conversation = useMemo(() => focusedEmail ? parseEmailConversation(focusedEmail.body) : [], [focusedEmail]);

  const allSelected = filtered.length > 0 && filtered.every(({ email }) => state.selectedEmails.has(email.id));
  const toggleSelectAll = () => {
    if (allSelected) {
      state.setSelectedEmails(new Set());
    } else {
      state.setSelectedEmails(new Set(filtered.map(({ email }) => email.id)));
    }
  };

  const isTrash = state.activeFolder === 'trash';

  const handleDeletePermanently = (id: string) => {
    try {
      mail.deletePermanently(id);
      closeReader();
      onRefresh();
    } catch (e) {
      console.error('permanent delete failed', e);
    }
  };

  const handleBulkDeletePermanently = () => {
    try {
      const ids = [...state.selectedEmails];
      ids.forEach(id => mail.deletePermanently(id));
      state.setSelectedEmails(new Set());
      onRefresh();
    } catch (e) {
      console.error('bulk permanent delete failed', e);
    }
  };

  return (
    <div className="dash-panel">
      <div className="panel-header mail-panel-header">
        <div className="mail-panel-title">
          <button type="button" className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={16} />
          </button>
          <h3>
            <Mail size={18} /> {state.activeFolder.charAt(0).toUpperCase() + state.activeFolder.slice(1)}
          </h3>
        </div>
        <div className="panel-header-actions">
          <span className="badge badge-neutral">{filtered.length}</span>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onRefresh} aria-label="Refresh"><RefreshCcw size={16} /></button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => state.setViewMode(state.viewMode === 'list' ? 'grid' : 'list')} aria-label="Toggle view">
            {state.viewMode === 'list' ? <Grid size={16} /> : <ListIcon size={16} />}
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => state.setSortOrder(state.sortOrder === 'desc' ? 'asc' : 'desc')} aria-label="Toggle sort">
            {state.sortOrder === 'desc' ? <SortDesc size={16} /> : <SortAsc size={16} />}
          </button>
        </div>
      </div>

      <div className="dash-search mail-search-bar">
        <div className="mail-search-input">
          <Search size={14} className="search-icon" />
          <input
            className="input search-input"
            placeholder="Search mail..."
            value={state.searchQuery}
            onChange={e => state.setSearchQuery(e.target.value)}
          />
        </div>
        <div className="mail-filter-tabs">
          {['all', 'unread', 'read', 'starred', 'attachments'].map(f => (
            <button
              key={f}
              type="button"
              className={`btn btn-sm ${state.mailStatusFilter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => state.setMailStatusFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {state.selectedEmails.size > 0 && (
        <div className="bulk-bar">
          <span className="text-xs text-muted">{state.selectedEmails.size} selected</span>
          <button className="btn btn-ghost btn-sm" onClick={() => state.setSelectedEmails(new Set())}><Square size={14} /> Clear</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { onArchive([...state.selectedEmails]); state.setSelectedEmails(new Set()); }}><Archive size={14} /> Archive</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { onTrash([...state.selectedEmails]); state.setSelectedEmails(new Set()); }}><Trash2 size={14} /> Trash</button>
          {isTrash && (
            <button className="btn btn-ghost btn-sm btn-danger" onClick={handleBulkDeletePermanently}><Trash size={14} /> Delete Forever</button>
          )}
        </div>
      )}

      <div className="dash-body">
        {focusedEmail ? (
          <div className="dash-reader">
            <div className="reader-toolbar">
              <button type="button" className="btn btn-ghost btn-icon" onClick={closeReader}><ArrowLeft size={16} /></button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReply(focusedEmail)}><Reply size={14} /> Reply</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onForward(focusedEmail)}><Forward size={14} /> Forward</button>
              <button type="button" className={`btn btn-ghost btn-sm ${focusedEmail.starred ? 'text-primary' : ''}`} onClick={() => onToggleStar(focusedEmail.id)}><Star size={14} /></button>
              {onToggleRead && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onToggleRead(focusedEmail.id, focusedEmail.unread); closeReader(); }}>
                  {focusedEmail.unread ? <Eye size={14} /> : <EyeOff size={14} />} {focusedEmail.unread ? 'Mark Read' : 'Mark Unread'}
                </button>
              )}
              {onMarkSpam && state.activeFolder !== 'spam' && state.activeFolder !== 'trash' && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onMarkSpam(focusedEmail.id); closeReader(); }}>
                  <AlertTriangle size={14} /> Spam
                </button>
              )}
              {onTogglePriority && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onTogglePriority(focusedEmail.id); }}>
                  <Shield size={14} /> {focusedEmail.labels?.includes('priority') ? 'Unmark' : 'Priority'}
                </button>
              )}
              {!isTrash && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onArchive([focusedEmail.id]); closeReader(); }}>
                  <Archive size={14} /> Archive
                </button>
              )}
              {!isTrash ? (
                <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => { onTrash([focusedEmail.id]); closeReader(); }}>
                  <Trash2 size={14} /> Trash
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => handleDeletePermanently(focusedEmail.id)}>
                  <Trash size={14} /> Delete Forever
                </button>
              )}
            </div>
            <div className="reader-header">
              <h2>{focusedEmail.subject || '(No subject)'}</h2>
              {focusedEmail.labels?.map((l: string) => (
                <span key={l} className="badge badge-neutral">{l}</span>
              ))}
            </div>
            <div className="reader-meta">
              <div className="avatar avatar-sm" style={{ background: avatarColor(focusedEmail.fromName || focusedEmail.from) + '20', color: avatarColor(focusedEmail.fromName || focusedEmail.from) }}>{avatarInitial(focusedEmail.fromName || focusedEmail.from)}</div>
              <div>
                <strong>{focusedEmail.fromName || focusedEmail.from}</strong>
                <span className="text-muted">&lt;{focusedEmail.from}&gt;</span>
                {focusedEmail.to && <span className="text-muted">to {focusedEmail.to}</span>}
              </div>
              <span className="reader-date">{new Date(focusedEmail.date).toLocaleString()}</span>
            </div>
            <div className="reader-body">
              {conversation.map((seg, i) => (
                <div key={i} className={`conversation-segment ${seg.kind}`}>
                  {seg.lines.map((line, j) => (
                    <p key={j}>{line || '\u00A0'}</p>
                  ))}
                </div>
              ))}
            </div>
            {focusedEmail.hasAttachment && (
              <div className="reader-attachments">
                <Paperclip size={14} /> Has attachment(s)
              </div>
            )}
          </div>
        ) : (
          <div className="dash-list" style={{ height: '100%', overflow: 'hidden' }}>
            {isLoading ? (
              <div className="dash-list-scroll">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="skeleton-row">
                    <div className="skeleton-avatar" />
                    <div><div className="skeleton-line short" /><div className="skeleton-line medium" /></div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <Mail size={48} className="text-muted" />
                <h3>No messages</h3>
                <p className="text-muted">Your {state.activeFolder} folder is empty.</p>
              </div>
            ) : state.viewMode === 'grid' ? (
              <div className="mail-grid">
                {filtered.map(({ email }) => (
                  <div key={email.id} className={`mail-grid-card ${email.unread ? 'unread' : ''}`} onClick={() => openEmail(email)}>
                    <div className="flex items-center gap-2">
                      <div className="avatar avatar-sm" style={{ background: avatarColor(email.fromName || email.from) + '20', color: avatarColor(email.fromName || email.from) }}>{avatarInitial(email.fromName || email.from)}</div>
                      <strong className="truncate">{email.fromName || email.from}</strong>
                    </div>
                    <h4 className="truncate">{email.subject || '(No subject)'}</h4>
                    <p className="truncate text-muted text-sm">{getEmailPreview(email.body, 80)}</p>
                    <span className="text-xs text-muted">{new Date(email.date).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dash-list-scroll">
                {filtered.length > 20 && (
                  <div className="mail-select-all" onClick={toggleSelectAll}>
                    {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                    <span>{allSelected ? 'Deselect all' : 'Select all'} ({filtered.length})</span>
                  </div>
                )}
                {filtered.map(({ email }) => (
                  <EmailRow
                    key={email.id}
                    email={email}
                    state={state}
                    onOpen={openEmail}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(EmailInbox);
