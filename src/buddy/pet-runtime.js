const MOTION_EPSILON = 0.35;
const HEART_DURATION_MS = 1650;
const HEART_PIXELS = [
  "01100110",
  "11111111",
  "11111111",
  "01111110",
  "00111100",
  "00011000",
];

function directionFromVector(dx, dy, fallback = "south") {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < MOTION_EPSILON) return fallback;
  const octant = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"][octant] ?? fallback;
}

function firstDirection(frames = {}) {
  return ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"].find((direction) => frames[direction]?.length);
}

function frameIndex(durationMs, count, now) {
  return count <= 1 ? 0 : Math.floor((now % Math.max(1, durationMs)) / Math.max(1, durationMs / count)) % count;
}

function cssNumber(shadowRoot, name, fallback = 1) {
  const host = shadowRoot?.host;
  if (!host) return fallback;
  const raw = getComputedStyle(host).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function createPetRuntime(library, shadowRoot) {
  const imageCache = new Map();
  const pending = new Map();
  let active = null;
  let base = null;
  let overlay = null;
  let overlayCtx = null;
  let heart = null;
  let raf = 0;
  let lastCenter = null;
  let lastMovedAt = 0;
  let lastDirection = "south";
  let forcedSemantic = null;
  let forcedUntil = 0;
  let heartUntil = 0;
  let petHoverTimes = [];
  let rootListenersInstalled = false;

  async function imageFor(runtime, path, mime = "image/png") {
    const key = `${runtime.pack.id}:${path}`;
    if (imageCache.has(key)) return imageCache.get(key);
    if (pending.has(key)) return null;
    pending.set(key, true);
    try {
      const bytes = await runtime.zip.read(path);
      const blob = new Blob([bytes], { type: mime });
      let drawable;
      if (typeof createImageBitmap === "function") {
        drawable = await createImageBitmap(blob);
      } else {
        drawable = await new Promise((resolve, reject) => {
          const url = URL.createObjectURL(blob);
          const image = new Image();
          image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
          image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not decode ${path}`)); };
          image.src = url;
        });
      }
      imageCache.set(key, drawable);
      return drawable;
    } catch (error) {
      console.warn("Pocket Buddy: pet frame decode failed", error);
      return null;
    } finally {
      pending.delete(key);
    }
  }

  function scaleMultiplier() {
    return cssNumber(shadowRoot, "--birb-scale", 1);
  }

  function uiScaleMultiplier() {
    return cssNumber(shadowRoot, "--birb-ui-scale", 1);
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("canvas");
    overlay.id = "pocket-buddy-custom-pet";
    overlay.style.cssText = "position:fixed;left:0;top:0;z-index:2147483638;pointer-events:none;image-rendering:pixelated;transform-origin:bottom center;";
    overlayCtx = overlay.getContext("2d");
    overlayCtx.imageSmoothingEnabled = false;
    shadowRoot.appendChild(overlay);
  }

  function ensureHeart() {
    if (heart) return heart;
    const style = document.createElement("style");
    style.id = "pb-pet-heart-style";
    style.textContent = `
      #pb-pet-heart{position:fixed;z-index:2147483644;pointer-events:none;image-rendering:pixelated;transform-origin:center bottom;display:none}
      #pb-pet-heart.pb-heart-pop{display:block;animation:pb-heart-pop ${HEART_DURATION_MS}ms steps(6,end) both}
      @keyframes pb-heart-pop{0%{opacity:0;transform:translateY(5px) scale(.65)}10%{opacity:1;transform:translateY(0) scale(1)}65%{opacity:1;transform:translateY(-8px) scale(1.15)}100%{opacity:0;transform:translateY(-16px) scale(.9)}}
    `;
    shadowRoot.appendChild(style);
    heart = document.createElement("canvas");
    heart.id = "pb-pet-heart";
    heart.width = 16;
    heart.height = 12;
    const ctx = heart.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = getComputedStyle(shadowRoot.host).getPropertyValue("--birb-highlight").trim() || "#ff6fa9";
      for (let y = 0; y < HEART_PIXELS.length; y += 1) {
        for (let x = 0; x < HEART_PIXELS[y].length; x += 1) {
          if (HEART_PIXELS[y][x] === "1") ctx.fillRect(x * 2, y * 2, 2, 2);
        }
      }
    }
    shadowRoot.appendChild(heart);
    return heart;
  }

  function showHeart(durationMs = HEART_DURATION_MS) {
    if (!active) return;
    const element = ensureHeart();
    heartUntil = performance.now() + Math.max(500, durationMs);
    element.classList.remove("pb-heart-pop");
    void element.offsetWidth;
    element.style.animationDuration = `${Math.max(500, durationMs)}ms`;
    element.classList.add("pb-heart-pop");
  }

  function placeHeart() {
    if (!heart || !base || !active) return;
    if (performance.now() >= heartUntil) {
      heart.classList.remove("pb-heart-pop");
      heart.style.display = "none";
      return;
    }
    const rect = base.getBoundingClientRect();
    const scale = Math.max(0.75, scaleMultiplier());
    const width = Math.round(16 * scale);
    const height = Math.round(12 * scale);
    heart.style.width = `${width}px`;
    heart.style.height = `${height}px`;
    heart.style.left = `${Math.round(rect.left + rect.width / 2 + 4 * scale)}px`;
    heart.style.top = `${Math.round(rect.top - 8 * scale)}px`;
  }

  async function select(id) {
    lastCenter = null;
    if (id === "pocket-bird" || !id) {
      active = null;
      if (base) base.style.opacity = "";
      if (overlay) overlay.style.display = "none";
      if (heart) heart.style.display = "none";
      return;
    }
    active = await library.loadRuntime(id);
    if (!active) {
      if (base) base.style.opacity = "";
      if (overlay) overlay.style.display = "none";
      return;
    }
    ensureOverlay();
    overlay.style.display = "block";
    if (base) base.style.opacity = "0";
    if (active.pack.source === "openpets") void imageFor(active, active.pack.sheetPath, "image/webp");
  }

  function resolvePixelLabFrame(runtime, semantic, direction, now) {
    const pack = runtime.pack;
    const requested = pack.semanticDefaults?.[semantic] ?? pack.semanticDefaults?.idle;
    const animation = pack.animations?.find((item) => item.id === requested)
      ?? pack.animations?.find((item) => item.complete)
      ?? pack.animations?.[0];
    if (!animation) return null;
    const resolvedDirection = animation.frames?.[direction]?.length
      ? direction
      : animation.frames?.south?.length ? "south" : firstDirection(animation.frames);
    const paths = animation.frames?.[resolvedDirection] ?? [];
    if (!paths.length) return null;
    return {
      path: paths[frameIndex(animation.durationMs ?? 1000, paths.length, now)],
      mime: "image/png",
      width: pack.frameWidth,
      height: pack.frameHeight,
    };
  }

  function resolveOpenPetsFrame(runtime, semantic, direction, now) {
    const pack = runtime.pack;
    let stateId = pack.semanticDefaults?.[semantic] ?? "idle";
    if (semantic === "running") {
      stateId = direction.includes("west") ? "running-left" : direction.includes("east") ? "running-right" : "running";
    }
    const state = pack.standardStates?.[stateId] ?? pack.standardStates?.idle;
    if (!state) return null;
    const index = frameIndex(state.durationMs ?? 1000, state.frames ?? 1, now);
    return {
      sheetPath: pack.sheetPath,
      mime: "image/webp",
      sx: index * pack.frameWidth,
      sy: state.row * pack.frameHeight,
      width: pack.frameWidth,
      height: pack.frameHeight,
    };
  }

  async function getFrame(runtime, semantic = "idle", direction = "south", now = Date.now()) {
    if (!runtime) return null;
    if (runtime.pack.source === "pixellab") {
      const frame = resolvePixelLabFrame(runtime, semantic, direction, now);
      if (!frame) return null;
      const image = await imageFor(runtime, frame.path, frame.mime);
      return image ? { image, sx: 0, sy: 0, sw: frame.width, sh: frame.height } : null;
    }
    const frame = resolveOpenPetsFrame(runtime, semantic, direction, now);
    if (!frame) return null;
    const image = await imageFor(runtime, frame.sheetPath, frame.mime);
    return image ? { image, sx: frame.sx, sy: frame.sy, sw: frame.width, sh: frame.height } : null;
  }

  function requestFrame(runtime, semantic, direction, now, callback) {
    void getFrame(runtime, semantic, direction, now).then((frame) => { if (frame) callback(frame); });
  }

  function drawOverlay(now) {
    if (!active || !base || !overlay || !overlayCtx) return;
    const rect = base.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (lastCenter) {
      const dx = center.x - lastCenter.x;
      const dy = center.y - lastCenter.y;
      if (Math.hypot(dx, dy) >= MOTION_EPSILON) {
        lastDirection = directionFromVector(dx, dy, lastDirection);
        lastMovedAt = now;
      }
    }
    lastCenter = center;
    const semantic = forcedSemantic && now < forcedUntil ? forcedSemantic : (now - lastMovedAt < 180 ? "running" : "idle");
    const pack = active.pack;
    const scale = scaleMultiplier();
    const width = Math.max(1, Math.round(pack.frameWidth * scale));
    const height = Math.max(1, Math.round(pack.frameHeight * scale));
    if (overlay.width !== pack.frameWidth || overlay.height !== pack.frameHeight) {
      overlay.width = pack.frameWidth;
      overlay.height = pack.frameHeight;
      overlayCtx.imageSmoothingEnabled = false;
    }
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
    overlay.style.left = `${Math.round(rect.left + rect.width / 2 - width / 2)}px`;
    overlay.style.top = `${Math.round(rect.bottom - height)}px`;
    requestFrame(active, semantic, lastDirection, now, (frame) => {
      if (!active || !overlayCtx) return;
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      overlayCtx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, overlay.width, overlay.height);
    });
    placeHeart();
  }

  function loop(now) {
    drawOverlay(now);
    raf = requestAnimationFrame(loop);
  }

  function isOriginalFieldGuideSpecies(target) {
    if (!(target instanceof Element)) return false;
    const item = target.closest("#birb-field-guide .birb-grid-item");
    return Boolean(item && !item.closest(".pb-guide-panel[hidden], .pb-guide-tools, .pb-guide-grid"));
  }

  function rootClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isOriginalFieldGuideSpecies(target)) {
      void library.setActive("pocket-bird").then(() => select("pocket-bird"));
      return;
    }
    const menuItem = target.closest(".birb-menu-item");
    if (menuItem?.textContent?.trim() === "Pet Buddy") showHeart();
    const button = target.closest("button");
    if (button?.textContent?.trim() === "Pet" && button.closest("#pb-care, .pb-home")) showHeart();
  }

  function baseMouseOver() {
    const now = Date.now();
    petHoverTimes = [...petHoverTimes.filter((time) => now - time < 1000), now].slice(-10);
    if (active && petHoverTimes.length >= 3) {
      showHeart();
      petHoverTimes = [];
    }
  }

  function installRootListeners() {
    if (rootListenersInstalled) return;
    rootListenersInstalled = true;
    shadowRoot.addEventListener("click", rootClick, true);
    base?.addEventListener("mouseover", baseMouseOver);
    base?.addEventListener("touchmove", () => showHeart(), { passive: true });
  }

  async function start() {
    base = shadowRoot.getElementById("birb");
    if (!base) return false;
    installRootListeners();
    await select(await library.activeId());
    if (!raf) raf = requestAnimationFrame(loop);
    return true;
  }

  function drawRuntime(runtime, ctx, semantic, direction, now, x, y, scale = 1) {
    if (!runtime) return;
    requestFrame(runtime, semantic, direction, now, (frame) => {
      const width = runtime.pack.frameWidth * scale;
      const height = runtime.pack.frameHeight * scale;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        frame.image,
        frame.sx,
        frame.sy,
        frame.sw,
        frame.sh,
        Math.round(x - width / 2),
        Math.round(y - height),
        Math.round(width),
        Math.round(height),
      );
      ctx.restore();
    });
  }

  return {
    start,
    select,
    react(reaction, durationMs = 1500) {
      const heartReaction = reaction === "heart" || reaction === "pet" || reaction === "waving";
      if (heartReaction) showHeart(Math.max(HEART_DURATION_MS, durationMs));
      const semantic = ({
        thinking: "review",
        working: "running",
        editing: "running",
        running: "running",
        testing: "waiting",
        waiting: "waiting",
        waving: "waving",
        heart: "idle",
        pet: "idle",
        success: "jumping",
        celebrating: "jumping",
        error: "failed",
        eating: "eating",
        idle: "idle",
      })[reaction] ?? "idle";
      forcedSemantic = semantic;
      forcedUntil = performance.now() + Math.max(200, durationMs);
    },
    activePack() { return active?.pack ?? null; },
    activeRuntime() { return active; },
    async runtimeFor(id) { return id ? library.loadRuntime(id) : null; },
    scaleMultiplier,
    uiScaleMultiplier,
    drawRuntime,
    drawActive(ctx, semantic, direction, now, x, y, scale = 1) {
      drawRuntime(active, ctx, semantic, direction, now, x, y, scale);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (base) base.style.opacity = "";
      shadowRoot.removeEventListener("click", rootClick, true);
      base?.removeEventListener("mouseover", baseMouseOver);
      rootListenersInstalled = false;
      overlay?.remove();
      overlay = null;
      heart?.remove();
      heart = null;
      shadowRoot.getElementById("pb-pet-heart-style")?.remove();
    },
  };
}
