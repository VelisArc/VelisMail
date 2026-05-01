import { Link } from 'react-router-dom';

export default function Policy({ title }: { title: string }) {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '800px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Home</Link>
      </nav>
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px' }}>{title}</h1>
      <p style={{ marginBottom: '20px' }}>
        Effective Date: January 1, 2026. This is a generic policy page for VelisMail Enterprise.
      </p>
      <h2 style={{ color: 'var(--text-primary)', marginTop: '30px', marginBottom: '10px' }}>1. Introduction</h2>
      <p style={{ marginBottom: '20px' }}>
        VelisMail provides end-to-end encrypted email hosting. Our policies are designed to ensure absolute data sovereignty, privacy, and system integrity. By using our platform, you agree to these terms.
      </p>
      <h2 style={{ color: 'var(--text-primary)', marginTop: '30px', marginBottom: '10px' }}>2. Data Collection and Usage</h2>
      <p style={{ marginBottom: '20px' }}>
        We operate on a zero-knowledge architecture. We do not read, scan, or analyze your emails for advertising. We only store the encrypted ciphertext and routing metadata necessary for delivery.
      </p>
      <h2 style={{ color: 'var(--text-primary)', marginTop: '30px', marginBottom: '10px' }}>3. Contact</h2>
      <p>
        If you have questions about this {title.toLowerCase()}, please contact our compliance team at privacy@velismail.online.
      </p>
    </div>
  );
}
