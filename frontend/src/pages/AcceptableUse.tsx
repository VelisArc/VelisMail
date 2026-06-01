import LegalLayout from './LegalLayout';

export default function AcceptableUse() {
  return (
    <LegalLayout
      slug="aup"
      title="Acceptable Use Policy"
      description="VelisMail's Acceptable Use Policy defines safe communications behavior, anti-spam rules, prohibited activity, and enforcement standards for the platform."
      contactEmail="abuse@velismail.online"
      contactLabel="Report suspected abuse, spam, phishing, or unsafe activity to our abuse desk with full email headers where possible."
    >
      <section>
        <p>
          VelisMail provides secure email hosting for legitimate business use. To protect workspace trust, domain reputation, and recipient safety, strict adherence to this Acceptable Use Policy is required.
        </p>
      </section>

      <section>
        <h2>1. Zero Tolerance for Spam</h2>
        <p>
          VelisMail prohibits unsolicited commercial email. You must have explicit, provable consent before adding recipients to any mailing list. Use of our SMTP relays for mass marketing, purchased lists, or cold-email campaigns is forbidden and may result in automated reputation controls, account suspension, or termination.
        </p>
      </section>

      <section>
        <h2>2. Prohibited Content and Activities</h2>
        <ul>
          <li><strong>Phishing and Spoofing:</strong> Attempting to impersonate other organizations or deceive users to steal credentials.</li>
          <li><strong>Malware Distribution:</strong> Sending emails containing viruses, trojans, ransomware, malicious attachments, or harmful links.</li>
          <li><strong>Illegal Operations:</strong> Using the platform to facilitate illegal goods, exploitation, fraud, harassment, or other unlawful activity.</li>
          <li><strong>Reputation Abuse:</strong> Sending behavior designed to bypass domain, rate, bounce, or complaint limits.</li>
          <li><strong>Unauthorized Access:</strong> Attempting to probe, scan, disrupt, or access systems or accounts without permission.</li>
        </ul>
      </section>

      <section>
        <h2>3. Enforcement and Reporting</h2>
        <p>
          We use automated threat intelligence and operational metadata, without reading encrypted message contents, to detect abuse and protect deliverability. We may collaborate with anti-abuse organizations and infrastructure providers when enforcing domain integrity.
        </p>
        <p>
          If you receive abusive email originating from a VelisMail-hosted domain, forward the full headers and relevant evidence to our abuse team.
        </p>
      </section>
    </LegalLayout>
  );
}
