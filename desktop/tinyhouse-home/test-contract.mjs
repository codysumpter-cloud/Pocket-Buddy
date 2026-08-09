import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("./", import.meta.url);
const app = readFileSync(new URL("app.js", root), "utf8");
const loader = readFileSync(new URL("local-assets.js", root), "utf8");
const recipesSource = readFileSync(new URL("generated-recipes.js", root), "utf8");
const html = readFileSync(new URL("index.html", root), "utf8");
const styles = readFileSync(new URL("styles.css", root), "utf8");
const manifestSource = readFileSync(new URL("manifest.js", root), "utf8");

const context = { window: {} };
vm.createContext(context);
vm.runInContext(manifestSource, context);
vm.runInContext(recipesSource, context);
const manifest = context.window.TINYHOUSE_MANIFEST;

assert.equal(manifest.version, 3);
assert.equal(manifest.count, 564);
assert.equal(manifest.animationGroups, 33);
assert.equal(Object.keys(context.window.TINYHOUSE_GENERATED_RECIPES).length, 35);
assert.ok(manifest.assets.length >= 500);
assert.ok(manifest.assets.filter((asset) => asset.animated && asset.frames?.length > 1).length >= 30);
assert.ok(manifest.assets.some((asset) => asset.tabletop));
assert.ok(manifest.assets.some((asset) => asset.supportType));

assert.match(app, /tileStepX:\s*64/);
assert.match(app, /tileStepY:\s*32/);
assert.match(app, /wallLiftY:\s*-48/);
assert.match(app, /leftWallShiftX:\s*-32/);
assert.match(app, /rightWallShiftX:\s*32/);
assert.match(app, /placementSubdivisions:\s*2/);
assert.match(app, /placementTolerance:\s*118/);
assert.match(app, /placeSelectedOnSupport/);
assert.match(app, /attachPlacementToSupport/);
assert.match(app, /tickAnimations/);
assert.match(app, /await window\.TINYHOUSE_ASSETS_READY/);
assert.match(app, /asset-name/);
assert.match(app, /catalog-count/);
assert.match(app, /selection-name/);

assert.match(html, /id="top-hud"/);
assert.match(html, /id="catalog-count"/);
assert.match(html, /id="asset-pack-summary"/);
assert.match(html, /id="selection-name"/);
assert.match(html, /id="selection-meta"/);
assert.match(html, /class="category-tabs"/);
assert.match(html, /generated-recipes\.js/);
assert.match(html, /local-assets\.js/);
assert.match(styles, /grid-template-columns:repeat\(3,1fr\)/);
assert.match(styles, /\.asset-card \.asset-name/);
assert.match(styles, /\.inspector-panel/);
assert.match(styles, /\.camera-dock/);

assert.match(loader, /webkitRelativePath/);
assert.match(loader, /URL\.createObjectURL/);
assert.match(loader, /frameDataUrls/);
assert.match(loader, /renderRecipe/);
assert.match(loader, /webkitdirectory/);
assert.match(loader, /\.map\(\(segment\) => segment\.trim\(\)\)/,
  "loader must tolerate accidental leading or trailing whitespace in a manifest path segment");
assert.doesNotMatch(loader, /rejectReady\(error\)/,
  "a wrong folder selection must remain retryable in the same page");
assert.doesNotMatch(manifestSource, /data:image\//, "public manifest must not embed purchased image bytes");
assert.doesNotMatch(html + app + loader + recipesSource + styles, /data:image\//, "public runtime must not embed purchased image bytes");

console.log(`TinyHouse local game contract passed: ${manifest.count} objects, ${manifest.animationGroups} animation groups, refreshed pixel UI.`);
