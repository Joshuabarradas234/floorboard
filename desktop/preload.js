// The only bridge between the page and Windows: open the full app, show or hide the sidebar, open or close the bar, keep it in front,
// print quotes to a printer, and tell Windows how many things need you (red items wake the sidebar).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floorboardDesktop', {
  openFull: (target) => ipcRenderer.send('open-full', typeof target === 'string' ? target : undefined),
  hide: () => ipcRenderer.send('hide-sidebar'),
  showSidebar: () => ipcRenderer.send('show-sidebar'),
  // fold the sidebar into its slim rail of icons, or open it back to full width
  slim: (on) => ipcRenderer.send('sidebar-slim', !!on),
  focus: () => ipcRenderer.send('show-sidebar'),
  // the bar at the top of the screen: 'pill' (closed) or 'open'; focus to type a reply
  bar: (state, focus) => ipcRenderer.send('bar-state', state === 'open' ? 'open' : 'pill', !!focus),
  attention: (info) => ipcRenderer.send('attention', { count: Number(info && info.count) || 0, urgent: !!(info && info.urgent) }),
  onTop: { get: () => ipcRenderer.invoke('on-top-get'), set: (on) => ipcRenderer.invoke('on-top-set', !!on) },
  printers: () => ipcRenderer.invoke('printers'),
  print: (html, printer) => ipcRenderer.invoke('print-html', { html: String(html || ''), printer: String(printer || '') }),
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
});
