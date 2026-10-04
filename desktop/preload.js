// Bridges: the app's own pages (setup, screen picker) get `desktop`; the HypeMeet site gets only
// `desktopUpdates`, for its update button, and `desktopPtt`, for push-to-talk. main rejects IPC
// from any frame that doesn't match.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktop", {
    setupState: () => ipcRenderer.invoke("setup:state"),
    connect: (server, trustFingerprint) => ipcRenderer.invoke("setup:connect", server, trustFingerprint),
    pickerSources: () => ipcRenderer.invoke("picker:sources"),
    pick: (choice) => ipcRenderer.send("picker:done", choice),
  });
} else {
  contextBridge.exposeInMainWorld("desktopUpdates", {
    state: () => ipcRenderer.invoke("update:state"),
    check: () => ipcRenderer.invoke("update:check"),
    apply: () => ipcRenderer.send("update:apply"),
    /** Returns the unsubscribe function. */
    subscribe: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("update:state", handler);
      return () => ipcRenderer.removeListener("update:state", handler);
    },
  });
  contextBridge.exposeInMainWorld("desktopPtt", {
    state: () => ipcRenderer.invoke("ptt:state"),
    setEnabled: (on) => ipcRenderer.send("ptt:enable", on),
    capture: (on) => ipcRenderer.send("ptt:capture", on),
    captureKey: (code) => ipcRenderer.send("ptt:capture-key", code),
    listen: (on) => ipcRenderer.send("ptt:listen", on),
    /** Returns the unsubscribe function. */
    subscribe: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("ptt:state", handler);
      return () => ipcRenderer.removeListener("ptt:state", handler);
    },
    /** Key down/up while a room listens. Returns the unsubscribe function. */
    onPress: (listener) => {
      const handler = (_event, pressed) => listener(pressed);
      ipcRenderer.on("ptt:press", handler);
      return () => ipcRenderer.removeListener("ptt:press", handler);
    },
  });
}
