// Ask Floorboard from Coucou's chat. Coucou's chat can talk to a "custom server" in the common OpenAI-style format
// (Coucou: Settings → Chat → Custom server → http://127.0.0.1:47831). This is that server, on this computer only: each
// question goes to the sidebar, which looks things up with the person's own sign-in and asks Claude, and the answer comes
// back to Coucou. While it works, Floorboard's card in Coucou's island says what it's looking up.
const http = require('http');
const { ipcMain } = require('electron');
const coucou = require('./coucou');

const PORT = Number(process.env.FLOORBOARD_ASK_PORT) || 47831; // another port only for testing beside a running Floorboard
let server = null, sidebar = () => null, ready = false, seq = 0;
const pending = new Map();

// the sidebar answers: it says when it's listening, what it's doing, and the answer
ipcMain.on('ask-ready', (e, on) => { const w = sidebar(); if (w && e.sender === w.webContents) ready = !!on; });
ipcMain.on('ask-step', (_e, m) => { const p = pending.get(m && m.id); if (p) p.step(String(m.text || '')); });
ipcMain.on('ask-done', (_e, m) => {
  const p = pending.get(m && m.id); if (!p) return;
  pending.delete(m.id); clearTimeout(p.timer);
  if (m.error) p.no(new Error(String(m.error))); else p.ok(String(m.answer || ''));
});

function askSidebar(question, history, step) {
  return new Promise((ok, no) => {
    const w = sidebar();
    if (!w || w.isDestroyed() || !ready) return no(new Error('Floorboard isn’t signed in on this computer yet. Open it, sign in, and ask again.'));
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); no(new Error('Floorboard took too long to answer. Try a narrower question.')); }, 280000);
    pending.set(id, { ok, no, step, timer });
    w.webContents.send('ask-run', { id, question, history });
  });
}

// the text of an OpenAI-style message: a string, or parts with text in them
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n') : '');

function readBody(req) {
  return new Promise((ok, no) => {
    let size = 0; const parts = [];
    req.on('data', (b) => { size += b.length; if (size > 2_000_000) { no(new Error('too big')); req.destroy(); } else parts.push(b); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', no);
  });
}
const sendJson = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

async function chat(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, { error: { message: 'That wasn’t a question Floorboard could read.' } }); }
  const msgs = (Array.isArray(body.messages) ? body.messages : []).filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  let lastUser = -1; msgs.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  const question = lastUser >= 0 ? textOf(msgs[lastUser].content).trim().slice(0, 8000) : '';
  if (!question) return sendJson(res, 400, { error: { message: 'Ask Floorboard a question.' } });
  const history = msgs.slice(0, lastUser).map((m) => ({ role: m.role, text: textOf(m.content).slice(0, 4000) })).filter((m) => m.text).slice(-12);
  const id = 'fb-' + Date.now().toString(36), created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish) => 'data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'floorboard', choices: [{ index: 0, delta, finish_reason: finish || null }] }) + '\n\n';

  coucou.asked(question);
  const stream = body.stream !== false;
  let alive = null;
  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    // Coucou hides what's between <think> and </think>: the steps go there, so the line stays busy and the chat stays clean
    res.write(chunk({ role: 'assistant', content: '<think>' }));
    alive = setInterval(() => res.write(': still looking\n\n'), 15000);
  }
  const step = (text) => { coucou.busy(text); if (stream && text) res.write(chunk({ content: text + '\n' })); };
  try {
    const answer = await askSidebar(question, history, step);
    if (stream) { res.write(chunk({ content: '</think>' + answer })); res.write(chunk({}, 'stop')); res.end('data: [DONE]\n\n'); }
    else sendJson(res, 200, { id, object: 'chat.completion', created, model: 'floorboard', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] });
  } catch (e) {
    const message = String((e && e.message) || e);
    if (stream) { res.write(chunk({ content: '</think>' })); res.end('data: ' + JSON.stringify({ error: { message } }) + '\n\n'); }
    else sendJson(res, 503, { error: { message } });
  } finally { clearInterval(alive); coucou.done(); }
}

function onRequest(req, res) {
  // only programs on this computer, never a web page: browsers always say which site they come from
  if (req.headers.origin || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(String(req.headers.host || ''))) { res.writeHead(403); return res.end(); }
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  if (req.method === 'GET' && /^(\/v1)?\/models$/.test(path)) return sendJson(res, 200, { object: 'list', data: [{ id: 'floorboard', object: 'model', created: 0, owned_by: 'floorboard' }] });
  if (req.method === 'POST' && /^(\/v1)?\/chat\/completions$/.test(path)) { chat(req, res).catch(() => { try { res.end(); } catch (e) { } }); return; }
  sendJson(res, 404, { error: { message: 'Floorboard answers questions at /v1/chat/completions.' } });
}

// getSidebar: the sidebar window, which holds the person's data and sign-in
function start(getSidebar) {
  sidebar = getSidebar;
  if (server) return;
  server = http.createServer(onRequest);
  server.on('error', () => { server = null; }); // the port is taken: Coucou's chat just can't reach Floorboard
  server.listen(PORT, '127.0.0.1');
}

module.exports = { start, PORT, url: 'http://127.0.0.1:' + PORT };
