import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Users, Database, Globe, LogOut } from 'lucide-react';
import { auth } from '../api/client';
import './BusinessDashboard.css'; // Reuse existing styles

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = auth.getSession();
    if (!session || session.email !== 'admin@velisads.online') {
      navigate('/login');
    } else {
      setLoading(false);
    }
  }, [navigate]);

  if (loading) return null;

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
            <button className="nav-item active"><Shield size={18} /> Admin Overview</button>
            <button className="nav-item"><Users size={18} /> Manage Users</button>
            <button className="nav-item"><Globe size={18} /> Global Domains</button>
            <button className="nav-item"><Database size={18} /> Platform Logs</button>
          </nav>
        </div>
        <div className="sidebar-bottom">
          <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { auth.logout(); navigate('/login'); }}>
            <LogOut size={16} /> Secure Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="biz-main">
        <div className="biz-panel animate-fade" style={{ padding: '40px' }}>
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
        </div>
      </main>
    </div>
  );
}
