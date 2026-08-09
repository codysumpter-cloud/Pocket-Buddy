import { app, BrowserWindow, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Injected into the real Pocket Buddy windows in order. Read from disk on every
// attach so the watch/dev loop picks up edits without a full rebuild.
const AGENT_FILES = ["studio-scene-core.js", "studio-agent.js"];
const SURFACES = new Set(["desktop", "home"]);

/**
 * Pocket Buddy Studio, main-process side.
 *
 * Studio drives the real windows entirely through `executeJavaScript` and
 * `capturePage`. That is deliberate: production `preload.cjs`, `renderer.js`
 * and the Home preload keep exactly the IPC surface they had before, so
 * shipping behavior is unchanged whether or not Studio exists.
 */
export function createStudioManager({
  enabled = false,
  resolveTarget = () => null,
  onRequestHome = async () => {},
} = {}) {
  let studioWindow = null;
  let registered = false;
  const attached = new WeakSet();

  function isEnabled() {
    return Boolean(enabled);
  }

  async function agentSource() {
    const parts = await Promise.all(AGENT_FILES.map((file) => readFile(join(__dirname, file), "utf8")));
    return parts.join("\n;\n");
  }

  function targetFor(surface) {
    if (!SURFACES.has(String(surface))) throw new Error(`Unknown Studio surface "${surface}".`);
    const contents = resolveTarget(String(surface));
    if (!contents || contents.isDestroyed()) throw new Error(`The ${surface} window is not open.`);
    return contents;
  }

  /** Inject the agent into a target window. Safe to call repeatedly. */
  async function attachTo(contents) {
    if (!isEnabled() || !contents || contents.isDestroyed()) return false;
    const source = await agentSource();
    await contents.executeJavaScript(source, true);
    attached.add(contents);
    return true;
  }

  async function ensureAttached(contents) {
    const present = await contents.executeJavaScript("Boolean(window.__POCKET_BUDDY_STUDIO__)", true).catch(() => false);
    if (!present) await attachTo(contents);
  }

  async function call(surface, method, args = []) {
    const contents = targetFor(surface);
    await ensureAttached(contents);
    const script = `(() => {
      const api = window.__POCKET_BUDDY_STUDIO__;
      if (!api) return { ok: false, error: "Studio agent is not attached." };
      const fn = api[${JSON.stringify(String(method))}];
      if (typeof fn !== "function") return { ok: false, error: "Unknown Studio method: ${String(method).replace(/[^\w]/g, "")}" };
      return fn(...${JSON.stringify(Array.isArray(args) ? args : [])});
    })()`;
    return contents.executeJavaScript(script, true);
  }

  async function capture(surface) {
    const contents = targetFor(surface);
    const window = BrowserWindow.fromWebContents(contents);
    if (!window || window.isDestroyed()) throw new Error(`The ${surface} window is not open.`);
    const image = await contents.capturePage();
    if (image.isEmpty()) throw new Error(`The ${surface} window produced an empty frame.`);
    // Content bounds, not window bounds: capturePage excludes the OS frame, and
    // Studio maps viewport clicks back through these as CSS pixels.
    const bounds = window.getContentBounds();
    return { dataUrl: image.toDataURL(), width: bounds.width, height: bounds.height };
  }

  function createWindow() {
    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      title: "Pocket Buddy Studio",
      backgroundColor: "#12131a",
      show: false,
      webPreferences: {
        preload: join(__dirname, "studio-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    window.setMenuBarVisibility(false);
    window.loadFile(join(__dirname, "index.html"));
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => { studioWindow = null; });
    return window;
  }

  function registerIpc() {
    if (registered || !isEnabled()) return;
    registered = true;

    const fromStudio = (event) => Boolean(studioWindow && !studioWindow.isDestroyed() && event.sender === studioWindow.webContents);

    ipcMain.handle("pb-studio:call", async (event, payload) => {
      if (!fromStudio(event)) throw new Error("Studio IPC is limited to the Studio window.");
      try {
        return await call(payload?.surface, payload?.method, payload?.args);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle("pb-studio:capture", async (event, surface) => {
      if (!fromStudio(event)) throw new Error("Studio IPC is limited to the Studio window.");
      try {
        return { ok: true, ...(await capture(surface)) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle("pb-studio:targets", (event) => {
      if (!fromStudio(event)) throw new Error("Studio IPC is limited to the Studio window.");
      return [...SURFACES].map((surface) => {
        const contents = resolveTarget(surface);
        return { surface, open: Boolean(contents && !contents.isDestroyed()) };
      });
    });

    ipcMain.handle("pb-studio:devtools", (event, surface) => {
      if (!fromStudio(event)) throw new Error("Studio IPC is limited to the Studio window.");
      try {
        const contents = surface === "studio" ? studioWindow.webContents : targetFor(surface);
        contents.isDevToolsOpened() ? contents.closeDevTools() : contents.openDevTools({ mode: "detach" });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle("pb-studio:reload", async (event, surface) => {
      if (!fromStudio(event)) throw new Error("Studio IPC is limited to the Studio window.");
      try {
        targetFor(surface).reload();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

    ipcMain.handle("pb-studio:relaunch", (event) => {
      if (!fromStudio(event)) throw new Error("Studio IPC is limited to the Studio window.");
      app.relaunch();
      app.exit(0);
      return { ok: true };
    });

    ipcMain.handle("pb-studio:open-home", async (event) => {
      if (!fromStudio(event)) throw new Error("Studio IPC is limited to the Studio window.");
      try {
        await onRequestHome();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  function open() {
    if (!isEnabled()) return null;
    registerIpc();
    if (studioWindow && !studioWindow.isDestroyed()) {
      studioWindow.show();
      studioWindow.focus();
      return studioWindow;
    }
    studioWindow = createWindow();
    return studioWindow;
  }

  function toggle() {
    if (!isEnabled()) return null;
    if (studioWindow && !studioWindow.isDestroyed() && studioWindow.isVisible()) {
      studioWindow.hide();
      return studioWindow;
    }
    return open();
  }

  function close() {
    if (studioWindow && !studioWindow.isDestroyed()) studioWindow.close();
    studioWindow = null;
  }

  return { isEnabled, open, toggle, close, attachTo, call, capture };
}
