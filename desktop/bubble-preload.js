// The floating button's bridge: open or close the sidebar, drag the button anywhere, and hear when the sidebar
// opens or closes and how many things need you.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floorboardBubble', {
  toggle: () => ipcRenderer.send('bubble-toggle'),
  drag: (dx, dy) => ipcRenderer.send('bubble-drag', Number(dx) || 0, Number(dy) || 0),
  drop: () => ipcRenderer.send('bubble-drop'),
  onState: (fn) => ipcRenderer.on('bubble-state', (_e, s) => fn(s)),
});
