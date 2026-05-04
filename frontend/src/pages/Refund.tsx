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
          <p className="legal-updated">Effective Date: January 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              We stand by our enterprise email infrastructure. If VelisMail doesn't meet your business needs, we make refunds simple and transparent.
            </p>
          </section>

          <section>
            <h2>1. The 30-Day Enterprise Guarantee</h2>
            <p>
              All new Business and Enterprise subscriptions are covered by our 30-day money-back guarantee. If you are unsatisfied with our zero-trust email hosting, latency, or integration tools, you may request a full refund within the first 30 days of your initial purchase. No questions asked.
            </p>
          </section>

          <section>
            <h2>2. Subscription Cancellations</h2>
            <p>
              You can cancel your subscription at any time from your Business Dashboard billing panel. Cancellations will take effect at the end of your current billing cycle. You will retain full access to your secure inbox until the cycle concludes. We do not provide prorated refunds for mid-cycle cancellations on annual plans after the initial 30 days.
            </p>
          </section>

          <section>
            <h2>3. How to Request a Refund</h2>
            <p>
              To initiate a refund, please contact our billing department from your registered admin email address. Refunds are processed back to the original payment method via Stripe and typically take 5-10 business days to appear on your statement.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>Need to talk about billing? Contact <a href="mailto:billing@velismail.online">billing@velismail.online</a></p>
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
