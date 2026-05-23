import { useState, useMemo, useDeferredValue, memo, useCallback, useRef, useEffect, type FC } from 'react';
import { FixedSizeList as List } from 'react-window';
import {
  Mail, Star, Archive, Trash2, Search, Paperclip, ArrowLeft,
  Reply, Forward,
  RefreshCcw, List as ListIcon, Grid, SortAsc, SortDesc, Menu, User,
} from 'lucide-react';
import type { Email } from '../../api/client';
import { parseEmailConversation, getEmailPreview } from './utils';
import type { DashboardState } from './types';

interface EmailInboxProps {
  emails: Email[];
  state: DashboardState;
  onRefresh: () => void;
  onToggleStar: (id: string) => void;
  onArchive: (ids: string[]) => void;
  onTrash: (ids: string[]) => void;
  onReply: (email: Email) => void;
  onForward: (email: Email) => void;
}

const ROW_HEIGHT = 64;

const EmailRow = memo(({ email, style, state, onOpen }: {
  email: Email;
  style: React.CSSProperties;
  state: DashboardState;
  onOpen: (e: Email) => void;
}) => (
  <div style={style}>
    <div className={`mail-row ${email.unread ? 'unread' : ''}`} onClick={() => onOpen(email)}>
      <div className="mail-row-select">
        <input type="checkbox" checked={state.selectedEmails.has(email.id)} onChange={() => {
          const next = new Set(state.selectedEmails);
          if (next.has(email.id)) { next.delete(email.id); } else { next.add(email.id); }
          state.setSelectedEmails(next);
        }} onClick={e => e.stopPropagation()} />
      </div>
      <div className="avatar avatar-sm" onClick={e => e.stopPropagation()}>
        <User size={14} />
      </div>
      <div className="mail-row-main" onClick={e => e.stopPropagation()}>
        <strong className="mail-from">{email.fromName || email.from}</strong>
        <span className="mail-subj">{email.subject || '(No subject)'}</span>
        <span className="mail-preview">{getEmailPreview(email.body, 100)}</span>
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
  emails, state, onRefresh, onToggleStar,
  onArchive, onTrash, onReply, onForward,
}) => {
  const [focusedEmail, setFocusedEmail] = useState<Email | null>(null);
  const deferredQuery = useDeferredValue(state.searchQuery);
  const listRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState(800);
  const [listHeight, setListHeight] = useState(600);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        setListWidth(entry.contentRect.width);
        setListHeight(entry.contentRect.height);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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

  const conversation = focusedEmail ? parseEmailConversation(focusedEmail.body) : [];

  return (
    <div className="dash-panel">
      <div className="panel-header">
        <button type="button" className="btn btn-ghost btn-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <h3>
          <Mail size={18} /> {state.activeFolder.charAt(0).toUpperCase() + state.activeFolder.slice(1)}
        </h3>
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

      <div className="dash-search">
        <Search size={14} className="search-icon" />
        <input
          className="input search-input"
          placeholder="Search mail..."
          value={state.searchQuery}
          onChange={e => state.setSearchQuery(e.target.value)}
        />
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

      <div className="dash-body">
        {focusedEmail ? (
          <div className="dash-reader">
            <div className="reader-toolbar">
              <button type="button" className="btn btn-ghost btn-icon" onClick={closeReader}><ArrowLeft size={18} /></button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReply(focusedEmail)}><Reply size={14} /> Reply</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onForward(focusedEmail)}><Forward size={14} /> Forward</button>
              <button type="button" className={`btn btn-ghost btn-sm ${focusedEmail.starred ? 'text-primary' : ''}`} onClick={() => onToggleStar(focusedEmail.id)}><Star size={14} /></button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onArchive([focusedEmail.id]); closeReader(); }}>
                <Archive size={14} /> Archive
              </button>
              <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => { onTrash([focusedEmail.id]); closeReader(); }}>
                <Trash2 size={14} /> Trash
              </button>
            </div>
            <div className="reader-header">
              <h2>{focusedEmail.subject || '(No subject)'}</h2>
              {focusedEmail.labels?.map((l: string) => (
                <span key={l} className="badge badge-neutral">{l}</span>
              ))}
            </div>
            <div className="reader-meta">
              <div className="avatar avatar-sm"><User size={14} /></div>
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
          <div className="dash-list" ref={listRef}>
            {filtered.length === 0 ? (
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
                      <div className="avatar avatar-sm"><User size={14} /></div>
                      <strong className="truncate">{email.fromName || email.from}</strong>
                    </div>
                    <h4 className="truncate">{email.subject || '(No subject)'}</h4>
                    <p className="truncate text-muted text-sm">{getEmailPreview(email.body, 80)}</p>
                    <span className="text-xs text-muted">{new Date(email.date).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <List
                height={listHeight}
                itemCount={filtered.length}
                itemSize={ROW_HEIGHT}
                width={listWidth}
              >
                {({ index, style }) => (
                  <EmailRow
                    email={filtered[index].email}
                    style={style}
                    state={state}
                    onOpen={openEmail}
                  />
                )}
              </List>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(EmailInbox);
