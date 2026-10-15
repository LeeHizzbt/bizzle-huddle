/* Bizzle Huddle v4.20 service worker. CACHE name changes on every version bump (scripts/bump-version.sh). */
var CACHE = 'bizzle-huddle-2026-10-15.8';
var SHELL = ['./', 'index.html', 'css/app.css?v=2026-10-15.8', 'js/config.js?v=2026-10-15.8', 'js/ai.js?v=2026-10-15.8', 'js/app.js?v=2026-10-15.8',
  'vendor/supabase.js?v=2.118.0', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('bizzle-huddle-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // Supabase + AI calls go straight to the network
  if (req.mode === 'navigate') {   // network-first for the page so new versions show up
    e.respondWith(fetch(req).then(function (r) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put('index.html', cp); }); return r; })
      .catch(function () { return caches.match('index.html'); }));
    return;
  }
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (r) { if (r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); } return r; });
  }));
});
