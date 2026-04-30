import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Privacy() {
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
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Last updated: April 15, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>1. Introduction</h2>
            <p>
              VelisMail ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our email services.
            </p>
            <p>
              Our service is built on a Zero-Knowledge architecture, meaning we are engineered to know as little about you as technically possible while still providing a premium email experience.
            </p>
          </section>

          <section>
            <h2>2. Information We Collect</h2>
            <h3>2.1 Information You Provide</h3>
            <ul>
              <li><strong>Account Information:</strong> Email address and display name during registration.</li>
              <li><strong>Payment Information:</strong> Billing details for paid plans, processed by our PCI-compliant payment partner.</li>
              <li><strong>Custom Domain Data:</strong> Domain names and DNS records for custom email domain setup.</li>
            </ul>

            <h3>2.2 Information We Do NOT Collect</h3>
            <ul>
              <li><strong>Email Contents:</strong> All emails are end-to-end encrypted. We cannot read your messages.</li>
              <li><strong>Passwords:</strong> We use passwordless authentication (passkeys). No passwords are ever stored.</li>
              <li><strong>Encryption Keys:</strong> Your private keys are generated and stored exclusively on your device.</li>
            </ul>

            <h3>2.3 Automatically Collected Information</h3>
            <ul>
              <li>IP address (anonymized after 24 hours)</li>
              <li>Browser type and version</li>
              <li>Device type and operating system</li>
              <li>Access timestamps</li>
            </ul>
          </section>

          <section>
            <h2>3. How We Use Your Information</h2>
            <p>We use the limited information we collect to:</p>
            <ul>
              <li>Provide and maintain our email service</li>
              <li>Process your transactions and manage your account</li>
              <li>Send service-related communications</li>
              <li>Detect and prevent fraud or abuse</li>
              <li>Comply with legal obligations</li>
              <li>Improve our services through anonymized analytics</li>
            </ul>
          </section>

          <section>
            <h2>4. Data Encryption & Security</h2>
            <p>
              All data in transit is protected by TLS 1.3. All stored emails are encrypted using AES-256 with keys derived from your personal encryption key using HKDF. We employ a Zero-Knowledge Proof system for authentication, ensuring your credentials are never transmitted in plaintext.
            </p>
            <p>
              Our infrastructure is hosted on SOC 2 Type II certified data centers with 24/7 monitoring, automated threat detection, and regular penetration testing.
            </p>
          </section>

          <section>
            <h2>5. Data Sharing</h2>
            <p>We do not sell, trade, or rent your personal information. We may share data only in these circumstances:</p>
            <ul>
              <li><strong>Service Providers:</strong> Trusted third parties who assist in operating our service (e.g., payment processing), bound by strict data protection agreements.</li>
              <li><strong>Legal Requirements:</strong> When required by law, court order, or governmental authority. Due to our encryption, we can only provide metadata, not email contents.</li>
              <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or asset sale, with advance notice to users.</li>
            </ul>
          </section>

          <section>
            <h2>6. Your Rights</h2>
            <p>You have the right to:</p>
            <ul>
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and all associated data</li>
              <li>Export your data in standard formats</li>
              <li>Withdraw consent for optional data processing</li>
              <li>Lodge a complaint with a data protection authority</li>
            </ul>
          </section>

          <section>
            <h2>7. Data Retention</h2>
            <p>
              We retain your account data for as long as your account is active. Upon account deletion, all personal data is permanently erased within 30 days. Encrypted email data is purged immediately upon deletion request as we do not maintain backup copies of encrypted content.
            </p>
          </section>

          <section>
            <h2>8. Cookies</h2>
            <p>
              We use only essential cookies required for authentication and session management. We do not use tracking cookies, advertising cookies, or any third-party analytics cookies.
            </p>
          </section>

          <section>
            <h2>9. Children's Privacy</h2>
            <p>
              VelisMail is not intended for users under 16 years of age. We do not knowingly collect information from children under 16.
            </p>
          </section>

          <section>
            <h2>10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any material changes via email or through an in-app notification at least 30 days before the changes take effect.
            </p>
          </section>

          <section>
            <h2>11. Contact Us</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at:
            </p>
            <ul>
              <li>Email: <a href="mailto:privacy@velismail.online">privacy@velismail.online</a></li>
              <li>Address: VelisMail Privacy Team, Bengaluru, India</li>
            </ul>
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
