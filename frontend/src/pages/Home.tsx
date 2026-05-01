import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Lock, Zap, Globe, ArrowRight,
  Fingerprint, Eye, Server,
  Shield, Key, Cloud, Database
} from 'lucide-react';
import { auth } from '../api/client';
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
    title: 'Unlimited Storage',
    desc: 'Scalable storage architecture with automatic compression and intelligent data tiering.',
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

  return (
    <div className="home">
      {/* Navigation */}
      <nav className={`home-nav ${scrolled ? 'nav-scrolled' : ''}`}>
        <div className="nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" className="logo-img" alt="VelisMail" style={{ height: '32px', width: 'auto', marginRight: '8px' }} />
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
                <Link to="/login" className="btn btn-secondary">Log In</Link>
                <Link to="/login" className="btn btn-primary">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <Zap size={14} />
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
                Go to {getDashboardText()} <ArrowRight size={20} />
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary">
                Start for Free <ArrowRight size={20} />
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
                  <feature.icon size={32} />
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

      {/* CTA Section */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2 className="cta-title">Ready to Secure Your Communications?</h2>
            <p className="cta-description">
              Join thousands of enterprises that trust VelisMail for their most sensitive communications.
              Get started in minutes with our enterprise-grade security platform.
            </p>
            <div className="cta-actions">
              {user ? (
                <Link to={getDashboardLink()} className="btn btn-accent">
                  Go to Dashboard <ArrowRight size={20} />
                </Link>
              ) : (
                <Link to="/login" className="btn btn-accent">
                  Start Free Trial <ArrowRight size={20} />
                </Link>
              )}
              <a href="#features" className="btn btn-secondary">
                Learn More
              </a>
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
            <Link to="/contact" className="footer-link">Contact</Link>
          </div>
          <p className="footer-copyright">
            © 2024 VelisMail. All rights reserved. Enterprise-grade secure communication.
          </p>
        </div>
      </footer>
    </div>
  );
}