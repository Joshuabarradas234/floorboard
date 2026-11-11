// Floorboard on Windows: a frosted-glass sidebar docked to the edge of the screen, a bar at the top of the screen
// for chats, a tray icon to show or hide them, and the full app in its own window.
const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut, ipcMain, shell, session, safeStorage } = require('electron');
const path = require('path'), fs = require('fs');
const updates = require('./updates');
const coucou = require('./coucou');
const ask = require('./ask');
const outlook = require('./outlook');
const mfs = require('./mfs');
const recorder = require('./recorder');
const jarvis = require('./jarvis');
const whatsapp = require('./whatsapp');

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
// Floorboard's island, in the same spot as Coucou's: closed a small black island, open 640 wide, and taller to read
// (peek: opened a little, when a message comes in)
const BAR = { pill: { width: 320, height: 52 }, peek: { width: 460, height: 104 }, open: { width: 660, height: 204 }, tall: { width: 660, height: 404 } };
// the WhatsApp gateway's key for telling the island of messages and calls: made fresh each time Floorboard starts
const WA_KEY = require('crypto').randomBytes(16).toString('hex');
const waHook = () => (prefs.island ? 'http://127.0.0.1:' + ask.PORT + '/wa-hook?k=' + WA_KEY : '');
let prefs = { onTop: false, side: 'right', bubble: true, bubbleAt: null, bar: true, slim: false, width: SIDEBAR_WIDTH, coucou: true, card: 'auto', mfs: null, jarvisUser: '', jarvisCard: true, jarvisNotify: true, island: true }; // (a new install gets Floorboard's own island; Coucou only when chosen in the tray menu)
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
  if (!sidebar || sidebar.isDestroyed()) return;
  clearInterval(slide); slide = null;
  const { width, height, x, y, away } = docked();
  const from = sidebar.isVisible() ? sidebar.getBounds().x : away, to = open ? x : away;
  opened = open; sendBubble();
  if (open) placeBubble();
  if (open && sidebar.isMinimized()) sidebar.restore(); // Windows can minimize it (Show desktop): bring it back first
  if (open && !sidebar.isVisible()) { sidebar.setBounds({ x: from, y, width, height }); if (focus) sidebar.show(); else sidebar.showInactive(); }
  if (open && focus) sidebar.focus();
  const t0 = Date.now(), ms = 220;
  const step = () => {
    if (sidebar.isDestroyed()) { clearInterval(slide); slide = null; return; }
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
  barState = state === 'open' || state === 'tall' || state === 'peek' ? state : 'pill';
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
  if (SMOKE) bar.webContents.on('console-message', (_e, level, message) => { if (level >= 2 && !/Security Warning/.test(message)) console.log('console: [island] ' + message); });
  placeBar('pill'); // in its spot from the start, even if it stays hidden for now
  bar.loadFile(PAGE, { hash: 'bar', query: QUERY });
  openLinksOutside(bar);
  bar.once('ready-to-show', () => { placeBar('pill'); if (!inCoucou()) bar.showInactive(); });
  bar.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); setBar(false); } });
  bar.on('closed', () => { bar = null; });
}
// With Coucou running and Floorboard showing in its island, Floorboard's own bar steps aside: one island, not two.
// With Floorboard's own island chosen, Coucou is left out: no cards go there, and the island never steps aside for it.
const inCoucou = () => !prefs.island && prefs.coucou && coucou.running();
function coucouChanged() {
  // the pages hear it too: with Coucou's island there, Ask Floorboard is its chat, so the sidebar doesn't show its own
  BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send('coucou-state', inCoucou()); });
  if (!bar) return; if (inCoucou()) bar.hide(); else if (prefs.bar) { placeBar(barState); bar.showInactive(); }
}
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
  const c = chosenCard(), j = prefs.jarvisCard !== false ? jarvis.card() : null;
  coucou.setCards([c, j].filter(Boolean));
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
// JARVIS on this computer, for the account it's linked to: its card in Coucou's island, notifications, Coucou's chat, and
// jobs sent from the sidebar. The sidebar says who's signed in; JARVIS's work only ever goes to that account's windows.
let jarvisWas = '';
function jarvisChanged() {
  showCard();
  const st = jarvis.state(), key = JSON.stringify(st);
  if (key !== jarvisWas) { jarvisWas = key; [sidebar, full, bar].forEach((w) => { if (w && !w.isDestroyed()) w.webContents.send('jarvis-state', st); }); }
  if (tray && st.mine !== jarvisMenuWas) { jarvisMenuWas = st.mine; tray.setContextMenu(trayMenu()); }
}
let jarvisMenuWas = false;
const ours = (e) => [sidebar, full, bar].some((w) => w && !w.isDestroyed() && e.sender === w.webContents);
// Logging in or out in one window (the sidebar, say) is passed to the others (the island at the top, the full app, the
// slim rail), which pick it up straight away
// the sidebar's meeting recorder: screen, microphone and the computer's sound to a video on this computer, and what's said
function recorderIpc() {
  recorder.allowScreen();
  ipcMain.handle('rec-start', (e) => (ours(e) ? recorder.start() : { error: 'no' }));
  ipcMain.handle('rec-chunk', (e, buf) => (ours(e) ? recorder.chunk(buf) : false));
  ipcMain.handle('rec-sound', (e, buf) => (ours(e) ? recorder.sound(buf) : false));
  ipcMain.handle('rec-status', (e) => (ours(e) ? recorder.status() : {}));
  ipcMain.handle('rec-stop', (e) => (ours(e) ? recorder.stop() : { error: 'no' }));
  ipcMain.handle('rec-cancel', (e) => { if (ours(e)) recorder.cancel(); return true; });
  ipcMain.on('rec-open-folder', (e, file) => { if (ours(e)) recorder.openFolder(typeof file === 'string' ? file : ''); });
  ipcMain.on('rec-play', (e, file) => { if (ours(e)) recorder.play(typeof file === 'string' ? file : ''); });
  ipcMain.on('rec-speech-settings', (e) => { if (ours(e)) recorder.openSpeechSettings(); });
  ipcMain.handle('rec-speech-on', (e) => (ours(e) ? recorder.speechOn() : false));
}
function sessionIpc() {
  ipcMain.on('session-changed', (e, st) => {
    if (!ours(e)) return;
    [sidebar, bar, full, rail].forEach((w) => { if (w && !w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('session-changed', st === 'in' ? 'in' : 'out'); });
  });
}
function jarvisIpc() {
  ipcMain.on('jarvis-who', (e, w) => { if (ours(e)) jarvis.setWho(w); });
  ipcMain.handle('jarvis-state', (e) => (ours(e) ? jarvis.state() : {}));
  ipcMain.handle('jarvis-link', (e) => (ours(e) ? jarvis.link() : { error: 'no' }));
  ipcMain.handle('jarvis-unlink', (e) => (ours(e) ? jarvis.unlink() : { error: 'no' }));
  ipcMain.handle('jarvis-suits', async (e) => { if (!ours(e) || !jarvis.ready()) return { error: 'JARVIS isn’t open on this computer.' }; try { return { suits: await jarvis.suits() }; } catch (x) { return { error: x.message }; } });
  ipcMain.handle('jarvis-run', (e, a) => (ours(e) ? jarvis.run(a && a.job, !!(a && a.confirm)) : { error: 'no' }));
  ipcMain.handle('jarvis-continue', (e, id) => (ours(e) ? jarvis.carryOn(id) : { error: 'no' }));
  // the island's 💬 asking JARVIS, and files dropped on the island going to the sidebar's Send work
  ipcMain.handle('jarvis-ask', (e, a) => (ours(e) ? jarvis.answer(String((a && a.q) || '').slice(0, 4000), Array.isArray(a && a.history) ? a.history.slice(-12) : [], () => {}) : ''));
  ipcMain.on('jarvis-prefill', (e, paths) => {
    if (!ours(e) || !Array.isArray(paths)) return;
    openSidebarAt(null, '.w-jv');
    setTimeout(() => { if (sidebar) sidebar.webContents.send('jarvis-prefill', paths.filter((p) => typeof p === 'string').slice(0, 20)); }, 500);
  });
}
function jarvisMenu() {
  return [
    { label: 'Its card in Coucou’s island', type: 'checkbox', checked: prefs.jarvisCard !== false, enabled: prefs.coucou, click: (i) => { prefs.jarvisCard = i.checked; savePrefs(); showCard(); } },
    { label: 'Pop-ups when its work is done, or the morning brief is in', type: 'checkbox', checked: prefs.jarvisNotify !== false, click: (i) => { prefs.jarvisNotify = i.checked; savePrefs(); } },
    { label: 'Open JARVIS in the sidebar', click: () => openSidebarAt(null, '.w-jv') },
  ];
}
// Floorboard's own island: the bar at the top grown into cards (Floorboard with its search, the week's tasks, JARVIS,
// Mail, WhatsApp), in place of Coucou's. Chosen from the tray; with it on, nothing goes to Coucou.
function setIsland(on) {
  prefs.island = !!on; savePrefs();
  if (prefs.island) { coucou.stop(); if (!prefs.bar) setBar(true); } else if (prefs.coucou) coucou.init(coucouChanged);
  whatsapp.setHook(waHook());
  coucouChanged(); islandSend();
  if (tray) tray.setContextMenu(trayMenu());
}
// What the island's cards get from here: WhatsApp's chats and counts, and Mail's newest and how many came in since the
// card was last opened (Outlook is asked every minute; it answers only while it's open).
let mail = { closed: true, emails: [], count: 0, error: '' }, mailSeen = 0, mailTimer = null;
const mailSeenFile = () => path.join(app.getPath('userData'), 'mail-seen.json');
async function mailPoll() {
  const r = await outlook.list('', 30);
  if (r.error) mail = { closed: !!r.closed, emails: r.closed ? [] : mail.emails, count: r.closed ? 0 : mail.count, error: r.error };
  else {
    if (!mailSeen) { mailSeen = Date.now(); try { fs.writeFileSync(mailSeenFile(), String(mailSeen)); } catch (e) { /* for now only */ } }
    mail = { closed: false, emails: r.emails, error: '', count: r.unread, from: r.from }; // Outlook's own count of unread emails in the inbox, and who they're from
  }
  islandSend();
}
// the Windows wallpaper's average colour: with the sidebar see-through, that's the colour it shows, so the island takes it
let wallColor = '', wallAt = 0;
function wallpaperColor() {
  if (Date.now() - wallAt < 10 * 60 * 1000) return wallColor;
  wallAt = Date.now();
  try {
    let file = '';
    try { file = String(require('child_process').execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { encoding: 'utf8', windowsHide: true })).split(/REG_SZ\s+/)[1].trim(); } catch (e) { /* none set */ }
    let img = file && fs.existsSync(file) ? nativeImage.createFromPath(file) : null;
    if (!img || img.isEmpty()) { // the copy Windows keeps, which has no extension
      const t = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper'), tmp = path.join(app.getPath('temp'), 'floorboard-wallpaper.jpg');
      if (fs.existsSync(t)) { fs.copyFileSync(t, tmp); img = nativeImage.createFromPath(tmp); }
    }
    if (img && !img.isEmpty()) { const b = img.resize({ width: 1, height: 1, quality: 'good' }).toBitmap(); wallColor = '#' + [b[2], b[1], b[0]].map((v) => v.toString(16).padStart(2, '0')).join(''); }
  } catch (e) { /* keeps the last one */ }
  return wallColor;
}
// The sidebar's own colour, as it's drawn: its picture made small, averaged over what isn't see-through. The island
// takes exactly that. Looked at again every few seconds while the sidebar shows, so a new wallpaper or glass carries over.
let sideColor = prefs.sideColor || '';
async function sampleSidebar() {
  try {
    if (!sidebar || sidebar.isDestroyed() || !sidebar.isVisible() || sidebar.isMinimized()) return;
    const img = (await sidebar.webContents.capturePage()).resize({ width: 12, height: 32, quality: 'good' }), b = img.toBitmap();
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 200) { bl += b[i]; g += b[i + 1]; r += b[i + 2]; n++; }
    if (n < (b.length / 4) * 0.5) return; // mostly see-through: the island keeps working it out from the wallpaper
    const c = '#' + [r, g, bl].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
    if (c !== sideColor) { sideColor = c; prefs.sideColor = c; savePrefs(); islandSend(); }
  } catch (e) { /* keeps the last one */ }
}
// is Outlook (classic) on this computer? (the Mail card offers to open it only when it is)
let classicAt = null;
function hasClassic() { if (classicAt === null) { try { require('child_process').execFileSync('reg', ['query', 'HKCR\\Outlook.Application\\CurVer'], { windowsHide: true, stdio: 'ignore' }); classicAt = true; } catch (e) { classicAt = false; } } return classicAt; }
function islandState() { return { island: !!prefs.island, side: sideColor, wall: wallpaperColor(), whatsapp: whatsapp.summary(), mail: { closed: mail.closed, classic: hasClassic(), error: mail.error, count: mail.count, from: mail.from || [], emails: mail.emails.slice(0, 30) } }; }
function islandSend() { if (bar && !bar.isDestroyed()) bar.webContents.send('island-state', islandState()); }
function islandIpc() {
  try { mailSeen = Number(fs.readFileSync(mailSeenFile(), 'utf8')) || 0; } catch (e) { /* first look */ }
  sideColor = prefs.sideColor || sideColor; // the sidebar's colour last time, until it's looked at again
  ipcMain.handle('island-state', (e) => (ours(e) ? islandState() : {}));
  ipcMain.handle('island-opened', (e, card) => {
    if (!ours(e)) return false;
    if (card === 'whatsapp') whatsapp.opened();
    if (card === 'mail') { mailSeen = Date.now(); mail.count = 0; try { fs.writeFileSync(mailSeenFile(), String(mailSeen)); } catch (x) { /* for now only */ } islandSend(); }
    return true;
  });
  ipcMain.handle('wa-messages', (e, a) => (ours(e) ? whatsapp.messages(String((a && a.jid) || ''), !!(a && a.read)) : {}));
  ipcMain.handle('wa-find', (e, q) => (ours(e) ? whatsapp.find(String(q || '').slice(0, 80)) : {}));
  ipcMain.handle('wa-send', (e, a) => (ours(e) ? whatsapp.send(String((a && a.jid) || ''), String((a && a.text) || '')) : { error: 'no' }));
  ipcMain.handle('wa-open', (e, jid) => (ours(e) ? whatsapp.openApp(String(jid || '')) : {}));
  ipcMain.handle('wa-end-call', (e) => { if (ours(e)) whatsapp.endCall(); return true; });
  // linking WhatsApp on this computer: its gateway (downloaded and checked), then the QR code for the phone
  ipcMain.handle('wa-install', (e) => (ours(e) ? whatsapp.install() : { error: 'no' }));
  ipcMain.handle('wa-qr', (e) => (ours(e) ? whatsapp.linkQr() : { error: 'no' }));
  ipcMain.handle('wa-link-status', (e) => (ours(e) ? whatsapp.linkStatus() : {}));
  ipcMain.handle('mail-list', async (e, q) => {
    if (!ours(e)) return {};
    if (!String(q || '').trim()) { await mailPoll(); return { emails: mail.emails, error: mail.error, closed: mail.closed }; }
    return outlook.list(String(q).slice(0, 120), 30);
  });
  ipcMain.handle('mail-read', (e, a) => (ours(e) ? outlook.read(a && a.id, a && a.store) : {}));
  ipcMain.handle('mail-open-outlook', (e) => (ours(e) ? outlook.openOutlook() : {}));
  // the sidebar's colour for the island: soon after it loads, then every few seconds
  setTimeout(sampleSidebar, 4000); setInterval(sampleSidebar, 6000);
  // where the pointer is, for the characters' eyes: sent to the island while it shows, only when it moved
  let ptr = '';
  setInterval(() => {
    if (!bar || bar.isDestroyed() || !bar.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = bar.getBounds(), k = (p.x - b.x) + ',' + (p.y - b.y);
    if (k !== ptr) { ptr = k; bar.webContents.send('island-cursor', { x: p.x - b.x, y: p.y - b.y }); }
  }, 50);
  // a test run reads WhatsApp and Outlook only from stand-ins it's given, never this computer's own
  if (!SMOKE || process.env.FLOORBOARD_WA_URL) { whatsapp.init(islandSend); whatsapp.setHook(waHook()); }
  if (!SMOKE || process.env.FLOORBOARD_SMOKE_MAIL) { mailPoll(); mailTimer = setInterval(mailPoll, 60 * 1000); }
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
    alwaysOnTop: prefs.onTop, webPreferences: { ...webPreferences, backgroundThrottling: false }, // (Minutes keeps recording while the sidebar is tucked away)
  });
  sidebar.loadFile(PAGE, { hash: 'widget', query: QUERY });
  openLinksOutside(sidebar);
  sidebar.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); hideSidebar(); } });
  // if it's ever closed for good anyway (the page closing itself, a crash), make it again, tucked away behind the floating button
  sidebar.on('closed', () => { if (app.isQuitting) return; clearInterval(slide); slide = null; createSidebar(); opened = false; sendBubble(); placeBubble(); });
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
      if (process.env.FLOORBOARD_SMOKE_REC) { // the sidebar's meeting recorder: a short real recording of the screen, and minutes from a stand-in for Windows' speech
        const J = (x) => sidebar.webContents.executeJavaScript(x);
        ipcMain.on('open-full', openFull); // as the real app has it (a test run otherwise leaves it out)
        await J("(() => { localStorage.setItem('floorboard.session.v1', 'u5'); const k = 'floorboard.demo.v5', d = JSON.parse(localStorage.getItem(k) || 'null'); if (!d) return 0; d.users.find((x) => x.id === 'u5').recorder = " + (process.env.FLOORBOARD_SMOKE_REC === 'voice' ? "'voice'" : 'true') + "; if (d.pins.u5) { delete d.pins.u5.myfolders; d.pins.u5.myfiles = []; } localStorage.setItem(k, JSON.stringify(d)); location.reload(); return 1; })()"); await wait(4500);
        console.log('SMOKE rec card', JSON.stringify(await J("(document.querySelector('.w-rec') || {}).innerText || 'none'")));
        await J("[...document.querySelectorAll('.w-rec button')].find((b) => b.innerText === 'Record').click(); 1"); await wait(800);
        console.log('SMOKE rec asks', JSON.stringify(await J("(document.querySelector('.modal') || {}).innerText || 'no question'")));
        await J("[...document.querySelectorAll('.modal button')].find((b) => /Start recording/.test(b.innerText)).click(); 1"); await wait(Number(process.env.FLOORBOARD_SMOKE_REC_SECONDS || 10) * 1000);
        console.log('SMOKE rec during', JSON.stringify(await J("document.querySelector('.w-rec').innerText.replace(/\\n+/g, ' | ')")), JSON.stringify(recorder.status()));
        await J("[...document.querySelectorAll('.w-rec button')].find((b) => b.innerText === 'Stop').click(); 1"); await wait(15000);
        console.log('SMOKE rec after', JSON.stringify(await J("document.querySelector('.w-rec').innerText.replace(/\\n+/g, ' | ') + ' || ' + ([...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' / '))")));
        const pins = JSON.parse(await J("JSON.stringify(JSON.parse(localStorage.getItem('floorboard.demo.v5')).pins.u5 || {})"));
        console.log('SMOKE rec my files', JSON.stringify({ folders: (pins.myfolders || []).map((f) => f.name), files: (pins.myfiles || []).slice(0, 2).map((f) => ({ title: f.title, video: f.video, att: f.att && { name: f.att.name, size: f.att.size, mime: f.att.mime }, inFolder: (pins.myfolders || []).some((x) => x.id === f.folder) })) }));
        const att = pins.myfiles && pins.myfiles[0] && pins.myfiles[0].att;
        if (att) { // the minutes PDF, for reading
          const b64 = await J(`Blobs.get(${JSON.stringify(att.id)}).then((b) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(b); }))`);
          fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-minutes.pdf'), Buffer.from(b64, 'base64'));
          console.log('SMOKE rec minutes saved', path.join(app.getPath('userData'), 'smoke-minutes.pdf'));
        }
        // Stop opens Floorboard by itself on My files › Meeting recordings, with the new minutes open (no clicks here)
        console.log('SMOKE rec opened by itself', !!(full && !full.isDestroyed() && full.isVisible()) ? 'yes, at ' + full.webContents.getURL().split('#')[1] : 'no');
        const F = (x) => (full && !full.isDestroyed() ? full.webContents.executeJavaScript(x) : Promise.resolve('no window'));
        console.log('SMOKE rec files page', JSON.stringify(await F("(document.querySelector('.page h1, h1') || {}).innerText || ''")));
        console.log('SMOKE rec files viewer', JSON.stringify(await F("((document.querySelector('.fview') || {}).innerText || 'no viewer: ' + document.body.innerText.slice(0, 300)).replace(/\\n+/g, ' | ').slice(0, 500)")));
        console.log('SMOKE rec files buttons', await F("[...document.querySelectorAll('.fv-video button')].map((b) => b.innerText).join(' + ') || 'none'"), '| pdf pages shown:', await F("document.querySelectorAll('.fview canvas, .fview img').length"));
        if (process.env.FLOORBOARD_SMOKE_SHOTS) { fs.writeFileSync(path.join(process.env.FLOORBOARD_SMOKE_SHOTS, 'minutes-files.png'), (await full.webContents.capturePage()).toPNG()); fs.writeFileSync(path.join(process.env.FLOORBOARD_SMOKE_SHOTS, 'minutes-sidebar.png'), (await sidebar.webContents.capturePage()).toPNG()); }
        const dir = path.join(app.getPath('documents'), 'Meeting recordings'), vids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.webm$/.test(n)).map((n) => ({ n, s: fs.statSync(path.join(dir, n)) })).sort((x, y) => y.s.mtimeMs - x.s.mtimeMs) : [];
        const v = vids[0], head = v ? fs.readFileSync(path.join(dir, v.n)).subarray(0, 4).toString('hex') : '';
        const top = v ? fs.readFileSync(path.join(dir, v.n)).subarray(0, 4096).toString('latin1') : '';
        console.log('SMOKE rec video', JSON.stringify(v ? { name: v.n, kb: Math.round(v.s.size / 1024), webm: head === '1a45dfa3', tracks: (top.match(/V_VP[89]|A_OPUS/g) || []).join('+'), length: top.includes('\x44\x89') } : 'none'));
        app.quit(); return;
      }
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
        if (process.env.FLOORBOARD_JARVIS_DECK) { // JARVIS, against a stand-in deck: only an admin may link it, then only that account sees it
          const js = (x) => sidebar.webContents.executeJavaScript(x), shot = async (name) => fs.writeFileSync(path.join(app.getPath('temp'), name), (await sidebar.webContents.capturePage()).toPNG());
          const st = () => { const s = jarvis.state(); return JSON.stringify({ found: s.found, linked: s.linked, mine: s.mine, canLink: s.canLink, connected: s.connected, error: s.error, runs: (s.runs || []).map((r) => r.title + ' ' + r.status + ' ' + r.progress + '%'), attention: (s.attention || []).length, brief: s.brief ? s.brief.title : null }); };
          const deck = JSON.parse(fs.readFileSync(process.env.FLOORBOARD_JARVIS_DECK, 'utf8'));
          const emit = (b) => new Promise((ok) => { const r = require('http').request({ host: '127.0.0.1', port: deck.port, path: '/test/emit', method: 'POST', headers: { 'x-deck-key': deck.token } }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => ok(t)); }); r.end(JSON.stringify(b)); });
          const chat = async (model, q, history = []) => {
            const r = await req('POST', '/v1/chat/completions', { model, stream: true, messages: [...history, { role: 'user', content: q }] });
            return r.text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => { try { const x = JSON.parse(l.slice(6)); return x.error ? '[error: ' + x.error.message + ']' : x.choices[0].delta.content || ''; } catch (e) { return ''; } }).join('').replace(/<think>[\s\S]*?<\/think>/, '');
          };
          await wait(5500); console.log('SMOKE jarvis u3 (no admin)', st(), '| slips card:', await js("!!document.querySelector('.w-slip:not(.w-jv-offer)')"), '| on the page:', await js("!!document.querySelector('.w-jv,.w-jv-offer')"));
          await js("localStorage.setItem('floorboard.session.v1', 'u1'); location.reload(); 1"); await wait(4500);
          console.log('SMOKE jarvis u1 before linking', st(), '| slips card:', await js("!!document.querySelector('.w-slip:not(.w-jv-offer)')"), '| offer:', JSON.stringify(await js("(document.querySelector('.w-jv-offer') || {}).innerText || 'none'")));
          console.log('SMOKE jarvis models before linking', (await req('GET', '/v1/models')).text);
          console.log('SMOKE jarvis link', JSON.stringify(await js('window.floorboardDesktop.jarvis.link()'))); await wait(1500);
          console.log('SMOKE jarvis linked', st(), '| card:', JSON.stringify(jarvis.card()), '| prefs:', prefs.jarvisUser);
          console.log('SMOKE jarvis page', JSON.stringify(await js("(document.querySelector('.w-jv') || {}).innerText || 'none'")));
          await js("document.querySelector('.w-jv').scrollIntoView(); 1"); await wait(300); await shot('floorboard-jarvis.png');
          await emit({ run: 'r1', set: { status: 'done', progress: 100, finishedAt: Date.now(), step: 'Done' } }); await wait(800);
          console.log('SMOKE jarvis run finished', JSON.stringify(jarvis.card()));
          await emit({ brief: true }); await wait(800); console.log('SMOKE jarvis brief in', JSON.stringify(jarvis.card().note), st());
          await emit({ attention: [] }); await wait(800); console.log('SMOKE jarvis nothing needs you', JSON.stringify(jarvis.card()));
          console.log('SMOKE jarvis models', (await req('GET', '/v1/models')).text);
          for (const q of ['How far is the hardware flyer?', 'What needs me?', 'Morning brief please', 'What are you working on?', 'Start some marketing for the café']) console.log('SMOKE jarvis chat', JSON.stringify(q), '->', JSON.stringify(await chat('jarvis', q)));
          console.log('SMOKE jarvis via floorboard', JSON.stringify(await chat('floorboard', 'JARVIS, how far is the menu boards?')));
          const offer = await chat('jarvis', 'continue the flyer'); console.log('SMOKE jarvis continue?', JSON.stringify(offer));
          console.log('SMOKE jarvis yes', JSON.stringify(await chat('jarvis', 'yes', [{ role: 'user', content: 'continue the flyer' }, { role: 'assistant', content: offer }])), '| r3 now', JSON.stringify((jarvis.state().runs || []).filter((r) => r.id === 'r3').map((r) => r.status)));
          const png = path.join(app.getPath('temp'), 'floorboard-jarvis.png');
          const job = { tower: 'wayne', floor: 'we-marketing', suit: 'joker-bat', client: 'Corner Café', files: [png], task: 'Make 3 Instagram posts from this' };
          const run = (j, c) => js('window.floorboardDesktop.jarvis.run(' + JSON.stringify(j) + ', ' + !!c + ')').then((x) => JSON.stringify(x));
          console.log('SMOKE jarvis job no file', await run({ ...job, files: ['artwork.png'] }), '| no suit', await run({ ...job, suit: '' }), '| no task', await run({ ...job, task: '' }));
          console.log('SMOKE jarvis job check', await run(job));
          console.log('SMOKE jarvis job start', await run(job, true)); await wait(800);
          console.log('SMOKE jarvis after start', st(), '| the stand-in got', JSON.stringify(JSON.parse(await emit({})).received.map((b) => ({ suit: b.suit, client: b.client, floor: b.floor, files: b.files.length, task: b.task, confirm: b.confirm }))));
          await js("document.querySelector('.w-jv .btn.primary').click(); 1"); await wait(1500);
          await js("(() => { const s = document.querySelector('#jv-form select'); s.value = 'joker-bat'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()"); await wait(300);
          console.log('SMOKE jarvis send window', JSON.stringify(await js("(document.querySelector('.modal') || {}).innerText || 'no window'").then((t) => t.replace(/\s+/g, ' ').slice(0, 500))));
          await shot('floorboard-jarvis-send.png');
          await js("(() => { const s = document.querySelector('#jv-form select'); s.value = 'oracle'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()"); await wait(300);
          console.log('SMOKE jarvis unreachable suit', JSON.stringify(await js("[...document.querySelectorAll('#jv-form .err, #jv-form select')].map((x) => x.tagName === 'SELECT' ? x.options[x.selectedIndex].text : x.innerText).join(' | ')")));
          if (bar && process.env.FLOORBOARD_WA_URL) { // Floorboard's island, signed in as u1 with JARVIS linked, against a stand-in WhatsApp
            const B = (x) => bar.webContents.executeJavaScript(x), bshot = async (name) => fs.writeFileSync(path.join(app.getPath('temp'), name), (await bar.webContents.capturePage()).toPNG());
            const typeIn = (sel, v) => B(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return 'no ' + ${JSON.stringify(sel)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`);
            const pick = (name) => B(`(() => { const b = [...document.querySelectorAll('.isl-pick')].find((x) => x.title === ${JSON.stringify(name)}); if (b) b.click(); return !!b; })()`);
            const text = (sel) => B(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\n+/g, ' | ').slice(0, 400) : 'none'; })()`);
            setIsland(true); // the island chosen over Coucou: the stand-in gateway is told where to send messages and calls
            bar.webContents.reload(); await wait(5000);
            console.log('SMOKE island page', JSON.stringify(await B("document.documentElement.className + ' | ' + document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)")));
            console.log('SMOKE island pill', JSON.stringify(await text('.isl-pill')), JSON.stringify(bar.getBounds())); await bshot('fb-island-1-pill.png');
            await B("document.querySelector('.isl-pill').click(); 1"); await wait(1000);
            console.log('SMOKE island home', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-grid')), '||', JSON.stringify(await text('.isl-left')));
            console.log('SMOKE island eyes', await B("[...document.querySelectorAll('.isl-ch')].slice(0, 3).map((e) => e.style.getPropertyValue('--ex') + ',' + e.style.getPropertyValue('--ey')).join(' ')"));
            await bshot('fb-island-2-home.png');
            if (process.env.FLOORBOARD_SMOKE_WALINK) { // linking WhatsApp from the island, against a stand-in gateway with no phone linked yet
              console.log('SMOKE walink', await pick('WhatsApp')); await wait(800);
              console.log('SMOKE walink card', JSON.stringify(await text('.isl-left')));
              await B("(() => { const b = [...document.querySelectorAll('.isl-left .isl-more')].find((x) => /Link WhatsApp/.test(x.innerText)); if (b) b.click(); return 1; })()"); await wait(3000); // (with the gateway there, the code shows straight away)
              console.log('SMOKE walink qr', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-left')), await B("(document.querySelector('.isl-qr img') || {}).naturalWidth || 0")); await bshot('fb-walink-qr.png');
              await wait(13000); console.log('SMOKE walink qr again', JSON.stringify(await B("[((document.querySelector('.isl-qr img') || {}).src || '').slice(-40), document.querySelector('.isl') && document.querySelector('.isl').className]")));
              await fetch(process.env.FLOORBOARD_WA_URL + '/test/scan').catch(() => {}); await wait(4000);
              console.log('SMOKE walink after scan', JSON.stringify(await text('.isl-left'))); await bshot('fb-walink-done.png');
              await wait(17000); console.log('SMOKE walink chats', JSON.stringify(await text('.isl-left')));
            }
            console.log('SMOKE island search', await typeIn('#isl-q', 'bakery')); await wait(700);
            console.log('SMOKE island search results', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-list'))); await bshot('fb-island-3-search.png');
            await typeIn('#isl-q', ''); await wait(400);
            console.log('SMOKE island whatsapp', await pick('WhatsApp')); await wait(900);
            console.log('SMOKE island whatsapp card', JSON.stringify(await text('.isl-left'))); await bshot('fb-island-4-whatsapp.png');
            await B("document.querySelector('.isl-left .isl-row').click(); 1"); await wait(1200);
            console.log('SMOKE island whatsapp chat', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-wa'))); await bshot('fb-island-5-wachat.png');
            await typeIn('.isl-wa .fbar-reply input', 'Test from the island'); await B("document.querySelector('.isl-wa .fbar-reply').requestSubmit(); 1"); await wait(1500);
            const sentWa = await fetch(process.env.FLOORBOARD_WA_URL + '/test/sent').then((r) => r.json()).catch(() => []);
            console.log('SMOKE island whatsapp sent', JSON.stringify(sentWa));
            await B("document.querySelector('.isl-wa .fbar-ic').click(); 1"); await wait(500);
            await B("document.querySelector('.isl-left .isl-btn.sm').click(); 1"); await wait(300); await typeIn('.isl-left .isl-search input', 'zoe'); await wait(1200);
            console.log('SMOKE island whatsapp find', JSON.stringify(await text('.isl-left .isl-list'))); await bshot('fb-island-6-wafind.png');
            await B("document.querySelector('.isl-left .isl-btn.sm').click(); 1"); await wait(300);
            console.log('SMOKE island mail', await pick('Mail')); await wait(700); console.log('SMOKE island mail card', JSON.stringify(await text('.isl-left'))); await bshot('fb-island-7-mail.png');
            console.log('SMOKE island teams', await pick('Teams')); await wait(700); console.log('SMOKE island teams card', JSON.stringify(await text('.isl-left')));
            await B("(() => { const b = [...document.querySelectorAll('.isl-left .isl-more')].find((x) => /Connect Teams/.test(x.innerText)); if (b) b.click(); return 1; })()"); await wait(3000); // (connected already from an earlier run: nothing to click)
            console.log('SMOKE island teams connected', JSON.stringify(await text('.isl-left'))); await bshot('fb-island-8-teams.png');
            await B("document.querySelector('.isl-left .isl-who-row').click(); 1"); await wait(700); console.log('SMOKE island teams from', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-left'))); await bshot('fb-island-9-teams-from.png');
            await B("document.querySelector('.isl-left .isl-ch-row .isl-btn').click(); 1"); await wait(400);
            console.log('SMOKE island taskboard', await pick('Tasks')); await wait(700); console.log('SMOKE island taskboard card', JSON.stringify(await text('.isl-left'))); await bshot('fb-island-10-week.png');
            await B("document.querySelector('.isl-tab[aria-label=\"Ask Floorboard\"]').click(); 1"); await wait(600); await typeIn('.isl-ask-in input', 'What needs me?'); await B("document.querySelector('.isl-ask-in').requestSubmit(); 1"); await wait(3500);
            console.log('SMOKE island ask', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-ask-msgs'))); await bshot('fb-island-11-ask.png');
            await B("document.querySelector('.isl-tab[aria-label=\"Drop files\"]').click(); 1"); await wait(500); console.log('SMOKE island drop', JSON.stringify(await text('.isl-drop'))); await bshot('fb-island-12-drop.png');
            await B("document.querySelector('.isl-btn[aria-label=\"Island settings\"]').click(); 1"); await wait(500); console.log('SMOKE island settings', JSON.stringify(await text('.isl-set'))); await bshot('fb-island-13-settings.png');
            await B("document.querySelector('.isl-btn[aria-label=\"Close the island\"]').click(); 1"); await wait(600);
            console.log('SMOKE island webhook', JSON.stringify(await fetch(process.env.FLOORBOARD_WA_URL + '/test/hook').then((r) => r.json()).catch(() => ({}))).replace(/k=[0-9a-f]+/, 'k=…'));
            await fetch(process.env.FLOORBOARD_WA_URL + '/test/new').catch(() => {}); await wait(2500);
            console.log('SMOKE island message peek', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-peekbar'))); await bshot('fb-island-14-peek.png');
            await wait(6000);
            console.log('SMOKE island pill after the peek', JSON.stringify(await text('.isl-pill')), JSON.stringify(bar.getBounds()), await B("[...document.querySelectorAll('.isl-pill .isl-n')].length")); await bshot('fb-island-15-pill-new.png');
            await fetch(process.env.FLOORBOARD_WA_URL + '/test/call').catch(() => {}); await wait(1500);
            console.log('SMOKE island call', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-left')), await B("!!document.querySelector('.isl-me .isl-ch.ring')")); await bshot('fb-island-16-call.png');
            await B("[...document.querySelectorAll('.isl-more')].find((b) => b.innerText === 'Not now').click(); 1"); await wait(1200);
            console.log('SMOKE island after the call', JSON.stringify(bar.getBounds()), JSON.stringify(await text('.isl-pill')));
            // logging out and back in in the sidebar reaches the island at the top straight away (through the app)
            const who = await js("localStorage.getItem('floorboard.session.v1') || ''"), topIs = () => B("document.querySelector('.isl-pill, .isl-panel') ? 'island' : document.querySelector('.fbar-pill') ? 'login pill' : 'other'");
            await js("localStorage.setItem('floorboard.session.v1', ''); window.floorboardDesktop.session.tell('out'); 1"); await wait(1000);
            console.log('SMOKE session out: the top shows', JSON.stringify(await topIs()));
            await js(`localStorage.setItem('floorboard.session.v1', ${JSON.stringify(who)}); window.floorboardDesktop.session.tell('in'); 1`); await wait(1500);
            console.log('SMOKE session in: the top shows', JSON.stringify(await topIs()), JSON.stringify(await B("[document.querySelector('#root') && document.querySelector('#root').firstElementChild ? document.querySelector('#root').firstElementChild.className : 'empty', document.body.innerText.replace(/\\s+/g, ' ').slice(0, 80)].join(' | ')")), '| who:', JSON.stringify(who)); await bshot('fb-session-in.png');
          }
          await js("(document.querySelector('.modal .icon-btn') || { click() { } }).click(); localStorage.setItem('floorboard.session.v1', 'u5'); location.reload(); 1"); await wait(4500);
          console.log('SMOKE search bar', JSON.stringify(await js("(document.querySelector('#side-search') || {}).placeholder || 'none'")));
          openFull(null, 'search:invoice highveld'); await wait(4000);
          console.log('SMOKE search in full app', JSON.stringify(await full.webContents.executeJavaScript("[(document.querySelector('#big-search') || {}).value, (document.querySelector('.tabs') || {}).innerText].join(' | ')")));
          console.log('SMOKE jarvis u5 (someone else)', st(), '| slips card:', await js("!!document.querySelector('.w-slip:not(.w-jv-offer)')"), '| on the page:', await js("!!document.querySelector('.w-jv,.w-jv-offer')"), '| models', (await req('GET', '/v1/models')).text, '| chat:', JSON.stringify(await chat('jarvis', 'what are you working on')));
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
  // or search:<words>, for the full app's search with the words in it
  const hash = typeof target !== 'string' ? undefined : /^(chat|view|post):[\w:.-]+$/.test(target) ? 'go-' + target
    : /^search:[^\r\n]{1,200}$/.test(target) ? 'go-search:' + encodeURIComponent(target.slice(7)) : undefined;
  if (full && !full.isDestroyed()) {
    if (hash) full.loadFile(PAGE, { query: QUERY, hash });
    full.show(); full.focus(); return;
  }
  full = new BrowserWindow({ width: 1320, height: 860, minWidth: 380, minHeight: 560, title: 'Floorboard', icon: ICON, backgroundColor: '#2b2018', autoHideMenuBar: true, webPreferences });
  full.loadFile(PAGE, { query: QUERY, hash });
  openLinksOutside(full);
}

// Outlook: the desktop app signs in to Microsoft itself (in the browser, back to this computer) and reads the person's own
// mail here, so the page never holds a Microsoft token. The sign-in is kept encrypted for this Windows user, or not at all.
const MS_SCOPES = ['User.Read', 'Mail.Read'];
// Teams (what people ask of the person there): chats, and team channels once the company's admin has allowed it
const TEAMS_SCOPES = ['User.Read', 'Chat.Read'], TEAMS_CHANNEL_SCOPES = ['User.Read', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All'];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let msApp = null, msKey = '', msWeb = null; // msApp: through Windows' own sign-in when it's there; msWeb: through the browser
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
  const auth = { clientId: cfg.clientId, authority: 'https://login.microsoftonline.com/' + cfg.tenantId };
  // Windows' own sign-in (WAM): the work account already on this computer, the one Teams and Office use, without a password
  let broker = null;
  try { const { NativeBrokerPlugin } = require('@azure/msal-node-extensions'); const b = new NativeBrokerPlugin(); if (b.isBrokerAvailable) broker = b; } catch (e) { broker = null; }
  msWeb = new (PublicClientApplication)({ auth, cache: { cachePlugin } });
  msApp = broker ? new (PublicClientApplication)({ auth, cache: { cachePlugin }, broker: { nativeBrokerPlugin: broker } }) : msWeb;
  msKey = key;
  return msApp;
}
async function msToken(cfg, interactive, scopes = MS_SCOPES) {
  const pca = msClient(cfg), why = scopes === TEAMS_CHANNEL_SCOPES ? 'channels' : 'signin';
  for (const p of [...new Set([pca, msWeb])]) {
    let accounts = []; try { accounts = await p.getAllAccounts(); } catch (e) { accounts = []; }
    for (const account of accounts) { try { return (await p.acquireTokenSilent({ account, scopes })).accessToken; } catch (e) { /* next */ } }
  }
  if (!interactive) throw new Error(why);
  // first Windows' own sign-in (a small Windows window to pick the work account), then the browser
  if (pca !== msWeb) {
    try {
      const w = [bar, sidebar, full].find((x) => x && !x.isDestroyed() && x.isVisible()) || sidebar;
      const r = await pca.acquireTokenInteractive({ scopes, windowHandle: w.getNativeWindowHandle() });
      return r.accessToken;
    } catch (e) { if (/cancel/i.test(String((e && (e.errorCode || e.message)) || ''))) throw new Error('Sign-in was cancelled.'); /* else the browser below */ }
  }
  const r = await msWeb.acquireTokenInteractive({
    scopes,
    openBrowser: async (url) => { if (url.startsWith('https://login.microsoftonline.com/')) await shell.openExternal(url); },
    successTemplate: '<h2 style="font-family:sans-serif">Signed in. You can close this tab and go back to Floorboard.</h2>',
    errorTemplate: '<h2 style="font-family:sans-serif">Sign-in didn’t finish: {error}</h2>',
  });
  return r.accessToken;
}
const safe = (fn) => async (_e, arg) => { try { return { ok: await fn(arg || {}) }; } catch (e) { return { error: String((e && e.message) || e) } } };
function msIpc() {
  // the account signed in here: through Windows' own sign-in, or the browser's
  const msAccount = async (cfg) => { msClient(cfg); for (const p of [...new Set([msApp, msWeb])]) { try { const [a] = await p.getAllAccounts(); if (a) return { username: a.username, name: a.name || '' }; } catch (e) { /* next */ } } return null; };
  ipcMain.handle('ms-account', safe(async ({ cfg }) => msAccount(cfg)));
  ipcMain.handle('ms-signin', safe(async ({ cfg, what }) => { await msToken(cfg, true, what === 'teams' ? TEAMS_SCOPES : MS_SCOPES); return msAccount(cfg); }));
  ipcMain.handle('ms-signout', safe(async ({ cfg }) => {
    try { msClient(cfg); for (const p of [...new Set([msApp, msWeb])]) { const c = p.getTokenCache(); for (const a of await c.getAllAccounts()) await c.removeAccount(a); } } catch (e) { /* nothing to remove */ }
    try { fs.unlinkSync(msCacheFile()); } catch (e) { /* already gone */ }
    msApp = null; msWeb = null; return true;
  }));
  // reads only: the person's own mail folders, messages and attachments; who they are; their Teams chats; and the
  // channels of the teams they're in
  ipcMain.handle('ms-graph', safe(async ({ cfg, path: p }) => {
    const ok = typeof p === 'string' && (/^\/me\/(mailFolders|messages)[\w/().,$=&?'%:+ -]*$/.test(p) || /^\/me(\?\$select=[\w,]+)?$/.test(p)
      || /^\/me\/chats(\/[\w%.-]+\/messages)?\?[\w/().,$=&'%:+ -]*$/.test(p) || /^\/me\/joinedTeams\?[\w,$=]*$/.test(p) ||/^\/teams\/[\w%.-]+\/channels(\/[\w%.-]+\/messages)?\?[\w/().,$=&'%:+ -]*$/.test(p));
    if (!ok) throw new Error('Not allowed');
    const scopes = /^\/(me\/joinedTeams|teams\/)/.test(p) ? TEAMS_CHANNEL_SCOPES : /^\/(me$|me\?|me\/chats)/.test(p) ? TEAMS_SCOPES : MS_SCOPES;
    const res = await fetch('https://graph.microsoft.com/v1.0' + p, { headers: { Authorization: 'Bearer ' + (await msToken(cfg, false, scopes)) } });
    if (!res.ok) throw new Error((scopes === MS_SCOPES ? 'Outlook' : 'Teams') + ' answered ' + res.status);
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

// Start with Windows: run from its folder (not an installer), Floorboard is electron.exe plus that folder, so the
// login item says both, or Windows would start a bare Electron
const loginItem = () => (app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(app.getAppPath())] });
// "electron . --start-with-windows" (or --no-start-with-windows) sets it without the tray menu, in the Floorboard
// that's running if there is one; true when the command line asked for it
function startupFlag(argv) {
  const on = argv.includes('--start-with-windows') ? true : argv.includes('--no-start-with-windows') ? false : null;
  if (on === null) return false;
  app.setLoginItemSettings({ openAtLogin: on, ...loginItem() });
  if (tray) tray.setContextMenu(trayMenu());
  return true;
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show or hide the sidebar   Ctrl+Alt+F', click: toggleSidebar },
    { label: 'Open the full app', click: openFull },
    { type: 'separator' },
    { label: 'Keep the sidebar on top', type: 'checkbox', checked: prefs.onTop, click: (i) => setOnTop(i.checked) },
    { label: 'Show the floating button when the sidebar is closed', type: 'checkbox', checked: prefs.bubble, click: (i) => setBubble(i.checked) },
    { label: 'Show the bar at the top of the screen', type: 'checkbox', checked: prefs.bar, click: (i) => setBar(i.checked) },
    { label: 'Floorboard’s own island at the top (instead of Coucou)', type: 'checkbox', checked: !!prefs.island, click: (i) => setIsland(i.checked) },
    { label: 'Show Floorboard in Coucou’s island (when Coucou is open)', type: 'checkbox', checked: prefs.coucou, enabled: !prefs.island, click: (i) => setCoucou(i.checked) },
    { label: 'Your department’s card in Coucou’s island', enabled: prefs.coucou && cardList.length > 0, submenu: cardMenu() },
    ...(jarvis.mine() ? [{ label: 'JARVIS', submenu: jarvisMenu() }] : []),
    { label: 'Dock on the left', type: 'checkbox', checked: prefs.side === 'left', click: (i) => { prefs.side = i.checked ? 'left' : 'right'; savePrefs(); dock(); } },
    { label: 'Check GitHub for new versions', type: 'checkbox', checked: updates.getState().on, click: (i) => { updates.answer(i.checked); tray.setContextMenu(trayMenu()); } },
    { label: 'Check for a new version now', enabled: updates.getState().on, click: () => { updates.check().then((st) => { if (st.available) showSidebar(); }); } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings(loginItem()).openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, ...loginItem() }) },
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
// FLOORBOARD_PROFILE=<folder>: a separate Floorboard with its own settings and sign-ins, as on a new computer (for trying it out)
else if (process.env.FLOORBOARD_PROFILE) app.setPath('userData', path.resolve(process.env.FLOORBOARD_PROFILE));
if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
else {
  // starting it again shows the sidebar; with --quit it closes the running Floorboard properly (its cards leave Coucou's island)
  app.on('second-instance', (_e, argv) => { if (argv.includes('--quit')) { app.isQuitting = true; app.quit(); return; } if (!startupFlag(argv)) showSidebar(); });
  app.whenReady().then(() => {
    loadPrefs();
    // installed with Floorboard-Setup.exe: it starts with Windows from the first run (the tray menu turns it off)
    if (app.isPackaged && !SMOKE && !prefs.startSet) { app.setLoginItemSettings({ openAtLogin: true, ...loginItem() }); prefs.startSet = true; savePrefs(); }
    updates.init(); // new versions from GitHub, if the person said it may look
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media' || permission === 'notifications'));
    createSidebar();
    createBubble();
    createBar();
    if (prefs.coucou && !prefs.island && !SMOKE) coucou.init(coucouChanged); // Floorboard in Coucou's island, if Coucou is installed and running (a test run stays out of it)
    bubbleIpc();
    ipcMain.on('sidebar-slim', setSlim);
    ipcMain.on('sidebar-slim-size', (_e, h) => { h = Math.round(Number(h) || 0); if (h < 200 || h > 1200 || h === railHeight) return; railHeight = h; placeRail(); });
    ipcMain.on('rail-open', openSidebarAt);
    ipcMain.on('bar-state', (_e, state, focus) => { placeBar(state); if (bar && state !== 'pill' && focus) bar.focus(); });
    ipcMain.handle('on-top-get', () => !!prefs.onTop);
    ipcMain.handle('on-top-set', (_e, on) => { setOnTop(on); return prefs.onTop; });
    ask.start(() => sidebar); // Ask Floorboard from Coucou's chat
    ipcMain.handle('outlook-search', (_e, a) => outlook.search(a && a.query, a && a.days));
    mfs.init(prefs.mfs, () => { showCard(); if (tray) tray.setContextMenu(trayMenu()); }); // Finance's MFS card, if MFS is connected here
    ipcMain.on('island-cards', islandCards);
    ipcMain.on('island-line', (e, line) => { if (sidebar && e.sender === sidebar.webContents) coucou.setLine(line); });
    ipcMain.handle('coucou-state', () => inCoucou());
    mfsIpc();
    // JARVIS on this computer, for the account it's linked to (a test run pops nothing up)
    jarvis.init({ owner: prefs.jarvisUser, icon: ICON, notify: () => !SMOKE && prefs.jarvisNotify !== false, onChange: jarvisChanged, onOpen: () => openSidebarAt(null, '.w-jv'),
      saveOwner: (id) => { prefs.jarvisUser = id; savePrefs(); }, seen: prefs.jarvisSeen, saveSeen: (v) => { prefs.jarvisSeen = v; savePrefs(); } });
    jarvisIpc();
    islandIpc();
    sessionIpc();
    recorderIpc();
    if (SMOKE) return;
    buildTray();
    startupFlag(process.argv);
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
    jarvis.stop(); whatsapp.stop(); clearInterval(mailTimer);
    if (leaving || !coucou.running()) return;
    leaving = true; e.preventDefault();
    Promise.race([coucou.stop(), new Promise((ok) => setTimeout(ok, 800))]).then(() => app.quit());
  });
}
