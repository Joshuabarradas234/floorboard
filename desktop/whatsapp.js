// WhatsApp on this computer, beside Floorboard. It runs GOWA (go-whatsapp-web-multidevice, MIT), an open-source helper
// that links to the person's phone the way WhatsApp Web does (WhatsApp > Settings > Linked devices > scan the QR code).
// It's not made by WhatsApp. Everything stays on this computer: the helper only listens on 127.0.0.1 behind a password,
// and no WhatsApp message ever goes to the store's server.
const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), net = require('net');
const { spawn, execFile } = require('child_process');

const GOWA = {
  version: '9.8.0',
  url: 'https://github.com/aldinokemal/go-whatsapp-web-multidevice/releases/download/v9.8.0/whatsapp_9.8.0_windows_amd64.zip',
  sha256: 'acbc474f1483ba01a707214549972bc1dc2432539d7c2a3b9e6e3ddcf336749d',
};
// For testing: FLOORBOARD_WA_MOCK=http://127.0.0.1:<port> talks to a stand-in instead of downloading and running GOWA.
const MOCK = process.env.FLOORBOARD_WA_MOCK || '';
const JID = /^[\w.:+-]+@[\w.]+$/;

let dir = '', proc = null, base = MOCK, auth = '', timer = null;
let state = { installed: !!MOCK, running: false, linked: false, phone: '', busy: '', progress: 0, error: '' };
let chats = [], seen = {}, lastMsg = {};

const file = (...p) => path.join(dir, ...p);
function send(ch, data) { BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send(ch, data); }); }
function set(patch) { state = { ...state, ...patch }; send('wa-state', state); }
function loadJson(f, d) { try { return JSON.parse(fs.readFileSync(file(f), 'utf8')); } catch (e) { return d; } }
function saveJson(f, v) { try { fs.writeFileSync(file(f), JSON.stringify(v)); } catch (e) { /* not fatal */ } }
const exePath = () => { try { const f = fs.readdirSync(file('bin')).find((x) => /\.exe$/i.test(x)); return f ? file('bin', f) : ''; } catch (e) { return ''; } };

// The helper's own commands (its replies come as { code, message, results })
async function api(p, opts = {}) {
  const res = await fetch(base + p, { ...opts, headers: { Authorization: auth, 'Content-Type': 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || 'WhatsApp helper answered ' + res.status);
  return body.results;
}

function freePort() {
  return new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
}

// Download the helper once, check it's exactly the published file, and unpack it.
async function install() {
  set({ busy: 'Downloading WhatsApp helper…', progress: 0, error: '' });
  const res = await fetch(GOWA.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('Download failed (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 13373724, chunks = []; let got = 0;
  for await (const c of res.body) { chunks.push(c); got += c.length; set({ progress: Math.min(99, Math.round((got / total) * 100)) }); }
  const zip = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  if (crypto.createHash('sha256').update(zip).digest('hex') !== GOWA.sha256) throw new Error('The downloaded helper didn’t match the published file, so it wasn’t used.');
  fs.mkdirSync(file('bin'), { recursive: true });
  fs.writeFileSync(file('gowa.zip'), zip);
  set({ busy: 'Unpacking…' });
  await new Promise((ok, no) => execFile('tar', ['-xf', file('gowa.zip'), '-C', file('bin')], { windowsHide: true }, (e) => (e ? no(e) : ok())));
  fs.unlinkSync(file('gowa.zip'));
  if (!exePath()) throw new Error('The helper didn’t unpack properly.');
  saveJson('version.json', { version: GOWA.version });
}

async function start() {
  if (MOCK) { auth = 'Basic ' + Buffer.from('fb:test').toString('base64'); set({ running: true }); return; }
  if (proc) return;
  const exe = exePath(); if (!exe) throw new Error('Not installed');
  const port = await freePort(), pass = crypto.randomBytes(18).toString('hex');
  // its session (the link to the phone) is kept in whatsapp/storages, beside the helper, with its own default settings
  proc = spawn(exe, ['rest', '--port', String(port), '--basic-auth=fb:' + pass], {
    cwd: dir, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, APP_HOST: '127.0.0.1', APP_PORT: String(port), APP_BASIC_AUTH: 'fb:' + pass },
  });
  proc.on('exit', () => { proc = null; set({ running: false }); });
  base = 'http://127.0.0.1:' + port; auth = 'Basic ' + Buffer.from('fb:' + pass).toString('base64');
  for (let i = 0; i < 40; i++) { try { await api('/app/status'); set({ running: true }); return; } catch (e) { await new Promise((r) => setTimeout(r, 500)); } }
  throw new Error('The WhatsApp helper didn’t start.');
}

const kind = (t) => (/image|sticker/i.test(t || '') ? 'Photo' : /video/i.test(t || '') ? 'Video' : /audio|ptt|voice/i.test(t || '') ? 'Voice note' : t ? 'Document' : '');
const at = (t) => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t) || 0);
function toMsg(m) { return { id: m.id, me: !!m.is_from_me, who: m.sender_display_name || '', text: m.content || '', tag: kind(m.media_type), at: at(m.timestamp) }; }

// Check the chats every few seconds; a chat's newest messages are only fetched when it has changed.
async function poll() {
  clearTimeout(timer);
  try {
    const st = await api('/app/status');
    if (!st || !st.is_logged_in) { set({ linked: false }); chats = []; send('wa-chats', chats); return; }
    if (!state.linked) saveJson('linked.json', true); // so it starts with Floorboard next time
    if (!state.linked) set({ linked: true, phone: String(st.jid || st.device_id || '').split('@')[0].split(':')[0] });
    const r = await api('/chats?limit=40&offset=0');
    const list = ((r && r.data) || []).filter((c) => !c.archived && JID.test(c.jid) && !/@broadcast|status@/.test(c.jid));
    for (const c of list.slice(0, 25)) {
      const t = at(c.last_message_time);
      if (lastMsg[c.jid] && lastMsg[c.jid].t === t) continue;
      const m = await api('/chat/' + encodeURIComponent(c.jid) + '/messages?limit=20&offset=0');
      const msgs = ((m && m.data) || []).map(toMsg).sort((a, b) => a.at - b.at);
      lastMsg[c.jid] = { t, msgs };
    }
    chats = list.slice(0, 25).map((c) => {
      const msgs = (lastMsg[c.jid] || {}).msgs || [], last = msgs[msgs.length - 1], since = seen[c.jid] || 0;
      return { jid: c.jid, name: c.name || c.jid.split('@')[0], group: /@g\.us$/.test(c.jid), at: at(c.last_message_time) || (last ? last.at : 0), last: last || null,
        unread: msgs.filter((x) => !x.me && x.at > since).length };
    }).sort((a, b) => b.at - a.at);
    send('wa-chats', chats);
    if (state.error) set({ error: '' });
  } catch (e) {
    set({ error: String((e && e.message) || e) });
  } finally {
    if (state.running) timer = setTimeout(poll, state.linked ? 6000 : 3000);
  }
}

async function setup() {
  if (state.busy) return state;
  try {
    if (!state.installed) { await install(); set({ installed: true }); }
    set({ busy: 'Starting…' });
    await start();
    set({ busy: '' });
    poll();
  } catch (e) { set({ busy: '', error: String((e && e.message) || e) }); }
  return state;
}

// The QR code to scan with the phone, as a picture the page can show (the helper gives a link to a PNG on itself)
async function qr() {
  const r = await api('/app/login');
  if (!r || !r.qr_link) return { already: true };
  const res = await fetch(r.qr_link.replace(/^https?:\/\/[^/]+/, base), { headers: { Authorization: auth } });
  const png = Buffer.from(await res.arrayBuffer());
  return { dataUrl: 'data:image/png;base64,' + png.toString('base64'), seconds: r.qr_duration || 30 };
}

const safe = (fn) => async (_e, arg) => { try { return { ok: await fn(arg || {}) }; } catch (e) { return { error: String((e && e.message) || e) }; } };
function setupIpc() {
  ipcMain.handle('wa-state', () => state);
  ipcMain.handle('wa-setup', () => setup());
  ipcMain.handle('wa-qr', safe(() => qr()));
  ipcMain.handle('wa-chats', () => chats);
  ipcMain.handle('wa-messages', safe(async ({ jid }) => {
    if (!JID.test(String(jid))) throw new Error('Not a chat');
    const m = await api('/chat/' + encodeURIComponent(jid) + '/messages?limit=40&offset=0');
    return ((m && m.data) || []).map(toMsg).sort((a, b) => a.at - b.at);
  }));
  // read when it's opened, here or on the phone: never just because it arrived
  ipcMain.handle('wa-read', safe(async ({ jid }) => {
    if (!JID.test(String(jid))) throw new Error('Not a chat');
    const msgs = (lastMsg[jid] || {}).msgs || [], last = [...msgs].reverse().find((x) => !x.me);
    seen[jid] = Date.now(); saveJson('seen.json', seen);
    if (last) await api('/message/' + encodeURIComponent(last.id) + '/read', { method: 'POST', body: JSON.stringify({ phone: jid }) }).catch(() => {});
    chats = chats.map((c) => (c.jid === jid ? { ...c, unread: 0 } : c)); send('wa-chats', chats);
    return true;
  }));
  ipcMain.handle('wa-send', safe(async ({ jid, text }) => {
    const msg = String(text || '').trim();
    if (!JID.test(String(jid)) || !msg || msg.length > 4000) throw new Error('Nothing to send');
    const r = await api('/send/message', { method: 'POST', body: JSON.stringify({ phone: jid, message: msg }) });
    delete lastMsg[jid]; setTimeout(poll, 800);
    return r;
  }));
  ipcMain.handle('wa-unlink', safe(async () => {
    try { await api('/app/logout'); } catch (e) { /* already signed out */ }
    chats = []; lastMsg = {}; seen = {}; saveJson('seen.json', seen); saveJson('linked.json', false); send('wa-chats', chats); set({ linked: false, phone: '' });
    return true;
  }));
}

// called once the app is ready: start the helper again if WhatsApp was linked before
function init() {
  dir = path.join(app.getPath('userData'), 'whatsapp');
  fs.mkdirSync(dir, { recursive: true });
  seen = loadJson('seen.json', {});
  if (!MOCK) state.installed = !!exePath();
  setupIpc();
  if (state.installed && (MOCK || loadJson('linked.json', false))) setup();
}
function stop() { clearTimeout(timer); if (proc) { try { proc.kill(); } catch (e) { /* already gone */ } proc = null; } }

module.exports = { init, stop };
