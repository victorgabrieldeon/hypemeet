// Bridge for the app's own pages (setup, screen picker). The remote HypeMeet site gets nothing:
// main also rejects IPC from any frame outside pages/.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktop", {
    setupState: () => ipcRenderer.invoke("setup:state"),
    connect: (server, trustFingerprint) => ipcRenderer.invoke("setup:connect", server, trustFingerprint),
    pickerSources: () => ipcRenderer.invoke("picker:sources"),
    pick: (choice) => ipcRenderer.send("picker:done", choice),
  });
}
