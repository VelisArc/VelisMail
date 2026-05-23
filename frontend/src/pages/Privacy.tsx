import { Link } from 'react-router-dom';
import { Shield, Database, ArrowLeft, Lock, Eye } from 'lucide-react';
import './Legal.css';

export default function Privacy() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" className="legal-nav-logo" />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      <div className="container legal-content animate-slide-up">
        <div className="legal-header">
          <span className="section-tag">LEGAL</span>
          <h1>Privacy Policy</h1>
          <p className="legal-updated">Effective Date: January 1, 2026 · Last Updated: May 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              At VelisMail, we believe privacy is a fundamental human right. This Privacy Policy details how our Zero-Knowledge Enterprise Email Hosting platform collects, uses, protects, and shares your information. By using VelisMail, you agree to the practices described in this policy.
            </p>

            <div className="privacy-cards">
              <div className="glass-card privacy-card">
                <Shield size={22} color="var(--primary)" />
                <h3>Zero-Knowledge Architecture</h3>
                <p>We physically cannot read your emails. Your data is encrypted before it reaches our servers.</p>
              </div>
              <div className="glass-card privacy-card">
                <Database size={22} color="var(--primary)" />
                <h3>Data Sovereignty</h3>
                <p>Your data is isolated in secure, compliant vaults. We never sell, share, or analyze your communications.</p>
              </div>
              <div className="glass-card privacy-card">
                <Lock size={22} color="var(--primary)" />
                <h3>No Advertising</h3>
                <p>We do not serve ads, track browsing, or build advertising profiles from your data. Ever.</p>
              </div>
              <div className="glass-card privacy-card">
                <Eye size={22} color="var(--primary)" />
                <h3>Full Transparency</h3>
                <p>We publish exactly what we collect and why. No hidden data pipelines or third-party analytics.</p>
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
              <li>Your encryption keys.</li>
              <li>Your browsing history across the web.</li>
              <li>Advertising IDs or tracking pixels.</li>
              <li>Social media profiles or contact lists from external services.</li>
              <li>Location data, device identifiers, or biometric information.</li>
            </ul>
          </section>

          <section>
            <h2>2. Information We Must Collect</h2>
            <p>
              To operate a reliable enterprise email routing network, we must process certain metadata:
            </p>
            <ul>
              <li><strong>Account Data:</strong> Email addresses and domain names used to provision your workspace.</li>
              <li><strong>Team Access Data:</strong> Invite email addresses, role assignments, token expiry timestamps, and OTP verification state required to enforce delegated access.</li>
              <li><strong>Payment Data:</strong> Processed entirely by our secure payment partner (Razorpay). We do not store your credit card, UPI, or banking information on our servers. We only retain transaction IDs and plan tier information.</li>
              <li><strong>Routing Metadata:</strong> Sender, recipient, and timestamps necessary for the SMTP/IMAP protocols to deliver messages.</li>
              <li><strong>Audit Logs:</strong> Workspace activity logs (login events, configuration changes, permission modifications) retained according to your plan tier for security and compliance purposes.</li>
              <li><strong>Infrastructure Connection Data:</strong> Database connection strings and API keys you provide via BYOI, stored in encrypted format and used solely to route your email operations.</li>
            </ul>
          </section>

          <section>
            <h2>3. How We Use Your Information</h2>
            <p>Information collected is used exclusively for:</p>
            <ul>
              <li>Provisioning, maintaining, and securing your workspace.</li>
              <li>Processing subscription payments and managing billing cycles.</li>
              <li>Enforcing plan-based usage limits (email volume, storage, team size).</li>
              <li>Generating workspace audit logs for administrator review.</li>
              <li>Sending essential service communications (security alerts, billing confirmations, policy updates).</li>
              <li>Investigating and preventing abuse, fraud, or violations of our Terms of Service.</li>
            </ul>
            <p>We do <strong>not</strong> use your data for marketing, profiling, or any purpose unrelated to delivering the VelisMail service.</p>
          </section>

          <section>
            <h2>4. Data Retention</h2>
            <p>
              <strong>Active Accounts:</strong> Your workspace data is retained for as long as your account is active and in good standing.
            </p>
            <p>
              <strong>Cancelled or Deactivated Accounts:</strong> Workspace configuration, metadata, and recovery records are retained in a recoverable state unless an authorized data-erasure request is completed through support and any legal retention obligations have expired.
            </p>
            <p>
              <strong>Audit Logs:</strong> Retained according to your plan tier (Free: 7 days, Starter: 30 days, Business: 90 days, Enterprise: 1 year). Logs are automatically purged after the retention window.
            </p>
          </section>

          <section>
            <h2>5. Third-Party Services</h2>
            <p>We integrate with the following third-party services, each bound by their own privacy policies:</p>
            <ul>
              <li><strong>Razorpay:</strong> Payment processing for subscription management.</li>
              <li><strong>Cloudflare:</strong> DNS resolution, DDoS protection, and CDN services.</li>
              <li><strong>Your BYOI Providers:</strong> The PostgreSQL database and Email API providers you connect are entirely under your control and subject to your own agreements with those providers.</li>
            </ul>
            <p>We do not share any of your data with advertisers, data brokers, or analytics companies.</p>
          </section>

          <section>
            <h2>6. Compliance and Law Enforcement</h2>
            <p>
              VelisMail complies with lawful requests from authorized government agencies. However, because we utilize <strong>End-to-End Encryption (E2EE)</strong>, we cannot hand over plaintext message contents to any third party, including governments, because we do not possess the decryption keys. All we can provide is encrypted ciphertext and routing metadata.
            </p>
            <p>
              We will notify affected users of any data requests unless prohibited by law from doing so. We publish an annual transparency report detailing the number and nature of government requests received.
            </p>
          </section>

          <section>
            <h2>7. International Data Transfers</h2>
            <p>
              VelisMail infrastructure is distributed across multiple regions. If your data is transferred across borders, we ensure it is protected by appropriate safeguards including encryption in transit (TLS 1.3) and at rest (AES-256). All transfers comply with applicable data protection laws, including GDPR Standard Contractual Clauses where applicable.
            </p>
          </section>

          <section>
            <h2>8. Your Rights</h2>
            <p>
              We extend the protections of the <strong>General Data Protection Regulation (GDPR)</strong>, the <strong>California Consumer Privacy Act (CCPA)</strong>, and India's <strong>Digital Personal Data Protection Act (DPDPA)</strong> to all our users globally. You have the right to:
            </p>
            <ul>
              <li><strong>Access:</strong> Request a complete export of your workspace data.</li>
              <li><strong>Rectification:</strong> Correct any inaccurate personal information.</li>
              <li><strong>Erasure Review:</strong> Request deletion through a support-reviewed process that verifies ownership, protects against accidental loss, and honors legal retention requirements.</li>
              <li><strong>Portability:</strong> Receive your data in a standard, machine-readable format.</li>
              <li><strong>Objection:</strong> Object to any processing of your data that you believe is unlawful.</li>
              <li><strong>Restriction:</strong> Request that we limit the processing of your data in certain circumstances.</li>
            </ul>
            <p>To exercise any of these rights, contact us at <a href="mailto:support@velismail.online">support@velismail.online</a>.</p>
          </section>

          <section>
            <h2>9. Children's Privacy</h2>
            <p>
              VelisMail is designed for business use and is not intended for individuals under the age of 18. We do not knowingly collect personal information from children. If we discover that a child under 18 has provided us with personal information, we will promptly delete it.
            </p>
          </section>

          <section>
            <h2>10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time to reflect changes in our practices, technology, or legal requirements. We will notify you of any material changes by posting the updated policy on this page and, for significant changes, by sending an email to your registered workspace administrator email. Your continued use of VelisMail after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <p className="privacy-footer-text">Questions about our privacy practices? Contact us at <a href="mailto:support@velismail.online">support@velismail.online</a></p>
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
