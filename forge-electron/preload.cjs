// Preload must be CommonJS — Electron does not support ESM preloads
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forgeApi', {
  get:            (endpoint)       => ipcRenderer.invoke('api:get',    endpoint),
  post:           (endpoint, body) => ipcRenderer.invoke('api:post',   endpoint, body),
  delete:         (endpoint)       => ipcRenderer.invoke('api:delete', endpoint),
  importMoxfield: (url)            => ipcRenderer.invoke('api:import-moxfield', url),
  getMode:        ()               => ipcRenderer.invoke('api:get-mode'),
  setRemote:      (url)            => ipcRenderer.invoke('api:set-remote', url),
  clearRemote:    ()               => ipcRenderer.invoke('api:clear-remote')
});
