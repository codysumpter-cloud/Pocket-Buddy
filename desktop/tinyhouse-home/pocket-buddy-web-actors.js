(() => {
  "use strict";

  if (window.parent === window) return;
  let buddyApi;
  try { buddyApi = window.parent.PocketBuddy; } catch { return; }
  if (!buddyApi?.library || !buddyApi?.runtime) return;

  const MOVE_MS = 180;
  const HUMAN_FOOT_OFFSET = 18;
  const PET_FOOT_OFFSET = 10;
  const keys = new Set();
  let mode = "play";
  let human = null;
  let buddy = null;
  let lastIdleMove = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function showError(message) {
    let panel = document.querySelector("#pb-web-home-actor-error");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "pb-web-home-actor-error";
      panel.style.cssText = "position:absolute;right:14px;top:82px;z-index:500000;max-width:420px;padding:9px;border:3px solid #45343a;background:#fff0f0;color:#342b2f;box-shadow:4px 4px 0 #17181d;font:11px 'Courier New',monospace;";
      document.querySelector("#game-shell")?.append(panel);
    }
    panel.textContent = String(message);
  }

  async function waitForRuntime(timeoutMs = 20000) {
    if (window.TINYHOUSE_ASSETS_READY) await window.TINYHOUSE_ASSETS_READY;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (window.TinyHousePlayable?.cellCenter && window.TinyHouseStructure?.grid) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("The canonical TinyHouse runtime did not finish starting.");
  }

  async function decode(bytes, mime = "image/png") {
    const blob = new Blob([bytes], { type: mime });
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Home actor frame could not be decoded.")); };
      image.src = url;
    });
  }

  function animationFor(pack, semantic) {
    const requested = pack.semanticDefaults?.[semantic];
    if (requested) {
      const found = pack.animations?.find((item) => item.id === requested);
      if (found) return found;
    }
    if (semantic === "running") {
      return pack.animations?.find((item) => /walk/i.test(item.originalName || item.id))
        ?? pack.animations?.find((item) => /run/i.test(item.originalName || item.id));
    }
    return pack.animations?.find((item) => /idle/i.test(item.originalName || item.id) && !/battle/i.test(item.originalName || item.id))
      ?? pack.animations?.find((item) => item.complete)
      ?? pack.animations?.[0];
  }

  function framePaths(animation, direction) {
    if (!animation?.frames) return [];
    if (animation.frames[direction]?.length) return animation.frames[direction];
    if (animation.frames.south?.length) return animation.frames.south;
    const fallback = Object.values(animation.frames).find((paths) => Array.isArray(paths) && paths.length);
    return fallback ?? [];
  }

  async function loadPixelLabArt(runtime, label) {
    const pack = runtime?.pack;
    if (!pack || pack.source !== "pixellab") throw new Error(`${label} is not a PixelLab actor pack.`);
    const idle = animationFor(pack, "idle");
    const walk = animationFor(pack, "running") ?? idle;
    if (!idle) throw new Error(`${label} has no usable idle animation.`);
    const paths = new Set();
    for (const animation of [idle, walk]) {
      for (const direction of ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]) {
        for (const path of framePaths(animation, direction)) paths.add(path);
      }
    }
    const images = new Map();
    for (const path of paths) images.set(path, await decode(await runtime.zip.read(path), "image/png"));
    return {
      type: "pixellab",
      label,
      width: pack.frameWidth,
      height: pack.frameHeight,
      idle,
      walk,
      frame(semantic, direction, index) {
        const animation = semantic === "running" ? walk : idle;
        const frames = framePaths(animation, direction);
        const path = frames.length ? frames[index % frames.length] : null;
        const image = path ? images.get(path) : null;
        return image ? { image, sx: 0, sy: 0, sw: pack.frameWidth, sh: pack.frameHeight, count: Math.max(1, frames.length) } : null;
      },
      frameCount(semantic, direction) {
        const animation = semantic === "running" ? walk : idle;
        return Math.max(1, framePaths(animation, direction).length);
      },
    };
  }

  async function loadOpenPetsArt(runtime, label) {
    const pack = runtime?.pack;
    if (!pack || pack.source !== "openpets") throw new Error(`${label} is not an OpenPets actor pack.`);
    const sheet = await decode(await runtime.zip.read(pack.sheetPath), "image/webp");
    return {
      type: "openpets",
      label,
      width: pack.frameWidth,
      height: pack.frameHeight,
      frame(semantic, direction, index) {
        let stateId = semantic === "running" ? "running" : "idle";
        if (semantic === "running" && direction.includes("west")) stateId = "running-left";
        if (semantic === "running" && direction.includes("east")) stateId = "running-right";
        const state = pack.standardStates?.[stateId] ?? pack.standardStates?.idle;
        if (!state) return null;
        const count = Math.max(1, state.frames ?? 1);
        return {
          image: sheet,
          sx: (index % count) * pack.frameWidth,
          sy: state.row * pack.frameHeight,
          sw: pack.frameWidth,
          sh: pack.frameHeight,
          count,
        };
      },
      frameCount(semantic, direction) {
        let stateId = semantic === "running" ? "running" : "idle";
        if (semantic === "running" && direction.includes("west")) stateId = "running-left";
        if (semantic === "running" && direction.includes("east")) stateId = "running-right";
        return Math.max(1, pack.standardStates?.[stateId]?.frames ?? pack.standardStates?.idle?.frames ?? 1);
      },
    };
  }

  function loadPocketBirdArt() {
    const host = window.parent.document.getElementById("birb-shadow-host");
    const canvas = host?.shadowRoot?.getElementById("birb");
    if (!(canvas instanceof window.parent.HTMLCanvasElement)) return null;
    return {
      type: "pocket-bird",
      label: "Pocket Bird",
      width: Math.max(1, canvas.width || 32),
      height: Math.max(1, canvas.height || 32),
      frame() { return { image: canvas, sx: 0, sy: 0, sw: canvas.width, sh: canvas.height, count: 1 }; },
      frameCount() { return 1; },
    };
  }

  async function artFor(runtime, label) {
    if (!runtime) return loadPocketBirdArt();
    if (runtime.pack?.source === "pixellab") return loadPixelLabArt(runtime, label);
    if (runtime.pack?.source === "openpets") return loadOpenPetsArt(runtime, label);
    return null;
  }

  function directionFromWorldDelta(dx, dy, fallback = "south") {
    if (Math.hypot(dx, dy) < 0.001) return fallback;
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    const octant = Math.round(angle / (Math.PI / 4)) % 8;
    return ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][octant] || fallback;
  }

  function floorCells() {
    return [...window.TinyHouseStructure.grid.floors.values()].map((entry) => ({ column: entry.column, row: entry.row }));
  }

  function startCell(offset = 0) {
    const cells = floorCells();
    if (!cells.length) throw new Error("Home has no floor cells for the player.");
    cells.sort((a, b) => (a.column + a.row) - (b.column + b.row));
    return cells[Math.min(cells.length - 1, Math.max(0, Math.floor(cells.length / 2) + offset))] || cells[0];
  }

  function worldPoint(cell) {
    return window.TinyHousePlayable.cellCenter(cell.column, cell.row);
  }

  function canStep(from, to) {
    const dc = to.column - from.column;
    const dr = to.row - from.row;
    const grid = window.TinyHouseStructure;
    if (Math.abs(dc) + Math.abs(dr) === 1) return grid.canTraverse(from, to);
    if (Math.abs(dc) === 1 && Math.abs(dr) === 1) {
      const viaColumn = { column: from.column + dc, row: from.row };
      const viaRow = { column: from.column, row: from.row + dr };
      return (grid.canTraverse(from, viaColumn) && grid.canTraverse(viaColumn, to))
        || (grid.canTraverse(from, viaRow) && grid.canTraverse(viaRow, to));
    }
    return false;
  }

  function createActor(id, art, scale, cell, footOffset) {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.width = art.width;
    canvas.height = art.height;
    canvas.setAttribute("aria-label", art.label);
    canvas.style.cssText = "position:absolute;image-rendering:pixelated;user-select:none;pointer-events:auto;filter:drop-shadow(0 3px 0 rgba(25,19,25,.22));";
    document.querySelector("#item-layer")?.append(canvas);
    return {
      canvas,
      ctx: canvas.getContext("2d"),
      art,
      scale,
      cell: { ...cell },
      from: { ...cell },
      to: { ...cell },
      moving: false,
      moveStartedAt: 0,
      direction: "south",
      footOffset,
    };
  }

  function startMove(actor, target, now = performance.now()) {
    if (!actor || actor.moving || !canStep(actor.cell, target)) return false;
    actor.from = { ...actor.cell };
    actor.to = { ...target };
    const fromPoint = worldPoint(actor.from);
    const toPoint = worldPoint(actor.to);
    actor.direction = directionFromWorldDelta(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y, actor.direction);
    actor.moveStartedAt = now;
    actor.moving = true;
    return true;
  }

  function desiredHumanDelta() {
    const up = keys.has("w") || keys.has("arrowup");
    const down = keys.has("s") || keys.has("arrowdown");
    const left = keys.has("a") || keys.has("arrowleft");
    const right = keys.has("d") || keys.has("arrowright");
    return { column: (right ? 1 : 0) - (left ? 1 : 0), row: (down ? 1 : 0) - (up ? 1 : 0) };
  }

  function maybeMoveHuman(now) {
    if (!human || human.moving || mode !== "play") return;
    const delta = desiredHumanDelta();
    if (!delta.column && !delta.row) return;
    startMove(human, { column: human.cell.column + delta.column, row: human.cell.row + delta.row }, now);
  }

  function validNeighbors(cell) {
    return [
      { column: cell.column + 1, row: cell.row },
      { column: cell.column - 1, row: cell.row },
      { column: cell.column, row: cell.row + 1 },
      { column: cell.column, row: cell.row - 1 },
    ].filter((candidate) => canStep(cell, candidate));
  }

  function maybeMoveBuddy(now) {
    if (!buddy || buddy.moving) return;
    const neighbors = validNeighbors(buddy.cell);
    if (!neighbors.length) return;
    let target = null;
    if (mode === "play" && human) {
      const distance = Math.abs(human.cell.column - buddy.cell.column) + Math.abs(human.cell.row - buddy.cell.row);
      if (distance > 1) {
        target = [...neighbors].sort((a, b) => {
          const da = Math.abs(human.cell.column - a.column) + Math.abs(human.cell.row - a.row);
          const db = Math.abs(human.cell.column - b.column) + Math.abs(human.cell.row - b.row);
          return da - db;
        })[0];
      }
    }
    if (!target && mode === "idle" && now - lastIdleMove > 850) {
      target = neighbors[Math.floor(Math.random() * neighbors.length)];
      lastIdleMove = now;
    }
    if (target) startMove(buddy, target, now);
  }

  function maybeMoveIdleHuman(now) {
    if (!human || human.moving || mode !== "idle" || now - lastIdleMove < 850) return;
    const neighbors = validNeighbors(human.cell);
    if (!neighbors.length) return;
    startMove(human, neighbors[Math.floor(Math.random() * neighbors.length)], now);
    lastIdleMove = now;
  }

  function actorPoint(actor, now) {
    if (!actor.moving) return { ...worldPoint(actor.cell), moving: false };
    const amount = clamp((now - actor.moveStartedAt) / MOVE_MS, 0, 1);
    const smooth = amount * amount * (3 - 2 * amount);
    const from = worldPoint(actor.from);
    const to = worldPoint(actor.to);
    if (amount >= 1) {
      actor.cell = { ...actor.to };
      actor.moving = false;
      return { ...worldPoint(actor.cell), moving: false };
    }
    return { x: from.x + (to.x - from.x) * smooth, y: from.y + (to.y - from.y) * smooth, moving: true };
  }

  function renderActor(actor, now) {
    if (!actor?.ctx) return;
    const point = actorPoint(actor, now);
    const semantic = actor.moving ? "running" : "idle";
    const count = actor.art.frameCount(semantic, actor.direction);
    const index = count <= 1 ? 0 : Math.floor(now / (actor.moving ? 110 : 230)) % count;
    const frame = actor.art.frame(semantic, actor.direction, index);
    if (!frame) return;
    actor.ctx.clearRect(0, 0, actor.canvas.width, actor.canvas.height);
    actor.ctx.imageSmoothingEnabled = false;
    actor.ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, actor.canvas.width, actor.canvas.height);
    const width = Math.round(actor.art.width * actor.scale);
    const height = Math.round(actor.art.height * actor.scale);
    actor.canvas.style.width = `${width}px`;
    actor.canvas.style.height = `${height}px`;
    actor.canvas.style.left = `${Math.round(point.x - width / 2)}px`;
    actor.canvas.style.top = `${Math.round(point.y + actor.footOffset - height)}px`;
    actor.canvas.style.zIndex = String(1000 + Math.round((point.y + actor.footOffset) * 10 + 8));
  }

  function heartAt(actor) {
    if (!actor) return;
    const heart = document.createElement("div");
    heart.textContent = "♥";
    heart.style.cssText = "position:absolute;z-index:600000;color:#ff5c91;text-shadow:2px 0 #fff,-2px 0 #fff,0 2px #fff,0 -2px #fff;font:bold 24px monospace;pointer-events:none;transition:transform .7s linear,opacity .7s linear;";
    const point = worldPoint(actor.cell);
    heart.style.left = `${point.x - 10}px`;
    heart.style.top = `${point.y - actor.art.height * actor.scale - 10}px`;
    document.querySelector("#item-layer")?.append(heart);
    requestAnimationFrame(() => { heart.style.transform = "translateY(-28px)"; heart.style.opacity = "0"; });
    setTimeout(() => heart.remove(), 750);
  }

  function installUiScale() {
    const value = clamp(Number(buddyApi.runtime.uiScaleMultiplier?.()) || 1, 0.5, 2.5);
    document.documentElement.style.setProperty("--pb-home-ui-scale", String(value));
    const style = document.createElement("style");
    style.textContent = `#top-hud,.builder-panel,#selection-tools,#camera-tools,#mode-hint,#structure-panel,#blueprint-panel,#rooms-panel,#cozy-panel{zoom:var(--pb-home-ui-scale,1)}`;
    document.head.append(style);
  }

  function installControls() {
    const shell = document.querySelector("#game-shell");
    if (!shell || document.querySelector("#pb-home-life-controls")) return;
    const controls = document.createElement("div");
    controls.id = "pb-home-life-controls";
    controls.style.cssText = "position:absolute;right:14px;bottom:14px;z-index:500000;display:flex;gap:5px;padding:6px;background:#e9d6a5;border:3px solid #45343a;box-shadow:inset 0 0 0 2px #fff0c8,4px 5px 0 rgba(17,15,19,.72);font:900 10px 'Courier New',monospace;zoom:var(--pb-home-ui-scale,1);";
    const make = (label, action) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.cssText = "border:2px solid #45343a;background:#755b58;color:#fff9dc;padding:5px 8px;font:inherit;";
      button.addEventListener("click", action);
      controls.append(button);
      return button;
    };
    const play = make("PLAY", () => { mode = "play"; sync(); });
    const idle = make("IDLE", () => { mode = "idle"; keys.clear(); sync(); });
    make("PET", () => { void buddyApi.care?.("pet"); heartAt(buddy); });
    make("LEAVE HOME", () => buddyApi.home?.close?.());
    function sync() {
      play.style.background = mode === "play" ? "#3f756e" : "#755b58";
      idle.style.background = mode === "idle" ? "#3f756e" : "#755b58";
    }
    sync();
  }

  function loop(now) {
    maybeMoveHuman(now);
    maybeMoveBuddy(now);
    maybeMoveIdleHuman(now);
    renderActor(human, now);
    renderActor(buddy, now);
    requestAnimationFrame(loop);
  }

  async function start() {
    try {
      await waitForRuntime();
      installUiScale();
      const humanId = await buddyApi.library.homeHumanId();
      const humanRuntime = humanId ? await buddyApi.runtime.runtimeFor(humanId) : null;
      if (!humanRuntime) throw new Error("Import Ani Iso Human in Pocket Buddy → My Pets and select it as the Home player.");
      const humanArt = await artFor(humanRuntime, humanRuntime.pack.displayName || "Ani Iso Human");
      if (!humanArt) throw new Error("The selected Home human could not be rendered from its installed pack.");

      const activeId = await buddyApi.library.activeId();
      const customRuntime = activeId && activeId !== "pocket-bird" ? await buddyApi.runtime.runtimeFor(activeId) : null;
      const buddyArt = await artFor(customRuntime, customRuntime?.pack?.displayName || "Pocket Bird");

      human = createActor("pb-web-home-human", humanArt, 1.2, startCell(0), HUMAN_FOOT_OFFSET);
      if (buddyArt) buddy = createActor("pb-web-home-buddy", buddyArt, clamp(Number(buddyApi.runtime.scaleMultiplier?.()) || 1, 0.25, 8), startCell(1), PET_FOOT_OFFSET);
      installControls();
      window.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
          keys.add(key);
          event.preventDefault();
        }
      });
      window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
      requestAnimationFrame(loop);
    } catch (error) {
      console.error("Pocket Buddy web Home actor bridge failed", error);
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  void start();
})();
