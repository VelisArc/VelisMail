import { Link } from 'react-router-dom';

export default function Refund() {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '900px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Home</Link>
      </nav>
      
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px', fontSize: '3rem', letterSpacing: '-0.03em' }}>Refund Policy</h1>
      <p style={{ marginBottom: '40px', fontSize: '1.1rem' }}>
        <strong>Effective Date:</strong> January 1, 2026<br/>
        We stand by our enterprise email infrastructure. If VelisMail doesn't meet your business needs, we make refunds simple and transparent.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>1. The 30-Day Enterprise Guarantee</h2>
      <p style={{ marginBottom: '20px' }}>
        All new Business and Enterprise subscriptions are covered by our 30-day money-back guarantee. If you are unsatisfied with our zero-trust email hosting, latency, or integration tools, you may request a full refund within the first 30 days of your initial purchase. No questions asked.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>2. Subscription Cancellations</h2>
      <p style={{ marginBottom: '20px' }}>
        You can cancel your subscription at any time from your Business Dashboard billing panel. Cancellations will take effect at the end of your current billing cycle. You will retain full access to your secure inbox until the cycle concludes. We do not provide prorated refunds for mid-cycle cancellations on annual plans after the initial 30 days.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>3. How to Request a Refund</h2>
      <p style={{ marginBottom: '20px' }}>
        To initiate a refund, please contact our billing department from your registered admin email address. Refunds are processed back to the original payment method via Stripe and typically take 5-10 business days to appear on your statement.
      </p>

      <div style={{ marginTop: '60px', paddingTop: '30px', borderTop: '1px solid var(--border-primary)', textAlign: 'center' }}>
        <p>Need to talk about billing? Contact <a href="mailto:billing@velismail.online" style={{ color: 'var(--primary)' }}>billing@velismail.online</a></p>
      </div>
    </div>
  );
}
