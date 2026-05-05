import { auth } from './client';

/**
 * Global API Interceptor
 * 
 * Industry standard interceptor for handling global API errors,
 * automatic token injection, and session expiration (401 Unauthorized).
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://velismail.online/api/v1';

export async function fetchWithAuth(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('velismail_token');
  
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  // Enforce JSON content type for standard requests
  if (!headers.has('Content-Type') && options.method !== 'GET' && options.method !== 'HEAD') {
    headers.set('Content-Type', 'application/json');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle session expiration automatically
    if (response.status === 401) {
      console.warn('[VelisMail] Session expired. Logging out.');
      auth.logout();
      window.location.href = '/login';
    }

    return response;
  } catch (error) {
    console.error('[VelisMail] API Request Failed:', error);
    throw error;
  }
}
