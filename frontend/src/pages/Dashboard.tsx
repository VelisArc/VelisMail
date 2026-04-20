import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Inbox, Send, FileEdit, Star, Archive, Trash2, LogOut,
  Search, Plus, X, Paperclip, RefreshCw, ArrowLeft,
  Reply, Forward, CheckCircle2,
  AlertTriangle, Sun, Moon, Settings, ArrowLeftRight, Menu,
} from 'lucide-react';
import { auth, mail, isScamEmail, type Email } from '../api/client';
import Composer from '../components/Composer';
import { useNavigation, useSessionActions } from '../store/sessionStore';
import './Dashboard.css';

const FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileEdit },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'spam', label: 'Scam', icon: AlertTriangle },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const params = useParams();
  const navigation = useNavigation();
  const { updateNavigation } = useSessionActions();
  const user = auth.getSession();

  useEffect(() => {
    if (!user) {
      navigate('/login');
    } else if (user.accountType === 'business' && !user.isBusinessSetupComplete) {
      navigate('/business-setup');
    } else if (user.accountType === 'personal' && !user.isSetupComplete) {
      navigate('/setup');
    }
  }, [navigate, user]);

  const routeFolder = params.folder && FOLDERS.some(f => f.id === params.folder) ? params.folder : null;
  const [activeFolder, setActiveFolder] = useState(routeFolder || navigation.activeFolder || 'inbox');
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [searchQuery, setSearchQuery] = useState(navigation.searchQuery || '');
  const [composeOpen, setComposeOpen] = useState(false);
  const [filterUnread, setFilterUnread] = useState(false);
  const [filterAttachments, setFilterAttachments] = useState(false);
  const [filterStarred, setFilterStarred] = useState(false);
  const [filterScam, setFilterScam] = useState(false);
  const [filterDate, setFilterDate] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadEmails = useCallback(() => {
    setEmails(mail.getByFolder(activeFolder));
  }, [activeFolder]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  useEffect(() => {
    const selected = navigation.selectedEmailId
      ? emails.find(email => email.id === navigation.selectedEmailId) || null
      : null;
    setSelectedEmail(selected);
  }, [emails, navigation.selectedEmailId]);

  useEffect(() => {
    updateNavigation({
      accountType: 'personal',
      activeFolder,
      searchQuery,
      selectedEmailId: selectedEmail?.id || null,
    });
  }, [activeFolder, searchQuery, selectedEmail?.id, updateNavigation]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  const handleSelectEmail = (email: Email) => {
    setSelectedEmail(email);
    updateNavigation({ selectedEmailId: email.id });
    if (email.unread) {
      mail.markRead(email.id);
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, unread: false } : e));
    }
  };

  const handleStarEmail = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStarred = mail.toggleStar(id);
    setEmails(prev => prev.map(em => em.id === id ? { ...em, starred: newStarred } : em));
    if (selectedEmail?.id === id) setSelectedEmail(prev => prev ? { ...prev, starred: newStarred } : prev);
  };

  const handleDeleteEmail = (id: string) => {
    mail.delete(id);
    setEmails(prev => prev.filter(e => e.id !== id));
    if (selectedEmail?.id === id) {
      setSelectedEmail(null);
      updateNavigation({ selectedEmailId: null });
    }
    showToast('Email moved to trash');
  };

  const handleReply = () => {
    if (!selectedEmail) return;
    setComposeOpen(true);
    setComposeTo(selectedEmail.from);
    setComposeSubject(`Re: ${selectedEmail.subject.replace(/^Re:\s*/i, '')}`);
    setComposeBody(`\n\n---\nOn ${new Date(selectedEmail.date).toLocaleString()}, ${selectedEmail.fromName} wrote:\n> ${selectedEmail.body.split('\n').join('\n> ')}`);
  };

  const handleForward = () => {
    if (!selectedEmail) return;
    setComposeOpen(true);
    setComposeTo('');
    setComposeSubject(`Fwd: ${selectedEmail.subject.replace(/^Fwd:\s*/i, '')}`);
    setComposeBody(`\n\n--- Forwarded Message ---\nFrom: ${selectedEmail.from}\nDate: ${new Date(selectedEmail.date).toLocaleString()}\nSubject: ${selectedEmail.subject}\n\n${selectedEmail.body}`);
  };

  const handleSend = async (toArg: string, subjectArg: string, bodyArg: string) => {
    setComposeTo(toArg);
    setComposeSubject(subjectArg);
    setComposeBody(bodyArg);
    setSending(true);
    mail.send([toArg], subjectArg, bodyArg);
    if (activeFolder === 'sent') loadEmails();
    showToast(`Email sent to ${toArg}`);
    setComposeOpen(false);
    setComposeTo('');
    setComposeSubject('');
    setComposeBody('');
    setSending(false);
  };

  const q = searchQuery.toLowerCase().trim();
  const filteredEmails = emails.filter(e => {
    if (filterUnread && !e.unread) return false;
    if (filterAttachments && !e.hasAttachment) return false;
    if (filterStarred && !e.starred) return false;
    if (filterScam && !isScamEmail(e)) return false;
    if (filterFrom && !(e.fromName + ' ' + e.from).toLowerCase().includes(filterFrom.toLowerCase())) return false;
    if (filterDate !== 'all') {
      const age = Date.now() - new Date(e.date).getTime();
      if (filterDate === 'today' && age > 86400000) return false;
      if (filterDate === 'week' && age > 604800000) return false;
      if (filterDate === 'month' && age > 2592000000) return false;
    }
    if (!q) return true;
    return (
      e.subject.toLowerCase().includes(q) ||
      e.from.toLowerCase().includes(q) ||
      e.fromName.toLowerCase().includes(q) ||
      e.body.toLowerCase().includes(q) ||
      (e.labels || []).join(' ').toLowerCase().includes(q)
    );
  });

  const unreadCount = mail.getUnreadCount();
  const scamCount = mail.getByFolder('spam').length;

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return date.toLocaleDateString('en-US', { weekday: 'short' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const toggleTheme = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('velismail-theme', next);
  };

  if (!user || (user.accountType === 'business' && !user.isBusinessSetupComplete) || (user.accountType === 'personal' && !user.isSetupComplete)) return null;

  return (
    <div className="dash">
      <div className={`dash-sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)}></div>
      <aside className={`dash-sidebar glass ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="dash-brand" onClick={() => navigate('/')}>
            <img src="/ZeeResizer.png" className="dash-brand-icon" alt="VelisMail" />
            <div className="dash-brand-info">
              <span className="dash-brand-name">VelisMail</span>
              <span className="badge badge-primary dash-brand-sub" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>Personal</span>
            </div>
          </div>

          <button className="btn btn-primary compose-btn" onClick={() => setComposeOpen(true)}>
            <Plus size={18} /> <span>Compose</span>
          </button>

          <nav className="sidebar-folders">
            {FOLDERS.map(f => {
              const Icon = f.icon;
              const count = f.id === 'inbox' ? unreadCount : f.id === 'spam' ? scamCount : 0;
              return (
                <button key={f.id}
                  className={`folder-btn ${activeFolder === f.id ? 'active' : ''}`}
                  onClick={() => { setActiveFolder(f.id); setSelectedEmail(null); updateNavigation({ activeFolder: f.id, selectedEmailId: null }); setSidebarOpen(false); }}
                >
                  <Icon size={18} />
                  <span className="folder-label">{f.label}</span>
                  {count > 0 && <span className="folder-count">{count}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="user-avatar">{user.profileImageUrl ? <img src={user.profileImageUrl} alt="" /> : (user.displayName?.charAt(0) || 'U')}</div>
            <div className="user-info">
              <span className="user-name">{user.displayName}</span>
              <span className="user-email">{user.email}</span>
            </div>
          </div>
          <div className="sidebar-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')} title="Settings">
              <Settings size={16} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(user.accountType === 'business' ? '/business' : '/business-setup')} title="Switch to Business">
              <ArrowLeftRight size={16} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title="Toggle Theme">
              {document.documentElement.getAttribute('data-theme') === 'dark'
                ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowLogoutConfirm(true)} title="Log out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {selectedEmail ? (
        <div className="dash-reader glass">
          <div className="reader-content animate-fade">
            <div className="reader-toolbar">
              <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedEmail(null); updateNavigation({ selectedEmailId: null }); }}>
                <ArrowLeft size={16} /> Back
              </button>
              <div className="reader-toolbar-actions">
                <button className="btn btn-ghost btn-icon" title="Reply" onClick={handleReply}><Reply size={16} /></button>
                <button className="btn btn-ghost btn-icon" title="Forward" onClick={handleForward}><Forward size={16} /></button>
                <button className="btn btn-ghost btn-icon" title="Archive" onClick={() => { if (selectedEmail) { mail.archive(selectedEmail.id); setSelectedEmail(null); } }}><Archive size={16} /></button>
                <button className="btn btn-danger btn-icon btn-sm" title="Delete" onClick={() => handleDeleteEmail(selectedEmail.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <div className="reader-header">
              <h1 className="reader-subject">{selectedEmail.subject}</h1>
              {selectedEmail.labels.length > 0 && (
                <div className="reader-labels">{selectedEmail.labels.map(l => <span key={l} className="badge badge-primary">{l}</span>)}</div>
              )}
            </div>
            <div className="reader-meta">
              <div className="reader-sender-info">
                <div className="reader-avatar">{(selectedEmail.fromName || selectedEmail.from).charAt(0)}</div>
                <div>
                  <div className="reader-sender-name">{selectedEmail.fromName || selectedEmail.from}</div>
                  <div className="reader-sender-email">{selectedEmail.from} → {selectedEmail.to?.join(', ')}</div>
                </div>
              </div>
              <div className="reader-date">{new Date(selectedEmail.date).toLocaleString()}</div>
            </div>
            <div className="divider" />
            <div className="reader-body">{selectedEmail.body.split('\n').map((line, i) => <p key={i}>{line || <br />}</p>)}</div>
            {selectedEmail.hasAttachment && (
              <div className="reader-attachment glass-card"><Paperclip size={16} /><span>1 Attachment</span><button className="btn btn-ghost btn-sm">Download</button></div>
            )}
          </div>
        </div>
      ) : (
        <div className="dash-list glass">
          <div className="list-header">
            <h2 className="list-title">
              <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                <Menu size={20} />
              </button>
              {FOLDERS.find(f => f.id === activeFolder)?.label || 'Inbox'}
              {unreadCount > 0 && activeFolder === 'inbox' && <span className="badge badge-primary">{unreadCount}</span>}
            </h2>
            <div className="list-actions">
              <button className="btn btn-icon btn-ghost" onClick={loadEmails} title="Refresh"><RefreshCw size={16} /></button>
            </div>
          </div>

          <div className="list-search">
            <Search size={16} />
            <input type="text" placeholder="Search sender, subject, body, labels..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}><X size={14} /></button>}
            <div className="search-filters">
              <button className={`filter-btn ${filterUnread ? 'active' : ''}`} onClick={() => setFilterUnread(v => !v)}>Unread</button>
              <button className={`filter-btn ${filterAttachments ? 'active' : ''}`} onClick={() => setFilterAttachments(v => !v)}>Has Attachment</button>
              <button className={`filter-btn ${filterStarred ? 'active' : ''}`} onClick={() => setFilterStarred(v => !v)}>Starred</button>
              <button className={`filter-btn ${filterScam ? 'active danger' : ''}`} onClick={() => setFilterScam(v => !v)}>Scam</button>
              <select className="filter-select" value={filterDate} onChange={e => setFilterDate(e.target.value as typeof filterDate)}>
                <option value="all">Any time</option>
                <option value="today">Today</option>
                <option value="week">7 days</option>
                <option value="month">30 days</option>
              </select>
              <input className="filter-input" placeholder="From..." value={filterFrom} onChange={e => setFilterFrom(e.target.value)} />
            </div>
          </div>

          <div className="mail-list">
            {filteredEmails.length === 0 ? (
              <div className="list-empty">
                <Inbox size={32} opacity={0.2} />
                <p>No emails here</p>
                <span className="list-empty-sub">Send a new email to get started</span>
              </div>
            ) : (
              filteredEmails.map(email => (
                <div key={email.id}
                  className={`mail-row ${email.unread ? 'unread' : ''}`}
                  onClick={() => handleSelectEmail(email)}
                >
                  <button className={`star-btn ${email.starred ? 'starred' : ''}`}
                    onClick={(e) => handleStarEmail(email.id, e)} title="Star">
                    <Star size={16} fill={email.starred ? '#facc15' : 'none'} color={email.starred ? '#facc15' : 'var(--text-muted)'} />
                  </button>
                  <div className="mail-row-body">
                    <div className="mail-row-top">
                      <span className="mail-sender">{email.fromName || email.from}</span>
                      {isScamEmail(email) && <span className="badge badge-danger" style={{ marginLeft: 8 }}>Scam</span>}
                      <span className="mail-date">{formatDate(email.date)}</span>
                    </div>
                    <div className="mail-subject">{email.subject}</div>
                    <div className="mail-preview">{email.body.slice(0, 80)}…</div>
                  </div>
                  {email.hasAttachment && <Paperclip size={14} className="attach-icon" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {composeOpen && (
        <div className="modal-overlay" onClick={() => !sending && setComposeOpen(false)}>
          <div className="compose-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3>New Message</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => !sending && setComposeOpen(false)} disabled={sending}><X size={18} /></button>
            </div>
            <Composer
              initialTo={composeTo}
              initialSubject={composeSubject}
              initialBody={composeBody}
              onSend={handleSend}
              onClose={() => setComposeOpen(false)}
              sending={sending}
            />
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="logout-confirm-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            <div className="logout-confirm-icon">
              <AlertTriangle size={40} color="var(--danger)" />
            </div>
            <h3>Confirm Logout</h3>
            <p>Are you sure you want to log out of VelisMail?</p>
            <div className="logout-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleLogout}><LogOut size={16} /> Yes, Log Out</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}><CheckCircle2 size={16} />{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
