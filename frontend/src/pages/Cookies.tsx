import { Link } from 'react-router-dom';

export default function Cookies() {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '900px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Home</Link>
      </nav>
      
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px', fontSize: '3rem', letterSpacing: '-0.03em' }}>Cookie Policy</h1>
      <p style={{ marginBottom: '40px', fontSize: '1.1rem' }}>
        <strong>Effective Date:</strong> January 1, 2026<br/>
        VelisMail's enterprise email platform operates on a strict privacy-first methodology. This policy explains our minimalist approach to cookies.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>1. Essential Session Cookies Only</h2>
      <p style={{ marginBottom: '20px' }}>
        Unlike consumer email platforms, VelisMail <strong>does not use third-party tracking cookies, advertising pixels, or analytics trackers</strong> on our webmail interface or business dashboard. We strictly use essential first-party cookies necessary for maintaining your secure Zero-Trust authentication session.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>2. Types of Cookies We Use</h2>
      <ul style={{ paddingLeft: '20px', marginBottom: '30px' }}>
        <li><strong>Authentication Tokens (JWT):</strong> Secure, HttpOnly cookies used to cryptographically verify your identity while navigating the dashboard.</li>
        <li><strong>Security and Anti-CSRF:</strong> Tokens used exclusively to prevent Cross-Site Request Forgery attacks against your account.</li>
        <li><strong>Local Storage (Cache):</strong> We use browser localStorage to temporarily cache encrypted ciphertext locally for offline reading and faster rendering. This is wiped upon logout.</li>
      </ul>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>3. Managing Cookies</h2>
      <p style={{ marginBottom: '20px' }}>
        You can configure your browser to block all cookies. However, because our cookies are strictly tied to cryptographic session management, disabling them will prevent you from logging into the VelisMail Business Dashboard.
      </p>

      <div style={{ marginTop: '60px', paddingTop: '30px', borderTop: '1px solid var(--border-primary)', textAlign: 'center' }}>
        <p>If you have concerns about our cookie usage, contact <a href="mailto:privacy@velismail.online" style={{ color: 'var(--primary)' }}>privacy@velismail.online</a></p>
      </div>
    </div>
  );
}
