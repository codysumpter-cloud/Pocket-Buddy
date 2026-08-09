const { contextBridge, ipcRenderer } = require("electron");

// Developer-only bridge for the Pocket Buddy Studio window. This preload is
// never loaded by the desktop overlay or by Home, so production windows keep
// exactly the IPC surface they had before Studio existed.
contextBridge.exposeInMainWorld("PocketBuddyStudio", {
  call(surface, method, args) {
    return ipcRenderer.invoke("pb-studio:call", {
      surface: String(surface ?? ""),
      method: String(method ?? ""),
      args: Array.isArray(args) ? args : [],
    });
  },
  capture(surface) {
    return ipcRenderer.invoke("pb-studio:capture", String(surface ?? ""));
  },
  targets() {
    return ipcRenderer.invoke("pb-studio:targets");
  },
  devTools(surface) {
    return ipcRenderer.invoke("pb-studio:devtools", String(surface ?? ""));
  },
  reload(surface) {
    return ipcRenderer.invoke("pb-studio:reload", String(surface ?? ""));
  },
  relaunch() {
    return ipcRenderer.invoke("pb-studio:relaunch");
  },
  openHome() {
    return ipcRenderer.invoke("pb-studio:open-home");
  },
});
