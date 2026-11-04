// Offline support: the whole app (page, libraries, PDF reader, fonts) is kept on the device when it's installed.
// Network first so updates show, but a slow or missing signal gets the copy on the device after a few seconds.
// Calls to the store's server are never cached here; the app keeps its own copy of the data and files.
const CACHE = 'floorboard-v5';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/react.production.min.js', 'vendor/react-dom.production.min.js', 'vendor/htm.umd.js', 'vendor/qrcode.min.js', 'vendor/supabase.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/jspdf.umd.min.js', 'vendor/msal-browser.min.js'];
const FONTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request, origin = new URL(req.url).origin;
  if (req.method !== 'GET') return;
  // fonts: the copy on the device, refreshed in the background
  if (FONTS.includes(origin)) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; });
      return hit || net;
    })));
    return;
  }
  if (origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
    if (!hit) return net;
    return Promise.race([net.catch(() => hit), new Promise((ok) => setTimeout(() => ok(hit), 4000))]);
  }));
});
// Alerts when the app is closed: the store's server sends them, this shows them.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    // the app on screen shows its own alert (Apple devices must always get one, and a test always shows)
    if (!d.force && !/iPhone|iPad|Macintosh/.test(navigator.userAgent) && wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
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
