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
            <div className="logo-mark">V</div>
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