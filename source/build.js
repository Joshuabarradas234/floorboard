// Builds the installable app in floorboard-app/ from floorboard.html, which stays the single source.
// Run: node build.js (next to floorboard-app/, or from the copy in floorboard-app/source/)
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const ROOT = __dirname, OUT = path.basename(ROOT) === 'source' ? path.dirname(ROOT) : path.join(ROOT, 'floorboard-app');
const VENDOR = {
  'react.production.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'react-dom.production.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'htm.umd.js': 'https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.umd.js',
  'qrcode.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
};
// The PDF reader and the PDF maker are loaded by the page only when they're needed, so they have no script tags to swap.
const LAZY = [
  { base: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/', files: ['pdf.min.js', 'pdf.worker.min.js'] },
  { base: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/', files: ['jspdf.umd.min.js'] },
  { base: 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.30.0/lib/', files: ['msal-browser.min.js'] },
];
// Only the installed app talks to the store's server, so this one isn't in floorboard.html.
const SUPABASE = { file: 'supabase.js', url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js' };
const CONFIG_TEMPLATE = `// Your store's server. Leave both empty to run the demo store instead.
// From Supabase: Project Settings -> API: the Project URL, and the publishable (or "anon public") key.
// The publishable key is meant to be public; the access rules in supabase/setup.sql protect the data.
window.FLOORBOARD_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
  // Outlook email (optional): Floorboard registered in your Microsoft 365. The Application (client) ID and the Directory (tenant) ID.
  msClientId: '',
  msTenantId: '',
};
`;
const BG = '#2b2018';

const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${BG}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Floorboard">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style>
</head>
<body>
`;
const TAIL = `
<script>if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});</script>
</body>
</html>
`;

const MANIFEST = {
  name: 'Floorboard',
  short_name: 'Floorboard',
  description: 'Tasks, feedback, heads-ups and votes that involve you, without scrolling through WhatsApp groups.',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: BG,
  theme_color: BG,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
  shortcuts: [{ name: 'Needs you (sidebar view)', short_name: 'Needs you', url: './#widget', icons: [{ src: 'icon-192.png', sizes: '192x192' }] }],
  // Android: Floorboard shows up in the share menu, and what's shared opens as a new post
  share_target: { action: './', method: 'GET', params: { title: 'share_title', text: 'share_text', url: 'share_url' } },
};

const SW = `// Offline support for the app itself: network first so updates show, cached copy when there is no signal.
// Calls to the store's server are never cached.
const CACHE = 'floorboard-v4';
const SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/react.production.min.js', 'vendor/react-dom.production.min.js', 'vendor/htm.umd.js', 'vendor/qrcode.min.js', 'vendor/supabase.js'];
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
`;

// Icon: three priority bars (red, amber, green) on a warm glass tile.
const BARS = [[0.24, 0.31, 0.76, [255, 107, 87]], [0.24, 0.47, 0.62, [255, 181, 71]], [0.24, 0.63, 0.46, [79, 214, 136]]];
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a382a"/><stop offset="1" stop-color="#261c15"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/>`
  + BARS.map(([x0, yc, x1, c]) => `<rect x="${x0 * 512}" y="${(yc - 0.05) * 512}" width="${(x1 - x0) * 512}" height="${0.1 * 512}" rx="${0.05 * 512}" fill="rgb(${c.join(',')})"/>`).join('') + '</svg>';

function inRoundRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}
function drawIcon(size, maskable) {
  const S = 4, px = new Float32Array(size * size * 4);
  const scale = maskable ? 0.8 : 1, corner = maskable ? 0 : 0.22;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, hits = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      if (!inRoundRect(u, v, 0, 0, 1, 1, corner)) continue;
      const t = v; let c = [74 + (38 - 74) * t, 56 + (28 - 56) * t, 42 + (21 - 42) * t];
      const bu = 0.5 + (u - 0.5) / scale, bv = 0.5 + (v - 0.5) / scale;
      for (const [x0, yc, x1, col] of BARS) if (inRoundRect(bu, bv, x0, yc - 0.05, x1, yc + 0.05, 0.05)) c = col;
      r += c[0]; g += c[1]; b += c[2]; hits++;
    }
    const i = (y * size + x) * 4;
    if (hits) { px[i] = r / hits; px[i + 1] = g / hits; px[i + 2] = b / hits; px[i + 3] = 255 * hits / (S * S); }
  }
  return encodePNG(size, size, px);
}
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const byte of buf) c = CRC_T[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function encodePNG(w, h, px) {
  const row = w * 4 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 4; x++) raw[y * row + 1 + x] = Math.round(Math.max(0, Math.min(255, px[y * w * 4 + x])));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
  let src = fs.readFileSync(path.join(ROOT, 'floorboard.html'), 'utf8');
  for (const [file, url] of Object.entries(VENDOR)) {
    const dest = path.join(OUT, 'vendor', file);
    if (!fs.existsSync(dest)) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed: ' + url + ' (' + res.status + ')');
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    }
    if (!src.includes(`src="${url}"`)) throw new Error('Script tag not found for ' + url);
    src = src.replace(`src="${url}"`, `src="vendor/${file}"`);
  }
  for (const lib of LAZY) {
    for (const file of lib.files) {
      const dest = path.join(OUT, 'vendor', file);
      if (!fs.existsSync(dest)) {
        const res = await fetch(lib.base + file);
        if (!res.ok) throw new Error('Download failed: ' + lib.base + file + ' (' + res.status + ')');
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      }
    }
    if (src.split("'" + lib.base + "'").length !== 2) throw new Error('Address not found in the page: ' + lib.base);
    src = src.replace("'" + lib.base + "'", "'vendor/'");
  }
  const sbDest = path.join(OUT, 'vendor', SUPABASE.file);
  if (!fs.existsSync(sbDest)) {
    const res = await fetch(SUPABASE.url);
    if (!res.ok) throw new Error('Download failed: ' + SUPABASE.url + ' (' + res.status + ')');
    fs.writeFileSync(sbDest, Buffer.from(await res.arrayBuffer()));
  }
  const htmTag = '<script src="vendor/htm.umd.js"></script>';
  if (!src.includes(htmTag)) throw new Error('htm script tag not found');
  src = src.replace(htmTag, htmTag + '\n<script src="vendor/supabase.js"></script>\n<script src="config.js"></script>');
  if (!fs.existsSync(path.join(OUT, 'config.js'))) fs.writeFileSync(path.join(OUT, 'config.js'), CONFIG_TEMPLATE);
  fs.writeFileSync(path.join(OUT, 'index.html'), HEAD + src + TAIL);
  fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2));
  fs.writeFileSync(path.join(OUT, 'sw.js'), SW);
  fs.writeFileSync(path.join(OUT, 'icon.svg'), ICON_SVG);
  fs.writeFileSync(path.join(OUT, 'icon-192.png'), drawIcon(192));
  fs.writeFileSync(path.join(OUT, 'icon-512.png'), drawIcon(512));
  fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), drawIcon(512, true));
  // a copy of the source goes in the repository too, so every push backs it up
  fs.mkdirSync(path.join(OUT, 'source'), { recursive: true });
  for (const [from, to] of [[path.join(ROOT, 'floorboard.html'), 'floorboard.html'], [__filename, 'build.js']]) {
    const dest = path.join(OUT, 'source', to);
    if (path.resolve(from) !== path.resolve(dest)) fs.copyFileSync(from, dest);
  }
  console.log('Built ' + OUT);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
