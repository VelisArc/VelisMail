import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, BookOpen, LifeBuoy } from 'lucide-react';
import './Legal.css';
import './Documentation.css';

const sections = [
  { href: '#getting-started', label: 'Getting Started' },
  { href: '#account-types', label: 'Account Types' },
  { href: '#support', label: 'Support' },
];

export default function Documentation() {
  return (
    <div className="legal-page">
      <nav className="legal-nav" aria-label="Documentation navigation">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo legal-brand">
            <img src="/ZeeResizer.png" alt="VelisMail" className="legal-nav-logo" />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm">
            <ArrowLeft size={16} /> Back
          </Link>
        </div>
      </nav>

      <main className="legal-main animate-slide-up">
        <header className="container legal-hero">
          <div className="legal-kicker">
            <span className="section-tag">Support</span>
            <span>VelisMail Documentation</span>
          </div>
          <h1>Documentation</h1>
          <p className="legal-hero-copy">
            The essentials for setting up and running your VelisMail workspace.
          </p>
        </header>

        <div className="container legal-shell docs-shell">
          <aside className="legal-aside" aria-label="Documentation sections">
            <p className="legal-aside-title">On this page</p>
            <div className="legal-policy-links">
              {sections.map((section) => (
                <a key={section.href} href={section.href} className="legal-policy-link">
                  {section.label}
                </a>
              ))}
            </div>
            <div className="docs-aside-card">
              <BookOpen size={18} aria-hidden="true" />
              <strong>New to VelisMail?</strong>
              <p>Start with the workspace setup flow. It checks your database, mail provider and DNS records as you go.</p>
              <Link to="/login?mode=register" className="docs-aside-link">
                Create an account <ArrowUpRight size={14} />
              </Link>
            </div>
          </aside>

          <article className="legal-document">
            <div className="legal-body">
              <section id="getting-started">
                <h2>Getting Started</h2>
                <p>
                  Create an account through our secure passwordless flow. For personal use, start sending
                  email immediately. For business use, connect your custom domain to keep mail and data
                  inside infrastructure you control.
                </p>
                <div className="docs-steps">
                  <div className="docs-step">
                    <span className="docs-step-number">01</span>
                    <div>
                      <h3>Create your account</h3>
                      <p>Sign in with Google or an email code. No password is stored on the client.</p>
                    </div>
                  </div>
                  <div className="docs-step">
                    <span className="docs-step-number">02</span>
                    <div>
                      <h3>Connect your workspace</h3>
                      <p>Add your database and mail provider, then publish the generated DNS records.</p>
                    </div>
                  </div>
                  <div className="docs-step">
                    <span className="docs-step-number">03</span>
                    <div>
                      <h3>Start sending</h3>
                      <p>Provision mailboxes and groups, then send with delivery tracking and audit history.</p>
                    </div>
                  </div>
                </div>
              </section>

              <section id="account-types">
                <h2>Account Types</h2>
                <div className="docs-cards">
                  <div className="docs-card">
                    <span className="docs-card-kicker">Personal</span>
                    <h3>Free @velismail.online addresses</h3>
                    <p>Perfect for daily communication without managing a domain or external database.</p>
                  </div>
                  <div className="docs-card">
                    <span className="docs-card-kicker">Business</span>
                    <h3>Bring your own domain and database</h3>
                    <p>Connect your custom domain and external PostgreSQL database for full control of your data.</p>
                  </div>
                </div>
              </section>

              <section id="support" className="legal-contact-section">
                <div>
                  <h2>Need Help?</h2>
                  <p>Can't find what you need? Our team can help with setup, DNS and delivery questions.</p>
                </div>
                <a className="btn btn-secondary legal-contact-button" href="mailto:support@velismail.online">
                  <LifeBuoy size={16} />
                  support@velismail.online
                </a>
              </section>
            </div>
          </article>
        </div>
      </main>

      <footer className="legal-footer">
        <div className="container legal-footer-inner">
          <span>&copy; {new Date().getFullYear()} VelisMail. All rights reserved.</span>
          <div className="legal-footer-links">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/cookies">Cookie Policy</Link>
            <Link to="/aup">Acceptable Use</Link>
            <Link to="/security">Security</Link>
            <Link to="/refund">Refund Policy</Link>
            <Link to="/about">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
