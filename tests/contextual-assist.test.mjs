import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("web runtime installs contextual Buddy assist after core initialization", () => {
  const web = read("src/platforms/web/web.js");
  assert.match(web, /installContextualBuddyAssist/);
  assert.match(web, /initializeBuddyLayer\(\)[\s\S]*\.then\(\(api\) => installContextualBuddyAssist\(api\)\)/);
});

test("contextual assist prefills Talk without auto-sending", () => {
  const assist = read("src/buddy/assist.js");
  assert.match(assist, /api\.showTalk\(\)/);
  assert.match(assist, /input\.value = nextPrompt/);
  assert.match(assist, /input\.focus\(\)/);
  assert.match(assist, /MAX_ASSIST_PROMPT_LENGTH = 1200/);
  assert.doesNotMatch(assist, /\.click\(\)/, "assist must never auto-send a prompt");
  assert.doesNotMatch(assist, /brain\.talk/, "assist must leave message submission to the existing Talk UI");
});
