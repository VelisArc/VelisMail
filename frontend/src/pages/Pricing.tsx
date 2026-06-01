import { formatINR } from '../utils/format';
import { useState, useEffect } from 'react';
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
  Menu,
} from 'lucide-react';
import { auth, isBusinessSetupReady } from '../api/client';
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
    ctaStyle: 'cta-outline',
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
    monthlyPrice: 299,
    annualPrice: Math.round(299 * 12 * 0.84),
    popular: false,
    cta: 'Start 14-Day Trial',
    ctaStyle: 'cta-outline',
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
    monthlyPrice: 999,
    annualPrice: Math.round(999 * 12 * 0.84),
    popular: true,
    cta: 'Start 14-Day Trial',
    ctaStyle: 'cta-primary',
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
    monthlyPrice: 2499,
    annualPrice: Math.round(2499 * 12 * 0.84),
    popular: false,
    cta: 'Start 14-Day Trial',
    ctaStyle: 'cta-primary',
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

export default function Pricing() {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [user] = useState(auth.getSession());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const getDashboardLink = () => {
    if (!user) return '/login';
    return isBusinessSetupReady(user) ? '/business' : '/business-setup';
  };

  const getDashboardText = () => {
    if (!user) return 'Get Started Free';
    return isBusinessSetupReady(user) ? 'Open Dashboard' : 'Continue Setup';
  };

  return (
    <div className="pricing-page">
      <div className="pricing-orb orb-a" />
      <div className="pricing-orb orb-b" />

      {/* Nav */}
      <nav className={`home-nav ${scrolled ? 'nav-scrolled' : ''}`} role="navigation" aria-label="Main navigation">
        <div className="nav-inner">
          <Link to="/" className="nav-logo" onClick={closeMobileMenu} aria-label="VelisMail home">
            <img src="/ZeeResizer.png" alt="" className="home-logo-img" />
            <span>VelisMail</span>
          </Link>

          <button
            type="button"
            className="nav-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          <div className={`nav-overlay ${mobileMenuOpen ? 'open' : ''}`} onClick={closeMobileMenu} aria-hidden="true" />

          <div className={`nav-links ${mobileMenuOpen ? 'open' : ''}`}>
            <a href="/#features" className="nav-link" onClick={closeMobileMenu}>Features</a>
            <a href="/#solutions" className="nav-link" onClick={closeMobileMenu}>Solutions</a>
            <Link to="/pricing" className="nav-link" onClick={closeMobileMenu}>Pricing</Link>
            <Link to="/about" className="nav-link" onClick={closeMobileMenu}>About</Link>
            <div className="nav-divider" role="separator" />
            {!user ? (
              <div className="nav-actions">
                <Link to="/login" className="nav-link" onClick={closeMobileMenu}>Log In</Link>
                <Link to="/login" className="btn btn-primary nav-cta" onClick={closeMobileMenu}>
                  Get Started Free
                </Link>
              </div>
            ) : (
              <div className="nav-actions">
                <Link to={getDashboardLink()} className="btn btn-primary nav-cta" onClick={closeMobileMenu}>
                  {getDashboardText()}
                </Link>
              </div>
            )}
          </div>
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
            aria-pressed={annual}
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
          const price = getDisplayedMonthlyPrice(plan, annual);
          const originalMonthly = plan.monthlyPrice;
          const isFree = plan.monthlyPrice === 0;
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

              <Link to={getDashboardLink()} className={`plan-cta ${plan.ctaStyle}`}>
                {user ? (isFree ? 'Go to Dashboard' : 'Start Trial in Dashboard') : plan.cta} <ArrowRight size={16} />
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
      <footer className="home-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <div className="nav-logo">
                <img src="/ZeeResizer.png" alt="" className="home-logo-img" />
                <span>VelisMail</span>
              </div>
              <p>Secure, encrypted email for modern teams.</p>
            </div>

            <div className="footer-column">
              <h4>Product</h4>
              <div className="footer-link-list">
                <a href="/#features" className="footer-link">Features</a>
                <Link to="/pricing" className="footer-link">Pricing</Link>
                <Link to="/status" className="footer-link">Status</Link>
                <Link to="/docs" className="footer-link">Docs</Link>
              </div>
            </div>
            <div className="footer-column">
              <h4>Company</h4>
              <div className="footer-link-list">
                <Link to="/about" className="footer-link">About</Link>
                <Link to="/privacy" className="footer-link">Privacy</Link>
                <Link to="/terms" className="footer-link">Terms</Link>
                <Link to="/security" className="footer-link">Security</Link>
              </div>
            </div>
            <div className="footer-column">
              <h4>Connect</h4>
              <div className="footer-link-list">
                <a href="/#feedback" className="footer-link">Feedback</a>
                <a href="mailto:support@velismail.online" className="footer-link">Support</a>
              </div>
            </div>
          </div>

          <div className="footer-bottom">
            <p>&copy; 2026 VelisMail. All rights reserved.</p>
            <div className="footer-bottom-links">
              <Link to="/security" className="footer-link">Security</Link>
              <Link to="/aup" className="footer-link">AUP</Link>
              <Link to="/refund" className="footer-link">Refund</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
