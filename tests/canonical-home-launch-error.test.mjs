import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("../src/buddy/home.js", import.meta.url), "utf8");

test("canonical Home failures are visible and never fall back to a fake room", () => {
  assert.match(home, /pb-home-launch-error/);
  assert.match(home, /No substitute room will be rendered/);
  assert.match(home, /No substitute player will be rendered/);
  assert.doesNotMatch(home, /fallbackHuman|drawFurniture|function diamond\(/);
});
