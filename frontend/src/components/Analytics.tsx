import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ANALYTICS_URL = import.meta.env.VITE_ANALYTICS_URL || '';

export default function Analytics() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (!ANALYTICS_URL) return;

    try {
      fetch(ANALYTICS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: pathname,
          referrer: document.referrer,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Analytics unavailable — silently ignore
    }
  }, [pathname]);

  return null;
}
