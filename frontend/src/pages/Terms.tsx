import { Link } from 'react-router-dom';

export default function Terms() {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '800px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Home</Link>
      </nav>
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px' }}>Terms of Service</h1>
      <p style={{ marginBottom: '20px' }}>Effective Date: January 1, 2026. By using VelisMail, you agree to these terms...</p>
    </div>
  );
}
