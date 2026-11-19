// The only bridge between the page and the disk. Keep it this small.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('boards', {
  dir: () => ipcRenderer.invoke('designs:dir'),
  list: () => ipcRenderer.invoke('designs:list'),
  read: (file: string) => ipcRenderer.invoke('designs:read', file),
  write: (file: string, text: string) => ipcRenderer.invoke('designs:write', file, text),
  remove: (file: string) => ipcRenderer.invoke('designs:delete', file),
  reveal: () => ipcRenderer.invoke('designs:reveal'),
  savePdf: (defaultName: string) => ipcRenderer.invoke('pdf:save', defaultName),
});
