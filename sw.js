/* Custom Calendar v2.2 — static SW only */
const VERSION = 'cc-v2-2-2026-08-06c';
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
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
function isGoogleApi(url){return url.hostname==='www.googleapis.com'||url.hostname==='accounts.google.com'||url.hostname==='apis.google.com'||url.hostname.endsWith('.google.com')||url.hostname.endsWith('.gstatic.com')||url.hostname==='cdn.jsdelivr.net'}
self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;const url=new URL(req.url);if(isGoogleApi(url))return;if(url.origin!==self.location.origin)return;if(req.mode==='navigate'){e.respondWith(fetch(req).then(res=>{const c=res.clone();caches.open(VERSION).then(ca=>ca.put('./index.html',c));return res}).catch(()=>caches.match('./index.html')));return;}e.respondWith(caches.open(VERSION).then(async cache=>{const cached=await cache.match(req);const net=fetch(req).then(res=>{if(res&&res.ok)cache.put(req,res.clone());return res}).catch(()=>cached);return cached||net}))});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
