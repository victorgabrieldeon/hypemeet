// Bridges: the app's own pages (setup, screen picker) get `desktop`; the HypeMeet site gets only
// `desktopUpdates`, for its update button, `desktopPtt`, for push-to-talk, and `desktopScreenAudio`,
// for screen audio from a single app (Linux). main rejects IPC from any frame that doesn't match.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktop", {
    setupState: () => ipcRenderer.invoke("setup:state"),
    connect: (server, trustFingerprint) => ipcRenderer.invoke("setup:connect", server, trustFingerprint),
    pickerSources: () => ipcRenderer.invoke("picker:sources"),
    pickerAudio: () => ipcRenderer.invoke("picker:audio"),
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
  contextBridge.exposeInMainWorld("desktopScreenAudio", {
    /** Right after getDisplayMedia: the label of the mic carrying the picked app's audio, or null. */
    claim: () => ipcRenderer.invoke("screen-audio:claim"),
    /** The screen that claimed it stopped. */
    release: () => ipcRenderer.send("screen-audio:release"),
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
