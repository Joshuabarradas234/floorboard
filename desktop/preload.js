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
  bar: (state, focus) => ipcRenderer.send('bar-state', state === 'open' ? 'open' : 'pill', !!focus),
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
      signIn: (cfg) => ipcRenderer.invoke('ms-signin', { cfg: c(cfg) }),
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
    // where a dropped or picked file is on this computer ('' for one that isn't a file on disk)
    pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  },
});
