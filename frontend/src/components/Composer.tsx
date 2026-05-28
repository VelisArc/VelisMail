import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { 
  List, Link as LinkIcon,
  Clock, Paperclip, Send, X, Trash2
} from 'lucide-react';
import { contacts, type Contact } from '../api/client';
import DOMPurify from 'dompurify';
import './Composer.css';

interface ComposerProps {
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
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
  fromBadge,
  fromControl,
  onSend,
  onClose,
  sending = false
}: ComposerProps) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [bodyHtml, setBodyHtml] = useState(initialBody);
  const [deliveryMode, setDeliveryMode] = useState<'now' | 'scheduled'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  
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
  }, [initialTo]);

  useEffect(() => {
    setSubject(initialSubject);
  }, [initialSubject]);

  useEffect(() => {
    if (editorRef.current) {
      const formattedBody = (initialBody || '').replace(/\n/g, '<br>');
      editorRef.current.innerHTML = DOMPurify.sanitize(formattedBody);
      setBodyHtml(editorRef.current.innerHTML);
    }
  }, [initialBody]);

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTo(val);
    
    // Last word for autocomplete if multiple emails separated by comma
    const parts = val.split(',').map(s => s.trim());
    const lastPart = parts[parts.length - 1];
    
    if (lastPart.length > 1) {
      const results = contacts.search(lastPart);
      setSuggestions(results);
      setShowAutoComplete(results.length > 0);
    } else {
      setShowAutoComplete(false);
    }
  };

  const handleSelectContact = (email: string) => {
    const parts = to.split(',');
    parts.pop(); // remove the partial typing
    const newTo = [...parts.map(p => p.trim()).filter(Boolean), email].join(', ');
    setTo(newTo + (newTo ? ', ' : ''));
    setShowAutoComplete(false);
    toInputRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowAutoComplete(false);
    }
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
    onSend(to, subject, bodyHtml, attachments, deliveryMode === 'scheduled' ? scheduledAt : undefined);
  };

  return (
    <div className="composer-container">
      <div className="compose-fields">
        {(fromControl || fromBadge) && (
          <div className="compose-field">
            <label>From</label>
            {fromControl || fromBadge}
          </div>
        )}
        
        <div className="compose-field to-field-container">
          <label>To</label>
          <input 
            ref={toInputRef}
            className="input to-input" 
            placeholder="name@company.com (type to search contacts...)"
            value={to} 
            onChange={handleToChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setShowAutoComplete(false), 200)}
          />
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
