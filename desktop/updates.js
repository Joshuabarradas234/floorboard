// Updates for the Windows app: it asks once whether it may check GitHub for new versions. If yes, it looks when it
// starts and every few hours; a newer version is one click, then it swaps its files and restarts. Settings, logins and
// the WhatsApp link live in the app's own data folder, so an update never touches them.
const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const { execFile } = require('child_process');

const ROOT = process.env.FLOORBOARD_UPDATE_ROOT || path.join(__dirname, '..'); // the folder Floorboard runs from
const NOGIT = process.env.FLOORBOARD_UPDATE_NOGIT === '1';
const EVERY = 6 * 60 * 60 * 1000;

let repo = 'Joshuabarradas234/floorboard', saved = { answer: null }, timer = null;
let state = { ask: true, on: false, current: '', latest: '', available: false, busy: '', error: '', checkedAt: 0 };

const sources = () => {
  const base = process.env.FLOORBOARD_UPDATE_BASE; // for testing: a stand-in for GitHub
  return base ? { version: base + '/version.json', zip: base + '/main.zip' }
    : { version: 'https://raw.githubusercontent.com/' + repo + '/main/version.json', zip: 'https://codeload.github.com/' + repo + '/zip/refs/heads/main' };
};
const file = () => path.join(app.getPath('userData'), 'updates.json');
function send() { BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send('upd-state', state); }); }
function set(patch) { state = { ...state, ...patch }; send(); }
function readVersion() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version || ''; } catch (e) { return ''; } }
// versions are the build's date and time, e.g. 2026.1105.0819
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const run = (cmd, args, opts = {}) => new Promise((ok, no) => execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 24, ...opts }, (e, out, err) => (e ? no(new Error(String(err || e.message).trim().split('\n').pop())) : ok(String(out)))));

async function check() {
  if (!state.on || state.busy) return state;
  set({ busy: 'Checking…', error: '' });
  try {
    const res = await fetch(sources().version, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(res.status === 404 ? 'No version published yet' : 'GitHub answered ' + res.status);
    const latest = String((await res.json()).version || '');
    set({ busy: '', latest, available: newer(latest, state.current), checkedAt: Date.now() });
  } catch (e) {
    set({ busy: '', error: String((e && e.message) || e), checkedAt: Date.now() });
  }
  return state;
}

// This copy came from GitHub with git: fetch the new version the same way. Otherwise: download it and copy it over.
async function fetchNew() {
  const useGit = !NOGIT && fs.existsSync(path.join(ROOT, '.git'));
  if (useGit) {
    const dirty = await run('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no']);
    if (dirty.trim()) throw new Error('This copy has changes that aren’t on GitHub yet, so it wasn’t updated.');
    await run('git', ['-C', ROOT, 'pull', '--ff-only', 'origin', 'main']);
    return;
  }
  const res = await fetch(sources().zip);
  if (!res.ok) throw new Error('Download failed (' + res.status + ')');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floorboard-update-'));
  try {
    fs.writeFileSync(path.join(tmp, 'new.zip'), Buffer.from(await res.arrayBuffer()));
    await run('tar', ['-xf', path.join(tmp, 'new.zip'), '-C', tmp]);
    const top = fs.readdirSync(tmp).map((x) => path.join(tmp, x)).find((x) => fs.statSync(x).isDirectory());
    if (!top || !fs.existsSync(path.join(top, 'index.html')) || !fs.existsSync(path.join(top, 'desktop', 'main.js'))) throw new Error('The download didn’t look like Floorboard, so it wasn’t used.');
    // everything except what this computer installed for itself
    fs.cpSync(top, ROOT, { recursive: true, force: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(path.relative(top, src)) && !/^(node_modules|\.git)$/.test(path.relative(top, src)) });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function install() {
  if (state.busy) return state;
  const deps = () => { try { const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')); return JSON.stringify([p.dependencies, p.devDependencies]); } catch (e) { return ''; } };
  const before = deps();
  set({ busy: 'Updating…', error: '' });
  try {
    await fetchNew();
    if (deps() !== before) { set({ busy: 'Installing what the new version needs…' }); await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install'], { cwd: path.join(ROOT, 'desktop'), shell: true }); }
    set({ busy: 'Restarting…', current: readVersion(), available: false });
    if (process.env.FLOORBOARD_SMOKE !== '1') setTimeout(() => { app.relaunch(); app.isQuitting = true; app.exit(0); }, 700);
  } catch (e) {
    set({ busy: '', error: String((e && e.message) || e) });
  }
  return state;
}

function answer(yes) {
  saved.answer = yes ? 'yes' : 'no';
  try { fs.writeFileSync(file(), JSON.stringify(saved)); } catch (e) { /* asks again next time */ }
  set({ ask: false, on: !!yes });
  schedule();
  if (yes) check();
}
function schedule() { clearInterval(timer); if (state.on) timer = setInterval(check, EVERY); }

function init() {
  try { saved = { ...saved, ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch (e) { /* first run */ }
  state = { ...state, ask: saved.answer === null, on: saved.answer === 'yes', current: readVersion() };
  // where updates come from: the GitHub repository this copy was taken from
  if (fs.existsSync(path.join(ROOT, '.git'))) run('git', ['-C', ROOT, 'remote', 'get-url', 'origin']).then((u) => { const m = u.trim().match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(\.git)?$/); if (m) repo = m[1]; }).catch(() => {});
  ipcMain.handle('upd-state', () => state);
  ipcMain.handle('upd-answer', (_e, yes) => { answer(!!yes); return state; });
  ipcMain.handle('upd-check', () => check());
  ipcMain.handle('upd-install', () => install());
  schedule();
  if (state.on) setTimeout(check, 10000);
}

module.exports = { init, check, install, answer, getState: () => state };
