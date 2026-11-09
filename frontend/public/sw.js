const CACHE_NAME = 'velismail-shell-v6';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/ZeeResizer.png',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/robots.txt'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated API traffic. A cached mailbox response could be
  // replayed to the next person who signs in on this browser while offline.
  if (
    request.headers.has('authorization') ||
    /^\/(api|auth|mail|tenants|storage|delivery)(\/|$)/.test(url.pathname)
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html')).then((response) => {
        return response || new Response(
          '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VelisMail</title></head><body style="margin:0;font-family:system-ui;background:#fafafa;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:2rem;"><div><h1 style="margin:0 0 0.5rem;font-size:1.5rem;">You are offline</h1><p style="margin:0;color:#52525b;">VelisMail could not reach the network. Check your connection and reload.</p></div></body></html>',
          { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      })
    );
    return;
  }

  // Only static assets are cacheable. Documents and unknown paths stay
  // network-only.
  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || new Response('', { status: 504, statusText: 'Gateway Timeout' }));
    })
  );
});
