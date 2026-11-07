// WhatsApp in Floorboard's island, through a WhatsApp gateway on this computer (GOWA, go-whatsapp-web-multidevice: a
// linked device of the person's own WhatsApp, answering on 127.0.0.1 only). Floorboard reads the chats, counts what came
// in since the WhatsApp card was last opened, opens a chat to read, finds people in the address book, and sends a
// message only when the person presses Enter or Send in the island, only to a chat they already have or someone in their
// own contacts (never a typed-in number), and not too fast.
// Nothing goes to Floorboard's server: the island gets it from here, on this computer.
const fs = require('fs'), path = require('path'), { spawn, execFile } = require('child_process');
const { app, shell } = require('electron');

const BASE = (process.env.FLOORBOARD_WA_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
// The gateway already linked to the person's WhatsApp on this computer: Coucou installed it (checked against its
// release's checksum) in its folder, which also holds the link (storages/whatsapp.db). When nothing is answering,
// Floorboard starts that gateway itself, the same way. The first time, it copies the gateway and the link into its own
// folder and runs it from there, so WhatsApp stays linked even with Coucou removed, without scanning the code again.
// (It only copies while the gateway is stopped, so the link is copied whole.) It stops the gateway when Floorboard quits.
// (a separate profile, as on a new computer, doesn't take it)
const COUCOU_GOWA = process.env.FLOORBOARD_PROFILE ? '' : path.join(process.env.LOCALAPPDATA || '', 'Coucou', 'GOWA');
const ownGowa = () => path.join(app.getPath('userData'), 'whatsapp-gateway');
const linked = (dir) => !!dir && fs.existsSync(path.join(dir, 'gowa.exe')) && fs.existsSync(path.join(dir, 'storages', 'whatsapp.db'));
function gowaDir() {
  if (process.env.FLOORBOARD_GOWA_DIR) return process.env.FLOORBOARD_GOWA_DIR;
  const own = ownGowa();
  if (linked(own)) return own;
  if (!linked(COUCOU_GOWA)) return '';
  try { // Floorboard's own copy: the program and the link (not the downloaded pictures and files)
    fs.mkdirSync(own, { recursive: true });
    fs.copyFileSync(path.join(COUCOU_GOWA, 'gowa.exe'), path.join(own, 'gowa.exe'));
    fs.cpSync(path.join(COUCOU_GOWA, 'storages'), path.join(own, 'storages'), { recursive: true });
    return own;
  } catch (e) { return COUCOU_GOWA; }
}
// (or Floorboard's own gateway that isn't linked to a phone yet)
const gowaOrOwn = () => gowaDir() || (fs.existsSync(path.join(ownGowa(), 'gowa.exe')) ? ownGowa() : '');
let gateway = null, gatewayAt = 0;
function startGateway(now) {
  if (gateway || process.env.FLOORBOARD_WA_URL || (!now && Date.now() - gatewayAt < 60 * 1000)) return;
  gatewayAt = Date.now();
  const dir = gowaOrOwn(); if (!dir) return;
  const exe = path.join(dir, 'gowa.exe');
  try {
    gateway = spawn(exe, ['rest', '--host=127.0.0.1', '--port=3000', '--auto-download-media=false'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
    gateway.on('exit', () => { gateway = null; });
    gateway.on('error', () => { gateway = null; });
  } catch (e) { gateway = null; }
}
const EVERY = 15 * 1000;
const seenFile = () => path.join(app.getPath('userData'), 'whatsapp-seen.json');

let device = '', me = '', timer = null, changed = () => {}, state = { connected: false, error: '' };
let chats = [];               // [{ jid, name, at, group }] newest first
let seen = { card: 0, chats: {} }; // when each chat was last opened here
// jid → { at: the chat's last message time when counted, unread: messages from others since the person last wrote there
// or opened it here }. The gateway doesn't keep WhatsApp's own unread marks, so this is the count: what's come in that
// hasn't been answered or read here.
const unread = new Map();
const startAt = Date.now();   // messages from before Floorboard started don't pop the island open
let book = null, bookAt = 0;  // the address book, kept 10 minutes while the search is in use
const sent = [];              // when the last messages went, for the rate limit
let latest = null;            // the newest message from someone else, for the island to show: { jid, name, text, at }
let ringing = null;           // a call coming in: { jid, name, at }
// With Floorboard's island chosen, the gateway tells Floorboard straight away when a message or a call comes in (its
// webhook, to Floorboard's own server on this computer, with a key made fresh each time Floorboard starts).
let hookUrl = '', hookFor = '';

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const when = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isPerson = (jid) => /@s\.whatsapp\.net$/.test(jid);
const digits = (jid) => String(jid || '').split('@')[0].replace(/\D/g, '');

function load() { try { const s = JSON.parse(fs.readFileSync(seenFile(), 'utf8')); if (s && typeof s === 'object') seen = { card: Number(s.card) || 0, chats: s.chats || {} }; } catch (e) { /* first run */ } }
function save() { try { fs.writeFileSync(seenFile(), JSON.stringify(seen)); } catch (e) { /* kept for now only */ } }

async function call(method, p, query, body) {
  const u = new URL(BASE + p);
  Object.entries(query || {}).forEach(([k, v]) => u.searchParams.set(k, v));
  if (device) u.searchParams.set('device_id', device);
  let res;
  try { res = await fetch(u, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) }); }
  catch (e) { throw new Error('WhatsApp isn’t connected on this computer.'); }
  let j = null; try { j = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok || (j && j.code && !/^SUCCESS$/i.test(j.code) && !j.results)) throw new Error(str((j && j.message) || 'WhatsApp answered ' + res.status + '.', 200));
  return (j && j.results) || {};
}

// A device linked to a phone: "logged_in", or the gateway's own check says it's logged in. (A device can show
// "connected" while it's only waiting for its QR code to be scanned: that isn't linked.)
async function loggedIn(d) {
  if (/^logged_in$/i.test(String((d && d.state) || ''))) return true;
  if (!d || /^(disconnected|logged_out)$/i.test(String(d.state || ''))) return false;
  try { const st = await call('GET', '/devices/' + encodeURIComponent(str(d.id || d.device_id, 120)) + '/status'); return !!(st && st.is_logged_in); } catch (e) { return false; }
}
async function linkedDevice(ds) { for (const d of (Array.isArray(ds) ? ds : [])) if (await loggedIn(d)) return d; return null; }
async function findDevice() {
  const d = await linkedDevice(await call('GET', '/devices'));
  if (!d) throw new Error('WhatsApp isn’t linked yet: link it with your phone first.');
  device = str(d.id || d.device_id, 120); me = str(d.jid, 120);
}

function cleanChat(c) { return { jid: str(c.jid, 120), name: str(c.name, 80) || '+' + digits(c.jid), at: when(c.last_message_time), group: /@g\.us$/.test(c.jid || '') }; }
function cleanMsg(m) {
  return { id: str(m.id, 120), fromMe: !!m.is_from_me, who: m.is_from_me ? 'You' : str(m.sender_display_name, 60) || '+' + digits(m.sender_jid),
    text: str(m.content, 4000), at: when(m.timestamp), media: str(m.media_type, 20), file: str(m.filename, 120) };
}

// A chat's unread: its messages from others since the person last looked at WhatsApp in the island, wrote in that chat,
// or opened it here (and in the last day at most). A linked device isn't told what was read on the phone, so this is
// what's new since the island last showed it, as Coucou's card counted.
function count(c, ms) {
  const lastMine = Math.max(0, ...ms.filter((m) => m.fromMe).map((m) => m.at)), since = Math.max(lastMine, seen.chats[c.jid] || 0, seen.card || 0, Date.now() - 24 * 3600 * 1000);
  const fresh = ms.filter((m) => !m.fromMe && m.at > since);
  unread.set(c.jid, { at: c.at, unread: fresh.length, checked: Date.now() });
  const top = fresh.sort((a, b) => b.at - a.at)[0];
  if (top && top.at > startAt && (!latest || top.at > latest.at)) latest = { jid: c.jid, name: c.name, who: c.group ? top.who : '', text: top.text || (top.media === 'image' ? 'Photo' : top.media === 'audio' ? 'Voice note' : top.media ? top.file || 'File' : ''), at: top.at };
}
// every few seconds: the chats, and how many unread each has (a chat is looked into again only when it moved)
async function poll() {
  try {
    if (!device) await findDevice();
    const list = ((await call('GET', '/chats', { limit: '30' })).data || []).map(cleanChat).filter((c) => c.jid);
    chats = list.sort((a, b) => b.at - a.at);
    const day = Date.now() - 24 * 3600 * 1000;
    for (const c of chats.slice(0, 15)) {
      if (c.at < day) { unread.delete(c.jid); continue; }
      const had = unread.get(c.jid);
      if (had && had.at === c.at && Date.now() - (had.checked || 0) < 10 * 60 * 1000) continue; // looked again now and then, as messages age out
      count(c, ((await call('GET', '/chat/' + encodeURIComponent(c.jid) + '/messages', { limit: '20' })).data || []).map(cleanMsg));
    }
    if (hookUrl && hookFor !== device + hookUrl) {
      try { await call('PATCH', '/devices/' + encodeURIComponent(device) + '/webhook', null, { webhook_url: hookUrl, webhook_secret: hookUrl.split('k=')[1] || '', webhook_events: 'message,call.offer' }); hookFor = device + hookUrl; } catch (e) { /* polling still finds new messages */ }
    }
    state = { connected: true, error: '' };
  } catch (e) {
    if (/linked|answered/.test(e.message)) device = '';
    if (/isn’t connected/.test(e.message)) startGateway(); // nothing answering: start the linked gateway (Coucou closed, say)
    state = { connected: false, error: e.message };
  }
  changed();
}

function summary() {
  const rows = chats.slice(0, 30).map((c) => ({ ...c, unread: (unread.get(c.jid) || {}).unread || 0 }));
  // what the card offers when it isn't connected: getting WhatsApp's gateway onto this computer, or linking the phone
  const need = state.connected ? '' : !process.env.FLOORBOARD_WA_URL && !gowaOrOwn() ? 'install' : /linked yet/.test(state.error || '') ? 'link' : '';
  return { ...state, need, chats: rows, count: rows.reduce((a, c) => a + c.unread, 0), latest, ringing };
}

// what the gateway told Floorboard: a message (look now rather than at the next turn) or a call ringing
function nameOf(jid) { const c = chats.find((x) => x.jid === jid) || (book || []).find((x) => x.jid === jid); return c ? c.name : '+' + digits(jid); }
function webhook(key, body) {
  if (!hookUrl || key !== hookUrl.split('k=')[1]) return false;
  const ev = String((body && body.event) || ''), p = (body && body.payload) || {};
  if (ev === 'call.offer') {
    const jid = [p.from, p.call_creator, p.caller, p.chat_id, p.jid].map((x) => String(x || '')).find((x) => /@/.test(x)) || '';
    ringing = { jid, name: nameOf(jid), at: Date.now() };
    changed();
    setTimeout(() => { if (ringing && Date.now() - ringing.at >= 44 * 1000) { ringing = null; changed(); } }, 45 * 1000);
  } else if (/^message/.test(ev)) poll();
  return true;
}
// the island was chosen (url) or not (''): the gateway then tells Floorboard of new messages and calls, or stops
function setHook(url) { hookUrl = url || ''; hookFor = ''; if (hookUrl) poll(); }
function endCall() { ringing = null; changed(); }

// the person looked at WhatsApp in the island and moved on: what was there is no longer new
function opened() { seen.card = Date.now(); unread.forEach((v) => { v.unread = 0; }); save(); changed(); }

// a chat opened in the island: its count clears, and (unless switched off in ⚙) WhatsApp marks it read on the phone
// too, as Coucou did with "mark read on open"
async function messages(jid, markRead) {
  const c = chats.find((x) => x.jid === jid); if (!c) return { error: 'That chat isn’t in your recent chats.' };
  try {
    const ms = ((await call('GET', '/chat/' + encodeURIComponent(jid) + '/messages', { limit: '60' })).data || []).map(cleanMsg).sort((a, b) => a.at - b.at);
    const had = (unread.get(jid) || {}).unread || 0;
    seen.chats[jid] = Date.now(); unread.set(jid, { at: c.at, unread: 0 }); save(); changed();
    const last = ms.filter((m) => !m.fromMe).pop();
    if (markRead && had && last) call('POST', '/message/' + encodeURIComponent(last.id) + '/read', null, { phone: jid }).catch(() => {});
    return { chat: c, messages: ms };
  } catch (e) { return { error: e.message }; }
}

// people and chats matching every word typed (accents or not), or the digits of a number; chats first
async function find(q) {
  const words = plain(q).split(/\s+/).filter(Boolean), num = String(q || '').replace(/\D/g, '');
  if (!words.length) return { results: [] };
  const hit = (name, jid) => (num.length >= 4 && digits(jid).includes(num)) || words.every((w) => plain(name).includes(w));
  try {
    if (!book || Date.now() - bookAt > 10 * 60 * 1000) {
      if (!device) await findDevice();
      book = ((await call('GET', '/user/my/contacts')).data || []).filter((x) => x && isPerson(x.jid)).map((x) => ({ jid: str(x.jid, 120), name: str(x.name, 80) }));
      bookAt = Date.now();
    }
  } catch (e) { if (!chats.length) return { error: e.message }; }
  const inChats = chats.filter((c) => hit(c.name, c.jid)).map((c) => ({ jid: c.jid, name: c.name, chat: true }));
  const people = (book || []).filter((x) => !inChats.some((c) => c.jid === x.jid) && hit(x.name, x.jid)).slice(0, 20).map((x) => ({ ...x, name: x.name || '+' + digits(x.jid), chat: false }));
  return { results: [...inChats, ...people].slice(0, 25) };
}

// a message, sent only from the island on the person's own Enter or Send, to a chat they have or one of their contacts
async function send(jid, text) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Type a message first.' };
  if (t.length > 4000) return { error: 'That message is too long for one go.' };
  const known = chats.some((c) => c.jid === jid) || ((book || []).some((x) => x.jid === jid) && isPerson(jid));
  if (!known) return { error: 'Messages go only to your own chats and contacts.' };
  const now = Date.now();
  while (sent.length && now - sent[0] > 60 * 1000) sent.shift();
  if (sent.length >= 12 || (sent.length && now - sent[sent.length - 1] < 1500)) return { error: 'Slow down a little: wait a moment and send again.' };
  try {
    await call('POST', '/send/message', null, { phone: jid, message: t });
    sent.push(now); seen.chats[jid] = now; save();
    setTimeout(poll, 1500);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
}

// WhatsApp Desktop on that chat (the Microsoft Store app answers whatsapp:), or WhatsApp Web if it isn't there
async function openApp(jid) {
  const n = jid && isPerson(jid) ? digits(jid) : '';
  try { await shell.openExternal(n ? 'whatsapp://send?phone=' + n : 'whatsapp://'); }
  catch (e) { await shell.openExternal(n ? 'https://web.whatsapp.com/send?phone=' + n : 'https://web.whatsapp.com'); }
  return { ok: true };
}

// Linking WhatsApp on a computer that hasn't got the gateway: when the person asks to (the island's WhatsApp card),
// Floorboard downloads GOWA's official Windows release, one fixed version, and uses it only if its SHA-256 matches the one
// GOWA published for it; it unpacks it into its own folder and starts it. Then the island shows the QR code to scan with
// the phone (WhatsApp → Settings → Linked devices → Link a device), a new one as each runs out, until the phone has linked.
const GOWA_RELEASE = {
  url: 'https://github.com/aldinokemal/go-whatsapp-web-multidevice/releases/download/v9.9.0/whatsapp_9.9.0_windows_amd64.zip',
  sha256: '51fa01ee9379cb8201c4ae07d54fca1b05aee0770a20de91773255dbd3913b69', size: 13414155,
};
// (the test run points it at a stand-in download)
if (process.env.FLOORBOARD_SMOKE && process.env.FLOORBOARD_GOWA_ZIP) Object.assign(GOWA_RELEASE, { url: process.env.FLOORBOARD_GOWA_ZIP, sha256: process.env.FLOORBOARD_GOWA_SHA || '', size: 0 });
let installing = null, linking = '';
function findExe(dir, depth = 0) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), st = fs.statSync(p);
    if (st.isFile() && /\.exe$/i.test(n)) return p;
    if (st.isDirectory() && depth < 3) { const x = findExe(p, depth + 1); if (x) return x; }
  }
  return '';
}
function install() {
  if (gowaOrOwn() || process.env.FLOORBOARD_WA_URL) { startGateway(true); return Promise.resolve({ ok: true }); }
  if (installing) return installing;
  installing = (async () => {
    const tmp = path.join(app.getPath('temp'), 'floorboard-gowa-' + Date.now());
    try {
      const res = await fetch(GOWA_RELEASE.url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60 * 1000) });
      if (!res.ok) throw new Error('The download didn’t work (' + res.status + '). Check the internet connection and try again.');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 80 * 1048576 || require('crypto').createHash('sha256').update(buf).digest('hex') !== GOWA_RELEASE.sha256) throw new Error('The download didn’t match the WhatsApp gateway’s official release, so it wasn’t used.');
      fs.mkdirSync(tmp, { recursive: true });
      const zip = path.join(tmp, 'gowa.zip');
      fs.writeFileSync(zip, buf);
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      await new Promise((ok, no) => execFile(tar, ['-xf', zip, '-C', tmp], { windowsHide: true }, (e) => (e ? no(new Error('Couldn’t unpack the WhatsApp gateway.')) : ok())));
      const exe = findExe(tmp); if (!exe) throw new Error('The WhatsApp gateway wasn’t in the download.');
      fs.mkdirSync(ownGowa(), { recursive: true });
      fs.copyFileSync(exe, path.join(ownGowa(), 'gowa.exe'));
      startGateway(true);
      return { ok: true };
    } catch (e) { return { error: str(e.message, 200) }; } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the temp folder goes later */ }
      installing = null;
    }
  })();
  return installing;
}
// the QR code to scan (as a picture), and how long it lasts
async function linkQr() {
  try {
    let list = null;
    for (let i = 0; i < 20 && !list; i++) { try { list = await call('GET', '/devices'); } catch (e) { startGateway(); await new Promise((r) => setTimeout(r, 1000)); } }
    if (!list) return { error: 'WhatsApp’s gateway didn’t start on this computer. Try again in a minute.' };
    const ds = Array.isArray(list) ? list : [];
    if (await linkedDevice(ds)) { device = ''; poll(); return { linked: true }; }
    let id = str((ds[0] && (ds[0].id || ds[0].device_id)) || '', 120);
    if (!id) { const r = await call('POST', '/devices', null, { device_id: 'floorboard' }); id = str(r.id || r.device_id || 'floorboard', 120); }
    linking = id;
    const r = await call('GET', '/devices/' + encodeURIComponent(id) + '/login');
    const at = new URL(String(r.qr_link || ''), BASE), png = await fetch(BASE + at.pathname, { signal: AbortSignal.timeout(10000) });
    if (!png.ok) throw new Error('The code didn’t come through. Try again.');
    return { qr: 'data:image/png;base64,' + Buffer.from(await png.arrayBuffer()).toString('base64'), seconds: Math.max(10, Number(r.qr_duration) || 30) };
  } catch (e) {
    if (/already/i.test(e.message)) { device = ''; poll(); return { linked: true }; }
    return { error: str(e.message, 200) };
  }
}
// has the phone linked it yet?
async function linkStatus() {
  if (state.connected) return { linked: true };
  if (!linking) return { linked: false };
  try {
    const r = await call('GET', '/devices/' + encodeURIComponent(linking) + '/status');
    if (r && (r.is_logged_in || r.logged_in)) { linking = ''; device = ''; await poll(); return { linked: true }; }
  } catch (e) { /* asked again in a moment */ }
  return { linked: false };
}

function init(onChange) { changed = onChange || changed; load(); if (!seen.card) { seen.card = Date.now(); save(); } if (!timer) { poll(); timer = setInterval(poll, EVERY); } }
function stop() { clearInterval(timer); timer = null; if (gateway) { try { gateway.kill(); } catch (e) { /* gone already */ } gateway = null; } }

module.exports = { init, stop, summary, opened, messages, find, send, openApp, webhook, setHook, endCall, install, linkQr, linkStatus };
