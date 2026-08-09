import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const templateSource = readFileSync(new URL("room-templates-core.js", root), "utf8");
const runtimeSource = readFileSync(new URL("room-templates.js", root), "utf8");
const css = readFileSync(new URL("room-templates.css", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");
const manifestSource = readFileSync(new URL("manifest.js", root), "utf8");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(manifestSource, context);
vm.runInContext(templateSource, context);

const core = context.window.TinyHouseRoomTemplatesCore;
assert.equal(core.TEMPLATE_VERSION, 2);
assert.equal(core.templates.length, 6, "the gallery ships six editable showcase recipes");
assert.deepEqual([...core.templates.map((template) => template.id)], [
  "bathroom",
  "kitchen",
  "office",
  "japanese",
  "bedroom",
  "room",
]);
for (const template of core.templates) {
  assert.ok(template.structure.columns >= 4 && template.structure.columns <= 6);
  assert.ok(template.structure.rows >= 4 && template.structure.rows <= 6);
  assert.ok(template.placements.length >= 13, `${template.name} should be meaningfully furnished`);
  assert.equal(core.missingAssetIds(template, [{ id: "nope" }]).length > 0, true);
  assert.deepEqual([...core.missingAssetIds(template, context.window.TINYHOUSE_MANIFEST.assets)], [],
    `${template.name} must resolve every recipe ID in the shipped manifest`);
  for (const placement of template.placements.filter((candidate) => !candidate.wall && !candidate.supportKey)) {
    assert.ok(Math.round(placement.column) >= 0 && Math.round(placement.column) < template.structure.columns,
      `${template.name} ${placement.key} must anchor to an existing floor column`);
    assert.ok(Math.round(placement.row) >= 0 && Math.round(placement.row) < template.structure.rows,
      `${template.name} ${placement.key} must anchor to an existing floor row`);
  }
}

const bedroom = core.templateById("bedroom");
assert.equal(bedroom.structure.columns, 4);
assert.equal(bedroom.structure.rows, 4);
assert.ok(bedroom.placements.some((placement) => placement.assetId === "bedroom-bed-d-4"));
assert.ok(bedroom.placements.some((placement) => placement.assetId === "doors-door-1-beige"));
assert.ok(bedroom.placements.some((placement) => placement.assetId === "ani-big-tv-a"));

const room = core.templateById("room");
assert.equal(room.structure.columns, 6);
assert.equal(room.structure.rows, 5);
assert.ok(room.placements.some((placement) => placement.assetId === "bedroom-bed-a-4"));
assert.ok(room.placements.some((placement) => placement.assetId === "sofa-sofa-3-a-tile"));
assert.ok(room.placements.some((placement) => placement.assetId === "ani-lava-lamp"));
assert.ok(room.placements.some((placement) => placement.assetId === "ani-pc-tower"));

assert.equal(core.matchPreviewFile("Animated Bathroom Showcase.gif"), "bathroom");
assert.equal(core.matchPreviewFile("office_loop.GIF"), "office");
assert.equal(core.matchPreviewFile("yellow-bedroom-showcase.png"), "bedroom");
assert.equal(core.matchPreviewFile("large-living-room.gif"), "room");
assert.equal(core.matchPreviewFile("mystery.png"), null);

assert.match(runtimeSource, /one-step backup/i);
assert.match(runtimeSource, /PLAY ROOM ANIMATIONS/);
assert.match(runtimeSource, /CHOOSE PREVIEW/);
assert.match(runtimeSource, /UUID-named files/i);
assert.match(runtimeSource, /setPreviewFile/);
assert.match(runtimeSource, /TinyHouseWallCore/);
assert.match(runtimeSource, /localStorage\.setItem\(BACKUP_KEY/);
assert.match(runtimeSource, /never uploaded or committed/i);
assert.doesNotMatch(runtimeSource, /unmatched\.slice\(0, available\.length\)/, "unnamed previews must not be assigned to arbitrary rooms");
assert.match(css, /room-template-grid/);
assert.match(css, /room-template-card-actions/);
assert.match(css, /image-rendering:pixelated/);
assert.match(html, /room-templates\.css/);
assert.match(html, /room-templates-core\.js/);
assert.match(html, /room-templates\.js/);
assert.ok(html.indexOf('<script src="room-templates-core.js"></script>') < html.indexOf('<script src="room-templates.js"></script>'));
assert.match(manifestSource, /ani-bath/);
assert.match(manifestSource, /state-washing-machine/);
assert.match(manifestSource, /state-office-normal-table/);
assert.match(manifestSource, /ani-japanese-door/);
assert.match(manifestSource, /bedroom-bed-d-4/);
assert.match(manifestSource, /sofa-sofa-3-a-tile/);

console.log("TinyHouse room-template contract passed: six editable recipes, explicit local previews, valid floor anchors, complete manifest resolution, restore backup, and whole-room animation controls.");