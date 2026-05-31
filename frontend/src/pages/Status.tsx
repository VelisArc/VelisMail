import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Status() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '24px', width: 'auto' }} />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      <div className="container legal-content animate-slide-up">
        <div className="legal-header">
          <span className="section-tag">SYSTEM STATUS</span>
          <h1>All Systems Operational</h1>
          <p className="legal-updated">Last checked: Just now</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>Current Status</h2>
            <ul>
              <li><strong>API Gateway:</strong> Operational</li>
              <li><strong>Web Application:</strong> Operational</li>
              <li><strong>Database:</strong> Operational</li>
              <li><strong>Email Delivery:</strong> Operational</li>
            </ul>
            <p>If you are experiencing issues, please contact our support team.</p>
          </section>
        </div>
      </div>

      <footer className="legal-footer">
        <div className="container legal-footer-inner">
          <span>© 2026 VelisMail. All rights reserved.</span>
          <div className="legal-footer-links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/cookies">Cookie Policy</Link>
            <Link to="/aup">Acceptable Use</Link>
            <Link to="/security">Security</Link>
            <Link to="/refund">Refund Policy</Link>
            <Link to="/about">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
