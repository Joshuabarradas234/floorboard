// WhatsApp in Floorboard's island, through a WhatsApp gateway on this computer (GOWA, go-whatsapp-web-multidevice: a
// linked device of the person's own WhatsApp, answering on 127.0.0.1 only). Floorboard reads the chats, counts what came
// in since the WhatsApp card was last opened, opens a chat to read, finds people in the address book, and sends a
// message only when the person presses Enter or Send in the island, only to a chat they already have or someone in their
// own contacts (never a typed-in number), and not too fast.
// Nothing goes to Floorboard's server: the island gets it from here, on this computer.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { app, shell } = require('electron');

const BASE = (process.env.FLOORBOARD_WA_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
// The gateway already linked to the person's WhatsApp on this computer: Coucou installed it (checked against its
// release's checksum) and starts it from its folder, which also holds the link (storages/whatsapp.db). When nothing is
// answering, Floorboard starts that same gateway the same way, so WhatsApp stays linked without Coucou running and
// without scanning the code again. It stops it again when Floorboard quits.
const GOWA_DIR = process.env.FLOORBOARD_GOWA_DIR || path.join(process.env.LOCALAPPDATA || '', 'Coucou', 'GOWA');
let gateway = null, gatewayAt = 0;
function startGateway() {
  if (gateway || process.env.FLOORBOARD_WA_URL || Date.now() - gatewayAt < 60 * 1000) return;
  const exe = path.join(GOWA_DIR, 'gowa.exe');
  if (!fs.existsSync(exe) || !fs.existsSync(path.join(GOWA_DIR, 'storages'))) return;
  gatewayAt = Date.now();
  try {
    gateway = spawn(exe, ['rest', '--host=127.0.0.1', '--port=3000', '--auto-download-media=false'], { cwd: GOWA_DIR, windowsHide: true, stdio: 'ignore' });
    gateway.on('exit', () => { gateway = null; });
    gateway.on('error', () => { gateway = null; });
  } catch (e) { gateway = null; }
}
const EVERY = 15 * 1000;
const seenFile = () => path.join(app.getPath('userData'), 'whatsapp-seen.json');

let device = '', me = '', timer = null, changed = () => {}, state = { connected: false, error: '' };
let chats = [];               // [{ jid, name, at, group }] newest first
let seen = { card: 0, chats: {} }; // when the card, and each chat, were last opened (what came before isn't counted)
const unread = new Map();     // jid → messages from others since that chat (or the card) was last opened
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

async function findDevice() {
  const ds = await call('GET', '/devices');
  const d = (Array.isArray(ds) ? ds : []).find((x) => /logged_in|connected/i.test(x.state || '')) || null;
  if (!d) throw new Error('WhatsApp isn’t linked yet: link it with your phone first.');
  device = str(d.id || d.device_id, 120); me = str(d.jid, 120);
}

function cleanChat(c) { return { jid: str(c.jid, 120), name: str(c.name, 80) || '+' + digits(c.jid), at: when(c.last_message_time), group: /@g\.us$/.test(c.jid || '') }; }
function cleanMsg(m) {
  return { id: str(m.id, 120), fromMe: !!m.is_from_me, who: m.is_from_me ? 'You' : str(m.sender_display_name, 60) || '+' + digits(m.sender_jid),
    text: str(m.content, 4000), at: when(m.timestamp), media: str(m.media_type, 20), file: str(m.filename, 120) };
}

// every few seconds: the chats, and how many new messages each has since it (or the card) was last opened
async function poll() {
  try {
    if (!device) await findDevice();
    const list = ((await call('GET', '/chats', { limit: '30' })).data || []).map(cleanChat).filter((c) => c.jid);
    const before = new Map(chats.map((c) => [c.jid, c.at]));
    chats = list.sort((a, b) => b.at - a.at);
    // a chat that moved: count its messages from others since it was last looked at (the start doesn't count)
    for (const c of chats.slice(0, 12)) {
      const since = Math.max(seen.chats[c.jid] || 0, seen.card || 0);
      if (c.at <= since || before.get(c.jid) === c.at) continue;
      const ms = ((await call('GET', '/chat/' + encodeURIComponent(c.jid) + '/messages', { limit: '20' })).data || []).map(cleanMsg);
      const fresh = ms.filter((m) => !m.fromMe && m.at > since);
      unread.set(c.jid, fresh.length);
      const top = fresh.sort((a, b) => b.at - a.at)[0];
      if (top && (!latest || top.at > latest.at)) latest = { jid: c.jid, name: c.name, who: c.group ? top.who : '', text: top.text || (top.media === 'image' ? 'Photo' : top.media === 'audio' ? 'Voice note' : top.media ? top.file || 'File' : ''), at: top.at };
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
  const rows = chats.slice(0, 30).map((c) => ({ ...c, unread: unread.get(c.jid) || 0 }));
  return { ...state, chats: rows, count: rows.reduce((a, c) => a + c.unread, 0), latest, ringing };
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

// the card was opened: what came before doesn't count any more
function opened() { seen.card = Date.now(); unread.clear(); save(); changed(); }

async function messages(jid) {
  const c = chats.find((x) => x.jid === jid); if (!c) return { error: 'That chat isn’t in your recent chats.' };
  try {
    const ms = ((await call('GET', '/chat/' + encodeURIComponent(jid) + '/messages', { limit: '60' })).data || []).map(cleanMsg).sort((a, b) => a.at - b.at);
    seen.chats[jid] = Date.now(); unread.delete(jid); save(); changed();
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

function init(onChange) { changed = onChange || changed; load(); if (!seen.card) { seen.card = Date.now(); save(); } if (!timer) { poll(); timer = setInterval(poll, EVERY); } }
function stop() { clearInterval(timer); timer = null; if (gateway) { try { gateway.kill(); } catch (e) { /* gone already */ } gateway = null; } }

module.exports = { init, stop, summary, opened, messages, find, send, openApp, webhook, setHook, endCall };
