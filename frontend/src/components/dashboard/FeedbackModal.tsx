import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  CreditCard,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { companyAdminApi } from '../../api/admin';
import { downloadBase64Image, fileToBase64, imageSourceFromBase64 } from './utils';
import './FeedbackModal.css';

type FeedbackNote = {
  id: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  status: string;
  reply?: string | null;
  imageBase64?: string | null;
  hasImage: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
};

type CategoryOption = {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
};

const CATEGORIES: CategoryOption[] = [
  { id: 'general', label: 'General', hint: 'Anything else', icon: <MessageSquare size={14} /> },
  { id: 'bug', label: 'Bug', hint: 'Something is broken', icon: <Bug size={14} /> },
  { id: 'feature', label: 'Feature', hint: 'An idea or request', icon: <Sparkles size={14} /> },
  { id: 'complaint', label: 'Complaint', hint: 'Service issue', icon: <AlertTriangle size={14} /> },
  { id: 'billing', label: 'Billing', hint: 'Plans & invoices', icon: <CreditCard size={14} /> },
  { id: 'security', label: 'Security', hint: 'Report a risk', icon: <ShieldAlert size={14} /> },
];

const PRIORITIES: Array<{ id: string; label: string; tone: string }> = [
  { id: 'low', label: 'Low', tone: 'low' },
  { id: 'medium', label: 'Medium', tone: 'medium' },
  { id: 'high', label: 'High', tone: 'high' },
  { id: 'urgent', label: 'Urgent', tone: 'urgent' },
];

function ago(value?: string | null): string {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff) || diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusTone(status?: string | null): string {
  const value = (status || '').toLowerCase();
  if (['resolved', 'closed'].includes(value)) return 'success';
  if (['open'].includes(value)) return 'primary';
  if (['investigating', 'escalated'].includes(value)) return 'warn';
  return 'neutral';
}

export interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [tab, setTab] = useState<'compose' | 'history'>('compose');
  const [history, setHistory] = useState<FeedbackNote[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [body, setBody] = useState('');
  const [image, setImage] = useState('');
  const [imageName, setImageName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [sentId, setSentId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryError('');
    try {
      const res = await companyAdminApi.feedback();
      setHistory((res.feedback || []) as FeedbackNote[]);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Unable to load your feedback.');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    setTab('compose');
    setSentId(null);
    setFormError('');
    void loadHistory();
    const focusTimer = window.setTimeout(() => subjectRef.current?.focus(), 60);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, loadHistory]);

  const handleFile = useCallback(async (file: File) => {
    setFormError('');
    if (!file.type.startsWith('image/')) {
      setFormError('Only image files can be attached.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setFormError('Screenshot must be under 3 MB.');
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      setImage(`data:${file.type || 'image/png'};base64,${b64}`);
      setImageName(file.name);
    } catch {
      setFormError('Could not read that image.');
    }
  }, []);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const onFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  }, [handleFile]);

  const canSubmit = subject.trim().length >= 3 && body.trim().length >= 5 && !sending;

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    setFormError('');
    try {
      const res = await companyAdminApi.submitFeedback({
        subject: subject.trim(),
        body: body.trim(),
        category,
        priority,
        imageBase64: image || undefined,
      });
      setSentId(res.id);
      setSubject('');
      setBody('');
      setCategory('general');
      setPriority('medium');
      setImage('');
      setImageName('');
      await loadHistory();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not send feedback.');
    } finally {
      setSending(false);
    }
  };

  const resetCompose = () => {
    setSentId(null);
    setFormError('');
  };

  const openHistory = () => {
    setTab('history');
    void loadHistory();
  };

  if (!open) return null;

  const openCount = history.filter((n) => n.status === 'open').length;
  const resolvedCount = history.filter((n) => n.status === 'resolved' || n.status === 'closed').length;

  return (
    <div className="modal-overlay feedback-modal-overlay" role="dialog" aria-modal="true" aria-label="Send feedback" onClick={onClose}>
      <div className="feedback-modal" onClick={(event) => event.stopPropagation()}>
        <header className="feedback-modal-header">
          <div className="feedback-modal-title">
            <span className="feedback-modal-icon"><MessageSquare size={18} /></span>
            <div>
              <h3>Send us a note</h3>
              <p>Share a complaint, idea or bug with the control plane. We read every note.</p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close feedback">
            <X size={16} />
          </button>
        </header>

        <nav className="feedback-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'compose'}
            className={`feedback-tab ${tab === 'compose' ? 'active' : ''}`}
            onClick={() => { setTab('compose'); resetCompose(); }}
          >
            <MessageSquare size={14} /> Compose
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={`feedback-tab ${tab === 'history' ? 'active' : ''}`}
            onClick={openHistory}
          >
            <CheckCircle2 size={14} /> Your notes
            {history.length > 0 && <span className="feedback-tab-count">{history.length}</span>}
          </button>
        </nav>

        {tab === 'compose' && (
          <div className="feedback-modal-body">
            {sentId ? (
              <div className="feedback-success">
                <div className="feedback-success-icon"><CheckCircle2 size={28} /></div>
                <h4>Your note was sent</h4>
                <p>The control plane received it. Reference <code>{sentId.slice(0, 8)}</code>. We will reply inside your notes list.</p>
                <div className="feedback-success-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={openHistory}>View your notes</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetCompose}>Send another</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="feedback-form">
                {formError && <div className="feedback-error" role="alert">{formError}</div>}

                <div className="feedback-field">
                  <label htmlFor="feedback-subject">Subject</label>
                  <input
                    id="feedback-subject"
                    ref={subjectRef}
                    className="input"
                    value={subject}
                    maxLength={160}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="What is this about?"
                    required
                  />
                  <span className="feedback-hint">{subject.trim().length}/160</span>
                </div>

                <div className="feedback-field">
                  <label>Category</label>
                  <div className="feedback-chip-row">
                    {CATEGORIES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`feedback-chip ${category === option.id ? 'active' : ''}`}
                        onClick={() => setCategory(option.id)}
                        title={option.hint}
                      >
                        {option.icon}
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="feedback-field">
                  <label>Priority</label>
                  <div className="feedback-priority-row">
                    {PRIORITIES.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`feedback-priority feedback-priority-${option.tone} ${priority === option.id ? 'active' : ''}`}
                        onClick={() => setPriority(option.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="feedback-field">
                  <label htmlFor="feedback-body">Message</label>
                  <textarea
                    id="feedback-body"
                    className="input"
                    rows={6}
                    value={body}
                    maxLength={4000}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Describe the issue or idea in detail. What happened, what you expected, and how it affects your work."
                    required
                  />
                  <span className="feedback-hint">{body.trim().length}/4000</span>
                </div>

                <div className="feedback-field">
                  <label>Screenshot (optional, max 3 MB)</label>
                  {image ? (
                    <div className="feedback-image-preview">
                      <img src={image} alt="Attached screenshot" />
                      <div className="feedback-image-meta">
                        <span>{imageName || 'Screenshot attached'}</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setImage(''); setImageName(''); }}>
                          <X size={12} /> Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`feedback-dropzone ${dragOver ? 'dragover' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={onDrop}
                      onClick={() => fileInputRef.current?.click()}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                    >
                      <Upload size={20} />
                      <strong>Drop an image here or click to browse</strong>
                      <span>PNG, JPG, GIF or WebP up to 3 MB</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={onFileChange}
                      />
                    </div>
                  )}
                </div>

                <div className="feedback-form-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!canSubmit}>
                    {sending ? <><Loader2 size={14} className="spin" /> Sending…</> : 'Send note'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="feedback-modal-body">
            <div className="feedback-history-summary">
              <div className="feedback-history-stat">
                <strong>{history.length}</strong>
                <span>Total</span>
              </div>
              <div className="feedback-history-stat">
                <strong>{openCount}</strong>
                <span>Open</span>
              </div>
              <div className="feedback-history-stat">
                <strong>{resolvedCount}</strong>
                <span>Resolved</span>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadHistory()} disabled={loadingHistory}>
                {loadingHistory ? <Loader2 size={14} className="spin" /> : 'Refresh'}
              </button>
            </div>

            {historyError && <div className="feedback-error" role="alert">{historyError}</div>}

            {loadingHistory && history.length === 0 ? (
              <div className="feedback-loading"><Loader2 size={18} className="spin" /> Loading your notes…</div>
            ) : history.length === 0 ? (
              <div className="feedback-empty">
                <MessageSquare size={28} />
                <h4>No notes yet</h4>
                <p>Anything you send lands here so you can track the reply and status.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab('compose')}>Write your first note</button>
              </div>
            ) : (
              <ul className="feedback-history-list">
                {history.map((note) => {
                  const expanded = expandedId === note.id;
                  return (
                    <li key={note.id} className={`feedback-history-item ${expanded ? 'expanded' : ''}`}>
                      <button
                        type="button"
                        className="feedback-history-row"
                        onClick={() => setExpandedId(expanded ? null : note.id)}
                        aria-expanded={expanded}
                      >
                        <div className="feedback-history-main">
                          <strong>{note.subject}</strong>
                          <span className="text-xs text-muted">
                            {note.category} · {ago(note.createdAt)}
                            {note.hasImage && <span className="feedback-attachment-chip"><ImageIcon size={10} /> screenshot</span>}
                          </span>
                        </div>
                        <div className="feedback-history-meta">
                          <span className={`badge badge-${statusTone(note.status)}`}>{note.status}</span>
                          <span className={`feedback-priority-dot feedback-priority-${note.priority}`} title={note.priority} />
                        </div>
                      </button>
                      {expanded && (
                        <div className="feedback-history-detail">
                          <p className="feedback-history-body">{note.body}</p>
                          {note.imageBase64 && (
                            <div className="feedback-history-image">
                              <img src={imageSourceFromBase64(note.imageBase64)} alt="Attached screenshot" />
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm feedback-history-download"
                                onClick={() => { downloadBase64Image(note.imageBase64 || '', `feedback-${note.id.slice(0, 8)}`); }}
                              >
                                Download
                              </button>
                            </div>
                          )}
                          {note.reply && (
                            <div className="feedback-reply">
                              <span className="feedback-reply-label">Reply from the control plane</span>
                              <p>{note.reply}</p>
                            </div>
                          )}
                          <div className="feedback-history-foot">
                            <span>Submitted {new Date(note.createdAt).toLocaleString()}</span>
                            {note.resolvedAt && <span>· Resolved {new Date(note.resolvedAt).toLocaleString()}</span>}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
