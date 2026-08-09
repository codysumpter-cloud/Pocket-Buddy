(() => {
  "use strict";

const COZY_SCHEMA_VERSION = 'pocket-buddy-plus-tinyhouse-cozy-v1';
const DEFAULT_FOCUS_SECONDS = 25 * 60;
const DEFAULT_BREAK_SECONDS = 5 * 60;
const MAX_TASKS = 50;
const MAX_MEMO_LENGTH = 4000;

const THEMES = new Set(['warm', 'rainy-night', 'sunrise', 'sunset', 'forest']);
const TIMER_STATES = new Set(['stopped', 'running', 'paused', 'complete']);

function createCozyState(now = new Date()) {
  return {
    schemaVersion: COZY_SCHEMA_VERSION,
    panelOpen: false,
    compact: false,
    theme: 'warm',
    buddyMood: 'cozy',
    activeTaskId: 'task-first-focus',
    tasks: [
      {
        id: 'task-first-focus',
        text: 'Finish one focus session',
        done: false,
        createdAt: now.toISOString(),
      },
      {
        id: 'task-room-pass',
        text: 'Add one cozy detail to the room',
        done: false,
        createdAt: now.toISOString(),
      },
    ],
    memo: 'Tiny steps count. Make the room yours.',
    focus: {
      mode: 'focus',
      state: 'stopped',
      durationSeconds: DEFAULT_FOCUS_SECONDS,
      remainingSeconds: DEFAULT_FOCUS_SECONDS,
      endsAt: null,
      startedAt: null,
      pausedAt: null,
    },
    ambient: {
      enabled: false,
      master: 0.32,
      rain: 0.36,
      vinyl: 0.18,
      chords: 0.22,
    },
    stats: {
      completedFocusSessions: 0,
      completedBreaks: 0,
      totalFocusSeconds: 0,
      interactions: 0,
      streakDays: 0,
      lastFocusDate: null,
    },
    updatedAt: now.toISOString(),
  };
}

function sanitizeCozyState(input, now = new Date()) {
  const state = createCozyState(now);
  if (!input || typeof input !== 'object') return state;

  state.panelOpen = Boolean(input.panelOpen);
  state.compact = Boolean(input.compact);
  state.theme = THEMES.has(input.theme) ? input.theme : state.theme;
  state.buddyMood = safeText(input.buddyMood, 24, state.buddyMood);

  if (Array.isArray(input.tasks)) {
    state.tasks = input.tasks
      .slice(0, MAX_TASKS)
      .map((task, index) => ({
        id: safeText(task?.id, 96, `task-${index + 1}`),
        text: safeText(task?.text, 180, '').trim(),
        done: Boolean(task?.done),
        createdAt: validIso(task?.createdAt) ?? now.toISOString(),
      }))
      .filter((task) => task.text.length > 0);
  }

  state.activeTaskId = state.tasks.some(
    (task) => task.id === input.activeTaskId && !task.done,
  )
    ? input.activeTaskId
    : state.tasks.find((task) => !task.done)?.id ?? null;

  state.memo = safeText(input.memo, MAX_MEMO_LENGTH, state.memo);

  if (input.focus && typeof input.focus === 'object') {
    const mode = input.focus.mode === 'break' ? 'break' : 'focus';
    const fallbackDuration = mode === 'break' ? DEFAULT_BREAK_SECONDS : DEFAULT_FOCUS_SECONDS;
    const durationSeconds = clampNumber(input.focus.durationSeconds, 60, 4 * 60 * 60, fallbackDuration);
    state.focus = {
      mode,
      state: TIMER_STATES.has(input.focus.state) ? input.focus.state : 'stopped',
      durationSeconds,
      remainingSeconds: clampNumber(input.focus.remainingSeconds, 0, durationSeconds, durationSeconds),
      endsAt: nullableFinite(input.focus.endsAt),
      startedAt: nullableFinite(input.focus.startedAt),
      pausedAt: nullableFinite(input.focus.pausedAt),
    };
  }

  if (input.ambient && typeof input.ambient === 'object') {
    state.ambient = {
      enabled: Boolean(input.ambient.enabled),
      master: clampNumber(input.ambient.master, 0, 1, state.ambient.master),
      rain: clampNumber(input.ambient.rain, 0, 1, state.ambient.rain),
      vinyl: clampNumber(input.ambient.vinyl, 0, 1, state.ambient.vinyl),
      chords: clampNumber(input.ambient.chords, 0, 1, state.ambient.chords),
    };
  }

  if (input.stats && typeof input.stats === 'object') {
    for (const key of [
      'completedFocusSessions',
      'completedBreaks',
      'totalFocusSeconds',
      'interactions',
      'streakDays',
    ]) {
      state.stats[key] = Math.max(0, Math.floor(Number(input.stats[key]) || 0));
    }
    state.stats.lastFocusDate = /^\d{4}-\d{2}-\d{2}$/.test(input.stats.lastFocusDate ?? '')
      ? input.stats.lastFocusDate
      : null;
  }

  state.schemaVersion = COZY_SCHEMA_VERSION;
  state.updatedAt = now.toISOString();
  return reconcileTimer(state, now.getTime());
}

function addTask(state, text, now = new Date(), idFactory = defaultIdFactory) {
  const clean = safeText(text, 180, '').trim();
  if (!clean || state.tasks.length >= MAX_TASKS) return null;
  const task = {
    id: idFactory('task', now),
    text: clean,
    done: false,
    createdAt: now.toISOString(),
  };
  state.tasks.push(task);
  state.activeTaskId ||= task.id;
  touch(state, now);
  return task;
}

function toggleTask(state, taskId, now = new Date()) {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return false;
  task.done = !task.done;
  if (task.done && state.activeTaskId === task.id) {
    state.activeTaskId = state.tasks.find((candidate) => !candidate.done)?.id ?? null;
  }
  if (!task.done && !state.activeTaskId) state.activeTaskId = task.id;
  touch(state, now);
  return true;
}

function removeTask(state, taskId, now = new Date()) {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  if (state.tasks.length === before) return false;
  if (state.activeTaskId === taskId) {
    state.activeTaskId = state.tasks.find((task) => !task.done)?.id ?? null;
  }
  touch(state, now);
  return true;
}

function setActiveTask(state, taskId, now = new Date()) {
  state.activeTaskId = state.tasks.some((task) => task.id === taskId && !task.done)
    ? taskId
    : null;
  touch(state, now);
  return state.activeTaskId;
}

function setMemo(state, memo, now = new Date()) {
  state.memo = safeText(memo, MAX_MEMO_LENGTH, '');
  touch(state, now);
  return state.memo;
}

function setTheme(state, theme, now = new Date()) {
  state.theme = THEMES.has(theme) ? theme : 'warm';
  touch(state, now);
  return state.theme;
}

function setAmbientLevel(state, channel, value, now = new Date()) {
  if (!['master', 'rain', 'vinyl', 'chords'].includes(channel)) return false;
  state.ambient[channel] = clampNumber(value, 0, 1, state.ambient[channel]);
  touch(state, now);
  return true;
}

function setAmbientEnabled(state, enabled, now = new Date()) {
  state.ambient.enabled = Boolean(enabled);
  touch(state, now);
  return state.ambient.enabled;
}

function configureTimer(state, mode, seconds, nowMs = Date.now()) {
  const normalizedMode = mode === 'break' ? 'break' : 'focus';
  const fallback = normalizedMode === 'break' ? DEFAULT_BREAK_SECONDS : DEFAULT_FOCUS_SECONDS;
  const durationSeconds = clampNumber(seconds, 60, 4 * 60 * 60, fallback);
  state.focus = {
    mode: normalizedMode,
    state: 'stopped',
    durationSeconds,
    remainingSeconds: durationSeconds,
    endsAt: null,
    startedAt: null,
    pausedAt: null,
  };
  touch(state, new Date(nowMs));
  return state.focus;
}

function startTimer(state, nowMs = Date.now()) {
  if (state.focus.state === 'running') return state.focus;
  const remainingSeconds = state.focus.state === 'complete' || state.focus.remainingSeconds <= 0
    ? state.focus.durationSeconds
    : state.focus.remainingSeconds;
  state.focus.state = 'running';
  state.focus.remainingSeconds = remainingSeconds;
  state.focus.startedAt ??= nowMs;
  state.focus.endsAt = nowMs + remainingSeconds * 1000;
  state.focus.pausedAt = null;
  touch(state, new Date(nowMs));
  return state.focus;
}

function pauseTimer(state, nowMs = Date.now()) {
  if (state.focus.state !== 'running' || !Number.isFinite(state.focus.endsAt)) return state.focus;
  state.focus.remainingSeconds = Math.max(0, Math.ceil((state.focus.endsAt - nowMs) / 1000));
  state.focus.state = 'paused';
  state.focus.endsAt = null;
  state.focus.pausedAt = nowMs;
  touch(state, new Date(nowMs));
  return state.focus;
}

function resetTimer(state, nowMs = Date.now()) {
  state.focus.state = 'stopped';
  state.focus.remainingSeconds = state.focus.durationSeconds;
  state.focus.endsAt = null;
  state.focus.startedAt = null;
  state.focus.pausedAt = null;
  touch(state, new Date(nowMs));
  return state.focus;
}

function reconcileTimer(state, nowMs = Date.now()) {
  if (state.focus.state !== 'running' || !Number.isFinite(state.focus.endsAt)) return state;
  state.focus.remainingSeconds = Math.max(0, Math.ceil((state.focus.endsAt - nowMs) / 1000));
  if (state.focus.remainingSeconds === 0) completeTimer(state, nowMs);
  return state;
}

function completeTimer(state, nowMs = Date.now()) {
  if (state.focus.state === 'complete') return false;
  state.focus.state = 'complete';
  state.focus.remainingSeconds = 0;
  state.focus.endsAt = null;
  state.focus.pausedAt = null;

  if (state.focus.mode === 'focus') {
    state.stats.completedFocusSessions += 1;
    state.stats.totalFocusSeconds += state.focus.durationSeconds;
    updateStreak(state.stats, new Date(nowMs));
    const firstFocus = state.tasks.find((task) => task.id === 'task-first-focus');
    if (firstFocus) firstFocus.done = true;
    if (state.activeTaskId === firstFocus?.id) {
      state.activeTaskId = state.tasks.find((task) => !task.done)?.id ?? null;
    }
    state.buddyMood = 'proud';
  } else {
    state.stats.completedBreaks += 1;
    state.buddyMood = 'rested';
  }

  touch(state, new Date(nowMs));
  return true;
}

function recordRoomInteraction(state, kind = 'room', now = new Date()) {
  state.stats.interactions += 1;
  const normalized = safeText(kind, 48, 'room').toLowerCase();
  if (/bed|sofa|chair/.test(normalized)) state.buddyMood = 'rested';
  else if (/desk|computer|laptop|book/.test(normalized)) state.buddyMood = 'focused';
  else if (/music|record|radio|speaker|television|tv/.test(normalized)) state.buddyMood = 'vibing';
  else if (/plant|flower/.test(normalized)) state.buddyMood = 'peaceful';
  else state.buddyMood = 'curious';
  touch(state, now);
  return state.buddyMood;
}

function timerProgress(state) {
  if (!state.focus.durationSeconds) return 0;
  return Math.min(1, Math.max(0,
    1 - state.focus.remainingSeconds / state.focus.durationSeconds,
  ));
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.ceil(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function exportCozyState(state, now = new Date()) {
  return JSON.stringify({
    ...state,
    schemaVersion: COZY_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
  }, null, 2);
}

function importCozyState(text, now = new Date()) {
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch {
    throw new Error('That cozy room file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('That cozy room file does not contain a state object.');
  }
  return sanitizeCozyState(parsed, now);
}

function publicSnapshot(state) {
  const activeTask = state.tasks.find((task) => task.id === state.activeTaskId) ?? null;
  return {
    schemaVersion: COZY_SCHEMA_VERSION,
    theme: state.theme,
    buddyMood: state.buddyMood,
    activeTask: activeTask ? { id: activeTask.id, text: activeTask.text } : null,
    focus: {
      mode: state.focus.mode,
      state: state.focus.state,
      remainingSeconds: state.focus.remainingSeconds,
      durationSeconds: state.focus.durationSeconds,
    },
    ambientEnabled: state.ambient.enabled,
    stats: { ...state.stats },
  };
}

function updateStreak(stats, now) {
  const today = localDateKey(now);
  if (stats.lastFocusDate === today) return;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  stats.streakDays = stats.lastFocusDate === localDateKey(yesterday)
    ? stats.streakDays + 1
    : 1;
  stats.lastFocusDate = today;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function safeText(value, maxLength, fallback) {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function validIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function nullableFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function defaultIdFactory(prefix, now) {
  return `${prefix}-${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`;
}

function touch(state, now) {
  state.updatedAt = now.toISOString();
}


  globalThis.TinyRoomCozyCore = Object.freeze({
    COZY_SCHEMA_VERSION,
    DEFAULT_FOCUS_SECONDS,
    DEFAULT_BREAK_SECONDS,
    MAX_TASKS,
    MAX_MEMO_LENGTH,
    createCozyState,
    sanitizeCozyState,
    addTask,
    toggleTask,
    removeTask,
    setActiveTask,
    setMemo,
    setTheme,
    setAmbientLevel,
    setAmbientEnabled,
    configureTimer,
    startTimer,
    pauseTimer,
    resetTimer,
    reconcileTimer,
    completeTimer,
    recordRoomInteraction,
    timerProgress,
    formatClock,
    exportCozyState,
    importCozyState,
    publicSnapshot,
  });
})();
