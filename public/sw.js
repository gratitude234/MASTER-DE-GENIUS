/* Public application shell only. Never cache authenticated HTML, RSC or API responses. */
const SHELL = 'mdg-shell-X4Y8yIiT3Onpp96_YzVae';
const MEDIA = 'mdg-question-media-v1';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const response = await fetch('/offline', { cache: 'reload', credentials: 'omit' });
    if (!response.ok || response.redirected) throw new Error('Offline shell unavailable');
    const html = await response.clone().text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')).filter(u => u.startsWith('/_next/static/')))];
    await cache.addAll([...assets, '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']);
    await cache.put('/offline', response);
    // Deliberately no skipWaiting: never replace the worker during an exam.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('mdg-shell-') && name !== SHELL) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith((async () => { try { const response = await fetch(request); if (response.status < 500) return response; } catch {} return (await (await caches.open(SHELL)).match('/offline')) || new Response('Reconnect to open the app.', { status: 503 }); })());
    return;
  }
  if (url.origin === self.location.origin && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'))) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(request); if (hit) return hit;
      const response = await fetch(request); if (response.ok) await cache.put(request, response.clone()); return response;
    })());
  } else if (request.destination === 'image') {
    event.respondWith((async () => (await caches.open(MEDIA)).match(request) || fetch(request))());
  }
});
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_MEDIA') event.waitUntil(caches.delete(MEDIA));
  if (event.data?.type === 'SAVE_MEDIA' && Array.isArray(event.data.urls)) event.waitUntil((async () => {
    const cache = await caches.open(MEDIA);
    for (const raw of event.data.urls.slice(0, 300)) {
      try {
        const url = new URL(raw, self.location.origin);
        if (!['https:', 'http:'].includes(url.protocol)) continue;
        if (await cache.match(url.href)) continue;
        const response = await fetch(url.href, { credentials: 'omit', mode: 'cors' });
        if (response.ok && response.headers.get('Content-Type')?.startsWith('image/')) await cache.put(url.href, response);
      } catch { /* Uncached images remain clearly described as needing a connection. */ }
    }
  })());
});
