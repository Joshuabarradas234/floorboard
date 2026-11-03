// The only bridge between the page and Windows: open the full app, show or hide the sidebar, keep it in front,
// print quotes to a printer, and tell Windows how many things need you (red items wake the sidebar).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floorboardDesktop', {
  openFull: (target) => ipcRenderer.send('open-full', typeof target === 'string' ? target : undefined),
  hide: () => ipcRenderer.send('hide-sidebar'),
  showSidebar: () => ipcRenderer.send('show-sidebar'),
  focus: () => ipcRenderer.send('show-sidebar'),
  attention: (info) => ipcRenderer.send('attention', { count: Number(info && info.count) || 0, urgent: !!(info && info.urgent) }),
  onTop: { get: () => ipcRenderer.invoke('on-top-get'), set: (on) => ipcRenderer.invoke('on-top-set', !!on) },
  printers: () => ipcRenderer.invoke('printers'),
  print: (html, printer) => ipcRenderer.invoke('print-html', { html: String(html || ''), printer: String(printer || '') }),
});
