import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SEO from '../components/SEO';
import './Legal.css';

export default function SecurityPolicy() {
  return (
    <div className="legal-page">
      <SEO title="Security Policy" description="VelisMail Security Policy outlines our zero-knowledge encryption models, secure Rust-built backend, secure recovery, and strict RBAC access controls." />
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo" id="security-nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" className="legal-nav-logo" id="security-nav-logo-img" />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm" id="security-nav-back"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      <div className="container legal-content animate-slide-up">
        <div className="legal-header">
          <span className="section-tag" id="security-header-tag">SECURITY</span>
          <h1>Enterprise Security Policy</h1>
          <p className="legal-updated">Effective Date: January 1, 2026 · Last Updated: May 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              Security is not a feature at VelisMail; it is the foundation of our entire infrastructure. This document outlines our cryptographic implementations, operational security measures, and the processes we follow to protect your data at every level.
            </p>
          </section>

          <section>
            <h2>1. Cryptographic Standards</h2>
            <p>
              All data at rest is encrypted using <strong>AES-256-GCM</strong>. All data in transit is secured via strict TLS 1.3 with forward secrecy (ECDHE). Your emails are encrypted client-side using a public/private keypair mechanism (RSA-4096 / ECC) before leaving your browser. The private key never leaves your device unencrypted.
            </p>
            <p>Key cryptographic measures include:</p>
            <ul>
              <li><strong>Transport Security:</strong> TLS 1.3 enforced on all connections. TLS 1.0 and 1.1 are permanently disabled.</li>
              <li><strong>Encryption at Rest:</strong> AES-256-GCM for all stored data, including backups.</li>
              <li><strong>Key Derivation:</strong> Argon2id for password hashing with per-user salts.</li>
              <li><strong>Message Encryption:</strong> Client-side E2EE using RSA-4096 / X25519 key exchange.</li>
              <li><strong>Certificate Management:</strong> Automated certificate rotation via ACME protocol.</li>
            </ul>
          </section>

          <section>
            <h2>2. Zero-Knowledge Authentication</h2>
            <p>
              VelisMail accepts credentials only over HTTPS and stores passwords as one-way password hashes. Recovery-sensitive flows require OTP verification before account creation or password reset can complete.
            </p>
            <p>
              <strong>Team Access Security:</strong> Team sessions require a scoped invite key, exact email match, time-limited OTP verification (10-minute window), and role-based authorization before dashboard access is granted. Invited users inherit only the workspace configuration and permissions assigned by the administrator.
            </p>
            <p>
              <strong>Account Recovery:</strong> VelisMail verifies recovery email ownership before account creation and password reset flows can complete.
            </p>
          </section>

          <section>
            <h2>3. Infrastructure Security</h2>
            <p>
              The VelisMail backend is written entirely in <strong>Rust</strong>. This eliminates entire classes of memory safety vulnerabilities (buffer overflows, use-after-free, data races) that commonly plague legacy email systems written in C/C++.
            </p>
            <p>Additional infrastructure measures:</p>
            <ul>
              <li><strong>Network Isolation:</strong> All internal services communicate over encrypted private networks.</li>
              <li><strong>DDoS Protection:</strong> Enterprise-grade DDoS mitigation via Cloudflare with automatic traffic scrubbing.</li>
              <li><strong>Rate Limiting:</strong> API endpoints are rate-limited to prevent brute-force attacks and abuse.</li>
              <li><strong>Automatic Updates:</strong> Security patches are applied within 24 hours of public disclosure for critical vulnerabilities.</li>
              <li><strong>Immutable Logging:</strong> All system events are logged to append-only audit trails that cannot be tampered with.</li>
            </ul>
          </section>

          <section>
            <h2>4. Access Controls</h2>
            <p>VelisMail enforces strict access controls at multiple levels:</p>
            <ul>
              <li><strong>Role-Based Access Control (RBAC):</strong> Three workspace roles (Admin, Member, Viewer) with clearly scoped permissions.</li>
              <li><strong>Principle of Least Privilege:</strong> Users are granted the minimum access necessary to perform their functions.</li>
              <li><strong>Session Management:</strong> Sessions are cryptographically signed, time-limited, and automatically revoked upon credential changes.</li>
              <li><strong>IP-Based Restrictions:</strong> Enterprise tier workspaces can enforce IP whitelisting to restrict access to approved networks.</li>
              <li><strong>Device Revocation:</strong> Administrators can instantly revoke any device or session from the Team Access panel.</li>
            </ul>
          </section>

          <section>
            <h2>5. Incident Response</h2>
            <p>
              VelisMail maintains a documented incident response plan with the following commitments:
            </p>
            <ul>
              <li><strong>Detection:</strong> Automated monitoring systems detect anomalies in real-time.</li>
              <li><strong>Response:</strong> Our security team is alerted within 5 minutes of a detected security event.</li>
              <li><strong>Notification:</strong> Affected users are notified within 72 hours of a confirmed data breach, in compliance with GDPR Article 33.</li>
              <li><strong>Remediation:</strong> Root cause analysis is completed within 7 days, with corrective actions implemented immediately.</li>
              <li><strong>Post-Mortem:</strong> A detailed post-incident report is published for significant security events.</li>
            </ul>
          </section>

          <section>
            <h2>6. Email Security Standards</h2>
            <p>VelisMail enforces comprehensive email authentication and security standards:</p>
            <ul>
              <li><strong>SPF (Sender Policy Framework):</strong> Validates that emails are sent from authorized mail servers.</li>
              <li><strong>DKIM (DomainKeys Identified Mail):</strong> Cryptographically signs outgoing emails to prevent tampering.</li>
              <li><strong>DMARC (Domain-based Message Authentication):</strong> Protects your domain from email spoofing and phishing.</li>
              <li><strong>Anti-Spam Filtering:</strong> Automated detection and quarantine of suspected spam and malicious emails.</li>
              <li><strong>Phishing Detection:</strong> Real-time analysis of incoming emails for known phishing patterns and suspicious links.</li>
            </ul>
          </section>

          <section>
            <h2>7. Compliance</h2>
            <p>VelisMail's security practices align with the following frameworks and regulations:</p>
            <ul>
              <li>ISO 27001 (Information Security Management)</li>
              <li>SOC 2 Type II (Security, Availability, Confidentiality)</li>
              <li>GDPR (General Data Protection Regulation)</li>
              <li>CCPA (California Consumer Privacy Act)</li>
              <li>India DPDPA (Digital Personal Data Protection Act)</li>
              <li>HIPAA (Health Insurance Portability and Accountability Act) — for healthcare customers on Enterprise tier</li>
            </ul>
          </section>

          <section>
            <h2>8. Bug Bounty and Vulnerability Disclosure</h2>
            <p>
              We operate a responsible vulnerability disclosure program. Security researchers who identify flaws in our cryptographic implementation, authentication flows, or backend are encouraged to report them to our security team. We commit to:
            </p>
            <ul>
              <li>Acknowledging reports within 48 hours.</li>
              <li>Providing status updates within 7 days.</li>
              <li>Not pursuing legal action against researchers acting in good faith.</li>
              <li>Crediting researchers in our security advisories (with their consent).</li>
            </ul>
            <p>
              Report vulnerabilities to <a href="mailto:security@velismail.online">security@velismail.online</a>. Please include a detailed description, steps to reproduce, and any proof-of-concept code.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>For security inquiries, contact <a href="mailto:support@velismail.online">support@velismail.online</a></p>
          </section>
        </div>
      </div>

      <footer className="legal-footer">
        <div className="container legal-footer-inner">
          <span>© 2026 VelisMail. All rights reserved.</span>
          <div className="legal-footer-links">
            <Link to="/privacy" id="security-footer-privacy">Privacy Policy</Link>
            <Link to="/terms" id="security-footer-terms">Terms of Service</Link>
            <Link to="/cookies" id="security-footer-cookies">Cookie Policy</Link>
            <Link to="/aup" id="security-footer-aup">Acceptable Use</Link>
            <Link to="/security" id="security-footer-security">Security</Link>
            <Link to="/refund" id="security-footer-refund">Refund Policy</Link>
            <Link to="/about" id="security-footer-about">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
