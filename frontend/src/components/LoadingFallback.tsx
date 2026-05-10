import LoadingSpinner from './LoadingSpinner';

export default function LoadingFallback() {
  return (
    <div className="velis-loading-screen" role="status" aria-label="Loading">
      <div className="velis-loading-card">
        <LoadingSpinner size="lg" />
        <span>Loading</span>
      </div>
    </div>
  );
}
