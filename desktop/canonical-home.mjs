import { BrowserWindow } from "electron";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME_ROOT = resolve(join(__dirname, "tinyhouse-home"));
const ACTOR_BRIDGE = join(__dirname, "pocket-buddy-home-actors.js");
const OVERLAY_BRIDGE = join(__dirname, "home-overlay.js");
const HOME_PRELOAD = join(__dirname, "home-preload.cjs");
const SHA256_RE = /^[0-9a-f]{64}$/;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const TINYHOUSE_NAME = /tiny\s*house|tinyhouse/i;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeArchivePath(value) {
  const raw = String(value ?? "").replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || /^[A-Za-z]:/.test(raw) || raw.includes("\0")) return null;
  const rawParts = raw.split("/");
  if (rawParts.some((part) => part === "..")) return null;
  const normalized = rawParts.map((part) => part.trim()).filter(Boolean).join("/");
  return normalized || null;
}

function safeHomePath(value) {
  const decoded = decodeURIComponent(String(value || "index.html"));
  const normalized = decoded.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === "..")) return null;
  const target = resolve(HOME_ROOT, normalized);
  return target === HOME_ROOT || target.startsWith(`${HOME_ROOT}/`) || target.startsWith(`${HOME_ROOT}\\`) ? target : null;
}

function mimeFor(path) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
  })[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value && typeof value === "object" && Array.isArray(value.data)) return Buffer.from(value.data);
  throw new Error("Pocket Buddy private-art bridge returned invalid ZIP bytes.");
}

function openZip(buffer) {
  const bytes = asBuffer(buffer);
  const minimum = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Private art ZIP end record is missing.");
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const count = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== count) throw new Error("Multi-disk private art ZIPs are not supported.");
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 private art archives are not supported.");
  if (count > MAX_ENTRIES || centralOffset + centralSize > bytes.length) throw new Error("Private art ZIP central directory is invalid.");

  const entries = new Map();
  const suffixEntries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL) throw new Error("Private art ZIP central directory is malformed.");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error("Private art ZIP entry is truncated.");
    if ((flags & 0x1) !== 0) throw new Error("Encrypted private art ZIP entries are not supported.");
    if (method !== 0 && method !== 8) throw new Error(`Unsupported private art ZIP compression method: ${method}.`);
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("Private art ZIP entry is too large.");
    const rawName = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (!rawName.endsWith("/")) {
      const normalized = normalizeArchivePath(rawName);
      if (!normalized) throw new Error(`Unsafe private art ZIP path: ${rawName}`);
      const key = normalized.toLocaleLowerCase("en-US");
      if (entries.has(key)) throw new Error(`Private art ZIP has a normalized path collision: ${normalized}`);
      const record = { normalized, method, compressedSize, uncompressedSize, localOffset };
      entries.set(key, record);

      // Match the original PocketBuddy+ TinyHouse picker: licensed ZIPs may be
      // wrapped in one or more parent folders. Index every safe path suffix so
      // `Floor_Wall_Tiles_128/...` resolves inside
      // `TinyHouse_0.17(@Pixel_Salvaje)/Floor_Wall_Tiles_128/...`.
      // Never use macOS metadata and never guess between ambiguous duplicates.
      if (!key.startsWith("__macosx/")) {
        const segments = normalized.split("/");
        for (let start = 0; start < segments.length; start += 1) {
          const suffixKey = segments.slice(start).join("/").toLocaleLowerCase("en-US");
          if (!suffixEntries.has(suffixKey)) suffixEntries.set(suffixKey, record);
          else if (suffixEntries.get(suffixKey) !== record) suffixEntries.set(suffixKey, null);
        }
      }
    }
    cursor = end;
  }

  function read(path) {
    const normalized = normalizeArchivePath(path);
    const key = normalized ? normalized.toLocaleLowerCase("en-US") : "";
    const exact = key ? entries.get(key) : null;
    const suffix = key ? suffixEntries.get(key) : undefined;
    if (!exact && suffix === null) throw new Error(`Private art ZIP path is ambiguous: ${normalized}`);
    const entry = exact ?? suffix ?? null;
    if (!entry) return null;
    const offset = entry.localOffset;
    if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== LOCAL) throw new Error(`Private art ZIP local header is malformed: ${entry.normalized}`);
    const localMethod = bytes.readUInt16LE(offset + 8);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    if (localMethod !== entry.method) throw new Error(`Private art ZIP local header disagrees: ${entry.normalized}`);
    const start = offset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw new Error(`Private art ZIP payload is truncated: ${entry.normalized}`);
    const compressed = bytes.subarray(start, end);
    const result = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    if (result.length !== entry.uncompressedSize) throw new Error(`Private art ZIP size mismatch: ${entry.normalized}`);
    return result;
  }

  return { read, size: entries.size };
}

function cleanOptions(value = {}) {
  const humanSha256 = String(value?.humanSha256 ?? "").toLowerCase();
  const petSha256 = String(value?.petSha256 ?? "").toLowerCase();
  if (!SHA256_RE.test(humanSha256)) throw new Error("Home requires the exact verified Ani Iso Human pack.");
  if (petSha256 && !SHA256_RE.test(petSha256)) throw new Error("Home received an invalid active Buddy art hash.");
  return {
    humanSha256,
    petSha256: petSha256 || "",
    petScale: clamp(Number(value?.petScale) || 1, 0.25, 8),
    uiScale: clamp(Number(value?.uiScale) || 1, 0.5, 2.5),
    humanScale: clamp(Number(value?.humanScale) || 1.2, 0.8, 2),
    buddyName: typeof value?.buddyName === "string" ? value.buddyName.trim().slice(0, 64) : "Buddy",
    // "desktop" renders Home as a transparent always-on-top overlay on the
    // real desktop; "window" keeps the original framed window.
    mode: value?.mode === "desktop" ? "desktop" : "window",
  };
}

function boundedWindowBounds(workArea, prior = null) {
  const width = Math.min(Math.max(720, prior?.width ?? 1200), workArea.width);
  const height = Math.min(Math.max(560, prior?.height ?? 760), workArea.height);
  const x = clamp(prior?.x ?? Math.round(workArea.x + (workArea.width - width) / 2), workArea.x, workArea.x + workArea.width - width);
  const y = clamp(prior?.y ?? Math.round(workArea.y + (workArea.height - height) / 2), workArea.y, workArea.y + workArea.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function createCanonicalHomeManager({
  getWorkArea,
  getArtEntries,
  readArtBytes,
  onClosed = () => {},
  // Developer-tool hooks. `isStudioEnabled` decides whether Home advertises the
  // Studio bridge to its own runtime; `onReady` lets Studio attach to the real
  // Home webContents. Both are inert in production.
  isStudioEnabled = () => false,
  onReady = () => {},
}) {
  let homeWindow = null;
  let server = null;
  let baseUrl = "";
  let currentConfig = null;
  let currentMode = "window";
  const archiveCache = new Map();

  async function entries() {
    const result = await getArtEntries();
    return Array.isArray(result) ? result : [];
  }

  async function archiveFor(entry) {
    if (archiveCache.has(entry.sha256)) return archiveCache.get(entry.sha256);
    const payload = await readArtBytes(entry.id);
    if (payload?.sha256 !== entry.sha256) throw new Error(`Private art SHA changed while opening Home: ${entry.displayName || entry.file}.`);
    const archive = openZip(payload.bytes);
    archiveCache.set(entry.sha256, archive);
    return archive;
  }

  async function resolveEnvironment() {
    const all = await entries();
    const environment = all.find((entry) => entry.kind === "environment")
      ?? all.find((entry) => TINYHOUSE_NAME.test(`${entry.displayName ?? ""} ${entry.file ?? ""} ${entry.importName ?? ""}`));
    if (!environment) throw new Error("The verified TinyHouse environment pack is missing. Home will not substitute fake art.");
    return environment;
  }

  async function entryBySha(sha) {
    if (!sha) return null;
    return (await entries()).find((entry) => entry.sha256 === sha) ?? null;
  }

  function send(res, status, body, type = "text/plain; charset=utf-8") {
    res.writeHead(status, {
      "Content-Type": type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    res.end(body);
  }

  async function serveArchivePath(res, entry, rawPath) {
    const archive = await archiveFor(entry);
    const decoded = decodeURIComponent(rawPath);
    const body = archive.read(decoded);
    if (!body) return send(res, 404, "Not found");
    return send(res, 200, body, mimeFor(decoded));
  }

  async function requestHandler(req, res) {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/" || url.pathname === "/home") {
        res.writeHead(302, { Location: "/home/index.html?pack=/pack/", "Cache-Control": "no-store" });
        return res.end();
      }
      if (url.pathname === "/bridge/pocket-buddy-home-actors.js") {
        return send(res, 200, await readFile(ACTOR_BRIDGE), "text/javascript; charset=utf-8");
      }
      if (url.pathname === "/bridge/home-overlay.js") {
        return send(res, 200, await readFile(OVERLAY_BRIDGE), "text/javascript; charset=utf-8");
      }
      if (url.pathname.startsWith("/pack/")) {
        return serveArchivePath(res, await resolveEnvironment(), url.pathname.slice("/pack/".length));
      }
      if (url.pathname.startsWith("/private/")) {
        const rest = url.pathname.slice("/private/".length);
        const slash = rest.indexOf("/");
        if (slash <= 0) return send(res, 404, "Not found");
        const sha = rest.slice(0, slash).toLowerCase();
        if (!SHA256_RE.test(sha)) return send(res, 400, "Invalid private art hash");
        const entry = await entryBySha(sha);
        if (!entry) return send(res, 404, "Private art pack not registered");
        return serveArchivePath(res, entry, rest.slice(slash + 1));
      }
      if (url.pathname.startsWith("/home/")) {
        const target = safeHomePath(url.pathname.slice("/home/".length));
        if (!target) return send(res, 400, "Invalid Home path");
        let body = await readFile(target);
        if (target.endsWith("index.html")) {
          const config = JSON.stringify(currentConfig ?? {}).replace(/</g, "\\u003c");
              const injection = `<script>window.POCKET_BUDDY_HOME_CONFIG=Object.freeze(${config});</script>`
            + `<script src="/bridge/pocket-buddy-home-actors.js"></script>`
            + `<script src="/bridge/home-overlay.js"></script>`;
          body = Buffer.from(body.toString("utf8").replace("</body>", `${injection}</body>`), "utf8");
        }
        return send(res, 200, body, mimeFor(target));
      }
      return send(res, 404, "Not found");
    } catch (error) {
      console.error("Pocket Buddy canonical Home server error", error);
      return send(res, 500, error instanceof Error ? error.message : String(error));
    }
  }

  async function ensureServer() {
    if (server && baseUrl) return baseUrl;
    server = createServer((req, res) => { void requestHandler(req, res); });
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Pocket Buddy Home server did not receive a local port.");
    baseUrl = `http://127.0.0.1:${address.port}`;
    return baseUrl;
  }

  async function validateConfig(options) {
    const cleaned = cleanOptions(options);
    const all = await entries();
    const environment = all.find((entry) => entry.kind === "environment")
      ?? all.find((entry) => TINYHOUSE_NAME.test(`${entry.displayName ?? ""} ${entry.file ?? ""}`));
    if (!environment) throw new Error("The verified TinyHouse pack is missing. Home will not render substitute geometry.");
    const human = all.find((entry) => entry.sha256 === cleaned.humanSha256);
    if (!human || human.kind !== "human") throw new Error("The exact verified Ani Iso Human pack is missing. Home will not render a substitute player.");
    if (cleaned.petSha256 && !all.some((entry) => entry.sha256 === cleaned.petSha256 && entry.kind !== "environment")) {
      throw new Error("The active Buddy art pack is not available to Home.");
    }
    await archiveFor(environment);
    await archiveFor(human);
    if (cleaned.petSha256) await archiveFor(all.find((entry) => entry.sha256 === cleaned.petSha256));
    return cleaned;
  }

  /** Transparent always-on-top desktop overlay, matching the pet overlay. */
  function applyOverlayContract(window) {
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setIgnoreMouseEvents(true, { forward: true });
    if (process.platform === "darwin") window.setWindowButtonVisibility?.(false);
  }

  async function open(options = {}) {
    currentConfig = { ...(await validateConfig(options)), studio: Boolean(isStudioEnabled()) };
    const url = await ensureServer();
    const overlay = currentConfig.mode === "desktop";

    // Transparency and frame cannot be toggled on a live BrowserWindow, so a
    // mode change rebuilds the window rather than pretending to switch.
    if (homeWindow && !homeWindow.isDestroyed() && currentMode !== currentConfig.mode) {
      const stale = homeWindow;
      homeWindow = null;
      stale.destroy();
    }
    currentMode = currentConfig.mode;

    if (!homeWindow || homeWindow.isDestroyed()) {
      const workArea = getWorkArea();
      homeWindow = new BrowserWindow({
        ...(overlay ? workArea : boundedWindowBounds(workArea)),
        title: "Pocket Buddy Home",
        show: false,
        transparent: overlay,
        backgroundColor: overlay ? "#00000000" : "#0e0f13",
        frame: !overlay,
        titleBarStyle: overlay ? "hidden" : "default",
        hasShadow: !overlay,
        skipTaskbar: overlay,
        acceptFirstMouse: overlay,
        resizable: !overlay,
        movable: !overlay,
        minimizable: !overlay,
        maximizable: false,
        fullscreenable: false,
        webPreferences: {
          preload: HOME_PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      });
      homeWindow.setMenuBarVisibility(false);
      homeWindow.on("closed", () => {
        homeWindow = null;
        // A listener fault must not become an unhandled main-process exception.
        try { onClosed(); } catch (error) { console.warn("Pocket Buddy Home close handler failed", error); }
      });
      // Re-runs on every navigation/reload so developer tooling survives a
      // Studio reload without duplicating the Home window itself.
      homeWindow.webContents.on("did-finish-load", () => {
        try { onReady(homeWindow?.webContents ?? null); } catch { /* developer tooling only */ }
      });
      homeWindow.once("ready-to-show", () => {
        reclamp();
        if (overlay) applyOverlayContract(homeWindow);
        homeWindow?.show();
        // Focused even while click-through, so WASD still reaches the player.
        homeWindow?.focus();
      });
    }
    await homeWindow.loadURL(`${url}/home/index.html?pack=/pack/`);
    if (!homeWindow.isVisible()) homeWindow.show();
    homeWindow.focus();
    return { ok: true, url: `${url}/home/index.html`, donor: "6e4a80775f8a7f5b0d243b0a9f50e6653526219b" };
  }

  function reclamp() {
    if (!homeWindow || homeWindow.isDestroyed()) return;
    const workArea = getWorkArea();
    if (currentMode === "desktop") {
      homeWindow.setBounds(workArea, false);
      applyOverlayContract(homeWindow);
      return;
    }
    homeWindow.setBounds(boundedWindowBounds(workArea, homeWindow.getBounds()), false);
  }

  /**
   * Click-through control for overlay mode: the page reports whether the
   * pointer is over the house or a pop-out menu, and everything else falls
   * through to the desktop behind it.
   */
  function setInteractive(interactive) {
    if (!homeWindow || homeWindow.isDestroyed() || currentMode !== "desktop") return;
    homeWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  function owns(webContents) {
    return Boolean(homeWindow && !homeWindow.isDestroyed() && homeWindow.webContents === webContents);
  }

  function close() {
    if (homeWindow && !homeWindow.isDestroyed()) homeWindow.close();
  }

  async function dispose() {
    close();
    archiveCache.clear();
    if (server) await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    server = null;
    baseUrl = "";
  }

  function webContents() {
    return homeWindow && !homeWindow.isDestroyed() ? homeWindow.webContents : null;
  }

  function isOpen() {
    return Boolean(homeWindow && !homeWindow.isDestroyed());
  }

  return { open, close, reclamp, owns, dispose, webContents, isOpen, setInteractive, mode: () => currentMode };
}
