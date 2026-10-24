import { useState, useEffect, useMemo, useDeferredValue, memo, useCallback, type FC } from 'react';
import {
  Mail, Star, Archive, Trash2, Search, Paperclip, ArrowLeft,
  Reply, ReplyAll, Forward, RefreshCcw,
  ArrowUpDown, Menu, CheckSquare, Square,
  Eye, EyeOff, Shield, ShieldCheck, AlertTriangle, X, Printer,
  ChevronDown, ChevronUp, Lock, Info,
} from 'lucide-react';
import type { Email } from '../../api/client';
import { getUserFromPersistentStore } from '../../api/client';
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
  onReplyAll?: (email: Email) => void;
  onToggleRead?: (id: string, currentlyUnread: boolean) => void;
  onMarkSpam?: (id: string) => void;
  onMarkSafe?: (id: string) => void;
  onTogglePriority?: (id: string) => void;
  onMoveFolder?: (id: string, folder: string) => void;
  onDeleteForever?: (id: string) => void;
  onBulkDeleteForever?: (ids: string[]) => void;
  onBulkRead?: (ids: string[], read: boolean) => void;
  onBulkStar?: (ids: string[]) => void;
  onBulkSpam?: (ids: string[]) => void;
  onMarkAllRead?: (folder: string) => void;
  onEmptyFolder?: (ids: string[]) => void;
}

const AVATAR_COLORS = ['#0d9488','#0891b2','#2563eb','#7c3aed','#db2777','#dc2626','#ea580c','#ca8a04','#16a34a','#059669'];
const normalizeMailboxAddress = (value: string | undefined) => (value || '').trim().toLowerCase();

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function resolveSenderInfo(email: Email, state: DashboardState) {
  const fromEmail = (email.from || '').toLowerCase().trim();

  // 1. Check logged-in user
  if (state.user && (state.user.email || '').toLowerCase().trim() === fromEmail) {
    return {
      name: state.user.displayName || email.fromName || email.from,
      avatarUrl: state.user.profileImageUrl || null,
    };
  }

  // 2. Check contacts list
  const contact = (state.contacts || []).find(
    c => (c.email || '').toLowerCase().trim() === fromEmail
  );
  if (contact) {
    return {
      name: contact.name,
      avatarUrl: null,
    };
  }

  // 3. Check team members
  const teamMember = (state.teamMembers || []).find(
    t => (t.email || '').toLowerCase().trim() === fromEmail
  );
  if (teamMember) {
    return {
      name: teamMember.name,
      avatarUrl: null,
    };
  }

  // 4. Check persistent users store
  try {
    const persistentUser = getUserFromPersistentStore(fromEmail);
    if (persistentUser) {
      return {
        name: persistentUser.displayName || email.fromName || email.from,
        avatarUrl: persistentUser.profileImageUrl || null,
      };
    }
  } catch (e) {
    console.error('Error fetching persistent user:', e);
  }

  // 5. Fallback
  return {
    name: email.fromName || email.from,
    avatarUrl: null,
  };
}

function getSenderAvatar(name: string, avatarUrl: string | null, size: 'sm' | 'md' = 'sm') {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`avatar-logo-img avatar-${size}`}
        style={{
          width: size === 'sm' ? '28px' : '40px',
          height: size === 'sm' ? '28px' : '40px',
          objectFit: 'cover',
          borderRadius: '50%',
          border: '1px solid var(--border-primary)',
          flexShrink: 0,
        }}
      />
    );
  }

  const initial = name.charAt(0).toUpperCase();
  const bg = avatarColor(name);

  return (
    <div
      className={`avatar avatar-${size}`}
      style={{
        background: bg + '20',
        color: bg,
        width: size === 'sm' ? '28px' : '40px',
        height: size === 'sm' ? '28px' : '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        fontSize: size === 'sm' ? '12px' : '16px',
        borderRadius: '50%',
        border: '1px solid var(--border-primary)',
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

const EmailRow = memo(({ email, state, onOpen, onToggleStar }: {
  email: Email;
  state: DashboardState;
  onOpen: (e: Email) => void;
  onToggleStar: (id: string) => void;
}) => {
  const senderInfo = resolveSenderInfo(email, state);
  return (
    <div className="mail-row-wrapper" onClick={() => onOpen(email)}>
      <div className={`mail-row ${email.unread ? 'unread' : ''}`}>
        <div className="mail-row-left-group">
          <div className="mail-row-select" onClick={e => e.stopPropagation()}>
            <input type="checkbox" aria-label={`Select email from ${senderInfo.name}`} checked={state.selectedEmails.has(email.id)} onChange={() => {
              const next = new Set(state.selectedEmails);
              if (next.has(email.id)) next.delete(email.id); else next.add(email.id);
              state.setSelectedEmails(next);
            }} />
          </div>
          <div className="mail-row-star" onClick={e => {
            e.stopPropagation();
            onToggleStar(email.id);
          }}>
            <Star size={14} className={email.starred ? "text-primary filled" : "text-muted"} />
          </div>
          <div className="mail-row-avatar">
            {getSenderAvatar(senderInfo.name, senderInfo.avatarUrl, 'sm')}
          </div>
        </div>
        <div className="mail-row-sender">
          <span className="mail-from">{senderInfo.name}</span>
        </div>
        <div className="mail-row-content">
          <span className="mail-subj">{email.subject || '(No subject)'}</span>
          {email.body && (
            <>
              <span className="mail-preview-sep"> — </span>
              <span className="mail-preview">{getEmailPreview(email.body, 140)}</span>
            </>
          )}
        </div>
        <div className="mail-row-right-group">
          {email.hasAttachment && <Paperclip size={12} className="text-muted" />}
          <span className="mail-date">{new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </div>
      </div>
    </div>
  );
});

const EmailInbox: FC<EmailInboxProps> = ({
  emails, isLoading, state, onRefresh, onToggleStar,
  onArchive, onTrash, onReply, onForward, onReplyAll,
  onToggleRead, onMarkSpam, onMarkSafe, onTogglePriority,
  onMoveFolder, onDeleteForever, onBulkDeleteForever, onBulkRead, onBulkStar, onBulkSpam,
  onMarkAllRead, onEmptyFolder,
}) => {
  const [focusedEmail, setFocusedEmail] = useState<Email | null>(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const deferredQuery = useDeferredValue(state.searchQuery);
  const [showReaderQuote, setShowReaderQuote] = useState(false);
  const [showMetaDetails, setShowMetaDetails] = useState(false);

  const focusedSenderInfo = useMemo(() => focusedEmail ? resolveSenderInfo(focusedEmail, state) : null, [focusedEmail, state]);

  // Reset quote visibility and meta details when focused email changes
  useEffect(() => {
    setShowReaderQuote(false);
    setShowMetaDetails(false);
  }, [focusedEmail]);

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase();
    const activeMailbox = normalizeMailboxAddress(state.activeMailboxAddress);
    const activeMailboxRecord = state.domainMailboxes.find((mailbox) => mailbox.address === activeMailbox);
    const mailboxAddresses = new Set(
      [activeMailbox, ...(activeMailboxRecord?.aliases || [])]
        .map(normalizeMailboxAddress)
        .filter(Boolean),
    );
    const withTimestamps = emails.map(e => ({
      email: e,
      time: new Date(e.date).getTime(),
    }));
    const matched = withTimestamps.filter(({ email }) => {
      if (state.mailStatusFilter === 'unread' && !email.unread) return false;
      if (state.mailStatusFilter === 'read' && email.unread) return false;
      if (state.mailStatusFilter === 'starred' && !email.starred) return false;
      if (state.mailStatusFilter === 'attachments' && !email.hasAttachment) return false;
      if (mailboxAddresses.size > 0) {
        const fromMatches = mailboxAddresses.has(normalizeMailboxAddress(email.from));
        const toMatches = (email.to || []).some((recipient) => mailboxAddresses.has(normalizeMailboxAddress(recipient)));
        if (!fromMatches && !toMatches) return false;
      }
      if (!q) return true;
      return email.subject?.toLowerCase().includes(q) || email.from?.toLowerCase().includes(q) || email.body?.toLowerCase().includes(q) || email.fromName?.toLowerCase().includes(q);
    });
    matched.sort((a, b) => state.sortOrder === 'desc' ? b.time - a.time : a.time - b.time);
    return matched;
  }, [emails, deferredQuery, state.activeMailboxAddress, state.domainMailboxes, state.mailStatusFilter, state.sortOrder]);

  const openEmail = useCallback((email: Email) => {
    setFocusedEmail(email.unread ? { ...email, unread: false } : email);
    if (email.unread && onToggleRead) {
      onToggleRead(email.id, true);
    }
  }, [onToggleRead]);
  const closeReader = useCallback(() => setFocusedEmail(null), []);

  // Print through a clean, script-free window. The message is written with
  // textContent so HTML inside a mail can never execute in the print view.
  const printEmail = useCallback((email: Email) => {
    const win = window.open('', '_blank', 'width=820,height=900');
    if (!win) {
      state.showToast('Allow pop-ups in your browser to print this message.', 'error');
      return;
    }
    const doc = win.document;
    doc.title = email.subject || 'Email';
    const style = doc.createElement('style');
    style.textContent = 'body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:32px;color:#111}h1{font-size:18px;margin:0 0 12px}.meta{font-size:12px;color:#555;white-space:pre-wrap;line-height:1.6}hr{border:0;border-top:1px solid #ddd;margin:16px 0}.body{white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.65}';
    doc.head.appendChild(style);
    const title = doc.createElement('h1');
    title.textContent = email.subject || '(No subject)';
    const meta = doc.createElement('div');
    meta.className = 'meta';
    meta.textContent = `From: ${email.fromName || ''} <${email.from}>\nTo: ${Array.isArray(email.to) ? email.to.join(', ') : email.to}\nDate: ${new Date(email.date).toLocaleString()}`;
    const rule = doc.createElement('hr');
    const message = doc.createElement('div');
    message.className = 'body';
    message.textContent = email.body;
    doc.body.append(title, meta, rule, message);
    win.focus();
    win.print();
  }, [state]);

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
        {state.activeMailboxAddress && (
          <button
            type="button"
            className="mailbox-filter-chip"
            onClick={() => state.setActiveMailboxAddress('')}
            title="Clear mailbox filter"
          >
            <Mail size={12} />
            <span>{state.activeMailboxAddress}</span>
            <X size={12} />
          </button>
        )}

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
        <button type="button" className="toolbar-icon" onClick={() => state.setSortOrder(state.sortOrder === 'desc' ? 'asc' : 'desc')} aria-label="Toggle sort" title={state.sortOrder === 'desc' ? 'Oldest first' : 'Newest first'}>
          <ArrowUpDown size={14} />
        </button>
        {onMarkAllRead && filtered.some(({ email }) => email.unread) && (
          <button type="button" className="toolbar-icon" onClick={() => onMarkAllRead(state.activeFolder)} aria-label="Mark all read" title="Mark all read">
            <Eye size={14} />
          </button>
        )}
        {isTrash && onEmptyFolder && filtered.length > 0 && (
          <button type="button" className="toolbar-icon toolbar-icon-danger" onClick={() => onEmptyFolder(filtered.map(({ email }) => email.id))} aria-label="Empty trash" title="Empty trash">
            <Trash2 size={14} />
          </button>
        )}
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
          {onBulkRead && (
            <>
              <button className="toolbar-icon" onClick={() => { onBulkRead([...state.selectedEmails], true); state.setSelectedEmails(new Set()); }} aria-label="Mark selected read" title="Mark read"><Eye size={13} /></button>
              <button className="toolbar-icon" onClick={() => { onBulkRead([...state.selectedEmails], false); state.setSelectedEmails(new Set()); }} aria-label="Mark selected unread" title="Mark unread"><EyeOff size={13} /></button>
            </>
          )}
          {onBulkStar && (
            <button className="toolbar-icon" onClick={() => { onBulkStar([...state.selectedEmails]); state.setSelectedEmails(new Set()); }} aria-label="Star selected" title="Star"><Star size={13} /></button>
          )}
          {onBulkSpam && state.activeFolder !== 'spam' && state.activeFolder !== 'trash' && (
            <button className="toolbar-icon" onClick={() => { onBulkSpam([...state.selectedEmails]); state.setSelectedEmails(new Set()); }} aria-label="Mark selected as spam" title="Spam"><AlertTriangle size={13} /></button>
          )}
          {isTrash && onBulkDeleteForever && (
            <button className="toolbar-icon toolbar-icon-danger" onClick={() => { onBulkDeleteForever([...state.selectedEmails]); state.setSelectedEmails(new Set()); }} aria-label="Delete selected forever" title="Delete forever"><Trash2 size={13} /></button>
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
              {onReplyAll && (
                <button type="button" className="toolbar-icon" onClick={() => onReplyAll(focusedEmail)} aria-label="Reply all" title="Reply all"><ReplyAll size={14} /></button>
              )}
              <button type="button" className="toolbar-icon" onClick={() => onForward(focusedEmail)} aria-label="Forward" title="Forward"><Forward size={14} /></button>
              <button type="button" className={`toolbar-icon ${focusedEmail.starred ? 'toolbar-icon-active' : ''}`} onClick={() => { onToggleStar(focusedEmail.id); setFocusedEmail({ ...focusedEmail, starred: !focusedEmail.starred }); }} aria-label="Star" title="Star"><Star size={14} /></button>
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
              {onMarkSafe && state.activeFolder === 'spam' && (
                <button type="button" className="toolbar-icon" onClick={() => { onMarkSafe(focusedEmail.id); closeReader(); }} aria-label="Not spam" title="Not spam">
                  <ShieldCheck size={14} />
                </button>
              )}
              {onTogglePriority && (
                <button type="button" className="toolbar-icon" onClick={() => { onTogglePriority(focusedEmail.id); }} aria-label="Toggle priority" title="Priority">
                  <Shield size={14} />
                </button>
              )}
              {onMoveFolder && !isTrash && (
                <select
                  className="input input-auto move-folder-select"
                  value=""
                  aria-label="Move message to folder"
                  title="Move to folder"
                  onClick={e => e.stopPropagation()}
                  onChange={e => {
                    const folder = e.target.value;
                    if (!folder) return;
                    onMoveFolder(focusedEmail.id, folder);
                    closeReader();
                  }}
                >
                  <option value="">Move to…</option>
                  <option value="inbox">Inbox</option>
                  <option value="archive">Archive</option>
                  <option value="spam">Spam</option>
                </select>
              )}
              <div className="toolbar-spacer" />
              <button type="button" className="toolbar-icon" onClick={() => printEmail(focusedEmail)} aria-label="Print" title="Print"><Printer size={14} /></button>
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
                <button type="button" className="toolbar-icon" onClick={() => { onArchive([focusedEmail.id]); closeReader(); }} aria-label="Restore" title="Restore">
                  <Archive size={14} />
                </button>
              )}
              {isTrash && onDeleteForever && (
                <button type="button" className="toolbar-icon toolbar-icon-danger" onClick={() => { onDeleteForever(focusedEmail.id); closeReader(); }} aria-label="Delete forever" title="Delete forever">
                  <Trash2 size={14} />
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
              {focusedSenderInfo && getSenderAvatar(focusedSenderInfo.name, focusedSenderInfo.avatarUrl, 'md')}
              <div className="reader-meta-main">
                <div className="reader-meta-top">
                  <div className="reader-meta-sender">
                    <strong>{focusedSenderInfo?.name}</strong>
                    <span className="text-muted text-xs">&lt;{focusedEmail.from}&gt;</span>
                  </div>
                  <span className="reader-date">{new Date(focusedEmail.date).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}</span>
                </div>
                <div className="reader-meta-to-row">
                  <span className="text-muted text-xs" title={`to ${Array.isArray(focusedEmail.to) ? focusedEmail.to.join(', ') : focusedEmail.to}`}>to {Array.isArray(focusedEmail.to) ? focusedEmail.to.join(', ') : focusedEmail.to}</span>
                  <button type="button" className="reader-meta-toggle" onClick={() => setShowMetaDetails(!showMetaDetails)} aria-label="Toggle email details" title="Show details">
                    {showMetaDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
                {showMetaDetails && (
                  <div className="reader-meta-details">
                    <div className="meta-detail-row">
                      <span className="meta-label">from:</span>
                      <span className="meta-value">{focusedSenderInfo?.name} &lt;{focusedEmail.from}&gt;</span>
                    </div>
                    <div className="meta-detail-row">
                      <span className="meta-label">to:</span>
                      <span className="meta-value">{Array.isArray(focusedEmail.to) ? focusedEmail.to.map((t, i) => <span key={i}>{i > 0 ? ', ' : ''}&lt;{t}&gt;</span>) : focusedEmail.to}</span>
                    </div>
                    <div className="meta-detail-row">
                      <span className="meta-label">date:</span>
                      <span className="meta-value">{new Date(focusedEmail.date).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' })}</span>
                    </div>
                    <div className="meta-detail-row">
                      <span className="meta-label">subject:</span>
                      <span className="meta-value">{focusedEmail.subject || '(No subject)'}</span>
                    </div>
                    <div className="meta-detail-row">
                      <span className="meta-label">mailed-by:</span>
                      <span className="meta-value">{focusedEmail.from.includes('@') ? focusedEmail.from.split('@')[1] : 'unknown'}</span>
                    </div>
                    <div className="meta-detail-row">
                      <span className="meta-label">signed-by:</span>
                      <span className="meta-value">{focusedEmail.from.includes('@') ? focusedEmail.from.split('@')[1] : 'unknown'}</span>
                    </div>
                    <div className="meta-detail-row">
                      <span className="meta-label">security:</span>
                      <span className="meta-value meta-security">
                        <Lock size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                        TLS encryption in transit
                        <a href="/security#email-transport" className="meta-link" style={{ color: 'var(--text-muted)', textDecoration: 'underline', marginLeft: '4px' }}>VelisMail security policy</a>
                      </span>
                    </div>
                    {focusedEmail.labels?.includes('important') && (
                      <div className="meta-detail-row">
                        <span className="meta-label">importance:</span>
                        <span className="meta-value meta-important"><Info size={12} /> Important according to mail filters</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="reader-body">
              {conversation.map((seg, i) => {
                if (seg.kind === 'quote') {
                  if (!showReaderQuote) {
                    return (
                      <div key={i} className="reader-quote-collapsed-wrapper" style={{ marginTop: '8px', marginBottom: '8px' }}>
                        <button
                          type="button"
                          className="trimmed-content-toggle"
                          title="Show trimmed content"
                          onClick={() => setShowReaderQuote(true)}
                          style={{ margin: 0, padding: '2px 8px' }}
                        >
                          <span className="dots">•••</span>
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={i} className={`conversation-segment ${seg.kind}`}>
                      {seg.lines.map((line, j) => (
                        <p key={j}>{line || '\u00A0'}</p>
                      ))}
                    </div>
                  );
                }
                return (
                  <div key={i} className={`conversation-segment ${seg.kind}`}>
                    {seg.lines.map((line, j) => (
                      <p key={j}>{line || '\u00A0'}</p>
                    ))}
                  </div>
                );
              })}
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
                <p className="text-muted">
                  {state.activeMailboxAddress
                    ? `No mail found for ${state.activeMailboxAddress} in ${state.activeFolder}.`
                    : `Your ${state.activeFolder} folder is empty.`}
                </p>
              </div>
            ) : (
              <div className="dash-list-scroll">
                {filtered.length > 0 && (
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
                    onToggleStar={onToggleStar}
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
