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
});
