import type { ReactNode } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import SEO from '../components/SEO';
import './Legal.css';

type LegalLayoutProps = {
  slug: string;
  title: string;
  description: string;
  category?: string;
  effectiveDate?: string;
  lastUpdated?: string;
  contactEmail: string;
  contactLabel: string;
  children: ReactNode;
};

const policyLinks = [
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/cookies', label: 'Cookies' },
  { to: '/aup', label: 'Acceptable Use' },
  { to: '/security', label: 'Security' },
  { to: '/refund', label: 'Refunds' },
  { to: '/api-keys-policy', label: 'API Keys' },
];

function PolicyLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'legal-policy-links compact' : 'legal-policy-links'} aria-label="Policy pages">
      {policyLinks.map(link => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => `legal-policy-link${isActive ? ' active' : ''}`}
        >
          {link.label}
        </NavLink>
      ))}
    </div>
  );
}

function MobilePolicyMenu() {
  return (
    <div className="container legal-mobile-menu-wrap" id="policy-menu">
      <details className="legal-mobile-menu">
        <summary>
          <span>Policy pages</span>
          <strong>Open menu</strong>
        </summary>
        <PolicyLinks />
      </details>
    </div>
  );
}

export default function LegalLayout({
  slug,
  title,
  description,
  category = 'Legal',
  effectiveDate,
  lastUpdated,
  contactEmail,
  contactLabel,
  children,
}: LegalLayoutProps) {
  return (
    <div className="legal-page">
      <SEO title={title} description={description} />

      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo legal-brand" id={`${slug}-nav-logo`}>
            <img src="/ZeeResizer.png" alt="VelisMail" className="legal-nav-logo" id={`${slug}-nav-logo-img`} />
            <span className="logo-text">VelisMail</span>
          </Link>
          <div className="legal-nav-actions">
            <a href="#policy-menu" className="btn btn-ghost btn-sm legal-policy-jump">
              Policies
            </a>
            <Link to="/" className="btn btn-ghost btn-sm" id={`${slug}-nav-back`}>
              <ArrowLeft size={16} />
              Back
            </Link>
          </div>
        </div>
      </nav>

      <main className="legal-main animate-slide-up">
        <header className="container legal-hero">
          <div className="legal-kicker">
            <span className="section-tag" id={`${slug}-header-tag`}>{category}</span>
            <span>VelisMail Policy Center</span>
          </div>
          <h1>{title}</h1>
          <p className="legal-hero-copy">{description}</p>
          <div className="legal-meta-grid" aria-label="Policy metadata">
            {effectiveDate && (
              <div>
                <span>Effective</span>
                <strong>{effectiveDate}</strong>
              </div>
            )}
            {lastUpdated && (
              <div>
                <span>Last Updated</span>
                <strong>{lastUpdated}</strong>
              </div>
            )}
            <div>
              <span>Contact</span>
              <strong>{contactEmail}</strong>
            </div>
          </div>
        </header>

        <MobilePolicyMenu />

        <div className="container legal-shell">
          <aside className="legal-aside" aria-label="Policy center navigation">
            <p className="legal-aside-title">Policy Center</p>
            <PolicyLinks />
            <p className="legal-aside-note">
              These pages define how VelisMail handles service use, privacy, billing, cookies, abuse, and security disclosures.
            </p>
          </aside>

          <article className="legal-document">
            <div className="legal-body">
              {children}
              <section className="legal-contact-section" aria-labelledby={`${slug}-contact-heading`}>
                <div>
                  <h2 id={`${slug}-contact-heading`}>Need Help?</h2>
                  <p>{contactLabel}</p>
                </div>
                <a className="btn btn-secondary legal-contact-button" href={`mailto:${contactEmail}`}>
                  <Mail size={16} />
                  {contactEmail}
                </a>
              </section>
            </div>
          </article>
        </div>
      </main>

      <footer className="legal-footer">
        <div className="container legal-footer-inner">
          <span>Copyright 2026 VelisMail. All rights reserved.</span>
          <div className="legal-footer-links">
            {policyLinks.map(link => (
              <Link key={link.to} to={link.to}>
                {link.label}
              </Link>
            ))}
            <Link to="/about">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
