import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SEO from '../components/SEO';
import './Legal.css';

export default function Terms() {
  return (
    <div className="legal-page">
      <SEO title="Terms of Service" description="VelisMail Terms of Service states our system SLA policies, per-plan usage limits, Bring Your Own Infrastructure (BYOI) guidelines, and standard SLA commitments." />
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo" id="terms-nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" className="legal-nav-logo" id="terms-nav-logo-img" />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm" id="terms-nav-back"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      <div className="container legal-content animate-slide-up">
        <div className="legal-header">
          <span className="section-tag" id="terms-header-tag">LEGAL</span>
          <h1>Terms of Service</h1>
          <p className="legal-updated">Effective Date: January 1, 2026 · Last Updated: May 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              By accessing or using VelisMail's Enterprise Email Hosting platform and Zero Trust architecture, you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you must not use VelisMail. These Terms constitute a legally binding agreement between you ("User," "you") and VelisMail ("we," "us," "our").
            </p>
          </section>

          <section>
            <h2>1. Provision of Service</h2>
            <p>
              VelisMail provides a secure, end-to-end encrypted email hosting infrastructure designed for business and enterprise use. We guarantee 99.99% uptime for Enterprise tier subscribers, 99.9% for Business tier, and 99.5% for Starter tier, subject to our Service Level Agreement (SLA). The service includes custom domain management, automated DNS validation (SPF, DKIM, DMARC), team management, audit logging, mail queue management, template management, and zero-knowledge inbox storage.
            </p>
            <p>
              The Free tier is offered on a best-effort basis and does not carry an uptime guarantee.
            </p>
          </section>

          <section>
            <h2>2. Account Registration and Eligibility</h2>
            <p>
              To use VelisMail, you must create an account and provide accurate, current, and complete registration information. You represent and warrant that:
            </p>
            <ul>
              <li>You are at least 18 years of age or the age of legal majority in your jurisdiction.</li>
              <li>You have the legal authority to bind the organization on whose behalf you are creating the workspace.</li>
              <li>All information you provide during registration is truthful and accurate.</li>
              <li>You will keep your account information up to date at all times.</li>
            </ul>
          </section>

          <section>
            <h2>3. User Responsibilities</h2>
            <p>
              You are strictly responsible for maintaining the security of your cryptographic keys and passwords. Because VelisMail operates on a zero-knowledge framework, <strong>we cannot recover your data if you lose your authentication credentials</strong>. We do not have backdoor access to reset encryption keys.
            </p>
            <p>You are also responsible for:</p>
            <ul>
              <li>All activities that occur under your account or workspace.</li>
              <li>Ensuring that all team members added to your workspace comply with these Terms.</li>
              <li>Maintaining the security and confidentiality of your BYOI infrastructure credentials.</li>
              <li>Compliance with all applicable local, state, national, and international laws and regulations.</li>
              <li>Promptly notifying us of any unauthorized access to or use of your account.</li>
            </ul>
          </section>

          <section>
            <h2>4. Acceptable Use and Restrictions</h2>
            <p>
              VelisMail is built for secure corporate communication, not for mass marketing or malicious activities. Users are expressly prohibited from using our infrastructure for:
            </p>
            <ul>
              <li>Sending unsolicited bulk email (spam) or commercial messages without recipient consent.</li>
              <li>Distributing malware, ransomware, viruses, or conducting phishing campaigns.</li>
              <li>Hosting, transmitting, or distributing illegal content or conducting illegal business operations.</li>
              <li>Impersonating any person or entity, or falsely representing your affiliation with any person or entity.</li>
              <li>Interfering with, disrupting, or attempting to gain unauthorized access to our infrastructure.</li>
              <li>Harvesting or collecting email addresses or other personal information of third parties.</li>
              <li>Using the service to violate the intellectual property rights of others.</li>
            </ul>
            <p>Violation of these terms will result in immediate account termination without refund, and potential reporting to relevant authorities.</p>
          </section>

          <section>
            <h2>5. Billing, Subscriptions, and Infrastructure</h2>
            <p>
              VelisMail operates on a per-workspace subscription model with four tiers: Free, Starter (₹299/mo), Business (₹999/mo), and Enterprise (₹2,499/mo). Prices are listed in Indian Rupees (INR) and are subject to applicable taxes (e.g., 18% GST).
            </p>
            <p>
              <strong>Bring Your Own Infrastructure (BYOI):</strong> You connect your own PostgreSQL database and Email API (e.g., SendGrid, Postmark, Resend). Your VelisMail subscription tier establishes maximum thresholds for monthly email volume, daily sending limits (Free plan only), and storage capacity. Purchasing a VelisMail premium plan does not upgrade your external provider limits — you must ensure your third-party providers can handle your volume independently.
            </p>
            <p>
              <strong>Plan Limits:</strong> Each plan enforces specific limits on email sending volume, storage, team members, custom domains, mail templates, and audit log retention. These limits are enforced server-side. Exceeding your plan limits may result in temporary restrictions until the next billing cycle or until you upgrade your plan.
            </p>
            <p>
              <strong>Self-Service Upgrades:</strong> Premium subscriptions must be purchased directly by users via the Business Dashboard Billing & Premium panel using Razorpay.
            </p>
            <p>
              <strong>Auto-Renewal & Cancellation:</strong> Subscriptions are billed automatically on a monthly or annual basis. You may cancel your subscription at any time via your Business Dashboard. Cancellations take effect at the end of the current billing cycle. Failure to pay may result in restricted access to your workspace.
            </p>
          </section>

          <section>
            <h2>6. Intellectual Property</h2>
            <p>
              All content, features, and functionality of the VelisMail platform — including but not limited to the user interface, design, text, graphics, logos, icons, and software — are the exclusive property of VelisMail and are protected by international copyright, trademark, patent, trade secret, and other intellectual property laws.
            </p>
            <p>
              You retain full ownership of all content you create, send, receive, and store through VelisMail. We claim no intellectual property rights over your data.
            </p>
          </section>

          <section>
            <h2>7. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, VelisMail and its affiliates, officers, employees, agents, and licensors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenue, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from:
            </p>
            <ul>
              <li>Your use of or inability to use the service.</li>
              <li>Any unauthorized access to or use of our servers and any personal information stored therein.</li>
              <li>Any interruption or cessation of transmission to or from the service.</li>
              <li>Any bugs, viruses, or similar harmful code that may be transmitted through the service by any third party.</li>
              <li>Any errors or omissions in any content.</li>
            </ul>
            <p>
              Our total aggregate liability for all claims arising out of or relating to these Terms or the service shall not exceed the amount you paid to VelisMail during the twelve (12) months preceding the claim.
            </p>
          </section>

          <section>
            <h2>8. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless VelisMail and its affiliates, officers, directors, employees, and agents from and against any and all claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or in connection with your use of the service, your violation of these Terms, or your violation of any rights of another.
            </p>
          </section>

          <section>
            <h2>9. Service Modifications</h2>
            <p>
              We reserve the right to modify, suspend, or discontinue any aspect of VelisMail at any time, with or without notice. We will make reasonable efforts to notify you of material changes that may affect your use of the service. We shall not be liable to you or any third party for any modification, suspension, or discontinuance of the service.
            </p>
          </section>

          <section>
            <h2>10. Governing Law and Dispute Resolution</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law provisions. Any disputes arising from these Terms or your use of VelisMail shall be subject to the exclusive jurisdiction of the courts located in Kolkata, West Bengal, India.
            </p>
            <p>
              Before initiating any formal legal proceedings, you agree to first attempt to resolve the dispute informally by contacting us at <a href="mailto:support@velismail.online">support@velismail.online</a>. We will attempt to resolve the dispute within 30 days.
            </p>
          </section>

          <section>
            <h2>11. Severability</h2>
            <p>
              If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary so that these Terms shall otherwise remain in full force and effect and enforceable.
            </p>
          </section>

          <section>
            <h2>12. Changes to These Terms</h2>
            <p>
              We reserve the right to update these Terms at any time. Material changes will be communicated to you via email to your registered workspace administrator address at least 30 days before taking effect. Your continued use of VelisMail after the effective date of any changes constitutes your acceptance of the new Terms.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>Legal inquiries? Contact us at <a href="mailto:support@velismail.online">support@velismail.online</a></p>
          </section>
        </div>
      </div>

      <footer className="legal-footer">
        <div className="container legal-footer-inner">
          <span>© 2026 VelisMail. All rights reserved.</span>
          <div className="legal-footer-links">
            <Link to="/privacy" id="terms-footer-privacy">Privacy Policy</Link>
            <Link to="/terms" id="terms-footer-terms">Terms of Service</Link>
            <Link to="/cookies" id="terms-footer-cookies">Cookie Policy</Link>
            <Link to="/aup" id="terms-footer-aup">Acceptable Use</Link>
            <Link to="/security" id="terms-footer-security">Security</Link>
            <Link to="/refund" id="terms-footer-refund">Refund Policy</Link>
            <Link to="/about" id="terms-footer-about">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
