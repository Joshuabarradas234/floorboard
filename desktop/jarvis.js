// JARVIS (JARVIS Armor Workspace) on this computer, for the one Floorboard account it's linked to: its own card in
// Coucou's island, a Windows notification when its work finishes or the morning brief is in, answers in Coucou's chat,
// and new jobs sent from the sidebar (artwork dropped in, the suit and client picked).
// While JARVIS runs, its control deck listens on this computer only and says where, with a new key each time JARVIS
// starts, in a file in this Windows user's profile (deck.json). Floorboard reads that file and talks to the deck on
// 127.0.0.1. Nothing from JARVIS goes to Floorboard's server; the sidebar gets it from here, on this computer.
const fs = require('fs'), path = require('path'), http = require('http');
const { app, Notification } = require('electron');

const deckFile = () => process.env.FLOORBOARD_JARVIS_DECK || path.join(app.getPath('appData'), 'jarvis-armor-workspace', 'deck.json');
const briefFile = () => path.join(app.getPath('userData'), 'jarvis-brief.json');
const HOUR = 3600 * 1000;
const ACTIVE = new Set(['queued', 'planning', 'working', 'reviewing']);
const SAY = { queued: 'waiting to start', planning: 'planning', working: 'working on it', reviewing: 'checking its work', done: 'done', failed: 'failed',
  stopped: 'stopped', budget: 'stopped at its budget', needs_brief: 'waiting for a brief from you', needs_changes: 'waiting for your changes' };
// what's worth a notification: finished, or stuck until you do something
const TELL = { done: 'Done', failed: 'Failed', needs_brief: 'Needs a brief', needs_changes: 'Needs your changes', budget: 'Stopped at its budget' };
const CAN_CONTINUE = new Set(['stopped', 'budget', 'failed']);
const MAX_FILE = 20 * 1024 * 1024, MAX_FILES = 20;

let deck = null, deckKey = '', events = null, timer = null, lastLoad = 0, loading = null;
let runs = [], floors = [], attention = [], brief = null, error = '', loaded = false, note = '';
let owner = '', who = { id: '', admin: false };
let opts = { onChange: () => {}, onOpen: () => {}, notify: () => true, icon: undefined, saveOwner: () => {} };
const told = new Map(); // run id → the status it was last known to have (to tell each change once)
const onScreen = new Set(); // notifications showing (kept so they're still there to be clicked)

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const when = (v) => { const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v || ''); return Number.isFinite(n) && n > 0 ? n : 0; };
const mine = () => !!owner && who.id === owner;
// JARVIS is installed for this Windows user (its folder is there), open or not
const installed = () => !!deck || fs.existsSync(path.dirname(deckFile()));

// where the deck is, if JARVIS is open: null when it isn't (or the file was left behind by a JARVIS that stopped)
function readDeck() {
  let d; try { d = JSON.parse(fs.readFileSync(deckFile(), 'utf8')); } catch (e) { return null; }
  const port = Number(d && d.port), token = String((d && d.token) || '');
  if (!Number.isInteger(port) || port < 1 || port > 65535 || token.length < 8 || token.length > 400 || /[\r\n]/.test(token)) return null;
  if (d.pid) { try { process.kill(Number(d.pid), 0); } catch (e) { if (e.code === 'ESRCH') return null; } }
  return { port, token, version: str(d.version, 20) };
}

function call(method, p, body, ms = 15000) {
  const d = deck;
  return new Promise((ok, no) => {
    if (!d) return no(new Error('JARVIS isn’t open on this computer.'));
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: '127.0.0.1', port: d.port, path: p, method, timeout: ms,
      headers: { 'x-deck-key': d.token, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) } }, (res) => {
      let t = ''; res.setEncoding('utf8');
      res.on('data', (c) => { t += c; if (t.length > 5e6) req.destroy(new Error('JARVIS sent too much back.')); });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ }
        if (res.statusCode === 401 || res.statusCode === 403) return no(new Error('JARVIS didn’t accept Floorboard’s key. Restart JARVIS and try again.'));
        if (res.statusCode === 404) return no(new Error('This JARVIS can’t do that yet. Update JARVIS to 1.107 or later.'));
        if (res.statusCode >= 400) { const m = j && (typeof j.error === 'string' ? j.error : (j.error && j.error.message) || j.message); return no(new Error(m ? str(m, 300) : 'JARVIS answered ' + res.statusCode + '.')); }
        ok(j || {});
      });
    });
    req.on('timeout', () => req.destroy(new Error('JARVIS took too long to answer.')));
    req.on('error', (e) => no(/too long|too much/.test(e.message) ? e : new Error('JARVIS didn’t answer. Is it still open?')));
    req.end(data);
  });
}

// a run as Floorboard keeps it
function cleanRun(r) {
  if (!r || typeof r !== 'object' || r.id == null) return null;
  return { id: str(r.id, 80), tower: str(r.tower, 60), floor: typeof r.floor === 'number' ? r.floor : str(r.floor, 40), floorName: str(r.floorName, 80),
    title: str(r.title, 160) || 'A Tower job', status: str(r.status, 20), progress: Math.max(0, Math.min(100, Math.round(Number(r.progress) || 0))),
    step: str(r.step, 160), updatedAt: when(r.updatedAt), startedAt: when(r.startedAt), finishedAt: when(r.finishedAt), error: str(r.error, 300) };
}
const where = (r) => r.floorName || (r.floor !== '' ? 'Floor ' + r.floor : '');
const order = () => runs.sort((a, b) => (ACTIVE.has(b.status) - ACTIVE.has(a.status)) || (b.updatedAt || b.startedAt) - (a.updatedAt || a.startedAt));

function notify(title, body) {
  note = str(title + (body ? ': ' + body : ''), 160);
  if (!opts.notify() || !Notification.isSupported()) return;
  try {
    const n = new Notification({ title: str(title, 80), body: str(body, 240), icon: opts.icon });
    onScreen.add(n);
    n.on('click', () => { onScreen.delete(n); opts.onOpen(); });
    n.on('close', () => onScreen.delete(n));
    n.show();
    setTimeout(() => onScreen.delete(n), 30 * 60 * 1000);
  } catch (e) { /* no notifications on this Windows */ }
}
// a run whose status moved: tell once when it's finished or needs you (not for what was already so when Floorboard looked first)
function noticed(r, live) {
  const before = told.get(r.id);
  told.set(r.id, r.status);
  if (!live || before === r.status || !TELL[r.status] || !mine()) return;
  notify('JARVIS · ' + TELL[r.status], r.title + (r.status === 'failed' && r.error ? ' (' + r.error + ')' : where(r) ? ' · ' + where(r) : ''));
}

function setRuns(t, live) {
  const list = (Array.isArray(t && t.runs) ? t.runs : []).map(cleanRun).filter(Boolean).slice(0, 30);
  list.forEach((r) => noticed(r, live));
  runs = list; order();
  if (Array.isArray(t && t.floors)) floors = t.floors.filter((f) => f && f.floor != null).slice(0, 80).map((f) => ({ tower: str(f.tower, 60), towerName: str(f.towerName, 80), floor: typeof f.floor === 'number' ? f.floor : str(f.floor, 40), number: f.number == null ? '' : str(f.number, 10), name: str(f.name, 80), images: f.images !== false }));
}
function setAttention(a) {
  attention = (Array.isArray(a && a.items) ? a.items : []).slice(0, 30).map((x) => ({ kind: str(x && x.kind, 20), title: str(x && x.title, 160), detail: str(x && x.detail, 300), at: when(x && x.at) }));
}

async function load() {
  if (loading) return loading;
  lastLoad = Date.now();
  loading = (async () => {
    try {
      const [t, a] = await Promise.all([call('GET', '/api/tower'), call('GET', '/api/attention').catch(() => null)]);
      setRuns(t, loaded); if (a) setAttention(a); error = '';
    } catch (e) { error = e.message; }
    loaded = true; loading = null; listen(); opts.onChange();
  })();
  return loading;
}

function onEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  if (ev.type === 'tower' && ev.run) {
    const r = cleanRun(ev.run); if (!r) return;
    noticed(r, true);
    runs = [r, ...runs.filter((x) => x.id !== r.id)].slice(0, 30); order();
    opts.onChange();
  } else if (ev.type === 'brief') {
    brief = { title: str(ev.title, 80) || 'Morning brief', text: String(ev.text || '').slice(0, 12000), at: when(ev.at) || Date.now() };
    try { fs.writeFileSync(briefFile(), JSON.stringify(brief)); } catch (e) { /* kept for now only */ }
    if (mine()) notify('JARVIS · ' + brief.title, brief.text.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).filter(Boolean).slice(0, 2).join(' · '));
    opts.onChange();
  } else if (ev.type === 'attention') {
    call('GET', '/api/attention').then((a) => { setAttention(a); opts.onChange(); }).catch(() => {});
  }
}

// JARVIS's events as they happen (server-sent events on the deck); picked up again if it drops
function listen() {
  const d = deck; if (!d || events || !mine()) return;
  const req = http.request({ host: '127.0.0.1', port: d.port, path: '/api/events', method: 'GET', headers: { 'x-deck-key': d.token, Accept: 'text/event-stream' } }, (res) => {
    if (res.statusCode !== 200) { res.resume(); return; }
    let buf = ''; res.setEncoding('utf8');
    res.on('data', (c) => {
      buf = (buf + c).replace(/\r\n/g, '\n'); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const data = buf.slice(0, i).split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n'); buf = buf.slice(i + 2);
        if (data) { try { onEvent(JSON.parse(data)); } catch (e) { /* not one of ours */ } }
      }
      if (buf.length > 1e6) buf = '';
    });
    res.on('close', () => { if (events === req) events = null; });
  });
  req.on('error', () => { if (events === req) events = null; });
  req.on('close', () => { if (events === req) events = null; });
  req.end();
  events = req;
}
function drop() { if (events) { const e = events; events = null; e.destroy(); } }

// every few seconds: has JARVIS opened, closed or restarted? Looks only at the file until an account is linked and signed in.
function tick() {
  const d = readDeck(), key = d ? d.port + '|' + d.token : '';
  if (key !== deckKey) {
    deckKey = key; deck = d; drop(); runs = []; floors = []; attention = []; error = ''; loaded = false; told.clear();
    if (d && mine()) load(); else opts.onChange();
    return;
  }
  if (!d || !mine()) { if (events) drop(); return; }
  if (!events && loaded) listen();
  if (Date.now() - lastLoad > 60 * 1000) load(); // and a fresh look now and then, in case an event went missing
}

// o: { owner (the linked account's id), notify() (notifications on?), icon, onChange(), onOpen(), saveOwner(id) }
function init(o) {
  opts = { ...opts, ...o }; owner = String(o.owner || '');
  try { const b = JSON.parse(fs.readFileSync(briefFile(), 'utf8')); if (b && b.text) brief = { title: str(b.title, 80) || 'Morning brief', text: String(b.text).slice(0, 12000), at: when(b.at) }; } catch (e) { /* no brief yet */ }
  if (timer) return;
  tick(); timer = setInterval(tick, 5000);
}
// who's signed in to Floorboard here (from the sidebar)
function setWho(w) {
  const next = { id: str(w && w.id, 80), admin: !!(w && w.admin) };
  if (next.id === who.id && next.admin === who.admin) return;
  const was = mine(); who = next;
  if (mine() && !was) { told.clear(); loaded = false; if (deck) load(); }
  if (!mine() && was) drop();
  opts.onChange();
}
function link() {
  if (!who.id || !installed()) return { error: 'JARVIS isn’t on this computer.' };
  if (owner && owner !== who.id) return { error: 'JARVIS is linked to another Floorboard account on this computer.' };
  if (!owner && !who.admin) return { error: 'Only an admin can link JARVIS.' };
  owner = who.id; opts.saveOwner(owner); told.clear(); loaded = false; if (deck) load(); opts.onChange();
  return { ok: true };
}
function unlink() { if (!mine()) return { error: 'Only the account it’s linked to can unlink it.' }; owner = ''; opts.saveOwner(''); drop(); opts.onChange(); return { ok: true }; }

// what the sidebar sees: nothing at all unless JARVIS is on this computer; JARVIS's work only for the account it's linked to
function state() {
  const found = !!deck, base = { found, installed: installed(), linked: !!owner, mine: mine(), canLink: installed() && !owner && who.admin };
  if (!found || !mine()) return base;
  return { ...base, connected: loaded && !error, loading: !loaded, error, version: deck.version, runs, floors, attention, brief };
}
const ready = () => !!deck && mine();

// JARVIS's card in Coucou's island: what it's doing, what needs you, or what it last finished. It's there for the linked
// account whether JARVIS is open or not (and asks an admin to link it, on a computer with JARVIS and nothing linked yet).
function card() {
  if (!mine()) return !owner && who.admin && installed() ? { id: 'jarvis', title: 'JARVIS', line: 'Link me in Floorboard’s sidebar', busy: false, note } : null;
  if (!deck) return { id: 'jarvis', title: 'JARVIS', line: 'Not connected · open JARVIS', busy: false, note };
  if (!loaded) return { id: 'jarvis', title: 'JARVIS', line: 'Connecting…', busy: false, note };
  if (error) return { id: 'jarvis', title: 'JARVIS', line: str('JARVIS: ' + error.replace(/\.$/, ''), 80), busy: false, note };
  const active = runs.filter((r) => ACTIVE.has(r.status)), need = attention.length, top = active[0];
  const bits = [need && need + (need === 1 ? ' needs you' : ' need you')];
  if (top) bits.push(active.length > 1 && active.length + ' working', str(top.title, 44) + ' ' + top.progress + '%');
  else { const fin = runs.find((r) => r.status === 'done' && Date.now() - (r.finishedAt || r.updatedAt) < 12 * HOUR); bits.push(fin ? 'Done: ' + str(fin.title, 60) : !need && 'All quiet'); }
  return { id: 'jarvis', title: 'JARVIS', line: bits.filter(Boolean).join(' · ').slice(0, 80), busy: active.length > 0 || need > 0, note };
}

/* ---------- asking JARVIS from Coucou's chat ---------- */
const STOP = new Set('the a an and or of to for with is are was it its it’s how far what whats what’s where when who which on in at this that there any my me you your jarvis hey ok okay please can could tell show give about status with job jobs run runs task tasks work working doing going along progress update far been has have get got'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w));
function clock(t) {
  if (!t) return '';
  const d = new Date(t), today = new Date().toDateString() === d.toDateString();
  return (today ? '' : d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ') + d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
}
function describe(r) {
  const s = SAY[r.status] || r.status, at = where(r);
  let t = '“' + r.title + '”' + (at ? ' (' + at + ')' : '') + ' is ' + s;
  if (ACTIVE.has(r.status)) t += ', ' + r.progress + '% of the way' + (r.step ? ': ' + r.step : '') + (r.startedAt ? '. Started ' + clock(r.startedAt) : '');
  else if (r.status === 'done') t += r.finishedAt ? ', finished ' + clock(r.finishedAt) : '';
  else { if (r.error) t += ': ' + r.error; if (r.step) t += ' (last step: ' + r.step + ')'; }
  return t + '.';
}
function overview() {
  const active = runs.filter((r) => ACTIVE.has(r.status)), stuck = runs.filter((r) => !ACTIVE.has(r.status) && r.status !== 'done'),
    done = runs.filter((r) => r.status === 'done' && Date.now() - (r.finishedAt || r.updatedAt) < 24 * HOUR);
  const out = [];
  out.push(active.length ? 'Working on ' + active.length + ':\n' + active.map((r) => '• ' + describe(r)).join('\n') : 'Nothing running in the Tower right now.');
  if (stuck.length) out.push('Waiting on you or stopped:\n' + stuck.slice(0, 6).map((r) => '• ' + describe(r)).join('\n'));
  if (done.length) out.push('Done in the last day:\n' + done.slice(0, 6).map((r) => '• “' + r.title + '”' + (r.finishedAt ? ' at ' + clock(r.finishedAt) : '')).join('\n'));
  if (attention.length) out.push(attention.length + (attention.length === 1 ? ' thing needs you' : ' things need you') + ' in JARVIS (ask “what needs me?”).');
  return out.join('\n\n');
}
function best(q) {
  const ws = words(q); if (!ws.length) return [];
  const scored = runs.map((r) => { const hay = (r.title + ' ' + r.floorName + ' ' + r.step).toLowerCase(); return { r, n: ws.filter((w) => hay.includes(w)).length }; }).filter((x) => x.n > 0);
  const top = Math.max(0, ...scored.map((x) => x.n));
  return scored.filter((x) => x.n === top).map((x) => x.r);
}
// question, history ([{ role, text }]), step(text) → the answer as text
async function answer(question, history, step) {
  if (!deck) return 'JARVIS isn’t open on this computer. Open JARVIS and ask again.';
  if (!mine()) return 'JARVIS answers only for the Floorboard account it’s linked to on this computer.';
  step('Asking JARVIS');
  await load();
  if (error) return error;
  const q = String(question || '').replace(/^\s*(hey |ok |okay )?jarvis[,:!.\s]*/i, '').trim(), lq = q.toLowerCase();
  const lastSaid = (Array.isArray(history) ? history : []).filter((m) => m.role === 'assistant').map((m) => m.text).pop() || '';
  // “yes” to carrying on a job it offered to continue
  const offered = lastSaid.match(/Continue “(.+?)” where it stopped\?/);
  if (offered && /^(yes|yep|yeah|ja|go|go ahead|do it|ok|okay|sure|please)\b/i.test(q)) {
    const r = runs.find((x) => x.title === offered[1] && CAN_CONTINUE.has(x.status));
    if (!r) return 'That job isn’t stopped any more, so there’s nothing to continue.';
    step('Continuing “' + r.title + '”');
    try { const res = await call('POST', '/api/tower/continue', { runId: r.id }, 60000); load(); return res && res.pending ? (res.message || 'It’s waiting for your approval in JARVIS.') : 'Carrying on with “' + r.title + '”. I’ll let you know when it’s done.'; }
    catch (e) { return 'JARVIS couldn’t continue it: ' + e.message; }
  }
  if (/\b(continue|resume|carry on|pick up|restart)\b/.test(lq)) {
    const can = runs.filter((r) => CAN_CONTINUE.has(r.status)), hit = best(q).filter((r) => CAN_CONTINUE.has(r.status));
    const r = hit[0] || (can.length === 1 ? can[0] : null);
    if (r) return describe(r) + '\n\nContinue “' + r.title + '” where it stopped? Say yes to go ahead. (It may cost money, so JARVIS might ask you to approve it.)';
    return can.length ? 'Which one? These can carry on:\n' + can.map((x) => '• “' + x.title + '” (' + SAY[x.status] + ')').join('\n') : 'Nothing is stopped, so there’s nothing to continue.';
  }
  if (/\b(brief|briefing|morning)\b/.test(lq)) return brief ? brief.title + (brief.at ? ' (' + clock(brief.at) + ')' : '') + '\n\n' + brief.text : 'No morning brief has come in since Floorboard started listening.';
  if (/\b(need|needs|waiting|approve|approval|attention|blocked)\b/.test(lq)) {
    return attention.length ? 'In JARVIS, ' + (attention.length === 1 ? 'this needs you' : 'these need you') + ':\n' + attention.map((a) => '• ' + a.title + (a.detail ? ': ' + a.detail : '') + (a.kind ? ' (' + a.kind + ')' : '')).join('\n') : 'Nothing in JARVIS needs you right now.';
  }
  if (/^(please )?(start|send|begin|kick off|make|create)\b|\b(new job|start (a|an|some|the|on)|send (it|them|you|some)|drop)\b/.test(lq)) {
    opts.onOpen();
    return 'To start a job, drop the artwork onto JARVIS in Floorboard’s sidebar (I’ve opened it), pick the suit and the client, and say what to do with it. JARVIS checks with you before it starts.';
  }
  const hits = best(q);
  if (hits.length) return hits.slice(0, 4).map(describe).join('\n\n');
  if (/\b(done|finished|completed|ready)\b/.test(lq)) {
    const done = runs.filter((r) => r.status === 'done');
    return done.length ? 'Finished lately:\n' + done.slice(0, 8).map((r) => '• “' + r.title + '”' + (r.finishedAt ? ' at ' + clock(r.finishedAt) : '')).join('\n') : 'Nothing has finished in the last two days.';
  }
  return overview();
}

/* ---------- jobs from the sidebar ---------- */
async function suits() {
  const s = await call('GET', '/api/suits');
  return (Array.isArray(s && s.suits) ? s.suits : []).slice(0, 60).map((x) => ({ id: str(x && x.id, 80), name: str(x && x.name, 80), hall: str(x && (x.hallName || x.hall), 80),
    clients: (Array.isArray(x && x.clients) ? x.clients : []).slice(0, 80).map((c) => str(c, 120)).filter(Boolean), reachable: !(x && x.reachable === false) })).filter((x) => x.id);
}
// job: { tower?, floor, suit, client, files: [paths], task, brief: { outcome, audience, constraints, finished } }; confirm: start it now
async function run(job, confirm) {
  if (!ready()) return { error: 'JARVIS isn’t open on this computer.' };
  const j = job || {}, task = String(j.task || '').trim().slice(0, 3000), files = (Array.isArray(j.files) ? j.files : []).map(String);
  if (!str(j.suit, 80)) return { error: 'Pick the suit.' };
  if (j.floor == null || j.floor === '') return { error: 'Pick the floor.' };
  if (task.length < 3) return { error: 'Say what JARVIS should do with them.' };
  if (files.length > MAX_FILES) return { error: 'Send at most ' + MAX_FILES + ' files at once.' };
  for (const f of files) {
    if (!path.isAbsolute(f)) return { error: 'Drop files from your computer (File Explorer or the desktop).' };
    let st; try { st = fs.statSync(f); } catch (e) { return { error: path.basename(f) + ' isn’t there any more.' }; }
    if (!st.isFile()) return { error: path.basename(f) + ' is a folder. Drop the files inside it.' };
    if (st.size > MAX_FILE) return { error: path.basename(f) + ' is over 20 MB.' };
  }
  const b = j.brief || {}, brief = {};
  ['outcome', 'audience', 'constraints', 'finished'].forEach((k) => { const v = String(b[k] || '').trim().slice(0, 1000); if (v) brief[k] = v; });
  const body = { ...(j.tower ? { tower: str(j.tower, 60) } : {}), floor: typeof j.floor === 'number' ? j.floor : str(j.floor, 40), suit: str(j.suit, 80), client: str(j.client, 120), files, task,
    ...(Object.keys(brief).length ? { brief } : {}), ...(confirm ? { confirm: true } : {}) };
  try {
    const r = await call('POST', '/api/tower/run', body, confirm ? 180000 : 30000);
    if (confirm && r && r.ok) load();
    // the summary says what it may cost; canStart false: something has to change first (the summary says what)
    if (r && r.needsConfirm) return { needsConfirm: true, summary: str(r.summary, 2000), canStart: r.canStart !== false, estimate: typeof r.estimate === 'string' ? str(r.estimate, 200) : '' };
    if (r && r.ok) return { ok: true, runId: str(r.runId, 80) };
    if (r && r.pending) return { pending: true, message: str(r.message, 400) || 'It’s waiting for your approval in JARVIS.' };
    return { error: 'JARVIS didn’t say whether it started.' };
  } catch (e) { return { error: e.message }; }
}
async function carryOn(runId) {
  if (!ready()) return { error: 'JARVIS isn’t open on this computer.' };
  try { const r = await call('POST', '/api/tower/continue', { runId: str(runId, 80) }, 60000); load(); return r && r.pending ? { pending: true, message: str(r.message, 400) } : { ok: true }; }
  catch (e) { return { error: e.message }; }
}

function stop() { clearInterval(timer); timer = null; drop(); }

module.exports = { init, setWho, link, unlink, state, ready, mine, card, answer, suits, run, carryOn, stop, file: deckFile };
