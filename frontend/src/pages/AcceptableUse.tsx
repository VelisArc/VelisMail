import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function AcceptableUse() {
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
          <h1>Acceptable Use Policy (AUP)</h1>
          <p className="legal-updated">Last updated: April 15, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>1. Zero Tolerance for Abuse</h2>
            <p>
              VelisMail grants total privacy over data, but we maintain a zero-tolerance policy for abuse. Any infraction results in immediate multi-node blacklisting.
            </p>
          </section>
          
          <section>
            <h2>2. Prohibited Architectures</h2>
            <p>You may strictly not utilize VelisMail for:</p>
            <ul>
              <li>Executing Phishing, Spoofing, or Social Engineering operations.</li>
              <li>Hosting malicious payloads or command-and-control sequences.</li>
              <li>Scraping APIs for unverified datasets or bulk exploitation.</li>
              <li>Distributing unsolicited commercial data structures (SPAM).</li>
            </ul>
          </section>

          <section>
            <h2>3. DMCA and Law Enforcement</h2>
            <p>
              As a Zero-Knowledge provider, we cannot inspect encrypted payloads. However, we will collaborate with binding legal subpoenas to restrict accounts that deploy our API interfaces for documented illegal routing. The Bring-Your-Own-Infrastructure (BYOI) user assumes supreme liability for data passing through their local connections. 
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
