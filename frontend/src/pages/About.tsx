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
  { year: '2025', event: 'VelisMail founded with a mission to give businesses control of their own email.' },
  { year: '2025', event: 'First prototype of the workspace console with domains, mailboxes and delivery queue.' },
  { year: '2026', event: 'Live DNS verification for SPF, DKIM, DMARC and receiving MX shipped.' },
  { year: '2026', event: 'Multi-tenant architecture, custom domain support and the workspace API shipped.' },
  { year: '2026', event: 'Public launch with Starter, Business and Enterprise plans.' },
];

const values = [
  { icon: Lock, title: 'Data you can see', desc: 'Your workspace lives in your own database, and every change is written to an audit log you can read.' },
  { icon: Users, title: 'Open about limits', desc: 'We describe what the platform does and does not protect, and publish the live status of the API.' },
  { icon: Zap, title: 'Performance', desc: 'The API gateway is built in Rust. We keep the setup checks and the queue fast.' },
  { icon: Globe, title: 'Accessible', desc: 'Every plan includes DNS verification and the queue console. No enterprise contract needed to see your own delivery.' },
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
    if (!user) return '/login?mode=register';
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
                <Link to="/login?mode=register" className="btn btn-primary nav-cta" onClick={closeMobileMenu}>
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
          <h1 className="animate-slide-up">We're building email<br />for the <span className="gradient-text">business era.</span></h1>
          <p className="animate-slide-up stagger-1">
            VelisMail was founded on a simple belief: your email should run on infrastructure you control.
            We put domain setup, mailboxes, the delivery queue and the audit trail in one console —
            backed by your own database and mail provider.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="about-mission">
        <div className="container">
          <div className="mission-grid">
            <div className="mission-text">
              <span className="section-tag">OUR MISSION</span>
              <h2>Giving every business control of its own email.</h2>
              <p>
                Most email platforms keep your domain, your data and your delivery history
                in a black box. We put the records, the queue and the audit log in front of you.
              </p>
              <p>
                VelisMail pairs live DNS verification with a workspace API, so a workspace can be
                set up, automated and reviewed without a support ticket.
              </p>
            </div>
            <div className="mission-stats">
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">4</span>
                <span className="mission-stat-label">DNS records checked live</span>
              </div>
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">5</span>
                <span className="mission-stat-label">Delivery states tracked</span>
              </div>
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">Rust</span>
                <span className="mission-stat-label">API gateway</span>
              </div>
              <div className="glass-card mission-stat">
                <span className="mission-stat-value gradient-text">PostgreSQL</span>
                <span className="mission-stat-label">Workspace storage</span>
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
            <p>Join VelisMail today — setup takes a few minutes once your DNS is ready.</p>
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
              <p>Business email for modern teams.</p>
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
