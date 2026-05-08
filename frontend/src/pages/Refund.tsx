import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Refund() {
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
          <h1>Refund Policy</h1>
          <p className="legal-updated">Effective Date: January 1, 2026 · Last Updated: May 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              We stand by our enterprise email infrastructure. If VelisMail does not meet your business needs, we make refunds simple, transparent, and fair. This policy applies to all paid subscription plans purchased through our platform.
            </p>
          </section>

          <section>
            <h2>1. The 30-Day Money-Back Guarantee</h2>
            <p>
              All new Starter, Business, and Enterprise subscriptions are covered by our <strong>30-day money-back guarantee</strong>. If you are unsatisfied with our platform for any reason, you may request a full refund within the first 30 calendar days of your initial purchase. No questions asked.
            </p>
            <p>
              <strong>Eligibility:</strong> This guarantee applies only to the first subscription purchased by a workspace. Plan upgrades, downgrades, or renewals after the initial 30-day period are not eligible for this guarantee.
            </p>
            <p>
              <strong>Free Tier:</strong> The Free tier is provided at no cost. Therefore, no refunds are applicable or possible for Free tier workspaces.
            </p>
          </section>

          <section>
            <h2>2. Subscription Cancellations</h2>
            <p>
              You can cancel your subscription at any time from your Business Dashboard → Billing & Premium panel. Key points about cancellation:
            </p>
            <ul>
              <li>Cancellations take effect at the end of your current billing cycle.</li>
              <li>You will retain full access to all premium features until the cycle concludes.</li>
              <li>After the cycle ends, your workspace will automatically downgrade to the Free tier with its associated limits.</li>
              <li>Your data will not be deleted upon downgrade. However, if usage exceeds Free tier limits, you will need to reduce usage or re-subscribe.</li>
            </ul>
          </section>

          <section>
            <h2>3. Prorated Refunds</h2>
            <p>
              <strong>Monthly Plans:</strong> We do not provide prorated refunds for mid-cycle cancellations on monthly plans. Your subscription remains active until the end of the billing period.
            </p>
            <p>
              <strong>Annual Plans:</strong> If you cancel an annual plan after the initial 30-day guarantee period but before 6 months of usage, you may be eligible for a partial prorated refund. The refund amount is calculated as follows: (unused months × monthly equivalent rate) minus a 15% early termination fee. Contact support for annual plan prorations.
            </p>
            <p>
              <strong>Annual Plans (After 6 Months):</strong> No refunds are available for annual plan cancellations made after 6 months of service.
            </p>
          </section>

          <section>
            <h2>4. Non-Refundable Items</h2>
            <p>The following are expressly non-refundable:</p>
            <ul>
              <li>Add-on services or custom integrations already delivered.</li>
              <li>Accounts terminated due to violation of our Terms of Service or Acceptable Use Policy.</li>
              <li>Subscriptions where a chargeback or payment dispute has been filed with the payment provider.</li>
              <li>Any fees incurred from third-party services (e.g., email API providers, database hosting) connected via BYOI.</li>
            </ul>
          </section>

          <section>
            <h2>5. How to Request a Refund</h2>
            <p>
              To initiate a refund within the eligible window:
            </p>
            <ol>
              <li>Send an email to <a href="mailto:support@velismail.online">support@velismail.online</a> from your registered workspace admin email address.</li>
              <li>Include your workspace name, registered email, and the reason for your refund request.</li>
              <li>Our team will acknowledge your request within 2 business days.</li>
              <li>Approved refunds are processed back to the original payment method (via Razorpay) and typically take 5–10 business days to appear on your statement.</li>
            </ol>
          </section>

          <section>
            <h2>6. Disputes and Chargebacks</h2>
            <p>
              We encourage you to contact us directly before initiating a chargeback with your bank or payment provider. Chargebacks incur processing fees and may result in immediate suspension of your workspace. We are committed to resolving all billing disputes amicably and promptly.
            </p>
          </section>

          <section>
            <h2>7. Changes to This Policy</h2>
            <p>
              We reserve the right to modify this Refund Policy at any time. Changes will be effective immediately upon posting to this page. Your continued use of VelisMail after any changes constitutes acceptance of the updated policy. We will notify active subscribers of material changes via email.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>
              Need help with billing or refunds? Contact us at <a href="mailto:support@velismail.online">support@velismail.online</a>
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
