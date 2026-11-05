// MFS's figures for Finance's card in Coucou's island: what's waiting for approval, who owes (and how much of it is late),
// and anything wrong. Read from the MFS app's Jarvis routes with its Jarvis key; MFS only answers on its own computer or
// network. Read only, every few minutes while a Finance card shows MFS. The key is kept with Windows' encryption for
// this user, never as plain text.
const { safeStorage } = require('electron');

const EVERY = 5 * 60 * 1000;
let saved = null, timer = null, now = null, changed = () => {};

const lock = (key) => (safeStorage.isEncryptionAvailable() ? 'v1:' + safeStorage.encryptString(key).toString('base64') : '');
const unlock = (s) => { try { return s && s.startsWith('v1:') ? safeStorage.decryptString(Buffer.from(s.slice(3), 'base64')) : ''; } catch (e) { return ''; } };
const rand = (cents) => 'R ' + Math.round((Number(cents) || 0) / 100).toLocaleString('en-ZA');

async function get(url, key, path) {
  let res;
  try { res = await fetch(new URL(path, url), { headers: { 'x-jarvis-key': key }, signal: AbortSignal.timeout(15000) }); }
  catch (e) { throw new Error('MFS didn’t answer at ' + url + '. Is the MFS app running, on this computer or network?'); }
  if (res.status === 401) throw new Error('MFS didn’t accept that Jarvis key.');
  if (res.status === 404) throw new Error('MFS has no Jarvis key set up yet: run pnpm jarvis:setup in the MFS app.');
  if (!res.ok) throw new Error('MFS answered ' + res.status + '.');
  return res.json();
}

// what the card says
async function read(url, key) {
  const [w, o, a] = await Promise.all([get(url, key, '/api/jarvis/waiting'), get(url, key, '/api/jarvis/owing'), get(url, key, '/api/jarvis/alerts').catch(() => null)]);
  const waiting = (w.invoices || []).length + (w.claims || []).length + (w.palletCredits || []).length;
  let owed = 0, late = 0;
  (o.rows || []).forEach((r) => (r.invoices || []).forEach((i) => { owed += Number(i.due) || 0; if (i.daysLate > 0) late += Number(i.due) || 0; }));
  const problems = a ? (a.problems || []).length : 0;
  const line = [waiting && waiting + ' waiting for approval', owed && rand(owed) + ' owed' + (late ? ' (' + rand(late) + ' late)' : ''), problems && problems + (problems === 1 ? ' problem' : ' problems')].filter(Boolean).join(' · ');
  return { line: line || 'Nothing waiting, nothing owed', busy: waiting + problems > 0 };
}

async function refresh() {
  if (!saved) return;
  try { now = await read(saved.url, unlock(saved.key)); } catch (e) { now = { line: 'MFS: ' + e.message.replace(/\.$/, ''), busy: false, error: true }; }
  changed(now);
}

// prefs: the saved { url, key } (or null); onChange(figures) whenever they change
function init(prefs, onChange) { saved = prefs && prefs.url && prefs.key ? prefs : null; changed = onChange || changed; }
// read only while a card needs it
function want(on) {
  if (on && saved && !timer) { refresh(); timer = setInterval(refresh, EVERY); }
  else if ((!on || !saved) && timer) { clearInterval(timer); timer = null; }
}
// checks the address and key work before keeping them; key may be empty to keep the saved one
async function connect(url, key) {
  const u = String(url || '').trim(), k = String(key || '').trim() || (saved && saved.url === u ? unlock(saved.key) : '');
  if (!/^https?:\/\/[^\s]+$/i.test(u)) return { error: 'That doesn’t look like an address (like http://localhost:8787).' };
  if (!k) return { error: 'Type the Jarvis key.' };
  try { now = await read(u, k); } catch (e) { return { error: e.message }; }
  const sealed = lock(k);
  if (!sealed) return { error: 'Windows couldn’t lock the key away on this computer, so it wasn’t kept.' };
  saved = { url: u, key: sealed }; changed(now);
  return { ok: true, line: now.line, saved };
}
function disconnect() { saved = null; now = null; want(false); changed(null); }
const state = () => ({ connected: !!saved, url: saved ? saved.url : '', line: now ? now.line : '' });

module.exports = { init, want, connect, disconnect, state, figures: () => now };
