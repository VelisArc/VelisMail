import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { auth, isBusinessSetupReady } from '../../api/client';

/**
 * The one navigation used by every marketing page.
 *
 * Keeping this in one place is what stops Home, About and Pricing from
 * drifting apart: the logo, spacing, active state and mobile drawer are
 * defined once.
 */
export default function SiteNav() {
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user] = useState(auth.getSession());

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileMenuOpen]);

  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  const dashboardLink = user ? '/business' : '/login?mode=register';
  const dashboardText = user
    ? (isBusinessSetupReady(user) ? 'Open Dashboard' : 'Continue Setup')
    : 'Get Started Free';
  const isCurrent = (path: string) => location.pathname === path;
  const onHome = location.pathname === '/';
  const homeHash = (hash: string) => (onHome ? hash : `/${hash}`);

  return (
    <nav className={`home-nav ${scrolled ? 'nav-scrolled' : ''}`} role="navigation" aria-label="Main navigation">
      <div className="nav-inner">
        <Link to="/" className="nav-logo" onClick={closeMobileMenu} aria-label="VelisMail home">
          <img
            src="/ZeeResizer.png"
            alt=""
            className="home-logo-img"
            loading="eager"
            fetchPriority="high"
          />
          <span>VelisMail</span>
        </Link>

        <button
          type="button"
          className="nav-toggle"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          aria-controls="site-nav-links"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        <div className={`nav-overlay ${mobileMenuOpen ? 'open' : ''}`} onClick={closeMobileMenu} aria-hidden="true" />

        <div id="site-nav-links" className={`nav-links ${mobileMenuOpen ? 'open' : ''}`}>
          <a href={homeHash('#features')} className="nav-link" onClick={closeMobileMenu}>Features</a>
          <a href={homeHash('#solutions')} className="nav-link" onClick={closeMobileMenu}>Solutions</a>
          <Link
            to="/pricing"
            className={`nav-link ${isCurrent('/pricing') ? 'active' : ''}`}
            aria-current={isCurrent('/pricing') ? 'page' : undefined}
            onClick={closeMobileMenu}
          >
            Pricing
          </Link>
          <Link
            to="/about"
            className={`nav-link ${isCurrent('/about') ? 'active' : ''}`}
            aria-current={isCurrent('/about') ? 'page' : undefined}
            onClick={closeMobileMenu}
          >
            About
          </Link>
          <div className="nav-divider" role="separator" />
          <div className="nav-actions">
            {!user && (
              <Link to="/login" className="nav-link" onClick={closeMobileMenu}>Log In</Link>
            )}
            <Link to={dashboardLink} className="btn btn-primary nav-cta" onClick={closeMobileMenu}>
              {dashboardText}
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
