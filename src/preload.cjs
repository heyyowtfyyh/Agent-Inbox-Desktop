const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inbox', {
  avatarTheme: () => ipcRenderer.invoke('inbox:avatar-theme'),
  setAvatarTheme: preference => ipcRenderer.invoke('inbox:set-avatar-theme', preference),
  snapshot: () => ipcRenderer.invoke('inbox:snapshot'),
  setPin: (sessionId, pinned) => ipcRenderer.invoke('inbox:set-pin', sessionId, pinned),
  onRuntimeChange: callback => {
    ipcRenderer.on('inbox:runtime-changed', () => callback());
  },
  open: (destination, sessionId) => ipcRenderer.invoke('inbox:open', destination, sessionId),
  window: action => ipcRenderer.invoke('inbox:window', action),
});
