const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("beforeunload", () => ipcRenderer.send("pocket-buddy:home-exiting"), { once: true });

contextBridge.exposeInMainWorld("PocketBuddyHome", {
  care(action) {
    const value = String(action ?? "");
    if (!["feed", "play", "pet", "nap", "clean", "medicine"].includes(value)) return;
    ipcRenderer.send("pocket-buddy:home-care", value);
  },
  close() {
    ipcRenderer.send("pocket-buddy:home-close");
  },
  chill(actor) {
    const value = String(actor ?? "");
    if (!["human", "pet"].includes(value)) return;
    ipcRenderer.send("pocket-buddy:home-chill", value);
  },
  quit() {
    ipcRenderer.send("pocket-buddy:home-quit");
  },
  /** Overlay mode click-through: true while the pointer is over real content. */
  setInteractive(interactive) {
    ipcRenderer.send("pocket-buddy:home-set-interactive", Boolean(interactive));
  },
  /** Switch Home between the transparent desktop overlay and a normal window. */
  setMode(mode) {
    const value = String(mode ?? "");
    if (!["desktop", "window"].includes(value)) return;
    ipcRenderer.send("pocket-buddy:home-set-mode", value);
  },
});
