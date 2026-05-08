import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Terms() {
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
          <h1>Terms of Service</h1>
          <p className="legal-updated">Effective Date: January 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              By accessing VelisMail's Enterprise Email Hosting and Zero Trust architecture, you agree to these Terms of Service.
            </p>
          </section>

          <section>
            <h2>1. Provision of Service</h2>
            <p>
              VelisMail provides a secure, end-to-end encrypted email hosting infrastructure designed for business and enterprise use. We guarantee 99.99% uptime for premium tiers, subject to our Service Level Agreement (SLA). The service includes custom domain management, automated DNS validation (SPF, DKIM, DMARC), and zero-knowledge inbox storage.
            </p>
          </section>

          <section>
            <h2>2. User Responsibilities</h2>
            <p>
              You are strictly responsible for maintaining the security of your cryptographic keys, passwords, and passkeys. Because VelisMail operates on a zero-knowledge framework, <strong>we cannot recover your data if you lose your authentication credentials</strong>. We do not have backdoor access to reset encryption keys.
            </p>
          </section>

          <section>
            <h2>3. Acceptable Use and Restrictions</h2>
            <p>
              VelisMail is built for secure corporate communication, not for mass marketing or malicious activities. Users are expressly prohibited from using our SMTP/IMAP infrastructure for:
            </p>
            <ul>
              <li>Sending unsolicited bulk email (spam).</li>
              <li>Distributing malware, ransomware, or conducting phishing campaigns.</li>
              <li>Hosting illegal content or conducting illegal business operations.</li>
            </ul>
            <p>Violation of these terms will result in immediate account termination without refund, and potential reporting to relevant authorities.</p>
          </section>

          <section>
            <h2>4. Billing, Subscriptions, and Infrastructure</h2>
            <p>
              VelisMail operates on a per-workspace subscription model with four tiers: Free, Starter, Business, and Enterprise. Prices are listed in Indian Rupees (INR) and are subject to applicable taxes (e.g., 18% GST). 
            </p>
            <p>
              <strong>Bring Your Own Infrastructure (BYOI):</strong> While you connect your own PostgreSQL database and Email API (e.g., SendGrid, Resend), your VelisMail subscription tier establishes maximum thresholds for monthly email volume and storage capacity.
            </p>
            <p>
              <strong>Plan Limits:</strong> Purchasing a premium VelisMail plan increases your permitted email sending capacity, storage limits, and unlocks advanced software capabilities (e.g., number of team members, domains, audit logs). 
            </p>
            <p>
              <strong>Self-Service Upgrades:</strong> Premium subscriptions must be purchased directly by users via the Business Dashboard. We do not support manual invoicing or admin provisioning except for custom Enterprise agreements.
            </p>
            <p>
              <strong>Auto-Renewal & Cancellation:</strong> Subscriptions are billed automatically on a monthly or annual basis. You may cancel your subscription at any time via your Business Dashboard. Cancellations take effect at the end of the current billing cycle. Failure to pay may result in restricted access to your workspace. All transactions are securely processed via our payment partners (Stripe/Razorpay).
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>Legal inquiries? Contact us at <a href="mailto:legal@velismail.online">legal@velismail.online</a></p>
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
