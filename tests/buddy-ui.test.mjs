import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/buddy/layer.js", import.meta.url), "utf8");

test("Pocket Buddy keeps the pet menu compact", () => {
  assert.match(source, /menuItem\("Buddy"/);
  assert.match(source, /menuItem\("Home"/);
  assert.match(source, /menuItem\("My Pets"/);
  assert.match(source, /menuItem\("Chill Mode"/);
  assert.match(source, /menuItem\("Quit Pocket Buddy"/);
  assert.match(source, /window\.PocketBuddyDesktop\?\.quit/);
  assert.match(source, /window\.PocketBuddyDesktop\.quit\(\)/);
  assert.match(source, /first\.textContent = "Pet Buddy"/);
  assert.match(source, /item\.textContent = "Hide Buddy"/);
  assert.match(source, /showBuddySubmenu/);
  assert.match(source, /const leanRoot = \[first, homeItem, chillItem, buddyItem, myPetsItem, menuSeparator\(\), settingsItem, hideItem, quitItem\]/);
  assert.match(source, /content\.replaceChildren\(\.\.\.leanRoot\)/);
  assert.doesNotMatch(source, /menuItem\("Buddies"/);
  assert.doesNotMatch(source, /"pb-pets"/);
});

test("the original Field Guide directly owns Pocket Buddy, My Pets, and OpenPets", () => {
  assert.match(source, /btn\("Pocket Buddy"/);
  assert.match(source, /btn\("My Pets"/);
  assert.match(source, /btn\("OpenPets"/);
  assert.match(source, /content\.replaceChildren\(tabs, pocketPanel, myPanel, openPanel\)/);
  assert.doesNotMatch(source, /Open Buddies & OpenPets/);
  assert.doesNotMatch(source, /"pb-gallery"/);
});

test("OpenPets catalog remains complete but renders incrementally", () => {
  assert.match(source, /for \(const page of Array\.isArray\(index\?\.pages\)/);
  assert.match(source, /const OPENPETS_VISIBLE_STEP = 80/);
  assert.match(source, /visible \+= OPENPETS_VISIBLE_STEP/);
  assert.match(source, /Search every OpenPets pet/);
});

test("remote catalog and package URLs stay on OpenPets HTTPS hosts", () => {
  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /url\.hostname !== "openpets\.dev"/);
  assert.match(source, /url\.hostname\.endsWith\("\.openpets\.dev"\)/);
  assert.match(source, /redirect: "error"/);
});
