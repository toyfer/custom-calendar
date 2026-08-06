/* Custom Calendar v2 — static SW only (GitHub Pages)
 * Never cache Google API / OAuth. Events live in IndexedDB. */

const VERSION = 'cc-v2-mobile-2026-08-06';
const PRECACHE = [
  './',
  './index.html',
  './styles.mobile-month.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './icons/icon-light.svg',
  './js/main.mobile.js',
  './js/ui.mobile.js',
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
    url.hostname.endsWith('.gstatic.com') ||
    url.hostname === 'cdn.jsdelivr.net'
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (isGoogleApi(url)) return;
  if (url.origin !== self.location.origin) return;

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
