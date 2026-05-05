import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function SecurityPolicy() {
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
          <h1>Enterprise Security Policy</h1>
          <p className="legal-updated">Effective Date: January 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              Security is not a feature at VelisMail; it is the foundation of our entire infrastructure. This document outlines our cryptographic implementations and operational security measures.
            </p>
          </section>

          <section>
            <h2>1. Cryptographic Standards</h2>
            <p>
              All data at rest is encrypted using <strong>AES-256-GCM</strong>. All data in transit is secured via strict TLS 1.3. Your emails are encrypted client-side using a public/private keypair mechanism (RSA-4096 / ECC) before leaving your browser. The private key never leaves your device unencrypted.
            </p>
          </section>

          <section>
            <h2>2. Zero-Knowledge Authentication</h2>
            <p>
              We utilize Zero-Knowledge Proofs (ZKP) to authenticate your credentials. Passwords are never sent to our servers. Instead, your client generates a cryptographic proof of your password, which our Rust-backend verifies without ever learning the actual string. This makes server-side credential stuffing impossible.
            </p>
          </section>

          <section>
            <h2>3. Infrastructure and Rust Backend</h2>
            <p>
              The VelisMail backend is written entirely in Rust. This eliminates entire classes of memory safety vulnerabilities (like buffer overflows) that commonly plague legacy email systems written in C/C++. Our infrastructure is hosted across distributed, ISO 27001-certified data centers ensuring geographic redundancy and DDoS protection.
            </p>
          </section>

          <section>
            <h2>4. Bug Bounty and Vulnerability Disclosure</h2>
            <p>
              We operate an open vulnerability disclosure program. Security researchers who identify flaws in our cryptographic implementation, authentication flows, or Rust backend are encouraged to report them to our security team.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>Report vulnerabilities to <a href="mailto:security@velismail.online">security@velismail.online</a></p>
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
