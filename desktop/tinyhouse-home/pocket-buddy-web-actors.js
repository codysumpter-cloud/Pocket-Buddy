(() => {
  "use strict";

  if (window.parent === window) return;
  let buddyApi;
  try { buddyApi = window.parent.PocketBuddy; } catch { return; }
  if (!buddyApi?.library || !buddyApi?.runtime) return;

  const HUMAN_FOOT_OFFSET = 18;
  const PET_FOOT_OFFSET = 10;
  const HUMAN_SPEED_PX = 155;
  const HUMAN_IDLE_SPEED_PX = 92;
  const BUDDY_SPEED_PX = 112;
  const BUDDY_IDLE_SPEED_PX = 82;
  const keys = new Set();
  let mode = "play";
  let human = null;
  let buddy = null;
  let lastFrameAt = performance.now();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    keys.clear();
    buddyApi.home?.close?.();
  }, true);

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
      if (window.TinyHousePlayable?.cellCenter && window.TinyHouseStructure?.grid && window.PocketBuddyActorMotion?.moveScreen) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error("The canonical TinyHouse runtime did not finish starting.");
  }

  function runtimeArt(runtime, label) {
    const pack = runtime?.pack;
    if (!pack || !Number.isFinite(Number(pack.frameWidth)) || !Number.isFinite(Number(pack.frameHeight))) return null;
    return {
      type: "runtime",
      label,
      width: Number(pack.frameWidth),
      height: Number(pack.frameHeight),
      draw(ctx, semantic, direction, now, scale, width, height) {
        ctx.clearRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = false;
        buddyApi.runtime.drawRuntime(runtime, ctx, semantic, direction, now, width / 2, height, scale);
      },
    };
  }

  function pocketBirdArt() {
    const host = window.parent.document.getElementById("birb-shadow-host");
    const source = host?.shadowRoot?.getElementById("birb");
    if (!(source instanceof window.parent.HTMLCanvasElement)) return null;
    return {
      type: "pocket-bird",
      label: "Pocket Bird",
      width: Math.max(1, source.width || 32),
      height: Math.max(1, source.height || 32),
      draw(ctx, _semantic, _direction, _now, _scale, width, height) {
        ctx.clearRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0, width, height);
      },
    };
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

  function worldPoint(position) {
    return window.PocketBuddyActorMotion.worldPoint(position, window.TinyHouseStructure.grid);
  }

  function createActor(id, art, scale, position, footOffset) {
    const canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.setAttribute("aria-label", art.label);
    canvas.style.cssText = "position:absolute;image-rendering:pixelated;user-select:none;pointer-events:auto;filter:drop-shadow(0 3px 0 rgba(25,19,25,.22));";
    document.querySelector("#item-layer")?.append(canvas);
    return {
      canvas,
      ctx: canvas.getContext("2d"),
      art,
      scale,
      cell: { ...position },
      moving: false,
      direction: "south",
      footOffset,
      target: null,
      targetUntil: 0,
    };
  }

  function desiredHumanVector() {
    const up = keys.has("w") || keys.has("arrowup");
    const down = keys.has("s") || keys.has("arrowdown");
    const left = keys.has("a") || keys.has("arrowleft");
    const right = keys.has("d") || keys.has("arrowright");
    return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
  }

  function applyMotion(actor, result) {
    actor.cell = { ...result.position };
    actor.moving = Boolean(result.moved);
    if (result.moved) actor.direction = directionFromWorldDelta(result.dx, result.dy, actor.direction);
  }

  function maybeMoveHuman(dt) {
    if (!human) return;
    if (mode !== "play") { human.moving = false; return; }
    const vector = desiredHumanVector();
    if (!vector.x && !vector.y) { human.moving = false; return; }
    applyMotion(human, window.PocketBuddyActorMotion.moveScreen(window.TinyHouseStructure.grid, human.cell, vector.x, vector.y, dt, HUMAN_SPEED_PX));
  }

  function ensureWanderTarget(actor, now) {
    const motion = window.PocketBuddyActorMotion;
    const grid = window.TinyHouseStructure.grid;
    if (!actor.target || motion.distancePx(grid, actor.cell, actor.target) <= 7 || now >= actor.targetUntil) {
      actor.target = motion.randomFloorPoint(grid);
      actor.targetUntil = now + 900 + Math.random() * 1900;
    }
    return actor.target;
  }

  function moveAutonomous(actor, now, dt, speed) {
    if (!actor) return;
    const motion = window.PocketBuddyActorMotion;
    const grid = window.TinyHouseStructure.grid;
    const target = ensureWanderTarget(actor, now);
    if (!target) { actor.moving = false; return; }
    const result = motion.moveToward(grid, actor.cell, target, dt, speed, 6);
    applyMotion(actor, result);
    if (!result.moved && !result.reached) { actor.target = null; actor.targetUntil = 0; }
  }

  function maybeMoveBuddy(now, dt) {
    if (!buddy) return;
    const motion = window.PocketBuddyActorMotion;
    const grid = window.TinyHouseStructure.grid;
    if (mode === "play" && human) {
      buddy.target = null;
      if (motion.distancePx(grid, buddy.cell, human.cell) > 72) {
        applyMotion(buddy, motion.moveToward(grid, buddy.cell, human.cell, dt, BUDDY_SPEED_PX, 62));
      } else buddy.moving = false;
      return;
    }
    moveAutonomous(buddy, now, dt, BUDDY_IDLE_SPEED_PX);
  }

  function maybeMoveIdleHuman(now, dt) {
    if (!human || mode !== "idle") return;
    moveAutonomous(human, now, dt, HUMAN_IDLE_SPEED_PX);
  }

  function renderActor(actor, now) {
    if (!actor?.ctx) return;
    const point = worldPoint(actor.cell);
    const semantic = actor.moving ? "running" : "idle";
    const width = Math.max(1, Math.round(actor.art.width * actor.scale));
    const height = Math.max(1, Math.round(actor.art.height * actor.scale));
    if (actor.canvas.width !== width || actor.canvas.height !== height) {
      actor.canvas.width = width;
      actor.canvas.height = height;
    }
    actor.art.draw(actor.ctx, semantic, actor.direction, now, actor.scale, width, height);
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
    const play = make("PLAY", () => { mode = "play"; human && (human.target = null); sync(); });
    const idle = make("IDLE", () => { mode = "idle"; keys.clear(); sync(); });
    make("PET", () => { void buddyApi.care?.("pet"); heartAt(buddy); });
    make("LEAVE HOME", () => buddyApi.home?.close?.());
    function sync() {
      play.style.background = mode === "play" ? "#3f756e" : "#755b58";
      idle.style.background = mode === "idle" ? "#3f756e" : "#755b58";
    }
    sync();
  }

  function installInput() {
    window.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input,textarea,select,[contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        keys.add(key);
        if (mode === "play") event.preventDefault();
      }
    }, true);
    window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()), true);
    window.addEventListener("blur", () => keys.clear());
  }

  async function start() {
    try {
      await waitForRuntime();
      installUiScale();
      const humanId = await buddyApi.library.homeHumanId();
      const humanRuntime = humanId ? await buddyApi.runtime.runtimeFor(humanId) : null;
      if (!humanRuntime) throw new Error("Import Ani Iso Human in Pocket Buddy → My Pets and select it as the Home player.");
      const humanArt = runtimeArt(humanRuntime, humanRuntime.pack.displayName || "Ani Iso Human");
      if (!humanArt) throw new Error("The selected Home human could not be rendered from its installed pack.");

      const activeId = await buddyApi.library.activeId();
      const customRuntime = activeId && activeId !== "pocket-bird" ? await buddyApi.runtime.runtimeFor(activeId) : null;
      const buddyArt = customRuntime ? runtimeArt(customRuntime, customRuntime.pack.displayName || "Buddy") : pocketBirdArt();

      human = createActor("pb-web-home-human", humanArt, 1.2, startCell(0), HUMAN_FOOT_OFFSET);
      if (buddyArt) {
        buddy = createActor("pb-web-home-buddy", buddyArt, clamp(Number(buddyApi.runtime.scaleMultiplier?.()) || 1, 0.25, 8), startCell(1), PET_FOOT_OFFSET);
        buddy.canvas.addEventListener("click", (event) => {
          event.stopPropagation();
          void buddyApi.care?.("pet");
          heartAt(buddy);
        });
      }

      installControls();
      installInput();
      requestAnimationFrame(loop);
    } catch (error) {
      console.error("Pocket Buddy web Home actor bridge failed", error);
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    maybeMoveHuman(dt);
    maybeMoveBuddy(now, dt);
    maybeMoveIdleHuman(now, dt);
    renderActor(human, now);
    renderActor(buddy, now);
    requestAnimationFrame(loop);
  }

  void start();
})();
