import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function motionSandbox() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("desktop/tinyhouse-home/house-grid-core.js"), sandbox, { filename: "house-grid-core.js" });
  vm.runInContext(read("desktop/tinyhouse-home/actor-motion-core.js"), sandbox, { filename: "actor-motion-core.js" });
  return sandbox.window;
}

test("Home actors retain fractional positions instead of snapping to furniture cells", () => {
  const runtime = motionSandbox();
  const { HouseGrid } = runtime.TinyHouseGridCore;
  const grid = HouseGrid.createDefault({ columns: 2, rows: 1 });
  const next = runtime.PocketBuddyActorMotion.moveGrid(grid, { column: 0, row: 0 }, 0.2, 0);
  assert.ok(next.column > 0.15 && next.column < 0.25, `expected fractional movement, got ${next.column}`);
  assert.equal(next.row, 0);
  assert.notEqual(next.column, Math.round(next.column));
});

test("continuous actors stop at closed walls but cross open doors", () => {
  const runtime = motionSandbox();
  const { HouseGrid } = runtime.TinyHouseGridCore;
  const grid = HouseGrid.createDefault({ columns: 2, rows: 1 });

  grid.setWall("left", 1, 0);
  const blocked = runtime.PocketBuddyActorMotion.moveGrid(grid, { column: 0, row: 0 }, 0.9, 0);
  assert.ok(blocked.column < 0.5, `closed wall should block before the cell boundary, got ${blocked.column}`);

  grid.setDoor("left", 1, 0, "door", true);
  assert.equal(grid.canTraverse({ column: 0, row: 0 }, { column: 1, row: 0 }), true, "donor HouseGrid should report the open door traversable");
  const through = runtime.PocketBuddyActorMotion.moveGrid(grid, { column: 0, row: 0 }, 0.9, 0);
  assert.ok(through.column > 0.5, `open door should allow continuous crossing, got ${through.column}`);
});

test("desktop and web Home use the same continuous actor motion core", () => {
  const index = read("desktop/tinyhouse-home/index.html");
  const desktop = read("desktop/pocket-buddy-home-actors.js");
  const web = read("desktop/tinyhouse-home/pocket-buddy-web-actors.js");
  const core = read("desktop/tinyhouse-home/actor-motion-core.js");

  assert.match(index, /actor-motion-core\.js/);
  assert.match(core, /moveScreen/);
  assert.match(core, /moveToward/);
  assert.match(desktop, /PocketBuddyActorMotion\.moveScreen/);
  assert.match(desktop, /motion\.moveToward/);
  assert.match(web, /PocketBuddyActorMotion\.moveScreen/);
  assert.match(web, /motion\.moveToward/);
  assert.doesNotMatch(desktop, /const MOVE_MS = 180/);
  assert.doesNotMatch(web, /const MOVE_MS = 180/);
  assert.doesNotMatch(desktop, /function startMove\(/);
  assert.doesNotMatch(web, /function startMove\(/);
});

test("Home always has an exit independent of TinyHouse boot", () => {
  const home = read("src/buddy/home.js");
  const desktop = read("desktop/pocket-buddy-home-actors.js");
  const web = read("desktop/tinyhouse-home/pocket-buddy-web-actors.js");

  assert.match(home, /← LEAVE HOME/);
  assert.match(home, /event\.key !== "Escape"/);
  assert.match(home, /z-index:2147483647/);
  assert.match(desktop, /event\.key !== "Escape"/);
  assert.match(desktop, /bridge\?\.close\?\.\(\)/);
  assert.match(web, /event\.key !== "Escape"/);
  assert.match(web, /buddyApi\.home\?\.close\?\.\(\)/);
});

test("Home owns one Buddy presence and restores the desktop Buddy when it closes", () => {
  const home = read("src/buddy/home.js");
  const pets = read("src/buddy/pet-runtime.js");
  const preload = read("desktop/preload.cjs");
  const main = read("desktop/main.mjs");
  const nativeHome = read("desktop/canonical-home.mjs");

  assert.match(home, /setHomePresence\(true\)/);
  assert.match(home, /setHomePresence\(false\)/);
  assert.match(home, /onHomeClosed/);
  assert.match(pets, /let homeActive = false/);
  assert.match(pets, /setHomeActive\(value\)/);
  assert.match(pets, /overlay\.style\.display = "none"/);
  assert.match(preload, /pocket-buddy:home-closed/);
  assert.match(main, /pocket-buddy:home-closed/);
  assert.match(nativeHome, /onClosed/);
});
