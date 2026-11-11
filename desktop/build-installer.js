// Builds the Windows installer, dist/Floorboard-Setup.exe: one file someone downloads and double-clicks, and Floorboard
// installs for them (no Node.js, no unzipping, no admin password), opens, and starts with Windows from then on.
// Run from the desktop folder: node build-installer.js   (it needs this computer's npm and internet once)
//
// The installed copy is laid out like this repository (index.html at the top, the Windows app in desktop/), as plain files
// (no asar), so the app's own updater can copy each new version from GitHub over it, exactly as it does for a copy run
// from the repository.
const fs = require('fs'), path = require('path'), os = require('os'), { execSync } = require('child_process');

const repo = path.join(__dirname, '..');
const stage = path.join(os.tmpdir(), 'floorboard-installer', 'app');
const out = path.join(repo, 'dist');
const desk = require('./package.json');
const skip = /^(\.git|\.github|node_modules|dist|mobile)$/; // mobile is the phone app's own project

fs.rmSync(path.dirname(stage), { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(repo, stage, { recursive: true, filter: (src) => { const rel = path.relative(repo, src); return !rel || !rel.split(path.sep).some((p) => skip.test(p)); } });

// the installed app: its entry is desktop/main.js; the same name, so it keeps the same settings folder (%APPDATA%\Floorboard)
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: desk.name, productName: desk.productName, version: desk.version, description: desk.description,
  main: 'desktop/main.js', private: true, author: 'Floorboard', dependencies: desk.dependencies,
}, null, 2));
console.log('Installing what the app needs…');
execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', { cwd: stage, stdio: 'inherit' });

const config = {
  appId: 'app.floorboard.desktop',
  productName: 'Floorboard',
  directories: { app: stage, output: out },
  electronVersion: desk.devDependencies.electron,
  electronDist: path.join(__dirname, 'node_modules', 'electron', 'dist'), // the Electron already here, nothing to download
  asar: false,
  npmRebuild: false,
  files: ['**/*'],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: path.join(repo, 'icon-512.png') },
  nsis: {
    oneClick: true, perMachine: false, // installs for this Windows user, no admin password
    runAfterFinish: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Floorboard',
    artifactName: 'Floorboard-Setup.exe', deleteAppDataOnUninstall: false,
  },
};
// electron-builder's Windows tools come in an archive that also holds Mac links, which Windows only makes for admins, so
// its own unpacking fails; unpack it here instead (Windows' tar reads it, the Mac links aren't needed)
async function winTools() {
  const dir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0');
  if (fs.existsSync(path.join(dir, 'rcedit-x64.exe'))) return;
  console.log('Getting the Windows tools…');
  const res = await fetch('https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z');
  if (!res.ok) throw new Error('Download failed (' + res.status + ')');
  fs.mkdirSync(dir, { recursive: true });
  const z = path.join(path.dirname(stage), 'winCodeSign.7z'); fs.writeFileSync(z, Buffer.from(await res.arrayBuffer()));
  // the 7-Zip that comes with electron-builder (fetched once into npm's cache), leaving out the Mac folder
  execSync('npx --yes electron-builder@25.1.8 --version', { stdio: 'ignore' });
  const npx = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  const sz = fs.existsSync(npx) && fs.readdirSync(npx).map((d) => path.join(npx, d, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')).find((p) => fs.existsSync(p));
  if (!sz) throw new Error('7-Zip from electron-builder wasn’t found');
  execSync('"' + sz + '" x -y -bd "' + z + '" -o"' + dir + '" -xr!darwin', { stdio: 'ignore' });
  if (!fs.existsSync(path.join(dir, 'rcedit-x64.exe'))) throw new Error('The Windows tools didn’t unpack');
}

const cfg = path.join(path.dirname(stage), 'builder.json');
fs.writeFileSync(cfg, JSON.stringify(config, null, 2));
winTools().then(() => {
  console.log('Building the installer…');
  fs.rmSync(out, { recursive: true, force: true });
  execSync('npx --yes electron-builder@25.1.8 --win --config "' + cfg + '" --publish never', { cwd: path.dirname(stage), stdio: 'inherit' });
  const exe = path.join(out, 'Floorboard-Setup.exe');
  console.log('\nDone: ' + exe + ' (' + Math.round(fs.statSync(exe).size / 1048576) + ' MB)');
}).catch((e) => { console.error('The installer wasn’t built: ' + ((e && e.message) || e)); process.exit(1); });
