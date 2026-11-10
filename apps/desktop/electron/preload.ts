import { contextBridge, ipcRenderer } from 'electron';

/**
 * The ONLY surface the user interface can reach. No Node, filesystem or
 * arbitrary IPC is exposed: just these named, validated calls.
 */
contextBridge.exposeInMainWorld('mansora', {
  invoke: (command: string, input?: unknown) => ipcRenderer.invoke('mansora:invoke', command, input),
  print: (html: string) => ipcRenderer.invoke('mansora:print', html),
  savePdf: (html: string, fileName: string) => ipcRenderer.invoke('mansora:savePdf', html, fileName),
  saveFile: (file: { fileName: string; mime: string; contentBase64: string }) => ipcRenderer.invoke('mansora:saveFile', file),
  openExternal: (url: string) => ipcRenderer.invoke('mansora:openExternal', url),
  restore: (passphrase: string) => ipcRenderer.invoke('mansora:restore', passphrase),
});
