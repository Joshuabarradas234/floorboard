// Floorboard on Windows: a frosted-glass sidebar docked to the edge of the screen, a bar at the top of the screen
// for chats, a tray icon to show or hide them, and the full app in its own window.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut, ipcMain, shell, session, safeStorage } = require('electron');
const path = require('path'), fs = require('fs');
const whatsapp = require('./whatsapp');

const PAGE = path.join(__dirname, '..', 'index.html');
const ICON = path.join(__dirname, '..', 'icon-192.png');
const SIDEBAR_WIDTH = 380;
const SLIM_WIDTH = 62; // the sidebar folded into its slim rail of icons
let slimHeight = 420; // the rail's own height (the page measures it); it sits in the middle of the screen edge
const SMOKE = process.env.FLOORBOARD_SMOKE === '1'; // load once, print the result, quit (used for testing)
// Windows can wrongly judge the full window to be covered (with the sidebar kept in front, or some screen tools), and it
// then stops drawing and stays black. Draw it whenever it's open.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const BUBBLE = 80; // the floating button's window: the 56px button and its shadow
// the bar at the top of the screen: its window closed (the pill and its shadow) and open (the chat panel)
const BAR = { pill: { width: 320, height: 48 }, open: { width: 430, height: 490 } };
let prefs = { onTop: false, side: 'right', bubble: true, bubbleAt: null, bar: true, slim: false, width: SIDEBAR_WIDTH };
let sidebar = null, full = null, tray = null, bubble = null, bar = null, barState = 'pill';
let opened = false, slide = null, sizing = null, need = { count: 0, urgent: false };

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() { try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch (e) { /* first run */ } }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (e) { /* not fatal */ } }

const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true };
function openLinksOutside(win) {
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

// x is where the sidebar sits docked; away is just past the screen edge, where it slides to when it closes.
// Between slides its bounds stay docked, even while it's hidden. Open it's the full height of the screen; folded into
// its rail it's only as tall as the rail, in the middle of the edge, clear of window buttons in the corners.
function docked() {
  const { workArea } = screen.getDisplayMatching(sidebar.getBounds());
  const width = prefs.slim ? SLIM_WIDTH : Math.min(Math.max(prefs.width || SIDEBAR_WIDTH, 320), 520);
  const height = prefs.slim ? Math.min(slimHeight, workArea.height - 120) : workArea.height;
  const left = prefs.side === 'left';
  return { workArea, width, height, y: workArea.y + Math.round((workArea.height - height) / 2), x: left ? workArea.x : workArea.x + workArea.width - width, away: left ? workArea.x - width : workArea.x + workArea.width };
}
// The sidebar stays in front of other windows while it's folded into its rail (so it's always to hand), and otherwise
// only when it's pinned.
function applyOnTop() { if (sidebar) sidebar.setAlwaysOnTop(prefs.slim || prefs.onTop, prefs.slim ? 'screen-saver' : 'floating'); if (bubble) bubble.moveTop(); }
// Fold the sidebar into its slim rail, or open it back to full width, keeping it docked to the screen edge.
function setSlim(_e, on) {
  on = !!on;
  if (!sidebar || on === prefs.slim) return;
  const from = sidebar.getBounds();
  prefs.slim = on; savePrefs(); applyOnTop();
  clearInterval(sizing); sizing = true; // the resizes from here on aren't someone dragging the width
  sidebar.setMinimumSize(on ? SLIM_WIDTH : 320, 200);
  if (!sidebar.isVisible()) { dock(); setTimeout(() => { sizing = null; }, 100); return; }
  const to = docked(), left = prefs.side === 'left', t0 = Date.now(), ms = 220;
  sizing = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms), e = 1 - Math.pow(1 - k, 3), mix = (a, b) => Math.round(a + (b - a) * e);
    const w = mix(from.width, to.width), h = mix(from.height, to.height);
    sidebar.setBounds({ x: left ? to.workArea.x : to.workArea.x + to.workArea.width - w, y: mix(from.y, to.y), width: w, height: h });
    if (k >= 1) { clearInterval(sizing); sizing = null; dock(); }
  }, 15);
}
function dock() {
  if (!sidebar || slide) return;
  const { width, height, x, y } = docked();
  sidebar.setBounds({ x, y, width, height });
  placeBubble();
}
// Slide the sidebar in from the screen edge or back out. The floating button stands in for it while it's closed.
function slideTo(open, { focus = true } = {}) {
  if (!sidebar) return;
  clearInterval(slide); slide = null;
  const { width, height, x, y, away } = docked();
  const from = sidebar.isVisible() ? sidebar.getBounds().x : away, to = open ? x : away;
  opened = open; sendBubble();
  if (open) placeBubble();
  if (open && !sidebar.isVisible()) { sidebar.setBounds({ x: from, y, width, height }); if (focus) sidebar.show(); else sidebar.showInactive(); }
  if (open && focus) sidebar.focus();
  const t0 = Date.now(), ms = 220;
  const step = () => {
    const k = Math.min(1, (Date.now() - t0) / ms), nx = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    sidebar.setBounds({ x: nx, y, width, height });
    if (k < 1) return;
    clearInterval(slide); slide = null;
    if (!open) { sidebar.hide(); sidebar.setBounds({ x, y, width, height }); }
    placeBubble();
  };
  slide = setInterval(step, 15);
  step();
}
const showSidebar = () => slideTo(true);
const hideSidebar = () => slideTo(false);
const toggleSidebar = () => slideTo(!opened);

// The floating button: while the sidebar is closed, one small button floats in front of every window, wherever it was
// dragged to (bottom right at first). Click it and the whole sidebar opens; while the sidebar is open the button steps aside.
function bubbleSpot() {
  const { workArea } = screen.getPrimaryDisplay();
  const want = prefs.bubbleAt || { x: workArea.x + workArea.width - BUBBLE - 18, y: workArea.y + workArea.height - BUBBLE - 18 };
  const wa = screen.getDisplayNearestPoint({ x: Math.round(want.x + BUBBLE / 2), y: Math.round(want.y + BUBBLE / 2) }).workArea;
  return { x: Math.round(Math.max(wa.x, Math.min(want.x, wa.x + wa.width - BUBBLE))), y: Math.round(Math.max(wa.y, Math.min(want.y, wa.y + wa.height - BUBBLE))) };
}
function placeBubble() {
  if (!bubble) return;
  if (opened) { if (bubble.isVisible()) bubble.hide(); return; }
  bubble.setBounds({ ...bubbleSpot(), width: BUBBLE, height: BUBBLE });
  if (!bubble.isVisible()) bubble.showInactive();
}
function sendBubble() { if (bubble && !bubble.webContents.isLoading()) bubble.webContents.send('bubble-state', { open: opened, ...need }); }
function createBubble() {
  if (bubble || !prefs.bubble) return;
  bubble = new BrowserWindow({
    width: BUBBLE, height: BUBBLE, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, show: false, title: 'Floorboard',
    webPreferences: { preload: path.join(__dirname, 'bubble-preload.js'), contextIsolation: true, sandbox: true },
  });
  bubble.setAlwaysOnTop(true, 'screen-saver'); // above the sidebar and other windows kept on top
  bubble.loadFile(path.join(__dirname, 'bubble.html'));
  bubble.webContents.on('did-finish-load', sendBubble);
  bubble.once('ready-to-show', placeBubble);
  bubble.on('closed', () => { bubble = null; });
}
function setBubble(on) {
  prefs.bubble = !!on; savePrefs();
  if (prefs.bubble) createBubble(); else if (bubble) bubble.destroy();
  if (tray) tray.setContextMenu(trayMenu());
}
let dragFrom = null;
function bubbleIpc() {
  ipcMain.on('bubble-toggle', toggleSidebar);
  // dragged anywhere on the screen; it stays where it's let go
  ipcMain.on('bubble-drag', (_e, dx, dy) => {
    if (!bubble) return;
    if (dragFrom === null) dragFrom = bubbleSpot();
    prefs.bubbleAt = { x: dragFrom.x + (Number(dx) || 0), y: dragFrom.y + (Number(dy) || 0) };
    placeBubble();
  });
  ipcMain.on('bubble-drop', () => { dragFrom = null; savePrefs(); });
}

// The bar hangs from the top middle of the main screen, in front of everything. It's the app in its own small window
// (#bar): a pill showing the newest unread chat, which opens into a list of chats to read and answer.
function placeBar(state) {
  if (!bar) return;
  barState = state === 'open' ? 'open' : 'pill';
  const { bounds } = screen.getPrimaryDisplay(), size = BAR[barState];
  bar.setBounds({ x: Math.round(bounds.x + (bounds.width - size.width) / 2), y: bounds.y, ...size });
}
function createBar() {
  if (bar || !prefs.bar) return;
  bar = new BrowserWindow({
    ...BAR.pill, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, title: 'Floorboard bar', webPreferences,
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.loadFile(PAGE, { hash: 'bar', query: { shell: 'desktop' } });
  openLinksOutside(bar);
  bar.once('ready-to-show', () => { placeBar('pill'); bar.showInactive(); });
  bar.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); setBar(false); } });
  bar.on('closed', () => { bar = null; });
}
function setBar(on) {
  prefs.bar = !!on; savePrefs();
  if (prefs.bar) createBar(); else if (bar) { const b = bar; bar = null; b.destroy(); }
  if (tray) tray.setContextMenu(trayMenu());
}

function createSidebar() {
  const { workArea } = screen.getPrimaryDisplay();
  sidebar = new BrowserWindow({
    x: workArea.x + workArea.width - SIDEBAR_WIDTH, y: workArea.y, width: prefs.slim ? SLIM_WIDTH : prefs.width || SIDEBAR_WIDTH, height: workArea.height,
    minWidth: prefs.slim ? SLIM_WIDTH : 320, maxWidth: 520, frame: false, maximizable: false, fullscreenable: false, show: false,
    title: 'Floorboard', icon: ICON, backgroundColor: '#00000000', backgroundMaterial: 'acrylic',
    alwaysOnTop: prefs.onTop || prefs.slim, webPreferences,
  });
  sidebar.loadFile(PAGE, { hash: 'widget', query: { shell: 'desktop' } });
  openLinksOutside(sidebar);
  sidebar.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); hideSidebar(); } });
  sidebar.on('focus', () => { sidebar.flashFrame(false); if (bubble) bubble.moveTop(); });
  // remember the width someone drags it to: 'resized' only fires when a person finishes resizing it, not for the app's own moves
  sidebar.on('resized', () => { if (slide || sizing || prefs.slim) return; prefs.width = sidebar.getBounds().width; savePrefs(); });
  if (SMOKE) {
    sidebar.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('console:', message); });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const where = () => 'sidebar ' + (sidebar.isVisible() ? 'open at x=' + sidebar.getBounds().x : 'closed') + ', button ' + (bubble && bubble.isVisible() ? 'shown at ' + JSON.stringify(bubble.getBounds()) : 'hidden') + (bubble && bubble.isAlwaysOnTop() ? ' (on top)' : '');
    sidebar.webContents.on('did-finish-load', () => setTimeout(async () => {
      const out = await sidebar.webContents.executeJavaScript(`[!!window.floorboardDesktop, document.documentElement.className, document.querySelector('.login, .widget') ? document.querySelector('.login, .widget').className : document.body.innerText.slice(0, 200)].join(' | ')`);
      console.log('SMOKE', out);
      slideTo(true); await wait(400); console.log('SMOKE', where());
      console.log('SMOKE button page:', await bubble.webContents.executeJavaScript(`[!!window.floorboardBubble, document.body.className || 'closed', document.getElementById('b').getAttribute('aria-label')].join(' | ')`));
      toggleSidebar(); await wait(400); console.log('SMOKE', where());
      console.log('SMOKE button page:', await bubble.webContents.executeJavaScript(`[document.body.className || 'closed', document.getElementById('b').getAttribute('aria-label')].join(' | ')`));
      if (bar) {
        console.log('SMOKE bar', JSON.stringify(bar.getBounds()), bar.isVisible() ? 'shown' : 'hidden', bar.isAlwaysOnTop() ? 'on top' : '', '|', await bar.webContents.executeJavaScript(`[document.documentElement.className, document.querySelector('.fbar-pill') ? document.querySelector('.fbar-pill').innerText.replace(/\\s+/g, ' ') : document.body.innerText.slice(0, 120)].join(' | ')`));
        placeBar('open'); console.log('SMOKE bar open', JSON.stringify(bar.getBounds())); placeBar('pill');
      }
      slideTo(true); await wait(400);
      setSlim(null, true); await wait(400); console.log('SMOKE folded', JSON.stringify(sidebar.getBounds()), sidebar.isAlwaysOnTop() ? 'in front' : 'not in front', 'button at', JSON.stringify(bubble && bubble.getBounds()));
      setSlim(null, false); await wait(400); console.log('SMOKE opened', JSON.stringify(sidebar.getBounds()), sidebar.isAlwaysOnTop() ? 'in front' : 'not in front');
      if (process.env.FLOORBOARD_WA_MOCK) { // WhatsApp through the page's bridge, against a stand-in helper
        const W = (js) => sidebar.webContents.executeJavaScript('window.floorboardDesktop.wa.' + js), sam = '27820000001@s.whatsapp.net';
        console.log('SMOKE wa state', JSON.stringify(await W('state()')));
        const q = await W('qr()'); console.log('SMOKE wa qr', q.ok && q.ok.dataUrl ? 'picture, ' + q.ok.dataUrl.length + ' chars, ' + q.ok.seconds + 's' : JSON.stringify(q));
        await fetch(process.env.FLOORBOARD_WA_MOCK + '/mock/link'); await wait(4500);
        const list = (c) => JSON.stringify(c.map((x) => [x.name, x.unread, x.last && (x.last.text || x.last.tag)]));
        console.log('SMOKE wa linked', (await W('state()')).linked, list(await W('chats()')));
        console.log('SMOKE wa messages', JSON.stringify(((await W(`messages('${sam}')`)).ok || []).map((m) => [m.me ? 'me' : m.who, m.text || m.tag])));
        console.log('SMOKE wa read', JSON.stringify(await W(`read('${sam}')`)), list(await W('chats()')));
        console.log('SMOKE wa send', JSON.stringify(await W(`send('${sam}', 'Thanks, gate 2')`)));
        console.log('SMOKE wa bad send', JSON.stringify(await W(`send('not a chat', 'x')`)));
        await wait(1500); console.log('SMOKE wa after send', list(await W('chats()')));
        console.log('SMOKE wa helper saw', JSON.stringify((await (await fetch(process.env.FLOORBOARD_WA_MOCK + '/mock/log')).json()).results.filter((x) => x[0] === 'POST')));
      }
      app.isQuitting = true; app.quit();
    }, 1500));
  } else {
    sidebar.once('ready-to-show', showSidebar);
  }
}

// target (from a sidebar shortcut) names what to open, e.g. chat:c-bakery or view:drive
function openFull(_e, target) {
  const hash = typeof target === 'string' && /^(chat|view|post):[\w:.-]+$/.test(target) ? 'go-' + target : undefined;
  if (full && !full.isDestroyed()) {
    if (hash) full.loadFile(PAGE, { query: { shell: 'desktop' }, hash });
    full.show(); full.focus(); return;
  }
  full = new BrowserWindow({ width: 1320, height: 860, minWidth: 380, minHeight: 560, title: 'Floorboard', icon: ICON, backgroundColor: '#2b2018', autoHideMenuBar: true, webPreferences });
  full.loadFile(PAGE, { query: { shell: 'desktop' }, hash });
  openLinksOutside(full);
}

// Outlook: the desktop app signs in to Microsoft itself (in the browser, back to this computer) and reads the person's own
// mail here, so the page never holds a Microsoft token. The sign-in is kept encrypted for this Windows user, or not at all.
const MS_SCOPES = ['User.Read', 'Mail.Read'];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let msApp = null, msKey = '';
const msCacheFile = () => path.join(app.getPath('userData'), 'outlook.bin');
function msClient(cfg) {
  if (!cfg || !GUID.test(String(cfg.clientId || '')) || !GUID.test(String(cfg.tenantId || ''))) throw new Error('Outlook isn’t set up for this store yet.');
  const key = cfg.clientId + '|' + cfg.tenantId;
  if (msApp && msKey === key) return msApp;
  const { PublicClientApplication } = require('@azure/msal-node');
  const cachePlugin = {
    beforeCacheAccess: async (ctx) => { try { if (safeStorage.isEncryptionAvailable()) ctx.tokenCache.deserialize(safeStorage.decryptString(fs.readFileSync(msCacheFile()))); } catch (e) { /* signed out */ } },
    afterCacheAccess: async (ctx) => { if (ctx.cacheHasChanged && safeStorage.isEncryptionAvailable()) { try { fs.writeFileSync(msCacheFile(), safeStorage.encryptString(ctx.tokenCache.serialize())); } catch (e) { /* stays signed in until closed */ } } },
  };
  msApp = new (PublicClientApplication)({ auth: { clientId: cfg.clientId, authority: 'https://login.microsoftonline.com/' + cfg.tenantId }, cache: { cachePlugin } });
  msKey = key;
  return msApp;
}
async function msToken(cfg, interactive) {
  const pca = msClient(cfg), [account] = await pca.getTokenCache().getAllAccounts();
  if (account) { try { return (await pca.acquireTokenSilent({ account, scopes: MS_SCOPES })).accessToken; } catch (e) { if (!interactive) throw new Error('signin'); } }
  if (!interactive) throw new Error('signin');
  const r = await pca.acquireTokenInteractive({
    scopes: MS_SCOPES,
    openBrowser: async (url) => { if (url.startsWith('https://login.microsoftonline.com/')) await shell.openExternal(url); },
    successTemplate: '<h2 style="font-family:sans-serif">Signed in. You can close this tab and go back to Floorboard.</h2>',
    errorTemplate: '<h2 style="font-family:sans-serif">Sign-in didn’t finish: {error}</h2>',
  });
  return r.accessToken;
}
const safe = (fn) => async (_e, arg) => { try { return { ok: await fn(arg || {}) }; } catch (e) { return { error: String((e && e.message) || e) } } };
function msIpc() {
  ipcMain.handle('ms-account', safe(async ({ cfg }) => { const [a] = await msClient(cfg).getTokenCache().getAllAccounts(); return a ? { username: a.username, name: a.name || '' } : null; }));
  ipcMain.handle('ms-signin', safe(async ({ cfg }) => { await msToken(cfg, true); const [a] = await msClient(cfg).getTokenCache().getAllAccounts(); return a ? { username: a.username, name: a.name || '' } : null; }));
  ipcMain.handle('ms-signout', safe(async ({ cfg }) => {
    try { const c = msClient(cfg).getTokenCache(); for (const a of await c.getAllAccounts()) await c.removeAccount(a); } catch (e) { /* nothing to remove */ }
    try { fs.unlinkSync(msCacheFile()); } catch (e) { /* already gone */ }
    msApp = null; return true;
  }));
  // reads only: the person's own folders, messages and attachments
  ipcMain.handle('ms-graph', safe(async ({ cfg, path: p }) => {
    if (typeof p !== 'string' || !/^\/me\/(mailFolders|messages)[\w/().,$=&?'%:+ -]*$/.test(p)) throw new Error('Not allowed');
    const res = await fetch('https://graph.microsoft.com/v1.0' + p, { headers: { Authorization: 'Bearer ' + (await msToken(cfg, false)) } });
    if (!res.ok) throw new Error('Outlook answered ' + res.status);
    return res.json();
  }));
}

// Keep the sidebar in front of Outlook and everything else (from the pin in the sidebar, or the tray menu).
function setOnTop(on) {
  prefs.onTop = !!on;
  applyOnTop();
  savePrefs();
  if (tray) tray.setContextMenu(trayMenu());
}

// Printing quotes from the drop box: the print-out goes into a hidden window and straight to the chosen printer.
async function printHtml(_e, job) {
  const file = path.join(app.getPath('temp'), 'floorboard-print-' + Date.now() + '.html');
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
  try {
    fs.writeFileSync(file, String((job && job.html) || ''));
    await win.loadFile(file);
    const printer = job && typeof job.printer === 'string' ? job.printer : '';
    return await new Promise((ok) => win.webContents.print({ silent: true, printBackground: true, ...(printer ? { deviceName: printer } : {}) }, (success, why) => ok({ ok: success, why: why || '' })));
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) };
  } finally {
    setTimeout(() => { try { win.destroy(); } catch (x) { /* already gone */ } try { fs.unlinkSync(file); } catch (x) { /* already gone */ } }, 5000);
  }
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show or hide the sidebar   Ctrl+Alt+F', click: toggleSidebar },
    { label: 'Open the full app', click: openFull },
    { type: 'separator' },
    { label: 'Keep the sidebar on top', type: 'checkbox', checked: prefs.onTop, click: (i) => setOnTop(i.checked) },
    { label: 'Show the floating button when the sidebar is closed', type: 'checkbox', checked: prefs.bubble, click: (i) => setBubble(i.checked) },
    { label: 'Show the bar at the top of the screen', type: 'checkbox', checked: prefs.bar, click: (i) => setBar(i.checked) },
    { label: 'Dock on the left', type: 'checkbox', checked: prefs.side === 'left', click: (i) => { prefs.side = i.checked ? 'left' : 'right'; savePrefs(); dock(); } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: 'separator' },
    { label: 'Quit Floorboard', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Floorboard');
  tray.on('click', toggleSidebar);
  tray.setContextMenu(trayMenu());
}

// Red items slide the sidebar into view without stealing focus and flash it on the taskbar;
// the tray tooltip always shows how many things need you.
function attention(_e, { count, urgent }) {
  if (tray) tray.setToolTip(count ? 'Floorboard · ' + count + (count === 1 ? ' thing needs you' : ' things need you') : 'Floorboard · all caught up');
  need = { count, urgent }; sendBubble();
  if (urgent && sidebar) { if (!opened) slideTo(true, { focus: false }); sidebar.flashFrame(true); }
}

app.setAppUserModelId('Floorboard'); // lets Windows show pop-up notifications for the app
// a test run keeps its own settings and runs beside an open Floorboard instead of handing over to it
if (SMOKE) app.setPath('userData', path.join(app.getPath('temp'), 'floorboard-smoke'));
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showSidebar);
  app.whenReady().then(() => {
    loadPrefs();
    whatsapp.init(); // WhatsApp beside Floorboard, once it's been linked
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media' || permission === 'notifications'));
    createSidebar();
    createBubble();
    createBar();
    bubbleIpc();
    ipcMain.on('sidebar-slim', setSlim);
    ipcMain.on('sidebar-slim-size', (_e, h) => { h = Math.round(Number(h) || 0); if (h < 200 || h > 1200 || h === slimHeight) return; slimHeight = h; if (prefs.slim && !sizing && !slide) dock(); });
    ipcMain.on('bar-state', (_e, state, focus) => { placeBar(state); if (bar && state === 'open' && focus) bar.focus(); });
    if (SMOKE) return;
    buildTray();
    globalShortcut.register('Control+Alt+F', toggleSidebar);
    screen.on('display-metrics-changed', () => { dock(); placeBar(barState); });
    ipcMain.on('open-full', openFull);
    ipcMain.on('hide-sidebar', hideSidebar);
    ipcMain.on('show-sidebar', showSidebar);
    ipcMain.on('attention', attention);
    ipcMain.handle('on-top-get', () => !!prefs.onTop);
    ipcMain.handle('on-top-set', (_e, on) => { setOnTop(on); return prefs.onTop; });
    ipcMain.handle('printers', async (e) => { try { return (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: !!p.isDefault })); } catch (x) { return []; } });
    ipcMain.handle('print-html', printHtml);
    msIpc();
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); whatsapp.stop(); });
}
