import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function AcceptableUse() {
  return (
    <div className="legal-page">
      <nav className="legal-nav">
        <div className="container legal-nav-inner">
          <Link to="/" className="nav-logo">
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '24px', width: 'auto' }} />
            <span className="logo-text">VelisMail</span>
          </Link>
          <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={16} /> Back</Link>
        </div>
      </nav>

      <div className="container legal-content animate-slide-up">
        <div className="legal-header">
          <span className="section-tag">LEGAL</span>
          <h1>Acceptable Use Policy (AUP)</h1>
          <p className="legal-updated">Effective Date: January 1, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <p>
              VelisMail provides secure email hosting for legitimate business use. To protect the domain reputation of our network, strict adherence to this AUP is required.
            </p>
          </section>

          <section>
            <h2>1. Zero Tolerance for Spam</h2>
            <p>
              VelisMail strictly prohibits the sending of unsolicited commercial email (spam). You must have explicit, provable consent from recipients before adding them to any mailing list. Use of our SMTP relays for mass marketing or cold-emailing campaigns is forbidden and will result in automated IP blacklisting and account termination.
            </p>
          </section>

          <section>
            <h2>2. Prohibited Content and Activities</h2>
            <ul>
              <li><strong>Phishing & Spoofing:</strong> Attempting to impersonate other organizations or deceive users to steal credentials.</li>
              <li><strong>Malware Distribution:</strong> Sending emails containing viruses, trojans, ransomware, or malicious links.</li>
              <li><strong>Illegal Operations:</strong> Using the platform to facilitate human trafficking, illegal drug sales, or child exploitation.</li>
            </ul>
          </section>

          <section>
            <h2>3. Enforcement and Reporting</h2>
            <p>
              We employ advanced, automated threat intelligence to monitor metadata (without reading encrypted contents) to detect abuse. We actively collaborate with organizations like Spamhaus to enforce domain integrity. If you receive abusive emails originating from a VelisMail hosted domain, please forward the full email headers to our abuse team.
            </p>
          </section>

          <section>
            <p style={{ textAlign: 'center', marginTop: '40px' }}>Report abuse to <a href="mailto:abuse@velismail.online">abuse@velismail.online</a></p>
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
