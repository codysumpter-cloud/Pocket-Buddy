import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/platforms/web/pocket-buddy-bootstrap.js", import.meta.url), "utf8");
const dist = readFileSync(new URL("../dist/web/pocket-buddy.embed.js", import.meta.url), "utf8");

test("tracked Pocket Buddy web bootstrap matches its deterministic dist entry", () => {
  assert.equal(dist, source);
});

test("Field Guide stays closable and viewport bounded on mobile", () => {
  assert.match(source, /#birb-field-guide \.birb-window-close/);
  assert.match(source, /aria-label", "Close Field Guide"/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /target\.classList\.contains\("birb-grid-item-locked"\)/);
  assert.match(source, /guide\.remove\(\)/);
  assert.match(source, /max-height: calc\(100dvh - 24px\)/);
});

test("Prismtek layout is bridged into Pocket Bird's original image perch scanner", () => {
  assert.match(source, /\.site-header/);
  assert.match(source, /\.hero-card/);
  assert.match(source, /\.panel/);
  assert.match(source, /\.site-footer/);
  assert.match(source, /data\.pocketBuddyPerchMarker = "1"/);
  assert.match(source, /TRANSPARENT_PIXEL/);
});

test("web feather booster uses the original feather art and never unlocks secret species", () => {
  assert.match(source, /\.\.\/\.\.\/sprites\/feather\.png/);
  assert.match(source, /scheduleFeatherDrop\(true\)/);
  assert.match(source, /randomBetween\(45_000, 90_000\)/);
  assert.match(source, /randomBetween\(120_000, 300_000\)/);
  for (const secret of ["invisible", "pride", "trans", "pidgey"]) {
    assert.doesNotMatch(source, new RegExp(`COMMON_FEATHER_SPECIES[^;]*${secret}`, "s"));
    assert.doesNotMatch(source, new RegExp(`UNCOMMON_FEATHER_SPECIES[^;]*${secret}`, "s"));
  }
});

test("Pocket Buddy Talk uses same-origin site AI with local brain fallback", () => {
  assert.match(source, /fetch\("\/api\/chat"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /const localResult = await originalTalk/);
  assert.match(source, /transport: "local-fallback"/);
  assert.doesNotMatch(source, /NVIDIA_API_KEY/);
});
