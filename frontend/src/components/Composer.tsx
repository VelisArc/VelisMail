import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { 
  List, Link as LinkIcon,
  Clock, Paperclip, Send, X, Trash2
} from 'lucide-react';
import { contacts, auth, loadBusinessTeamMembers, getUserFromPersistentStore, type Contact } from '../api/client';
import DOMPurify from 'dompurify';
import './Composer.css';

const AVATAR_COLORS = ['#0d9488','#0891b2','#2563eb','#7c3aed','#db2777','#dc2626','#ea580c','#ca8a04','#16a34a','#059669'];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Escape plain text before inserting it into the HTML body of an email. */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const resolveRecipientInfo = (email: string) => {
  const cleanEmail = email.toLowerCase().trim();
  
  // 1. Check logged-in user
  const session = auth.getSession();
  if (session && (session.email || '').toLowerCase().trim() === cleanEmail) {
    return {
      name: session.displayName || session.email,
      avatarUrl: session.profileImageUrl || null,
    };
  }

  // 2. Check contacts list
  const allContacts = contacts.getAll();
  const contact = allContacts.find(c => (c.email || '').toLowerCase().trim() === cleanEmail);
  if (contact) {
    return {
      name: contact.name,
      avatarUrl: null,
    };
  }

  // 3. Check team members
  const teamMembers = loadBusinessTeamMembers();
  const teamMember = teamMembers.find(t => (t.email || '').toLowerCase().trim() === cleanEmail);
  if (teamMember) {
    return {
      name: teamMember.name,
      avatarUrl: null,
    };
  }

  // 4. Check persistent user store
  try {
    const persistentUser = getUserFromPersistentStore(cleanEmail);
    if (persistentUser) {
      return {
        name: persistentUser.displayName || persistentUser.email,
        avatarUrl: persistentUser.profileImageUrl || null,
      };
    }
  } catch (e) {
    console.error('Error fetching persistent user:', e);
  }

  // 5. Fallback
  return {
    name: email,
    avatarUrl: null,
  };
};

/**
 * Build the brand-logo block appended to outgoing mail.
 *
 * The logo URL is a user setting, so it must never be interpolated raw into
 * the message HTML: quotes would break out of the `src` attribute and run as
 * markup in the recipient's client. Only raster images over https or an
 * inline image data URL are accepted.
 */
function emailLogoMarkup(url: string): string | null {
  const trimmed = url.trim();
  if (!/^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(trimmed)) {
    return null;
  }
  const src = trimmed
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<br><br><div class="email-brand-logo" style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #eaeaea;"><img src="${src}" alt="Sender Logo" style="max-height: 45px; max-width: 150px; object-fit: contain;" /></div>`;
}

const getRecipientAvatar = (name: string, avatarUrl: string | null) => {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="recipient-avatar"
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '0',
          objectFit: 'cover',
        }}
      />
    );
  }

  const initial = name.charAt(0).toUpperCase();
  const bg = avatarColor(name);

  return (
    <div
      className="recipient-avatar"
      style={{
        background: bg + '20',
        color: bg,
        width: '18px',
        height: '18px',
        borderRadius: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 'bold',
        fontSize: '9px',
      }}
    >
      {initial}
    </div>
  );
};

interface ComposerProps {
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  initialReplyQuote?: string;
  fromBadge?: React.ReactNode;
  fromControl?: React.ReactNode;
  onSend: (to: string, subject: string, body: string, attachments?: File[], scheduledAt?: string) => void;
  onClose: () => void;
  sending?: boolean;
}

export default function Composer({
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  initialReplyQuote = '',
  fromBadge,
  fromControl,
  onSend,
  onClose,
  sending = false
}: ComposerProps) {
  const [to, setTo] = useState(initialTo);
  const [recipients, setRecipients] = useState<string[]>(
    initialTo.split(',').map(s => s.trim()).filter(Boolean)
  );
  const [inputValue, setInputValue] = useState('');
  const [subject, setSubject] = useState(initialSubject);
  const [bodyHtml, setBodyHtml] = useState(initialBody);
  const [deliveryMode, setDeliveryMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  
  // Collapse Quote State (Gmail-like toggle system)
  const [quoteText, setQuoteText] = useState('');
  const [isQuoteHidden, setIsQuoteHidden] = useState(false);
  
  // Auto-complete state
  const [showAutoComplete, setShowAutoComplete] = useState(false);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const toInputRef = useRef<HTMLInputElement>(null);
  
  // Rich text editor ref
  const editorRef = useRef<HTMLDivElement>(null);

  // Link modal state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [savedRange, setSavedRange] = useState<Range | null>(null);

  useEffect(() => {
    setTo(initialTo);
    setRecipients(initialTo.split(',').map(s => s.trim()).filter(Boolean));
  }, [initialTo]);

  useEffect(() => {
    setSubject(initialSubject);
  }, [initialSubject]);

  useEffect(() => {
    if (editorRef.current) {
      if (initialReplyQuote) {
        setQuoteText(initialReplyQuote);
        setIsQuoteHidden(true);
        const formattedBody = (initialBody || '').replace(/\n/g, '<br>');
        editorRef.current.innerHTML = DOMPurify.sanitize(formattedBody);
      } else {
        const quoteRegex = /(\n\nOn [\s\S]+ wrote:\n[\s\S]*)$/;
        const match = (initialBody || '').match(quoteRegex);
        
        if (match) {
          const quote = match[1];
          const bodyWithoutQuote = (initialBody || '').replace(quoteRegex, '');
          setQuoteText(quote);
          setIsQuoteHidden(true);
          
          const formattedBody = bodyWithoutQuote.replace(/\n/g, '<br>');
          editorRef.current.innerHTML = DOMPurify.sanitize(formattedBody);
        } else {
          setQuoteText('');
          setIsQuoteHidden(false);
          const formattedBody = (initialBody || '').replace(/\n/g, '<br>');
          editorRef.current.innerHTML = DOMPurify.sanitize(formattedBody);
        }
      }
      setBodyHtml(editorRef.current.innerHTML);
    }
  }, [initialBody, initialReplyQuote]);

  const addRecipient = (email: string) => {
    const parsed = email.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    const next = [...recipients];
    parsed.forEach(addr => {
      if (!next.includes(addr)) {
        next.push(addr);
      }
    });
    setRecipients(next);
    setTo(next.join(', '));
    setInputValue('');
  };

  const removeRecipient = (index: number) => {
    const next = recipients.filter((_, i) => i !== index);
    setRecipients(next);
    setTo(next.join(', '));
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.endsWith(',') || val.endsWith(';')) {
      const email = val.slice(0, -1).trim();
      if (email) {
        addRecipient(email);
      }
      return;
    }
    setInputValue(val);
    
    const lastPart = val.trim();
    if (lastPart.length > 1) {
      const results = contacts.search(lastPart);
      setSuggestions(results);
      setShowAutoComplete(results.length > 0);
    } else {
      setShowAutoComplete(false);
    }
  };

  const handleSelectContact = (email: string) => {
    if (!recipients.includes(email)) {
      const next = [...recipients, email];
      setRecipients(next);
      setTo(next.join(', '));
    }
    setInputValue('');
    setShowAutoComplete(false);
    toInputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      const email = inputValue.trim();
      if (email) {
        e.preventDefault();
        addRecipient(email);
      }
    } else if (e.key === 'Backspace' && !inputValue) {
      const next = [...recipients];
      next.pop();
      setRecipients(next);
      setTo(next.join(', '));
    } else if (e.key === 'Escape') {
      setShowAutoComplete(false);
    }
  };

  const handleBlur = () => {
    const email = inputValue.trim();
    if (email) {
      addRecipient(email);
    }
    setTimeout(() => setShowAutoComplete(false), 200);
  };

  const execCmd = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    handleEditorChange();
  };

  const handleEditorChange = () => {
    if (editorRef.current) {
      setBodyHtml(editorRef.current.innerHTML);
    }
  };

  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if (!to || !subject) return;
    let finalBody = bodyHtml;
    
    // Auto-append user email signature logo if configured
    const session = auth.getSession();
    if (session && session.emailLogoUrl) {
      const logoHtml = emailLogoMarkup(session.emailLogoUrl);
      if (logoHtml && !finalBody.includes('class="email-brand-logo"')) {
        finalBody = finalBody + logoHtml;
      }
    }

    if (isQuoteHidden && quoteText) {
      // The quoted mail is plain text from an external sender. Escape it
      // before turning newlines into <br>, otherwise an HTML body in the
      // quoted message would be injected into the outgoing mail.
      const formattedQuote = escapeHtmlText(quoteText).replace(/\n/g, '<br>');
      finalBody = finalBody + formattedQuote;
    }
    onSend(to, subject, finalBody, attachments, deliveryMode === 'scheduled' ? scheduledAt : undefined);
  };

  const handleExpandQuote = () => {
    if (editorRef.current && quoteText) {
      const formattedQuote = escapeHtmlText(quoteText).replace(/\n/g, '<br>');
      const currentContent = editorRef.current.innerHTML;
      editorRef.current.innerHTML = currentContent + DOMPurify.sanitize(formattedQuote);
      setBodyHtml(editorRef.current.innerHTML);
      setIsQuoteHidden(false);
      setQuoteText('');
    }
  };

  return (
    <div className="composer-container">
      <div className="compose-header">
        <h3><Send size={14} style={{ color: 'var(--primary-400)' }} /> New Message</h3>
        <button aria-label="Close composer" className="btn btn-ghost btn-icon btn-sm" style={{ minHeight: 'auto', width: '28px', height: '28px' }} onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>
      <div className="compose-fields">
        {(fromControl || fromBadge) && (
          <div className="compose-field">
            <label>From</label>
            {fromControl || fromBadge}
          </div>
        )}
        
        <div className="compose-field to-field-container" style={{ alignItems: 'flex-start' }}>
          <label style={{ marginTop: '8px' }}>To</label>
          <div className="to-input-wrapper">
            <div className="to-chips-wrapper">
              {recipients.map((email, idx) => {
                const info = resolveRecipientInfo(email);
                const isValid = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
                return (
                  <div key={idx} className={`recipient-pill ${isValid ? '' : 'invalid'}`} title={email}>
                    {getRecipientAvatar(info.name, info.avatarUrl)}
                    <span className="recipient-name">{info.name === email ? email : `${info.name} (${email})`}</span>
                    <span className="recipient-remove" onClick={(e) => { e.stopPropagation(); removeRecipient(idx); }}>
                      <X size={12} />
                    </span>
                  </div>
                );
              })}
              <input 
                ref={toInputRef}
                className="to-chips-input" 
                placeholder={recipients.length === 0 ? "name@company.com (type to search contacts...)" : ""}
                value={inputValue} 
                onChange={handleToChange}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
              />
            </div>
          </div>
          {showAutoComplete && (
            <div className="autocomplete-dropdown glass-card animate-fade">
              {suggestions.map(c => (
                <div key={c.id} className="autocomplete-item" onClick={() => handleSelectContact(c.email)}>
                  <div className="autocomplete-avatar">{c.name.charAt(0)}</div>
                  <div className="autocomplete-info">
                    <span className="autocomplete-name">{c.name}</span>
                    <span className="autocomplete-email">{c.email}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="compose-field schedule-field">
          <label>Delivery</label>
          <div className="schedule-controls">
            <select className="input" value={deliveryMode} onChange={e => setDeliveryMode(e.target.value as 'now' | 'scheduled')}>
              <option value="now">Send now</option>
              <option value="scheduled">Schedule send</option>
            </select>
            {deliveryMode === 'scheduled' && (
              <input
                className="input"
                type="datetime-local"
                value={scheduledAt}
                min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                onChange={e => setScheduledAt(e.target.value)}
              />
            )}
          </div>
        </div>
        
        <div className="compose-field">
          <label>Subject</label>
          <input 
            className="input subject-input" 
            placeholder="Email subject" 
            value={subject} 
            onChange={e => setSubject(e.target.value)} 
          />
        </div>

        <div className="rich-text-container">
          <div className="rich-text-toolbar">
            <button aria-label="Bullet List" type="button" className="toolbar-btn" onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList'); }} title="Bullet List"><List size={14} /></button>
            <button aria-label="Insert Link" type="button" className="toolbar-btn" onMouseDown={e => {
              e.preventDefault(); 
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                setSavedRange(selection.getRangeAt(0));
              } else {
                setSavedRange(null);
              }
              setLinkUrl('');
              setShowLinkModal(true);
            }} title="Link"><LinkIcon size={14} /></button>
          </div>
          
          <div 
            ref={editorRef}
            className="rich-text-editor" 
            contentEditable 
            data-placeholder="Write your message..."
            onInput={handleEditorChange}
            onPaste={(event) => {
              event.preventDefault();
              const text = event.clipboardData.getData('text/plain');
              document.execCommand('insertText', false, text.slice(0, 100000));
              handleEditorChange();
            }}
            aria-label="Write your email here"
          />
          {isQuoteHidden && quoteText && (
            <div 
              className="trimmed-content-toggle"
              title="Show trimmed content"
              onClick={handleExpandQuote}
            >
              <span className="dots">•••</span>
            </div>
          )}
        </div>

        {attachments.length > 0 && (
          <div className="attachments-list">
            {attachments.map((file, i) => (
              <div key={i} className="attachment-chip">
                <Paperclip size={12} />
                <span>{file.name}</span>
                <button aria-label="Remove attachment" className="attachment-remove" onClick={() => removeAttachment(i)}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="compose-footer">
        <div className="compose-footer-left">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            style={{ display: 'none' }} 
            multiple 
          />
          <button 
            aria-label="Attach Files" className="btn btn-ghost btn-icon"
            title="Attach Files"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={16} />
          </button>
        </div>
        <div className="compose-footer-right">
          <button aria-label="Discard draft" className="btn btn-ghost btn-icon" onClick={onClose} disabled={sending} title="Discard draft">
            <Trash2 size={16} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={sending || !to || !subject || (deliveryMode === 'scheduled' && !scheduledAt)}>
            {deliveryMode === 'scheduled' ? <Clock size={16} /> : <Send size={16} />}
            {deliveryMode === 'scheduled' ? 'Schedule' : 'Send'}
          </button>
        </div>
      </div>

      {showLinkModal && (
        <div className="modal-overlay" onClick={() => setShowLinkModal(false)}>
          <div className="link-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            <h3>Insert Link</h3>
            <input
              type="url"
              className="input"
              placeholder="https://example.com"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (linkUrl) {
                    if (savedRange) {
                      const selection = window.getSelection();
                      if (selection) {
                        selection.removeAllRanges();
                        selection.addRange(savedRange);
                      }
                    }
                    execCmd('createLink', linkUrl);
                    setShowLinkModal(false);
                  }
                }
              }}
            />
            <div className="link-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLinkModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => {
                if (linkUrl) {
                  if (savedRange) {
                    const selection = window.getSelection();
                    if (selection) {
                      selection.removeAllRanges();
                      selection.addRange(savedRange);
                    }
                  }
                  execCmd('createLink', linkUrl);
                  setShowLinkModal(false);
                }
              }}>Insert</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
