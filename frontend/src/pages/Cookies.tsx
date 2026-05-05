import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Cookies() {
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
          <span className="section-tag">LEGAL</span>
          <h1>Cookie Policy</h1>
          <p className="legal-updated">Effective Date: January 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              VelisMail's enterprise email platform operates on a strict privacy-first methodology. This policy explains our minimalist approach to cookies.
            </p>
          </section>

          <section>
            <h2>1. Essential Session Cookies Only</h2>
            <p>
              Unlike consumer email platforms, VelisMail <strong>does not use third-party tracking cookies, advertising pixels, or analytics trackers</strong> on our webmail interface or business dashboard. We strictly use essential first-party cookies necessary for maintaining your secure Zero-Trust authentication session.
            </p>
          </section>

          <section>
            <h2>2. Types of Cookies We Use</h2>
            <ul>
              <li><strong>Authentication Tokens (JWT):</strong> Secure, HttpOnly cookies used to cryptographically verify your identity while navigating the dashboard.</li>
              <li><strong>Security and Anti-CSRF:</strong> Tokens used exclusively to prevent Cross-Site Request Forgery attacks against your account.</li>
              <li><strong>Local Storage (Cache):</strong> We use browser localStorage to temporarily cache encrypted ciphertext locally for offline reading and faster rendering. This is wiped upon logout.</li>
            </ul>
          </section>

          <section>
            <h2>3. Managing Cookies</h2>
            <p>
              You can configure your browser to block all cookies. However, because our cookies are strictly tied to cryptographic session management, disabling them will prevent you from logging into the VelisMail Business Dashboard.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>If you have concerns about our cookie usage, contact <a href="mailto:privacy@velismail.online">privacy@velismail.online</a></p>
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
