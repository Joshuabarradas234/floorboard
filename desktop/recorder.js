// The sidebar's meeting recorder (Windows): the screen with the microphone and the computer's own sound, saved as a video
// in Documents\Meeting recordings on this computer, and what's said written down by Windows' own speech recognition
// (dictation.ps1) for the minutes. The page records (MediaRecorder) and sends the video here a few seconds at a time;
// nothing of the video leaves this computer.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { app, desktopCapturer, session, shell, powerSaveBlocker } = require('electron');

// From Record until the minutes are saved, Windows isn't to sleep (an hour's meeting takes a few minutes to write down after
// Stop, and sleeping in the middle stalls it); the page says when it's done (working(false)), and it ends by itself after 2 hours.
let awake = null, working = false, workTimer = null;
function keepAwake(on) {
  if (on && awake === null) { try { awake = powerSaveBlocker.start('prevent-app-suspension'); } catch (e) { awake = null; } }
  if (!on && awake !== null && !cur && !working) { try { powerSaveBlocker.stop(awake); } catch (e) { } awake = null; }
}
function setWorking(on) { working = !!on; clearTimeout(workTimer); if (working) workTimer = setTimeout(() => setWorking(false), 2 * 60 * 60 * 1000); keepAwake(working); return true; }
const busy = () => !!cur || working; // (updates wait while this is true)

// Minutes still to be made after Stop, per person, in a file written at once (so it survives the laptop sleeping, Floorboard
// being closed, or a crash, and they're finished the next time it's open)
const waitingFile = () => path.join(app.getPath('userData'), 'minutes-waiting.json');
function waitingAll() { try { const o = JSON.parse(fs.readFileSync(waitingFile(), 'utf8')); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function waiting(op, who, list) {
  who = String(who || '').slice(0, 80); if (!who) return [];
  const all = waitingAll();
  if (op === 'set') {
    all[who] = Array.isArray(list) ? list.slice(0, 20) : [];
    if (!all[who].length) delete all[who];
    const tmp = waitingFile() + '.part';
    fs.writeFileSync(tmp, JSON.stringify(all)); fs.renameSync(tmp, waitingFile());
  }
  return all[who] || [];
}
let cur = null; // { file, out, words: [{ text, at }], ps, speech: 'starting'|'on'|'privacy'|'error: …', started }

const folder = () => path.join(app.getPath('documents'), 'Meeting recordings');
const stamp = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');

// the screen to record when the page asks (the whole primary screen), with the computer's own sound (Windows loopback)
function allowScreen() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!cur) { callback({}); return; } // only while the recorder is on
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => callback(sources.length ? { video: sources[0], audio: 'loopback' } : {})).catch(() => callback({}));
  });
}

function listen() {
  // (the test run can put a stand-in in its place)
  const script = process.env.FLOORBOARD_SMOKE && process.env.FLOORBOARD_DICTATION ? process.env.FLOORBOARD_DICTATION : path.join(__dirname, 'dictation.ps1');
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
  let buf = '';
  ps.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line || !cur || cur.ps !== ps) continue;
      try {
        const m = JSON.parse(line);
        if (m.t === 'ready') cur.speech = 'on';
        else if (m.t === 'text' && m.text) cur.words.push({ text: String(m.text).slice(0, 2000), at: Number(m.at) || Date.now() });
        else if (m.t === 'error') cur.speech = m.why === 'privacy' ? 'privacy' : 'error: ' + String(m.why || '').slice(0, 160);
      } catch (e) { /* not a line of ours */ }
    }
  });
  ps.on('exit', () => { if (cur && cur.ps === ps && cur.speech === 'on') cur.speech = 'stopped'; });
  return ps;
}

// The meeting's sound is also kept as a plain 16 kHz mono WAV (in the temp folder, deleted after), so that after Stop
// Windows' speech engine can write down what was said from the recording itself (transcribe.ps1): that works even when
// listening live (dictation.ps1) heard nothing, because it's the same sound the recording got.
const wavHeader = (bytes) => { const b = Buffer.alloc(44); b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40); return b; };
let writing = null; // { at, total } (seconds) while the recording is being written down after Stop

function start() {
  if (cur) return { ok: true, file: cur.file, again: true };
  fs.mkdirSync(folder(), { recursive: true });
  const started = new Date(), file = path.join(folder(), 'Meeting ' + stamp(started) + '.webm');
  const wav = path.join(app.getPath('temp'), 'floorboard-meeting-' + started.getTime() + '.wav');
  cur = { file, out: fs.createWriteStream(file), words: [], ps: null, speech: 'starting', started: started.getTime(), wav, wfd: null, wbytes: 0 };
  try { cur.wfd = fs.openSync(wav, 'w'); fs.writeSync(cur.wfd, wavHeader(0)); } catch (e) { cur.wfd = null; }
  cur.ps = listen();
  keepAwake(true);
  return { ok: true, file, name: path.basename(file) };
}
// a few seconds of the video at a time
function chunk(buf) { if (cur && cur.out && buf && buf.byteLength) cur.out.write(Buffer.from(buf)); return true; }
// a few seconds of the sound at a time, as 16-bit samples at 16 kHz, for writing it down after
function sound(buf) { if (cur && cur.wfd !== null && buf && buf.byteLength) { const b = Buffer.from(buf); try { fs.writeSync(cur.wfd, b); cur.wbytes += b.length; } catch (e) { /* the video still records */ } } return true; }
const status = () => (cur ? { on: true, speech: cur.speech, words: cur.words.length, last: (cur.words[cur.words.length - 1] || {}).text || '', started: cur.started, name: path.basename(cur.file) } : { on: false, writing });

// write down what's said in the WAV, with Windows' own speech engine on this computer
function transcribeFile(wav, total) {
  return new Promise((done) => {
    const script = path.join(__dirname, 'transcribe.ps1'), lines = [];
    let why = '', buf = '';
    writing = { at: 0, total };
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Wav', wav], { windowsHide: true });
    ps.stdout.on('data', (d) => {
      buf += d.toString('utf8'); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (m.t === 'text' && m.text) { lines.push(String(m.text)); writing = { at: Number(m.at) || writing.at, total }; } else if (m.t === 'error') why = String(m.why || 'error').slice(0, 160); } catch (e) { /* not ours */ }
      }
    });
    ps.on('error', (e) => { why = why || String(e.message || e); });
    ps.on('exit', () => { writing = null; done({ text: lines.join('\n'), why }); });
  });
}

// A recording made in the browser has no length written in it, so Windows' player can't show how long it is or skip
// through it. This writes the length into the video's header (WebM: Segment > Info > Duration, in milliseconds).
function vint(b, i) { // an EBML size: { len, val } (val -1 = unknown)
  const f = b[i]; let len = 1; while (len <= 8 && !(f & (0x80 >> (len - 1)))) len++;
  if (len > 8 || i + len > b.length) return null;
  let val = f & (0xff >> len), all = val === (0xff >> len);
  for (let k = 1; k < len; k++) { val = val * 256 + b[i + k]; if (b[i + k] !== 0xff) all = false; }
  return { len, val: all ? -1 : val };
}
function idAt(b, i) { const f = b[i], len = f & 0x80 ? 1 : f & 0x40 ? 2 : f & 0x20 ? 3 : 4; let v = 0; for (let k = 0; k < len; k++) v = v * 256 + b[i + k]; return { len, id: v }; }
async function writeLength(file, ms) {
  if (!(ms > 0)) return false;
  const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(65536); const got = fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd);
  const b = head.subarray(0, got);
  if (b.readUInt32BE(0) !== 0x1a45dfa3) return false;
  let s = vint(b, 4); let i = 4 + s.len + s.val; // past the EBML header
  if (idAt(b, i).id !== 0x18538067) return false;
  const seg = vint(b, i + 4); i += 4 + seg.len; // into the Segment
  while (i < b.length - 12) {
    const e = idAt(b, i), sz = vint(b, i + e.len); if (!sz || sz.val < 0) return false;
    const body = i + e.len + sz.len;
    if (e.id === 0x1549a966) { // Info
      for (let j = body; j < body + sz.val;) { // a Duration already there: just set it
        const c = idAt(b, j), cs = vint(b, j + c.len);
        if (c.id === 0x4489) { const at = j + c.len + cs.len, w = fs.openSync(file, 'r+'), v = Buffer.alloc(cs.val); cs.val === 4 ? v.writeFloatBE(ms) : v.writeDoubleBE(ms); fs.writeSync(w, v, 0, v.length, at); fs.closeSync(w); return true; }
        j += c.len + cs.len + cs.val;
      }
      const grown = sz.val + 11; if (grown >= Math.pow(2, 7 * sz.len) - 1) return false;
      const size = Buffer.alloc(sz.len); let v = grown; for (let k = sz.len - 1; k >= 0; k--) { size[k] = v & 0xff; v = Math.floor(v / 256); } size[0] |= 0x80 >> (sz.len - 1);
      const dur = Buffer.alloc(11); dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88; dur.writeDoubleBE(ms, 3);
      const end = body + sz.val, tmp = file + '.part';
      const out = fs.createWriteStream(tmp);
      out.write(Buffer.concat([b.subarray(0, i + e.len), size, b.subarray(body, end), dur]));
      await new Promise((ok, no) => { const r = fs.createReadStream(file, { start: end }); r.on('error', no); out.on('error', no); out.on('finish', ok); r.pipe(out); });
      fs.renameSync(tmp, file);
      return true;
    }
    if (e.id === 0x1f43b675) return false; // reached the video itself without an Info
    i = body + sz.val;
  }
  return false;
}

// stop: the video closed, the listening ended, and what was said handed back for the minutes
async function stop(opts = {}) {
  if (!cur) return { error: 'Nothing is being recorded.' };
  const c = cur; cur = null;
  try { c.ps.kill(); } catch (e) { /* already ended */ }
  await new Promise((ok) => c.out.end(ok));
  try { await writeLength(c.file, Date.now() - c.started); } catch (e) { try { fs.unlinkSync(c.file + '.part'); } catch (x) { } } // it still plays without it
  let size = 0; try { size = fs.statSync(c.file).size; } catch (e) { /* none */ }
  const ended = Date.now(), live = c.words.map((w) => w.text).join('\n');
  // and from the recording itself: used when it caught clearly more than listening live did (or live caught nothing)
  let transcript = live, how = live ? 'live' : '', fileWhy = '';
  if (c.wfd !== null) {
    try { fs.writeSync(c.wfd, wavHeader(c.wbytes), 0, 44, 0); fs.closeSync(c.wfd); } catch (e) { /* none */ }
    if (opts.local === false) fileWhy = ''; // already written down by the speech service
    else if (c.wbytes > 32000) { // more than a second of sound
      const f = await transcribeFile(c.wav, Math.round(c.wbytes / 32000));
      fileWhy = f.why || (f.text ? '' : 'no speech found in the recording');
      if (f.text && (live.length < 20 || f.text.length > live.length * 1.6)) { transcript = f.text; how = 'recording'; }
    } else fileWhy = 'the recording had no sound';
    try { fs.unlinkSync(c.wav); } catch (e) { /* already gone */ }
  }
  keepAwake(false); // (stays awake while the page is still making the minutes)
  return { ok: true, file: c.file, name: path.basename(c.file), folder: folder(), size, transcript, how, speech: c.speech, fileWhy, started: c.started, ended };
}
function cancel() { if (!cur) return; const c = cur; cur = null; keepAwake(false); try { c.ps.kill(); } catch (e) { } c.out.end(() => { try { fs.unlinkSync(c.file); } catch (e) { } }); if (c.wfd !== null) { try { fs.closeSync(c.wfd); fs.unlinkSync(c.wav); } catch (e) { } } }

// a recording by its full path, or by its name in the Meeting recordings folder (as My files keeps it)
const where = (file) => (file ? (path.isAbsolute(file) ? file : path.join(folder(), path.basename(file))) : '');
const openFolder = (file) => (where(file) && fs.existsSync(where(file)) ? shell.showItemInFolder(where(file)) : shell.openPath(folder()));
const play = (file) => (where(file) && /\.webm$/i.test(where(file)) && fs.existsSync(where(file)) ? shell.openPath(where(file)) : openFolder(''));
const openSpeechSettings = () => shell.openExternal('ms-settings:privacy-speech');
// is Windows' online speech recognition on (Settings › Privacy & security › Speech)? Only read here: switching it on is the person's own choice.
const speechOn = () => new Promise((ok) => {
  if (process.env.FLOORBOARD_SMOKE && process.env.FLOORBOARD_DICTATION) { ok(true); return; } // the test run's stand-in listens without it
  require('child_process').execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Speech_OneCore\\Settings\\OnlineSpeechPrivacy', '/v', 'HasAccepted'], { windowsHide: true }, (err, out) => ok(!err && /HasAccepted\s+REG_DWORD\s+0x1\b/i.test(String(out))));
});

module.exports = { busy, setWorking, waiting, allowScreen, start, chunk, sound, status, stop, cancel, openFolder, play, openSpeechSettings, speechOn, writeLength };
