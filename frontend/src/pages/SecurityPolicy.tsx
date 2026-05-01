import { Link } from 'react-router-dom';

export default function SecurityPolicy() {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '900px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Home</Link>
      </nav>
      
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px', fontSize: '3rem', letterSpacing: '-0.03em' }}>Enterprise Security Policy</h1>
      <p style={{ marginBottom: '40px', fontSize: '1.1rem' }}>
        <strong>Effective Date:</strong> January 1, 2026<br/>
        Security is not a feature at VelisMail; it is the foundation of our entire infrastructure. This document outlines our cryptographic implementations and operational security measures.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>1. Cryptographic Standards</h2>
      <p style={{ marginBottom: '20px' }}>
        All data at rest is encrypted using <strong>AES-256-GCM</strong>. All data in transit is secured via strict TLS 1.3. Your emails are encrypted client-side using a public/private keypair mechanism (RSA-4096 / ECC) before leaving your browser. The private key never leaves your device unencrypted.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>2. Zero-Knowledge Authentication</h2>
      <p style={{ marginBottom: '20px' }}>
        We utilize Zero-Knowledge Proofs (ZKP) to authenticate your credentials. Passwords are never sent to our servers. Instead, your client generates a cryptographic proof of your password, which our Rust-backend verifies without ever learning the actual string. This makes server-side credential stuffing impossible.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>3. Infrastructure and Rust Backend</h2>
      <p style={{ marginBottom: '20px' }}>
        The VelisMail backend is written entirely in Rust. This eliminates entire classes of memory safety vulnerabilities (like buffer overflows) that commonly plague legacy email systems written in C/C++. Our infrastructure is hosted across distributed, ISO 27001-certified data centers ensuring geographic redundancy and DDoS protection.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>4. Bug Bounty and Vulnerability Disclosure</h2>
      <p style={{ marginBottom: '20px' }}>
        We operate an open vulnerability disclosure program. Security researchers who identify flaws in our cryptographic implementation, authentication flows, or Rust backend are encouraged to report them to our security team.
      </p>

      <div style={{ marginTop: '60px', paddingTop: '30px', borderTop: '1px solid var(--border-primary)', textAlign: 'center' }}>
        <p>Report vulnerabilities to <a href="mailto:security@velismail.online" style={{ color: 'var(--primary)' }}>security@velismail.online</a></p>
      </div>
    </div>
  );
}
