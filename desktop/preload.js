// The only bridge between the page and Windows: WhatsApp on this computer, open the full app, show or hide the sidebar, open or close the bar, keep it in front,
// print quotes to a printer, and tell Windows how many things need you (red items wake the sidebar).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floorboardDesktop', {
  openFull: (target) => ipcRenderer.send('open-full', typeof target === 'string' ? target : undefined),
  hide: () => ipcRenderer.send('hide-sidebar'),
  showSidebar: () => ipcRenderer.send('show-sidebar'),
  // fold the sidebar into its slim rail of icons, or open it back to full width
  slim: (on) => ipcRenderer.send('sidebar-slim', !!on),
  slimSize: (height) => ipcRenderer.send('sidebar-slim-size', Number(height) || 0),
  focus: () => ipcRenderer.send('show-sidebar'),
  // the bar at the top of the screen: 'pill' (closed) or 'open'; focus to type a reply
  bar: (state, focus) => ipcRenderer.send('bar-state', state === 'open' ? 'open' : 'pill', !!focus),
  attention: (info) => ipcRenderer.send('attention', { count: Number(info && info.count) || 0, urgent: !!(info && info.urgent) }),
  onTop: { get: () => ipcRenderer.invoke('on-top-get'), set: (on) => ipcRenderer.invoke('on-top-set', !!on) },
  printers: () => ipcRenderer.invoke('printers'),
  print: (html, printer) => ipcRenderer.invoke('print-html', { html: String(html || ''), printer: String(printer || '') }),
  // WhatsApp on this computer (the desktop app runs the helper; messages stay on this computer)
  wa: {
    state: () => ipcRenderer.invoke('wa-state'),
    setup: () => ipcRenderer.invoke('wa-setup'),
    qr: () => ipcRenderer.invoke('wa-qr'),
    chats: () => ipcRenderer.invoke('wa-chats'),
    messages: (jid) => ipcRenderer.invoke('wa-messages', { jid: String(jid || '') }),
    read: (jid) => ipcRenderer.invoke('wa-read', { jid: String(jid || '') }),
    send: (jid, text) => ipcRenderer.invoke('wa-send', { jid: String(jid || ''), text: String(text || '') }),
    unlink: () => ipcRenderer.invoke('wa-unlink'),
    onState: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('wa-state', h); return () => ipcRenderer.removeListener('wa-state', h); },
    onChats: (fn) => { const h = (_e, c) => fn(c); ipcRenderer.on('wa-chats', h); return () => ipcRenderer.removeListener('wa-chats', h); },
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
});
