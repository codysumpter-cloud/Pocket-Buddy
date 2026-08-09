(() => {
  "use strict";

  // Pocket Buddy Studio window.
  //
  // The viewport is a live capture of the REAL Pocket Buddy window, not a
  // re-render. Clicks and drags are mapped back into that window's CSS pixel
  // space and executed by the injected agent, so what you inspect is always
  // the actual running app.

  const bridge = window.PocketBuddyStudio;
  const $ = (selector) => document.querySelector(selector);

  const CAPTURE_MS = 180;
  const SNAPSHOT_MS = 420;
  const TREE_MS = 1100;
  const CONSOLE_MS = 700;
  const DRAG_MS = 40;

  const state = {
    surface: "home",
    selectionRef: "",
    selection: null,
    frame: { width: 0, height: 0 },
    collapsed: new Set(),
    overlays: { enabled: false, walkable: true, edges: true, collision: true, footprints: false, labels: true },
    logs: [],
    errorsOnly: false,
    picking: false,
    drag: null,
    lastDragAt: 0,
  };

  const viewport = $("#viewport");
  const viewportEmpty = $("#viewport-empty");

  function log(level, text) {
    state.logs.push({ level, at: Date.now(), text });
    while (state.logs.length > 400) state.logs.shift();
  }

  async function call(method, args = []) {
    if (!bridge) return { ok: false, error: "Studio bridge is unavailable." };
    const result = await bridge.call(state.surface, method, args);
    if (result && result.ok === false && result.error) log("error", `${method}: ${result.error}`);
    return result ?? { ok: false, error: "No response." };
  }

  // ------------------------------------------------------------- viewport

  async function pumpCapture() {
    try {
      const result = await bridge.capture(state.surface);
      if (result?.ok) {
        viewport.src = result.dataUrl;
        state.frame = { width: result.width, height: result.height };
        viewport.classList.remove("hidden");
        viewportEmpty.classList.add("hidden");
      } else {
        viewport.classList.add("hidden");
        viewportEmpty.classList.remove("hidden");
        viewportEmpty.textContent = result?.error || "Waiting for the live window…";
      }
    } catch (error) {
      viewport.classList.add("hidden");
      viewportEmpty.classList.remove("hidden");
      viewportEmpty.textContent = String(error?.message || error);
    }
  }

  /** Map a Studio-window pointer event onto the target window's CSS pixels. */
  function toTargetPoint(event) {
    const rect = viewport.getBoundingClientRect();
    const naturalWidth = viewport.naturalWidth;
    const naturalHeight = viewport.naturalHeight;
    if (!naturalWidth || !naturalHeight || !state.frame.width) return null;

    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
    const drawWidth = naturalWidth * scale;
    const drawHeight = naturalHeight * scale;
    const originX = rect.left + (rect.width - drawWidth) / 2;
    const originY = rect.top + (rect.height - drawHeight) / 2;

    const imageX = (event.clientX - originX) / scale;
    const imageY = (event.clientY - originY) / scale;
    if (imageX < 0 || imageY < 0 || imageX > naturalWidth || imageY > naturalHeight) return null;

    return {
      x: (imageX / naturalWidth) * state.frame.width,
      y: (imageY / naturalHeight) * state.frame.height,
    };
  }

  viewport.addEventListener("pointerdown", async (event) => {
    const point = toTargetPoint(event);
    if (!point) return;
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    state.drag = { last: point };
    const result = await call("selectAt", [point.x, point.y]);
    if (result?.ok) applySelection(result.selection);
  });

  viewport.addEventListener("pointermove", async (event) => {
    if (!state.drag || !state.selectionRef) return;
    const now = performance.now();
    if (now - state.lastDragAt < DRAG_MS) return;
    const point = toTargetPoint(event);
    if (!point) return;
    const dx = point.x - state.drag.last.x;
    const dy = point.y - state.drag.last.y;
    if (!dx && !dy) return;
    state.lastDragAt = now;
    state.drag.last = point;
    const result = await call("moveBy", [state.selectionRef, dx, dy]);
    if (result?.ok && result.properties) applySelection(result.properties);
  });

  const endDrag = (event) => {
    if (!state.drag) return;
    state.drag = null;
    try { viewport.releasePointerCapture(event.pointerId); } catch { /* pointer already gone */ }
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  // ------------------------------------------------------------ hierarchy

  function renderTree(roots) {
    const container = $("#tree");
    container.replaceChildren();
    for (const root of roots) container.append(treeNode(root));
  }

  function treeNode(node) {
    const wrapper = document.createElement("div");
    wrapper.className = "tree-node";

    const row = document.createElement("div");
    row.className = "tree-row";
    if (node.ref && node.ref === state.selectionRef) row.classList.add("selected");
    if (node.visible === false) row.classList.add("hidden-node");

    const hasChildren = Boolean(node.children?.length);
    const twisty = document.createElement("span");
    twisty.className = "twisty";
    twisty.textContent = hasChildren ? (state.collapsed.has(node.ref || node.label) ? "▸" : "▾") : "";
    twisty.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = node.ref || node.label;
      state.collapsed.has(key) ? state.collapsed.delete(key) : state.collapsed.add(key);
      refreshTree();
    });

    const kind = document.createElement("span");
    kind.className = "tree-kind";
    kind.textContent = node.kind || "";

    const label = document.createElement("span");
    label.textContent = node.label || "";

    row.append(twisty, kind, label);
    if (node.ref) {
      row.addEventListener("click", async () => {
        const result = await call("select", [node.ref]);
        if (result?.ok) applySelection(result.selection);
      });
    }
    wrapper.append(row);

    if (hasChildren && !state.collapsed.has(node.ref || node.label)) {
      const children = document.createElement("div");
      children.className = "tree-children";
      for (const child of node.children) children.append(treeNode(child));
      if (node.truncated) {
        const more = document.createElement("div");
        more.className = "hint";
        more.textContent = `… ${node.truncated} more`;
        children.append(more);
      }
      wrapper.append(children);
    }
    return wrapper;
  }

  let lastTree = [];
  function refreshTree() {
    renderTree(lastTree);
  }

  async function pumpTree() {
    const result = await call("tree");
    if (!result?.ok) return;
    lastTree = result.roots || [];
    refreshTree();
  }

  // ------------------------------------------------------------ inspector

  function applySelection(selection) {
    state.selection = selection || null;
    state.selectionRef = selection?.ref || "";
    renderSelection();
    refreshTree();
  }

  function propertyRow(grid, key, value, onCommit) {
    const label = document.createElement("span");
    label.textContent = key;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ?? "";
    input.addEventListener("change", () => onCommit(input.value));
    grid.append(label, input);
  }

  function renderSelection() {
    const host = $("#selection");
    host.replaceChildren();
    const selection = state.selection;
    if (!selection) {
      host.textContent = "Nothing selected.";
      return;
    }

    const title = document.createElement("div");
    title.innerHTML = `<strong>${escapeHtml(selection.label || "")}</strong>`;
    const badge = document.createElement("span");
    badge.className = `badge ${selection.persistence || ""}`;
    badge.textContent = (selection.persistence || "").replace(/-/g, " ");
    title.append(" ", badge);
    host.append(title);

    const meta = document.createElement("div");
    meta.className = "hint";
    meta.textContent = `${selection.kind} · ${selection.tagName?.toLowerCase() || ""}${selection.id ? ` #${selection.id}` : ""}`;
    host.append(meta);

    if (selection.rect) {
      const rect = document.createElement("div");
      rect.className = "hint";
      rect.textContent = `rect ${selection.rect.x}, ${selection.rect.y} · ${selection.rect.width}×${selection.rect.height} · z ${selection.zIndex ?? "auto"} · ${selection.visible ? "visible" : "hidden"}`;
      host.append(rect);
    }

    if (selection.structure) {
      const structure = document.createElement("div");
      structure.className = "hint";
      const parts = [`${selection.structure.type}`, `cell ${selection.structure.column},${selection.structure.row}`];
      if (selection.structure.axis) parts.push(`axis ${selection.structure.axis}`);
      if ("blocking" in selection.structure) parts.push(selection.structure.blocking ? "blocks traversal" : "passable");
      structure.textContent = parts.join(" · ");
      host.append(structure);
    }

    if (selection.actor) {
      host.append(actorDetail(selection.actor, selection.animations || []));
    }

    const grid = document.createElement("div");
    grid.className = "prop-grid";
    for (const key of selection.editable || []) {
      const current = selection.inline?.[key] ?? selection.css?.[key] ?? "";
      propertyRow(grid, key, current, async (value) => {
        const result = await call("setProperty", [selection.ref, key, value]);
        if (result?.ok) applySelection(result.properties);
      });
    }
    host.append(grid);

    if (selection.persistence === "live-css-preview") {
      const note = document.createElement("div");
      note.className = "hint";
      note.textContent = "Live CSS preview only — not written back to house state.";
      host.append(note);

      const offset = selection.studioOffset || { x: 0, y: 0 };
      if (offset.x || offset.y) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = `RESET NUDGE (${Math.round(offset.x)}, ${Math.round(offset.y)})`;
        reset.addEventListener("click", async () => {
          const result = await call("clearOffset", [selection.ref]);
          if (result?.ok) applySelection(result.properties);
        });
        host.append(reset);
      }
    }
  }

  function actorDetail(actor, animations) {
    const card = document.createElement("div");
    card.className = "actor-card";

    const coords = document.createElement("div");
    coords.className = "coords";
    coords.textContent = `pos ${actor.position.column.toFixed(3)}, ${actor.position.row.toFixed(3)}`;

    const cell = document.createElement("div");
    cell.className = "meta";
    cell.textContent = `cell ${actor.cell.column}, ${actor.cell.row} · radius ${actor.radius} · ${actor.direction} · ${actor.moving ? "moving" : "still"}`;

    card.append(coords, cell);

    if (animations.length) {
      const label = document.createElement("label");
      label.textContent = "animation ";
      const select = document.createElement("select");
      const auto = document.createElement("option");
      auto.value = "";
      auto.textContent = "(auto idle/walk)";
      select.append(auto);
      for (const name of animations) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        if (name === actor.animation) option.selected = true;
        select.append(option);
      }
      select.addEventListener("change", () => call("setAnimation", [actor.id, select.value]));
      label.append(select);
      card.append(label);
    }

    const pad = document.createElement("div");
    pad.className = "nudge-pad";
    for (const [text, dx, dy] of [["←", -8, 0], ["→", 8, 0], ["↑", 0, -8], ["↓", 0, 8]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", async () => {
        const result = await call("moveBy", [state.selectionRef, dx, dy]);
        if (result?.ok) await refreshSelection();
      });
      pad.append(button);
    }
    card.append(pad);
    return card;
  }

  async function refreshSelection() {
    if (!state.selectionRef) return;
    const result = await call("properties", [state.selectionRef]);
    if (result?.ok) applySelection(result.properties);
  }

  function renderActors(actors) {
    const host = $("#actors");
    host.replaceChildren();
    if (!actors?.length) {
      host.innerHTML = '<div class="hint">No actors in this surface.</div>';
      return;
    }
    for (const actor of actors) {
      const card = document.createElement("div");
      card.className = "actor-card";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = actor.label || actor.id;
      const coords = document.createElement("div");
      coords.className = "coords";
      coords.textContent = `${actor.position.column.toFixed(3)}, ${actor.position.row.toFixed(3)}`;
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `cell ${actor.cell.column},${actor.cell.row} · ${actor.direction} · ${actor.animation || "auto"}`;
      card.append(name, coords, meta);
      host.append(card);
    }
  }

  // ------------------------------------------------------------- snapshot

  async function pumpSnapshot() {
    const result = await call("snapshot");
    if (!result?.ok) {
      $("#presence-owner").textContent = "presence: —";
      return;
    }
    const presence = result.presence || {};
    $("#presence-owner").innerHTML = `presence: <strong>${escapeHtml(presence.owner || "—")}</strong>`;
    $("#presence-buddy").innerHTML = `buddy: <strong>${escapeHtml(presence.buddyName || "—")}</strong>${presence.buddyPresent ? "" : " (absent)"}`;
    $("#presence-mode").innerHTML = `mode: <strong>${escapeHtml(presence.mode || "—")}</strong>`;

    const grid = result.grid;
    $("#grid-stats").innerHTML = grid
      ? `grid: <strong>${grid.walkableCount}</strong> cells · ${grid.blockingCount}/${grid.edgeCount} blocking · ${grid.rooms} rooms`
      : "grid: —";

    const camera = result.camera;
    $("#camera-stats").innerHTML = camera
      ? `camera: <strong>${Number(camera.scale).toFixed(2)}×</strong> ${Math.round(camera.panX)}, ${Math.round(camera.panY)}`
      : "camera: —";

    renderActors(result.actors);

    for (const button of document.querySelectorAll(".state-button")) {
      const isBuild = presence.structureMode && presence.structureMode !== "furnish";
      const active = button.dataset.state === "build" ? isBuild : (!isBuild && presence.mode === button.dataset.state);
      button.classList.toggle("active", Boolean(active));
    }
    if (presence.structureMode) $("#structure-mode").value = presence.structureMode;

    $("#pick-button").classList.toggle("armed", Boolean(result.pickMode));
    state.picking = Boolean(result.pickMode);

    if (result.selection && result.selection.ref !== state.selectionRef) applySelection(result.selection);
  }

  // -------------------------------------------------------------- console

  async function pumpConsole() {
    const result = await call("drainConsole");
    if (!result?.ok) return;
    for (const entry of result.entries || []) state.logs.push(entry);
    while (state.logs.length > 400) state.logs.shift();
    renderConsole();
  }

  function renderConsole() {
    const host = $("#console-log");
    const atBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 24;
    host.replaceChildren();
    for (const entry of state.logs) {
      if (state.errorsOnly && entry.level !== "error" && entry.level !== "warn") continue;
      const line = document.createElement("div");
      line.className = `log-line ${entry.level}`;
      const when = document.createElement("span");
      when.className = "when";
      when.textContent = new Date(entry.at).toLocaleTimeString();
      line.append(when, document.createTextNode(entry.text));
      host.append(line);
    }
    if (atBottom) host.scrollTop = host.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  // -------------------------------------------------------------- toolbar

  for (const tab of document.querySelectorAll(".surface-tab")) {
    tab.addEventListener("click", () => {
      state.surface = tab.dataset.surface;
      for (const other of document.querySelectorAll(".surface-tab")) other.classList.toggle("active", other === tab);
      applySelection(null);
      lastTree = [];
      refreshTree();
      void pumpSnapshot();
      void pumpTree();
    });
  }

  for (const button of document.querySelectorAll(".state-button")) {
    button.addEventListener("click", async () => {
      const result = await call("setState", [button.dataset.state]);
      if (result?.ok) void pumpSnapshot();
    });
  }

  $("#structure-mode").addEventListener("change", (event) => {
    void call("setStructureMode", [event.target.value]);
  });

  $("#pick-button").addEventListener("click", async () => {
    const next = !state.picking;
    const result = await call("setPickMode", [next]);
    if (result?.ok) {
      state.picking = Boolean(result.pickMode);
      $("#pick-button").classList.toggle("armed", state.picking);
    }
  });

  $("#open-home").addEventListener("click", async () => {
    const result = await bridge.openHome();
    if (result?.ok === false) log("error", `open home: ${result.error}`);
    else {
      state.surface = "home";
      for (const other of document.querySelectorAll(".surface-tab")) other.classList.toggle("active", other.dataset.surface === "home");
    }
    renderConsole();
  });

  $("#devtools").addEventListener("click", () => bridge.devTools(state.surface));
  $("#reload").addEventListener("click", () => bridge.reload(state.surface));
  $("#relaunch").addEventListener("click", () => bridge.relaunch());
  $("#clear-console").addEventListener("click", () => { state.logs = []; renderConsole(); });
  $("#errors-only").addEventListener("change", (event) => { state.errorsOnly = event.target.checked; renderConsole(); });

  const overlayInputs = {
    enabled: $("#ov-enabled"),
    walkable: $("#ov-walkable"),
    edges: $("#ov-edges"),
    collision: $("#ov-collision"),
    footprints: $("#ov-footprints"),
    labels: $("#ov-labels"),
  };

  for (const [key, input] of Object.entries(overlayInputs)) {
    input.addEventListener("change", () => {
      state.overlays[key] = input.checked;
      void call("setOverlays", [{ ...state.overlays }]);
    });
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "F12" || ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "i")) {
      event.preventDefault();
      void bridge.devTools("studio");
    }
  });

  // ----------------------------------------------------------------- boot

  setInterval(pumpCapture, CAPTURE_MS);
  setInterval(pumpSnapshot, SNAPSHOT_MS);
  setInterval(pumpTree, TREE_MS);
  setInterval(pumpConsole, CONSOLE_MS);

  void pumpCapture();
  void pumpSnapshot();
  void pumpTree();
})();
