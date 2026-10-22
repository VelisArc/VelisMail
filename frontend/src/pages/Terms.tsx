import LegalLayout from './LegalLayout';

export default function Terms() {
  return (
    <LegalLayout
      slug="terms"
      title="Terms of Service"
      description="VelisMail's Terms of Service define account responsibilities, BYOI infrastructure use, plan limits, billing rules, acceptable use, liability, and dispute handling."
      contactEmail="support@velismail.online"
      contactLabel="For legal, account, or service questions about these Terms, contact VelisMail support."
    >
      <section>
        <p>
          By accessing or using VelisMail's Enterprise Email Hosting platform and Zero Trust architecture, you agree to be bound by these Terms of Service. If you do not agree to these Terms, you must not use VelisMail. These Terms form a legally binding agreement between you and VelisMail.
        </p>
      </section>

      <section>
        <h2>1. Provision of Service</h2>
        <p>
          VelisMail provides business email hosting infrastructure for custom domains. The service includes custom domain management, live DNS validation, team management, audit logging, mail queue management and template management. Mail is stored in the workspace database you connect, and VelisMail is not an end-to-end encrypted or zero-knowledge service.
        </p>
        <p>
          Enterprise tier subscribers receive a 99.99% platform uptime target, Business tier subscribers receive 99.9%, and Starter tier subscribers receive 99.5%, subject to applicable service limitations. The Free tier is offered on a best-effort basis and does not carry an uptime guarantee.
        </p>
      </section>

      <section>
        <h2>2. Account Registration and Eligibility</h2>
        <p>
          To use VelisMail, you must create an account and provide accurate, current, and complete registration information. You represent and warrant that:
        </p>
        <ul>
          <li>You are at least 18 years of age or the age of legal majority in your jurisdiction.</li>
          <li>You have the legal authority to bind the organization on whose behalf you create a workspace.</li>
          <li>All information provided during registration is truthful and accurate.</li>
          <li>You will keep account and workspace information up to date.</li>
        </ul>
      </section>

      <section>
        <h2>3. User Responsibilities</h2>
        <p>
          You are responsible for maintaining the security of your password and of the credentials for the database and mail provider you connect. If you lose the credentials for connected infrastructure, VelisMail cannot restore access to that infrastructure for you.
        </p>
        <p>You are also responsible for:</p>
        <ul>
          <li>All activity under your account or workspace.</li>
          <li>Ensuring team members comply with these Terms.</li>
          <li>Maintaining the confidentiality of BYOI infrastructure credentials.</li>
          <li>Compliance with applicable local, state, national, and international laws.</li>
          <li>Promptly notifying us of unauthorized access or suspected compromise.</li>
        </ul>
      </section>

      <section>
        <h2>4. Acceptable Use and Restrictions</h2>
        <p>
          VelisMail is built for secure corporate communication, not mass marketing or malicious activity. Users are prohibited from using the platform for:
        </p>
        <ul>
          <li>Sending unsolicited bulk email or commercial messages without recipient consent.</li>
          <li>Distributing malware, ransomware, viruses, phishing campaigns, or harmful links.</li>
          <li>Hosting, transmitting, or distributing illegal content or conducting illegal operations.</li>
          <li>Impersonating a person or entity or falsely representing affiliation.</li>
          <li>Disrupting or attempting unauthorized access to infrastructure, accounts, or data.</li>
          <li>Harvesting email addresses or personal information from third parties.</li>
          <li>Using the service to violate intellectual property rights.</li>
        </ul>
        <p>
          Violations may result in suspension, termination, forfeiture of refunds, and reporting to relevant providers or authorities where required.
        </p>
      </section>

      <section>
        <h2>5. Billing, Subscriptions, and Infrastructure</h2>
        <p>
          VelisMail operates on a per-workspace subscription model with Free, Starter, Business, and Enterprise tiers. Prices are listed in Indian Rupees and may be subject to applicable taxes such as GST.
        </p>
        <p>
          <strong>Plan Prices:</strong> Starter is INR 299/month, Business is INR 999/month, and Enterprise is INR 2,499/month unless changed on the public pricing page or checkout screen.
        </p>
        <p>
          <strong>Bring Your Own Infrastructure:</strong> You connect your own PostgreSQL database and email API provider, such as SendGrid, Postmark, or Resend. Your VelisMail plan establishes platform thresholds for monthly email volume, daily sending limits, storage, team members, custom domains, templates, and audit log retention.
        </p>
        <p>
          Purchasing a VelisMail premium plan does not upgrade limits from third-party providers. You are responsible for ensuring that external providers can handle your volume and compliance needs.
        </p>
        <p>
          <strong>Self-Service Upgrades:</strong> Premium subscriptions are purchased from the Business Dashboard Billing and Premium panel.
        </p>
        <p>
          <strong>Auto-Renewal and Cancellation:</strong> Subscriptions are billed automatically on a monthly or annual basis unless canceled. Cancellations take effect at the end of the current billing cycle.
        </p>
      </section>

      <section>
        <h2>6. Intellectual Property</h2>
        <p>
          VelisMail owns the platform content, features, user interface, design, text, graphics, logos, icons, and software, except where third-party licenses or user-provided content apply.
        </p>
        <p>
          You retain ownership of content you create, send, receive, and store through VelisMail. We claim no ownership rights over your customer data.
        </p>
      </section>

      <section>
        <h2>7. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by applicable law, VelisMail and its affiliates, officers, employees, agents, and licensors shall not be liable for indirect, incidental, special, consequential, punitive, or similar damages, including loss of profits, revenue, data, goodwill, or use.
        </p>
        <ul>
          <li>Your use of or inability to use the service.</li>
          <li>Unauthorized access to or use of servers or personal information.</li>
          <li>Interruption or cessation of transmission to or from the service.</li>
          <li>Harmful code transmitted through the service by a third party.</li>
          <li>Errors or omissions in service content.</li>
        </ul>
        <p>
          Our total aggregate liability for claims arising out of these Terms or the service shall not exceed the amount you paid to VelisMail during the 12 months preceding the claim.
        </p>
      </section>

      <section>
        <h2>8. Indemnification</h2>
        <p>
          You agree to indemnify and hold harmless VelisMail and its affiliates, officers, directors, employees, and agents from claims, liabilities, damages, losses, costs, and expenses arising from your use of the service, your violation of these Terms, or your violation of any rights of another.
        </p>
      </section>

      <section>
        <h2>9. Service Modifications</h2>
        <p>
          We may modify, suspend, or discontinue any aspect of VelisMail with or without notice. We will make reasonable efforts to notify users of material changes that affect service use.
        </p>
      </section>

      <section>
        <h2>10. Governing Law and Dispute Resolution</h2>
        <p>
          These Terms are governed by the laws of India, without regard to conflict of law rules. Disputes arising from these Terms or VelisMail use are subject to the exclusive jurisdiction of courts located in Kolkata, West Bengal, India.
        </p>
        <p>
          Before initiating formal legal proceedings, you agree to first attempt to resolve the dispute informally by contacting <a href="mailto:support@velismail.online">support@velismail.online</a>. We will attempt to resolve the dispute within 30 days.
        </p>
      </section>

      <section>
        <h2>11. Severability</h2>
        <p>
          If any provision of these Terms is found unenforceable or invalid, that provision will be limited or eliminated to the minimum extent necessary so the remaining Terms remain in effect.
        </p>
      </section>

      <section>
        <h2>12. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Material changes will be communicated through this page and, where appropriate, by email to the registered workspace administrator before taking effect.
        </p>
      </section>
    </LegalLayout>
  );
}
