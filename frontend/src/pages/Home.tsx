import { Link } from 'react-router-dom';
import {
  Lock, Zap, Globe, ArrowRight, CheckCircle2,
  Fingerprint, Eye, Server, Star, ChevronRight
} from 'lucide-react';
import { auth } from '../api/client';
import './Home.css';

const features = [
  {
    icon: Lock,
    title: 'Military-Grade Encryption',
    desc: 'Every message is quantum-resistant encrypted before transmission. Absolute data confidentiality.',
    color: '#4f46e5',
  },
  {
    icon: Fingerprint,
    title: 'Zero Trust Authentication',
    desc: 'Passwordless enterprise access via passkeys and biometric validation. Eliminate phishing vectors.',
    color: '#06b6d4',
  },
  {
    icon: Eye,
    title: 'Zero-Knowledge Auditing',
    desc: 'Cryptographic proof of compliance without exposing raw data to administrators. True privacy by design.',
    color: '#f472b6',
  },
  {
    icon: Server,
    title: 'Multi-Tenant Architecture',
    desc: 'Isolated workspaces for every organization. Enterprise-grade data separation.',
    color: '#facc15',
  },
  {
    icon: Zap,
    title: 'High-Velocity Delivery',
    desc: 'Powered by distributed Rust microservices. Millisecond latency routing across our global edge network.',
    color: '#f59e0b',
  },
  {
    icon: Globe,
    title: 'Automated Domain Integrity',
    desc: 'One-click DKIM, SPF, and DMARC enforcement to guarantee email deliverability and brand protection.',
    color: '#3b82f6',
  },
];

const plans = [
  {
    name: 'Starter',
    price: 'Free',
    period: '',
    desc: 'For individuals getting started',
    features: ['5 GB storage', 'End-to-end encryption', 'Passkey authentication', 'Single custom domain', 'Community support'],
    cta: 'Get Started Free',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '₹499',
    period: '/month',
    desc: 'For professionals and teams',
    features: ['50 GB storage', 'Everything in Starter', 'Unlimited custom domains', 'Priority delivery engine', 'Email rules & filters', 'API access', 'Priority support'],
    cta: 'Start Pro Trial',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'For organizations at scale',
    features: ['Unlimited storage', 'Everything in Pro', 'SSO / SAML integration', 'Dedicated infrastructure', 'Custom SLA', 'Admin console', '24/7 support'],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

const testimonials = [
  { name: 'Ananya Rao', role: 'CTO, SecureStack', text: 'VelisMail is the only email provider our security team trusts. The ZKP architecture is years ahead of the competition.' },
  { name: 'David Chen', role: 'Founder, CloudOps', text: 'We switched from Gmail and never looked back. The encryption is seamless and performance is incredible.' },
  { name: 'Meera Gupta', role: 'CISO, FinTech Corp', text: 'Finally, an email service that takes privacy seriously without compromising on user experience.' },
];

export default function Home() {
  const user = auth.getSession();

  const getDashboardLink = () => {
    if (!user) return '/login';
    return user.isBusinessSetupComplete ? '/business' : '/business-setup';
  };

  const getDashboardText = () => {
    if (!user) return '';
    return user.isBusinessSetupComplete ? 'Dashboard' : 'Setup';
  };

  return (
    <div className="home">
      {/* Navigation */}
      <nav className="home-nav">
        <div className="container nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" className="logo-img" alt="ZeeResizer" />
            <span className="logo-text">VelisMail</span>
          </Link>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <Link to="/about">About</Link>
            {user ? (
              <Link to={getDashboardLink()} className="btn btn-primary btn-sm">{getDashboardText()}</Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">Log In</Link>
                <Link to="/login" className="btn btn-primary btn-sm">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-bg-orb hero-orb-1" />
        <div className="hero-bg-orb hero-orb-2" />
        <div className="hero-bg-orb hero-orb-3" />
        <div className="container hero-content">
          <div className="hero-badge animate-slide-up">
            <Zap size={14} />
            <span>Powered by Rust & Zero-Knowledge Proofs</span>
          </div>
          <h1 className="hero-title animate-slide-up stagger-1">
            Enterprise Email,<br />
            <span className="gradient-text">Uncompromised.</span>
          </h1>
          <p className="hero-subtitle animate-slide-up stagger-2">
            The next-generation secure communication platform. Built for modern organizations
            with end-to-end encryption, Zero Trust access, and absolute data sovereignty.
          </p>
          <div className="hero-actions animate-slide-up stagger-3">
            {user ? (
              <Link to={getDashboardLink()} className="btn btn-primary btn-lg">
                Go to {getDashboardText()} <ArrowRight size={20} />
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary btn-lg">
                Start for Free <ArrowRight size={20} />
              </Link>
            )}
            <a href="#features" className="btn btn-secondary btn-lg">
              Explore Features
            </a>
          </div>
          <div className="hero-stats animate-slide-up stagger-4">
            <div className="stat">
              <span className="stat-value">256-bit</span>
              <span className="stat-label">AES Encryption</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value">99.99%</span>
              <span className="stat-label">Uptime SLA</span>
            </div>
            <div className="stat-divider" />
            <div className="stat">
              <span className="stat-value">&lt;50ms</span>
              <span className="stat-label">Delivery Speed</span>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section" id="features">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">FEATURES</span>
            <h2>Built for the security-first era</h2>
            <p>Every feature engineered with privacy and performance as the default, not an afterthought.</p>
          </div>
          <div className="features-grid">
            {features.map((f, i) => (
              <div key={i} className="glass-card feature-card animate-slide-up" style={{ animationDelay: `${i * 0.08}s`, opacity: 0 }}>
                <div className="feature-icon" style={{ background: `${f.color}15`, color: f.color }}>
                  <f.icon size={24} />
                </div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="how-section">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">HOW IT WORKS</span>
            <h2>Security without friction</h2>
            <p>Three simple steps to the most secure inbox you've ever used.</p>
          </div>
          <div className="steps-grid">
            <div className="step-card glass-card">
              <div className="step-number">01</div>
              <h3>Create Your Identity</h3>
              <p>Register with a passkey. No password needed — just your biometric or device PIN.</p>
            </div>
            <div className="step-arrow"><ChevronRight size={24} /></div>
            <div className="step-card glass-card">
              <div className="step-number">02</div>
              <h3>Keys Are Generated</h3>
              <p>Your encryption keys are created on your device. We never see or store them.</p>
            </div>
            <div className="step-arrow"><ChevronRight size={24} /></div>
            <div className="step-card glass-card">
              <div className="step-number">03</div>
              <h3>Send & Receive Securely</h3>
              <p>All emails are encrypted end-to-end. Only you and your recipient can read them.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="pricing-section" id="pricing">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">PRICING</span>
            <h2>Plans for every scale</h2>
            <p>Start free, scale when you're ready. No hidden fees.</p>
          </div>
          <div className="pricing-grid">
            {plans.map((plan, i) => (
              <div key={i} className={`glass-card pricing-card ${plan.highlighted ? 'pricing-highlighted' : ''}`}>
                {plan.highlighted && <div className="pricing-badge">Most Popular</div>}
                <h3>{plan.name}</h3>
                <div className="pricing-price">
                  <span className="price-value">{plan.price}</span>
                  {plan.period && <span className="price-period">{plan.period}</span>}
                </div>
                <p className="pricing-desc">{plan.desc}</p>
                <ul className="pricing-features">
                  {plan.features.map((f, j) => (
                    <li key={j}><CheckCircle2 size={16} /> {f}</li>
                  ))}
                </ul>
                <Link to="/login" className={`btn ${plan.highlighted ? 'btn-primary' : 'btn-secondary'} w-full`}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="testimonials-section">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">TESTIMONIALS</span>
            <h2>Trusted by security leaders</h2>
          </div>
          <div className="testimonials-grid">
            {testimonials.map((t, i) => (
              <div key={i} className="glass-card testimonial-card">
                <div className="testimonial-stars">
                  {[...Array(5)].map((_, j) => <Star key={j} size={16} fill="#facc15" color="#facc15" />)}
                </div>
                <p className="testimonial-text">"{t.text}"</p>
                <div className="testimonial-author">
                  <div className="testimonial-avatar">{t.name.charAt(0)}</div>
                  <div>
                    <div className="testimonial-name">{t.name}</div>
                    <div className="testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-box glass">
            <h2>Ready to take control of your inbox?</h2>
            <p>Join thousands of privacy-conscious professionals using VelisMail.</p>
            <Link to="/login" className="btn btn-primary btn-lg">
              Get Started Free <ArrowRight size={20} />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="home-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <Link to="/" className="nav-logo">
              <img src="/ZeeResizer.png" className="logo-img" alt="ZeeResizer" />
              <span className="logo-text">VelisMail</span>
            </Link>
            <p>Secure email for the modern world.</p>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <h4>Product</h4>
              <a href="#features">Features</a>
              <a href="#pricing">Pricing</a>
              <Link to="/about">About</Link>
            </div>
            <div className="footer-col">
              <h4>Legal</h4>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
              <Link to="/cookies">Cookie Policy</Link>
              <Link to="/aup">Acceptable Use</Link>
              <Link to="/security">Security</Link>
              <Link to="/refund">Refund Policy</Link>
            </div>
            <div className="footer-col">
              <h4>Support</h4>
              <Link to="/docs">Documentation</Link>
              <Link to="/contacts">Contact Us</Link>
              <Link to="/status">Status Page</Link>
            </div>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 VelisMail. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
