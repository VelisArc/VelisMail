import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, Search, X, Mail, Phone, Building2, Edit3, Trash2,
  ArrowLeft, CheckCircle2, UserPlus, Star, Filter
} from 'lucide-react';
import { auth, contacts, type Contact } from '../api/client';
import './Contacts.css';

export default function Contacts() {
  const navigate = useNavigate();
  const user = auth.getSession();

  useEffect(() => {
    if (!user) {
      navigate('/login');
    } else if (!user.isBusinessSetupComplete) {
      navigate('/business-setup');
    }
  }, [navigate, user]);

  const [contactList, setContactList] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [filterGroup, setFilterGroup] = useState<string>('all');

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formGroup, setFormGroup] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    setContactList(contacts.getAll());
  }, []);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const resetForm = () => {
    setFormName(''); setFormEmail(''); setFormPhone('');
    setFormCompany(''); setFormGroup(''); setFormNotes('');
  };

  const handleAdd = () => {
    if (!formName || !formEmail) return;
    const c = contacts.add({
      name: formName, email: formEmail, phone: formPhone,
      company: formCompany, group: formGroup || 'General', notes: formNotes,
    });
    setContactList(contacts.getAll());
    setShowAddModal(false);
    resetForm();
    showToast(`${c.name} added to contacts`);
  };

  const handleUpdate = () => {
    if (!selectedContact || !formName || !formEmail) return;
    contacts.update(selectedContact.id, {
      name: formName, email: formEmail, phone: formPhone,
      company: formCompany, group: formGroup, notes: formNotes,
    });
    setContactList(contacts.getAll());
    setEditMode(false);
    setSelectedContact(contacts.getAll().find(c => c.id === selectedContact.id) || null);
    showToast('Contact updated');
  };

  const handleDelete = (id: string) => {
    contacts.remove(id);
    setContactList(contacts.getAll());
    setSelectedContact(null);
    showToast('Contact deleted');
  };

  const handleToggleFav = (id: string) => {
    contacts.toggleFavorite(id);
    setContactList(contacts.getAll());
  };

  const startEdit = () => {
    if (!selectedContact) return;
    setFormName(selectedContact.name);
    setFormEmail(selectedContact.email);
    setFormPhone(selectedContact.phone || '');
    setFormCompany(selectedContact.company || '');
    setFormGroup(selectedContact.group || '');
    setFormNotes(selectedContact.notes || '');
    setEditMode(true);
  };

  const handleComposeToContact = (_email: string) => {
    navigate('/business');
    // Could use a state management solution to pass compose data
  };

  // Groups
  const groups = ['all', ...new Set(contactList.map(c => c.group || 'General'))];

  const filteredContacts = contactList.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.company || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchGroup = filterGroup === 'all' || (c.group || 'General') === filterGroup;
    return matchSearch && matchGroup;
  });

  if (!user || !user.isBusinessSetupComplete) return null;

  return (
    <div className="contacts-page">
      {/* Left Panel */}
      <aside className="contacts-sidebar glass">
        <div className="contacts-sidebar-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/business')}>
            <ArrowLeft size={16} /> Back
          </button>
          <h2><Users size={20} /> Contacts</h2>
        </div>

        <button className="btn btn-primary contacts-add-btn" onClick={() => { resetForm(); setShowAddModal(true); }}>
          <UserPlus size={18} /> Add Contact
        </button>

        <div className="contacts-search">
          <Search size={16} />
          <input type="text" placeholder="Search contacts…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}><X size={14} /></button>}
        </div>

        {/* Group Filter */}
        <div className="contacts-groups">
          {groups.map(g => (
            <button key={g} className={`group-btn ${filterGroup === g ? 'active' : ''}`} onClick={() => setFilterGroup(g)}>
              {g === 'all' ? 'All' : g}
              <span className="group-count">
                {g === 'all' ? contactList.length : contactList.filter(c => (c.group || 'General') === g).length}
              </span>
            </button>
          ))}
        </div>

        {/* Contact List */}
        <div className="contacts-list">
          {filteredContacts.length === 0 ? (
            <div className="contacts-empty">
              <Users size={32} opacity={0.2} />
              <p>No contacts found</p>
            </div>
          ) : (
            filteredContacts.map(c => (
              <div key={c.id}
                className={`contact-row ${selectedContact?.id === c.id ? 'selected' : ''}`}
                onClick={() => { setSelectedContact(c); setEditMode(false); }}
              >
                <div className="contact-avatar" style={{ background: `hsl(${c.name.charCodeAt(0) * 7 % 360}, 60%, 55%)` }}>
                  {c.name.charAt(0)}
                </div>
                <div className="contact-row-info">
                  <span className="contact-row-name">{c.name}</span>
                  <span className="contact-row-email">{c.email}</span>
                </div>
                <button className={`star-btn ${c.favorite ? 'starred' : ''}`}
                  onClick={(e) => { e.stopPropagation(); handleToggleFav(c.id); }}>
                  <Star size={14} fill={c.favorite ? '#facc15' : 'none'} color={c.favorite ? '#facc15' : 'var(--text-muted)'} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Detail Pane */}
      <main className="contacts-detail glass">
        {selectedContact && !editMode ? (
          <div className="contact-detail-content animate-fade">
            <div className="contact-detail-header">
              <div className="contact-detail-avatar" style={{ background: `hsl(${selectedContact.name.charCodeAt(0) * 7 % 360}, 60%, 55%)` }}>
                {selectedContact.name.charAt(0)}
              </div>
              <div>
                <h2>{selectedContact.name}</h2>
                {selectedContact.company && <span className="contact-company"><Building2 size={14} /> {selectedContact.company}</span>}
              </div>
              <div className="contact-detail-actions">
                <button className="btn btn-ghost btn-icon" onClick={startEdit} title="Edit"><Edit3 size={16} /></button>
                <button className="btn btn-danger btn-icon btn-sm" onClick={() => handleDelete(selectedContact.id)} title="Delete"><Trash2 size={16} /></button>
              </div>
            </div>

            <div className="contact-detail-fields">
              <div className="detail-field">
                <Mail size={16} /><span className="detail-label">Email</span>
                <a href={`mailto:${selectedContact.email}`} className="detail-value link">{selectedContact.email}</a>
              </div>
              {selectedContact.phone && (
                <div className="detail-field">
                  <Phone size={16} /><span className="detail-label">Phone</span>
                  <span className="detail-value">{selectedContact.phone}</span>
                </div>
              )}
              {selectedContact.group && (
                <div className="detail-field">
                  <Filter size={16} /><span className="detail-label">Group</span>
                  <span className="detail-value badge badge-primary">{selectedContact.group}</span>
                </div>
              )}
              {selectedContact.notes && (
                <div className="detail-field detail-field-notes">
                  <span className="detail-label">Notes</span>
                  <p className="detail-notes">{selectedContact.notes}</p>
                </div>
              )}
            </div>

            <div className="contact-detail-footer">
              <button className="btn btn-primary btn-sm" onClick={() => handleComposeToContact(selectedContact.email)}>
                <Mail size={16} /> Send Email
              </button>
            </div>
          </div>
        ) : selectedContact && editMode ? (
          <div className="contact-edit-form animate-fade">
            <h3>Edit Contact</h3>
            <div className="form-grid">
              <div className="form-field"><label>Name *</label><input className="input" value={formName} onChange={e => setFormName(e.target.value)} /></div>
              <div className="form-field"><label>Email *</label><input className="input" type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} /></div>
              <div className="form-field"><label>Phone</label><input className="input" value={formPhone} onChange={e => setFormPhone(e.target.value)} /></div>
              <div className="form-field"><label>Company</label><input className="input" value={formCompany} onChange={e => setFormCompany(e.target.value)} /></div>
              <div className="form-field"><label>Group</label><input className="input" value={formGroup} onChange={e => setFormGroup(e.target.value)} placeholder="General" /></div>
              <div className="form-field full-width"><label>Notes</label><textarea className="input" value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setEditMode(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleUpdate} disabled={!formName || !formEmail}>Save Changes</button>
            </div>
          </div>
        ) : (
          <div className="contacts-empty-detail">
            <Users size={48} opacity={0.1} />
            <h3>Select a contact</h3>
            <p>Choose a contact from the list to view details</p>
          </div>
        )}
      </main>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="add-contact-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><UserPlus size={18} /> New Contact</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAddModal(false)}><X size={18} /></button>
            </div>
            <div className="form-grid">
              <div className="form-field"><label>Name *</label><input className="input" value={formName} onChange={e => setFormName(e.target.value)} placeholder="John Doe" /></div>
              <div className="form-field"><label>Email *</label><input className="input" type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="john@example.com" /></div>
              <div className="form-field"><label>Phone</label><input className="input" value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="+91 98765 43210" /></div>
              <div className="form-field"><label>Company</label><input className="input" value={formCompany} onChange={e => setFormCompany(e.target.value)} placeholder="Acme Corp" /></div>
              <div className="form-field"><label>Group</label><input className="input" value={formGroup} onChange={e => setFormGroup(e.target.value)} placeholder="General" /></div>
              <div className="form-field full-width"><label>Notes</label><textarea className="input" value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Any notes about this contact…" /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAdd} disabled={!formName || !formEmail}>
                <UserPlus size={16} /> Add Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}><CheckCircle2 size={16} />{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
