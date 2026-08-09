import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreSource = fs.readFileSync(path.join(here, 'cozy-core.js'), 'utf8');
const cozySource = fs.readFileSync(path.join(here, 'cozy.js'), 'utf8');
const cozyCss = fs.readFileSync(path.join(here, 'cozy.css'), 'utf8');
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');

const sandbox = {
  console,
  Date,
  Math,
  JSON,
  Set,
  structuredClone,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(coreSource, sandbox, { filename: 'cozy-core.js' });
const core = sandbox.TinyRoomCozyCore;
assert.ok(core, 'browser core exposes TinyRoomCozyCore');

const now = new Date('2026-08-06T12:00:00-04:00');
const state = core.createCozyState(now);
assert.equal(state.schemaVersion, core.COZY_SCHEMA_VERSION);
assert.equal(core.formatClock(1500), '25:00');
assert.equal(core.formatClock(3661), '01:01:01');

const task = core.addTask(state, 'Ship the cozy room', now, () => 'task-test');
assert.equal(task.id, 'task-test');
assert.equal(state.tasks.at(-1).text, 'Ship the cozy room');
core.setActiveTask(state, task.id, now);
assert.equal(state.activeTaskId, task.id);
core.toggleTask(state, task.id, now);
assert.equal(state.tasks.at(-1).done, true);
assert.notEqual(state.activeTaskId, task.id);

core.configureTimer(state, 'focus', 60, now.getTime());
core.startTimer(state, now.getTime());
core.reconcileTimer(state, now.getTime() + 30_000);
assert.equal(state.focus.remainingSeconds, 30);
core.pauseTimer(state, now.getTime() + 30_000);
assert.equal(state.focus.state, 'paused');
core.startTimer(state, now.getTime() + 40_000);
core.reconcileTimer(state, now.getTime() + 70_000);
assert.equal(state.focus.state, 'complete');
assert.equal(state.stats.completedFocusSessions, 1);
assert.equal(state.stats.totalFocusSeconds, 60);
assert.equal(state.stats.streakDays, 1);
assert.equal(state.tasks.find((item) => item.id === 'task-first-focus')?.done, true);

core.recordRoomInteraction(state, 'desks-laptop', now);
assert.equal(state.buddyMood, 'focused');
core.recordRoomInteraction(state, 'record-player', now);
assert.equal(state.buddyMood, 'vibing');
assert.equal(state.stats.interactions, 2);

core.setAmbientLevel(state, 'master', 99, now);
assert.equal(state.ambient.master, 1);
core.setTheme(state, 'not-a-theme', now);
assert.equal(state.theme, 'warm');
core.setMemo(state, 'm'.repeat(5000), now);
assert.equal(state.memo.length, core.MAX_MEMO_LENGTH);

const restored = core.importCozyState(core.exportCozyState(state, now), now);
assert.equal(restored.stats.completedFocusSessions, 1);
assert.equal(restored.buddyMood, 'vibing');

assert.match(html, /cozy\.css/);
assert.match(html, /cozy-core\.js/);
assert.match(html, /cozy\.js/);
assert.ok(html.indexOf('app.js') < html.indexOf('cozy-core.js'), 'cozy integration loads after the verified builder');
assert.match(cozySource, /AudioContext/);
assert.match(cozySource, /BroadcastChannel/);
assert.match(cozySource, /pocket-buddy-plus\.tiny-room/);
assert.match(cozySource, /recordRoomInteraction/);
assert.match(cozyCss, /#cozy-panel/);
assert.match(cozyCss, /prefers-reduced-motion/);
assert.doesNotMatch(cozySource, /\bfetch\s*\(/, 'cozy layer does not upload or fetch assets');
assert.doesNotMatch(cozySource, /XMLHttpRequest/);
assert.doesNotMatch(`${cozySource}\n${coreSource}`, /data:image\/(png|gif|webp);base64/i,
  'cozy layer embeds no purchased image bytes');

console.log('PASS test-cozy-contract.mjs');
