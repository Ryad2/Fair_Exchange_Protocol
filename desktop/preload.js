const { contextBridge, ipcRenderer } = require('electron');

// Exposer une API sécurisée au renderer
contextBridge.exposeInMainWorld('electronAPI', {
    precompute: () => ipcRenderer.invoke('precompute'),
});
