import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Zap, Globe, Users, ArrowRight, Shield, Award } from 'lucide-react';
import { auth } from '../api/client';
import SiteNav from '../components/site/SiteNav';
import SiteFooter from '../components/site/SiteFooter';
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

  const getDashboardLink = () => {
    if (!user) return '/login?mode=register';
    return '/business';
  };

  return (
    <div className="about-page">
      <SiteNav />

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

      <SiteFooter />
    </div>
  );
}
