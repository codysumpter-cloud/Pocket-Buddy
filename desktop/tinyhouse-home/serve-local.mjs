#!/usr/bin/env node
// Serve the TinyHouse game against a purchased pack that stays where it is.
//
//   node games/tinyhouse-local/serve-local.mjs "/path/to/TinyHouse_0.17(@Pixel_Salvaje)"
//
// The folder picker in index.html remains the default and the only path a
// normal user needs. This exists so a developer can reload repeatedly without
// re-picking the folder every time.
//
// The licence boundary is unchanged: the pack is read from the path given on
// the command line, nothing is copied into the repository, and the served
// mount is read-only and confined to that directory.
import { createReadStream } from "node:fs";
import { readdir, stat, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// resolve() strips the trailing slash the URL form leaves behind, which would
// otherwise make the containment check compare against a double separator.
const GAME_DIR = resolve(fileURLToPath(new URL("./", import.meta.url)));
const packArg = process.argv[2];
const port = Number(process.env.PORT || 4173);

if (!packArg) {
  console.error('usage: node serve-local.mjs "/path/to/TinyHouse_0.17(@Pixel_Salvaje)"');
  process.exit(2);
}

const PACK_DIR = await realpath(resolve(packArg)).catch(() => null);
if (!PACK_DIR) {
  console.error(`Pack folder not found: ${packArg}`);
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".gif": "image/gif", ".json": "application/json",
};

/** Resolve inside a root, refusing anything that escapes it. */
async function safeJoin(root, relPath) {
  const target = resolve(root, "." + (relPath.startsWith("/") ? relPath : `/${relPath}`));
  if (target !== root && !target.startsWith(root + sep)) return null;
  const info = await stat(target).catch(() => null);
  if (info?.isFile()) return target;
  return lenientMatch(root, target);
}

/**
 * The picker trims every path segment, so it silently tolerates the stray
 * whitespace the pack actually ships - "Poster/ Poster_Medical.png" has a
 * leading space in the real filename. Exact-path serving would 404 on it, so
 * fall back to the same trimmed, case-insensitive comparison the picker uses.
 * Still confined to `root`: only a sibling in the resolved parent can match.
 */
async function lenientMatch(root, target) {
  const parent = target.slice(0, target.lastIndexOf(sep)) || root;
  if (parent !== root && !parent.startsWith(root + sep)) return null;
  const wanted = target.slice(target.lastIndexOf(sep) + 1).trim().toLowerCase();
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => null);
  const hit = entries?.find((e) => e.isFile() && e.name.trim().toLowerCase() === wanted);
  return hit ? join(parent, hit.name) : null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    const [root, rel] = path.startsWith("/pack/")
      ? [PACK_DIR, path.slice("/pack".length)]
      : [GAME_DIR, path === "/" ? "/index.html" : path];

    const file = await safeJoin(root, rel);
    if (!file) { res.writeHead(404).end("not found"); return; }

    res.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`TinyHouse local game  http://127.0.0.1:${port}/?pack=/pack/`);
  console.log(`serving game from     ${GAME_DIR}`);
  console.log(`serving pack from     ${PACK_DIR}  (read-only)`);
});
