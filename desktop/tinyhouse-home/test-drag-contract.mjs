import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const coreSource = readFileSync(new URL("drag-core.js", root), "utf8");
const runtimeSource = readFileSync(new URL("drag-pointer-lock.js", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(coreSource, context);
const core = context.window.TinyHouseDragCore;

const pointerDown = { x: 210, y: 160 };
const originalAnchor = { x: 180, y: 240 };
const offset = core.grabOffset(pointerDown, originalAnchor);
assert.deepEqual({ ...offset }, { x: 30, y: -80 });
const pointerMoved = { x: 510, y: 360 };
const movedAnchor = core.anchorFromPointer(pointerMoved, offset);
assert.deepEqual({ ...movedAnchor }, { x: 480, y: 440 });

const placement = {
  column: 2,
  row: 1,
  x: 320,
  y: 224,
  supportId: "desk-1",
  supportOffsetX: 12,
};
const snapshot = core.snapshotPlacement(placement);
Object.assign(placement, { column: 4, row: 4, x: 700, y: 500, supportId: null, supportOffsetX: 0 });
core.restorePlacement(placement, snapshot);
assert.deepEqual(placement, {
  column: 2,
  row: 1,
  x: 320,
  y: 224,
  supportId: "desk-1",
  supportOffsetX: 12,
});

assert.match(runtimeSource, /grabOffset\(pointer, anchor\)/);
assert.match(runtimeSource, /anchorFromPointer\(pointer, active\.offset\)/);
assert.match(runtimeSource, /stopImmediatePropagation\(\)/);
assert.match(runtimeSource, /worldToNearestFloorCell/);
assert.match(runtimeSource, /pointerup", finalizeDrag, true/);
assert.match(runtimeSource, /pointercancel/);

const appIndex = html.indexOf('<script src="app.js"></script>');
const dragCoreIndex = html.indexOf('<script src="drag-core.js"></script>');
const dragRuntimeIndex = html.indexOf('<script src="drag-pointer-lock.js"></script>');
const cozyIndex = html.indexOf('<script src="cozy-core.js"></script>');
assert.ok(appIndex >= 0 && dragCoreIndex > appIndex);
assert.ok(dragRuntimeIndex > dragCoreIndex);
assert.ok(cozyIndex > dragRuntimeIndex);

console.log("TinyHouse pointer drag contract passed: grab offset stays locked and release snap follows the editable floor grid.");
