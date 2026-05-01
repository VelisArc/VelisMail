import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Users, Database, Globe, LogOut, Search, Filter, Ban, CheckSquare, Square, AlertTriangle, X } from 'lucide-react';
import { auth } from '../api/client';
import './BusinessDashboard.css';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'domains' | 'logs'>('overview');
  
  // User Management State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [confirmModal, setConfirmModal] = useState<{ action: string, data: any } | null>(null);

  const [mockUsers, setMockUsers] = useState([
    { id: '1', name: 'Acme Corp', email: 'admin@acmecorp.com', domain: 'acmecorp.com', status: 'active', usage: '45 GB' },
    { id: '2', name: 'Stark Ind', email: 'tony@stark.com', domain: 'stark.com', status: 'active', usage: '1.2 TB' },
    { id: '3', name: 'SpammerX', email: 'admin@spammer.xyz', domain: 'spammer.xyz', status: 'blocked', usage: '0 GB' },
  ]);

  useEffect(() => {
    const session = auth.getSession();
    if (!session || session.email !== 'admin@velisads.online') {
      navigate('/login');
    } else {
      setLoading(false);
    }
  }, [navigate]);

  if (loading) return null;

  const filteredUsers = mockUsers.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.domain.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectAll = () => {
    if (selectedUsers.length === filteredUsers.length) setSelectedUsers([]);
    else setSelectedUsers(filteredUsers.map(u => u.id));
  };

  const handleBlockUser = () => {
    if (confirmModal?.action === 'block') {
      setMockUsers(mockUsers.map(u => selectedUsers.includes(u.id) ? { ...u, status: 'blocked' } : u));
      setSelectedUsers([]);
      setConfirmModal(null);
    }
  };

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  return (
    <div className="biz-dash">
      {/* Sidebar */}
      <aside className="biz-sidebar glass">
        <div className="sidebar-top">
          <div className="dash-brand">
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '20px', width: 'auto' }} />
            <div className="dash-brand-info">
              <span className="dash-brand-name">VelisMail</span>
              <span className="badge badge-primary dash-brand-sub" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>Super Admin</span>
            </div>
          </div>
          <nav className="sidebar-nav">
            <button className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}><Shield size={18} /> Admin Overview</button>
            <button className={`nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}><Users size={18} /> Manage Users</button>
            <button className={`nav-item ${activeTab === 'domains' ? 'active' : ''}`} onClick={() => setActiveTab('domains')}><Globe size={18} /> Global Domains</button>
            <button className={`nav-item ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}><Database size={18} /> Platform Logs</button>
          </nav>
        </div>
        <div className="sidebar-bottom">
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => setConfirmModal({ action: 'logout', data: null })}>
            <LogOut size={16} /> Secure Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="biz-main">
        <div className="biz-panel animate-fade" style={{ padding: '40px' }}>
          
          {activeTab === 'overview' && (
            <>
              <div className="panel-header">
                <div>
                  <h2>Super Admin Dashboard</h2>
                  <p>Welcome, admin@velisads.online. You have master access to the VelisMail network.</p>
                </div>
              </div>
              
              <div className="analytics-cards" style={{ marginTop: '20px' }}>
                <div className="analytics-card glass-card">
                  <div className="analytics-card-label"><Users size={16} /> Total Tenants</div>
                  <div className="analytics-card-value">1,204</div>
                  <div className="analytics-card-change positive">+12 this week</div>
                </div>
                <div className="analytics-card glass-card">
                  <div className="analytics-card-label"><Database size={16} /> Total Storage</div>
                  <div className="analytics-card-value">4.2 TB</div>
                  <div className="analytics-card-change neutral">Encrypted blocks</div>
                </div>
                <div className="analytics-card glass-card">
                  <div className="analytics-card-label"><Shield size={16} /> Platform Health</div>
                  <div className="analytics-card-value">99.99%</div>
                  <div className="analytics-card-change positive">All systems operational</div>
                </div>
              </div>

              <div className="glass-card" style={{ marginTop: '30px', padding: '20px' }}>
                <h3>Recent System Activity</h3>
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ padding: '12px', background: 'var(--bg-surface-2)', borderRadius: '8px', fontSize: '0.9rem' }}>
                    <strong style={{ color: 'var(--accent)' }}>[SYSTEM]</strong> Node cluster US-East scaled up (+2 nodes).
                  </div>
                  <div style={{ padding: '12px', background: 'var(--bg-surface-2)', borderRadius: '8px', fontSize: '0.9rem' }}>
                    <strong style={{ color: 'var(--warning)' }}>[SECURITY]</strong> DMARC policy enforcement block on untrusted IP 192.168.1.5.
                  </div>
                  <div style={{ padding: '12px', background: 'var(--bg-surface-2)', borderRadius: '8px', fontSize: '0.9rem' }}>
                    <strong style={{ color: 'var(--primary)' }}>[USER]</strong> New enterprise tenant registered (acme-corp).
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'users' && (
            <>
              <div className="panel-header">
                <div>
                  <h2>Business Management System</h2>
                  <p>Search, filter, and moderate business tenants across the platform.</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div className="search-box" style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
                    <input 
                      type="text" 
                      placeholder="Search users, domains..." 
                      className="input" 
                      style={{ paddingLeft: '36px', width: '250px' }}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <button className="btn btn-secondary"><Filter size={16} /> Filters</button>
                </div>
              </div>

              <div className="glass-card" style={{ marginTop: '20px', overflow: 'hidden' }}>
                {selectedUsers.length > 0 && (
                  <div style={{ padding: '12px 20px', background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-primary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{selectedUsers.length} user(s) selected</span>
                    <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)', height: '32px' }} onClick={() => setConfirmModal({ action: 'block', data: null })}>
                      <Ban size={16} /> Block Selected
                    </button>
                  </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-primary)', background: 'var(--bg-surface-2)' }}>
                      <th style={{ padding: '16px', width: '40px' }}>
                        <div onClick={handleSelectAll} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                          {selectedUsers.length === filteredUsers.length && filteredUsers.length > 0 ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                        </div>
                      </th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>BUSINESS NAME</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>DOMAIN</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>USAGE</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border-primary)', transition: 'background 0.2s' }}>
                        <td style={{ padding: '16px' }}>
                          <div onClick={() => setSelectedUsers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
                            {selectedUsers.includes(u.id) ? <CheckSquare size={18} className="text-accent" /> : <Square size={18} />}
                          </div>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div style={{ fontWeight: 500 }}>{u.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.email}</div>
                        </td>
                        <td style={{ padding: '16px', fontSize: '0.9rem' }}>{u.domain}</td>
                        <td style={{ padding: '16px', fontSize: '0.9rem' }}>{u.usage}</td>
                        <td style={{ padding: '16px' }}>
                          <span className={`badge ${u.status === 'active' ? 'badge-primary' : 'badge-danger'}`} style={{ textTransform: 'capitalize' }}>
                            {u.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>No businesses found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Two-Step Confirmation Modal Overlay */}
          {confirmModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="glass-card" style={{ width: '400px', padding: '24px', position: 'relative' }}>
                <button 
                  onClick={() => setConfirmModal(null)}
                  style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  <X size={20} />
                </button>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <h3 style={{ marginBottom: '8px', fontSize: '1.1rem' }}>
                      {confirmModal.action === 'block' ? 'Confirm Account Block' : 'Confirm Secure Logout'}
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px', lineHeight: 1.5 }}>
                      {confirmModal.action === 'block' 
                        ? 'Are you absolutely sure you want to block the selected businesses? They will immediately lose access to the VelisMail API and all active connections will be terminated.'
                        : 'Are you sure you want to logout? You will need to re-authenticate with your security key to access the Super Admin Dashboard again.'}
                    </p>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost" onClick={() => setConfirmModal(null)}>Cancel</button>
                      <button 
                        className="btn btn-primary" 
                        style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={confirmModal.action === 'block' ? handleBlockUser : handleLogout}
                      >
                        {confirmModal.action === 'block' ? 'Yes, Block Users' : 'Yes, Logout'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
