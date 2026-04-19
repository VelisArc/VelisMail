import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Legal.css';

export default function Terms() {
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
          <h1>Terms of Service</h1>
          <p className="legal-updated">Last updated: April 15, 2026</p>
        </div>

        <div className="legal-body">
          <section>
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing or using VelisMail ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to all of these Terms, do not use the Service.
            </p>
          </section>

          <section>
            <h2>2. Description of Service</h2>
            <p>
              VelisMail provides a privacy-focused email service featuring end-to-end encryption, passwordless authentication via passkeys, Zero-Knowledge Proof identity verification, custom domain management, and multi-tenant organizational tools.
            </p>
          </section>

          <section>
            <h2>3. Account Registration</h2>
            <ul>
              <li>You must provide accurate and complete registration information.</li>
              <li>You are responsible for maintaining the security of your authentication devices (passkeys, biometrics).</li>
              <li>You must be at least 16 years old to use the Service.</li>
              <li>One person may not maintain more than one free account.</li>
            </ul>
          </section>

          <section>
            <h2>4. Acceptable Use</h2>
            <p>You agree NOT to use VelisMail to:</p>
            <ul>
              <li>Send unsolicited bulk emails (spam)</li>
              <li>Distribute malware, viruses, or malicious content</li>
              <li>Engage in phishing or identity theft</li>
              <li>Store or transmit illegal content</li>
              <li>Violate any applicable local, national, or international law</li>
              <li>Attempt to breach or circumvent our security measures</li>
              <li>Resell the Service without our written approval</li>
            </ul>
          </section>

          <section>
            <h2>5. Subscription & Billing</h2>
            <h3>5.1 Free Tier</h3>
            <p>The free plan includes 5 GB storage, basic encryption, and community support with no credit card required.</p>

            <h3>5.2 Paid Plans</h3>
            <p>
              Paid plans are billed monthly or annually. Prices are listed in INR and may vary by region. All fees are non-refundable unless required by law.
            </p>

            <h3>5.3 Cancellation</h3>
            <p>
              You may cancel your subscription at any time. Your paid features will remain active until the end of the current billing period. Data will be retained for 30 days after cancellation.
            </p>
          </section>

          <section>
            <h2>6. Privacy & Data Protection</h2>
            <p>
              Your use of the Service is also governed by our <Link to="/privacy">Privacy Policy</Link>. Due to our Zero-Knowledge architecture, we cannot access, read, or recover the contents of your encrypted emails. You are solely responsible for maintaining access to your encryption keys.
            </p>
          </section>

          <section>
            <h2>7. Intellectual Property</h2>
            <p>
              The VelisMail name, logo, and all related trademarks are our property. The Service's source code, design, and architecture are protected by intellectual property laws. You retain full ownership of all content you create and store within the Service.
            </p>
          </section>

          <section>
            <h2>8. Service Availability</h2>
            <p>
              We strive for 99.99% uptime but do not guarantee uninterrupted service. We reserve the right to perform maintenance with reasonable advance notice. We are not liable for any downtime or data loss caused by circumstances beyond our control.
            </p>
          </section>

          <section>
            <h2>9. Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, VELISMAIL SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, REGARDLESS OF THE CAUSE OF ACTION OR LEGAL THEORY.
            </p>
            <p>
              Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2>10. Account Termination</h2>
            <p>
              We may suspend or terminate your account if you violate these Terms. Upon termination, your right to use the Service ceases immediately. We will provide 30 days notice before termination unless the violation poses an immediate security risk.
            </p>
          </section>

          <section>
            <h2>11. Governing Law</h2>
            <p>
              These Terms shall be governed by and construed in accordance with the laws of India, without regard to conflict of law principles. Any disputes shall be resolved in the courts of Bengaluru, Karnataka, India.
            </p>
          </section>

          <section>
            <h2>12. Changes to Terms</h2>
            <p>
              We reserve the right to modify these Terms at any time. Material changes will be communicated via email at least 30 days before they take effect. Continued use of the Service after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2>13. Contact</h2>
            <p>Questions about these Terms? Contact us:</p>
            <ul>
              <li>Email: <a href="mailto:legal@velismail.com">legal@velismail.com</a></li>
              <li>Address: VelisMail Legal, Bengaluru, India</li>
            </ul>
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
