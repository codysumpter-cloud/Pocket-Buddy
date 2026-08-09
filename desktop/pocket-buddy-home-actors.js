(() => {
  "use strict";

  const config = window.POCKET_BUDDY_HOME_CONFIG || {};
  const bridge = window.PocketBuddyHome;
  const SHA256_RE = /^[0-9a-f]{64}$/;
  const MOVE_MS = 180;
  const HUMAN_FOOT_OFFSET = 18;
  const PET_FOOT_OFFSET = 10;
  const directionOrder = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"];
  const keys = new Set();
  let mode = "play";
  let lastIdleMove = 0;
  let human = null;
  let buddy = null;
  let lastFrameAt = performance.now();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const encodePath = (path) => String(path).split("/").map(encodeURIComponent).join("/");
  const privateUrl = (sha, path) => `/private/${sha}/${encodePath(path)}`;

  function showError(message) {
    let panel = document.querySelector("#pb-home-actor-error");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "pb-home-actor-error";
      panel.style.cssText = "position:absolute;right:14px;top:82px;z-index:500000;max-width:420px;padding:9px;border:3px solid #45343a;background:#fff0f0;color:#342b2f;box-shadow:4px 4px 0 #17181d;font:11px 'Courier New',monospace;";
      document.querySelector("#game-shell")?.append(panel);
    }
    panel.textContent = message;
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

  async function loadPixelLab(sha, label) {
    if (!SHA256_RE.test(String(sha || ""))) throw new Error(`${label} art hash is missing or invalid.`);
    const response = await fetch(privateUrl(sha, "metadata.json"), { cache: "no-store" });
    if (!response.ok) throw new Error(`${label} metadata could not be read from its verified art pack.`);
    const metadata = await response.json();
    const state = Array.isArray(metadata?.states) ? metadata.states[0] : null;
    const size = state?.character?.size;
    const animations = state?.frames?.animations;
    const rotations = state?.frames?.rotations;
    if (!state || !Number.isFinite(Number(size?.width)) || !Number.isFinite(Number(size?.height)) || !animations || !rotations) {
      throw new Error(`${label} is not a compatible PixelLab directional pack.`);
    }
    const names = Object.keys(animations);
    const exact = (name) => names.find((candidate) => candidate.toLowerCase() === name);
    const match = (pattern, exclude = null) => names.find((candidate) => pattern.test(candidate) && (!exclude || !exclude.test(candidate)));
    const idleName = exact("ani_idle") || match(/idle/i, /battle/i) || names[0];
    const walkName = exact("ani_walk") || match(/walk/i) || exact("ani_run") || match(/run/i) || idleName;
    return {
      sha,
      label,
      width: Number(size.width),
      height: Number(size.height),
      animations,
      rotations,
      idleName,
      walkName,
      framePath(animationName, direction, frameIndex) {
        const animation = animations[animationName] || animations[idleName] || {};
        const frames = animation[direction]?.length ? animation[direction]
          : animation.south?.length ? animation.south
          : animation[Object.keys(animation).find((key) => Array.isArray(animation[key]) && animation[key].length)] || [];
        if (frames.length) return frames[frameIndex % frames.length];
        return rotations[direction] || rotations.south || rotations[Object.keys(rotations)[0]] || null;
      },
      frameCount(animationName, direction) {
        const animation = animations[animationName] || animations[idleName] || {};
        const frames = animation[direction]?.length ? animation[direction]
          : animation.south?.length ? animation.south
          : animation[Object.keys(animation).find((key) => Array.isArray(animation[key]) && animation[key].length)] || [];
        return Math.max(1, frames.length);
      },
    };
  }

  function directionFromWorldDelta(dx, dy, fallback = "south") {
    if (Math.hypot(dx, dy) < 0.001) return fallback;
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
    const octant = Math.round(angle / (Math.PI / 4)) % 8;
    return ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][octant] || fallback;
  }

  function createActor(id, art, scale, cell, footOffset) {
    const image = document.createElement("img");
    image.id = id;
    image.alt = art.label;
    image.draggable = false;
    image.style.cssText = "position:absolute;image-rendering:pixelated;user-select:none;-webkit-user-drag:none;transform-origin:50% 100%;pointer-events:auto;filter:drop-shadow(0 3px 0 rgba(25,19,25,.22));";
    document.querySelector("#item-layer")?.append(image);
    return {
      image,
      art,
      scale,
      cell: { ...cell },
      from: { ...cell },
      to: { ...cell },
      moving: false,
      moveStartedAt: 0,
      direction: "south",
      animation: art.idleName,
      footOffset,
      frame: -1,
      lastPath: "",
    };
  }

  function floorCells() {
    const grid = window.TinyHouseStructure.grid;
    return [...grid.floors.values()].map((entry) => ({ column: entry.column, row: entry.row }));
  }

  function startCell(index = 0) {
    const cells = floorCells();
    if (!cells.length) throw new Error("Home has no floor cells for the player.");
    cells.sort((a, b) => (a.column + a.row) - (b.column + b.row));
    return cells[Math.min(cells.length - 1, Math.max(0, Math.floor(cells.length / 2) + index))] || cells[0];
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

  function startMove(actor, target, now = performance.now()) {
    if (!actor || actor.moving || !canStep(actor.cell, target)) return false;
    actor.from = { ...actor.cell };
    actor.to = { ...target };
    const fromPoint = worldPoint(actor.from);
    const toPoint = worldPoint(actor.to);
    actor.direction = directionFromWorldDelta(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y, actor.direction);
    actor.animation = actor.art.walkName;
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
    const candidates = [
      { column: cell.column + 1, row: cell.row },
      { column: cell.column - 1, row: cell.row },
      { column: cell.column, row: cell.row + 1 },
      { column: cell.column, row: cell.row - 1 },
    ];
    return candidates.filter((candidate) => canStep(cell, candidate));
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

  function actorPosition(actor, now) {
    let cell = actor.cell;
    let amount = 0;
    if (actor.moving) {
      amount = clamp((now - actor.moveStartedAt) / MOVE_MS, 0, 1);
      const smooth = amount * amount * (3 - 2 * amount);
      const from = worldPoint(actor.from);
      const to = worldPoint(actor.to);
      if (amount >= 1) {
        actor.cell = { ...actor.to };
        actor.moving = false;
        actor.animation = actor.art.idleName;
        cell = actor.cell;
        return { ...worldPoint(cell), moving: false };
      }
      return { x: from.x + (to.x - from.x) * smooth, y: from.y + (to.y - from.y) * smooth, moving: true };
    }
    return { ...worldPoint(cell), moving: false };
  }

  function renderActor(actor, now) {
    if (!actor) return;
    const point = actorPosition(actor, now);
    const animation = actor.moving ? actor.art.walkName : actor.art.idleName;
    const count = actor.art.frameCount(animation, actor.direction);
    const index = count <= 1 ? 0 : Math.floor(now / (actor.moving ? 110 : 230)) % count;
    const path = actor.art.framePath(animation, actor.direction, index);
    if (path && path !== actor.lastPath) {
      actor.lastPath = path;
      actor.image.src = privateUrl(actor.art.sha, path);
    }
    const width = Math.round(actor.art.width * actor.scale);
    const height = Math.round(actor.art.height * actor.scale);
    actor.image.style.width = `${width}px`;
    actor.image.style.height = `${height}px`;
    actor.image.style.left = `${Math.round(point.x - width / 2)}px`;
    actor.image.style.top = `${Math.round(point.y + actor.footOffset - height)}px`;
    actor.image.style.zIndex = String(1000 + Math.round((point.y + actor.footOffset) * 10 + 8));
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
    make("PET", () => { void bridge?.care?.("pet"); heartAt(buddy); });
    make("LEAVE HOME", () => bridge?.close?.());
    function sync() {
      play.style.background = mode === "play" ? "#3f756e" : "#755b58";
      idle.style.background = mode === "idle" ? "#3f756e" : "#755b58";
    }
    sync();
  }

  function installUiScale() {
    const value = clamp(Number(config.uiScale) || 1, 0.5, 2.5);
    document.documentElement.style.setProperty("--pb-home-ui-scale", String(value));
    const style = document.createElement("style");
    style.textContent = `#top-hud,.builder-panel,#selection-tools,#camera-tools,#mode-hint,#structure-panel,#blueprint-panel,#rooms-panel,#cozy-panel{zoom:var(--pb-home-ui-scale,1)}`;
    document.head.append(style);
  }

  function typingTarget(target) {
    return target instanceof Element && Boolean(target.closest("input,textarea,select,[contenteditable='true']"));
  }

  function installInput() {
    window.addEventListener("keydown", (event) => {
      if (typingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key)) {
        keys.add(key);
        if (mode === "play") event.preventDefault();
      }
    }, true);
    window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()), true);
    window.addEventListener("blur", () => keys.clear());
  }

  async function boot() {
    installUiScale();
    await waitForRuntime();
    const humanArt = await loadPixelLab(String(config.humanSha256 || ""), "Ani Iso Human");
    const humanCell = startCell(0);
    human = createActor("pb-home-human", humanArt, clamp(Number(config.humanScale) || 1.2, 0.8, 2), humanCell, HUMAN_FOOT_OFFSET);
    human.image.title = "Ani Iso Human — WASD / arrow keys";

    if (SHA256_RE.test(String(config.petSha256 || ""))) {
      try {
        const petArt = await loadPixelLab(String(config.petSha256), config.buddyName || "Buddy");
        const petCell = startCell(1);
        buddy = createActor("pb-home-buddy", petArt, clamp(Number(config.petScale) || 1, 0.25, 8), petCell, PET_FOOT_OFFSET);
        buddy.image.title = `${config.buddyName || "Buddy"} — click to pet`;
        buddy.image.addEventListener("click", (event) => {
          event.stopPropagation();
          void bridge?.care?.("pet");
          heartAt(buddy);
        });
      } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
      }
    }

    installControls();
    installInput();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    const dt = Math.min(50, now - lastFrameAt);
    lastFrameAt = now;
    void dt;
    maybeMoveHuman(now);
    maybeMoveIdleHuman(now);
    maybeMoveBuddy(now);
    renderActor(human, now);
    renderActor(buddy, now);
    requestAnimationFrame(loop);
  }

  boot().catch((error) => {
    console.error("Pocket Buddy Home actor bridge failed", error);
    showError(error instanceof Error ? error.message : String(error));
  });
})();
