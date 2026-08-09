(() => {
  "use strict";

  const config = window.POCKET_BUDDY_HOME_CONFIG || {};
  const bridge = window.PocketBuddyHome;
  const SHA256_RE = /^[0-9a-f]{64}$/;
  const HUMAN_FOOT_OFFSET = 0;
  const PET_FOOT_OFFSET = 0;
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
  const encodePath = (path) => String(path).split("/").map(encodeURIComponent).join("/");
  const privateUrl = (sha, path) => `/private/${sha}/${encodePath(path)}`;

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    keys.clear();
    bridge?.close?.();
  }, true);

  function showError(message) {
    let panel = document.querySelector("#pb-home-actor-error");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "pb-home-actor-error";
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
    // Combat and injury animations are never a resting or travelling pose. The
    // old fallback chain ended at names[0], which happily selected the very
    // `ani_idle_battle` clip the idle filter had just excluded — and its first
    // frame is nearly empty, so Ani rendered as a few stray pixels.
    const COMBAT = /battle|death|punch|attack|hurt|fall|roll|jump/i;
    const idleName = exact("ani_idle")
      || match(/idle/i, COMBAT)
      || match(/stand|relax|breath/i, COMBAT)
      || names.find((candidate) => !COMBAT.test(candidate))
      // Empty means "use the authored rotation sheet", which is the pack's
      // canonical standing pose. Better a true still frame than a combat frame.
      || "";
    const walkName = exact("ani_walk")
      || match(/walk/i, COMBAT)
      || exact("ani_run")
      || match(/run/i, COMBAT)
      || idleName;
    const anchorPath = rotations.south || rotations[Object.keys(rotations)[0]] || null;
    const anchor = anchorPath
      ? await measureAnchor(privateUrl(sha, anchorPath), Number(size.width), Number(size.height))
      : { centerX: Number(size.width) / 2, footY: Number(size.height), topY: 0, measured: false };

    return {
      sha,
      label,
      width: Number(size.width),
      height: Number(size.height),
      anchor,
      animations,
      rotations,
      idleName,
      walkName,
      framePath(animationName, direction, index) {
        const animation = animations[animationName] || animations[idleName] || {};
        const frames = animation[direction]?.length ? animation[direction]
          : animation.south?.length ? animation.south
          : animation[Object.keys(animation).find((key) => Array.isArray(animation[key]) && animation[key].length)] || [];
        if (frames.length) return frames[index % frames.length];
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

  /**
   * PixelLab frames pad the character inside a square canvas, and the padding
   * differs per pack (Ani occupies 17x48 of a 100x100 frame, with 28px of empty
   * space below her feet). Anchoring the frame's bottom edge to a tile centre
   * therefore leaves an actor floating above the floor.
   *
   * Measure the opaque bounding box of a representative frame once per pack and
   * anchor on the real feet and the real horizontal centre instead.
   */
  async function measureAnchor(url, width, height) {
    const fallback = { centerX: width / 2, footY: height, topY: 0, measured: false };
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("anchor frame failed to load"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || width;
      canvas.height = image.naturalHeight || height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

      let minX = canvas.width;
      let maxX = -1;
      let minY = canvas.height;
      let maxY = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (data[(canvas.width * y + x) * 4 + 3] <= 8) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxY < 0) return fallback;
      return { centerX: (minX + maxX + 1) / 2, footY: maxY + 1, topY: minY, measured: true };
    } catch {
      return fallback;
    }
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
    const image = document.createElement("img");
    image.id = id;
    image.alt = art.label;
    image.draggable = false;
    image.style.cssText = "position:absolute;image-rendering:pixelated;user-select:none;-webkit-user-drag:none;transform-origin:50% 100%;pointer-events:auto;filter:drop-shadow(0 3px 0 rgba(25,19,25,.22));";
    document.querySelector("#item-layer")?.append(image);
    return {
      id,
      label: art.label,
      image,
      art,
      scale,
      cell: { ...position },
      moving: false,
      direction: "south",
      footOffset,
      lastPath: "",
      target: null,
      targetUntil: 0,
      // Developer-only animation pin used by Pocket Buddy Studio. Empty in
      // normal play, where idle/walk is chosen from actual movement.
      animationOverride: "",
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
    if (!actor) return;
    const point = worldPoint(actor.cell);
    const animation = actor.animationOverride || (actor.moving ? actor.art.walkName : actor.art.idleName);
    const count = actor.art.frameCount(animation, actor.direction);
    const index = count <= 1 ? 0 : Math.floor(now / (actor.moving ? 110 : 230)) % count;
    const path = actor.art.framePath(animation, actor.direction, index);
    if (path && path !== actor.lastPath) {
      actor.lastPath = path;
      actor.image.src = privateUrl(actor.art.sha, path);
    }
    const width = Math.round(actor.art.width * actor.scale);
    const height = Math.round(actor.art.height * actor.scale);
    const anchor = actor.art.anchor;
    actor.image.style.width = `${width}px`;
    actor.image.style.height = `${height}px`;
    // Anchor the drawn character's own feet and centre to the tile point, not
    // the padded frame's bottom-left, so actors stand on the floor exactly.
    actor.image.style.left = `${Math.round(point.x - anchor.centerX * actor.scale)}px`;
    actor.image.style.top = `${Math.round(point.y + actor.footOffset - anchor.footY * actor.scale)}px`;
    actor.image.style.zIndex = String(1000 + Math.round((point.y + actor.footOffset) * 10 + 8));
  }

  function heartAt(actor) {
    if (!actor) return;
    const heart = document.createElement("div");
    heart.textContent = "♥";
    heart.style.cssText = "position:absolute;z-index:600000;color:#ff5c91;text-shadow:2px 0 #fff,-2px 0 #fff,0 2px #fff,0 -2px #fff;font:bold 24px monospace;pointer-events:none;transition:transform .7s linear,opacity .7s linear;";
    const point = worldPoint(actor.cell);
    const headHeight = (actor.art.anchor.footY - actor.art.anchor.topY) * actor.scale;
    heart.style.left = `${point.x - 10}px`;
    heart.style.top = `${point.y - headHeight - 10}px`;
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
    const play = make("CONTROL HUMAN · WASD", () => { mode = "play"; human && (human.target = null); sync(); });
    const idle = make("HOUSE CHILL", () => { mode = "idle"; keys.clear(); sync(); });
    make("PET", () => { void bridge?.care?.("pet"); heartAt(buddy); });
    make("DESKTOP HUMAN", () => bridge?.chill?.("human"));
    make("DESKTOP PET", () => bridge?.chill?.("pet"));
    make("LEAVE HOME", () => bridge?.close?.());
    make("QUIT GAME", () => bridge?.quit?.());
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

  // Developer-only inspection surface for Pocket Buddy Studio.
  //
  // Only installed when the main process injected `studio: true` into the Home
  // config, which itself only happens in an unpackaged build or under an
  // explicit POCKET_BUDDY_STUDIO opt-in. Production Home exposes nothing.
  function installStudioBridge() {
    if (!config.studio || window.PocketBuddyHomeStudio) return;
    const actorFor = (id) => [human, buddy].find((actor) => actor && actor.id === id) || null;
    const readable = (actor) => (actor ? {
      id: actor.id,
      label: actor.label,
      cell: { ...actor.cell },
      radius: window.PocketBuddyActorMotion?.DEFAULT_RADIUS ?? 0.1,
      direction: actor.direction,
      moving: actor.moving,
      animation: actor.animationOverride || (actor.moving ? actor.art.walkName : actor.art.idleName),
      scale: actor.scale,
    } : null);

    window.PocketBuddyHomeStudio = Object.freeze({
      actors: () => [human, buddy].filter(Boolean).map(readable),
      actor: (id) => readable(actorFor(id)),
      mode: () => mode,
      setMode(next) {
        if (!["play", "idle"].includes(String(next))) return mode;
        mode = String(next);
        if (mode === "idle") keys.clear();
        if (human) human.target = null;
        return mode;
      },
      buddyName: () => config.buddyName || "Buddy",
      animationNames: (id) => {
        const actor = actorFor(id);
        return actor ? Object.keys(actor.art.animations || {}) : [];
      },
      setAnimation(id, animation) {
        const actor = actorFor(id);
        if (!actor) return null;
        const names = Object.keys(actor.art.animations || {});
        actor.animationOverride = names.includes(String(animation)) ? String(animation) : "";
        actor.lastPath = "";
        return readable(actor);
      },
      /**
       * Screen-space nudge routed through the canonical motion core, so walls,
       * closed doors and floor bounds still apply and the resulting position
       * stays continuous. Studio must never reintroduce tile snapping.
       */
      nudge(id, dx, dy) {
        const actor = actorFor(id);
        const magnitude = Math.hypot(Number(dx) || 0, Number(dy) || 0);
        if (!actor || magnitude <= 0) return readable(actor);
        // moveScreen clamps dt to 0.05s, so scale speed to land on exact pixels.
        applyMotion(actor, window.PocketBuddyActorMotion.moveScreen(
          window.TinyHouseStructure.grid, actor.cell, Number(dx) || 0, Number(dy) || 0, 0.05, magnitude * 20,
        ));
        actor.target = null;
        return readable(actor);
      },
    });
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
    human = createActor("pb-home-human", humanArt, clamp(Number(config.humanScale) || 1.2, 0.8, 2), startCell(0), HUMAN_FOOT_OFFSET);
    human.image.title = "Ani Iso Human — WASD / arrow keys";

    if (!SHA256_RE.test(String(config.petSha256 || ""))) {
      // Say so rather than rendering an empty house and letting it read as a
      // missing feature. No substitute pet is invented.
      showError("No verified Buddy art pack is active, so Home has no pet. Pick a Buddy from My Pets, then reopen Home.");
    }

    if (SHA256_RE.test(String(config.petSha256 || ""))) {
      try {
        const petArt = await loadPixelLab(String(config.petSha256), config.buddyName || "Buddy");
        buddy = createActor("pb-home-buddy", petArt, clamp(Number(config.petScale) || 1, 0.25, 8), startCell(1), PET_FOOT_OFFSET);
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
    installStudioBridge();
    requestAnimationFrame(loop);
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

  boot().catch((error) => {
    console.error("Pocket Buddy Home actor bridge failed", error);
    showError(error instanceof Error ? error.message : String(error));
  });
})();
