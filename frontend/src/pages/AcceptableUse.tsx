import { Link } from 'react-router-dom';

export default function AcceptableUse() {
  return (
    <div style={{ padding: '80px 20px', maxWidth: '900px', margin: '0 auto', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
      <nav style={{ marginBottom: '40px' }}>
        <Link to="/" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>&larr; Back to Home</Link>
      </nav>
      
      <h1 style={{ color: 'var(--text-primary)', marginBottom: '20px', fontSize: '3rem', letterSpacing: '-0.03em' }}>Acceptable Use Policy (AUP)</h1>
      <p style={{ marginBottom: '40px', fontSize: '1.1rem' }}>
        <strong>Effective Date:</strong> January 1, 2026<br/>
        VelisMail provides secure email hosting for legitimate business use. To protect the domain reputation of our network, strict adherence to this AUP is required.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>1. Zero Tolerance for Spam</h2>
      <p style={{ marginBottom: '20px' }}>
        VelisMail strictly prohibits the sending of unsolicited commercial email (spam). You must have explicit, provable consent from recipients before adding them to any mailing list. Use of our SMTP relays for mass marketing or cold-emailing campaigns is forbidden and will result in automated IP blacklisting and account termination.
      </p>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>2. Prohibited Content and Activities</h2>
      <ul style={{ paddingLeft: '20px', marginBottom: '30px' }}>
        <li><strong>Phishing & Spoofing:</strong> Attempting to impersonate other organizations or deceive users to steal credentials.</li>
        <li><strong>Malware Distribution:</strong> Sending emails containing viruses, trojans, ransomware, or malicious links.</li>
        <li><strong>Illegal Operations:</strong> Using the platform to facilitate human trafficking, illegal drug sales, or child exploitation.</li>
      </ul>

      <h2 style={{ color: 'var(--text-primary)', marginTop: '40px', marginBottom: '16px', fontSize: '1.8rem' }}>3. Enforcement and Reporting</h2>
      <p style={{ marginBottom: '20px' }}>
        We employ advanced, automated threat intelligence to monitor metadata (without reading encrypted contents) to detect abuse. We actively collaborate with organizations like Spamhaus to enforce domain integrity. If you receive abusive emails originating from a VelisMail hosted domain, please forward the full email headers to our abuse team.
      </p>

      <div style={{ marginTop: '60px', paddingTop: '30px', borderTop: '1px solid var(--border-primary)', textAlign: 'center' }}>
        <p>Report abuse to <a href="mailto:abuse@velismail.online" style={{ color: 'var(--primary)' }}>abuse@velismail.online</a></p>
      </div>
    </div>
  );
}
