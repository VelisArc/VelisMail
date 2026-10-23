import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Users, Search, X, Mail, Phone, Building2, Edit3, Trash2,
  ArrowLeft, CheckCircle2, UserPlus, Star, Filter, AlertCircle
} from 'lucide-react';
import { auth, isBusinessSetupReady, type Contact } from '../api/client';
import { workspaceApi } from '../api/company';
import './Contacts.css';

export default function Contacts({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const user = auth.getSession();

  useEffect(() => {
    // The embedded view lives inside the already-guarded dashboard shell.
    if (embedded) return;
    if (!user) {
      navigate('/login');
    } else if (!isBusinessSetupReady(user)) {
      navigate('/business');
    }
  }, [embedded, navigate, user]);

  const [contactList, setContactList] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
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

  // The company contact list is stored with the workspace, so the page, the
  // settings panel and every other device read the same records.
  const loadContacts = useCallback(async () => {
    try {
      setLoadError('');
      const result = await workspaceApi.contacts();
      setContactList(result.contacts);
    } catch (error) {
      console.error('load contacts failed', error);
      setLoadError(error instanceof Error ? error.message : 'Unable to load the contacts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (toast) {
      timer = setTimeout(() => setToast(null), 4000);
    }
    return () => clearTimeout(timer);
  }, [toast]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
  };

  const resetForm = () => {
    setFormName(''); setFormEmail(''); setFormPhone('');
    setFormCompany(''); setFormGroup(''); setFormNotes('');
  };

  const findById = (id: string) => contactList.find((contact) => contact.id === id) || null;

  const handleAdd = async () => {
    if (!formName.trim() || !formEmail.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.saveContact({
        name: formName.trim(),
        email: formEmail.trim(),
        phone: formPhone,
        company: formCompany,
        group: formGroup.trim() || 'General',
        notes: formNotes,
      });
      await loadContacts();
      setShowAddModal(false);
      resetForm();
      showToast(`${formName.trim()} added to contacts`);
    } catch (error) {
      console.error('add contact failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to add the contact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedContact || !formName.trim() || !formEmail.trim()) return;
    setSaving(true);
    try {
      await workspaceApi.saveContact({
        id: selectedContact.id,
        name: formName.trim(),
        email: formEmail.trim(),
        phone: formPhone,
        company: formCompany,
        group: formGroup.trim() || 'General',
        notes: formNotes,
      });
      await loadContacts();
      setSelectedContact(findById(selectedContact.id));
      setEditMode(false);
      showToast('Contact updated');
    } catch (error) {
      console.error('update contact failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to update the contact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const contact = findById(id);
    if (!contact) return;
    // A delete removes the contact for the whole company, so it asks first.
    if (!window.confirm(`Delete ${contact.name} (${contact.email}) from the company contacts?`)) {
      return;
    }
    setSaving(true);
    try {
      await workspaceApi.deleteContact(id);
      await loadContacts();
      setSelectedContact(null);
      showToast('Contact deleted');
    } catch (error) {
      console.error('delete contact failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to delete the contact.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFav = async (contact: Contact) => {
    try {
      await workspaceApi.saveContact({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        group: contact.group || 'General',
        notes: contact.notes,
        favorite: !contact.favorite,
      });
      await loadContacts();
    } catch (error) {
      console.error('toggle favourite failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to update the contact.', 'error');
    }
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

  const handleComposeToContact = (email: string) => {
    navigate('/business', { state: { composeTo: email } });
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

  if (!user) return <Navigate to="/login" replace />;
  if (!isBusinessSetupReady(user)) return <Navigate to="/business" replace />;

  return (
    <div className={`contacts-page${embedded ? ' contacts-embedded' : ''}${selectedContact ? ' contacts-showing-detail' : ''}`}>
      {/* Left Panel */}
      <aside className="contacts-sidebar glass">
        <div className="contacts-sidebar-header">
          {!embedded && (
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/business')}>
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <h2><Users size={20} /> Contacts</h2>
        </div>

        <button className="btn btn-primary contacts-add-btn" onClick={() => { resetForm(); setShowAddModal(true); }}>
          <UserPlus size={18} /> Add Contact
        </button>

        <div className="contacts-search">
          <Search size={16} />
          <input type="text" placeholder="Search contacts…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          {searchQuery && <button aria-label="Clear search" className="search-clear" onClick={() => setSearchQuery('')}><X size={14} /></button>}
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
          {loading ? (
            <div className="contacts-empty">
              <p>Loading contacts…</p>
            </div>
          ) : loadError ? (
            <div className="contacts-empty">
              <AlertCircle size={32} opacity={0.4} />
              <p>{loadError}</p>
              <button className="btn btn-secondary btn-sm mt-2" onClick={() => { setLoading(true); void loadContacts(); }}>Try again</button>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="contacts-empty">
              <Users size={32} opacity={0.2} />
              <p>{contactList.length === 0 ? 'No contacts yet' : 'No contacts found'}</p>
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
                  aria-label={c.favorite ? `Remove ${c.name} from favourites` : `Add ${c.name} to favourites`}
                  onClick={(e) => { e.stopPropagation(); void handleToggleFav(c); }}>
                  <Star size={14} fill={c.favorite ? '#facc15' : 'none'} color={c.favorite ? '#facc15' : 'var(--text-muted)'} />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Detail Pane */}
      <main className="contacts-detail glass">
        {selectedContact && (
          <div className="contacts-detail-mobilebar">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setSelectedContact(null); setEditMode(false); }}
            >
              <ArrowLeft size={16} /> All contacts
            </button>
          </div>
        )}
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
                <button aria-label="Edit" className="btn btn-ghost btn-icon" onClick={startEdit} title="Edit"><Edit3 size={16} /></button>
                <button aria-label="Delete" className="btn btn-danger btn-icon btn-sm" disabled={saving} onClick={() => void handleDelete(selectedContact.id)} title="Delete"><Trash2 size={16} /></button>
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
              <div className="detail-field">
                <Filter size={16} /><span className="detail-label">Group</span>
                <span className="detail-value badge badge-primary">{selectedContact.group || 'General'}</span>
              </div>
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
              <div className="form-field"><label htmlFor="contact-edit-name">Name *</label><input id="contact-edit-name" className="input" value={formName} onChange={e => setFormName(e.target.value)} /></div>
              <div className="form-field"><label htmlFor="contact-edit-email">Email *</label><input id="contact-edit-email" className="input" type="email" autoComplete="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} /></div>
              <div className="form-field"><label htmlFor="contact-edit-phone">Phone</label><input id="contact-edit-phone" className="input" type="tel" autoComplete="tel" value={formPhone} onChange={e => setFormPhone(e.target.value)} /></div>
              <div className="form-field"><label htmlFor="contact-edit-company">Company</label><input id="contact-edit-company" className="input" autoComplete="organization" value={formCompany} onChange={e => setFormCompany(e.target.value)} /></div>
              <div className="form-field"><label htmlFor="contact-edit-group">Group</label><input id="contact-edit-group" className="input" value={formGroup} onChange={e => setFormGroup(e.target.value)} placeholder="General" /></div>
              <div className="form-field full-width"><label htmlFor="contact-edit-notes">Notes</label><textarea id="contact-edit-notes" className="input" value={formNotes} onChange={e => setFormNotes(e.target.value)} /></div>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setEditMode(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void handleUpdate()} disabled={saving || !formName || !formEmail}>{saving ? 'Saving…' : 'Save Changes'}</button>
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
          <div className="add-contact-modal glass animate-scale" role="dialog" aria-modal="true" aria-label="New contact" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><UserPlus size={18} /> New Contact</h3>
              <button aria-label="Close" className="btn btn-ghost btn-icon" onClick={() => setShowAddModal(false)}><X size={18} /></button>
            </div>
            <div className="form-grid">
              <div className="form-field"><label htmlFor="contact-add-name">Name *</label><input id="contact-add-name" className="input" value={formName} onChange={e => setFormName(e.target.value)} placeholder="John Doe" /></div>
              <div className="form-field"><label htmlFor="contact-add-email">Email *</label><input id="contact-add-email" className="input" type="email" autoComplete="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="john@example.com" /></div>
              <div className="form-field"><label htmlFor="contact-add-phone">Phone</label><input id="contact-add-phone" className="input" type="tel" autoComplete="tel" value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="+91 98765 43210" /></div>
              <div className="form-field"><label htmlFor="contact-add-company">Company</label><input id="contact-add-company" className="input" autoComplete="organization" value={formCompany} onChange={e => setFormCompany(e.target.value)} placeholder="Acme Corp" /></div>
              <div className="form-field"><label htmlFor="contact-add-group">Group</label><input id="contact-add-group" className="input" value={formGroup} onChange={e => setFormGroup(e.target.value)} placeholder="General" /></div>
              <div className="form-field full-width"><label htmlFor="contact-add-notes">Notes</label><textarea id="contact-add-notes" className="input" value={formNotes} onChange={e => setFormNotes(e.target.value)} placeholder="Any notes about this contact…" /></div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void handleAdd()} disabled={saving || !formName.trim() || !formEmail.trim()}>
                <UserPlus size={16} /> {saving ? 'Saving…' : 'Add Contact'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}>
            {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}
