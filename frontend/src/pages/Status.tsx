import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, LifeBuoy } from 'lucide-react';
import './Legal.css';
import './Status.css';

const services = [
  { name: 'API Gateway', detail: 'Authentication, workspace API and routing', state: 'Operational' },
  { name: 'Web Application', detail: 'Marketing site and workspace console', state: 'Operational' },
  { name: 'Database', detail: 'Workspace storage and account records', state: 'Operational' },
  { name: 'Email Delivery', detail: 'Queued and transactional mail delivery', state: 'Operational' },
];

export default function Status() {
  return (
    <div className="legal-page status-page">
      <nav className="legal-nav" aria-label="Status page navigation">
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
            <span className="section-tag">System Status</span>
            <span>VelisMail Service Health</span>
          </div>
          <h1>Platform Status</h1>
          <p className="legal-hero-copy">
            The current state of the services that power your workspace.
          </p>
        </header>

        <div className="container legal-content">
          <div className="status-summary">
            <div className="status-summary-main">
              <span className="status-dot" aria-hidden="true" />
              <div>
                <strong>All systems operational</strong>
                <span>No incidents reported across the platform.</span>
              </div>
            </div>
            <span className="status-checked">Checked just now</span>
          </div>

          <div className="status-list" aria-label="Service status">
            {services.map((service) => (
              <div key={service.name} className="status-row">
                <div className="status-row-copy">
                  <strong>{service.name}</strong>
                  <span>{service.detail}</span>
                </div>
                <span className="status-pill">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  {service.state}
                </span>
              </div>
            ))}
          </div>

          <div className="status-help">
            <LifeBuoy size={18} aria-hidden="true" />
            <p>
              Seeing something we should know about? Email{' '}
              <a href="mailto:support@velismail.online">support@velismail.online</a>.
            </p>
          </div>
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
