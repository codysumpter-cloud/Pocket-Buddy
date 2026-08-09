import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const manifestSource = readFileSync(new URL("manifest.js", root), "utf8");
const coreSource = readFileSync(new URL("rotation-core.js", root), "utf8");
const runtimeSource = readFileSync(new URL("four-way-rotation.js", root), "utf8");
const cameraSource = readFileSync(new URL("diorama-camera.js", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(manifestSource, context);
vm.runInContext(coreSource, context);

const manifest = context.window.TINYHOUSE_MANIFEST;
const core = context.window.TinyHouseRotationCore;
const index = core.buildRotationIndex(manifest.assets);

for (const id of [
  "bedroom-bed-a-4",
  "bedroom-bed-b-4",
  "bedroom-bed-c-4",
  "bedroom-bed-d-4",
  "chairs-gaming-chair-gchair-9-a",
  "sofa-sofa-3-a-tile",
]) {
  assert.equal(index.get(id).count, 4, `${id} should use four authored views`);
}
assert.equal(index.get("desks-desk-1-tile").count, 4, "base + B desk views plus mirrors should provide four directions");
assert.equal(index.get("desks-desk-1-b-tile").count, 4);
assert.equal(index.get("ani-wc-front").count, 4, "front/back WC plus mirrors should provide four directions");
assert.equal(index.get("books-book-small-blue").mode, "sheet");
assert.equal(index.get("books-book-small-blue").count, 4);
assert.equal(index.get("books-book-small-blue").sheet.cellWidth, 32);
assert.equal(index.get("books-book-small-blue").sheet.cellHeight, 32);
assert.equal(index.get("plants-plant-2").count, 2, "single-view art should not fake unavailable back views");

const fourWay = [...index.values()].filter((rotation) => rotation.count === 4).length;
assert.ok(fourWay >= 35, `expected a meaningful four-way catalog, got ${fourWay}`);

assert.match(runtimeSource, /rotationIndex/);
assert.match(runtimeSource, /sheetFrames/);
assert.match(runtimeSource, /House exported · rotations preserved/);
assert.match(runtimeSource, /data-action=\"rotate\"/);
assert.match(runtimeSource, /tinyhouse:rotationchange/);

assert.match(cameraSource, /Math\.exp\(-event\.deltaY/);
assert.match(cameraSource, /pointerType === \"touch\"/);
assert.match(cameraSource, /velocityX \* 7/);
assert.match(cameraSource, /fixed-isometric-2d/);
assert.match(cameraSource, /orbitSupported: false/);
assert.match(cameraSource, /DRAG EMPTY SPACE · WHEEL\/PINCH TO ZOOM/);

assert.match(html, /rotation-core\.js/);
assert.match(html, /four-way-rotation\.js/);
assert.match(html, /diorama-camera\.js/);
assert.ok(html.indexOf('<script src="rotation-core.js"></script>') < html.indexOf('<script src="four-way-rotation.js"></script>'));
assert.ok(html.indexOf('<script src="house-grid.js"></script>') < html.indexOf('<script src="four-way-rotation.js"></script>'));

console.log(`TinyHouse rotation/camera contract passed: ${fourWay} four-way asset entries, authored-sheet slicing, persistent rotations, and Diorama-style 2D navigation.`);