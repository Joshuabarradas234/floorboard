// The round button's bridge: open or close the sidebar, move the button along the edge, and hear when the sidebar
// opens or closes and how many things need you.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('floorboardBubble', {
  toggle: () => ipcRenderer.send('bubble-toggle'),
  drag: (dy) => ipcRenderer.send('bubble-drag', Number(dy) || 0),
  drop: () => ipcRenderer.send('bubble-drop'),
  onState: (fn) => ipcRenderer.on('bubble-state', (_e, s) => fn(s)),
});
