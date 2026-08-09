import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const home = read("src/buddy/home.js");
const runtime = read("src/buddy/pet-runtime.js");
const desktopPerches = read("desktop/desktop-perches.js");
const desktopIndex = read("desktop/index.html");
const desktopMain = read("desktop/main.mjs");
const desktopRenderer = read("desktop/renderer.js");
const desktopPreload = read("desktop/preload.cjs");
const canonicalHome = read("desktop/canonical-home.mjs");
const actorBridge = read("desktop/pocket-buddy-home-actors.js");
const webActorBridge = read("desktop/tinyhouse-home/pocket-buddy-web-actors.js");
const donorIndex = read("desktop/tinyhouse-home/index.html");
const donorCommit = read("desktop/tinyhouse-home/POCKETBUDDYPLUS_DONOR_COMMIT").trim();
const donorApp = read("desktop/tinyhouse-home/app.js");
const donorGrid = read("desktop/tinyhouse-home/house-grid-core.js");
const donorLocalAssets = read("desktop/tinyhouse-home/local-assets.js");

test("Windows Home delegates to the exact vendored PocketBuddy+ TinyHouse runtime", () => {
  assert.equal(donorCommit, "6e4a80775f8a7f5b0d243b0a9f50e6653526219b");
  assert.match(home, /PocketBuddyDesktop/);
  assert.match(home, /bridge\.openHome/);
  assert.match(home, /humanScale: 1\.2/);
  assert.doesNotMatch(home, /openZipArchive/);
  assert.doesNotMatch(home, /function diamond\(/);
  assert.doesNotMatch(home, /drawFurniture/);
  assert.doesNotMatch(home, /fallbackHuman/);
});

test("web Home delegates to a same-origin copy of the exact donor instead of drawing another room", () => {
  assert.match(home, /POCKET_BUDDY_WEB_HOME_URL/);
  assert.match(home, /url\.origin !== window\.location\.origin/);
  assert.match(home, /pb-web-home-frame/);
  assert.match(home, /donor: "6e4a80775f8a7f5b0d243b0a9f50e6653526219b"/);
  assert.match(donorIndex, /pocket-buddy-web-actors\.js/);
  assert.match(webActorBridge, /window\.parent\.PocketBuddy/);
  assert.match(webActorBridge, /TINYHOUSE_ASSETS_READY/);
  assert.match(webActorBridge, /runtime\.runtimeFor/);
  assert.match(webActorBridge, /TinyHousePlayable\.cellCenter/);
  assert.match(webActorBridge, /grid\.canTraverse|canTraverse\(from, to\)/);
  assert.match(webActorBridge, /scaleMultiplier/);
  assert.match(webActorBridge, /uiScaleMultiplier/);
  assert.match(webActorBridge, /humanArt, 1\.2/);
  assert.doesNotMatch(webActorBridge, /fallbackHuman|function diamond\(/);
});

test("canonical donor keeps the verified 128x64 isometric geometry", () => {
  assert.match(donorApp, /tileWidth:\s*128/);
  assert.match(donorApp, /tileStepX:\s*64/);
  assert.match(donorApp, /tileStepY:\s*32/);
  assert.match(donorApp, /floorTopPixelY:\s*36/);
  assert.match(donorApp, /wallLiftY:\s*-48/);
  assert.match(donorApp, /leftWallShiftX:\s*-32/);
  assert.match(donorApp, /rightWallShiftX:\s*32/);
  assert.match(donorApp, /geometryChecks/);
  assert.match(donorGrid, /class HouseGrid/);
  assert.match(donorGrid, /canTraverse\(a, b\)/);
  assert.match(donorGrid, /setDoor\(/);
  assert.match(donorGrid, /addConnectedRoom\(/);
});

test("canonical Home server feeds the verified TinyHouse ZIP into the donor loader without extraction or substitution", () => {
  assert.match(canonicalHome, /127\.0\.0\.1/);
  assert.match(canonicalHome, /\/home\/index\.html\?pack=\/pack\//);
  assert.match(canonicalHome, /kind === "environment"/);
  assert.match(canonicalHome, /Home will not substitute fake art/);
  assert.match(canonicalHome, /part\.trim\(\)/);
  assert.match(canonicalHome, /inflateRawSync/);
  assert.match(canonicalHome, /suffixEntries/);
  assert.match(canonicalHome, /segments\.slice\(start\)\.join/);
  assert.match(canonicalHome, /__macosx\//);
  assert.match(canonicalHome, /Private art ZIP path is ambiguous/);
  assert.match(donorLocalAssets, /new URLSearchParams\(location\.search\)\.get\("pack"\)/);
  assert.match(donorLocalAssets, /attachFromBaseUrl/);
  assert.match(donorLocalAssets, /buildSuffixIndex/);
});

test("Ani and Buddy actors use donor world coordinates, wall traversal, and native PixelLab frames", () => {
  assert.match(actorBridge, /TinyHousePlayable\.cellCenter/);
  assert.match(actorBridge, /TinyHouseStructure/);
  assert.match(actorBridge, /grid\.canTraverse|canTraverse\(from, to\)/);
  assert.match(actorBridge, /metadata\.json/);
  assert.match(actorBridge, /ani_idle/);
  assert.match(actorBridge, /ani_walk/);
  assert.match(actorBridge, /humanScale\) \|\| 1\.2/);
  assert.match(actorBridge, /image-rendering:pixelated/);
  assert.doesNotMatch(actorBridge, /fallbackHuman|fillRect\([^)]*human/i);
});

test("Home and custom pets honor Pocket Bird scale settings without shrinking Ani to the old 0.64 value", () => {
  assert.match(runtime, /--birb-scale/);
  assert.match(runtime, /--birb-ui-scale/);
  assert.match(runtime, /scaleMultiplier\(\)/);
  assert.match(home, /petRuntime\.scaleMultiplier\(\)/);
  assert.match(home, /petRuntime\.uiScaleMultiplier\(\)/);
  assert.match(actorBridge, /--pb-home-ui-scale/);
  assert.match(webActorBridge, /--pb-home-ui-scale/);
  assert.doesNotMatch(home, /\.64/);
  assert.doesNotMatch(actorBridge, /humanScale[^\n]*0\.64/);
});

test("selecting an original Field Guide bird relinquishes the custom-pet overlay", () => {
  assert.match(runtime, /library\.setActive\("pocket-bird"\)/);
  assert.match(runtime, /select\("pocket-bird"\)/);
  assert.match(runtime, /base\.style\.opacity = ""/);
  assert.match(runtime, /overlay\.style\.display = "none"/);
});

test("custom pets reuse Pocket Bird affection feedback", () => {
  assert.match(runtime, /pb-pet-heart/);
  assert.match(runtime, /reaction === "heart"/);
  assert.match(runtime, /reaction === "pet"/);
  assert.match(actorBridge, /♥/);
  assert.match(actorBridge, /care\?\.\("pet"\)/);
  assert.match(webActorBridge, /♥/);
  assert.match(webActorBridge, /buddyApi\.care\?\.\("pet"\)/);
});

test("desktop seeds broad invisible perch targets before Pocket Buddy boots", () => {
  assert.match(desktopPerches, /PERCH_COUNT = 9/);
  assert.match(desktopPerches, /width:\$\{PERCH_WIDTH\}px/);
  assert.match(desktopPerches, /filter:opacity\(0\)/);
  assert.match(desktopPerches, /position:fixed/);
  const perchIndex = desktopIndex.indexOf("desktop-perches.js");
  const buddyIndex = desktopIndex.indexOf("birb.embed.js");
  assert.ok(perchIndex >= 0 && buddyIndex > perchIndex, "desktop perches must exist before the Pocket Bird movement engine starts");
});

test("environment art stays out of the pet importer and is preserved for canonical Home", () => {
  assert.match(desktopMain, /item\.kind === "environment" \? "environment"/);
  assert.match(desktopRenderer, /entry\.kind === "environment"/);
  assert.match(desktopRenderer, /skipped \+= 1/);
  assert.match(desktopPreload, /openHome\(options\)/);
  assert.match(desktopMain, /createCanonicalHomeManager/);
  assert.match(desktopMain, /pocket-buddy:open-home/);
  assert.match(desktopMain, /canonicalHome\?\.reclamp/);
});
