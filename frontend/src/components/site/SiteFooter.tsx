import { Link, useLocation } from 'react-router-dom';

const productLinks = [
  { to: '/#features', label: 'Features' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/status', label: 'Status' },
  { to: '/docs', label: 'Docs' },
];

const companyLinks = [
  { to: '/about', label: 'About' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
  { to: '/security', label: 'Security' },
];

const connectLinks = [
  { to: '/#feedback', label: 'Feedback' },
  { to: 'mailto:support@velismail.online', label: 'Support' },
];

function FooterLink({ to, label }: { to: string; label: string }) {
  if (to.startsWith('mailto:') || to.startsWith('#')) {
    return <a href={to} className="footer-link">{label}</a>;
  }
  return <Link to={to} className="footer-link">{label}</Link>;
}

/** Shared marketing footer, so every public page ends with the same map. */
export default function SiteFooter() {
  const { pathname } = useLocation();
  const onHome = pathname === '/';
  const fix = (href: string) => (href.startsWith('/#') && onHome ? href.slice(1) : href);

  return (
    <footer className="home-footer" role="contentinfo">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <div className="nav-logo">
              <img src="/ZeeResizer.png" alt="" className="home-logo-img" loading="lazy" />
              <span>VelisMail</span>
            </div>
            <p>Business email operations for teams that own their infrastructure.</p>
          </div>

          <div className="footer-column">
            <h4>Product</h4>
            <div className="footer-link-list">
              {productLinks.map((link) => <FooterLink key={link.label} {...link} to={fix(link.to)} />)}
            </div>
          </div>
          <div className="footer-column">
            <h4>Company</h4>
            <div className="footer-link-list">
              {companyLinks.map((link) => <FooterLink key={link.label} {...link} />)}
            </div>
          </div>
          <div className="footer-column">
            <h4>Connect</h4>
            <div className="footer-link-list">
              {connectLinks.map((link) => <FooterLink key={link.label} {...link} to={fix(link.to)} />)}
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>&copy; {new Date().getFullYear()} VelisMail. All rights reserved.</p>
          <div className="footer-bottom-links">
            <Link to="/security" className="footer-link">Security</Link>
            <Link to="/aup" className="footer-link">Acceptable Use</Link>
            <Link to="/refund" className="footer-link">Refund Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
