import { useEffect } from 'react';

/**
 * useNavigationState hook
 * Persists and restores navigation state using sessionStorage.
 * Handles browser navigation events for state restoration.
 */
export function useNavigationState<T>(key: string, state: T, setState: (s: T) => void) {
  // Restore state on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(key);
    if (saved) {
      try {
        setState(JSON.parse(saved));
      } catch {
        // Ignore parse errors
      }
    }
    // Listen for popstate (back/forward navigation)
    const handlePopState = () => {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        try {
          setState(JSON.parse(saved));
        } catch {
          // Ignore parse errors
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [key, setState]);

  // Persist state on change
  useEffect(() => {
    sessionStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
}
