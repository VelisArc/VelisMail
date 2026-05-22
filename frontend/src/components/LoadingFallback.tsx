import LoadingSpinner from './LoadingSpinner';

export default function LoadingFallback() {
  return (
    <div className="loading-screen" role="status" aria-label="Loading">
      <div className="loading-card">
        <LoadingSpinner size="md" />
        <span>Loading</span>
      </div>
    </div>
  );
}
