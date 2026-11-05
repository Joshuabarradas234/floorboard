// Floorboard inside Coucou's island. Coucou (github.com/Louis-CFM/coucou, if the person installed it) lets tools on this
// computer report to its island through a local named pipe, one JSON line per event, each tool with its own card.
// Floorboard reports there as "floorboard": the newest thing for you, and how many things need you and chats are unread.
// It only talks to Coucou on this computer; nothing leaves it. With no Coucou running, this does nothing.
const net = require('net'), fs = require('fs');

const ROOT = String.raw`\\.\pipe\ `.trim();
// a new name each time Floorboard starts: Coucou doesn't bring back a card whose name it has already seen end
const SESSION = 'floorboard-' + Date.now().toString(36);
let pipe = null, started = false, beat = 0, lastText = '', lastStep = '', stopTimer = null, timer = null, onChange = () => {}, last = null;

function findPipe() { try { return fs.readdirSync(ROOT).find((n) => /^coucou-S-/i.test(n)) || null; } catch (e) { return null; } }
function send(ev) {
  if (!pipe) return;
  const s = net.connect(ROOT + pipe, () => s.end(JSON.stringify({ session_id: SESSION, coucou_agent: 'floorboard', cwd: 'Floorboard', session_pid: process.pid, ...ev }) + '\n'));
  s.on('error', () => {}); // Coucou reads the line and hangs up; a closed or missing pipe just means it isn't listening
}
// look for Coucou every so often: it may start or quit at any time
function check() {
  const p = findPipe();
  if (p && p !== pipe) { pipe = p; started = false; lastText = ''; lastStep = ''; onChange(true); }
  else if (!p && pipe) { pipe = null; started = false; onChange(false); }
  if (pipe && !started) { send({ hook_event_name: 'SessionStart', source: 'startup' }); started = true; beat = 0; if (last) update(last, true); else hello(); }
  // Coucou drops cards that go quiet (after the computer sleeps, say): check in every few minutes so Floorboard keeps its place
  else if (pipe && ++beat >= 16) { beat = 0; send({ hook_event_name: 'SessionStart', source: 'resume' }); hello(); }
}
// what the sidebar knows: { count, urgent, chats, latest: { title, body } }
function update(info, again) {
  last = info;
  if (!pipe || !started) return;
  const step = (info.count ? info.count + (info.count === 1 ? ' thing needs you' : ' things need you') : 'All caught up') + (info.chats ? ' · ' + info.chats + (info.chats === 1 ? ' chat unread' : ' chats unread') : '');
  const text = info.latest ? [info.latest.title, info.latest.body].filter(Boolean).join(': ').slice(0, 160) : '';
  const fresh = !!text && (text !== lastText || !!again);
  if (fresh) { send({ hook_event_name: 'UserPromptSubmit', prompt: text }); lastText = text; }
  if (step !== lastStep || again || fresh) {
    send({ hook_event_name: 'PreToolUse', tool_name: 'Floorboard', tool_input: { description: step } });
    lastStep = step;
    // the card settles after a few seconds, keeping the newest line
    clearTimeout(stopTimer); stopTimer = setTimeout(() => send({ hook_event_name: 'Stop' }), info.urgent ? 20000 : 6000);
  }
}
// a card only shows once it has something going on: say what Floorboard last said
function hello() { send({ hook_event_name: 'PreToolUse', tool_name: 'Floorboard', tool_input: { description: lastStep || 'Floorboard is open' } }); }
function init(cb) { onChange = cb || onChange; if (timer) return; check(); timer = setInterval(check, 15000); }
// the card leaves Coucou's island (Floorboard quits, or the person switched it off)
function stop() { clearInterval(timer); timer = null; clearTimeout(stopTimer); send({ hook_event_name: 'SessionEnd', reason: 'exit' }); pipe = null; started = false; }

module.exports = { init, update, stop, running: () => !!pipe };
