import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Lock, Zap, Globe, ArrowRight,
  Fingerprint, Eye, Server,
  Shield, Key, Cloud, Database
} from 'lucide-react';
import { auth } from '../api/client';
import { fetchApiResponse } from '../api/client';
import './Home.css';

const features = [
  {
    icon: Lock,
    title: 'Military-Grade Encryption',
    desc: 'Every message is quantum-resistant encrypted before transmission. Absolute data confidentiality with AES-256 encryption.',
  },
  {
    icon: Fingerprint,
    title: 'Zero Trust Authentication',
    desc: 'Passwordless enterprise access via passkeys and biometric validation. Eliminate phishing vectors completely.',
  },
  {
    icon: Eye,
    title: 'Zero-Knowledge Auditing',
    desc: 'Cryptographic proof of compliance without exposing raw data to administrators. True privacy by design.',
  },
  {
    icon: Server,
    title: 'Multi-Tenant Architecture',
    desc: 'Isolated workspaces for every organization. Enterprise-grade data separation and security boundaries.',
  },
  {
    icon: Zap,
    title: 'High-Velocity Delivery',
    desc: 'Powered by distributed Rust microservices. Millisecond latency routing across our global edge network.',
  },
  {
    icon: Globe,
    title: 'Automated Domain Integrity',
    desc: 'One-click DKIM, SPF, and DMARC enforcement to guarantee email deliverability and brand protection.',
  },
  {
    icon: Shield,
    title: 'Advanced Threat Protection',
    desc: 'Real-time malware scanning, phishing detection, and advanced threat intelligence integration.',
  },
  {
    icon: Database,
    title: 'Bring Your Own Database',
    desc: 'Connect your own PostgreSQL or MySQL database for complete data sovereignty. No vendor lock-in, full portability.',
  }
];

const stats = [
  { value: '256-bit', label: 'AES Encryption', icon: Key },
  { value: '99.99%', label: 'Uptime SLA', icon: Cloud },
  { value: '<50ms', label: 'Delivery Speed', icon: Zap },
  { value: 'Zero', label: 'Data Breaches', icon: Shield }
];

export default function Home() {
  const [user] = useState(auth.getSession());
  const [scrolled, setScrolled] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', company: '', message: '' });
  const [feedbackForm, setFeedbackForm] = useState({ name: '', email: '', type: 'suggestion', message: '' });
  const [contactSending, setContactSending] = useState(false);
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [contactSuccess, setContactSuccess] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const getDashboardLink = () => {
    if (!user) return '/login';
    return user.isBusinessSetupComplete ? '/business' : '/business-setup';
  };

  const getDashboardText = () => {
    if (!user) return '';
    return user.isBusinessSetupComplete ? 'Dashboard' : 'Setup';
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSending(true);
    try {
      await fetchApiResponse('/contact/sales', {
        method: 'POST',
        body: JSON.stringify(contactForm),
      });
    } catch {
      // Fallback: open mailto if API is unreachable
      const subject = encodeURIComponent(`Enterprise Inquiry from ${contactForm.company || contactForm.name}`);
      const body = encodeURIComponent(`Name: ${contactForm.name}\nEmail: ${contactForm.email}\nCompany: ${contactForm.company}\n\n${contactForm.message}`);
      window.open(`mailto:enterprise@velismail.online?subject=${subject}&body=${body}`, '_blank');
    }
    setContactSending(false);
    setContactSuccess(true);
    setTimeout(() => {
      setContactSuccess(false);
      setShowContactModal(false);
      setContactForm({ name: '', email: '', company: '', message: '' });
    }, 2500);
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedbackSending(true);
    try {
      await fetchApiResponse('/feedback', {
        method: 'POST',
        body: JSON.stringify(feedbackForm),
      });
    } catch {
      const subject = encodeURIComponent(`Feedback (${feedbackForm.type}) from ${feedbackForm.name}`);
      const body = encodeURIComponent(`Name: ${feedbackForm.name}\nEmail: ${feedbackForm.email}\nType: ${feedbackForm.type}\n\n${feedbackForm.message}`);
      window.open(`mailto:feedback@velismail.online?subject=${subject}&body=${body}`, '_blank');
    }
    setFeedbackSending(false);
    setFeedbackSuccess(true);
    setTimeout(() => {
      setFeedbackSuccess(false);
      setShowFeedbackModal(false);
      setFeedbackForm({ name: '', email: '', type: 'suggestion', message: '' });
    }, 2500);
  };

  return (
    <div className="home animate-page">
      {/* Navigation */}
      <nav className={`home-nav ${scrolled ? 'nav-scrolled' : ''}`}>
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '24px', width: 'auto' }} />
            <span className="logo-text">VelisMail</span>
          </Link>
          <div className="nav-links">
            <a href="#features" className="nav-link">Features</a>
            <a href="#pricing" className="nav-link">Pricing</a>
            <Link to="/about" className="nav-link">About</Link>
            {user ? (
              <Link to={getDashboardLink()} className="btn btn-primary">
                {getDashboardText()}
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-secondary btn-sm">Log In</Link>
                <Link to="/login" className="btn btn-primary btn-sm">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <Zap size={12} />
            <span>Powered by Rust & Zero-Knowledge Proofs</span>
          </div>
          
          <h1 className="hero-title">
            Enterprise Email,
            <span style={{ display: 'block' }}>Uncompromised.</span>
          </h1>
          
          <p className="hero-subtitle">
            The next-generation secure communication platform. Built for modern organizations
            with end-to-end encryption, Zero Trust access, and absolute data sovereignty.
          </p>
          
          <div className="hero-actions">
            {user ? (
              <Link to={getDashboardLink()} className="btn btn-primary">
                Go to {getDashboardText()} <ArrowRight size={18} />
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary">
                Go to Setup <ArrowRight size={18} />
              </Link>
            )}
            <a href="#features" className="btn btn-secondary">
              Explore Features
            </a>
          </div>
          
          <div className="hero-stats">
            {stats.map((stat, index) => (
              <div key={index} className="stat">
                <span className="stat-value">{stat.value}</span>
                <span className="stat-label">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features" id="features">
        <div className="container">
          <div className="section-header">
            <span className="section-tag">ENTERPRISE FEATURES</span>
            <h2 className="section-title">Built for the security-first era</h2>
            <p className="section-subtitle">
              Every feature engineered with privacy and performance as the default, not an afterthought.
            </p>
          </div>
          
          <div className="features-grid">
            {features.map((feature, index) => (
              <div key={index} className="feature-card">
                <div className="feature-icon">
                  <feature.icon size={18} />
                </div>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-description">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SEO Section: Deep Dive into Enterprise Security */}
      <section className="seo-content-block">
        <div className="container">
          <div className="seo-grid">
            <div className="seo-text-content">
              <h2>The Most Secure Business Email Hosting Solution</h2>
              <p>
                In today's threat landscape, standard email protocols are insufficient for enterprise security. VelisMail provides a <strong>zero-trust business email hosting solution</strong> engineered with military-grade encryption, ensuring that your corporate communications remain absolutely confidential. Whether you're managing sensitive financial data, healthcare records, or intellectual property, our platform guarantees that only authorized recipients can decrypt your messages.
              </p>
              <h3>End-to-End Encryption & Data Sovereignty</h3>
              <p>
                Unlike legacy providers that hold your encryption keys, VelisMail operates on a strict zero-knowledge architecture. This means our servers cannot read your emails, and a data breach on our end would yield nothing but cryptographically secure ciphertexts. We comply with GDPR, HIPAA, and strict European data sovereignty laws by isolating your organization's data in dedicated multi-tenant vaults.
              </p>
              <h3>Protection Against Phishing and Ransomware</h3>
              <p>
                Business Email Compromise (BEC) costs enterprises billions annually. We mitigate this through hardware-backed passkeys, biometric authentication, and strict enforcement of DMARC, SPF, and DKIM protocols. By locking down your domain reputation and rejecting unauthenticated spoofing attempts, VelisMail ensures your brand's integrity remains uncompromised.
              </p>
            </div>
            <div className="seo-text-content">
              <h2>Why Migrate from Legacy Email Providers?</h2>
              <p>
                Migrating your enterprise email to VelisMail means transitioning from a vulnerable, heavily-targeted legacy system to a quantum-resistant infrastructure. 
              </p>
              <ul>
                <li><strong>Cryptographic Proofs:</strong> We use Zero-Knowledge Proofs (ZKP) to authenticate users without ever transmitting passwords over the network.</li>
                <li><strong>Instant Delivery:</strong> Built on Rust, our edge network routes emails globally with sub-50ms latency.</li>
                <li><strong>Absolute Control:</strong> Custom alias mailboxes, detailed audit logs, and granular team access controls give IT administrators unprecedented visibility.</li>
              </ul>
              <h3>Seamless Onboarding & Domain Management</h3>
              <p>
                Setting up a secure email infrastructure usually takes days of DNS configuration and MX record propagation. Our automated setup wizard scans your DNS records in real-time, verifying your MX, TXT, and SPF records instantly. With direct integrations for major registrars, your business can be up and running with secure, encrypted email in under 5 minutes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SEO Section: Technical Architecture */}
      <section className="seo-content-block" style={{ background: 'var(--bg-surface-2)' }}>
        <div className="container">
          <div className="seo-grid">
            <div className="seo-text-content">
              <h2>Engineered with Rust for Sub-Millisecond Latency</h2>
              <p>
                The foundation of our secure business email hosting platform is written entirely in <strong>Rust</strong>. Legacy email providers rely on decades-old C and C++ codebases, which are notoriously vulnerable to memory safety exploits like buffer overflows. By utilizing Rust's strict compiler guarantees, VelisMail eliminates entire classes of security vulnerabilities at the source code level.
              </p>
              <h3>Global Edge Network & SMTP Routing</h3>
              <p>
                Our proprietary SMTP/IMAP routing engine operates on a globally distributed edge network. This allows for intelligent, geo-routed email delivery that bypasses traditional network bottlenecks. Whether your enterprise team is operating in Tokyo, London, or New York, our infrastructure guarantees inbound and outbound email delivery speeds of under 50 milliseconds.
              </p>
            </div>
            <div className="seo-text-content">
              <h2>Automated Domain Reputation Management</h2>
              <p>
                Email deliverability is critical for modern business operations. If your corporate emails are landing in the spam folder, your communication breaks down. VelisMail automates the complex process of domain reputation management.
              </p>
              <ul>
                <li><strong>SPF (Sender Policy Framework):</strong> Cryptographically authorize our IPs to send on your behalf.</li>
                <li><strong>DKIM (DomainKeys Identified Mail):</strong> Every outgoing message is signed with a unique 2048-bit RSA key.</li>
                <li><strong>DMARC Enforcement:</strong> Instantly reject spoofing and phishing attempts using your corporate identity.</li>
              </ul>
              <p>
                Our live DNS dashboard continuously monitors your domain health, alerting you instantly if your DNS records degrade or if third-party providers attempt to intercept your traffic.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SEO Section: FAQ */}
      <section className="faq-section">
        <div className="container">
          <h2 className="section-title text-center">Frequently Asked Questions</h2>
          <div className="faq-grid">
            <div className="faq-item">
              <h3>What makes VelisMail different from standard email?</h3>
              <p>VelisMail is a zero-knowledge, zero-trust enterprise email provider. We use end-to-end encryption and advanced routing to ensure that nobody—not even our system administrators—can read your corporate communications.</p>
            </div>
            <div className="faq-item">
              <h3>Can I use my own custom domain?</h3>
              <p>Yes. Our platform is built specifically for custom domains. You can easily link your business domain, configure your DNS (MX, SPF, DKIM, DMARC), and start sending professional, branded emails immediately.</p>
            </div>
            <div className="faq-item">
              <h3>Is the platform compliant with data regulations?</h3>
              <p>Absolutely. Because of our strict zero-knowledge architecture, VelisMail helps your organization easily comply with HIPAA, GDPR, SOC2, and other strict data privacy regulations by guaranteeing data sovereignty.</p>
            </div>
            <div className="faq-item">
              <h3>How does the Zero-Trust Authentication work?</h3>
              <p>Instead of vulnerable passwords, we support modern WebAuthn protocols like Passkeys and biometric authentication. This mathematically eliminates the risk of credential stuffing and phishing attacks.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="features" id="pricing" style={{ background: 'var(--bg-surface)' }}>
        <div className="container">
          <div className="section-header">
            <span className="section-tag">PRICING</span>
            <h2 className="section-title">Simple, Usage-Based Plans</h2>
            <p className="section-subtitle">
              Connect your own database. Pay only for sending capacity, traffic, and concurrent connections.
            </p>
          </div>

          <div className="features-grid" style={{ maxWidth: '960px' }}>
            {/* Starter */}
            <div className="feature-card" style={{ textAlign: 'left' }}>
              <div className="feature-icon" style={{ marginBottom: '12px' }}><Zap size={20} /></div>
              <h3 className="feature-title">Starter</h3>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: '8px 0' }}>Free</div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>For individuals and small projects</p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '8px' }}>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ 100 emails / day</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ 1 custom domain</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ 5 concurrent connections</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ BYOD — Your own database</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Basic DNS verification</li>
              </ul>
              <Link to="/login" className="btn btn-secondary" style={{ width: '100%', marginTop: '20px', textAlign: 'center' }}>Get Started</Link>
            </div>

            {/* Business */}
            <div className="feature-card" style={{ textAlign: 'left', border: '1px solid var(--accent)', position: 'relative' }}>
              <span style={{ position: 'absolute', top: '-10px', right: '12px', background: 'var(--accent)', color: '#000', fontSize: '0.7rem', fontWeight: 700, padding: '2px 10px', borderRadius: '100px' }}>POPULAR</span>
              <div className="feature-icon" style={{ marginBottom: '12px' }}><Globe size={20} /></div>
              <h3 className="feature-title">Business</h3>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: '8px 0' }}>₹2,499<span style={{ fontSize: '0.9rem', fontWeight: 400, color: 'var(--text-muted)' }}>/mo</span></div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>For growing teams and businesses</p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '8px' }}>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ 10,000 emails / day</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ 5 custom domains</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ 50 concurrent connections</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ BYOD — Your own database</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Advanced DNS + DKIM/DMARC</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Team management (up to 25)</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Priority email routing</li>
              </ul>
              <Link to="/login" className="btn btn-primary" style={{ width: '100%', marginTop: '20px', textAlign: 'center' }}>Start Business Plan</Link>
            </div>

            {/* Enterprise */}
            <div className="feature-card" style={{ textAlign: 'left' }}>
              <div className="feature-icon" style={{ marginBottom: '12px' }}><Shield size={20} /></div>
              <h3 className="feature-title">Enterprise</h3>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', margin: '8px 0' }}>Custom</div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>For large organizations</p>
              <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '8px' }}>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Unlimited emails / day</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Unlimited domains</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Unlimited concurrent connections</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ BYOD + managed DB option</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ Dedicated IP pool</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ SLA guarantee (99.99%)</li>
                <li style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>✓ 24/7 priority support</li>
              </ul>
              <button onClick={() => setShowContactModal(true)} className="btn btn-secondary" style={{ width: '100%', marginTop: '20px', textAlign: 'center' }}>Contact Sales</button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2 className="cta-title">Ready to Secure Your Communications?</h2>
            <p className="cta-description">
              Connect your own database, bring your own domain, and scale your email infrastructure on your terms.
            </p>
            <div className="cta-actions">
              {user ? (
                <Link to={getDashboardLink()} className="btn btn-accent">
                  Go to Dashboard <ArrowRight size={18} />
                </Link>
              ) : (
                <Link to="/login" className="btn btn-accent">
                  Start Setup <ArrowRight size={18} />
                </Link>
              )}
              <a href="#features" className="btn btn-secondary">
                Learn More
              </a>
              <button onClick={() => setShowFeedbackModal(true)} className="btn btn-ghost" style={{ border: '1px solid var(--border-primary)' }}>
                Submit Feedback
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="home-footer">
        <div className="footer-content">
          <div className="footer-links">
            <Link to="/privacy" className="footer-link">Privacy</Link>
            <Link to="/terms" className="footer-link">Terms</Link>
            <Link to="/security" className="footer-link">Security</Link>
            <Link to="/about" className="footer-link">About</Link>
            <a href="mailto:support@velismail.online" className="footer-link">Contact</a>
          </div>
          <p className="footer-copyright">
            © 2025 VelisMail. All rights reserved. Enterprise-grade secure communication.
          </p>
        </div>
      </footer>

      {/* Contact Sales Modal */}
      {showContactModal && (
        <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
          <div className="contact-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            {contactSuccess ? (
              <div className="modal-success">
                <div className="success-icon">✓</div>
                <h3>Thank you!</h3>
                <p>Our sales team will contact you within 24 hours.</p>
              </div>
            ) : (
              <>
                <div className="modal-header">
                  <h3>Contact Sales</h3>
                  <p>Get a custom enterprise plan tailored to your organization.</p>
                </div>
                <form onSubmit={handleContactSubmit} className="modal-form">
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="contact-name">Full Name *</label>
                      <input id="contact-name" className="input" required value={contactForm.name}
                        onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))} placeholder="Your name" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="contact-email">Work Email *</label>
                      <input id="contact-email" className="input" type="email" required value={contactForm.email}
                        onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))} placeholder="you@company.com" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="contact-company">Company</label>
                    <input id="contact-company" className="input" value={contactForm.company}
                      onChange={e => setContactForm(p => ({ ...p, company: e.target.value }))} placeholder="Your company name" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="contact-message">How can we help? *</label>
                    <textarea id="contact-message" className="input" rows={4} required value={contactForm.message}
                      onChange={e => setContactForm(p => ({ ...p, message: e.target.value }))} placeholder="Tell us about your requirements…" />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowContactModal(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={contactSending}>
                      {contactSending ? 'Sending…' : 'Send Inquiry'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <div className="modal-overlay" onClick={() => setShowFeedbackModal(false)}>
          <div className="contact-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            {feedbackSuccess ? (
              <div className="modal-success">
                <div className="success-icon">✓</div>
                <h3>Feedback Received!</h3>
                <p>Thank you for helping us improve VelisMail.</p>
              </div>
            ) : (
              <>
                <div className="modal-header">
                  <h3>Submit Feedback</h3>
                  <p>We value your input. Help us build a better product.</p>
                </div>
                <form onSubmit={handleFeedbackSubmit} className="modal-form">
                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="fb-name">Name *</label>
                      <input id="fb-name" className="input" required value={feedbackForm.name}
                        onChange={e => setFeedbackForm(p => ({ ...p, name: e.target.value }))} placeholder="Your name" />
                    </div>
                    <div className="form-group">
                      <label htmlFor="fb-email">Email *</label>
                      <input id="fb-email" className="input" type="email" required value={feedbackForm.email}
                        onChange={e => setFeedbackForm(p => ({ ...p, email: e.target.value }))} placeholder="you@email.com" />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="fb-type">Feedback Type</label>
                    <select id="fb-type" className="input" value={feedbackForm.type}
                      onChange={e => setFeedbackForm(p => ({ ...p, type: e.target.value }))}>
                      <option value="suggestion">Suggestion</option>
                      <option value="bug">Bug Report</option>
                      <option value="feature">Feature Request</option>
                      <option value="praise">Praise</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="fb-message">Your Feedback *</label>
                    <textarea id="fb-message" className="input" rows={4} required value={feedbackForm.message}
                      onChange={e => setFeedbackForm(p => ({ ...p, message: e.target.value }))} placeholder="Share your thoughts…" />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowFeedbackModal(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={feedbackSending}>
                      {feedbackSending ? 'Sending…' : 'Submit Feedback'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
