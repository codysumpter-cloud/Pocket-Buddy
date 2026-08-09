import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const coreSource = readFileSync(new URL("wall-core.js", root), "utf8");
const runtimeSource = readFileSync(new URL("wall-mount.js", root), "utf8");
const dragSource = readFileSync(new URL("drag-pointer-lock.js", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(coreSource, context);
const wall = context.window.TinyHouseWallCore;

const room = {
  columns: 5,
  rows: 5,
  originX: 650,
  originY: 190,
  tileWidth: 128,
  tileStepX: 64,
  tileStepY: 32,
  floorTopPixelY: 36,
  wallLiftY: -48,
  leftWallShiftX: -32,
  rightWallShiftX: 32,
};

const poster = { id: "poster-poster-1", name: "Poster 1", folder: "Poster", category: "Decor" };
const television = { id: "ani-big-tv-a", name: "Big TV A", folder: "Televisions_TV", category: "Appliances" };
const chair = { id: "chairs-office", name: "Office Chair", folder: "Chairs", category: "Furniture" };
assert.equal(wall.isWallMountable(poster), true);
assert.equal(wall.isWallMountable(television), true);
assert.equal(wall.isWallMountable(chair), false);

const leftTop = wall.wallTopLeft(room, "left", 2);
const leftTarget = wall.nearestWallTarget(
  { x: leftTop.x + 64, y: leftTop.y + 58 },
  poster,
  room,
);
assert.equal(leftTarget.side, "left");
assert.equal(leftTarget.index, 2);

const rightTop = wall.wallTopLeft(room, "right", 3);
const rightTarget = wall.nearestWallTarget(
  { x: rightTop.x + 64, y: rightTop.y + 58 },
  television,
  room,
);
assert.equal(rightTarget.side, "right");
assert.equal(rightTarget.index, 3);

const placement = { supportId: "desk", supportOffsetX: 9, column: 2, row: 2, x: 0, y: 0 };
wall.applyWallPlacement(placement, rightTarget);
assert.equal(placement.supportId, null);
assert.equal(placement.wallSide, "right");
assert.equal(placement.wallIndex, 3);
assert.equal(placement.column, 3);
assert.equal(placement.row, 0);

assert.match(dragSource, /supportAnchor\.y \* 10 \+ 600/);
assert.match(dragSource, /nearestWallTarget\(pointer, asset, playable\.room, anchor\)/);
assert.match(dragSource, /applyWallPlacement\(placement, wallTarget\)/);
assert.match(runtimeSource, /placeSelectedOnWall/);
assert.match(runtimeSource, /restoreWallPlacementsAfterLoad/);
assert.match(runtimeSource, /wall-badge/);
assert.match(runtimeSource, /structureEdgeKey/);
assert.match(runtimeSource, /wallColumn/);
assert.match(coreSource, /structureWallTargets/);
assert.match(coreSource, /edge\.kind !== "wall"/);
assert.match(coreSource, /structureEdgeKey/);

const appIndex = html.indexOf('<script src="app.js"></script>');
const dragCoreIndex = html.indexOf('<script src="drag-core.js"></script>');
const wallCoreIndex = html.indexOf('<script src="wall-core.js"></script>');
const dragRuntimeIndex = html.indexOf('<script src="drag-pointer-lock.js"></script>');
const wallRuntimeIndex = html.indexOf('<script src="wall-mount.js"></script>');
assert.ok(appIndex >= 0 && dragCoreIndex > appIndex);
assert.ok(wallCoreIndex > dragCoreIndex);
assert.ok(dragRuntimeIndex > wallCoreIndex);
assert.ok(wallRuntimeIndex > dragRuntimeIndex);

console.log("TinyHouse wall contract passed: tabletop children stay visible and wall-tagged items persist on real structural walls.");
