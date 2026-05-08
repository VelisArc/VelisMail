import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  X,
  ChevronDown,
  Zap,
  Briefcase,
  Building2,
  Rocket,
  Server,
  CheckCircle2,
} from 'lucide-react';
import './Pricing.css';

const plans = [
  {
    id: 'free',
    name: 'Free',
    icon: Zap,
    desc: 'For individuals & testing.',
    monthlyPrice: 0,
    annualPrice: 0,
    popular: false,
    cta: 'Get Started Free',
    ctaStyle: 'btn-outline',
    features: [
      { text: '3,000 emails/mo', highlight: true },
      { text: '100 emails/day limit', highlight: false },
      { text: '500MB Storage', highlight: false },
      { text: '3 team members', highlight: false },
      { text: '1 custom domain', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: '3 mail templates', highlight: false },
      { text: '7 days audit logs', highlight: false },
    ],
    disabledFeatures: [
      'Custom branding',
      'Priority support',
      'Advanced routing',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    icon: Rocket,
    desc: 'For small teams getting serious.',
    monthlyPrice: 799,
    annualPrice: 7999,
    popular: false,
    cta: 'Start 14-Day Trial',
    ctaStyle: 'btn-outline',
    features: [
      { text: '150,000 emails/mo', highlight: true },
      { text: 'No daily email limit', highlight: false },
      { text: '10GB Storage', highlight: false },
      { text: '15 team members', highlight: false },
      { text: '3 custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: '25 mail templates', highlight: false },
      { text: '30 days audit logs', highlight: false },
      { text: 'Email support', highlight: false },
      { text: '99.5% platform SLA', highlight: false },
    ],
    disabledFeatures: [
      'Custom branding',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    icon: Briefcase,
    desc: 'For growing companies.',
    monthlyPrice: 2499,
    annualPrice: 24999,
    popular: true,
    cta: 'Start 14-Day Trial',
    ctaStyle: 'btn-primary',
    features: [
      { text: '750,000 emails/mo', highlight: true },
      { text: 'No daily email limit', highlight: false },
      { text: '50GB Storage', highlight: false },
      { text: '75 team members', highlight: false },
      { text: '10 custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: 'Unlimited mail templates', highlight: false },
      { text: '90 days audit logs', highlight: false },
      { text: 'Custom branding', highlight: true },
      { text: 'Email + chat support', highlight: false },
      { text: '99.9% platform SLA', highlight: false },
    ],
    disabledFeatures: [],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    icon: Building2,
    desc: 'For large organizations.',
    monthlyPrice: 6999,
    annualPrice: 69999,
    popular: false,
    cta: 'Start 14-Day Trial',
    ctaStyle: 'btn-primary',
    features: [
      { text: 'Unlimited emails', highlight: true },
      { text: 'No daily email limit', highlight: false },
      { text: 'Unlimited Storage', highlight: false },
      { text: 'Unlimited team members', highlight: false },
      { text: 'Unlimited custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: 'Unlimited mail templates', highlight: false },
      { text: '1 year audit logs', highlight: false },
      { text: 'Dedicated Account Manager', highlight: false },
      { text: '99.99% platform SLA', highlight: false },
    ],
    disabledFeatures: [],
  },
];

const comparisonRows = [
  { label: 'Monthly Emails', free: '3,000', starter: '150,000', business: '750,000', enterprise: 'Unlimited' },
  { label: 'Daily Email Limit', free: '100/day', starter: 'No limit', business: 'No limit', enterprise: 'No limit' },
  { label: 'Storage Limit', free: '500 MB', starter: '10 GB', business: '50 GB', enterprise: 'Unlimited' },
  { label: 'Team Members', free: '3', starter: '15', business: '75', enterprise: 'Unlimited' },
  { label: 'Custom Domains', free: '1', starter: '3', business: '10', enterprise: 'Unlimited' },
  { label: 'Mail Templates', free: '3', starter: '25', business: 'Unlimited', enterprise: 'Unlimited' },
  { label: 'Audit Log Retention', free: '7 days', starter: '30 days', business: '90 days', enterprise: '1 year' },
  { label: 'Custom Branding', free: false, starter: false, business: true, enterprise: true },
  { label: 'Platform SLA', free: 'Best Effort', starter: '99.5%', business: '99.9%', enterprise: '99.99%' },
  { label: 'Support', free: 'Community', starter: 'Email', business: 'Email + Chat', enterprise: 'Account Manager' },
];

const pricingFaqs = [
  {
    q: 'Is pricing per-user or per-workspace?',
    a: 'VelisMail pricing is per-workspace, not per-user. This means you can add as many users as your plan allows without paying extra per seat. This is significantly more cost-effective than Google Workspace or Microsoft 365.',
  },
  {
    q: 'Are email sending and storage limits included?',
    a: 'Yes, every plan has its own soft limits. The Free plan allows 3,000 emails/month, Starter allows 150k, and Business allows 750k. To send more, you need to upgrade to a higher plan or choose Enterprise (Unlimited).',
  },
  {
    q: 'What is the benefit of buying a premium plan?',
    a: 'Premium plans significantly increase your email capacity and storage. They also unlock workspace features such as more team members, custom domains, unlimited audit logs, and custom branding.',
  },
  {
    q: 'Is there a discount for annual billing?',
    a: 'Yes! Choosing annual billing saves you approximately 16% — that is equivalent to getting 2 months completely free.',
  },
  {
    q: 'What if I am not satisfied with my plan?',
    a: 'We offer a 30-day money-back guarantee on all new paid subscriptions. If you are not satisfied, you can request a refund within the first 30 days.',
  },
  {
    q: 'Are prices inclusive of GST?',
    a: 'Listed prices are GST-exclusive. Applicable GST (18%) will be added at checkout as per Indian tax regulations.',
  },
];

function formatINR(amount: number): string {
  if (amount === 0) return '0';
  return amount.toLocaleString('en-IN');
}

export default function Pricing() {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="pricing-page">
      <div className="pricing-orb orb-a" />
      <div className="pricing-orb orb-b" />

      {/* Nav */}
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '24px', width: 'auto' }} />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pricing-hero">
        <span className="section-badge">Pricing</span>
        <h1>
          Simple, Transparent <span>Pricing.</span>
        </h1>
        <p className="pricing-subtitle">
          Per-workspace pricing — not per-user. Connect your own infrastructure and scale your email limits safely and securely with our dedicated software tiers.
        </p>

        {/* Billing Toggle */}
        <div className="billing-toggle-wrap">
          <span className={!annual ? 'active' : ''}>Monthly</span>
          <button
            type="button"
            className={`billing-toggle ${annual ? 'annual' : ''}`}
            onClick={() => setAnnual(!annual)}
            aria-label="Toggle billing cycle"
          >
            <div className="toggle-knob" />
          </button>
          <span className={annual ? 'active' : ''}>Annual</span>
          <span className="billing-save-badge">Save 16%</span>
        </div>
      </section>

      {/* Pricing Cards */}
      <div className="pricing-grid">
        {plans.map((plan) => {
          const price = annual ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;
          const originalMonthly = plan.monthlyPrice;
          const isFree = plan.monthlyPrice === 0;

          return (
            <div key={plan.id} className={`pricing-card ${plan.popular ? 'popular' : ''}`}>
              {plan.popular && <div className="popular-badge">Most Popular</div>}

              <div className="plan-icon">
                <plan.icon size={22} />
              </div>

              <h3>{plan.name}</h3>
              <p className="plan-desc">{plan.desc}</p>

              {isFree ? (
                <>
                  <div className="price-free-label">Free</div>
                  <p className="price-annual-note">Forever free — no credit card required</p>
                </>
              ) : (
                <>
                  <div className="price-display">
                    <span className="price-currency">₹</span>
                    <span className="price-amount">{formatINR(price)}</span>
                    <span className="price-period">/mo</span>
                  </div>
                  <p className="price-annual-note">
                    {annual ? (
                      <>
                        <span className="strike">₹{formatINR(originalMonthly)}/mo</span>
                        <span className="save">Billed ₹{formatINR(plan.annualPrice)}/year</span>
                      </>
                    ) : (
                      <>Billed monthly · Switch to annual & save</>
                    )}
                  </p>
                </>
              )}

              <div className="plan-divider" />

              <ul className="plan-features">
                {plan.features.map((f, i) => (
                  <li key={i}>
                    <Check size={16} />
                    <span className={f.highlight ? 'feature-highlight' : ''}>{f.text}</span>
                  </li>
                ))}
                {plan.disabledFeatures.map((f, i) => (
                  <li key={`d-${i}`} className="disabled">
                    <X size={16} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link to="/login" className={`plan-cta ${plan.ctaStyle}`}>
                {plan.cta} <ArrowRight size={16} />
              </Link>
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="pricing-comparison">
        <div className="section-head">
          <h2>Detailed Feature Comparison</h2>
        </div>
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Free</th>
                <th>Starter</th>
                <th className="popular-col">Business</th>
                <th>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {(['free', 'starter', 'business', 'enterprise'] as const).map((tier) => {
                    const val = row[tier];
                    if (typeof val === 'boolean') {
                      return (
                        <td key={tier}>
                          {val ? <Check size={18} className="check" /> : <X size={18} className="cross" />}
                        </td>
                      );
                    }
                    return <td key={tier}>{val}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Infrastructure Included Note */}
      <div className="infra-note">
        <div className="infra-note-card">
          <h3>
            <Server size={22} />
            Bring Your Own Infrastructure (BYOI)
          </h3>
          <p>
            VelisMail is a secure software control panel and interface. <strong>We do not impose limits on your email sending volume or storage capacity.</strong> Instead, you bring your own PostgreSQL database and email delivery API (SendGrid, Postmark, Resend, etc.).
          </p>
          <ul>
            <li><CheckCircle2 size={16} /> Zero email volume limits from our side</li>
            <li><CheckCircle2 size={16} /> Zero storage capacity limits from our side</li>
            <li><CheckCircle2 size={16} /> Complete data sovereignty in your own DB</li>
            <li><CheckCircle2 size={16} /> Use your preferred email API provider</li>
            <li><CheckCircle2 size={16} /> Premium plans only gate software features</li>
            <li><CheckCircle2 size={16} /> True private mail architecture</li>
          </ul>
          <p style={{ marginTop: 16 }}>
            <strong>Important:</strong> Purchasing a VelisMail premium plan does not upgrade your email API limits. You must ensure your third-party providers can handle your volume.
          </p>
        </div>
      </div>

      {/* Pricing FAQ */}
      <div className="pricing-faq">
        <div className="section-head">
          <h2>Frequently Asked Questions</h2>
        </div>
        {pricingFaqs.map((faq, idx) => (
          <div key={idx} className="faq-item">
            <button
              className="faq-question"
              onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
              type="button"
            >
              {faq.q}
              <ChevronDown size={18} className={openFaq === idx ? 'open' : ''} />
            </button>
            {openFaq === idx && (
              <div className="faq-answer">{faq.a}</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <footer className="legal-footer">
        <div className="container legal-footer-inner">
          <span>© 2026 VelisMail. All rights reserved.</span>
          <div className="legal-footer-links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/cookies">Cookie Policy</Link>
            <Link to="/aup">Acceptable Use</Link>
            <Link to="/security">Security</Link>
            <Link to="/refund">Refund Policy</Link>
            <Link to="/about">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
