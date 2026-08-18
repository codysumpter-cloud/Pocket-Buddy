import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(new URL("../src/platforms/web/prismtek-web-runtime.js", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/platforms/web/web.js", import.meta.url), "utf8");

test("Prismtek web menu preserves the original Field Guide and Wardrobe action nodes", () => {
  assert.match(runtime, /PRESERVED_MENU_LABELS = \["Field Guide", "Wardrobe", "Sticky Note"\]/);
  assert.match(runtime, /Capture the actual base nodes before Pocket Buddy's lean menu detaches them/);
  assert.match(runtime, /content\.insertBefore\(item, anchor\)/);
  assert.match(runtime, /firstLabel === "Go Back" \|\| menu\.dataset\.pocketBuddySubmenu/);
});

test("Prismtek website uses stable page-relative perch rails instead of fake image markers", () => {
  assert.match(runtime, /data-pocket-buddy-stable-perch/);
  assert.match(runtime, /position: "absolute"/);
  assert.match(runtime, /\.site-header/);
  assert.match(runtime, /\.panel/);
  assert.match(runtime, /\.site-footer/);
  assert.match(runtime, /img:not\(\[data-pocket-buddy-perch-marker\]\)/);
});

test("first website perch does not use application startup teleport", () => {
  assert.match(runtime, /initialPerchCheckSuppressed/);
  assert.match(runtime, /Suppress only that first website target selection/);
  assert.match(runtime, /return false;/);
  assert.match(entry, /initializeApplication\(new PrismtekWebContext\(\)\)/);
});

test("web runtime guards install before Buddy menu augmentation", () => {
  const guardIndex = entry.indexOf("installPrismtekWebRuntimeGuards();");
  const appIndex = entry.indexOf("initializeApplication(new PrismtekWebContext());");
  const buddyIndex = entry.indexOf("initializeBuddyLayer()");
  assert.ok(guardIndex >= 0 && appIndex > guardIndex && buddyIndex > appIndex);
});
