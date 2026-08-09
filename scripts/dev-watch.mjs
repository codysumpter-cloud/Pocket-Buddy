#!/usr/bin/env node
// Pocket Buddy development watcher.
//
// Rebuilds only when the bundled Pocket Buddy core actually changes, and
// otherwise just relaunches Electron. Editing desktop shell, Home runtime, or
// Studio files therefore costs a relaunch rather than a full rollup build.
//
//   node scripts/dev-watch.mjs            # watch + relaunch
//   node scripts/dev-watch.mjs --studio   # also force Studio on and open it

import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(__dirname, ".."));
const DEBOUNCE_MS = 160;
const WATCHED_EXTENSIONS = /\.(m?js|cjs|css|html|json|png)$/i;

// Changes here mean the rollup bundle in dist/ is stale.
const REBUILD_PATHS = ["src", "build.js", "scripts/postprocess-build.mjs", "sprites/species.png"];
// Changes here are read directly by Electron at runtime; a relaunch is enough.
const RELAUNCH_PATHS = ["desktop"];

const studioMode = process.argv.includes("--studio");
const homeMode = process.argv.includes("--home");
const childEnv = {
  ...process.env,
  ...(studioMode ? { POCKET_BUDDY_STUDIO: "1", POCKET_BUDDY_STUDIO_OPEN: "1" } : {}),
  ...(homeMode ? { POCKET_BUDDY_STUDIO: "1", POCKET_BUDDY_STUDIO_HOME: "1" } : {}),
};

let electron = null;
let pending = null;
let running = false;
let queuedRebuild = false;

function log(message) {
  process.stdout.write(`[pb-dev] ${message}\n`);
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", env: childEnv });
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`))));
    child.on("error", reject);
  });
}

async function build() {
  log("building Pocket Buddy core…");
  await run(process.execPath, [join(ROOT, "build.js")]);
  await run(process.execPath, [join(ROOT, "scripts", "postprocess-build.mjs")]);
}

function stopElectron() {
  if (!electron) return Promise.resolve();
  const child = electron;
  electron = null;
  return new Promise((resolvePromise) => {
    child.once("exit", () => resolvePromise());
    child.kill();
    // Never let a wedged Electron block the next launch.
    setTimeout(() => resolvePromise(), 2000);
  });
}

function startElectron() {
  const electronBinary = join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  if (!existsSync(electronBinary)) throw new Error("electron is not installed — run npm ci first.");
  log(`launching Electron${studioMode ? " with Studio enabled" : ""}…`);
  electron = spawn(electronBinary, ["."], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", env: childEnv });
  electron.on("exit", (code, signal) => {
    // A manual quit ends the watcher; a kill for relaunch does not.
    if (electron && !signal) {
      log(`Electron exited (${code}). Stopping watcher.`);
      process.exit(code ?? 0);
    }
  });
}

async function cycle(needsRebuild) {
  if (running) {
    queuedRebuild = queuedRebuild || needsRebuild;
    return;
  }
  running = true;
  try {
    if (needsRebuild) await build();
    await stopElectron();
    startElectron();
  } catch (error) {
    log(`build failed, keeping the previous build running: ${error.message}`);
  } finally {
    running = false;
    if (queuedRebuild) {
      queuedRebuild = false;
      void cycle(true);
    }
  }
}

function schedule(needsRebuild, why) {
  if (pending) clearTimeout(pending.timer);
  const rebuild = Boolean(pending?.rebuild) || needsRebuild;
  pending = {
    rebuild,
    timer: setTimeout(() => {
      pending = null;
      log(`change: ${why}${rebuild ? " (rebuild)" : ""}`);
      void cycle(rebuild);
    }, DEBOUNCE_MS),
  };
}

function watchPath(target, needsRebuild) {
  const full = join(ROOT, target);
  if (!existsSync(full)) return;
  try {
    watch(full, { recursive: true }, (_event, filename) => {
      const name = filename ? String(filename) : target;
      if (filename && !WATCHED_EXTENSIONS.test(name)) return;
      if (name.includes("node_modules") || name.includes(".git")) return;
      schedule(needsRebuild, relative(ROOT, join(full, filename ? name : "")) || target);
    });
  } catch (error) {
    log(`could not watch ${target}: ${error.message}`);
  }
}

process.on("SIGINT", () => { void stopElectron().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void stopElectron().then(() => process.exit(0)); });

await build();
startElectron();
for (const target of REBUILD_PATHS) watchPath(target, true);
for (const target of RELAUNCH_PATHS) watchPath(target, false);
log(`watching ${[...REBUILD_PATHS, ...RELAUNCH_PATHS].join(", ")}`);
