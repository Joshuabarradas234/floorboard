// Offline support for the app itself: network first so updates show, cached copy when there is no signal.
// Calls to the store's server are never cached.
const CACHE = 'floorboard-v3';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/react.production.min.js', 'vendor/react-dom.production.min.js', 'vendor/htm.umd.js', 'vendor/supabase.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
// Alerts when the app is closed: the store's server sends them, this shows them.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    // the app on screen shows its own alert (Apple devices must always get one)
    if (!/iPhone|iPad|Macintosh/.test(navigator.userAgent) && wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    return self.registration.showNotification(d.title || 'Floorboard', {
      body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '' },
      icon: 'icon-192.png', badge: 'icon-192.png', requireInteraction: !!d.urgent, vibrate: d.urgent ? [220, 120, 220, 120, 220] : [140],
    });
  }));
});
// Tapping an alert opens Floorboard on what it's about.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const w = wins.find((x) => x.url.startsWith(self.registration.scope));
    if (w) { w.postMessage({ floorboard: 'go', hash }); return w.focus(); }
    return self.clients.openWindow(self.registration.scope + hash);
  }));
});
