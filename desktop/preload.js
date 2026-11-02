// The only bridge between the page and Windows: open the full app, or hide/show the sidebar.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floorboardDesktop', {
  openFull: () => ipcRenderer.send('open-full'),
  hide: () => ipcRenderer.send('hide-sidebar'),
  showSidebar: () => ipcRenderer.send('show-sidebar'),
});
