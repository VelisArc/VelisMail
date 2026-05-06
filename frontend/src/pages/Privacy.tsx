import { Link } from 'react-router-dom';
import { Shield, Database, ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Privacy() {
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
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Effective Date: January 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              At VelisMail, we believe privacy is a fundamental human right. This Privacy Policy details how our Zero-Knowledge Enterprise Email Hosting platform protects your data.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '40px', marginTop: '40px' }}>
              <div className="glass-card" style={{ padding: '24px' }}>
                <Shield size={24} color="var(--primary)" style={{ marginBottom: '12px' }} />
                <h3 style={{ margin: '0 0 8px 0', borderBottom: 'none', paddingBottom: 0 }}>Zero-Knowledge Architecture</h3>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>We physically cannot read your emails. Your data is encrypted on your device before it ever reaches our servers.</p>
              </div>
              <div className="glass-card" style={{ padding: '24px' }}>
                <Database size={24} color="var(--primary)" style={{ marginBottom: '12px' }} />
                <h3 style={{ margin: '0 0 8px 0', borderBottom: 'none', paddingBottom: 0 }}>Data Sovereignty</h3>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>Your data is isolated in secure, compliant enterprise vaults. We never sell, share, or analyze your business communications.</p>
              </div>
            </div>
          </section>

          <section>
            <h2>1. Information We Do Not Collect</h2>
            <p>
              Unlike legacy email providers that mine your inbox for advertising profiles, VelisMail is engineered to know as little about you as possible. We <strong>do not</strong> collect:
            </p>
            <ul>
              <li>The plaintext content of your emails (subject lines, bodies, or attachments).</li>
              <li>Your encryption keys or passkeys.</li>
              <li>Your browsing history across the web.</li>
              <li>Advertising IDs or tracking pixels.</li>
            </ul>
          </section>

          <section>
            <h2>2. Information We Must Collect</h2>
            <p>
              To operate a reliable, sub-50ms latency enterprise email routing network, we must process certain metadata. This includes:
            </p>
            <ul>
              <li><strong>Account Data:</strong> Email addresses and domain names used to provision your workspace.</li>
              <li><strong>Team Access Data:</strong> Invite email addresses, role assignments, token expiry timestamps, and OTP verification state required to enforce delegated access.</li>
              <li><strong>Payment Data:</strong> Processed entirely by Stripe; we do not store your credit card information.</li>
              <li><strong>Routing Metadata:</strong> Sender, recipient, and timestamps necessary for the SMTP/IMAP protocols to deliver messages.</li>
            </ul>
          </section>

          <section>
            <h2>3. Compliance and Law Enforcement</h2>
            <p>
              VelisMail complies with lawful requests. However, because we utilize <strong>End-to-End Encryption (E2EE)</strong>, we cannot hand over plaintext message contents to any third party, including governments, because we do not possess the decryption keys. All we can provide is cryptographically scrambled ciphertext.
            </p>
          </section>

          <section>
            <h2>4. Your Rights Under GDPR & CCPA</h2>
            <p>
              We extend the strict protections of the General Data Protection Regulation (GDPR) and the California Consumer Privacy Act (CCPA) to all our users globally. You have the right to request a complete export of your encrypted data, or to demand the permanent cryptographic deletion of your account at any time via your Business Dashboard.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>Questions about our privacy architecture? Contact our security team at <a href="mailto:privacy@velismail.online">privacy@velismail.online</a></p>
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
