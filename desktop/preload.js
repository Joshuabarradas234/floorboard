// The only bridge between the page and Windows: open the full app, show or hide the sidebar, open or close the bar, keep it in front,
// print quotes to a printer, and tell Windows how many things need you (red items wake the sidebar).
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('floorboardDesktop', {
  openFull: (target) => ipcRenderer.send('open-full', typeof target === 'string' ? target : undefined),
  hide: () => ipcRenderer.send('hide-sidebar'),
  showSidebar: () => ipcRenderer.send('show-sidebar'),
  // fold the sidebar into its slim rail of icons, or open it back to full width
  slim: (on) => ipcRenderer.send('sidebar-slim', !!on),
  slimSize: (height) => ipcRenderer.send('sidebar-slim-size', Number(height) || 0),
  // the folded rail: open the sidebar on a section; the sidebar hears which one
  openSidebarAt: (section) => ipcRenderer.send('rail-open', String(section || '')),
  onSection: (fn) => { const h = (_e, s) => fn(String(s || '')); ipcRenderer.on('sidebar-section', h); return () => ipcRenderer.removeListener('sidebar-section', h); },
  focus: () => ipcRenderer.send('show-sidebar'),
  // the bar at the top of the screen: 'pill' (closed) or 'open'; focus to type a reply
  bar: (state, focus) => ipcRenderer.send('bar-state', ['open', 'tall', 'peek'].includes(state) ? state : 'pill', !!focus),
  attention: (info) => {
    const t = (v) => String(v || '').slice(0, 200), l = info && info.latest;
    ipcRenderer.send('attention', { count: Number(info && info.count) || 0, urgent: !!(info && info.urgent), chats: Number(info && info.chats) || 0, latest: l ? { title: t(l.title), body: t(l.body) } : null });
  },
  onTop: { get: () => ipcRenderer.invoke('on-top-get'), set: (on) => ipcRenderer.invoke('on-top-set', !!on) },
  printers: () => ipcRenderer.invoke('printers'),
  print: (html, printer) => ipcRenderer.invoke('print-html', { html: String(html || ''), printer: String(printer || '') }),
  // new versions from GitHub: asked once, then one click to update and restart
  updates: {
    state: () => ipcRenderer.invoke('upd-state'),
    answer: (yes) => ipcRenderer.invoke('upd-answer', !!yes),
    check: () => ipcRenderer.invoke('upd-check'),
    install: () => ipcRenderer.invoke('upd-install'),
    onState: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('upd-state', h); return () => ipcRenderer.removeListener('upd-state', h); },
  },
  // Outlook: sign in and read your own mail through the desktop app (it keeps the Microsoft sign-in, not the page)
  ms: (() => {
    const c = (cfg) => ({ clientId: String((cfg && cfg.clientId) || ''), tenantId: String((cfg && cfg.tenantId) || '') });
    return {
      account: (cfg) => ipcRenderer.invoke('ms-account', { cfg: c(cfg) }),
      signIn: (cfg, what) => ipcRenderer.invoke('ms-signin', { cfg: c(cfg), what: what === 'teams' ? 'teams' : 'mail' }),
      signOut: (cfg) => ipcRenderer.invoke('ms-signout', { cfg: c(cfg) }),
      graph: (cfg, path) => ipcRenderer.invoke('ms-graph', { cfg: c(cfg), path: String(path || '') }),
    };
  })(),
  // Ask Floorboard from Coucou's chat: questions reach the app's small server on this computer and the sidebar answers them
  ask: {
    onRun: (fn) => {
      const h = async (_e, req) => {
        const id = req && req.id, step = (text) => ipcRenderer.send('ask-step', { id, text: String(text || '').slice(0, 120) });
        try { ipcRenderer.send('ask-done', { id, answer: String((await fn({ question: String(req.question || ''), history: Array.isArray(req.history) ? req.history : [] }, step)) || '') }); }
        catch (e) { ipcRenderer.send('ask-done', { id, error: String((e && e.message) || e) }); }
      };
      ipcRenderer.on('ask-run', h); ipcRenderer.send('ask-ready', true);
      return () => { ipcRenderer.removeListener('ask-run', h); ipcRenderer.send('ask-ready', false); };
    },
  },
  // Outlook (classic) on this computer, for Ask Floorboard's email search
  outlook: { search: (query, days) => ipcRenderer.invoke('outlook-search', { query: String(query || '').slice(0, 200), days: Number(days) || 30 }) },
  // the department cards this person could have in Coucou's island: [{ id, title, line, busy, mfs }]
  cards: (list) => ipcRenderer.send('island-cards', (Array.isArray(list) ? list : []).slice(0, 12).map((c) => ({ id: String(c.id || ''), title: String(c.title || ''), line: String(c.line || ''), busy: !!c.busy, mfs: !!c.mfs }))),
  // is Floorboard in Coucou's island right now (Coucou open, and the person left it switched on)?
  coucou: {
    state: () => ipcRenderer.invoke('coucou-state'),
    onState: (fn) => { const h = (_e, on) => fn(!!on); ipcRenderer.on('coucou-state', h); return () => ipcRenderer.removeListener('coucou-state', h); },
  },
  // the few words on Floorboard's own card in Coucou's island: the person's department, or for an admin the whole store
  islandLine: (line) => ipcRenderer.send('island-line', String(line || '').slice(0, 80)),
  // MFS on this computer, for Finance's card: the address and Jarvis key stay in the desktop app
  mfs: {
    state: () => ipcRenderer.invoke('mfs-state'),
    connect: (url, key) => ipcRenderer.invoke('mfs-connect', { url: String(url || ''), key: String(key || '') }),
    disconnect: () => ipcRenderer.invoke('mfs-disconnect'),
    onOpen: (fn) => { const h = () => fn(); ipcRenderer.on('mfs-open', h); return () => ipcRenderer.removeListener('mfs-open', h); },
  },
  // Floorboard's own island at the top: WhatsApp (through the WhatsApp gateway on this computer) and Mail (Outlook classic)
  // the sidebar's meeting recorder (the video stays on this computer)
  recorder: {
    start: () => ipcRenderer.invoke('rec-start'),
    chunk: (buf) => ipcRenderer.invoke('rec-chunk', buf),
    status: () => ipcRenderer.invoke('rec-status'),
    stop: () => ipcRenderer.invoke('rec-stop'),
    cancel: () => ipcRenderer.invoke('rec-cancel'),
    openFolder: (file) => ipcRenderer.send('rec-open-folder', String(file || '')),
    play: (file) => ipcRenderer.send('rec-play', String(file || '')),
    speechSettings: () => ipcRenderer.send('rec-speech-settings'),
    speechOn: () => ipcRenderer.invoke('rec-speech-on'),
  },
  // logging in or out here, told to Floorboard's other windows, and hearing theirs
  session: {
    tell: (st) => ipcRenderer.send('session-changed', st === 'in' ? 'in' : 'out'),
    on: (fn) => { const h = (_e, st) => fn(String(st)); ipcRenderer.on('session-changed', h); return () => ipcRenderer.removeListener('session-changed', h); },
  },
  island: {
    state: () => ipcRenderer.invoke('island-state'),
    onState: (fn) => { const h = (_e, s) => fn(s || {}); ipcRenderer.on('island-state', h); return () => ipcRenderer.removeListener('island-state', h); },
    opened: (card) => ipcRenderer.invoke('island-opened', String(card || '')),
    // the pointer, anywhere on the screen, in the island window's coordinates (for the characters' eyes)
    onCursor: (fn) => { const h = (_e, p) => fn({ x: Number(p && p.x) || 0, y: Number(p && p.y) || 0 }); ipcRenderer.on('island-cursor', h); return () => ipcRenderer.removeListener('island-cursor', h); },
    wa: {
      // read: mark it read on the phone too
      messages: (jid, read) => ipcRenderer.invoke('wa-messages', { jid: String(jid || ''), read: !!read }),
      find: (q) => ipcRenderer.invoke('wa-find', String(q || '')),
      send: (jid, text) => ipcRenderer.invoke('wa-send', { jid: String(jid || ''), text: String(text || '') }),
      open: (jid) => ipcRenderer.invoke('wa-open', String(jid || '')),
      endCall: () => ipcRenderer.invoke('wa-end-call'),
      // linking WhatsApp on this computer
      install: () => ipcRenderer.invoke('wa-install'),
      qr: () => ipcRenderer.invoke('wa-qr'),
      linkStatus: () => ipcRenderer.invoke('wa-link-status'),
    },
    mail: {
      list: (q) => ipcRenderer.invoke('mail-list', String(q || '')),
      read: (id, store) => ipcRenderer.invoke('mail-read', { id: String(id || ''), store: String(store || '') }),
      openOutlook: () => ipcRenderer.invoke('mail-open-outlook'),
    },
  },
  // JARVIS on this computer, for the one account it's linked to: what it's doing, and jobs sent to it (files go by their place on disk)
  jarvis: {
    who: (u) => ipcRenderer.send('jarvis-who', { id: String((u && u.id) || ''), admin: !!(u && u.admin) }),
    state: () => ipcRenderer.invoke('jarvis-state'),
    onState: (fn) => { const h = (_e, s) => fn(s || {}); ipcRenderer.on('jarvis-state', h); return () => ipcRenderer.removeListener('jarvis-state', h); },
    link: () => ipcRenderer.invoke('jarvis-link'),
    unlink: () => ipcRenderer.invoke('jarvis-unlink'),
    suits: () => ipcRenderer.invoke('jarvis-suits'),
    run: (job, confirm) => ipcRenderer.invoke('jarvis-run', { job: JSON.parse(JSON.stringify(job || {})), confirm: !!confirm }),
    carryOn: (runId) => ipcRenderer.invoke('jarvis-continue', String(runId || '')),
    ask: (q, history) => ipcRenderer.invoke('jarvis-ask', { q: String(q || ''), history: JSON.parse(JSON.stringify(Array.isArray(history) ? history : [])) }),
    // files dropped on the island, to the sidebar's Send work
    prefill: (paths) => ipcRenderer.send('jarvis-prefill', (Array.isArray(paths) ? paths : []).map(String)),
    onPrefill: (fn) => { const h = (_e, p) => fn(Array.isArray(p) ? p : []); ipcRenderer.on('jarvis-prefill', h); return () => ipcRenderer.removeListener('jarvis-prefill', h); },
    // where a dropped or picked file is on this computer ('' for one that isn't a file on disk)
    pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  },
});
