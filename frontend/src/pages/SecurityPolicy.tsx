import LegalLayout from './LegalLayout';

export default function SecurityPolicy() {
  return (
    <LegalLayout
      slug="security"
      title="Enterprise Security Policy"
      category="Security"
      description="VelisMail's Security Policy outlines encryption standards, secure recovery, Rust-built backend controls, RBAC, incident response, and vulnerability disclosure."
      contactEmail="security@velismail.online"
      contactLabel="For security questions or responsible disclosure, contact the security team with reproduction steps and relevant evidence."
    >
      <section>
        <p>
          Security is not a feature at VelisMail; it is the foundation of our infrastructure. This document outlines our cryptographic implementation, operational security measures, and processes used to protect data at every level.
        </p>
      </section>

      <section>
        <h2>1. Cryptographic Standards</h2>
        <p>
          Data at rest is encrypted using <strong>AES-256-GCM</strong>. Data in transit is secured through strict TLS 1.3 with forward secrecy. Emails are encrypted client-side before leaving the browser, and private keys never leave the device unencrypted.
        </p>
        <p>Key cryptographic measures include:</p>
        <ul>
          <li><strong>Transport Security:</strong> TLS 1.3 enforced on all connections. TLS 1.0 and 1.1 are disabled.</li>
          <li><strong>Encryption at Rest:</strong> AES-256-GCM for stored data, including backups where enabled.</li>
          <li><strong>Key Derivation:</strong> Argon2id password hashing with per-user salts.</li>
          <li><strong>Message Encryption:</strong> Client-side E2EE using modern public-key cryptography.</li>
          <li><strong>Certificate Management:</strong> Automated certificate rotation through ACME where applicable.</li>
        </ul>
      </section>

      <section>
        <h2>2. Zero-Knowledge Authentication</h2>
        <p>
          VelisMail accepts credentials only over HTTPS and stores passwords as one-way password hashes. Recovery-sensitive flows require OTP verification before account creation or password reset can complete.
        </p>
        <p>
          <strong>Team Access Security:</strong> Team sessions require a scoped invite key, exact email match, time-limited OTP verification, and role-based authorization before dashboard access is granted.
        </p>
        <p>
          <strong>Account Recovery:</strong> VelisMail verifies recovery email ownership before account creation and password reset flows can complete.
        </p>
      </section>

      <section>
        <h2>3. Infrastructure Security</h2>
        <p>
          The VelisMail backend is written in <strong>Rust</strong>, reducing entire classes of memory safety vulnerabilities such as buffer overflows, use-after-free errors, and data races.
        </p>
        <p>Additional infrastructure measures:</p>
        <ul>
          <li><strong>Network Isolation:</strong> Internal services communicate over private service networks.</li>
          <li><strong>DDoS Protection:</strong> Edge protection through Cloudflare where enabled.</li>
          <li><strong>Rate Limiting:</strong> API endpoints include rate limits to reduce brute-force attacks and abuse.</li>
          <li><strong>Security Updates:</strong> Critical security patches are prioritized after public disclosure.</li>
          <li><strong>Audit Logging:</strong> Workspace activity logs support administrator review and compliance workflows.</li>
        </ul>
      </section>

      <section>
        <h2>4. Access Controls</h2>
        <p>VelisMail enforces access controls across workspace and service boundaries:</p>
        <ul>
          <li><strong>Role-Based Access Control:</strong> Workspace roles are scoped to administrative and member operations.</li>
          <li><strong>Least Privilege:</strong> Users are granted the minimum access necessary to perform their functions.</li>
          <li><strong>Session Management:</strong> Sessions are cryptographically signed, time-limited, and revocable.</li>
          <li><strong>Device Revocation:</strong> Administrators can revoke sessions from the Team Access panel.</li>
          <li><strong>Workspace Isolation:</strong> Tenant-aware routing separates customer configuration and access boundaries.</li>
        </ul>
      </section>

      <section>
        <h2>5. Incident Response</h2>
        <p>VelisMail maintains an incident response process with the following commitments:</p>
        <ul>
          <li><strong>Detection:</strong> Monitoring and operational alerts are used to identify suspicious activity.</li>
          <li><strong>Response:</strong> Security-impacting events are triaged promptly based on severity.</li>
          <li><strong>Notification:</strong> Affected users are notified of confirmed data breaches according to applicable law.</li>
          <li><strong>Remediation:</strong> Root cause analysis and corrective actions are tracked through completion.</li>
          <li><strong>Review:</strong> Significant incidents are reviewed to improve controls and response quality.</li>
        </ul>
      </section>

      <section>
        <h2>6. Email Security Standards</h2>
        <p>VelisMail supports comprehensive email authentication and security standards:</p>
        <ul>
          <li><strong>SPF:</strong> Validates that emails are sent from authorized mail servers.</li>
          <li><strong>DKIM:</strong> Cryptographically signs outgoing emails to help prevent tampering.</li>
          <li><strong>DMARC:</strong> Protects domains from spoofing and phishing.</li>
          <li><strong>Anti-Abuse Controls:</strong> Abuse detection protects sending reputation and recipient safety.</li>
          <li><strong>Secure Transport:</strong> Mail and API traffic use encrypted channels wherever supported.</li>
        </ul>
      </section>

      <section>
        <h2>7. Compliance Alignment</h2>
        <p>VelisMail security practices are designed to align with modern privacy and security expectations, including:</p>
        <ul>
          <li>GDPR data protection principles.</li>
          <li>CCPA privacy rights where applicable.</li>
          <li>India Digital Personal Data Protection Act expectations.</li>
          <li>Business audit logging and access review workflows.</li>
          <li>Enterprise availability and confidentiality practices.</li>
        </ul>
      </section>

      <section>
        <h2>8. Vulnerability Disclosure</h2>
        <p>
          We encourage responsible vulnerability reports related to cryptography, authentication flows, dashboard authorization, or backend service boundaries. We commit to acknowledging good-faith reports and coordinating remediation where applicable.
        </p>
        <p>
          Report vulnerabilities to <a href="mailto:security@velismail.online">security@velismail.online</a>. Include a detailed description, steps to reproduce, impact, and proof-of-concept code if available.
        </p>
      </section>
    </LegalLayout>
  );
}
