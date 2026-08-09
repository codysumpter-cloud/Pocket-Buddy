import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } from "electron";
import { createCanonicalHomeManager } from "./canonical-home.mjs";
import { createStudioManager } from "./studio/studio-main.mjs";
import { STUDIO_TRAY_LABEL, devToolsShortcutsEnabled, homeAutoOpen, studioAutoOpen, studioEnabled } from "./studio/studio-gate.mjs";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const APP_ID = "dev.prismtek.pocketbuddy";
const PRIVATE_ART_SCHEMA = "pocket-buddy-private-art-bundle-v1";
const PRIVATE_ART_MANIFEST = "private-art-manifest.json";
const PRIVATE_ART_MAX_PACK_BYTES = 250 * 1024 * 1024;
const DESKTOP_PREFS_FILE = "desktop-preferences.json";
const SHA256_RE = /^[0-9a-f]{64}$/;
let overlayWindow = null;
let tray = null;
let quitting = false;
let displayRefreshTimer = null;
let bundledArtCache = new Map();
let selectedMonitor = "primary";
let desktopPrefsPath = null;
let canonicalHome = null;
let studio = null;

// Developer tooling gate. Packaged production builds stay off unless the
// developer explicitly sets POCKET_BUDDY_STUDIO=1.
function studioContext() {
  return { packaged: app.isPackaged, env: process.env };
}

/**
 * F12 and Ctrl/Cmd+Shift+I open Chromium DevTools in development only, so
 * production keyboard behavior is unchanged.
 */
const devToolsBoundWindows = new WeakSet();

function installDevToolsShortcuts(window) {
  if (!devToolsShortcutsEnabled(studioContext())) return;
  if (!window || window.isDestroyed() || devToolsBoundWindows.has(window)) return;
  devToolsBoundWindows.add(window);
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = String(input.key || "").toLowerCase();
    const combo = (input.control || input.meta) && input.shift && key === "i";
    if (key !== "f12" && !combo) return;
    event.preventDefault();
    const contents = window.webContents;
    contents.isDevToolsOpened() ? contents.closeDevTools() : contents.openDevTools({ mode: "detach" });
  });
}

if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function displayId(display) {
  return String(display?.id ?? "");
}

function selectedDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay?.() ?? displays[0];
  if (!primary) return null;
  if (selectedMonitor === "primary") return primary;
  return displays.find((display) => displayId(display) === selectedMonitor) ?? primary;
}

function selectedWorkArea() {
  const display = selectedDisplay();
  const area = display?.workArea ?? display?.bounds ?? { x: 0, y: 0, width: 1280, height: 720 };
  return {
    x: Math.round(area.x),
    y: Math.round(area.y),
    width: Math.max(1, Math.round(area.width)),
    height: Math.max(1, Math.round(area.height)),
  };
}

function displaySnapshot() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay?.() ?? displays[0];
  const effective = selectedDisplay();
  return {
    selected: selectedMonitor,
    effective: effective ? displayId(effective) : "",
    displays: displays.map((display, index) => ({
      id: displayId(display),
      label: `Monitor ${index + 1} — ${Math.round(display.workArea?.width ?? display.bounds.width)}×${Math.round(display.workArea?.height ?? display.bounds.height)}`,
      primary: Boolean(primary && displayId(display) === displayId(primary)),
      scaleFactor: display.scaleFactor ?? 1,
      bounds: { ...display.bounds },
      workArea: { ...(display.workArea ?? display.bounds) },
    })),
  };
}

async function loadDesktopPreferences() {
  desktopPrefsPath = join(app.getPath("userData"), DESKTOP_PREFS_FILE);
  try {
    const parsed = JSON.parse(await readFile(desktopPrefsPath, "utf8"));
    if (typeof parsed?.selectedMonitor === "string" && (parsed.selectedMonitor === "primary" || /^-?\d+$/.test(parsed.selectedMonitor))) {
      selectedMonitor = parsed.selectedMonitor;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Pocket Buddy desktop preferences could not be read", error);
  }
}

async function saveDesktopPreferences() {
  if (!desktopPrefsPath) desktopPrefsPath = join(app.getPath("userData"), DESKTOP_PREFS_FILE);
  await mkdir(dirname(desktopPrefsPath), { recursive: true });
  await writeFile(desktopPrefsPath, `${JSON.stringify({ selectedMonitor }, null, 2)}\n`, "utf8");
}

function applySelectedMonitorBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(selectedWorkArea(), false);
  applyDesktopWindowContract(overlayWindow);
}

async function chooseMonitor(value) {
  const next = String(value ?? "primary");
  if (next !== "primary" && !screen.getAllDisplays().some((display) => displayId(display) === next)) {
    throw new Error("Selected monitor is not currently connected.");
  }
  selectedMonitor = next;
  await saveDesktopPreferences();
  applySelectedMonitorBounds();
  canonicalHome?.reclamp();
  overlayWindow?.webContents.send("pocket-buddy:displays-changed", displaySnapshot());
  refreshTrayMenu();
  return displaySnapshot();
}

function applyDesktopWindowContract(window) {
  window.setAlwaysOnTop(true, "screen-saver");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  if (process.platform === "darwin") window.setWindowButtonVisibility?.(false);
}

function createOverlayWindow() {
  const bounds = selectedWorkArea();
  const window = new BrowserWindow({
    ...bounds,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    titleBarStyle: "hidden",
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  applyDesktopWindowContract(window);
  installDevToolsShortcuts(window);
  // Re-attach the Studio agent after every load so watch-mode reloads keep
  // their inspector. No-op when Studio is disabled.
  window.webContents.on("did-finish-load", () => {
    void studio?.attachTo(window.webContents).catch(() => {});
  });
  window.loadFile(join(__dirname, "index.html"));
  window.once("ready-to-show", () => {
    applySelectedMonitorBounds();
    window.showInactive();
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void import("electron").then(({ shell }) => shell.openExternal(url));
    return { action: "deny" };
  });
  return window;
}

function sendCommand(command) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayWindow.isVisible()) overlayWindow.showInactive();
  overlayWindow.webContents.send("pocket-buddy:command", command);
}

function monitorTrayItems() {
  const snapshot = displaySnapshot();
  const primary = snapshot.displays.find((display) => display.primary);
  const choices = [
    { id: "primary", label: primary ? `Primary — ${primary.label}` : "Primary" },
    ...snapshot.displays.filter((display) => !display.primary).map((display) => ({ id: display.id, label: display.label })),
  ];
  return choices.map((choice) => ({
    label: choice.label,
    type: "radio",
    checked: snapshot.selected === choice.id,
    click: () => { void chooseMonitor(choice.id); },
  }));
}

function refreshTrayMenu() {
  if (!tray) return;
  const visible = Boolean(overlayWindow?.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: visible ? "Hide Pocket Buddy" : "Show Pocket Buddy", click: () => {
      if (!overlayWindow) return;
      visible ? overlayWindow.hide() : overlayWindow.showInactive();
      refreshTrayMenu();
    } },
    { type: "separator" },
    { label: "Home", click: () => sendCommand("home") },
    { label: "Chill: Human", click: () => sendCommand("chill-human") },
    { label: "Chill: Pet", click: () => sendCommand("chill-pet") },
    { label: "My Pets", click: () => sendCommand("pets") },
    { label: "Care", click: () => sendCommand("care") },
    { label: "Talk", click: () => sendCommand("talk") },
    { label: "Monitor", submenu: monitorTrayItems() },
    ...(studio?.isEnabled() ? [
      { type: "separator" },
      { label: STUDIO_TRAY_LABEL, click: () => studio.open() },
    ] : []),
    { type: "separator" },
    { label: "Quit Pocket Buddy", click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const candidates = [
    join(__dirname, "..", "images", "icons", "transparent", "48x48x1.png"),
    join(__dirname, "..", "images", "icons", "transparent", "32x32x1.png"),
  ];
  let icon = nativeImage.createEmpty();
  for (const candidate of candidates) {
    const maybe = nativeImage.createFromPath(candidate);
    if (!maybe.isEmpty()) { icon = maybe; break; }
  }
  tray = new Tray(icon);
  tray.setToolTip("Pocket Buddy");
  tray.on("click", () => {
    if (!overlayWindow) return;
    overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.showInactive();
    refreshTrayMenu();
  });
  refreshTrayMenu();
}

/**
 * Developer convenience: retry the normal "home" command until Home is open.
 * Retrying matters because the renderer must first install and verify the
 * bundled art packs before it can name the Home human.
 */
function scheduleHomeAutoOpen(attempt = 0) {
  if (attempt > 14 || canonicalHome?.isOpen()) return;
  setTimeout(() => {
    if (canonicalHome?.isOpen()) return;
    sendCommand("home");
    scheduleHomeAutoOpen(attempt + 1);
  }, attempt === 0 ? 2500 : 2000);
}

function scheduleDisplayRefresh() {
  if (displayRefreshTimer) clearTimeout(displayRefreshTimer);
  displayRefreshTimer = setTimeout(() => {
    displayRefreshTimer = null;
    applySelectedMonitorBounds();
    canonicalHome?.reclamp();
    overlayWindow?.webContents.send("pocket-buddy:displays-changed", displaySnapshot());
    refreshTrayMenu();
  }, 120);
}

function privateArtRootCandidates() {
  const candidates = [
    join(process.resourcesPath, "private-art"),
    process.env.PORTABLE_EXECUTABLE_DIR ? join(process.env.PORTABLE_EXECUTABLE_DIR, "Art Packs") : null,
    join(dirname(process.execPath), "Art Packs"),
    join(__dirname, "..", "private-art"),
  ].filter(Boolean);
  return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

function safeZipLeaf(value, field) {
  if (typeof value !== "string" || !value || basename(value) !== value || !/\.zip$/i.test(value)) {
    throw new Error(`Private art manifest has an unsafe ${field}.`);
  }
  return value;
}

async function sha256File(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadPrivateArtRoot(root) {
  const manifestPath = join(root, PRIVATE_ART_MANIFEST);
  let raw;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  let manifest;
  try { manifest = JSON.parse(raw); }
  catch { throw new Error(`Private art manifest is invalid JSON: ${manifestPath}`); }
  if (manifest?.schema !== PRIVATE_ART_SCHEMA || !Array.isArray(manifest.packs)) {
    throw new Error(`Private art manifest has the wrong schema: ${manifestPath}`);
  }
  if (manifest.packs.length > 200) throw new Error("Private art bundle contains too many packs.");

  const entries = [];
  for (const item of manifest.packs) {
    const file = safeZipLeaf(item?.file, "file");
    const importName = safeZipLeaf(item?.importName ?? file, "importName");
    const expectedSha = String(item?.sha256 ?? "").toLowerCase();
    if (!SHA256_RE.test(expectedSha)) throw new Error(`Private art entry ${file} has an invalid SHA-256.`);
    const fullPath = join(root, file);
    const info = await stat(fullPath);
    if (!info.isFile() || info.size <= 0 || info.size > PRIVATE_ART_MAX_PACK_BYTES) {
      throw new Error(`Private art entry ${file} is missing, empty, or too large.`);
    }
    const actualSha = await sha256File(fullPath);
    if (actualSha !== expectedSha) {
      throw new Error(`Private art integrity failure for ${file}: expected ${expectedSha}, got ${actualSha}.`);
    }
    entries.push({
      id: expectedSha,
      displayName: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim().slice(0, 120) : importName.replace(/\.zip$/i, ""),
      kind: item.kind === "human" ? "human" : item.kind === "environment" ? "environment" : "buddy",
      file,
      importName,
      sha256: expectedSha,
      bytes: info.size,
      root,
      fullPath,
    });
  }
  return entries;
}

async function discoverBundledArt() {
  const merged = new Map();
  for (const root of privateArtRootCandidates()) {
    const entries = await loadPrivateArtRoot(root);
    for (const entry of entries) if (!merged.has(entry.sha256)) merged.set(entry.sha256, entry);
  }
  bundledArtCache = new Map([...merged.values()].map((entry) => [entry.id, entry]));
  return [...merged.values()].map(({ root: _root, fullPath: _fullPath, ...publicEntry }) => publicEntry);
}

async function readBundledArt(id) {
  if (!bundledArtCache.has(id)) await discoverBundledArt();
  const entry = bundledArtCache.get(id);
  if (!entry) throw new Error("Requested bundled art pack is not registered.");
  const actualSha = await sha256File(entry.fullPath);
  if (actualSha !== entry.sha256) throw new Error(`Private art integrity changed after discovery: ${entry.file}`);
  const bytes = await readFile(entry.fullPath);
  const copy = Uint8Array.from(bytes);
  return { id: entry.id, sha256: entry.sha256, importName: entry.importName, bytes: copy.buffer };
}

ipcMain.on("pocket-buddy:set-interactive", (event, interactive) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return;
  window.setIgnoreMouseEvents(!Boolean(interactive), { forward: true });
});

ipcMain.on("pocket-buddy:quit", (event) => {
  if (!overlayWindow || overlayWindow.isDestroyed() || event.sender !== overlayWindow.webContents) return;
  quitting = true;
  app.quit();
});

ipcMain.handle("pocket-buddy:list-bundled-art", async () => discoverBundledArt());
ipcMain.handle("pocket-buddy:read-bundled-art", async (_event, id) => readBundledArt(String(id ?? "")));
ipcMain.handle("pocket-buddy:list-displays", async () => displaySnapshot());
ipcMain.handle("pocket-buddy:select-display", async (_event, id) => chooseMonitor(id));
ipcMain.handle("pocket-buddy:open-home", async (event, options) => {
  if (!overlayWindow || overlayWindow.isDestroyed() || event.sender !== overlayWindow.webContents) {
    throw new Error("Canonical Home can only be opened by Pocket Buddy.");
  }
  if (!canonicalHome) throw new Error("Canonical Home is not ready yet.");
  return canonicalHome.open(options);
});
ipcMain.on("pocket-buddy:close-home", (event) => {
  if (overlayWindow && !overlayWindow.isDestroyed() && event.sender === overlayWindow.webContents) canonicalHome?.close();
});
ipcMain.on("pocket-buddy:home-close", (event) => {
  if (canonicalHome?.owns(event.sender)) canonicalHome.close();
});
ipcMain.on("pocket-buddy:home-care", (event, action) => {
  if (!canonicalHome?.owns(event.sender)) return;
  const allowed = new Set(["feed", "play", "pet", "nap", "clean", "medicine"]);
  const value = String(action ?? "");
  if (!allowed.has(value)) return;
  overlayWindow?.webContents.send("pocket-buddy:home-care", value);
});
ipcMain.on("pocket-buddy:home-chill", (event, actor) => {
  if (!canonicalHome?.owns(event.sender)) return;
  const value = String(actor ?? "");
  if (!["human", "pet"].includes(value)) return;
  canonicalHome.close();
  sendCommand(`chill-${value}`);
});
ipcMain.on("pocket-buddy:home-quit", (event) => {
  if (!canonicalHome?.owns(event.sender)) return;
  quitting = true;
  app.quit();
});

app.whenReady().then(async () => {
  app.setName("Pocket Buddy");
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  if (process.platform === "darwin") app.dock?.hide();

  await loadDesktopPreferences();

  studio = createStudioManager({
    enabled: studioEnabled(studioContext()),
    resolveTarget: (surface) => {
      if (surface === "desktop") return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.webContents : null;
      if (surface === "home") return canonicalHome?.webContents() ?? null;
      return null;
    },
    // Home is opened by the renderer so it carries the verified art hashes and
    // the single-presence handshake. Studio just asks for the same command the
    // tray uses instead of opening a second Home of its own.
    onRequestHome: async () => sendCommand("home"),
  });

  canonicalHome = createCanonicalHomeManager({
    getWorkArea: selectedWorkArea,
    getArtEntries: discoverBundledArt,
    readArtBytes: readBundledArt,
    onClosed: () => overlayWindow?.webContents.send("pocket-buddy:home-closed"),
    isStudioEnabled: () => Boolean(studio?.isEnabled()),
    onReady: (contents) => {
      const window = contents ? BrowserWindow.fromWebContents(contents) : null;
      if (window) installDevToolsShortcuts(window);
      void studio?.attachTo(contents).catch(() => {});
    },
  });

  overlayWindow = createOverlayWindow();
  createTray();
  if (studioAutoOpen(studioContext())) studio.open();
  if (homeAutoOpen(studioContext())) scheduleHomeAutoOpen();

  screen.on("display-added", scheduleDisplayRefresh);
  screen.on("display-removed", scheduleDisplayRefresh);
  screen.on("display-metrics-changed", scheduleDisplayRefresh);

  app.on("second-instance", () => {
    overlayWindow?.showInactive();
    refreshTrayMenu();
  });
  app.on("activate", () => {
    overlayWindow?.showInactive();
    refreshTrayMenu();
  });
}).catch((error) => {
  console.error("Pocket Buddy desktop shell failed to start", error);
  app.quit();
});

app.on("before-quit", () => { quitting = true; studio?.close(); void canonicalHome?.dispose(); });
app.on("window-all-closed", (event) => {
  event?.preventDefault?.();
});
