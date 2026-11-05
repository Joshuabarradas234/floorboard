// Floorboard on Windows: a frosted-glass sidebar docked to the edge of the screen, a bar at the top of the screen
// for chats, a tray icon to show or hide them, and the full app in its own window.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut, ipcMain, shell, session, safeStorage } = require('electron');
const path = require('path'), fs = require('fs');
const updates = require('./updates');
const coucou = require('./coucou');
const ask = require('./ask');
const outlook = require('./outlook');
const mfs = require('./mfs');

const PAGE = path.join(__dirname, '..', 'index.html');
const ICON = path.join(__dirname, '..', 'icon-192.png');
const SIDEBAR_WIDTH = 380;
const RAIL_W = 80; // the folded sidebar: a rounded rail of icons in its own see-through window, with room for its shadow
let railHeight = 440; // the rail's window is as tall as the rail (the page measures it)
const SMOKE = process.env.FLOORBOARD_SMOKE === '1'; // load once, print the result, quit (used for testing)
// Windows can wrongly judge the full window to be covered (with the sidebar kept in front, or some screen tools), and it
// then stops drawing and stays black. Draw it whenever it's open.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const BUBBLE = 80; // the floating button's window: the 56px button and its shadow
// the bar at the top of the screen: its window closed (the pill and its shadow) and open (the chat panel)
const BAR = { pill: { width: 320, height: 48 }, open: { width: 430, height: 490 } };
let prefs = { onTop: false, side: 'right', bubble: true, bubbleAt: null, bar: true, slim: false, width: SIDEBAR_WIDTH, coucou: true, card: 'auto', mfs: null };
let sidebar = null, full = null, tray = null, bubble = null, bar = null, rail = null, barState = 'pill';
let opened = false, slide = null, home = null, need = { count: 0, urgent: false }; // home: the work area of the screen the sidebar docks to

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
function loadPrefs() { try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch (e) { /* first run */ } }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (e) { /* not fatal */ } }

// a test run can use the demo store, so there's someone logged in to draw
const QUERY = { shell: 'desktop', ...(SMOKE && process.env.FLOORBOARD_SMOKE_DEMO ? { demo: '1' } : {}) };
const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true };
function openLinksOutside(win) {
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

// x is where the sidebar sits docked; away is just past the screen edge, where it slides to when it closes.
// Between slides its bounds stay docked, even while it's hidden.
function docked() {
  // mid-slide the sidebar can poke onto a second screen, so it keeps to the screen it docked to
  const workArea = slide && home ? home : screen.getDisplayMatching(sidebar.getBounds()).workArea;
  if (!slide) home = workArea;
  const width = Math.min(Math.max(prefs.width || SIDEBAR_WIDTH, 320), 520), height = workArea.height;
  const left = prefs.side === 'left';
  return { workArea, width, height, y: workArea.y, x: left ? workArea.x : workArea.x + workArea.width - width, away: left ? workArea.x - width : workArea.x + workArea.width };
}
function applyOnTop() { if (sidebar) sidebar.setAlwaysOnTop(prefs.onTop); if (bubble) bubble.moveTop(); }

// Folded, the sidebar is a rounded glass rail of icons in the middle of the screen edge, in its own see-through
// window (so there's no box around it), always in front. Clicking an icon opens the sidebar on that section.
function placeRail() {
  if (!rail) return;
  const workArea = home || screen.getPrimaryDisplay().workArea; // the sidebar's own screen, even while it's sliding away
  const h = Math.min(railHeight, workArea.height - 80), left = prefs.side === 'left';
  rail.setBounds({ x: left ? workArea.x : workArea.x + workArea.width - RAIL_W, y: workArea.y + Math.round((workArea.height - h) / 2), width: RAIL_W, height: h });
}
function createRail() {
  if (rail) return;
  rail = new BrowserWindow({
    width: RAIL_W, height: railHeight, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false,
    movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, show: false, title: 'Floorboard', webPreferences,
  });
  rail.setAlwaysOnTop(true, 'screen-saver');
  rail.loadFile(PAGE, { hash: 'rail', query: QUERY });
  openLinksOutside(rail);
  rail.once('ready-to-show', () => { placeRail(); if (prefs.slim) rail.showInactive(); });
  rail.on('closed', () => { rail = null; });
}
function setSlim(_e, on) {
  on = !!on;
  if (!sidebar) return;
  prefs.slim = on; savePrefs();
  if (on) {
    createRail();
    if (!rail.webContents.isLoading()) { placeRail(); rail.showInactive(); }
    if (opened) slideTo(false); else placeBubble();
  } else {
    if (rail && rail.isVisible()) rail.hide();
    slideTo(true);
  }
}
// from the rail: open the sidebar and bring a section into view (or start a new post)
function openSidebarAt(_e, section) {
  setSlim(null, false);
  if (typeof section === 'string' && section) setTimeout(() => { if (sidebar) sidebar.webContents.send('sidebar-section', section); }, 280);
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
const showSidebar = () => (prefs.slim ? setSlim(null, false) : slideTo(true));
const hideSidebar = () => slideTo(false);
const toggleSidebar = () => (prefs.slim ? setSlim(null, false) : slideTo(!opened));

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
  if (opened || prefs.slim) { if (bubble.isVisible()) bubble.hide(); return; } // the sidebar or its rail is showing
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
  placeBar('pill'); // in its spot from the start, even if it stays hidden for now
  bar.loadFile(PAGE, { hash: 'bar', query: { shell: 'desktop' } });
  openLinksOutside(bar);
  bar.once('ready-to-show', () => { placeBar('pill'); if (!inCoucou()) bar.showInactive(); });
  bar.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); setBar(false); } });
  bar.on('closed', () => { bar = null; });
}
// With Coucou running and Floorboard showing in its island, Floorboard's own bar steps aside: one island, not two.
const inCoucou = () => prefs.coucou && coucou.running();
function coucouChanged() { if (!bar) return; if (inCoucou()) bar.hide(); else if (prefs.bar) { placeBar(barState); bar.showInactive(); } }
function setCoucou(on) {
  prefs.coucou = !!on; savePrefs();
  if (prefs.coucou) coucou.init(coucouChanged); else coucou.stop();
  coucouChanged();
  if (tray) tray.setContextMenu(trayMenu());
}
// The department card beside Floorboard's in Coucou's island. The sidebar lists the ones this person could have, best
// first; the first that's ready shows, unless they picked another from the tray menu, or none. Finance's MFS card is
// ready once MFS is connected on this computer and has answered.
let cardList = [];
const cardReady = (c) => !c.mfs || !!(mfs.figures() && !mfs.figures().error);
function chosenCard() {
  if (prefs.card === 'off') return null;
  // a card they picked shows only itself (nothing while it has nothing to say); otherwise the best one that's ready
  const c = prefs.card && prefs.card !== 'auto' ? cardList.find((x) => x.id === prefs.card && (!x.mfs || mfs.figures())) : cardList.find(cardReady);
  return c ? (c.mfs ? { ...c, ...mfs.figures() } : c) : null;
}
function showCard() {
  mfs.want(cardList.some((c) => c.mfs) && (prefs.card === 'auto' || prefs.card === 'mfs'));
  const c = chosenCard();
  coucou.setCards(c ? [c] : []);
}
function setCard(id) { prefs.card = id; savePrefs(); showCard(); if (tray) tray.setContextMenu(trayMenu()); }
function islandCards(e, list) {
  if (!sidebar || e.sender !== sidebar.webContents) return;
  cardList = (Array.isArray(list) ? list : []).filter((c) => c && /^[a-z0-9-]{1,24}$/.test(c.id)).slice(0, 12)
    .map((c) => ({ id: c.id, title: String(c.title || c.id).slice(0, 40), line: String(c.line || '').slice(0, 80), busy: !!c.busy, mfs: !!c.mfs }));
  showCard();
  if (tray) tray.setContextMenu(trayMenu());
}
function cardMenu() {
  const radio = (label, id) => ({ label, type: 'radio', checked: (prefs.card || 'auto') === id, click: () => setCard(id) });
  return [
    radio('Pick for me', 'auto'),
    ...cardList.filter((c) => !c.mfs || mfs.state().connected).map((c) => radio(c.title, c.id)),
    radio('None', 'off'),
    ...(cardList.some((c) => c.mfs) ? [{ type: 'separator' }, { label: mfs.state().connected ? 'MFS: change or disconnect…' : 'Connect MFS…', click: openMfs }] : []),
  ];
}
// connecting MFS happens in the sidebar, where the person can see what they type
function openMfs() { showSidebar(); if (sidebar) sidebar.webContents.send('mfs-open'); }
function mfsIpc() {
  ipcMain.handle('mfs-state', () => mfs.state());
  ipcMain.handle('mfs-connect', async (_e, a) => {
    const r = await mfs.connect(a && a.url, a && a.key);
    if (r.ok) { prefs.mfs = r.saved; savePrefs(); showCard(); if (tray) tray.setContextMenu(trayMenu()); }
    return r.ok ? { ok: true, line: r.line } : { error: r.error };
  });
  ipcMain.handle('mfs-disconnect', () => { mfs.disconnect(); prefs.mfs = null; savePrefs(); showCard(); if (tray) tray.setContextMenu(trayMenu()); return true; });
}
function setBar(on) {
  prefs.bar = !!on; savePrefs();
  if (prefs.bar) createBar(); else if (bar) { const b = bar; bar = null; b.destroy(); }
  if (tray) tray.setContextMenu(trayMenu());
}

function createSidebar() {
  const { workArea } = screen.getPrimaryDisplay();
  sidebar = new BrowserWindow({
    x: workArea.x + workArea.width - SIDEBAR_WIDTH, y: workArea.y, width: prefs.width || SIDEBAR_WIDTH, height: workArea.height,
    minWidth: 320, maxWidth: 520, frame: false, maximizable: false, fullscreenable: false, show: false,
    title: 'Floorboard', icon: ICON, backgroundColor: '#00000000', backgroundMaterial: 'acrylic',
    alwaysOnTop: prefs.onTop, webPreferences,
  });
  sidebar.loadFile(PAGE, { hash: 'widget', query: QUERY });
  openLinksOutside(sidebar);
  sidebar.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); hideSidebar(); } });
  sidebar.on('focus', () => { sidebar.flashFrame(false); if (bubble) bubble.moveTop(); });
  // remember the width someone drags it to: 'resized' only fires when a person finishes resizing it, not for the app's own moves
  sidebar.on('resized', () => { if (slide) return; prefs.width = sidebar.getBounds().width; savePrefs(); });
  if (SMOKE) {
    sidebar.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('console:', message); });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const where = () => 'sidebar ' + (sidebar.isVisible() ? 'open at x=' + sidebar.getBounds().x : 'closed') + ', button ' + (bubble && bubble.isVisible() ? 'shown at ' + JSON.stringify(bubble.getBounds()) : 'hidden') + (bubble && bubble.isAlwaysOnTop() ? ' (on top)' : '');
    sidebar.webContents.once('did-finish-load', () => setTimeout(async () => { // once: the steps below reload the page
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
      if (process.env.FLOORBOARD_SMOKE_DEMO) await sidebar.webContents.executeJavaScript("localStorage.setItem('floorboard.session.v1', 'u5'); 1");
      setSlim(null, true); await wait(2500);
      if (process.env.FLOORBOARD_SMOKE_DEMO && rail) fs.writeFileSync(path.join(app.getPath('temp'), 'floorboard-rail.png'), (await rail.webContents.capturePage()).toPNG()); console.log('SMOKE folded: rail', rail && rail.isVisible() ? 'shown at ' + JSON.stringify(rail.getBounds()) + (rail.isAlwaysOnTop() ? ' in front' : '') : 'not shown', '| sidebar', sidebar.isVisible() ? 'visible' : 'put away', '| button', bubble && bubble.isVisible() ? 'shown' : 'hidden');
      console.log('SMOKE rail page', await rail.webContents.executeJavaScript(`document.documentElement.className + ' | ' + (document.querySelector('.srail') ? 'rail drawn' : document.body.innerText.slice(0, 80))`));
      setSlim(null, false); await wait(600); console.log('SMOKE opened: sidebar', sidebar.isVisible() ? 'open at ' + JSON.stringify(sidebar.getBounds()) : 'closed', '| rail', rail && rail.isVisible() ? 'shown' : 'hidden');
      if (process.env.FLOORBOARD_SMOKE_DEMO) { // Ask Floorboard through the server Coucou's chat uses, signed in as the demo's u5
        sidebar.webContents.reload(); await wait(4000);
        const req = (method, p, body, headers = {}) => new Promise((ok) => {
          const r = require('http').request({ host: '127.0.0.1', port: ask.PORT, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => ok({ status: res.statusCode, text: t })); });
          r.on('error', (e) => ok({ status: 0, text: e.message })); r.end(body ? JSON.stringify(body) : undefined);
        });
        console.log('SMOKE ask models', (await req('GET', '/v1/models')).text, '| from a web page:', (await req('GET', '/v1/models', null, { Origin: 'https://example.com' })).status);
        for (const q of ['What needs me today?', 'How far is the bakery with its tasks?', 'Find my payslip', 'Any meetings tomorrow?']) {
          const r = await req('POST', '/v1/chat/completions', { model: 'floorboard', stream: true, messages: [{ role: 'system', content: 'You are Coucou.' }, { role: 'user', content: q }] });
          const said = r.text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => { try { const j = JSON.parse(l.slice(6)); return j.error ? '[error: ' + j.error.message + ']' : j.choices[0].delta.content || ''; } catch (e) { return ''; } }).join('');
          console.log('SMOKE ask', JSON.stringify(q), '->', JSON.stringify(said.replace(/<think>[\s\S]*?<\/think>/, '').slice(0, 400)), '| steps:', JSON.stringify((said.match(/<think>([\s\S]*?)<\/think>/) || [])[1] || ''));
        }
        // department cards: Thandi's, then Finance's (Ayesha), with MFS against a stand-in when one is given
        const cards = (who) => console.log('SMOKE cards', who, JSON.stringify(cardList.map((c) => c.id + (c.busy ? '*' : '') + ': ' + (c.line || '(MFS)'))), '| shown:', JSON.stringify(chosenCard()), '| tray:', JSON.stringify(cardMenu().map((m) => m.type === 'separator' ? '--' : (m.checked ? '(x) ' : '') + m.label)));
        cards('u5');
        await sidebar.webContents.executeJavaScript("localStorage.setItem('floorboard.session.v1', 'u3'); location.reload(); 1"); await wait(4000);
        cards('u3');
        if (process.env.FLOORBOARD_MFS_TEST) {
          console.log('SMOKE mfs wrong key', JSON.stringify(await mfs.connect(process.env.FLOORBOARD_MFS_TEST, 'not-the-key')));
          const r = await mfs.connect(process.env.FLOORBOARD_MFS_TEST, process.env.FLOORBOARD_MFS_TEST_KEY);
          console.log('SMOKE mfs connect', JSON.stringify({ ok: r.ok, line: r.line, error: r.error, keyLocked: !!(r.saved && r.saved.key.startsWith('v1:') && !r.saved.key.includes(process.env.FLOORBOARD_MFS_TEST_KEY)) }));
          await wait(300); cards('u3 with MFS');
          setCard('approvals'); cards('u3 picked approvals'); setCard('off'); cards('u3 none'); setCard('auto');
          openMfs(); await wait(1200); // the tray's "MFS: change or disconnect…" opens this in the sidebar
          console.log('SMOKE mfs window', JSON.stringify(await sidebar.webContents.executeJavaScript("(() => { const m = document.querySelector('.modal'); return m ? m.innerText.replace(/\\s+/g, ' ').slice(0, 400) : 'no window'; })()")));
          const shot = await sidebar.webContents.capturePage(); fs.writeFileSync(path.join(app.getPath('temp'), 'floorboard-mfs.png'), shot.toPNG());
        }
      }
      if (process.env.FLOORBOARD_UPDATE_BASE) { // updates through the page's bridge, against a stand-in GitHub
        const U = (js) => sidebar.webContents.executeJavaScript('window.floorboardDesktop.updates.' + js), brief = (s) => JSON.stringify({ ask: s.ask, on: s.on, current: s.current, latest: s.latest, available: s.available, busy: s.busy, error: s.error });
        console.log('SMOKE upd first', brief(await U('state()')));
        await U('answer(true)'); await wait(1500); console.log('SMOKE upd checked', brief(await U('state()')));
        console.log('SMOKE upd installed', brief(await U('install()')));
      }
      app.isQuitting = true; app.quit();
    }, 1500));
  } else {
    sidebar.once('ready-to-show', () => (prefs.slim ? setSlim(null, true) : showSidebar())); // opens as it was left: folded or open
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
    { label: 'Show Floorboard in Coucou’s island (when Coucou is open)', type: 'checkbox', checked: prefs.coucou, click: (i) => setCoucou(i.checked) },
    { label: 'Your department’s card in Coucou’s island', enabled: prefs.coucou && cardList.length > 0, submenu: cardMenu() },
    { label: 'Dock on the left', type: 'checkbox', checked: prefs.side === 'left', click: (i) => { prefs.side = i.checked ? 'left' : 'right'; savePrefs(); dock(); } },
    { label: 'Check GitHub for new versions', type: 'checkbox', checked: updates.getState().on, click: (i) => { updates.answer(i.checked); tray.setContextMenu(trayMenu()); } },
    { label: 'Check for a new version now', enabled: updates.getState().on, click: () => { updates.check().then((st) => { if (st.available) showSidebar(); }); } },
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
function attention(_e, { count, urgent, chats, latest }) {
  coucou.update({ count, urgent, chats, latest });
  if (tray) tray.setToolTip(count ? 'Floorboard · ' + count + (count === 1 ? ' thing needs you' : ' things need you') : 'Floorboard · all caught up');
  need = { count, urgent }; sendBubble();
  if (urgent && sidebar) { if (!opened && !prefs.slim) slideTo(true, { focus: false }); sidebar.flashFrame(true); } // folded, the rail's badge shows it
}

app.setAppUserModelId('Floorboard'); // lets Windows show pop-up notifications for the app
// a test run keeps its own settings and runs beside an open Floorboard instead of handing over to it
if (SMOKE) app.setPath('userData', path.join(app.getPath('temp'), 'floorboard-smoke'));
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showSidebar);
  app.whenReady().then(() => {
    loadPrefs();
    updates.init(); // new versions from GitHub, if the person said it may look
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media' || permission === 'notifications'));
    createSidebar();
    createBubble();
    createBar();
    if (prefs.coucou && !SMOKE) coucou.init(coucouChanged); // Floorboard in Coucou's island, if Coucou is installed and running (a test run stays out of it)
    bubbleIpc();
    ipcMain.on('sidebar-slim', setSlim);
    ipcMain.on('sidebar-slim-size', (_e, h) => { h = Math.round(Number(h) || 0); if (h < 200 || h > 1200 || h === railHeight) return; railHeight = h; placeRail(); });
    ipcMain.on('rail-open', openSidebarAt);
    ipcMain.on('bar-state', (_e, state, focus) => { placeBar(state); if (bar && state === 'open' && focus) bar.focus(); });
    ipcMain.handle('on-top-get', () => !!prefs.onTop);
    ipcMain.handle('on-top-set', (_e, on) => { setOnTop(on); return prefs.onTop; });
    ask.start(() => sidebar); // Ask Floorboard from Coucou's chat
    ipcMain.handle('outlook-search', (_e, a) => outlook.search(a && a.query, a && a.days));
    mfs.init(prefs.mfs, () => { showCard(); if (tray) tray.setContextMenu(trayMenu()); }); // Finance's MFS card, if MFS is connected here
    ipcMain.on('island-cards', islandCards);
    ipcMain.on('island-line', (e, line) => { if (sidebar && e.sender === sidebar.webContents) coucou.setLine(line); });
    mfsIpc();
    if (SMOKE) return;
    buildTray();
    globalShortcut.register('Control+Alt+F', toggleSidebar);
    screen.on('display-metrics-changed', () => { dock(); placeBar(barState); placeRail(); });
    ipcMain.on('open-full', openFull);
    ipcMain.on('hide-sidebar', hideSidebar);
    ipcMain.on('show-sidebar', showSidebar);
    ipcMain.on('attention', attention);
    ipcMain.handle('printers', async (e) => { try { return (await e.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: !!p.isDefault })); } catch (x) { return []; } });
    ipcMain.handle('print-html', printHtml);
    msIpc();
  });
  app.on('window-all-closed', () => { /* keep running in the tray */ });
  // Floorboard's card leaves Coucou's island before Floorboard closes (a moment at most), or it would stay behind
  let leaving = false;
  app.on('will-quit', (e) => {
    globalShortcut.unregisterAll();
    if (leaving || !coucou.running()) return;
    leaving = true; e.preventDefault();
    Promise.race([coucou.stop(), new Promise((ok) => setTimeout(ok, 800))]).then(() => app.quit());
  });
}
