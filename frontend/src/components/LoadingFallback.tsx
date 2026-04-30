import { Loader2 } from 'lucide-react';

/**
 * LoadingFallback — Displayed while lazy-loaded route components are being fetched.
 * Uses the global design system for consistent styling.
 */
export default function LoadingFallback() {
  return (
    <div className="loading-fallback" role="status" aria-label="Loading">
      <div className="loading-fallback-inner">
        <Loader2 size={36} className="animate-spin" style={{ color: 'var(--primary)' }} />
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
}
