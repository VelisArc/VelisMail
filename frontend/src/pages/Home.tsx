import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
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
  MessageSquare,
  Server,
  Shield,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { auth, fetchApiResponse } from '../api/client';
import './Home.css';

const features = [
  {
    icon: Lock,
    title: 'End-to-end encrypted mail flow',
    desc: 'Protect messages in transit and at rest with secure delivery defaults, strict policy controls, and resilient infrastructure.',
  },
  {
    icon: Fingerprint,
    title: 'Passwordless business access',
    desc: 'Use passkeys, modern recovery flows, and controlled workspace access for teams without weak shared credentials.',
  },
  {
    icon: Globe,
    title: 'Domain reputation management',
    desc: 'Ship with SPF, DKIM, DMARC, queue monitoring, and verification tooling that keeps deliverability healthy.',
  },
  {
    icon: Server,
    title: 'Operational visibility',
    desc: 'Track queue health, audit activity, templates, sender identities, and domain readiness from one business console.',
  },
  {
    icon: Shield,
    title: 'Compliance-ready controls',
    desc: 'Support regulated teams with clear activity records, mailbox governance, and data-sovereignty-friendly architecture.',
  },
  {
    icon: Database,
    title: 'Bring your own infrastructure',
    desc: 'Connect your database and provider stack while keeping operational workflows centralized inside the VelisMail workspace.',
  },
];

const stats = [
  { value: '256-bit', label: 'Encryption', icon: Key },
  { value: '99.99%', label: 'Uptime SLA', icon: Cloud },
  { value: '<50ms', label: 'Routing', icon: Zap },
];

type SubmissionState = {
  type: 'success' | 'info' | 'error';
  message: string;
} | null;

function saveOfflineLead(key: string, payload: Record<string, string>) {
  const existing = JSON.parse(localStorage.getItem(key) || '[]') as Array<Record<string, string>>;
  existing.unshift({
    ...payload,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 25)));
}

export default function Home() {
  const [user] = useState(auth.getSession());
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [feedbackForm, setFeedbackForm] = useState({ name: '', email: '', type: 'suggestion', message: '' });
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackState, setFeedbackState] = useState<SubmissionState>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const getDashboardLink = () => {
    if (!user) return '/login';
    return user.isBusinessSetupComplete ? '/business' : '/business-setup';
  };

  const getDashboardText = () => {
    if (!user) return 'Get Started Free';
    return user.isBusinessSetupComplete ? 'Open Dashboard' : 'Continue Setup';
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackSending(true);
    setFeedbackState(null);
    try {
      await fetchApiResponse('/feedback', {
        method: 'POST',
        body: JSON.stringify(feedbackForm),
      });
      setFeedbackState({
        type: 'success',
        message: 'Feedback submitted successfully. Thank you for your support!',
      });
      setFeedbackForm({ name: '', email: '', type: 'suggestion', message: '' });
    } catch {
      saveOfflineLead('velismail_feedback_submissions', feedbackForm);
      setFeedbackState({
        type: 'info',
        message: 'Service is currently offline. Feedback saved locally and will sync later.',
      });
      setFeedbackForm({ name: '', email: '', type: 'suggestion', message: '' });
    } finally {
      setFeedbackSending(false);
    }
  };

  return (
    <div className="home animate-page">
      <div className="home-bg-orb orb-1" />
      <div className="home-bg-orb orb-2" />

      {/* --- Header & Nav --- */}
      <nav className={`home-nav ${scrolled ? 'nav-scrolled' : ''}`}>
        <div className="nav-inner">
          <Link to="/" className="nav-logo" onClick={closeMobileMenu}>
            <img src="/ZeeResizer.png" alt="VelisMail" className="home-logo-img" />
            <span className="logo-text">VelisMail</span>
          </Link>

          <button
            type="button"
            className="nav-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>

          <div className={`nav-links ${mobileMenuOpen ? 'open' : ''}`}>
            <a href="#features" className="nav-link" onClick={closeMobileMenu}>Features</a>
            <a href="#feedback" className="nav-link" onClick={closeMobileMenu}>Community</a>
            <Link to="/about" className="nav-link" onClick={closeMobileMenu}>About</Link>
            <div className="nav-divider" />
            {!user ? (
              <>
                <Link to="/login" className="nav-link" onClick={closeMobileMenu}>Log In</Link>
                <Link to="/login" className="btn btn-primary nav-cta" onClick={closeMobileMenu}>
                  Get Started Free
                </Link>
              </>
            ) : (
              <Link to={getDashboardLink()} className="btn btn-primary nav-cta" onClick={closeMobileMenu}>
                {getDashboardText()}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* --- Hero Section --- */}
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="hero-badge animate-fadeIn">
              <Sparkles size={14} />
              <span>Enterprise Email for the Modern Era</span>
            </div>

            <h1 className="hero-title animate-fadeIn">
              Business Email <span>Operations Refined.</span>
            </h1>

            <p className="hero-subtitle animate-fadeIn" style={{ animationDelay: '0.1s' }}>
              The next-generation secure communication platform. Built for modern organizations 
              with end-to-end encryption, Zero Trust access, and absolute data sovereignty.
            </p>

            <div className="hero-actions animate-fadeIn" style={{ animationDelay: '0.2s' }}>
              <Link to={getDashboardLink()} className="btn btn-primary">
                {getDashboardText()} <ArrowRight size={18} />
              </Link>
              <a href="#features" className="btn btn-secondary">Explore Features</a>
            </div>

            <div className="hero-proof-row animate-fadeIn" style={{ animationDelay: '0.3s' }}>
              {stats.map((stat) => (
                <div key={stat.label} className="hero-proof-card">
                  <div className="feature-icon-wrap" style={{ width: 32, height: 32, marginBottom: 0 }}>
                    <stat.icon size={14} />
                  </div>
                  <div>
                    <strong>{stat.value}</strong>
                    <span>{stat.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* --- Features Grid --- */}
      <section id="features" className="features-section">
        <div className="container">
          <div className="section-head">
            <span className="section-badge">Platform Capabilities</span>
            <h2 className="section-title">Engineered for security, built for teams.</h2>
          </div>

          <div className="features-grid">
            {features.map((f, i) => (
              <div key={f.title} className="feature-card glass-card animate-fadeIn" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="feature-icon-wrap">
                  <f.icon size={24} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Feedback & Community Section --- */}
      <section id="feedback" className="feedback-section">
        <div className="container feedback-container">
          <div className="feedback-copy">
            <h2>Building for you.</h2>
            <p>
              VelisMail is shaped by the teams who use it. Your suggestions, bug reports, 
              and feature requests go directly to our engineering team.
            </p>
            <div className="flex" style={{ gap: 20, marginTop: 40 }}>
              <div className="hero-proof-card">
                <CheckCircle2 size={20} className="text-primary" />
                <div>
                  <strong>Direct Line</strong>
                  <span>To Developers</span>
                </div>
              </div>
              <div className="hero-proof-card">
                <CheckCircle2 size={20} className="text-primary" />
                <div>
                  <strong>Fast Iteration</strong>
                  <span>Weekly Updates</span>
                </div>
              </div>
            </div>
          </div>

          <div className="feedback-form-card glass-card">
            <h3>Share your thoughts</h3>
            {feedbackState && (
              <div className={`inline-alert ${feedbackState.type}`} style={{ marginBottom: 20, padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.05)', fontSize: '0.9rem' }}>
                {feedbackState.message}
              </div>
            )}
            <form className="inline-form" onSubmit={handleFeedbackSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Your Name</label>
                  <input
                    className="input"
                    placeholder="Jane Doe"
                    value={feedbackForm.name}
                    onChange={(e) => setFeedbackForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Work Email</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="jane@company.com"
                    value={feedbackForm.email}
                    onChange={(e) => setFeedbackForm((prev) => ({ ...prev, email: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Feedback Type</label>
                <select
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
                <label>Message</label>
                <textarea
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

      {/* --- Footer --- */}
      <footer className="home-footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-brand">
              <div className="nav-logo">
                <img src="/ZeeResizer.png" alt="VelisMail" className="home-logo-img" />
                <span>VelisMail</span>
              </div>
              <span>Securing enterprise communications since 2026.</span>
            </div>
            
            <div className="footer-links-grid">
              <div className="footer-column">
                <h4>Product</h4>
                <div className="footer-link-list">
                  <a href="#features" className="footer-link">Features</a>
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
                </div>
              </div>
              <div className="footer-column">
                <h4>Community</h4>
                <div className="footer-link-list">
                  <a href="#feedback" className="footer-link">Feedback</a>
                  <a href="mailto:support@velismail.online" className="footer-link">Support</a>
                </div>
              </div>
            </div>
          </div>
          
          <div className="footer-bottom">
            <p>© 2026 VelisMail — Redesigned for the future of business mail.</p>
            <div className="flex" style={{ gap: 24 }}>
              <Link to="/security" className="footer-link">Security</Link>
              <Link to="/aup" className="footer-link">AUP</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
