import { Link } from 'react-router-dom';
import { Lock, Zap, Globe, Users, ArrowRight, Shield } from 'lucide-react';
import './About.css';

const team = [
  { name: 'Mangal Patel', role: 'Founder & CEO', bio: 'Building the future of secure communication.' },
  { name: 'Priya Sharma', role: 'Head of Engineering', bio: 'Rust enthusiast. Distributed systems architect.' },
  { name: 'Rahul Dev', role: 'Lead Cryptographer', bio: 'PhD in Applied Cryptography. ZKP researcher.' },
  { name: 'Ananya Rao', role: 'Head of Design', bio: 'Making security beautiful and accessible.' },
];

const milestones = [
  { year: '2025', event: 'VelisMail founded with a mission to democratize email privacy.' },
  { year: '2025', event: 'First prototype with end-to-end encryption and passkey auth.' },
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
  return (
    <div className="about-page">
      {/* Nav */}
      <nav className="about-nav">
        <div className="container about-nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '24px', width: 'auto' }} />
            <span className="logo-text">VelisMail</span>
          </Link>
          <div className="about-nav-links">
            <Link to="/">Home</Link>
            <Link to="/login" className="btn btn-primary btn-sm">Get Started</Link>
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

      {/* Team */}
      <section className="about-team">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">THE TEAM</span>
            <h2>People behind VelisMail</h2>
            <p>A small team with big ambitions for privacy.</p>
          </div>
          <div className="team-grid">
            {team.map((member, i) => (
              <div key={i} className="glass-card team-card">
                <div className="team-avatar">{member.name.split(' ').map(n => n[0]).join('')}</div>
                <h3>{member.name}</h3>
                <span className="team-role">{member.role}</span>
                <p>{member.bio}</p>
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
            <Link to="/login" className="btn btn-primary btn-lg">
              Get Started Free <ArrowRight size={20} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="about-footer">
        <div className="container about-footer-inner">
          <div className="about-footer-brand">
            <div className="nav-logo">
              <div className="logo-mark"><Shield size={16} /></div>
              <span className="logo-text">VelisMail</span>
            </div>
            <p>Secure email for the modern world.</p>
          </div>
          <div className="about-footer-links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/cookies">Cookie Policy</Link>
            <Link to="/aup">Acceptable Use</Link>
            <Link to="/security">Security</Link>
            <Link to="/refund">Refund Policy</Link>
            <Link to="/">Home</Link>
          </div>
        </div>
        <div className="container about-footer-bottom">
          <span>© 2026 VelisMail. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
