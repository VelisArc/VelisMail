import { Link } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Database,
  Fingerprint,
  Globe,
  Key,
  Lock,
  Menu,
  Server,
  Shield,
  Sparkles,
  X,
  Zap,
  Briefcase,
  Users,
  Settings,
  ChevronDown,
  ArrowUp,
} from 'lucide-react';
import { auth, fetchApiResponse, isBusinessSetupReady } from '../api/client';
import HomeOpsScene from '../components/HomeOpsScene';
import SEO from '../components/SEO';
import './Home.css';

const features = [
  { icon: Lock, title: 'End-to-end encrypted mail flow', desc: 'Protect messages in transit and at rest with secure delivery defaults, strict policy controls, and resilient infrastructure.' },
  { icon: Fingerprint, title: 'Recovery-backed business access', desc: 'Use verified recovery emails, strong password controls, and scoped workspace access for teams without weak shared credentials.' },
  { icon: Globe, title: 'Domain reputation management', desc: 'Ship with DNS ownership checks, provider record validation, and verification tooling that keeps setup honest.' },
  { icon: Server, title: 'Operational visibility', desc: 'Track queue health, audit activity, templates, sender identities, and domain readiness from one business console.' },
  { icon: Shield, title: 'Compliance-ready controls', desc: 'Support regulated teams with clear activity records, mailbox governance, and data-sovereignty-friendly architecture.' },
  { icon: Database, title: 'Bring your own infrastructure', desc: 'Connect your database and provider stack while keeping operational workflows centralized inside the VelisMail workspace.' },
  { icon: Users, title: 'Role-aware team operations', desc: 'Invite admins, members, and viewers with scoped access, audit history, and confirmation flows for sensitive permission changes.' },
  { icon: Briefcase, title: 'Mailbox governance', desc: 'Manage primary senders, aliases, shared inboxes, distribution groups, and domain-specific identities from one console.' },
  { icon: Settings, title: 'Delivery workflow controls', desc: 'Use templates, mail queue inspection, scheduled send, retry controls, bulk actions, and message filters for daily operations.' },
  { icon: CheckCircle2, title: 'DNS verification diagnostics', desc: 'Run guided checks for MX, SPF, DKIM, DMARC, provider credentials, and sender-domain readiness with actionable results.' },
  { icon: Sparkles, title: 'Professional operator experience', desc: 'Clean dashboard patterns, focused modals, searchable folders, readable message views, and fast navigation for busy teams.' },
  { icon: Cloud, title: 'Provider flexibility', desc: 'Work with supported mail providers and custom infrastructure while keeping the VelisMail UX consistent for every workspace.' },
];

const stats = [
  { value: '256-bit', label: 'Encryption', icon: Key },
  { value: '99.99%', label: 'Uptime SLA', icon: Cloud },
  { value: '<50ms', label: 'Routing', icon: Zap },
  { value: '10m', label: 'OTP Window', icon: Fingerprint },
  { value: '9+', label: 'Mail Views', icon: Server },
  { value: 'Zero Trust', label: 'Access', icon: Shield },
];

const faqs = [
  { q: 'How does the end-to-end encryption work?', a: 'We utilize a combination of robust public-key cryptography (RSA-4096) for message transit and AES-256 for data at rest. Your private keys never leave your secure enclave.' },
  { q: 'Can I migrate my existing email history?', a: 'Yes. Our automated migration tools support IMAP import from major providers including Google Workspace and Microsoft 365 with zero downtime.' },
  { q: 'What happens if I lose my device?', a: 'Our passwordless authentication system allows administrators to instantly revoke device tokens and provision new access credentials without compromising account security.' },
  { q: 'Is custom branding supported?', a: 'Absolutely. Enterprise tier customers can white-label the entire webmail interface with custom logos, colors, and dedicated login portals.' },
];

type SubmissionState = { type: 'success' | 'info' | 'error'; message: string } | null;

function useScrollPosition() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  return scrolled;
}

function useScrollToTop() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const check = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  return { visible, scrollToTop };
}

function useIntersectionObserver() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1 }
    );
    const elements = node.querySelectorAll('.animate-on-scroll');
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  return ref;
}

function saveOfflineLead(key: string, payload: Record<string, string>) {
  const existing = JSON.parse(localStorage.getItem(key) || '[]') as Array<Record<string, string>>;
  existing.unshift({ ...payload, createdAt: new Date().toISOString() });
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 25)));
}

export default function Home() {
  const [user] = useState(auth.getSession());
  const scrolled = useScrollPosition();
  const { visible: showScrollTop, scrollToTop } = useScrollToTop();
  const animationRef = useIntersectionObserver();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [feedbackForm, setFeedbackForm] = useState({ name: '', email: '', type: 'suggestion', message: '' });
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackState, setFeedbackState] = useState<SubmissionState>(null);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const getDashboardLink = () => {
    if (!user) return '/login';
    return isBusinessSetupReady(user) ? '/business' : '/business-setup';
  };

  const getDashboardText = () => {
    if (!user) return 'Get Started Free';
    return isBusinessSetupReady(user) ? 'Open Dashboard' : 'Continue Setup';
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackSending(true);
    setFeedbackState(null);
    try {
      await fetchApiResponse('/feedback', {
        method: 'POST',
        body: JSON.stringify(feedbackForm),
      });
      setFeedbackState({ type: 'success', message: 'Feedback submitted successfully. Thank you for your support!' });
      setFeedbackForm({ name: '', email: '', type: 'suggestion', message: '' });
    } catch {
      saveOfflineLead('velismail_feedback_submissions', feedbackForm);
      setFeedbackState({ type: 'info', message: 'Service is currently offline. Feedback saved locally and will sync later.' });
      setFeedbackForm({ name: '', email: '', type: 'suggestion', message: '' });
    } finally {
      setFeedbackSending(false);
    }
  };

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="home animate-page">
      <div className="home-bg-orb orb-1" aria-hidden="true" />
      <div className="home-bg-orb orb-2" aria-hidden="true" />

      <SEO />

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
            <a href="#features" className="nav-link" onClick={closeMobileMenu}>Features</a>
            <a href="#feedback" className="nav-link" onClick={closeMobileMenu}>Community</a>
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

      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="hero-badge">
              <Sparkles size={14} aria-hidden="true" />
              <span>Enterprise Email for the Modern Era</span>
            </div>

            <h1 className="hero-title">
              Business Email
              <span className="gradient-text">Operations Refined.</span>
            </h1>

            <p className="hero-subtitle">
              The next-generation secure communication platform. Built for modern organizations
              with end-to-end encryption, Zero Trust access, and absolute data sovereignty.
            </p>

            <div className="hero-actions">
              <Link to={getDashboardLink()} className="btn btn-primary btn-lg">
                {getDashboardText()} <ArrowRight size={20} aria-hidden="true" />
              </Link>
              <a href="#features" className="btn btn-secondary btn-lg">Explore Features</a>
            </div>

            <div className="hero-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="hero-stat">
                  <div className="stat-icon" aria-hidden="true">
                    <stat.icon size={14} />
                  </div>
                  <div>
                    <span className="stat-value">{stat.value}</span>
                    <span className="stat-label">{stat.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <HomeOpsScene />
        </div>
      </section>

      <div ref={animationRef}>
        <section id="features" className="section animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">Platform Capabilities</span>
              <h2 className="section-title">Engineered for security, built for teams.</h2>
              <p className="section-desc">
                Everything you need to manage business email at scale — from encryption to delivery workflows.
              </p>
            </div>

            <div className="features-grid stagger-children">
              {features.map((f) => (
                <div key={f.title} className="feature-card">
                  <div className="feature-icon-wrap" aria-hidden="true">
                    <f.icon size={22} />
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">Deployment</span>
              <h2 className="section-title">Seamless Integration Process.</h2>
              <p className="section-desc">
                Deploy VelisMail across your entire organization in three simple steps.
              </p>
            </div>

            <div className="steps-grid">
              <div className="step-card">
                <div className="step-number" aria-hidden="true">1</div>
                <h3>Configure Domain</h3>
                <p>Add your business domains and automatically verify DNS settings for SPF, DKIM, and DMARC without leaving the dashboard.</p>
              </div>
              <div className="step-card">
                <div className="step-number" aria-hidden="true">2</div>
                <h3>Provision Users</h3>
                <p>Create mailboxes manually or sync your existing active directory to instantly provision access for your entire team.</p>
              </div>
              <div className="step-card">
                <div className="step-number" aria-hidden="true">3</div>
                <h3>Start Communicating</h3>
                <p>Users log in via secure, passwordless authentication and instantly access their encrypted inbox from any modern browser.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-alt animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">Solutions</span>
              <h2 className="section-title">Built for Modern Organizations.</h2>
            </div>
            <div className="solutions-grid">
              <div className="solution-card">
                <h3>Enterprise Security Teams</h3>
                <p>Enforce strict compliance policies, audit all internal and external communication logs, and mandate zero-trust architecture across all endpoints.</p>
              </div>
              <div className="solution-card">
                <h3>Regulated Industries</h3>
                <p>Perfect for healthcare, finance, and legal sectors where data sovereignty and verifiable end-to-end encryption are legal requirements.</p>
              </div>
              <div className="solution-card">
                <h3>Global Remote Teams</h3>
                <p>Ensure low-latency, highly available communication streams regardless of geographical location, backed by our distributed edge infrastructure.</p>
              </div>
              <div className="solution-card">
                <h3>Rapidly Scaling Startups</h3>
                <p>Grow from 10 to 10,000 employees with instant mailbox provisioning, predictable pricing, and zero on-premise hardware maintenance.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="section animate-on-scroll">
          <div className="container">
            <div className="section-head">
              <span className="section-badge">Support</span>
              <h2 className="section-title">Frequently Asked Questions.</h2>
            </div>

            <div className="faq-list">
              {faqs.map((faq, idx) => (
                <div key={idx} className="faq-item">
                  <button
                    type="button"
                    className="faq-trigger"
                    onClick={() => toggleFaq(idx)}
                    aria-expanded={openFaq === idx}
                    aria-controls={`faq-answer-${idx}`}
                  >
                    <span>{faq.q}</span>
                    <ChevronDown size={20} className="faq-icon" aria-hidden="true" />
                  </button>
                  <div
                    id={`faq-answer-${idx}`}
                    className={`faq-content ${openFaq === idx ? 'open' : ''}`}
                    role="region"
                    aria-hidden={openFaq !== idx}
                  >
                    <p className="faq-answer">{faq.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="feedback" className="feedback-section section-alt animate-on-scroll">
          <div className="container feedback-container">
            <div className="feedback-copy">
              <h2>Building for you.</h2>
              <p>
                VelisMail is shaped by the teams who use it. Your suggestions, bug reports,
                and feature requests go directly to our engineering team.
              </p>
              <div className="feedback-benefits">
                <div className="feedback-benefit">
                  <CheckCircle2 size={20} className="benefit-icon" aria-hidden="true" />
                  <div>
                    <strong>Direct Line</strong>
                    <span>To Developers</span>
                  </div>
                </div>
                <div className="feedback-benefit">
                  <CheckCircle2 size={20} className="benefit-icon" aria-hidden="true" />
                  <div>
                    <strong>Fast Iteration</strong>
                    <span>Weekly Updates</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="feedback-form-card">
              <h3>Share your thoughts</h3>
              {feedbackState && (
                <div className={`inline-alert ${feedbackState.type}`} role="alert">
                  {feedbackState.message}
                </div>
              )}
              <form className="inline-form" onSubmit={handleFeedbackSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label" htmlFor="feedback-name">Your Name</label>
                    <input
                      id="feedback-name"
                      className="input"
                      placeholder="Jane Doe"
                      value={feedbackForm.name}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="feedback-email">Work Email</label>
                    <input
                      id="feedback-email"
                      className="input"
                      type="email"
                      placeholder="jane@company.com"
                      value={feedbackForm.email}
                      onChange={(e) => setFeedbackForm((prev) => ({ ...prev, email: e.target.value }))}
                      required
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="feedback-type">Feedback Type</label>
                  <select
                    id="feedback-type"
                    className="input"
                    value={feedbackForm.type}
                    onChange={(e) => setFeedbackForm((prev) => ({ ...prev, type: e.target.value }))}
                  >
                    <option value="suggestion">Suggestion</option>
                    <option value="bug">Bug Report</option>
                    <option value="feature">Feature Request</option>
                    <option value="praise">General Praise</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="feedback-message">Message</label>
                  <textarea
                    id="feedback-message"
                    className="input"
                    rows={4}
                    placeholder="Tell us what we can do better..."
                    value={feedbackForm.message}
                    onChange={(e) => setFeedbackForm((prev) => ({ ...prev, message: e.target.value }))}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary feedback-submit" disabled={feedbackSending}>
                  {feedbackSending ? 'Submitting...' : 'Submit Feedback'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>

      <footer className="home-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <div className="nav-logo">
                <img src="/ZeeResizer.png" alt="" className="home-logo-img" />
                <span>VelisMail</span>
              </div>
              <p>Securing enterprise communications since 2026. Built for teams that demand privacy, reliability, and control.</p>
            </div>

            <div className="footer-column">
              <h4>Product</h4>
              <div className="footer-link-list">
                <a href="#features" className="footer-link">Features</a>
                <Link to="/pricing" className="footer-link">Pricing</Link>
                <Link to="/status" className="footer-link">Network Status</Link>
                <Link to="/docs" className="footer-link">Documentation</Link>
              </div>
            </div>
            <div className="footer-column">
              <h4>Company</h4>
              <div className="footer-link-list">
                <Link to="/about" className="footer-link">About Us</Link>
                <Link to="/privacy" className="footer-link">Privacy Policy</Link>
                <Link to="/terms" className="footer-link">Terms of Service</Link>
                <Link to="/cookies" className="footer-link">Cookie Policy</Link>
                <Link to="/security" className="footer-link">Security Policy</Link>
              </div>
            </div>
            <div className="footer-column">
              <h4>Connect</h4>
              <div className="footer-link-list">
                <a href="#feedback" className="footer-link">Feedback</a>
                <a href="mailto:support@velismail.online" className="footer-link">Support</a>
              </div>
            </div>
          </div>

          <div className="footer-bottom">
            <p>&copy; 2026 VelisMail. All rights reserved.</p>
            <div className="footer-bottom-links">
              <Link to="/security" className="footer-link">Security</Link>
              <Link to="/aup" className="footer-link">AUP</Link>
              <Link to="/refund" className="footer-link">Refund Policy</Link>
            </div>
          </div>
        </div>
      </footer>

      <button
        type="button"
        className={`scroll-to-top ${showScrollTop ? 'visible' : ''}`}
        onClick={scrollToTop}
        aria-label="Scroll to top"
      >
        <ArrowUp size={20} />
      </button>
    </div>
  );
}
