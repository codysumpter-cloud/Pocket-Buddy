const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("PocketBuddyHome", {
  care(action) {
    const value = String(action ?? "");
    if (!["feed", "play", "pet", "nap", "clean", "medicine"].includes(value)) return;
    ipcRenderer.send("pocket-buddy:home-care", value);
  },
  close() {
    ipcRenderer.send("pocket-buddy:home-close");
  },
});
