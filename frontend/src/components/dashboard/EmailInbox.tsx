import { useState, useMemo, useDeferredValue, memo, useCallback, type FC } from 'react';
import {
  Mail, Star, Archive, Trash2, Search, Paperclip, ArrowLeft,
  Reply, Forward, RefreshCcw, List as ListIcon, LayoutGrid,
  ArrowUpDown, Menu, CheckSquare, Square, Trash,
  Eye, EyeOff, Shield, AlertTriangle, X,
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
  const [searchExpanded, setSearchExpanded] = useState(false);
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
  const folderTitle = state.activeFolder.charAt(0).toUpperCase() + state.activeFolder.slice(1);
  const filterOptions = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'read', label: 'Read' },
    { id: 'starred', label: 'Starred' },
    { id: 'attachments', label: 'Attach' },
  ];

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
      {/* ── Compact Single-Row Toolbar ── */}
      <div className="inbox-toolbar" role="toolbar" aria-label="Mailbox controls">
        <button type="button" className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)} aria-label="Open menu">
          <Menu size={16} />
        </button>
        <h3 className="inbox-title">
          <Mail size={15} /> {folderTitle}
          <span className="inbox-count">{filtered.length}</span>
        </h3>

        <div className="toolbar-spacer" />

        {/* Inline search */}
        <div className={`toolbar-search ${searchExpanded ? 'expanded' : ''}`}>
          {searchExpanded ? (
            <>
              <Search size={13} className="toolbar-search-icon" />
              <input
                className="toolbar-search-input"
                placeholder="Search..."
                value={state.searchQuery}
                onChange={e => state.setSearchQuery(e.target.value)}
                autoFocus
              />
              <button type="button" className="toolbar-icon" onClick={() => { setSearchExpanded(false); state.setSearchQuery(''); }} aria-label="Close search">
                <X size={13} />
              </button>
            </>
          ) : (
            <button type="button" className="toolbar-icon" onClick={() => setSearchExpanded(true)} aria-label="Search">
              <Search size={14} />
            </button>
          )}
        </div>

        {/* Action icons */}
        <button type="button" className="toolbar-icon" onClick={onRefresh} aria-label="Refresh" title="Refresh">
          <RefreshCcw size={14} />
        </button>
        <button type="button" className="toolbar-icon" onClick={() => state.setViewMode(state.viewMode === 'list' ? 'grid' : 'list')} aria-label="Toggle view" title={state.viewMode === 'list' ? 'Grid view' : 'List view'}>
          {state.viewMode === 'list' ? <LayoutGrid size={14} /> : <ListIcon size={14} />}
        </button>
        <button type="button" className="toolbar-icon" onClick={() => state.setSortOrder(state.sortOrder === 'desc' ? 'asc' : 'desc')} aria-label="Toggle sort" title={state.sortOrder === 'desc' ? 'Oldest first' : 'Newest first'}>
          <ArrowUpDown size={14} />
        </button>
      </div>

      {/* ── Compact Filter Pills ── */}
      <div className="inbox-filters" role="tablist" aria-label="Email filters">
        {filterOptions.map(f => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={state.mailStatusFilter === f.id}
            className={`filter-pill ${state.mailStatusFilter === f.id ? 'active' : ''}`}
            onClick={() => state.setMailStatusFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Bulk Actions Bar ── */}
      {state.selectedEmails.size > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="text-xs text-muted">{state.selectedEmails.size} selected</span>
          <button className="toolbar-icon" onClick={() => state.setSelectedEmails(new Set())} aria-label="Clear selection" title="Clear"><Square size={13} /></button>
          <button className="toolbar-icon" onClick={() => { onArchive([...state.selectedEmails]); state.setSelectedEmails(new Set()); }} aria-label="Archive selected" title="Archive"><Archive size={13} /></button>
          <button className="toolbar-icon" onClick={() => { onTrash([...state.selectedEmails]); state.setSelectedEmails(new Set()); }} aria-label="Trash selected" title="Trash"><Trash2 size={13} /></button>
          {isTrash && (
            <button className="toolbar-icon toolbar-icon-danger" onClick={handleBulkDeletePermanently} aria-label="Delete forever" title="Delete Forever"><Trash size={13} /></button>
          )}
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="dash-body">
        {focusedEmail ? (
          <div className="dash-reader">
            <div className="reader-toolbar">
              <button type="button" className="toolbar-icon" onClick={closeReader} aria-label="Back"><ArrowLeft size={15} /></button>
              <button type="button" className="toolbar-icon" onClick={() => onReply(focusedEmail)} aria-label="Reply" title="Reply"><Reply size={14} /></button>
              <button type="button" className="toolbar-icon" onClick={() => onForward(focusedEmail)} aria-label="Forward" title="Forward"><Forward size={14} /></button>
              <button type="button" className={`toolbar-icon ${focusedEmail.starred ? 'toolbar-icon-active' : ''}`} onClick={() => onToggleStar(focusedEmail.id)} aria-label="Star" title="Star"><Star size={14} /></button>
              {onToggleRead && (
                <button type="button" className="toolbar-icon" onClick={() => { onToggleRead(focusedEmail.id, focusedEmail.unread); closeReader(); }} aria-label={focusedEmail.unread ? 'Mark read' : 'Mark unread'} title={focusedEmail.unread ? 'Mark Read' : 'Mark Unread'}>
                  {focusedEmail.unread ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              )}
              {onMarkSpam && state.activeFolder !== 'spam' && state.activeFolder !== 'trash' && (
                <button type="button" className="toolbar-icon" onClick={() => { onMarkSpam(focusedEmail.id); closeReader(); }} aria-label="Mark spam" title="Spam">
                  <AlertTriangle size={14} />
                </button>
              )}
              {onTogglePriority && (
                <button type="button" className="toolbar-icon" onClick={() => { onTogglePriority(focusedEmail.id); }} aria-label="Toggle priority" title="Priority">
                  <Shield size={14} />
                </button>
              )}
              <div className="toolbar-spacer" />
              {!isTrash && (
                <button type="button" className="toolbar-icon" onClick={() => { onArchive([focusedEmail.id]); closeReader(); }} aria-label="Archive" title="Archive">
                  <Archive size={14} />
                </button>
              )}
              {!isTrash ? (
                <button type="button" className="toolbar-icon toolbar-icon-danger" onClick={() => { onTrash([focusedEmail.id]); closeReader(); }} aria-label="Trash" title="Trash">
                  <Trash2 size={14} />
                </button>
              ) : (
                <button type="button" className="toolbar-icon toolbar-icon-danger" onClick={() => handleDeletePermanently(focusedEmail.id)} aria-label="Delete forever" title="Delete Forever">
                  <Trash size={14} />
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
                  <div className="mail-select-all" onClick={toggleSelectAll} role="button" tabIndex={0} aria-label={allSelected ? 'Deselect all' : 'Select all'}>
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
