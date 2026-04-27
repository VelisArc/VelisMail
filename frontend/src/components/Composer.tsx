import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { 
  Bold, Italic, Underline, List, Link as LinkIcon, 
  Paperclip, Send
} from 'lucide-react';
import { contacts, type Contact } from '../api/client';
import './Composer.css';

interface ComposerProps {
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  fromBadge?: React.ReactNode;
  fromControl?: React.ReactNode;
  onSend: (to: string, subject: string, body: string) => void;
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
  
  // Auto-complete state
  const [showAutoComplete, setShowAutoComplete] = useState(false);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const toInputRef = useRef<HTMLInputElement>(null);
  
  // Rich text editor ref
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && initialBody) {
      editorRef.current.innerHTML = initialBody.replace(/\n/g, '<br>');
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
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  const handleEditorChange = () => {
    if (editorRef.current) {
      setBodyHtml(editorRef.current.innerHTML);
    }
  };

  const handleSend = () => {
    if (!to || !subject) return;
    onSend(to, subject, bodyHtml);
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
            placeholder="recipient@example.com (Type to search contacts...)" 
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
            <button className="toolbar-btn" onMouseDown={e => { e.preventDefault(); execCmd('bold'); }} title="Bold"><Bold size={14} /></button>
            <button className="toolbar-btn" onMouseDown={e => { e.preventDefault(); execCmd('italic'); }} title="Italic"><Italic size={14} /></button>
            <button className="toolbar-btn" onMouseDown={e => { e.preventDefault(); execCmd('underline'); }} title="Underline"><Underline size={14} /></button>
            <div className="toolbar-divider" />
            <button className="toolbar-btn" onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList'); }} title="Bullet List"><List size={14} /></button>
            <button className="toolbar-btn" onMouseDown={e => { 
              e.preventDefault(); 
              const url = prompt('Enter link URL:');
              if (url) execCmd('createLink', url);
            }} title="Link"><LinkIcon size={14} /></button>
          </div>
          
          <div 
            ref={editorRef}
            className="rich-text-editor" 
            contentEditable 
            onInput={handleEditorChange}
            aria-label="Write your email here"
          />
        </div>
      </div>
      
      <div className="compose-footer">
        <div className="compose-footer-left">
          <button className="btn btn-ghost btn-icon" title="Attach Files"><Paperclip size={16} /></button>
        </div>
        <div className="compose-footer-right">
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={sending}>Discard</button>
          <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={sending || !to || !subject}>
            <Send size={16} /> Send
          </button>
        </div>
      </div>
    </div>
  );
}
