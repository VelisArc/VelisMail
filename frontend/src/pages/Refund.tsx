import LegalLayout from './LegalLayout';

export default function Refund() {
  return (
    <LegalLayout
      slug="refund"
      title="Refund and Cancellation Policy"
      description="VelisMail's Refund and Cancellation Policy explains our 30-day money-back guarantee, cancellation handling, annual plan terms, and billing support process."
      contactEmail="support@velismail.online"
      contactLabel="Need help with billing, cancellations, or refund eligibility? Contact support from your registered workspace admin email."
    >
      <section>
        <p>
          We stand by our enterprise email infrastructure. If VelisMail does not meet your business needs, we make refunds simple, transparent, and fair. This policy applies to paid subscription plans purchased through our platform.
        </p>
      </section>

      <section>
        <h2>1. The 30-Day Money-Back Guarantee</h2>
        <p>
          All new Starter, Business, and Enterprise subscriptions are covered by our <strong>30-day money-back guarantee</strong>. If you are unsatisfied with our platform for any reason, you may request a full refund within the first 30 calendar days of your initial purchase.
        </p>
        <p>
          <strong>Eligibility:</strong> This guarantee applies only to the first subscription purchased by a workspace. Plan upgrades, downgrades, and renewals after the initial 30-day period are not eligible for this guarantee.
        </p>
        <p>
          <strong>Free Tier:</strong> The Free tier is provided at no cost. Refunds are not applicable for Free tier workspaces.
        </p>
      </section>

      <section>
        <h2>2. Subscription Cancellations</h2>
        <p>
          You can cancel your subscription at any time from your Business Dashboard Billing and Premium panel. Key points about cancellation:
        </p>
        <ul>
          <li>Cancellations take effect at the end of your current billing cycle.</li>
          <li>You retain access to paid features until the billing cycle ends.</li>
          <li>After the cycle ends, your workspace automatically downgrades to the Free tier with its associated limits.</li>
          <li>Your data is not deleted upon downgrade. If usage exceeds Free tier limits, you may need to reduce usage or re-subscribe.</li>
        </ul>
      </section>

      <section>
        <h2>3. Prorated Refunds</h2>
        <p>
          <strong>Monthly Plans:</strong> We do not provide prorated refunds for mid-cycle cancellations on monthly plans. Your subscription remains active until the end of the billing period.
        </p>
        <p>
          <strong>Annual Plans:</strong> If you cancel an annual plan after the initial 30-day guarantee period but before 6 months of usage, you may be eligible for a partial prorated refund. The refund amount is calculated as unused months times the monthly equivalent rate, minus a 15% early termination fee.
        </p>
        <p>
          <strong>Annual Plans After 6 Months:</strong> No refunds are available for annual plan cancellations made after 6 months of service.
        </p>
      </section>

      <section>
        <h2>4. Non-Refundable Items</h2>
        <p>The following are expressly non-refundable:</p>
        <ul>
          <li>Add-on services or custom integrations already delivered.</li>
          <li>Accounts terminated due to violation of our Terms of Service or Acceptable Use Policy.</li>
          <li>Subscriptions where a chargeback or payment dispute has been filed with the payment provider.</li>
          <li>Fees incurred from third-party services, including email API providers or database hosting connected via BYOI.</li>
        </ul>
      </section>

      <section>
        <h2>5. How to Request a Refund</h2>
        <ol>
          <li>Email <a href="mailto:support@velismail.online">support@velismail.online</a> from your registered workspace admin email address.</li>
          <li>Include your workspace name, registered email, and the reason for your refund request.</li>
          <li>Our team will acknowledge your request within 2 business days.</li>
          <li>Approved refunds are processed back to the original payment method through Razorpay and typically take 5-10 business days to appear on your statement.</li>
        </ol>
      </section>

      <section>
        <h2>6. Disputes and Chargebacks</h2>
        <p>
          Contact us directly before initiating a chargeback with your bank or payment provider. Chargebacks may incur processing fees and can result in workspace suspension while the dispute is reviewed.
        </p>
      </section>

      <section>
        <h2>7. Changes to This Policy</h2>
        <p>
          We may update this Refund and Cancellation Policy from time to time. Material changes will be posted on this page and, where appropriate, communicated to active subscribers by email.
        </p>
      </section>
    </LegalLayout>
  );
}
