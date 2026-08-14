import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sandbox() {
  const context = { window: {}, globalThis: {} };
  vm.createContext(context);
  vm.runInContext(read("desktop/tinyhouse-home/house-grid-core.js"), context, { filename: "house-grid-core.js" });
  vm.runInContext(read("desktop/tinyhouse-home/actor-motion-core.js"), context, { filename: "actor-motion-core.js" });
  vm.runInContext(read("desktop/tinyhouse-home/pathfinding-core.js"), context, { filename: "pathfinding-core.js" });
  vm.runInContext(read("desktop/tinyhouse-home/affordance-core.js"), context, { filename: "affordance-core.js" });
  return context.window;
}

// ---------------------------------------------------------------- pathing

test("a path follows the floor and each step is a legal traversal", () => {
  const runtime = sandbox();
  const { HouseGrid } = runtime.TinyHouseGridCore;
  const grid = HouseGrid.createDefault({ columns: 4, rows: 4 });

  const path = runtime.PocketBuddyPathfinding.findPath(grid, { column: 0, row: 0 }, { column: 3, row: 3 });
  assert.ok(path.length >= 7, `expected a route across the room, got ${path.length} steps`);
  assert.deepEqual([path[0].column, path[0].row], [0, 0]);
  assert.deepEqual([path.at(-1).column, path.at(-1).row], [3, 3]);

  for (let i = 1; i < path.length; i += 1) {
    assert.equal(grid.canTraverse(path[i - 1], path[i]), true, `illegal step at ${i}`);
  }
});

test("pathfinding routes around a wall instead of through it", () => {
  const runtime = sandbox();
  const { HouseGrid } = runtime.TinyHouseGridCore;
  const { findPath } = runtime.PocketBuddyPathfinding;
  const grid = HouseGrid.createDefault({ columns: 3, rows: 3 });

  const direct = findPath(grid, { column: 0, row: 1 }, { column: 1, row: 1 });
  assert.equal(direct.length, 2, "neighbouring cells should be a two-step path");

  // Wall off the shared edge; the only way across is around it.
  grid.setWall("left", 1, 1);
  const around = findPath(grid, { column: 0, row: 1 }, { column: 1, row: 1 });
  assert.ok(around.length > 2, `expected a detour, got ${around.length} steps`);
  for (let i = 1; i < around.length; i += 1) {
    assert.equal(grid.canTraverse(around[i - 1], around[i]), true);
  }
});

test("a closed door blocks and an open door connects", () => {
  const runtime = sandbox();
  const { HouseGrid } = runtime.TinyHouseGridCore;
  const { isReachable } = runtime.PocketBuddyPathfinding;

  const grid = HouseGrid.createDefault({ columns: 2, rows: 1 });
  grid.setWall("left", 1, 0);
  assert.equal(isReachable(grid, { column: 0, row: 0 }, { column: 1, row: 0 }), false, "a wall must isolate the cells");

  grid.setDoor("left", 1, 0, "door", false);
  assert.equal(isReachable(grid, { column: 0, row: 0 }, { column: 1, row: 0 }), false, "a closed door must stay blocked");

  grid.setDoor("left", 1, 0, "door", true);
  assert.equal(isReachable(grid, { column: 0, row: 0 }, { column: 1, row: 0 }), true, "an open door must connect");
});

test("unreachable and off-floor goals fail closed instead of hanging", () => {
  const runtime = sandbox();
  const { HouseGrid } = runtime.TinyHouseGridCore;
  const { findPath } = runtime.PocketBuddyPathfinding;
  const grid = HouseGrid.createDefault({ columns: 2, rows: 2 });

  // Compare lengths, not whole arrays: values cross a vm realm boundary so
  // their prototype is not this realm's Array.prototype.
  assert.equal(findPath(grid, { column: 0, row: 0 }, { column: 40, row: 40 }).length, 0);
  assert.equal(findPath(grid, { column: -9, row: -9 }, { column: 0, row: 0 }).length, 0);
  const same = findPath(grid, { column: 1, row: 1 }, { column: 1, row: 1 });
  assert.equal(same.length, 1);
});

test("walking past a waypoint drops it rather than turning back", () => {
  const runtime = sandbox();
  const { advancePath } = runtime.PocketBuddyPathfinding;
  const path = [{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 0 }];

  // Standing on a node means that node is reached, so the next one becomes the
  // target; only a partly-travelled leg keeps its current waypoint.
  assert.equal(advancePath(path, { column: 0, row: 0 }).length, 2, "the node underfoot is consumed");
  assert.equal(advancePath(path, { column: 0.5, row: 0 }).length, 3, "mid-leg keeps its target");
  const trimmed = advancePath(path, { column: 1.05, row: 0 });
  assert.deepEqual([trimmed[0].column, trimmed[0].row], [2, 0], "passed nodes are dropped");
  assert.equal(advancePath([], { column: 0, row: 0 }).length, 0);
});

// ------------------------------------------------------------ affordances

test("furniture advertises interactions derived from its own art", () => {
  const runtime = sandbox();
  const { affordancesFor } = runtime.PocketBuddyAffordances;

  assert.equal(affordancesFor({ name: "Bed B 4", category: "Furniture" })[0].action, "Sleep");
  assert.equal(affordancesFor({ name: "Bed B 4" })[0].need, "energy");
  assert.equal(affordancesFor({ name: "Big TV A", category: "Appliances" })[0].need, "fun");
  assert.equal(affordancesFor({ name: "Refrigerator" })[0].need, "hunger");
  assert.equal(affordancesFor({ name: "Toilet" })[0].need, "hygiene");
  // Pure decoration offers nothing, and must not invent a need.
  assert.equal(affordancesFor({ name: "Poster C", category: "Decor" }).length, 0);
});

test("an actor wants what it lacks and ignores what it does not", () => {
  const runtime = sandbox();
  const { score, worstNeed } = runtime.PocketBuddyAffordances;
  const bed = { action: "Sleep", need: "energy", gain: 0.55, seconds: 14 };

  const tired = { energy: 0.1, hunger: 1, hygiene: 1, fun: 1, social: 1 };
  const rested = { energy: 1, hunger: 1, hygiene: 1, fun: 1, social: 1 };
  assert.ok(score(bed, tired) > 0, "a tired actor should want the bed");
  assert.equal(score(bed, rested), 0, "a rested actor should ignore the bed");

  assert.equal(worstNeed(tired).need, "energy");
  assert.equal(worstNeed(rested), null, "nothing to do when everything is comfortable");

  // Travel discounts an otherwise equal option.
  assert.ok(score(bed, tired, 0) > score(bed, tired, 12), "distance should reduce appeal");
});

test("the actor picks the most useful reachable interaction", () => {
  const runtime = sandbox();
  const { chooseAction, affordancesFor } = runtime.PocketBuddyAffordances;
  const needs = { energy: 0.15, hunger: 0.9, hygiene: 1, fun: 0.95, social: 1 };

  const candidates = [
    { id: "tv", affordance: affordancesFor({ name: "Big TV A" })[0], distance: 1 },
    { id: "bed", affordance: affordancesFor({ name: "Bed A 4" })[0], distance: 4 },
    { id: "fridge", affordance: affordancesFor({ name: "Refrigerator" })[0], distance: 1 },
  ];

  const chosen = chooseAction(candidates, needs);
  assert.equal(chosen.id, "bed", "exhaustion should outrank a nearby distraction");

  const comfortable = { energy: 1, hunger: 1, hygiene: 1, fun: 1, social: 1 };
  assert.equal(chooseAction(candidates, comfortable), null, "no need means no action");
});

test("needs fall over time and interactions restore them", () => {
  const runtime = sandbox();
  const { decay, satisfy, affordancesFor } = runtime.PocketBuddyAffordances;

  const start = { energy: 1, hunger: 1, hygiene: 1, fun: 1, social: 1 };
  const later = decay(start, 60);
  assert.ok(later.energy < start.energy && later.hunger < start.hunger, "needs must fall while time passes");
  assert.ok(later.energy >= 0, "needs must never go negative");

  const bed = affordancesFor({ name: "Bed A 4" })[0];
  const drained = { ...start, energy: 0.1 };
  const napped = satisfy(drained, bed, bed.seconds);
  assert.ok(napped.energy > drained.energy, "sleeping must restore energy");
  assert.ok(napped.energy <= 1, "needs must never exceed full");
  assert.equal(napped.hunger, drained.hunger, "an interaction must only touch its own need");
});

// ------------------------------------------------------------- integration

test("arriving at the last waypoint starts the interaction", () => {
  const runtime = sandbox();
  const { advancePath } = runtime.PocketBuddyPathfinding;
  const actors = read("desktop/pocket-buddy-home-actors.js");

  // advancePath always keeps a waypoint to steer at, so an empty path is not
  // how arrival shows up. Relying on that left the actor standing at the
  // furniture forever while its needs kept draining.
  const path = [{ column: 2, row: 2 }];
  assert.equal(advancePath(path, { column: 2.02, row: 2.01 }).length, 1, "the final waypoint is retained");

  assert.match(actors, /const arrived = !next/);
  assert.match(actors, /actor\.plan\.path\.length === 1/);
  assert.match(actors, /actor\.busyUntil = now \+ actor\.plan\.affordance\.seconds \* 1000/);
});

test("autonomy is needs-driven and falls back to wandering", () => {
  const actors = read("desktop/pocket-buddy-home-actors.js");
  const index = read("desktop/tinyhouse-home/index.html");

  assert.match(actors, /function liveAutonomously\(/);
  assert.match(actors, /function furnitureCandidates\(/);
  // Routing uses the canonical graph, never a private copy of the topology.
  assert.match(actors, /pathfinding\.findPath\(grid, actor\.cell, chosen\.cell\)/);
  // An empty or unreachable house still feels alive.
  assert.match(actors, /return moveAutonomous\(actor, now, dt, speed\)/);
  // Movement between waypoints stays continuous.
  assert.match(actors, /motion\.moveToward\(grid, actor\.cell, next, dt, speed, 4\)/);

  assert.match(index, /pathfinding-core\.js/);
  assert.match(index, /affordance-core\.js/);
});

test("needs are persisted and restored defensively", () => {
  // NOTE: this verifies the save/restore path only. It does NOT yet survive a
  // relaunch, because canonical-home serves Home from http://127.0.0.1:<random
  // port> and localStorage is origin-scoped, so every launch starts with empty
  // storage. Verified by planting values and relaunching: they did not come
  // back. House structure, furniture and Cozy state have the same problem and
  // are silently lost on restart. Fixing that needs a stable Home origin.
  const actors = read("desktop/pocket-buddy-home-actors.js");

  assert.match(actors, /NEEDS_KEY = "pocket-buddy\.home\.needs\.v1"/);
  assert.match(actors, /needs: loadNeeds\(id, \{/, "actors must restore, not always start fresh");
  assert.match(actors, /saveNeeds\(now\)/, "the loop must persist them");
  // Throttled, so the game loop is not writing storage every frame.
  assert.match(actors, /if \(now - lastNeedsSaveAt < NEEDS_SAVE_MS\) return;/);
  // A blocked or full store must never break play.
  assert.match(actors, /catch \{ \/\* a full or blocked store must never break the game loop \*\/ \}/);
  // Restored values are clamped, so hand-edited storage cannot corrupt the sim.
  assert.match(actors, /restored\[name\] = clamp\(value, 0, 1\)/);
});
