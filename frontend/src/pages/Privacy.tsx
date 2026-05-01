import { Link } from 'react-router-dom';
import { Shield, Database } from 'lucide-react';

export default function Privacy() {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '900px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          &larr; Back to Home
        </Link>
      </nav>
      
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px', fontSize: '3rem', letterSpacing: '-0.03em' }}>Privacy Policy</h1>
      <p style={{ marginBottom: '40px', fontSize: '1.1rem' }}>
        <strong>Effective Date:</strong> January 1, 2026<br/>
        At VelisMail, we believe privacy is a fundamental human right. This Privacy Policy details how our Zero-Knowledge Enterprise Email Hosting platform protects your data.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '40px' }}>
        <div style={{ padding: '20px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
          <Shield size={24} color="var(--primary)" style={{ marginBottom: '12px' }} />
          <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Zero-Knowledge Architecture</h3>
          <p style={{ fontSize: '0.9rem' }}>We physically cannot read your emails. Your data is encrypted on your device before it ever reaches our servers.</p>
        </div>
        <div style={{ padding: '20px', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
          <Database size={24} color="var(--primary)" style={{ marginBottom: '12px' }} />
          <h3 style={{ color: 'var(--text-primary)', marginBottom: '8px' }}>Data Sovereignty</h3>
          <p style={{ fontSize: '0.9rem' }}>Your data is isolated in secure, compliant enterprise vaults. We never sell, share, or analyze your business communications.</p>
        </div>
      </div>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>1. Information We Do Not Collect</h2>
      <p style={{ marginBottom: '20px' }}>
        Unlike legacy email providers that mine your inbox for advertising profiles, VelisMail is engineered to know as little about you as possible. We <strong>do not</strong> collect:
      </p>
      <ul style={{ paddingLeft: '20px', marginBottom: '30px' }}>
        <li>The plaintext content of your emails (subject lines, bodies, or attachments).</li>
        <li>Your encryption keys or passkeys.</li>
        <li>Your browsing history across the web.</li>
        <li>Advertising IDs or tracking pixels.</li>
      </ul>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>2. Information We Must Collect</h2>
      <p style={{ marginBottom: '20px' }}>
        To operate a reliable, sub-50ms latency enterprise email routing network, we must process certain metadata. This includes:
      </p>
      <ul style={{ paddingLeft: '20px', marginBottom: '30px' }}>
        <li><strong>Account Data:</strong> Email addresses and domain names used to provision your workspace.</li>
        <li><strong>Payment Data:</strong> Processed entirely by Stripe; we do not store your credit card information.</li>
        <li><strong>Routing Metadata:</strong> Sender, recipient, and timestamps necessary for the SMTP/IMAP protocols to deliver messages.</li>
      </ul>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>3. Compliance and Law Enforcement</h2>
      <p style={{ marginBottom: '20px' }}>
        VelisMail complies with lawful requests. However, because we utilize <strong>End-to-End Encryption (E2EE)</strong>, we cannot hand over plaintext message contents to any third party, including governments, because we do not possess the decryption keys. All we can provide is cryptographically scrambled ciphertext.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>4. Your Rights Under GDPR & CCPA</h2>
      <p style={{ marginBottom: '20px' }}>
        We extend the strict protections of the General Data Protection Regulation (GDPR) and the California Consumer Privacy Act (CCPA) to all our users globally. You have the right to request a complete export of your encrypted data, or to demand the permanent cryptographic deletion of your account at any time via your Business Dashboard.
      </p>

      <div style={{ marginTop: '60px', paddingTop: '30px', borderTop: '1px solid var(--border-primary)', textAlign: 'center' }}>
        <p>Questions about our privacy architecture? Contact our security team at <a href="mailto:privacy@velismail.online" style={{ color: 'var(--primary)' }}>privacy@velismail.online</a></p>
      </div>
    </div>
  );
}
