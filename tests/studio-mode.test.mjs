import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

import { devToolsShortcutsEnabled, studioAutoOpen, studioEnabled } from "../desktop/studio/studio-gate.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function studioSandbox() {
  const sandbox = { window: {}, globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(read("desktop/tinyhouse-home/house-grid-core.js"), sandbox, { filename: "house-grid-core.js" });
  vm.runInContext(read("desktop/tinyhouse-home/actor-motion-core.js"), sandbox, { filename: "actor-motion-core.js" });
  vm.runInContext(read("desktop/studio/studio-scene-core.js"), sandbox, { filename: "studio-scene-core.js" });
  return sandbox.window;
}

// ------------------------------------------------------------------- gate

test("Studio stays out of production builds unless explicitly enabled", () => {
  assert.equal(studioEnabled({ packaged: true, env: {} }), false, "packaged builds must not expose Studio by default");
  assert.equal(studioEnabled({ packaged: true, env: { POCKET_BUDDY_STUDIO: "1" } }), true);
  assert.equal(studioEnabled({ packaged: true, env: { POCKET_BUDDY_STUDIO: "true" } }), true);
  assert.equal(studioEnabled({ packaged: false, env: {} }), true, "development builds get Studio");
  assert.equal(studioEnabled({ packaged: false, env: { POCKET_BUDDY_STUDIO: "0" } }), false, "explicit off wins in development");
});

test("DevTools shortcuts follow the same gate as Studio", () => {
  assert.equal(devToolsShortcutsEnabled({ packaged: true, env: {} }), false);
  assert.equal(devToolsShortcutsEnabled({ packaged: false, env: {} }), true);
});

test("Studio only auto-opens when it is both enabled and requested", () => {
  assert.equal(studioAutoOpen({ packaged: false, env: {} }), false);
  assert.equal(studioAutoOpen({ packaged: false, env: { POCKET_BUDDY_STUDIO_OPEN: "1" } }), true);
  assert.equal(studioAutoOpen({ packaged: true, env: { POCKET_BUDDY_STUDIO_OPEN: "1" } }), false, "auto-open must not re-enable a disabled Studio");
});

// --------------------------------------------------------------- geometry

test("Studio overlays project through the canonical TinyHouse grid math", () => {
  const runtime = studioSandbox();
  const core = runtime.PocketBuddyStudioCore;
  const grid = runtime.TinyHouseGridCore;

  for (const [column, row] of [[0, 0], [1, 0], [2, 3], [-1, 4]]) {
    const derived = core.centerProject(column, row);
    const canonical = grid.cellCenter(column, row, grid.DEFAULT_ROOM);
    assert.ok(Math.abs(derived.x - canonical.x) < 1e-9, `x drift at ${column},${row}`);
    assert.ok(Math.abs(derived.y - canonical.y) < 1e-9, `y drift at ${column},${row}`);
  }
});

test("floor polygons are the four lattice corners and average back to the cell center", () => {
  const runtime = studioSandbox();
  const core = runtime.PocketBuddyStudioCore;
  const grid = runtime.TinyHouseGridCore;

  const polygon = core.cellPolygon(2, 1);
  assert.equal(polygon.length, 4);
  const average = polygon.reduce((total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }), { x: 0, y: 0 });
  const center = grid.cellCenter(2, 1, grid.DEFAULT_ROOM);
  assert.ok(Math.abs(average.x - center.x) < 1e-9);
  assert.ok(Math.abs(average.y - center.y) < 1e-9);
});

test("wall and door segments sit exactly between the two cells they separate", () => {
  const runtime = studioSandbox();
  const core = runtime.PocketBuddyStudioCore;
  const gridCore = runtime.TinyHouseGridCore;

  const checkEdge = (axis, column, row) => {
    const [a, b] = gridCore.adjacentCellsForEdge(axis, column, row);
    const centerA = gridCore.cellCenter(a.column, a.row, gridCore.DEFAULT_ROOM);
    const centerB = gridCore.cellCenter(b.column, b.row, gridCore.DEFAULT_ROOM);
    const expected = { x: (centerA.x + centerB.x) / 2, y: (centerA.y + centerB.y) / 2 };

    const segment = core.edgeSegment(axis, column, row);
    const midpoint = { x: (segment[0].x + segment[1].x) / 2, y: (segment[0].y + segment[1].y) / 2 };
    assert.ok(Math.abs(midpoint.x - expected.x) < 1e-9, `${axis} edge x at ${column},${row}`);
    assert.ok(Math.abs(midpoint.y - expected.y) < 1e-9, `${axis} edge y at ${column},${row}`);
  };

  checkEdge("left", 1, 0);
  checkEdge("right", 0, 1);
  checkEdge("left", 3, 2);
  checkEdge("right", 2, 4);
});

test("collision polygons grow with the motion core radius and stay centered on the actor", () => {
  const runtime = studioSandbox();
  const core = runtime.PocketBuddyStudioCore;
  const radius = runtime.PocketBuddyActorMotion.DEFAULT_RADIUS;

  const position = { column: 1.25, row: 2.5 };
  const polygon = core.collisionPolygon(position, radius);
  assert.equal(polygon.length, 4);

  const center = core.centerProject(position.column, position.row);
  const average = polygon.reduce((total, point) => ({ x: total.x + point.x / 4, y: total.y + point.y / 4 }), { x: 0, y: 0 });
  assert.ok(Math.abs(average.x - center.x) < 1e-9, "collision box must be centered on the actor");
  assert.ok(Math.abs(average.y - center.y) < 1e-9);

  const spanOf = (poly) => Math.max(...poly.map((point) => point.x)) - Math.min(...poly.map((point) => point.x));
  assert.ok(spanOf(core.collisionPolygon(position, radius * 2)) > spanOf(polygon), "a larger radius must draw a larger box");
});

test("the debug model reports walkable cells and which edges actually block", () => {
  const runtime = studioSandbox();
  const core = runtime.PocketBuddyStudioCore;
  const { HouseGrid } = runtime.TinyHouseGridCore;

  const grid = HouseGrid.createDefault({ columns: 2, rows: 1 });
  grid.setWall("left", 1, 0);
  let model = core.gridDebugModel(grid);
  assert.equal(model.walkableCount, 2);
  assert.ok(model.edges.some((edge) => edge.key === "left:1,0" && edge.blocking), "a wall must be reported as blocking");

  grid.setDoor("left", 1, 0, "door", true);
  model = core.gridDebugModel(grid);
  const door = model.edges.find((edge) => edge.key === "left:1,0");
  assert.equal(door.kind, "door");
  assert.equal(door.open, true);
  assert.equal(door.blocking, false, "an open door must not be drawn as a blocker");
});

test("the cell readout under an actor is the rounded canonical cell", () => {
  const runtime = studioSandbox();
  const core = runtime.PocketBuddyStudioCore;
  // Compare fields rather than whole objects: values cross a vm realm boundary,
  // so their prototype is not this realm's Object.prototype.
  const cellUnder = (position) => {
    const cell = core.cellUnder(position);
    return [cell.column + 0, cell.row + 0];
  };
  assert.deepEqual(cellUnder({ column: 1.4, row: 2.6 }), [1, 3]);
  assert.deepEqual(cellUnder({ column: -0.4, row: 0.5 }), [0, 1]);
  assert.deepEqual(cellUnder({ column: 2.5, row: -1.5 }), [3, -1]);
});

// --------------------------------------------------------- classification

test("Studio classifies the real Home markup rather than inventing its own", () => {
  const runtime = studioSandbox();
  const { classifyDescriptor } = runtime.PocketBuddyStudioCore;

  assert.equal(classifyDescriptor({ id: "pb-home-human" }), "actor-human");
  assert.equal(classifyDescriptor({ id: "pb-home-buddy" }), "actor-buddy");
  assert.equal(classifyDescriptor({ className: "tile floor-tile structure-floor" }), "floor");
  assert.equal(classifyDescriptor({ className: "tile left-wall-tile structure-wall axis-left" }), "wall");
  assert.equal(classifyDescriptor({ className: "structure-door open axis-left", tagName: "BUTTON" }), "door");
  assert.equal(classifyDescriptor({ className: "placed-item selected" }), "furniture");
  assert.equal(classifyDescriptor({ className: "structure-edge-hit axis-left", tagName: "BUTTON" }), "hit-region");
  assert.equal(classifyDescriptor({ id: "structure-panel" }), "ui-panel");
  assert.equal(classifyDescriptor({ id: "item-layer" }), "layer");
});

// -------------------------------------------------------- runtime wiring

test("the Home studio bridge is installed only under the injected studio flag", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");
  const home = read("desktop/canonical-home.mjs");
  const main = read("desktop/main.mjs");

  assert.match(actors, /if \(!config\.studio \|\| window\.PocketBuddyHomeStudio\) return;/);
  assert.match(actors, /window\.PocketBuddyHomeStudio = Object\.freeze\(/);
  assert.match(home, /studio: Boolean\(isStudioEnabled\(\)\)/);
  assert.match(main, /isStudioEnabled: \(\) => Boolean\(studio\?\.isEnabled\(\)\)/);
  assert.match(main, /enabled: studioEnabled\(studioContext\(\)\)/);
});

test("Studio keeps continuous actor motion and never reintroduces tile snapping", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");
  const agent = read("desktop/studio/studio-agent.js");

  // Actor nudges must go through the shared motion core, which is what applies
  // walls, closed doors and fractional positions.
  assert.match(actors, /window\.PocketBuddyActorMotion\.moveScreen\(/);
  assert.match(agent, /bridge\.nudge\(descriptor\.id/);
  assert.doesNotMatch(agent, /Math\.round\(.*column/);
  assert.doesNotMatch(actors, /nearestFloorCell/);
  assert.doesNotMatch(actors, /function startMove\(/);
});

test("a Studio nudge respects walls and keeps fractional positions", () => {
  const runtime = studioSandbox();
  const { HouseGrid } = runtime.TinyHouseGridCore;
  const motion = runtime.PocketBuddyActorMotion;
  const grid = HouseGrid.createDefault({ columns: 2, rows: 1 });

  // The bridge converts a pixel nudge into moveScreen(dt=0.05, speed=|d|*20),
  // which lands on exactly the requested pixel delta.
  const nudge = (position, dx, dy) => motion.moveScreen(grid, position, dx, dy, 0.05, Math.hypot(dx, dy) * 20);

  const open = nudge({ column: 0, row: 0 }, 12, 0);
  assert.ok(Math.abs(open.dx - 12) < 0.5, `expected a 12px nudge, moved ${open.dx}`);
  assert.notEqual(open.position.column, Math.round(open.position.column), "nudged actors keep fractional positions");

  grid.setWall("left", 1, 0);
  const blocked = nudge({ column: 0.35, row: 0 }, 400, 0);
  assert.ok(blocked.position.column < 0.5, `a closed wall must stop the nudge, got ${blocked.position.column}`);
});

test("Studio never opens a second Home and never duplicates Buddy presence", () => {
  const studioMain = read("desktop/studio/studio-main.mjs");
  const agent = read("desktop/studio/studio-agent.js");
  const main = read("desktop/main.mjs");

  // Studio asks the renderer for the same Home the tray opens, so the verified
  // art handshake and the single-presence contract still run exactly once.
  assert.match(main, /onRequestHome: async \(\) => sendCommand\("home"\)/);
  assert.doesNotMatch(studioMain, /createCanonicalHomeManager/);
  assert.doesNotMatch(studioMain, /tinyhouse-home/);

  // The agent reads the live Home; it must not construct world geometry itself.
  assert.match(agent, /window\.TinyHouseStructure\?\.grid/);
  assert.doesNotMatch(agent, /new HouseGrid\(/);
  assert.doesNotMatch(agent, /createDefault\(/);
});

test("production windows keep their original bridge surface", () => {
  const preload = read("desktop/preload.cjs");
  const homePreload = read("desktop/home-preload.cjs");
  const studioPreload = read("desktop/studio/studio-preload.cjs");

  // Studio drives the real windows through executeJavaScript, so no Studio IPC
  // leaks into the shipping preloads.
  assert.doesNotMatch(preload, /pb-studio/);
  assert.doesNotMatch(homePreload, /pb-studio/);
  assert.match(studioPreload, /pb-studio:call/);
});

test("the developer tray item and DevTools shortcuts are gated", () => {
  const main = read("desktop/main.mjs");
  assert.match(main, /studio\?\.isEnabled\(\) \? \[/, "the tray item must be conditional");
  assert.match(main, /STUDIO_TRAY_LABEL/);
  assert.match(main, /if \(!devToolsShortcutsEnabled\(studioContext\(\)\)\) return;/);
  assert.match(main, /key !== "f12" && !combo/);
});

test("a watch command rebuilds the core and relaunches Electron", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts["desktop:watch"], "node scripts/dev-watch.mjs");
  assert.equal(packageJson.scripts["desktop:studio"], "node scripts/dev-watch.mjs --studio");

  const watcher = read("scripts/dev-watch.mjs");
  assert.match(watcher, /REBUILD_PATHS/);
  assert.match(watcher, /RELAUNCH_PATHS/);
  assert.match(watcher, /POCKET_BUDDY_STUDIO/);
});

// ------------------------------------------------- Home actor correctness

test("Home never picks a combat or injury clip as an idle or walk pose", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");

  // The old chain ended at names[0], which re-selected the very
  // `ani_idle_battle` clip the idle filter excluded — and its first frame is
  // almost entirely transparent, so Ani rendered as a few stray pixels.
  assert.match(actors, /const COMBAT = \/battle\|death\|punch\|attack\|hurt\|fall\|roll\|jump\/i;/);
  assert.match(actors, /match\(\/idle\/i, COMBAT\)/);
  assert.match(actors, /match\(\/walk\/i, COMBAT\)/);
  assert.doesNotMatch(actors, /idleName = exact\("ani_idle"\) \|\| match\(\/idle\/i, \/battle\/i\) \|\| names\[0\]/);

  // Simulate the real Ani pack's animation names through the same chain.
  const names = ["ani_idle_battle", "ani_roll", "The_boy_stands_in_a_relaxed_upright_position_and_g",
    "ani_jump", "ani_punch", "ani_death", "ani_run", "ani_fall", "ani_walk"];
  const COMBAT = /battle|death|punch|attack|hurt|fall|roll|jump/i;
  const exact = (name) => names.find((candidate) => candidate.toLowerCase() === name);
  const match = (pattern, exclude = null) => names.find((candidate) => pattern.test(candidate) && (!exclude || !exclude.test(candidate)));
  const idleName = exact("ani_idle") || match(/idle/i, COMBAT) || match(/stand|relax|breath/i, COMBAT)
    || names.find((candidate) => !COMBAT.test(candidate)) || "";
  const walkName = exact("ani_walk") || match(/walk/i, COMBAT) || exact("ani_run") || match(/run/i, COMBAT) || idleName;

  assert.doesNotMatch(idleName, COMBAT, `idle must not be a combat clip, got ${idleName}`);
  assert.doesNotMatch(walkName, COMBAT, `walk must not be a combat clip, got ${walkName}`);
  assert.equal(walkName, "ani_walk");
});

test("actors are anchored on their drawn feet, not the padded frame", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");

  // PixelLab pads characters inside a square frame (Ani occupies 17x48 of a
  // 100x100 frame with 28px of empty space below her feet). Anchoring the frame
  // bottom to a tile centre left actors floating above the floor.
  assert.match(actors, /async function measureAnchor\(/);
  assert.match(actors, /footY: maxY \+ 1/);
  assert.match(actors, /point\.x - anchor\.centerX \* actor\.scale/);
  assert.match(actors, /point\.y \+ actor\.footOffset - anchor\.footY \* actor\.scale/);
  assert.doesNotMatch(actors, /point\.x - width \/ 2/);
  assert.doesNotMatch(actors, /actor\.footOffset - height/);
});

test("a bundled Buddy is adopted only when the user has not chosen a pet", () => {
  const renderer = read("desktop/renderer.js");
  const actors = read("desktop/pocket-buddy-home-actors.js");

  // The built-in pocket-bird has no verified archive, so Home reported an empty
  // pet hash and rendered no Buddy at all.
  assert.match(renderer, /async function ensureActiveBuddyPack\(/);
  assert.match(renderer, /if \(activeId && activeId !== "pocket-bird"\) return;/);
  assert.match(renderer, /entries\.find\(\(entry\) => entry\.kind === "buddy"\)/);
  // Must not hijack a stored human chill preference, which the catalog's
  // selectPet would do by forcing chillActor to "pet".
  assert.doesNotMatch(renderer, /\bselectPet\s*\(/);
  assert.match(renderer, /setActiveBuddy/);
  assert.match(renderer, /restoreChillActor/);

  // And when no verified pet is active, Home says so instead of rendering an
  // empty house that reads as a missing feature.
  assert.match(actors, /No verified Buddy art pack is active/);
});

test("Home prefers a dressed, animated appearance state", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");
  assert.match(actors, /function pickState\(states\)/);
  assert.match(actors, /DRESSED_STATE = \/wearing\|clothed\|dressed\|outfit\|jeans\|shirt\|hoodie\|suit\|uniform\/i/);
  assert.doesNotMatch(actors, /metadata\?\.states\[0\]/, "must not blindly take the first state");

  // Mirror the shipped selection against the real Ani pack's state list: the
  // undressed base carries animations too, so "has animations" alone is not
  // enough to pick the right appearance.
  const DRESSED = /wearing|clothed|dressed|outfit|jeans|shirt|hoodie|suit|uniform/i;
  const pickState = (states) => {
    const animated = states.filter((entry) => Object.keys(entry?.frames?.animations || {}).length > 0);
    const pool = animated.length ? animated : states;
    return pool.find((entry) => DRESSED.test(`${entry?.folder ?? ""} ${entry?.character?.name ?? ""}`)) || pool[0] || null;
  };

  const anims = { ani_idle: {}, ani_walk: {} };
  assert.equal(pickState([
    { folder: "Idle", character: { name: "Idle" }, frames: { animations: anims } },
    { folder: "wearing_jeans_and_bl_copy", character: { name: "wearing jeans and bl (copy)" }, frames: { animations: anims } },
  ]).folder, "wearing_jeans_and_bl_copy");

  // If the only dressed state has no animations, prefer an animated state over
  // a static one rather than freezing the character.
  assert.equal(pickState([
    { folder: "Idle", character: { name: "Idle" }, frames: { animations: anims } },
    { folder: "wearing_jeans_and_bl_copy", character: { name: "wearing jeans" }, frames: { animations: {} } },
  ]).folder, "Idle");
});

test("mirrored animation folders are detected and corrected against the rotation sheet", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");

  assert.match(actors, /async function detectMirroredAnimation\(/);
  assert.match(actors, /maskDifference\(frame, rotation, true\) < maskDifference\(frame, rotation, false\)/);
  // Rotations are ground truth and must never be mirrored.
  assert.match(actors, /return rotations\[direction\] \|\| rotations\.south/);
  assert.match(actors, /mirroredAnimations \? \(MIRRORED_DIRECTION\[direction\] \|\| direction\) : direction/);

  // The mirror map must be a true east/west involution that leaves the
  // viewer-facing and away-facing poses alone.
  const MIRRORED = {
    east: "west", west: "east",
    "south-east": "south-west", "south-west": "south-east",
    "north-east": "north-west", "north-west": "north-east",
    north: "north", south: "south",
  };
  for (const [from, to] of Object.entries(MIRRORED)) {
    assert.equal(MIRRORED[to], from, `${from} -> ${to} must mirror back`);
  }
  assert.equal(MIRRORED.north, "north");
  assert.equal(MIRRORED.south, "south");
});

test("actors survive the item layer being re-rendered by a furniture change", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");
  const app = read("desktop/tinyhouse-home/app.js");

  // app.js renders furniture with replaceChildren, which detaches the actor
  // elements the bridge appended; without a re-attach the player and pets
  // disappear permanently on the first furniture click.
  assert.match(app, /itemLayer\.replaceChildren\(/);
  assert.match(actors, /if \(!actor\.image\.isConnected\) document\.querySelector\("#item-layer"\)\?\.append\(actor\.image\)/);
});

test("the in-game control bar is actually inserted into the Home shell", () => {
  const desktop = read("desktop/pocket-buddy-home-actors.js");
  const web = read("desktop/tinyhouse-home/pocket-buddy-web-actors.js");

  // Both bridges built the panel, wired every button, called sync() — and then
  // never appended it, so Home shipped with no way to switch modes, pet the
  // Buddy, or leave except the Escape key.
  for (const [name, source] of [["desktop", desktop], ["web", web]]) {
    assert.match(source, /shell\.append\(controls\)/, `${name} bridge must insert the control panel`);
    const install = source.slice(source.indexOf("function installControls()"));
    const body = install.slice(0, install.indexOf("\n  }\n") + 5);
    assert.ok(
      body.indexOf("shell.append(controls)") > body.indexOf('controls.id = "pb-home-life-controls"'),
      `${name} bridge must append the panel after building it`,
    );
  }

  // The desktop bar is the only in-game route to these actions.
  for (const label of ["CONTROL HUMAN", "HOUSE CHILL", "PET", "DESKTOP HUMAN", "DESKTOP PET", "LEAVE HOME", "QUIT GAME"]) {
    assert.ok(desktop.includes(`"${label}`), `control bar must offer ${label}`);
  }
});
