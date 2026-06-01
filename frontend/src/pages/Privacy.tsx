import { Database, Eye, Lock, Shield } from 'lucide-react';
import LegalLayout from './LegalLayout';

export default function Privacy() {
  return (
    <LegalLayout
      slug="privacy"
      title="Privacy Policy"
      description="VelisMail's Privacy Policy explains our zero-knowledge architecture, data minimization, BYOI provider boundaries, retention practices, and user privacy rights."
      contactEmail="support@velismail.online"
      contactLabel="Questions about privacy practices, data rights, or account data handling can be sent to VelisMail support."
    >
      <section>
        <p>
          At VelisMail, privacy is part of the product architecture. This Privacy Policy explains how our Zero-Knowledge Enterprise Email Hosting platform collects, uses, protects, and shares information.
        </p>

        <div className="privacy-cards">
          <div className="glass-card privacy-card">
            <Shield size={22} />
            <h3>Zero-Knowledge Architecture</h3>
            <p>We cannot read plaintext email contents stored through client-side encryption.</p>
          </div>
          <div className="glass-card privacy-card">
            <Database size={22} />
            <h3>Data Sovereignty</h3>
            <p>BYOI keeps infrastructure choices under your control, including database and mail providers.</p>
          </div>
          <div className="glass-card privacy-card">
            <Lock size={22} />
            <h3>No Advertising</h3>
            <p>We do not sell inbox data or build advertising profiles from user communications.</p>
          </div>
          <div className="glass-card privacy-card">
            <Eye size={22} />
            <h3>Transparent Processing</h3>
            <p>We document what metadata is required to operate the service and why it is used.</p>
          </div>
        </div>
      </section>

      <section>
        <h2>1. Information We Do Not Collect</h2>
        <p>
          Unlike legacy email providers that mine inbox data for advertising, VelisMail is designed to know as little as possible. We do not collect:
        </p>
        <ul>
          <li>The plaintext content of encrypted emails, bodies, or attachments.</li>
          <li>Your encryption keys in plaintext.</li>
          <li>Browsing history across the web.</li>
          <li>Advertising IDs or third-party tracking pixels.</li>
          <li>Social media profiles from external services.</li>
          <li>Biometric information.</li>
        </ul>
      </section>

      <section>
        <h2>2. Information We Must Process</h2>
        <p>To operate a reliable business email platform, we process certain metadata and account records:</p>
        <ul>
          <li><strong>Account Data:</strong> Email addresses, workspace names, and domain names used to provision the service.</li>
          <li><strong>Team Access Data:</strong> Invite email addresses, roles, token expiry timestamps, and OTP state required to enforce delegated access.</li>
          <li><strong>Payment Data:</strong> Payment processing is handled by Razorpay. We do not store card, UPI, or bank credentials.</li>
          <li><strong>Routing Metadata:</strong> Sender, recipient, and timestamps necessary for SMTP, IMAP, and dashboard operations.</li>
          <li><strong>Audit Logs:</strong> Workspace activity logs retained according to plan tier for security and compliance review.</li>
          <li><strong>Infrastructure Connection Data:</strong> Database connection strings and provider API keys supplied through BYOI, stored in encrypted form where applicable.</li>
        </ul>
      </section>

      <section>
        <h2>3. How We Use Information</h2>
        <p>Information is used only to operate, secure, and support VelisMail:</p>
        <ul>
          <li>Provisioning, maintaining, and securing workspaces.</li>
          <li>Processing subscriptions and managing billing cycles.</li>
          <li>Enforcing plan-based limits for email volume, storage, teams, domains, templates, and audit logs.</li>
          <li>Generating administrator-visible audit logs.</li>
          <li>Sending essential service communications such as security alerts, billing confirmations, and policy updates.</li>
          <li>Investigating abuse, fraud, or violations of our Terms of Service.</li>
        </ul>
        <p>We do not use workspace data for advertising, profiling, or unrelated marketing.</p>
      </section>

      <section>
        <h2>4. Data Retention</h2>
        <p>
          <strong>Active Accounts:</strong> Workspace data is retained while your account is active and in good standing.
        </p>
        <p>
          <strong>Cancelled or Deactivated Accounts:</strong> Workspace configuration, metadata, and recovery records may remain recoverable unless an authorized data-erasure request is completed and legal retention obligations have expired.
        </p>
        <p>
          <strong>Audit Logs:</strong> Retention follows your plan tier: Free for 7 days, Starter for 30 days, Business for 90 days, and Enterprise for 1 year.
        </p>
      </section>

      <section>
        <h2>5. Third-Party Services</h2>
        <p>VelisMail integrates with third-party services that operate under their own agreements and privacy policies:</p>
        <ul>
          <li><strong>Razorpay:</strong> Subscription payment processing.</li>
          <li><strong>Cloudflare:</strong> DNS, CDN, and security services where enabled.</li>
          <li><strong>Your BYOI Providers:</strong> PostgreSQL databases, mail APIs, storage providers, and other infrastructure you connect.</li>
        </ul>
        <p>We do not share user data with advertisers, data brokers, or third-party behavioral advertising networks.</p>
      </section>

      <section>
        <h2>6. Compliance and Law Enforcement</h2>
        <p>
          VelisMail responds to lawful requests from authorized government agencies. Because encrypted message contents are designed to remain outside our plaintext access, we cannot provide plaintext content we do not possess.
        </p>
        <p>
          Where legally allowed, we will notify affected users of data requests. We may publish transparency information describing the number and nature of requests received.
        </p>
      </section>

      <section>
        <h2>7. International Data Transfers</h2>
        <p>
          VelisMail infrastructure and connected BYOI providers may operate across regions. Where data is transferred across borders, safeguards such as encryption in transit and at rest are used where applicable.
        </p>
      </section>

      <section>
        <h2>8. Your Rights</h2>
        <p>
          We aim to honor rights provided by privacy frameworks such as GDPR, CCPA, and India's Digital Personal Data Protection Act where applicable. You may request:
        </p>
        <ul>
          <li><strong>Access:</strong> An export or explanation of workspace data associated with your account.</li>
          <li><strong>Rectification:</strong> Correction of inaccurate personal information.</li>
          <li><strong>Erasure Review:</strong> Deletion through a support-reviewed process that verifies ownership and honors legal retention duties.</li>
          <li><strong>Portability:</strong> Data in a standard, machine-readable format where available.</li>
          <li><strong>Objection:</strong> Review of processing you believe is unlawful.</li>
          <li><strong>Restriction:</strong> Limits on processing in certain circumstances.</li>
        </ul>
        <p>To exercise rights, contact <a href="mailto:support@velismail.online">support@velismail.online</a>.</p>
      </section>

      <section>
        <h2>9. Children's Privacy</h2>
        <p>
          VelisMail is designed for business use and is not intended for individuals under 18. We do not knowingly collect personal information from children.
        </p>
      </section>

      <section>
        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy to reflect changes in practices, technology, or legal requirements. Material changes will be posted on this page and, where appropriate, emailed to the registered workspace administrator.
        </p>
      </section>
    </LegalLayout>
  );
}
