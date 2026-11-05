// Floorboard inside Coucou's island. Coucou (github.com/Louis-CFM/coucou, if the person installed it) lets tools on this
// computer report to its island through a local named pipe, one JSON line per event, each tool with its own card.
// Floorboard reports there as "floorboard": the newest thing for you, and how many things need you and chats are unread.
// It only talks to Coucou on this computer; nothing leaves it. With no Coucou running, this does nothing.
const net = require('net'), fs = require('fs');

const ROOT = String.raw`\\.\pipe\ `.trim();
// Coucou keeps a tool's card while it works and takes it away a few seconds after it says Stop (with the "finished"
// sound), so Floorboard never says Stop: its card is busy while something needs you and rests once you're all caught up.
// SessionStart plays Coucou's "work" sound, so it isn't sent either: the first PreToolUse makes the card.
const SESSION = 'floorboard-' + Date.now().toString(36);
const AGAIN = 10 * 60 * 1000; // in case Coucou restarted between two looks, the card is said again now and then
let pipe = null, shown = false, lastText = '', lastStep = '', saidAt = 0, timer = null, onChange = () => {}, last = null;
let queue = Promise.resolve();

function findPipe() { try { return fs.readdirSync(ROOT).find((n) => /^coucou-S-/i.test(n)) || null; } catch (e) { return null; } }
// one connection per line, one after the other, so Coucou reads them in order
function send(p, ev) {
  return new Promise((done) => {
    const s = net.connect(ROOT + p, () => s.end(JSON.stringify({ session_id: SESSION, coucou_agent: 'floorboard', cwd: 'Floorboard', session_pid: process.pid, ...ev }) + '\n'));
    s.setTimeout(3000, () => s.destroy());
    s.on('error', done); s.on('close', done); // Coucou reads the line and hangs up; a closed or missing pipe just means it isn't listening
  });
}
function post(ev) { const p = pipe; if (p) queue = queue.then(() => send(p, ev)); return queue; }
// what the card says now: Coucou writes out a tool's name in full (a tool it doesn't know gets no more), so that's the line
function show(step) {
  post({ hook_event_name: 'PreToolUse', tool_name: step, tool_input: {} });
  if (!last || !(last.count || last.chats)) post({ hook_event_name: 'Interrupt' });
  lastStep = step; saidAt = Date.now();
}
// look for Coucou every few seconds: it may start or quit at any time
function check() {
  const p = findPipe();
  if (p !== pipe) { pipe = p; shown = false; lastText = ''; lastStep = ''; onChange(!!p); }
  if (!pipe) return;
  if (!shown) { shown = true; if (last) update(last, true); else show('Floorboard is open'); }
  else if (Date.now() - saidAt > AGAIN) show(lastStep || 'Floorboard is open');
}
// what the sidebar knows: { count, urgent, chats, latest: { title, body } }
function update(info, again) {
  last = info;
  if (!pipe || !shown) return;
  const step = (info.count ? info.count + (info.count === 1 ? ' thing needs you' : ' things need you') : 'All caught up') + (info.chats ? ' · ' + info.chats + (info.chats === 1 ? ' chat unread' : ' chats unread') : '');
  const text = info.latest ? [info.latest.title, info.latest.body].filter(Boolean).join(': ').slice(0, 160) : '';
  const fresh = !!text && (text !== lastText || !!again);
  if (fresh) { post({ hook_event_name: 'UserPromptSubmit', prompt: text }); lastText = text; }
  if (step !== lastStep || again || fresh) show(step);
}
function init(cb) { onChange = cb || onChange; if (timer) return; check(); timer = setInterval(check, 5000); }
// the card leaves Coucou's island (Floorboard quits, or the person switched it off); resolves once Coucou has it
function stop() { clearInterval(timer); timer = null; const done = post({ hook_event_name: 'SessionEnd', reason: 'exit' }); pipe = null; shown = false; return done; }

module.exports = { init, update, stop, running: () => !!pipe };
