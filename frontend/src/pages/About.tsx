import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Zap, Globe, Users, ArrowRight, Shield, Menu, X, Award } from 'lucide-react';
import { auth, isBusinessSetupReady } from '../api/client';
import './About.css';

const operatingPrinciples = [
  { icon: Shield, title: 'Verified information only', desc: 'We keep public company details clean and remove placeholder profiles until they can be verified.' },
  { icon: Lock, title: 'Security-first engineering', desc: 'Every product decision is reviewed through authentication, data handling, and operational safety.' },
  { icon: Award, title: 'User-led roadmap', desc: 'Dashboard polish, mailbox workflows, and reliability fixes are prioritized from real workspace feedback.' },
];

const milestones = [
  { year: '2025', event: 'VelisMail founded with a mission to democratize email privacy.' },
  { year: '2025', event: 'First prototype with end-to-end encryption and workspace recovery controls.' },
  { year: '2026', event: 'Zero-Knowledge Proof authentication system launched.' },
  { year: '2026', event: 'Multi-tenant architecture and custom domain support shipped.' },
  { year: '2026', event: 'Public launch with Starter, Pro, and Enterprise plans.' },
];

const values = [
  { icon: Lock, title: 'Privacy First', desc: 'We engineer our systems so we physically cannot access your data. Privacy is not a feature — it\'s the foundation.' },
  { icon: Users, title: 'Open & Transparent', desc: 'Our encryption protocols are open for audit. We publish transparency reports and maintain an open security model.' },
  { icon: Zap, title: 'Performance', desc: 'Built entirely in Rust for maximum speed and reliability. We obsess over every millisecond.' },
  { icon: Globe, title: 'Accessible', desc: 'Security should not be complicated. We make enterprise-grade protection available to everyone.' },
];

export default function About() {
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
    return '/business';
  };

  const getDashboardText = () => {
    if (!user) return 'Get Started Free';
    return isBusinessSetupReady(user) ? 'Open Dashboard' : 'Continue Setup';
  };

  return (
    <div className="about-page">
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
      <section className="about-hero">
        <div className="about-hero-orb" />
        <div className="container about-hero-inner">
          <span className="section-tag">ABOUT US</span>
          <h1 className="animate-slide-up">We're building email<br />for the <span className="gradient-text">privacy era.</span></h1>
          <p className="animate-slide-up stagger-1">
            VelisMail was founded on a simple belief: your emails are your business — not ours. 
            We built an email platform where even we can't read your messages.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="about-mission">
        <div className="container">
          <div className="mission-grid">
            <div className="mission-text">
              <span className="section-tag">OUR MISSION</span>
              <h2>Making end-to-end encryption the default, not the exception.</h2>
              <p>
                Big tech companies have built their email empires by mining your data. 
                We believe there's a better way — one where your inbox is truly yours.
              </p>
              <p>
                VelisMail combines cutting-edge cryptography with modern design to create 
                an email experience that's both incredibly secure and delightfully simple to use.
                Our Zero-Knowledge architecture means our servers never see your plaintext data.
              </p>
            </div>
            <div className="mission-stats">
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">0</span>
                <span className="mission-stat-label">Data breaches. Ever.</span>
              </div>
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">256-bit</span>
                <span className="mission-stat-label">AES encryption standard</span>
              </div>
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">100%</span>
                <span className="mission-stat-label">Open-source protocols</span>
              </div>
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">Rust</span>
                <span className="mission-stat-label">Built from the ground up</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="about-values">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">OUR VALUES</span>
            <h2>What drives us</h2>
          </div>
          <div className="values-grid">
            {values.map((v, i) => (
              <div key={i} className="glass-card value-card">
                <div className="value-icon">
                  <v.icon size={24} />
                </div>
                <h3>{v.title}</h3>
                <p>{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Operating Principles */}
      <section className="about-team">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">HOW WE WORK</span>
            <h2>Built with verified trust</h2>
            <p>Our core operating pillars ensure your business mail operations are always secure, fast, and completely private.</p>
          </div>
          <div className="team-grid">
            {operatingPrinciples.map((item, i) => (
              <div key={i} className="glass-card team-card">
                <div className="team-avatar"><item.icon size={24} /></div>
                <h3>{item.title}</h3>
                <span className="team-role">VelisMail Standard</span>
                <p>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="about-timeline">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">OUR JOURNEY</span>
            <h2>Milestones</h2>
          </div>
          <div className="timeline">
            {milestones.map((m, i) => (
              <div key={i} className="timeline-item">
                <div className="timeline-dot" />
                <div className="timeline-content glass-card">
                  <span className="timeline-year">{m.year}</span>
                  <p>{m.event}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="about-cta">
        <div className="container">
          <div className="glass about-cta-box">
            <h2>Ready to experience truly private email?</h2>
            <p>Join VelisMail today — it takes less than 30 seconds.</p>
            <Link to={getDashboardLink()} className="btn btn-primary btn-lg">
              {user ? 'Go to Dashboard' : 'Get Started Free'} <ArrowRight size={20} />
            </Link>
          </div>
        </div>
      </section>

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
