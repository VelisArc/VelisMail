import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Refund() {
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
          <h1>Refund Policy</h1>
          <p className="legal-updated">Last updated: April 18, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>1. Subscription Cancellations</h2>
            <p>
              You can cancel your VelisMail premium subscription at any time. When you cancel, your paid features will remain active until the end of your current billing cycle. After this period, your account will revert to the free tier, subject to the free tier's storage limits.
            </p>
          </section>

          <section>
            <h2>2. Refund Eligibility</h2>
            <p>
              We offer a 14-day money-back guarantee for all new premium subscriptions. If you are not satisfied with VelisMail within the first 14 days of your initial purchase, please contact our support team at <a href="mailto:support@velismail.online">support@velismail.online</a> to request a full refund.
            </p>
            <p>
              Refunds are not generally available for renewal payments. We send reminders prior to annual subscription renewals so you can manage your billing preferences.
            </p>
          </section>

          <section>
            <h2>3. Exceptions</h2>
            <p>
              Refunds will not be granted to accounts that have been suspended or terminated due to a violation of our Terms of Service or Acceptable Use Policy.
            </p>
          </section>

          <section>
            <h2>4. Processing Times</h2>
            <p>
              Approved refunds will be credited back to the original method of payment. Processing times vary depending on your payment provider but generally take 5-10 business days to reflect on your statement.
            </p>
          </section>

          <section>
            <h2>5. Contact Us</h2>
            <p>
              For any questions regarding billing or to request a refund, please contact us at: <a href="mailto:support@velismail.online">support@velismail.online</a>.
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
