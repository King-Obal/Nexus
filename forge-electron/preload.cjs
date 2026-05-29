// Preload must be CommonJS — Electron does not support ESM preloads
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forgeApi', {
  get:            (endpoint)       => ipcRenderer.invoke('api:get',    endpoint),
  getLocal:       (endpoint)       => ipcRenderer.invoke('api:get-local', endpoint),
  post:           (endpoint, body) => ipcRenderer.invoke('api:post',   endpoint, body),
  delete:         (endpoint)       => ipcRenderer.invoke('api:delete', endpoint),
  importMoxfield: (url)            => ipcRenderer.invoke('api:import-moxfield', url),
  getMode:        ()               => ipcRenderer.invoke('api:get-mode'),
  setRemote:      (url)            => ipcRenderer.invoke('api:set-remote', url),
  clearRemote:    ()               => ipcRenderer.invoke('api:clear-remote'),
  onLoadStatus:   (cb)             => ipcRenderer.on('load:status', (_, status) => cb(status))
});
