/* Custom Calendar — static asset service worker (GitHub Pages)
 * API / OAuth tokens are NEVER cached here. Event data lives in IndexedDB (app). */

const VERSION = 'cc-static-v1';
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './styles.overlay.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './js/main.js',
  './js/ui.js',
  './js/google.js',
  './js/state.js',
  './js/cache.js',
  './js/constants.js',
  './js/dates.js',
  './js/storage.js',
  './config.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isGoogleApi(url) {
  return (
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'accounts.google.com' ||
    url.hostname === 'apis.google.com' ||
    url.hostname.endsWith('.google.com') ||
    url.hostname.endsWith('.gstatic.com')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept Google / OAuth / third-party APIs
  if (isGoogleApi(url)) return;

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fallback to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
