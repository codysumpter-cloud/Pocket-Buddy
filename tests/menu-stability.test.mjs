import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("menu rerenders clear stale Pocket Buddy augmentation state", () => {
  const source = read("src/menu.js");
  assert.match(source, /function resetExtensionMenuState\(menu\)/);
  assert.match(source, /key\.startsWith\("pocketBuddy"\)/);
  assert.match(source, /resetExtensionMenuState\(menu\);[\s\S]*content\.replaceChildren\(\)/);
  assert.match(source, /birb-menu-items-changed/);
});

test("every menu row receives a stable icon slot including Buddy-injected rows", () => {
  const source = read("src/menu.js");
  assert.match(source, /function fallbackIconForLabel\(label\)/);
  for (const label of ["home", "chill", "my pets", "buddy", "talk", "care", "rename", "scale", "sound", "theme"]) {
    assert.equal(source.toLowerCase().includes(label), true, `${label} should have a menu icon mapping`);
  }
  assert.match(source, /MutationObserver\(\(\) => ensureMenuIcons\(content\)\)/);
  assert.match(source, /iconObserver\.observe\(content, \{ childList: true, subtree: true, characterData: true \}\)/);
});
