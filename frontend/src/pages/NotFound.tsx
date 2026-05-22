import { Link } from 'react-router-dom';
import SEO from '../components/SEO';
import './NotFound.css';

export default function NotFound() {
  return (
    <div className="not-found-page animate-page">
      <SEO title="Page Not Found" description="The page you're looking for doesn't exist." />
      <div className="not-found-content">
        <span className="not-found-code">404</span>
        <h1>Page not found</h1>
        <p>The page you're looking for doesn't exist or has been moved.</p>
        <div className="not-found-actions">
          <Link to="/" className="btn btn-primary">
            Back to Home
          </Link>
          <Link to="/login" className="btn btn-secondary">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
