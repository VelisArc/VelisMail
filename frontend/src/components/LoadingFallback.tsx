import LoadingSpinner from './LoadingSpinner';

export default function LoadingFallback() {
  return (
    <div className="loading-screen" role="status" aria-label="Loading">
      <div className="loading-card">
        <LoadingSpinner size="lg" label="Loading" />
        <span className="loading-card-copy">
          <strong>VelisMail</strong>
          <em>Preparing your workspace</em>
        </span>
      </div>
    </div>
  );
}
