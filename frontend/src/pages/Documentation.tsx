import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Documentation() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" className="logo-img" alt="ZeeResizer" />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      <div className="container legal-content animate-slide-up">
        <div className="legal-header">
          <span className="section-tag">SUPPORT</span>
          <h1>Documentation</h1>
          <p className="legal-updated">Your guide to VelisMail</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>Getting Started</h2>
            <p>
              Welcome to VelisMail! Create an account via our secure passwordless flow.
              For personal use, start sending encrypted emails immediately.
              For business use, connect your custom domain to enjoy true Zero-Knowledge isolation.
            </p>
          </section>

          <section>
            <h2>Account Types</h2>
            <p>
              <strong>Personal:</strong> Free @velismail.online addresses perfect for daily communications.
              <br/>
              <strong>Business:</strong> Bring your own domain and setup your own external database to guarantee full control over your data.
            </p>
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
