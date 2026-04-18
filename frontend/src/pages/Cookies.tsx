import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Cookies() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" className="logo-img" alt="ZeeResizer" />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      <div className="container legal-content animate-slide-up">
        <div className="legal-header">
          <span className="section-tag">LEGAL</span>
          <h1>Cookie Policy</h1>
          <p className="legal-updated">Last updated: April 15, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>1. What are Cookies?</h2>
            <p>
              Cookies are small textual fragments placed on your device to ensure basic platform functionality. At VelisMail, we operate under a strict minimal-data doctrine.
            </p>
          </section>
          
          <section>
            <h2>2. Essential Cookies Only</h2>
            <p>
              We only deploy <strong>strictly necessary session cookies</strong> to securely maintain your encrypted local states while authenticated. We completely prohibit:
            </p>
            <ul>
              <li>Tracking cookies</li>
              <li>Advertising identifiers</li>
              <li>Cross-site telemetry beacons</li>
              <li>Third-party analytics scripts</li>
            </ul>
          </section>

          <section>
            <h2>3. Local Storage</h2>
            <p>
              Because of our Zero-Knowledge architecture, your private decryption envelopes are temporarily maintained in robust client-side `localStorage` encrypted vaults. Clearing your browser cache will securely wipe your active session entirely.
            </p>
          </section>
        </div>
      </div>

      <footer className="legal-footer">
        <div className="container legal-footer-inner">
          <span>© 2026 VelisMail. All rights reserved.</span>
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
