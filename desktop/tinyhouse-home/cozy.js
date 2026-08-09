(() => {
  "use strict";

  const core = globalThis.TinyRoomCozyCore;
  if (!core) {
    console.error('[TinyRoomCozy] cozy-core.js did not load.');
    return;
  }

  const STORAGE_KEY = 'pocket-buddy-plus-tinyhouse-cozy-v1';
  const CHANNEL_NAME = 'pocket-buddy-plus-tiny-room';
  const SOURCE = 'pocket-buddy-plus.tiny-room';
  const HOST_SOURCE = 'pocket-buddy-plus.host';
  const viewport = document.querySelector('#world-viewport');
  const commandRow = document.querySelector('#window-buttons');
  const toast = document.querySelector('#toast');
  if (!viewport || !commandRow) return;

  let state = loadState();
  let saveTimer = 0;
  let statusTimer = 0;
  let channel = null;

  try {
    if ('BroadcastChannel' in globalThis) channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (error) {
    console.warn('[TinyRoomCozy] BroadcastChannel unavailable:', error);
  }

  class AmbientEngine {
    constructor() {
      this.context = null;
      this.master = null;
      this.rainGain = null;
      this.vinylGain = null;
      this.chordGain = null;
      this.sources = [];
      this.chordTimer = 0;
      this.chordIndex = 0;
      this.chords = [
        [130.81, 164.81, 196.0, 246.94],
        [110.0, 146.83, 174.61, 220.0],
        [98.0, 130.81, 164.81, 196.0],
        [116.54, 146.83, 174.61, 233.08],
      ];
    }

    async setEnabled(enabled) {
      if (!enabled) {
        this.stop();
        return;
      }
      await this.start();
    }

    async start() {
      if (this.context) {
        if (this.context.state === 'suspended') await this.context.resume();
        this.updateLevels();
        return;
      }
      const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio is unavailable in this browser.');
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.rainGain = this.context.createGain();
      this.vinylGain = this.context.createGain();
      this.chordGain = this.context.createGain();
      this.master.connect(this.context.destination);
      this.rainGain.connect(this.master);
      this.vinylGain.connect(this.master);
      this.chordGain.connect(this.master);
      this.createRain();
      this.createVinyl();
      this.createChordPad();
      this.updateLevels();
      if (this.context.state === 'suspended') await this.context.resume();
    }

    createNoiseBuffer(seconds, color = 'white') {
      const length = Math.max(1, Math.floor(this.context.sampleRate * seconds));
      const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let brown = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        if (color === 'brown') {
          brown = (brown + 0.02 * white) / 1.02;
          data[index] = brown * 3.5;
        } else {
          data[index] = white;
        }
      }
      return buffer;
    }

    createRain() {
      const source = this.context.createBufferSource();
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3200;
      filter.Q.value = 0.3;
      source.buffer = this.createNoiseBuffer(4, 'brown');
      source.loop = true;
      source.connect(filter).connect(this.rainGain);
      source.start();
      this.sources.push(source);
    }

    createVinyl() {
      const source = this.context.createBufferSource();
      const highpass = this.context.createBiquadFilter();
      const lowpass = this.context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 1500;
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 6800;
      source.buffer = this.createNoiseBuffer(2, 'white');
      source.loop = true;
      source.connect(highpass).connect(lowpass).connect(this.vinylGain);
      source.start();
      this.sources.push(source);
    }

    createChordPad() {
      this.oscillators = this.chords[0].map((frequency, index) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = index % 2 === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        gain.gain.value = index === 0 ? 0.12 : 0.07;
        oscillator.connect(gain).connect(this.chordGain);
        oscillator.start();
        this.sources.push(oscillator);
        return oscillator;
      });
      this.chordTimer = globalThis.setInterval(() => this.advanceChord(), 9000);
    }

    advanceChord() {
      if (!this.context || !this.oscillators) return;
      this.chordIndex = (this.chordIndex + 1) % this.chords.length;
      const at = this.context.currentTime + 0.15;
      this.oscillators.forEach((oscillator, index) => {
        oscillator.frequency.cancelScheduledValues(at);
        oscillator.frequency.linearRampToValueAtTime(this.chords[this.chordIndex][index], at + 2.4);
      });
    }

    updateLevels() {
      if (!this.context) return;
      const at = this.context.currentTime;
      const set = (gain, value) => gain.gain.setTargetAtTime(Math.max(0.0001, value), at, 0.06);
      set(this.master, state.ambient.enabled ? state.ambient.master : 0.0001);
      set(this.rainGain, state.ambient.rain * 0.48);
      set(this.vinylGain, state.ambient.vinyl * 0.12);
      set(this.chordGain, state.ambient.chords * 0.22);
    }

    stop() {
      globalThis.clearInterval(this.chordTimer);
      this.chordTimer = 0;
      for (const source of this.sources) {
        try { source.stop(); } catch {}
        try { source.disconnect(); } catch {}
      }
      this.sources = [];
      if (this.context) this.context.close().catch(() => {});
      this.context = null;
      this.master = null;
    }
  }

  const ambient = new AmbientEngine();
  const toggle = document.createElement('button');
  toggle.id = 'cozy-toggle';
  toggle.className = 'command cozy-command';
  toggle.title = 'Open Cozy Mode (Ctrl/Cmd+Shift+M)';
  toggle.innerHTML = '<span aria-hidden="true">☕</span>COZY';
  toggle.setAttribute('aria-controls', 'cozy-panel');
  toggle.setAttribute('aria-expanded', String(state.panelOpen));
  commandRow.append(toggle);

  const panel = document.createElement('aside');
  panel.id = 'cozy-panel';
  panel.className = 'pixel-frame';
  panel.setAttribute('aria-label', 'Cozy focus, tasks, notes, and ambience');
  panel.innerHTML = `
    <header class="cozy-header">
      <div>
        <span class="panel-kicker">COZY MODE</span>
        <h2>Room Companion</h2>
      </div>
      <div class="cozy-header-actions">
        <button type="button" data-action="compact" title="Compact panel" aria-label="Compact panel">↕</button>
        <button type="button" data-action="close" title="Close Cozy Mode" aria-label="Close Cozy Mode">×</button>
      </div>
    </header>

    <section class="cozy-section cozy-focus" aria-labelledby="cozy-focus-title">
      <div class="cozy-section-title">
        <div><span class="cozy-icon">◷</span><b id="cozy-focus-title">FOCUS</b></div>
        <select id="cozy-focus-preset" aria-label="Focus timer preset">
          <option value="focus:1500">25 min focus</option>
          <option value="focus:2700">45 min focus</option>
          <option value="focus:3600">60 min focus</option>
          <option value="break:300">5 min break</option>
          <option value="break:900">15 min break</option>
        </select>
      </div>
      <div class="cozy-clock-row">
        <div id="cozy-clock" class="cozy-clock">25:00</div>
        <div class="cozy-focus-actions">
          <button type="button" data-action="timer-primary" class="cozy-primary">START</button>
          <button type="button" data-action="timer-reset" title="Reset timer" aria-label="Reset timer">↶</button>
        </div>
      </div>
      <div class="cozy-progress" aria-hidden="true"><span id="cozy-progress-fill"></span></div>
      <p id="cozy-active-task" class="cozy-active-task">No active task</p>
    </section>

    <section class="cozy-section cozy-tasks" aria-labelledby="cozy-tasks-title">
      <div class="cozy-section-title">
        <div><span class="cozy-icon">✓</span><b id="cozy-tasks-title">TASKS</b></div>
        <span id="cozy-task-count" class="cozy-count">0/0</span>
      </div>
      <form id="cozy-task-form" class="cozy-task-form">
        <input id="cozy-task-input" maxlength="180" placeholder="Add a tiny next step…" aria-label="New task" />
        <button type="submit" title="Add task" aria-label="Add task">+</button>
      </form>
      <div id="cozy-task-list" class="cozy-task-list"></div>
    </section>

    <section class="cozy-section cozy-notes" aria-labelledby="cozy-notes-title">
      <div class="cozy-section-title">
        <div><span class="cozy-icon">✎</span><b id="cozy-notes-title">MEMO</b></div>
        <span id="cozy-memo-count" class="cozy-count">0/4000</span>
      </div>
      <textarea id="cozy-memo" maxlength="4000" rows="4" aria-label="Room memo"></textarea>
    </section>

    <section class="cozy-section cozy-ambience" aria-labelledby="cozy-ambience-title">
      <div class="cozy-section-title">
        <div><span class="cozy-icon">♫</span><b id="cozy-ambience-title">AMBIENCE</b></div>
        <button type="button" id="cozy-audio-toggle" data-action="audio-toggle" class="cozy-chip">OFF</button>
      </div>
      <label class="cozy-select-row">Theme
        <select id="cozy-theme">
          <option value="warm">Warm</option>
          <option value="rainy-night">Rainy night</option>
          <option value="sunrise">Sunrise</option>
          <option value="sunset">Sunset</option>
          <option value="forest">Forest</option>
        </select>
      </label>
      <div class="cozy-slider-grid">
        <label>MASTER <input data-channel="master" type="range" min="0" max="1" step="0.01"></label>
        <label>RAIN <input data-channel="rain" type="range" min="0" max="1" step="0.01"></label>
        <label>VINYL <input data-channel="vinyl" type="range" min="0" max="1" step="0.01"></label>
        <label>CHORDS <input data-channel="chords" type="range" min="0" max="1" step="0.01"></label>
      </div>
    </section>

    <section class="cozy-section cozy-stats" aria-labelledby="cozy-stats-title">
      <div class="cozy-section-title">
        <div><span class="cozy-icon">★</span><b id="cozy-stats-title">TODAY'S RHYTHM</b></div>
        <span id="cozy-mood" class="cozy-chip">COZY</span>
      </div>
      <div class="cozy-stat-grid">
        <div><b id="cozy-focus-count">0</b><span>FOCUS</span></div>
        <div><b id="cozy-focus-minutes">0</b><span>MINUTES</span></div>
        <div><b id="cozy-streak">0</b><span>STREAK</span></div>
        <div><b id="cozy-interactions">0</b><span>ROOM USES</span></div>
      </div>
      <div class="cozy-file-row">
        <button type="button" data-action="export-state">EXPORT</button>
        <button type="button" data-action="import-state">IMPORT</button>
        <input id="cozy-import-input" type="file" accept="application/json,.json" hidden />
      </div>
    </section>

    <footer id="cozy-status" class="cozy-status" aria-live="polite">Ready for a tiny win.</footer>
  `;
  viewport.append(panel);

  const ui = {
    clock: panel.querySelector('#cozy-clock'),
    progress: panel.querySelector('#cozy-progress-fill'),
    preset: panel.querySelector('#cozy-focus-preset'),
    primary: panel.querySelector('[data-action="timer-primary"]'),
    activeTask: panel.querySelector('#cozy-active-task'),
    taskForm: panel.querySelector('#cozy-task-form'),
    taskInput: panel.querySelector('#cozy-task-input'),
    taskList: panel.querySelector('#cozy-task-list'),
    taskCount: panel.querySelector('#cozy-task-count'),
    memo: panel.querySelector('#cozy-memo'),
    memoCount: panel.querySelector('#cozy-memo-count'),
    theme: panel.querySelector('#cozy-theme'),
    audioToggle: panel.querySelector('#cozy-audio-toggle'),
    focusCount: panel.querySelector('#cozy-focus-count'),
    focusMinutes: panel.querySelector('#cozy-focus-minutes'),
    streak: panel.querySelector('#cozy-streak'),
    interactions: panel.querySelector('#cozy-interactions'),
    mood: panel.querySelector('#cozy-mood'),
    status: panel.querySelector('#cozy-status'),
    importInput: panel.querySelector('#cozy-import-input'),
  };

  for (const eventName of ['pointerdown', 'mousedown', 'touchstart', 'wheel', 'dblclick']) {
    panel.addEventListener(eventName, (event) => event.stopPropagation());
  }

  toggle.addEventListener('click', () => setPanelOpen(!state.panelOpen));
  panel.addEventListener('click', handlePanelAction);
  ui.taskForm.addEventListener('submit', handleAddTask);
  ui.memo.addEventListener('input', () => {
    core.setMemo(state, ui.memo.value);
    ui.memoCount.textContent = `${state.memo.length}/4000`;
    scheduleSave();
  });
  ui.theme.addEventListener('change', () => {
    core.setTheme(state, ui.theme.value);
    renderTheme();
    saveAndBroadcast('theme-changed');
  });
  ui.preset.addEventListener('change', () => {
    const [mode, seconds] = ui.preset.value.split(':');
    core.configureTimer(state, mode, Number(seconds));
    saveAndRender('timer-configured');
  });
  for (const slider of panel.querySelectorAll('[data-channel]')) {
    slider.addEventListener('input', () => {
      core.setAmbientLevel(state, slider.dataset.channel, Number(slider.value));
      ambient.updateLevels();
      scheduleSave();
    });
    slider.addEventListener('change', () => saveAndBroadcast('ambient-level-changed'));
  }
  ui.importInput.addEventListener('change', importStateFile);
  document.addEventListener('keydown', handleKeyboard);
  document.addEventListener('dblclick', handleRoomInteraction, true);
  document.addEventListener('click', handleInspectorInteraction, true);
  window.addEventListener('message', handleHostMessage);
  channel?.addEventListener('message', (event) => handleBridgeCommand(event.data));
  window.addEventListener('beforeunload', () => ambient.stop());

  setInterval(tick, 250);
  render();
  publish('ready');

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return core.sanitizeCozyState(raw ? JSON.parse(raw) : null, new Date());
    } catch (error) {
      console.warn('[TinyRoomCozy] Could not load saved state:', error);
      return core.createCozyState(new Date());
    }
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      setStatus('Browser storage is unavailable; this session will not persist.', 'warn');
      console.warn('[TinyRoomCozy] Could not persist state:', error);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 180);
  }

  function saveAndRender(reason) {
    persist();
    render();
    publish(reason);
  }

  function saveAndBroadcast(reason) {
    persist();
    publish(reason);
  }

  function publish(reason) {
    const message = {
      source: SOURCE,
      type: 'state',
      reason,
      payload: core.publicSnapshot(state),
    };
    try { channel?.postMessage(message); } catch {}
    try { window.parent?.postMessage(message, '*'); } catch {}
    window.dispatchEvent(new CustomEvent('tinyroomcozy:state', { detail: message }));
  }

  function render() {
    renderTheme();
    panel.hidden = !state.panelOpen;
    panel.classList.toggle('compact', state.compact);
    toggle.setAttribute('aria-expanded', String(state.panelOpen));
    toggle.classList.toggle('active', state.panelOpen);

    ui.clock.textContent = core.formatClock(state.focus.remainingSeconds);
    ui.primary.textContent = state.focus.state === 'running'
      ? 'PAUSE'
      : state.focus.state === 'paused'
        ? 'RESUME'
        : state.focus.state === 'complete'
          ? 'AGAIN'
          : 'START';
    ui.progress.style.width = `${Math.round(core.timerProgress(state) * 100)}%`;
    ui.preset.value = `${state.focus.mode}:${state.focus.durationSeconds}`;
    if (![...ui.preset.options].some((option) => option.value === ui.preset.value)) {
      const option = document.createElement('option');
      option.value = ui.preset.value;
      option.textContent = `${Math.round(state.focus.durationSeconds / 60)} min ${state.focus.mode}`;
      ui.preset.append(option);
      ui.preset.value = option.value;
    }

    const activeTask = state.tasks.find((task) => task.id === state.activeTaskId) ?? null;
    ui.activeTask.textContent = activeTask ? `NOW: ${activeTask.text}` : 'No active task';
    renderTasks();
    if (document.activeElement !== ui.memo) ui.memo.value = state.memo;
    ui.memoCount.textContent = `${state.memo.length}/4000`;
    ui.theme.value = state.theme;
    ui.audioToggle.textContent = state.ambient.enabled ? 'ON' : 'OFF';
    ui.audioToggle.classList.toggle('active', state.ambient.enabled);
    for (const slider of panel.querySelectorAll('[data-channel]')) {
      slider.value = String(state.ambient[slider.dataset.channel]);
    }
    ui.focusCount.textContent = String(state.stats.completedFocusSessions);
    ui.focusMinutes.textContent = String(Math.round(state.stats.totalFocusSeconds / 60));
    ui.streak.textContent = String(state.stats.streakDays);
    ui.interactions.textContent = String(state.stats.interactions);
    ui.mood.textContent = state.buddyMood.toUpperCase();
  }

  function renderTheme() {
    for (const theme of ['warm', 'rainy-night', 'sunrise', 'sunset', 'forest']) {
      viewport.classList.toggle(`cozy-theme-${theme}`, state.theme === theme);
    }
    viewport.classList.toggle('cozy-audio-on', state.ambient.enabled);
  }

  function renderTasks() {
    const remaining = state.tasks.filter((task) => !task.done).length;
    ui.taskCount.textContent = `${state.tasks.length - remaining}/${state.tasks.length}`;
    const fragment = document.createDocumentFragment();
    for (const task of state.tasks) {
      const row = document.createElement('div');
      row.className = `cozy-task${task.done ? ' done' : ''}${state.activeTaskId === task.id ? ' active' : ''}`;
      row.dataset.taskId = task.id;
      const checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.dataset.taskAction = 'toggle';
      checkbox.title = task.done ? 'Mark incomplete' : 'Mark complete';
      checkbox.setAttribute('aria-label', checkbox.title);
      checkbox.textContent = task.done ? '✓' : '○';
      const text = document.createElement('button');
      text.type = 'button';
      text.dataset.taskAction = 'activate';
      text.className = 'cozy-task-text';
      text.textContent = task.text;
      text.title = 'Make this the active focus task';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.taskAction = 'remove';
      remove.className = 'cozy-task-remove';
      remove.title = 'Remove task';
      remove.setAttribute('aria-label', `Remove ${task.text}`);
      remove.textContent = '×';
      row.append(checkbox, text, remove);
      fragment.append(row);
    }
    ui.taskList.replaceChildren(fragment);
  }

  function handlePanelAction(event) {
    const taskButton = event.target.closest('[data-task-action]');
    if (taskButton) {
      const row = taskButton.closest('[data-task-id]');
      if (!row) return;
      const taskId = row.dataset.taskId;
      if (taskButton.dataset.taskAction === 'toggle') core.toggleTask(state, taskId);
      if (taskButton.dataset.taskAction === 'activate') core.setActiveTask(state, taskId);
      if (taskButton.dataset.taskAction === 'remove') core.removeTask(state, taskId);
      saveAndRender('tasks-changed');
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'close') setPanelOpen(false);
    if (action === 'compact') {
      state.compact = !state.compact;
      saveAndRender('panel-layout-changed');
    }
    if (action === 'timer-primary') toggleTimer();
    if (action === 'timer-reset') {
      core.resetTimer(state);
      saveAndRender('timer-reset');
    }
    if (action === 'audio-toggle') toggleAudio();
    if (action === 'export-state') exportStateFile();
    if (action === 'import-state') ui.importInput.click();
  }

  function handleAddTask(event) {
    event.preventDefault();
    const task = core.addTask(state, ui.taskInput.value);
    if (!task) {
      setStatus(ui.taskInput.value.trim() ? 'Task limit reached.' : 'Type a task first.', 'warn');
      return;
    }
    ui.taskInput.value = '';
    saveAndRender('task-added');
    setStatus('Tiny next step added.', 'good');
  }

  function toggleTimer() {
    if (state.focus.state === 'running') core.pauseTimer(state);
    else core.startTimer(state);
    saveAndRender('timer-state-changed');
    setStatus(state.focus.state === 'running' ? 'Focus session started.' : 'Timer paused.', 'good');
  }

  async function toggleAudio() {
    const next = !state.ambient.enabled;
    core.setAmbientEnabled(state, next);
    try {
      await ambient.setEnabled(next);
      setStatus(next ? 'Original generated ambience is playing.' : 'Ambience stopped.', 'good');
    } catch (error) {
      core.setAmbientEnabled(state, false);
      setStatus(error instanceof Error ? error.message : 'Could not start audio.', 'warn');
    }
    saveAndRender('ambient-toggled');
  }

  function tick() {
    const wasRunning = state.focus.state === 'running';
    core.reconcileTimer(state, Date.now());
    if (wasRunning && state.focus.state === 'complete') {
      onTimerCompleted();
    } else if (state.focus.state === 'running') {
      ui.clock.textContent = core.formatClock(state.focus.remainingSeconds);
      ui.progress.style.width = `${Math.round(core.timerProgress(state) * 100)}%`;
    }
  }

  function onTimerCompleted() {
    persist();
    render();
    viewport.classList.add('cozy-celebrate');
    setTimeout(() => viewport.classList.remove('cozy-celebrate'), 1100);
    const message = state.focus.mode === 'focus'
      ? 'Focus complete. Buddy is proud of you.'
      : 'Break complete. Ready for the next tiny win?';
    setStatus(message, 'good');
    showBuilderToast(message);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try { new Notification('Pocket Buddy+ Tiny Room', { body: message }); } catch {}
    }
    publish('timer-completed');
  }

  function setPanelOpen(open) {
    state.panelOpen = Boolean(open);
    persist();
    render();
    publish('panel-toggled');
  }

  function handleKeyboard(event) {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      setPanelOpen(!state.panelOpen);
      return;
    }
    if (modifier && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleTimer();
      return;
    }
    if (event.key === 'Escape' && state.panelOpen && panel.contains(document.activeElement)) {
      setPanelOpen(false);
    }
  }

  function handleRoomInteraction(event) {
    const item = event.target.closest?.('.placed-item');
    if (!item) return;
    reactToRoomItem(describeItem(item));
  }

  function handleInspectorInteraction(event) {
    const button = event.target.closest?.('[data-action="activate"]');
    if (!button) return;
    const name = document.querySelector('#selection-name')?.textContent ?? 'room item';
    setTimeout(() => reactToRoomItem(name), 0);
  }

  function describeItem(item) {
    const image = item.matches('img') ? item : item.querySelector('img');
    return [
      item.dataset.assetId,
      item.dataset.name,
      item.getAttribute('aria-label'),
      item.getAttribute('title'),
      image?.alt,
      image?.src?.split('/').pop(),
    ].filter(Boolean).join(' ');
  }

  function reactToRoomItem(description) {
    const text = String(description || 'room item').toLowerCase();
    core.recordRoomInteraction(state, text);
    if (/record|radio|speaker|music/.test(text)) {
      if (!state.ambient.enabled) toggleAudio();
      else setStatus('Buddy is vibing with the room.', 'good');
    } else if (/lamp|light|candle/.test(text)) {
      core.setTheme(state, state.theme === 'rainy-night' ? 'warm' : 'rainy-night');
      setStatus(`Room lighting changed to ${state.theme.replace('-', ' ')}.`, 'good');
    } else if (/desk|computer|laptop|book/.test(text)) {
      setPanelOpen(true);
      setStatus('Desk ready. Pick a task and start a focus session.', 'good');
    } else if (/bed|sofa|chair/.test(text)) {
      setStatus('Buddy looks comfortable.', 'good');
    } else if (/plant|flower/.test(text)) {
      setStatus('A little green makes the room calmer.', 'good');
    }
    saveAndRender('room-interaction');
  }

  function setStatus(message, tone = '') {
    ui.status.textContent = message;
    ui.status.dataset.tone = tone;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      ui.status.textContent = 'Ready for a tiny win.';
      ui.status.dataset.tone = '';
    }, 3500);
  }

  function showBuilderToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function exportStateFile() {
    const blob = new Blob([core.exportCozyState(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pocket-buddy-tiny-room-cozy-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus('Cozy state exported.', 'good');
  }

  async function importStateFile() {
    const file = ui.importInput.files?.[0];
    ui.importInput.value = '';
    if (!file) return;
    try {
      state = core.importCozyState(await file.text(), new Date());
      await ambient.setEnabled(false);
      core.setAmbientEnabled(state, false);
      saveAndRender('state-imported');
      setStatus('Cozy state imported.', 'good');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not import state.', 'warn');
    }
  }

  function handleHostMessage(event) {
    handleBridgeCommand(event.data);
  }

  function handleBridgeCommand(message) {
    if (!message || typeof message !== 'object' || message.source !== HOST_SOURCE) return;
    if (message.type === 'toggle-panel') setPanelOpen(!state.panelOpen);
    if (message.type === 'open-panel') setPanelOpen(true);
    if (message.type === 'start-focus') {
      if (message.seconds) core.configureTimer(state, 'focus', Number(message.seconds));
      core.startTimer(state);
      saveAndRender('host-started-focus');
    }
    if (message.type === 'pause-focus') {
      core.pauseTimer(state);
      saveAndRender('host-paused-focus');
    }
    if (message.type === 'set-theme') {
      core.setTheme(state, String(message.theme || 'warm'));
      saveAndRender('host-set-theme');
    }
    if (message.type === 'get-state') publish('state-requested');
    if (message.type === 'replace-state') {
      state = core.sanitizeCozyState(message.payload, new Date());
      saveAndRender('host-replaced-state');
    }
  }

  globalThis.TinyRoomCozy = Object.freeze({
    getState: () => structuredClone(state),
    getSnapshot: () => core.publicSnapshot(state),
    open: () => setPanelOpen(true),
    close: () => setPanelOpen(false),
    toggle: () => setPanelOpen(!state.panelOpen),
    startFocus: (seconds = core.DEFAULT_FOCUS_SECONDS) => {
      core.configureTimer(state, 'focus', seconds);
      core.startTimer(state);
      saveAndRender('api-started-focus');
    },
    pause: () => {
      core.pauseTimer(state);
      saveAndRender('api-paused-focus');
    },
    setTheme: (theme) => {
      core.setTheme(state, theme);
      saveAndRender('api-set-theme');
    },
  });
})();
