// Floorboard on Windows: a frosted-glass sidebar docked to the edge of the screen,
// a tray icon to show or hide it, and the full app in its own window.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut, ipcMain, shell } = require('electron');
const path = require('path'), fs = require('fs');

const PAGE = path.join(__dirname, '..', 'index.html');
const ICON = path.join(__dirname, '..', 'icon-192.png');
const SIDEBAR_WIDTH = 380;
const SMOKE = process.env.FLOORBOARD_SMOKE === '1'; // load once, print the result, quit (used for testing)
let prefs = { onTop: false, side: 'right' };
let sidebar = null, full = null, tray = null;

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() { try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch (e) { /* first run */ } }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (e) { /* not fatal */ } }

const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true };
function openLinksOutside(win) {
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

function dock() {
  if (!sidebar) return;
  const { workArea } = screen.getDisplayMatching(sidebar.getBounds());
  const width = Math.min(Math.max(sidebar.getBounds().width, 320), 520);
  const x = prefs.side === 'left' ? workArea.x : workArea.x + workArea.width - width;
  sidebar.setBounds({ x, y: workArea.y, width, height: workArea.height });
}
function showSidebar() { if (!sidebar) return; dock(); sidebar.show(); sidebar.focus(); }
function toggleSidebar() { if (sidebar && sidebar.isVisible()) sidebar.hide(); else showSidebar(); }

function createSidebar() {
  const { workArea } = screen.getPrimaryDisplay();
  sidebar = new BrowserWindow({
    x: workArea.x + workArea.width - SIDEBAR_WIDTH, y: workArea.y, width: SIDEBAR_WIDTH, height: workArea.height,
    minWidth: 320, maxWidth: 520, frame: false, maximizable: false, fullscreenable: false, show: false,
    title: 'Floorboard', icon: ICON, backgroundColor: '#00000000', backgroundMaterial: 'acrylic',
    alwaysOnTop: prefs.onTop, webPreferences,
  });
  sidebar.loadFile(PAGE, { hash: 'widget', query: { shell: 'desktop' } });
  openLinksOutside(sidebar);
  sidebar.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); sidebar.hide(); } });
  if (SMOKE) {
    sidebar.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('console:', message); });
    sidebar.webContents.on('did-finish-load', () => setTimeout(async () => {
      const out = await sidebar.webContents.executeJavaScript(`[!!window.floorboardDesktop, document.documentElement.className, document.querySelector('.login, .widget') ? document.querySelector('.login, .widget').className : document.body.innerText.slice(0, 200)].join(' | ')`);
      console.log('SMOKE', out); app.isQuitting = true; app.quit();
    }, 1500));
  } else {
    sidebar.once('ready-to-show', showSidebar);
  }
}

function openFull() {
  if (full && !full.isDestroyed()) { full.show(); full.focus(); return; }
  full = new BrowserWindow({ width: 1320, height: 860, minWidth: 380, minHeight: 560, title: 'Floorboard', icon: ICON, backgroundColor: '#2b2018', autoHideMenuBar: true, webPreferences });
  full.loadFile(PAGE, { query: { shell: 'desktop' } });
  openLinksOutside(full);
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Floorboard');
  tray.on('click', toggleSidebar);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show or hide the sidebar   Ctrl+Alt+F', click: toggleSidebar },
    { label: 'Open the full app', click: openFull },
    { type: 'separator' },
    { label: 'Keep the sidebar on top', type: 'checkbox', checked: prefs.onTop, click: (i) => { prefs.onTop = i.checked; sidebar.setAlwaysOnTop(i.checked); savePrefs(); } },
    { label: 'Dock on the left', type: 'checkbox', checked: prefs.side === 'left', click: (i) => { prefs.side = i.checked ? 'left' : 'right'; savePrefs(); dock(); } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit Floorboard', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showSidebar);
  app.whenReady().then(() => {
    loadPrefs();
    createSidebar();
    if (SMOKE) return;
    buildTray();
    globalShortcut.register('Control+Alt+F', toggleSidebar);
    screen.on('display-metrics-changed', dock);
    ipcMain.on('open-full', openFull);
    ipcMain.on('hide-sidebar', () => sidebar && sidebar.hide());
    ipcMain.on('show-sidebar', showSidebar);
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
