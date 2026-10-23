import { formatINR } from '../utils/format';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
import { auth, fetchApiResponse } from '../api/client';
import SiteNav from '../components/site/SiteNav';
import SiteFooter from '../components/site/SiteFooter';
import './Pricing.css';

const plans = [
  {
    id: 'free',
    name: 'Free',
    icon: Zap,
    desc: 'For trying the workspace.',
    monthlyPrice: 0,
    annualPrice: 0,
    popular: false,
    cta: 'Get Started Free',
    ctaStyle: 'cta-outline',
    features: [
      { text: '3,000 emails/mo', highlight: true },
      { text: '100 emails/day cap', highlight: false },
      { text: '500 MB database storage', highlight: false },
      { text: '3 team members', highlight: false },
      { text: '1 custom domain', highlight: false },
      { text: 'SPF, DKIM, DMARC verification', highlight: false },
      { text: '3 mail templates', highlight: false },
      { text: '5 MB attachment limit', highlight: false },
      { text: 'Community support', highlight: false },
    ],
    disabledFeatures: [
      'Custom volume',
      'Invoice billing',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    icon: Rocket,
    desc: 'For small teams getting serious.',
    monthlyPrice: 299,
    annualPrice: Math.round(299 * 12 * 0.84),
    popular: false,
    cta: 'Choose Starter',
    ctaStyle: 'cta-outline',
    features: [
      { text: '150,000 emails/mo', highlight: true },
      { text: '150,000 emails/day cap', highlight: false },
      { text: '10 GB database storage', highlight: false },
      { text: '15 team members', highlight: false },
      { text: '3 custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC verification', highlight: false },
      { text: '25 mail templates', highlight: false },
      { text: '25 MB attachment limit', highlight: false },
      { text: '120 API requests/min', highlight: false },
      { text: 'Email support', highlight: false },
    ],
    disabledFeatures: [],
  },
  {
    id: 'business',
    name: 'Business',
    icon: Briefcase,
    desc: 'For growing companies.',
    monthlyPrice: 999,
    annualPrice: Math.round(999 * 12 * 0.84),
    popular: true,
    cta: 'Choose Business',
    ctaStyle: 'cta-primary',
    features: [
      { text: '750,000 emails/mo', highlight: true },
      { text: '750,000 emails/day cap', highlight: false },
      { text: '50 GB database storage', highlight: false },
      { text: '75 team members', highlight: false },
      { text: '10 custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC verification', highlight: false },
      { text: 'Custom mail templates', highlight: false },
      { text: '50 MB attachment limit', highlight: false },
      { text: '500 API requests/min', highlight: false },
      { text: 'Priority email support', highlight: false },
    ],
    disabledFeatures: [],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    icon: Building2,
    desc: 'Negotiated for your organization.',
    monthlyPrice: 0,
    annualPrice: 0,
    popular: false,
    cta: 'Contact Now',
    ctaStyle: 'cta-primary',
    features: [
      { text: 'Volume, storage and seats negotiated', highlight: true },
      { text: 'Every published workspace feature', highlight: false },
      { text: 'Custom API rate limit', highlight: false },
      { text: 'Invoice billing', highlight: false },
      { text: 'Onboarding support', highlight: false },
      { text: 'No online checkout', highlight: false },
    ],
    disabledFeatures: [],
  },
];

const comparisonRows = [
  { label: 'Monthly Emails', free: '3,000', starter: '150,000', business: '750,000', enterprise: 'Negotiated' },
  { label: 'Daily Email Cap', free: '100', starter: '150,000', business: '750,000', enterprise: 'Negotiated' },
  { label: 'Storage Limit', free: '500 MB', starter: '10 GB', business: '50 GB', enterprise: 'Negotiated' },
  { label: 'Team Members', free: '3', starter: '15', business: '75', enterprise: 'Negotiated' },
  { label: 'Custom Domains', free: '1', starter: '3', business: '10', enterprise: 'Negotiated' },
  { label: 'Mail Templates', free: '3', starter: '25', business: 'Custom', enterprise: 'Negotiated' },
  { label: 'Attachment Limit', free: '5 MB', starter: '25 MB', business: '50 MB', enterprise: 'Negotiated' },
  { label: 'API Requests', free: '30/min', starter: '120/min', business: '500/min', enterprise: 'Negotiated' },
  { label: 'Support', free: 'Community', starter: 'Email', business: 'Priority email', enterprise: 'Onboarding' },
];

const pricingFaqs = [
  {
    q: 'Is pricing per-user or per-workspace?',
    a: 'VelisMail pricing is per-workspace. Each plan includes a fixed number of seats, and every seat in that allowance can use the workspace without a per-seat charge. A larger team needs a plan with more seats or a negotiated Enterprise allowance.',
  },
  {
    q: 'Are email sending and storage limits included?',
    a: 'Yes, every plan has enforced monthly volume, a daily cap and a storage limit. Free includes 3,000 emails a month, Starter 150,000 and Business 750,000. When a workspace reaches its limit, sending is refused until the next period or an upgrade.',
  },
  {
    q: 'What is the benefit of buying a premium plan?',
    a: 'Premium plans raise the monthly volume, storage, team seats, domain count, template allowance and API rate limit. Every plan runs the same console and the same DNS verification; the paid plans simply remove the small-plan caps.',
  },
  {
    q: 'Is there a discount for annual billing?',
    a: 'Yes. Annual billing is 16% cheaper than twelve monthly payments, which is close to two months of the monthly price.',
  },
  {
    q: 'What if I am not satisfied with my plan?',
    a: 'We offer a 30-day money-back guarantee on the first paid subscription of a workspace. The full terms are in the Refund and Cancellation Policy.',
  },
  {
    q: 'Are prices inclusive of GST?',
    a: 'Listed prices are in Indian Rupees and do not include applicable taxes. Any tax your payment provider applies is shown at checkout. Contact support if you need a tax invoice for your workspace.',
  },
];



function getAnnualSavings(plan: typeof plans[number]): number {
  return Math.max(0, plan.monthlyPrice * 12 - plan.annualPrice);
}

function getAnnualSavingsPercent(plan: typeof plans[number]): number {
  const monthlyYearTotal = plan.monthlyPrice * 12;
  if (monthlyYearTotal === 0) return 0;
  return Math.round((getAnnualSavings(plan) / monthlyYearTotal) * 100);
}

function getDisplayedMonthlyPrice(plan: typeof plans[number], annualBilling: boolean): number {
  return annualBilling ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;
}

type EnterpriseContactForm = {
  name: string;
  email: string;
  company: string;
  message: string;
};

export default function Pricing() {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [user] = useState(auth.getSession());
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);
  const [enterpriseSending, setEnterpriseSending] = useState(false);
  const [enterpriseState, setEnterpriseState] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [enterpriseForm, setEnterpriseForm] = useState<EnterpriseContactForm>({
    name: user?.displayName || '',
    email: user?.email || '',
    company: '',
    message: '',
  });

  const getDashboardLink = () => {
    if (!user) return '/login?mode=register';
    return '/business';
  };

  const openEnterpriseContact = () => {
    setEnterpriseState(null);
    setEnterpriseForm((current) => ({
      ...current,
      name: current.name || user?.displayName || '',
      email: current.email || user?.email || '',
    }));
    setEnterpriseOpen(true);
  };

  const handleEnterpriseSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEnterpriseSending(true);
    setEnterpriseState(null);

    const messageParts = ['Enterprise plan request'];
    if (enterpriseForm.company.trim()) {
      messageParts.push(`Company: ${enterpriseForm.company.trim()}`);
    }
    messageParts.push('', enterpriseForm.message.trim());

    try {
      await fetchApiResponse('/auth/feedback', {
        method: 'POST',
        body: JSON.stringify({
          name: enterpriseForm.name.trim(),
          email: enterpriseForm.email.trim(),
          type: 'enterprise plan request',
          message: messageParts.join('\n'),
        }),
      });
      setEnterpriseState({
        type: 'success',
        message: 'Your request has been sent to the VelisMail team. We will reply to your email shortly.',
      });
      setEnterpriseForm((current) => ({ ...current, company: '', message: '' }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setEnterpriseState({
        type: 'error',
        message: detail
          ? `Could not send your request: ${detail}`
          : 'Could not send your request right now. Please email support@velismail.online.',
      });
    } finally {
      setEnterpriseSending(false);
    }
  };

  return (
    <div className="pricing-page">
      <div className="pricing-orb orb-a" />
      <div className="pricing-orb orb-b" />

      <SiteNav />

      {/* Hero */}
      <section className="pricing-hero">
        <span className="section-badge">Pricing</span>
        <h1>
          Simple, Transparent <span>Pricing.</span>
        </h1>
        <p className="pricing-subtitle">
          Per-workspace pricing — not per-user. Connect your own infrastructure and scale your email limits safely and securely with our dedicated software tiers.
        </p>

        {/* Billing cycle */}
        <div className="billing-toggle-wrap">
          <div className="billing-toggle" role="group" aria-label="Billing cycle">
            <button
              type="button"
              className={!annual ? 'active' : ''}
              aria-pressed={!annual}
              onClick={() => setAnnual(false)}
            >
              Monthly
            </button>
            <button
              type="button"
              className={annual ? 'active' : ''}
              aria-pressed={annual}
              onClick={() => setAnnual(true)}
            >
              Annual
              <span className="billing-save-badge">Save 16%</span>
            </button>
          </div>
          <p className="billing-toggle-note" aria-live="polite">
            {annual ? 'Charged once a year, 16% below the monthly price.' : 'Switch to annual billing and save 16%.'}
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <div className="pricing-grid">
        {plans.map((plan) => {
          const price = getDisplayedMonthlyPrice(plan, annual);
          const originalMonthly = plan.monthlyPrice;
          const isFree = plan.monthlyPrice === 0 && plan.id !== 'enterprise';
          const isEnterprise = plan.id === 'enterprise';
          const annualSavings = getAnnualSavings(plan);
          const annualSavingsPercent = getAnnualSavingsPercent(plan);

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
              ) : isEnterprise ? (
                <>
                  <div className="price-custom-label">Custom</div>
                  <p className="price-annual-note">Tailored to your organization — talk to our team, no online checkout</p>
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
                        <span className="save">
                          Billed ₹{formatINR(plan.annualPrice)}/year · save ₹{formatINR(annualSavings)} ({annualSavingsPercent}%)
                        </span>
                      </>
                    ) : (
                      <>Billed monthly · Switch to annual & save 16%</>
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

              {isEnterprise ? (
                <button type="button" className={`plan-cta ${plan.ctaStyle}`} onClick={openEnterpriseContact} aria-haspopup="dialog">
                  Contact Now <ArrowRight size={16} />
                </button>
              ) : (
                <Link to={getDashboardLink()} className={`plan-cta ${plan.ctaStyle}`}>
                  {user ? (isFree ? 'Go to Dashboard' : 'Start Trial in Dashboard') : plan.cta} <ArrowRight size={16} />
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Feature Comparison Table */}
      <div className="pricing-comparison">
        <div className="section-head">
          <h2>Detailed Feature Comparison</h2>
        </div>
        <p className="comparison-scroll-hint">Swipe sideways to compare every plan.</p>
        <div className="comparison-table-wrap" tabIndex={0} role="region" aria-label="Plan feature comparison, scrollable">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">Free</th>
                <th scope="col">Starter</th>
                <th scope="col" className="popular-col">Business</th>
                <th scope="col">Enterprise</th>
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
              aria-expanded={openFaq === idx}
              aria-controls={`pricing-faq-answer-${idx}`}
            >
              {faq.q}
              <ChevronDown size={18} className={openFaq === idx ? 'open' : ''} />
            </button>
            {openFaq === idx && (
              <div className="faq-answer" id={`pricing-faq-answer-${idx}`} role="region">
                {faq.a}
              </div>
            )}
          </div>
        ))}
      </div>

      <SiteFooter />

      {enterpriseOpen && (
        <div className="modal-overlay" onClick={() => setEnterpriseOpen(false)}>
          <div
            className="modal enterprise-contact-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enterprise-contact-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h3 id="enterprise-contact-title"><Building2 size={16} /> Talk to the VelisMail team</h3>
                <p>Tell us about your organization. Your request goes straight to our team — no checkout.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setEnterpriseOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <form className="enterprise-contact-form" onSubmit={handleEnterpriseSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label" htmlFor="enterprise-name">Name</label>
                    <input
                      id="enterprise-name"
                      className="input"
                      value={enterpriseForm.name}
                      onChange={(event) => setEnterpriseForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Jane Doe"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="enterprise-email">Work email</label>
                    <input
                      id="enterprise-email"
                      className="input"
                      type="email"
                      value={enterpriseForm.email}
                      onChange={(event) => setEnterpriseForm((current) => ({ ...current, email: event.target.value }))}
                      placeholder="jane@company.com"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="enterprise-company">Company / team size</label>
                  <input
                    id="enterprise-company"
                    className="input"
                    value={enterpriseForm.company}
                    onChange={(event) => setEnterpriseForm((current) => ({ ...current, company: event.target.value }))}
                    placeholder="Acme Inc · 50 people"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="enterprise-message">What do you need?</label>
                  <textarea
                    id="enterprise-message"
                    className="input"
                    rows={4}
                    value={enterpriseForm.message}
                    onChange={(event) => setEnterpriseForm((current) => ({ ...current, message: event.target.value }))}
                    placeholder="Domains, mailboxes, compliance, migration, or anything else we should know."
                    required
                  />
                </div>

                {enterpriseState && (
                  <div className={`inline-alert ${enterpriseState.type}`} role={enterpriseState.type === 'error' ? 'alert' : 'status'}>
                    {enterpriseState.message}
                  </div>
                )}

                <p className="enterprise-contact-fallback">
                  Prefer email? <a href="mailto:support@velismail.online?subject=Enterprise%20plan%20request">support@velismail.online</a>
                </p>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEnterpriseOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={enterpriseSending}>
                  {enterpriseSending ? 'Sending…' : 'Send request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
