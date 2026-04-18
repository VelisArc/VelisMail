import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function SecurityPolicy() {
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
          <span className="section-tag">LEGAL</span>
          <h1>Security Policy</h1>
          <p className="legal-updated">Last updated: April 18, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>1. Zero-Knowledge Architecture</h2>
            <p>
              VelisMail operates on a strict zero-knowledge principle. We do not have access to your private keys, meaning we cannot decrypt, read, or scan your emails. Your data remains entirely under your control.
            </p>
          </section>

          <section>
            <h2>2. End-to-End Encryption (E2EE)</h2>
            <p>
              All messages sent between VelisMail users are automatically end-to-end encrypted. Data is encrypted on your device before it is transmitted and only decrypted on the recipient's device. For emails sent to non-VelisMail users, messages are encrypted at rest using strong cryptographic standards (e.g., AES-256).
            </p>
          </section>

          <section>
            <h2>3. Authentication</h2>
            <p>
              We implement passwordless authentication using modern passkey standards. We do not store any passwords on our servers, mitigating the risk of credential stuffing or password-based breaches. Authentication challenges are verified using Zero-Knowledge Proofs.
            </p>
          </section>

          <section>
            <h2>4. Infrastructure Security</h2>
            <p>
              Our backend systems utilize isolated microservices and are hosted in highly secure environments. We follow the principle of least privilege, ensuring that services and personnel only have the access necessary for their functions. We enforce strict transport-layer security (TLS 1.3) across all network communications.
            </p>
          </section>

          <section>
            <h2>5. Bug Bounty Program</h2>
            <p>
              We believe in the power of the security community. If you discover a vulnerability in VelisMail, we encourage you to report it to us responsibly. Please contact our security team at <a href="mailto:security@velismail.com">security@velismail.com</a>. We offer rewards for verifiable bugs in accordance with our bug bounty guidelines.
            </p>
          </section>

          <section>
            <h2>6. Incident Response</h2>
            <p>
              In the unlikely event of a security incident, we have comprehensive incident response protocols in place. Users will be notified transparently and promptly if any metadata or unencrypted account information is ever compromised.
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
