const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PocketBuddyDesktop", {
  setInteractive(interactive) {
    ipcRenderer.send("pocket-buddy:set-interactive", Boolean(interactive));
  },
  quit() {
    ipcRenderer.send("pocket-buddy:quit");
  },
  onCommand(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, command) => callback(command);
    ipcRenderer.on("pocket-buddy:command", handler);
    return () => ipcRenderer.removeListener("pocket-buddy:command", handler);
  },
  openHome(options) {
    return ipcRenderer.invoke("pocket-buddy:open-home", options ?? {});
  },
  closeHome() {
    ipcRenderer.send("pocket-buddy:close-home");
  },
  onHomeCare(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, action) => callback(action);
    ipcRenderer.on("pocket-buddy:home-care", handler);
    return () => ipcRenderer.removeListener("pocket-buddy:home-care", handler);
  },
  listBundledArt() {
    return ipcRenderer.invoke("pocket-buddy:list-bundled-art");
  },
  readBundledArt(id) {
    return ipcRenderer.invoke("pocket-buddy:read-bundled-art", String(id ?? ""));
  },
  listDisplays() {
    return ipcRenderer.invoke("pocket-buddy:list-displays");
  },
  selectDisplay(id) {
    return ipcRenderer.invoke("pocket-buddy:select-display", String(id ?? "primary"));
  },
  onDisplaysChanged(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("pocket-buddy:displays-changed", handler);
    return () => ipcRenderer.removeListener("pocket-buddy:displays-changed", handler);
  },
});
