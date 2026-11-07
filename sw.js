/* The app shell is offline; browser-provider transcription may NOT work offline. */
const CACHE = 'convolens-shell-v5';
const FILES = ['./','./index.html','./styles.css','./app.js','./pcm-worklet.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new Request(file, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))), self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // Network first for pages, so a deployed update is never hidden behind a stale shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'reload' }).catch(() => caches.match('./index.html')));
    return;
  }
  // Stale-while-revalidate for assets: instant load, refreshed in the background.
  event.respondWith(caches.match(event.request).then(cached => {
    const fresh = fetch(event.request, { cache: 'reload' }).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => cached || Response.error());
    return cached || fresh;
  }));
});
