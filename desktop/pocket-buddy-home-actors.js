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

  // East/west mirror partners. PixelLab exports occasionally author an
  // animation's directional folders mirrored relative to the pack's rotation
  // sheet, which makes a character walk facing the wrong way while standing
  // still looks correct.
  const MIRRORED_DIRECTION = Object.freeze({
    east: "west",
    west: "east",
    "south-east": "south-west",
    "south-west": "south-east",
    "north-east": "north-west",
    "north-west": "north-east",
    north: "north",
    south: "south",
  });

  const DRESSED_STATE = /wearing|clothed|dressed|outfit|jeans|shirt|hoodie|suit|uniform/i;

  /**
   * PixelLab packs ship several appearance states. Prefer a dressed state, and
   * prefer one that actually carries animations — an undressed base with a full
   * animation set is not a reason to render the character undressed.
   */
  function pickState(states) {
    const animated = states.filter((entry) => Object.keys(entry?.frames?.animations || {}).length > 0);
    const pool = animated.length ? animated : states;
    const dressed = pool.find((entry) => DRESSED_STATE.test(`${entry?.folder ?? ""} ${entry?.character?.name ?? ""}`));
    return dressed || pool[0] || null;
  }

  /** Alpha silhouette of one frame, used only for mirror detection. */
  async function silhouette(url) {
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("frame failed to load"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const mask = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < mask.length; index += 1) mask[index] = data[index * 4 + 3] > 8 ? 1 : 0;
      return { width: canvas.width, height: canvas.height, mask };
    } catch {
      return null;
    }
  }

  function maskDifference(a, b, mirror) {
    if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
    let total = 0;
    for (let y = 0; y < a.height; y += 1) {
      for (let x = 0; x < a.width; x += 1) {
        const bx = mirror ? a.width - 1 - x : x;
        total += Math.abs(a.mask[a.width * y + x] - b.mask[b.width * y + bx]);
      }
    }
    return total / (a.width * a.height);
  }

  /**
   * Decide whether an animation's directional folders are mirrored against the
   * pack's own rotation sheet. Verified to report Ani's walk as mirrored (6/6
   * directions) and the Balinese Cat's as not mirrored (0/6).
   */
  async function detectMirroredAnimation(sha, rotations, animation) {
    if (!animation) return false;
    let flipped = 0;
    let compared = 0;
    for (const direction of ["east", "west"]) {
      const rotationPath = rotations?.[direction];
      const framePath = animation?.[direction]?.[0];
      if (!rotationPath || !framePath) continue;
      const [rotation, frame] = await Promise.all([
        silhouette(privateUrl(sha, rotationPath)),
        silhouette(privateUrl(sha, framePath)),
      ]);
      if (!rotation || !frame) continue;
      compared += 1;
      if (maskDifference(frame, rotation, true) < maskDifference(frame, rotation, false)) flipped += 1;
    }
    return compared > 0 && flipped * 2 > compared;
  }

  async function loadPixelLab(sha, label) {
    if (!SHA256_RE.test(String(sha || ""))) throw new Error(`${label} art hash is missing or invalid.`);
    const response = await fetch(privateUrl(sha, "metadata.json"), { cache: "no-store" });
    if (!response.ok) throw new Error(`${label} metadata could not be read from its verified art pack.`);
    const metadata = await response.json();
    const state = pickState(Array.isArray(metadata?.states) ? metadata.states : []);
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

    const mirroredAnimations = await detectMirroredAnimation(sha, rotations, animations[walkName]);

    // Animation folders may be mirrored against the rotation sheet; rotations
    // are the pack's ground truth and are always read unmirrored.
    const framesFor = (animationName, direction) => {
      const animation = animations[animationName] || animations[idleName] || {};
      const key = mirroredAnimations ? (MIRRORED_DIRECTION[direction] || direction) : direction;
      return animation[key]?.length ? animation[key]
        : animation.south?.length ? animation.south
        : animation[Object.keys(animation).find((name) => Array.isArray(animation[name]) && animation[name].length)] || [];
    };

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
      mirroredAnimations,
      stateName: state?.character?.name || state?.folder || "",
      framePath(animationName, direction, index) {
        const frames = framesFor(animationName, direction);
        if (frames.length) return frames[index % frames.length];
        return rotations[direction] || rotations.south || rotations[Object.keys(rotations)[0]] || null;
      },
      frameCount(animationName, direction) {
        return Math.max(1, framesFor(animationName, direction).length);
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
      // Needs-driven life: what this actor wants, and what it is doing about it.
      needs: loadNeeds(id, { energy: 0.85, hunger: 0.8, hygiene: 0.85, fun: 0.75, social: 0.8 }),
      plan: null,
      busyUntil: 0,
      activity: "",
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

  const INTERACT_RANGE = 1.4;

  /** Nearest thing the player can act on: the Buddy, or useful furniture. */
  function nearestInteractable() {
    if (!human) return null;
    const options = [];
    if (buddy) {
      options.push({
        kind: "pet",
        label: `Pet ${config.buddyName || "Buddy"}`,
        distance: Math.hypot(buddy.cell.column - human.cell.column, buddy.cell.row - human.cell.row),
      });
    }
    for (const candidate of furnitureCandidates(human)) {
      options.push({
        kind: "use",
        label: `${candidate.affordance.action} · ${candidate.label}`,
        affordance: candidate.affordance,
        distance: Math.hypot(candidate.cell.column - human.cell.column, candidate.cell.row - human.cell.row),
      });
    }
    const inRange = options.filter((option) => option.distance <= INTERACT_RANGE);
    inRange.sort((a, b) => a.distance - b.distance);
    return inRange[0] || null;
  }

  function showPrompt(text) {
    let prompt = document.querySelector("#pb-home-interact-prompt");
    if (!text) { prompt?.remove(); return; }
    if (!prompt) {
      prompt = document.createElement("div");
      prompt.id = "pb-home-interact-prompt";
      document.querySelector("#game-shell")?.append(prompt);
    }
    if (prompt.textContent !== text) prompt.textContent = text;
  }

  /** The player's interact verb. Without this there was nothing to press. */
  function playerInteract() {
    const target = nearestInteractable();
    if (!human || !target) return;
    if (target.kind === "pet") {
      void bridge?.care?.("pet");
      heartAt(buddy);
      human.needs = window.PocketBuddyAffordances.satisfy(human.needs, { need: "social", gain: 0.35, seconds: 1 }, 1);
      if (buddy) buddy.needs = window.PocketBuddyAffordances.satisfy(buddy.needs, { need: "social", gain: 0.5, seconds: 1 }, 1);
      return;
    }
    human.plan = { affordance: target.affordance, path: [], label: target.label };
    human.busyUntil = performance.now() + target.affordance.seconds * 1000;
    human.activity = target.label;
  }

  function maybeMoveHuman(dt) {
    if (!human) return;
    if (mode !== "play") { human.moving = false; return; }

    // Mid-interaction the player stands still and takes the benefit; any
    // movement key cancels it.
    const now = performance.now();
    if (human.busyUntil > now) {
      const vector = desiredHumanVector();
      if (vector.x || vector.y) { human.busyUntil = 0; human.plan = null; human.activity = ""; }
      else {
        human.moving = false;
        human.needs = window.PocketBuddyAffordances.satisfy(human.needs, human.plan?.affordance, dt);
        return;
      }
    }
    human.needs = window.PocketBuddyAffordances.decay(human.needs, dt);
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

  // ---------------------------------------------------------- needs-driven life

  const NEEDS_KEY = "pocket-buddy.home.needs.v1";
  const NEEDS_SAVE_MS = 4000;
  let lastNeedsSaveAt = 0;

  /**
   * Restore needs from the previous session.
   *
   * Currently effective within a session only: Home is served from
   * http://127.0.0.1:<random port>, so each launch is a different origin and
   * localStorage starts empty. House saves and Cozy state share this flaw.
   * This becomes real persistence once Home has a stable origin.
   */
  function loadNeeds(id, fallback) {
    try {
      const stored = JSON.parse(localStorage.getItem(NEEDS_KEY) || "{}");
      const saved = stored?.[id];
      if (!saved || typeof saved !== "object") return fallback;
      const restored = { ...fallback };
      for (const name of window.PocketBuddyAffordances?.NEEDS ?? Object.keys(fallback)) {
        const value = Number(saved[name]);
        if (Number.isFinite(value)) restored[name] = clamp(value, 0, 1);
      }
      return restored;
    } catch {
      return fallback;
    }
  }

  function saveNeeds(now) {
    if (now - lastNeedsSaveAt < NEEDS_SAVE_MS) return;
    lastNeedsSaveAt = now;
    try {
      const payload = {};
      for (const actor of [human, buddy]) if (actor?.id) payload[actor.id] = actor.needs;
      localStorage.setItem(NEEDS_KEY, JSON.stringify(payload));
    } catch { /* a full or blocked store must never break the game loop */ }
  }

  /** Placed furniture that offers something, with its walkable cell. */
  function furnitureCandidates(actor) {
    const affordances = window.PocketBuddyAffordances;
    const state = window.TinyHousePlayable?.state;
    const grid = window.TinyHouseStructure?.grid;
    if (!affordances || !state || !grid) return [];

    const assets = new Map((state.manifest || []).map((asset) => [asset.id, asset]));
    const candidates = [];
    for (const placement of state.placements || []) {
      const asset = assets.get(placement.assetId);
      if (!asset) continue;
      const affordance = affordances.affordancesFor(asset)[0];
      if (!affordance) continue;
      const cell = { column: Math.round(placement.column), row: Math.round(placement.row) };
      if (!grid.hasFloor(cell.column, cell.row)) continue;
      candidates.push({
        id: placement.id,
        affordance,
        cell,
        label: asset.name || affordance.action,
        distance: Math.abs(cell.column - actor.cell.column) + Math.abs(cell.row - actor.cell.row),
      });
    }
    return candidates;
  }

  /**
   * Decide what an actor wants, walk there through the canonical floor graph,
   * and let the interaction pay off. Falls back to wandering when nothing is
   * needed or nothing is reachable, so an empty house still feels alive.
   */
  function liveAutonomously(actor, now, dt, speed) {
    const affordances = window.PocketBuddyAffordances;
    const pathfinding = window.PocketBuddyPathfinding;
    const motion = window.PocketBuddyActorMotion;
    const grid = window.TinyHouseStructure?.grid;
    if (!affordances || !pathfinding || !motion || !grid) return moveAutonomous(actor, now, dt, speed);

    actor.needs = affordances.decay(actor.needs, dt);

    // Mid-interaction: stay put and take the benefit.
    if (actor.busyUntil > now && actor.plan?.affordance) {
      actor.moving = false;
      actor.needs = affordances.satisfy(actor.needs, actor.plan.affordance, dt);
      return;
    }
    if (actor.busyUntil && actor.busyUntil <= now) {
      actor.busyUntil = 0;
      actor.plan = null;
      actor.activity = "";
    }

    if (!actor.plan) {
      const chosen = affordances.chooseAction(furnitureCandidates(actor), actor.needs);
      const path = chosen ? pathfinding.findPath(grid, actor.cell, chosen.cell) : [];
      if (chosen && path.length) {
        actor.plan = { affordance: chosen.affordance, path, label: chosen.label };
        actor.activity = `${chosen.affordance.action} · ${chosen.label}`;
      } else {
        actor.activity = "";
        return moveAutonomous(actor, now, dt, speed);
      }
    }

    actor.plan.path = pathfinding.advancePath(actor.plan.path, actor.cell);
    const next = actor.plan.path[0];
    // advancePath always keeps the final waypoint so the actor has something to
    // steer at, which means an empty path is not how arrival shows up: standing
    // on the last node is. Without this the actor reached the furniture and
    // then stood there forever while its needs kept draining.
    const arrived = !next
      || (actor.plan.path.length === 1
        && Math.hypot(next.column - actor.cell.column, next.row - actor.cell.row) <= 0.4);
    if (arrived) {
      actor.busyUntil = now + actor.plan.affordance.seconds * 1000;
      actor.plan.path = [];
      actor.moving = false;
      return;
    }

    const result = motion.moveToward(grid, actor.cell, next, dt, speed, 4);
    applyMotion(actor, result);
    // Blocked (a door closed behind us, furniture moved): re-plan next tick.
    if (!result.moved && !result.reached) actor.plan = null;
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
    liveAutonomously(buddy, now, dt, BUDDY_IDLE_SPEED_PX);
  }

  function maybeMoveIdleHuman(now, dt) {
    if (!human || mode !== "idle") return;
    liveAutonomously(human, now, dt, HUMAN_IDLE_SPEED_PX);
  }

  function renderActor(actor, now) {
    if (!actor) return;
    // TinyHouse re-renders #item-layer with replaceChildren whenever furniture
    // changes, which detaches the actors. Re-attach instead of leaving the
    // player and pets permanently invisible with no way to bring them back.
    if (!actor.image.isConnected) document.querySelector("#item-layer")?.append(actor.image);
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
    // The panel was fully built and then never inserted, so Home shipped with
    // no way to switch modes, pet the Buddy, or leave except the Escape key.
    shell.append(controls);
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
      // Surfaced so Studio can show why a character faces the way it does.
      appearance: actor.art.stateName,
      needs: { ...actor.needs },
      activity: actor.activity || "",
      busy: actor.busyUntil > performance.now(),
      mirroredAnimations: Boolean(actor.art.mirroredAnimations),
      frameSrc: actor.lastPath,
      attached: actor.image.isConnected,
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

  /**
   * Minimal always-on view API (distinct from the dev-only studio bridge) so
   * the overlay shell can point the camera at whoever you are playing.
   */
  function installViewApi() {
    if (window.PocketBuddyHomeView) return;
    window.PocketBuddyHomeView = Object.freeze({
      playerPoint() {
        const actor = human || buddy;
        if (!actor || !window.TinyHouseStructure?.grid) return null;
        const point = worldPoint(actor.cell);
        return { x: point.x, y: point.y, id: actor.id };
      },
      hasPlayer: () => Boolean(human || buddy),
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
    window.addEventListener("keydown", (event) => {
      if (typingTarget(event.target) || event.key.toLowerCase() !== "e") return;
      event.preventDefault();
      playerInteract();
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
    installViewApi();
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
    if (mode === "play" && human) {
      const target = human.busyUntil > now ? null : nearestInteractable();
      showPrompt(target ? `E · ${target.label}` : "");
    } else showPrompt("");
    saveNeeds(now);
    requestAnimationFrame(loop);
  }

  boot().catch((error) => {
    console.error("Pocket Buddy Home actor bridge failed", error);
    showError(error instanceof Error ? error.message : String(error));
  });
})();
