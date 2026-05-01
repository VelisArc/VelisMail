import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '900px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Home</Link>
      </nav>
      
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px', fontSize: '3rem', letterSpacing: '-0.03em' }}>Terms of Service</h1>
      <p style={{ marginBottom: '40px', fontSize: '1.1rem' }}>
        <strong>Effective Date:</strong> January 1, 2026<br/>
        By accessing VelisMail's Enterprise Email Hosting and Zero Trust architecture, you agree to these Terms of Service.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>1. Provision of Service</h2>
      <p style={{ marginBottom: '20px' }}>
        VelisMail provides a secure, end-to-end encrypted email hosting infrastructure designed for business and enterprise use. We guarantee 99.99% uptime for premium tiers, subject to our Service Level Agreement (SLA). The service includes custom domain management, automated DNS validation (SPF, DKIM, DMARC), and zero-knowledge inbox storage.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>2. User Responsibilities</h2>
      <p style={{ marginBottom: '20px' }}>
        You are strictly responsible for maintaining the security of your cryptographic keys, passwords, and passkeys. Because VelisMail operates on a zero-knowledge framework, <strong>we cannot recover your data if you lose your authentication credentials</strong>. We do not have backdoor access to reset encryption keys.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>3. Acceptable Use and Restrictions</h2>
      <p style={{ marginBottom: '20px' }}>
        VelisMail is built for secure corporate communication, not for mass marketing or malicious activities. Users are expressly prohibited from using our SMTP/IMAP infrastructure for:
      </p>
      <ul style={{ paddingLeft: '20px', marginBottom: '30px' }}>
        <li>Sending unsolicited bulk email (spam).</li>
        <li>Distributing malware, ransomware, or conducting phishing campaigns.</li>
        <li>Hosting illegal content or conducting illegal business operations.</li>
      </ul>
      <p>Violation of these terms will result in immediate account termination without refund, and potential reporting to relevant authorities.</p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>4. Billing and Subscriptions</h2>
      <p style={{ marginBottom: '20px' }}>
        Enterprise and Business plans are billed either monthly or annually. Failure to pay may result in restricted access to your organization's workspaces. All transactions are securely processed via Stripe. You can cancel your subscription at any time via the Business Dashboard.
      </p>

      <div style={{ marginTop: '60px', paddingTop: '30px', borderTop: '1px solid var(--border-primary)', textAlign: 'center' }}>
        <p>Legal inquiries? Contact us at <a href="mailto:legal@velismail.online" style={{ color: 'var(--primary)' }}>legal@velismail.online</a></p>
      </div>
    </div>
  );
}
