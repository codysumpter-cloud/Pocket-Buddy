(() => {
  "use strict";

  // Pocket Buddy Studio agent.
  //
  // Injected (developer builds only) into the REAL Pocket Buddy windows: the
  // transparent desktop overlay and the canonical Home window. It never draws
  // the world itself — it reads the live DOM and the canonical TinyHouse grid,
  // and paints a debug layer inside the real #world-stage so overlays inherit
  // the real camera transform. There is exactly one Home renderer and this is
  // not it.
  //
  // Studio (main process) drives every method through executeJavaScript, so no
  // production preload or IPC surface changes are needed.

  if (window.__POCKET_BUDDY_STUDIO__) return;

  const core = window.PocketBuddyStudioCore;
  const MAX_NODES = 900;
  const MAX_CONSOLE = 300;
  const OVERLAY_DEFAULTS = Object.freeze({
    walkable: true,
    edges: true,
    collision: true,
    footprints: false,
    labels: true,
  });

  const refsById = new Map();
  const idsByElement = new WeakMap();
  let refCounter = 0;
  let selectionRef = "";
  let pickMode = false;
  let overlays = { ...OVERLAY_DEFAULTS };
  let overlayEnabled = false;
  let canvas = null;
  let frameHandle = 0;
  const consoleBuffer = [];

  const isHome = () => Boolean(document.querySelector("#world-stage"));
  const surface = isHome() ? "home" : "desktop";
  const homeBridge = () => window.PocketBuddyHomeStudio || null;
  const number = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  function ok(payload = {}) {
    return { ok: true, ...payload };
  }

  function fail(error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  function guard(fn) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        return fail(error);
      }
    };
  }

  // ---------------------------------------------------------------- console

  function pushConsole(level, args) {
    consoleBuffer.push({
      level,
      at: Date.now(),
      text: args.map((value) => {
        if (typeof value === "string") return value;
        if (value instanceof Error) return `${value.name}: ${value.message}`;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }).join(" ").slice(0, 2000),
    });
    while (consoleBuffer.length > MAX_CONSOLE) consoleBuffer.shift();
  }

  function captureConsole() {
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const original = console[level];
      if (typeof original !== "function") continue;
      console[level] = function patched(...args) {
        pushConsole(level, args);
        return original.apply(this, args);
      };
    }
    window.addEventListener("error", (event) => {
      pushConsole("error", [event.message || "Uncaught error", event.filename ? `${event.filename}:${event.lineno}` : ""]);
    });
    window.addEventListener("unhandledrejection", (event) => {
      pushConsole("error", ["Unhandled rejection:", event.reason]);
    });
  }

  // ------------------------------------------------------------------ refs

  function refFor(element) {
    if (!(element instanceof Element)) return "";
    const existing = idsByElement.get(element);
    if (existing && refsById.get(existing) === element) return existing;
    refCounter += 1;
    const id = `ref-${refCounter}`;
    idsByElement.set(element, id);
    refsById.set(id, element);
    return id;
  }

  function elementFor(ref) {
    const element = refsById.get(String(ref || ""));
    if (!element || !element.isConnected) return null;
    return element;
  }

  function roots() {
    if (surface === "home") {
      const shell = document.querySelector("#game-shell");
      return shell ? [shell] : [document.body];
    }
    // The desktop Buddy lives inside #birb-shadow-host's shadow root, which
    // `walk` descends into, so body is the only root needed here.
    return [document.body].filter(Boolean);
  }

  /** Children including shadow content, so the desktop Buddy is reachable. */
  function childrenOf(element) {
    const shadow = element.shadowRoot ? [...element.shadowRoot.children] : [];
    return [...shadow, ...element.children];
  }

  // ------------------------------------------------------------ descriptors

  function rectOf(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function baseDescriptor(element) {
    const style = getComputedStyle(element);
    const descriptor = {
      id: element.id || "",
      className: typeof element.className === "string" ? element.className : "",
      tagName: element.tagName || "",
      cell: element.dataset?.cell || "",
      edge: element.dataset?.edge || "",
      placementId: element.dataset?.id || "",
      alt: element.getAttribute?.("alt") || "",
    };
    descriptor.kind = core.classifyDescriptor(descriptor);
    descriptor.label = core.labelForDescriptor(descriptor);
    descriptor.ref = refFor(element);
    descriptor.rect = rectOf(element);
    descriptor.visible = style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
    descriptor.zIndex = style.zIndex === "auto" ? null : Number(style.zIndex);
    return descriptor;
  }

  function walk(element, depth, budget) {
    if (budget.count >= MAX_NODES) return null;
    budget.count += 1;
    const node = baseDescriptor(element);
    node.children = [];
    if (depth <= 0) return node;
    for (const child of childrenOf(element)) {
      // A house with hundreds of floor tiles would drown the tree; group them.
      const built = walk(child, depth - 1, budget);
      if (built) node.children.push(built);
    }
    return node;
  }

  function collapseRepeats(node) {
    if (!node?.children?.length) return node;
    node.children = node.children.map(collapseRepeats);
    const groups = new Map();
    for (const child of node.children) {
      const key = child.kind;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    const collapsed = [];
    for (const [kind, members] of groups) {
      if (members.length > 24 && ["floor", "wall", "hit-region"].includes(kind)) {
        collapsed.push({
          ref: "",
          kind: `${kind}-group`,
          label: `${kind} × ${members.length}`,
          visible: true,
          zIndex: null,
          rect: null,
          children: members.slice(0, 24),
          truncated: members.length - 24,
        });
      } else collapsed.push(...members);
    }
    node.children = collapsed;
    return node;
  }

  function buildTree() {
    const budget = { count: 0 };
    return roots().map((root) => {
      const element = root instanceof ShadowRoot ? root.host : root;
      const node = walk(element, 8, budget);
      return collapseRepeats(node);
    }).filter(Boolean);
  }

  // ------------------------------------------------------------- properties

  const CSS_KEYS = ["position", "left", "top", "width", "height", "transform", "translate", "z-index", "display", "opacity", "image-rendering", "pointer-events"];

  function propertiesFor(element) {
    const style = getComputedStyle(element);
    const descriptor = baseDescriptor(element);
    const css = {};
    for (const key of CSS_KEYS) css[key] = style.getPropertyValue(key);

    const inline = {};
    for (const key of ["left", "top", "width", "height", "z-index", "transform", "display", "opacity"]) {
      const value = element.style.getPropertyValue(key);
      if (value) inline[key] = value;
    }

    const result = {
      ...descriptor,
      css,
      inline,
      editable: ["left", "top", "width", "height", "z-index", "opacity", "display", "transform", "translate"],
      studioOffset: {
        x: parseFloat(element.dataset.pbStudioOffsetX) || 0,
        y: parseFloat(element.dataset.pbStudioOffsetY) || 0,
      },
      attributes: {
        src: element.getAttribute?.("src") ? String(element.getAttribute("src")).slice(0, 300) : "",
        title: element.getAttribute?.("title") || "",
      },
    };

    const bridge = homeBridge();
    if (bridge && (descriptor.kind === "actor-human" || descriptor.kind === "actor-buddy")) {
      const actor = bridge.actor(descriptor.id);
      if (actor) {
        result.actor = core.actorTelemetry(actor);
        result.animations = bridge.animationNames(descriptor.id);
        result.persistence = "authoritative";
      }
    } else if (descriptor.kind === "floor" || descriptor.kind === "wall" || descriptor.kind === "door") {
      result.persistence = "canonical-grid";
      result.structure = structureForDescriptor(descriptor);
    } else {
      // Everything else is edited as a live CSS preview only. Say so plainly so
      // nobody assumes an inspector tweak was written back to house state.
      result.persistence = "live-css-preview";
    }
    return result;
  }

  function structureForDescriptor(descriptor) {
    const grid = window.TinyHouseStructure?.grid;
    if (!grid) return null;
    if (descriptor.cell) {
      const [column, row] = descriptor.cell.split(",").map(Number);
      return { type: "floor", column, row, walkable: grid.hasFloor(column, row) };
    }
    if (descriptor.edge) {
      const [axis, coordinates] = descriptor.edge.split(":");
      const [column, row] = String(coordinates).split(",").map(Number);
      const edge = grid.edgeAt(axis, column, row);
      return {
        type: edge?.kind || "edge",
        axis,
        column,
        row,
        open: Boolean(edge?.open),
        blocking: Boolean(edge && (edge.kind === "wall" || (edge.kind === "door" && !edge.open))),
      };
    }
    return null;
  }

  // ------------------------------------------------------------ debug layer

  function ensureCanvas() {
    const stage = document.querySelector("#world-stage");
    if (!stage) return null;
    if (canvas?.isConnected) return canvas;
    canvas = document.createElement("canvas");
    canvas.id = "pb-studio-debug-layer";
    canvas.className = "world-layer";
    canvas.style.cssText = "position:absolute;pointer-events:none;z-index:900000;";
    stage.append(canvas);
    return canvas;
  }

  function drawDebug() {
    const node = ensureCanvas();
    const grid = window.TinyHouseStructure?.grid;
    if (!node || !grid || !core) return;

    const model = core.gridDebugModel(grid);
    const bridge = homeBridge();
    const actors = bridge ? bridge.actors().map((actor) => core.actorTelemetry(actor)).filter(Boolean) : [];

    const points = [
      ...model.floors.flatMap((floor) => floor.polygon),
      ...model.edges.flatMap((edge) => edge.segment),
      ...actors.flatMap((actor) => actor.collisionPolygon),
    ];
    if (!points.length) return;

    const pad = 80;
    const minX = Math.min(...points.map((point) => point.x)) - pad;
    const minY = Math.min(...points.map((point) => point.y)) - pad;
    const maxX = Math.max(...points.map((point) => point.x)) + pad;
    const maxY = Math.max(...points.map((point) => point.y)) + pad;
    const width = Math.max(1, Math.ceil(maxX - minX));
    const height = Math.max(1, Math.ceil(maxY - minY));

    if (node.width !== width || node.height !== height) {
      node.width = width;
      node.height = height;
    }
    node.style.left = `${minX}px`;
    node.style.top = `${minY}px`;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;

    const ctx = node.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(-minX, -minY);
    ctx.lineJoin = "round";

    if (overlays.walkable) {
      ctx.fillStyle = "rgba(78, 214, 168, 0.14)";
      ctx.strokeStyle = "rgba(78, 214, 168, 0.55)";
      ctx.lineWidth = 1;
      for (const floor of model.floors) {
        ctx.beginPath();
        floor.polygon.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    if (overlays.edges) {
      ctx.lineWidth = 4;
      for (const edge of model.edges) {
        ctx.strokeStyle = edge.kind === "door"
          ? (edge.open ? "rgba(126, 214, 255, 0.95)" : "rgba(255, 176, 92, 0.95)")
          : "rgba(255, 92, 122, 0.9)";
        ctx.beginPath();
        ctx.moveTo(edge.segment[0].x, edge.segment[0].y);
        ctx.lineTo(edge.segment[1].x, edge.segment[1].y);
        ctx.stroke();
      }
    }

    if (overlays.footprints) {
      ctx.strokeStyle = "rgba(196, 154, 255, 0.85)";
      ctx.lineWidth = 1;
      for (const item of document.querySelectorAll("#item-layer .placed-item")) {
        const left = parseFloat(item.style.left) || 0;
        const top = parseFloat(item.style.top) || 0;
        const w = parseFloat(item.style.width) || 0;
        const h = parseFloat(item.style.height) || 0;
        ctx.strokeRect(left, top, w, h);
      }
    }

    if (overlays.collision) {
      for (const actor of actors) {
        ctx.fillStyle = "rgba(255, 214, 92, 0.22)";
        ctx.strokeStyle = "rgba(255, 214, 92, 0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        actor.collisionPolygon.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(actor.point.x, actor.point.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();

        if (overlays.labels) {
          const text = `${actor.label} ${actor.position.column.toFixed(2)}, ${actor.position.row.toFixed(2)} → cell ${actor.cell.column},${actor.cell.row}`;
          ctx.font = "11px 'Courier New', monospace";
          const metrics = ctx.measureText(text);
          const boxX = actor.point.x - metrics.width / 2 - 4;
          const boxY = actor.point.y + 8;
          ctx.fillStyle = "rgba(14,15,19,0.82)";
          ctx.fillRect(boxX, boxY, metrics.width + 8, 16);
          ctx.fillStyle = "#ffe9a8";
          ctx.fillText(text, boxX + 4, boxY + 12);
        }
      }
    }

    ctx.restore();
  }

  function tick() {
    frameHandle = 0;
    if (!overlayEnabled) return;
    try {
      drawDebug();
    } catch (error) {
      pushConsole("error", ["Studio debug overlay failed:", error]);
      overlayEnabled = false;
      return;
    }
    frameHandle = requestAnimationFrame(tick);
  }

  function startOverlay() {
    if (frameHandle || !overlayEnabled) return;
    frameHandle = requestAnimationFrame(tick);
  }

  function stopOverlay() {
    if (frameHandle) cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    if (canvas?.isConnected) canvas.remove();
    canvas = null;
  }

  // --------------------------------------------------------------- picking

  // Tracked directly rather than looked up by attribute: the desktop Buddy
  // lives in a shadow root, where a document-level query cannot reach it.
  let highlighted = null;
  let priorOutline = "";

  function highlight(element) {
    if (highlighted?.isConnected) highlighted.style.outline = priorOutline;
    highlighted = null;
    priorOutline = "";
    if (!(element instanceof Element)) return;
    highlighted = element;
    priorOutline = element.style.outline || "";
    element.style.outline = "2px solid #7ed6ff";
  }

  function deepElementFromPoint(x, y) {
    let element = document.elementFromPoint(x, y);
    // Descend through nested shadow roots so a click lands on the real Buddy
    // rather than on its shadow host.
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint?.(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }
    return element;
  }

  function onPickPointerDown(event) {
    if (!pickMode) return;
    event.preventDefault();
    event.stopPropagation();
    const element = deepElementFromPoint(event.clientX, event.clientY);
    pickMode = false;
    document.documentElement.style.cursor = "";
    if (element) {
      selectionRef = refFor(element);
      highlight(element);
    }
  }

  // ---------------------------------------------------------------- states

  function structureMode() {
    return window.TinyHouseStructure?.mode || "";
  }

  function setStructureMode(mode) {
    const button = document.querySelector(`#structure-tools [data-mode="${String(mode)}"]`);
    if (!button) throw new Error(`Structure mode "${mode}" is not available in this Home.`);
    button.click();
    return structureMode();
  }

  function presence() {
    const bridge = homeBridge();
    return {
      surface,
      owner: surface === "home" ? "Home" : "Desktop",
      buddyName: bridge?.buddyName?.() || (window.POCKET_BUDDY_HOME_CONFIG?.buddyName ?? ""),
      buddyPresent: Boolean(bridge?.actor("pb-home-buddy")),
      humanPresent: Boolean(bridge?.actor("pb-home-human")),
      mode: bridge?.mode?.() || "",
      structureMode: structureMode(),
    };
  }

  // ------------------------------------------------------------------- api

  const api = {
    version: 1,
    surface,

    ping: guard(() => ok({ surface, href: location.href })),

    snapshot: guard(() => {
      const grid = window.TinyHouseStructure?.grid;
      const bridge = homeBridge();
      return ok({
        surface,
        title: document.title,
        presence: presence(),
        overlays: { enabled: overlayEnabled, ...overlays },
        selection: selectionRef ? propertiesFor(elementFor(selectionRef) || document.body) : null,
        pickMode,
        actors: bridge ? bridge.actors().map((actor) => core.actorTelemetry(actor)).filter(Boolean) : [],
        grid: grid ? (() => {
          const model = core.gridDebugModel(grid);
          return {
            walkableCount: model.walkableCount,
            blockingCount: model.blockingCount,
            edgeCount: model.edges.length,
            rooms: grid.rooms?.().length ?? 0,
          };
        })() : null,
        camera: window.TinyHouseCamera?.view ?? null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    }),

    tree: guard(() => ok({ roots: buildTree() })),

    setPickMode: guard((on) => {
      pickMode = Boolean(on);
      document.documentElement.style.cursor = pickMode ? "crosshair" : "";
      return ok({ pickMode });
    }),

    select: guard((ref) => {
      const element = elementFor(ref);
      if (!element) throw new Error("That element is no longer in the document.");
      selectionRef = String(ref);
      highlight(element);
      element.scrollIntoView?.({ block: "nearest" });
      return ok({ selection: propertiesFor(element) });
    }),

    selectAt: guard((x, y) => {
      const element = deepElementFromPoint(number(x), number(y));
      if (!element) throw new Error("No element at that point.");
      selectionRef = refFor(element);
      highlight(element);
      return ok({ selection: propertiesFor(element) });
    }),

    clearSelection: guard(() => {
      selectionRef = "";
      highlight(null);
      return ok();
    }),

    properties: guard((ref) => {
      const element = elementFor(ref);
      if (!element) throw new Error("That element is no longer in the document.");
      return ok({ properties: propertiesFor(element) });
    }),

    setProperty: guard((ref, key, value) => {
      const element = elementFor(ref);
      if (!element) throw new Error("That element is no longer in the document.");
      const property = String(key);
      element.style.setProperty(property, String(value));
      return ok({ properties: propertiesFor(element) });
    }),

    /**
     * Move the selection. Actors move through the canonical motion core so
     * walls and doors still apply and positions stay continuous — Studio never
     * re-introduces tile snapping. Anything else is a live CSS nudge.
     */
    moveBy: guard((ref, dx, dy) => {
      const element = elementFor(ref);
      if (!element) throw new Error("That element is no longer in the document.");
      const descriptor = baseDescriptor(element);
      const bridge = homeBridge();
      if (bridge && (descriptor.kind === "actor-human" || descriptor.kind === "actor-buddy")) {
        const moved = bridge.nudge(descriptor.id, number(dx), number(dy));
        if (!moved) throw new Error("That actor is not currently active in Home.");
        return ok({ actor: core.actorTelemetry(moved), persistence: "authoritative" });
      }
      // Nudge with the standalone `translate` property rather than left/top.
      // Pocket Buddy positions elements with varying anchors (left/bottom, and
      // a `transform` used for facing), so writing left/top here would fight
      // the real layout or teleport an element whose offset was never inline.
      const offsetX = (parseFloat(element.dataset.pbStudioOffsetX) || 0) + number(dx);
      const offsetY = (parseFloat(element.dataset.pbStudioOffsetY) || 0) + number(dy);
      element.dataset.pbStudioOffsetX = String(offsetX);
      element.dataset.pbStudioOffsetY = String(offsetY);
      element.style.translate = `${offsetX}px ${offsetY}px`;
      return ok({ properties: propertiesFor(element), persistence: "live-css-preview" });
    }),

    /** Drop a live CSS nudge and return the element to its real layout. */
    clearOffset: guard((ref) => {
      const element = elementFor(ref);
      if (!element) throw new Error("That element is no longer in the document.");
      delete element.dataset.pbStudioOffsetX;
      delete element.dataset.pbStudioOffsetY;
      element.style.removeProperty("translate");
      return ok({ properties: propertiesFor(element) });
    }),

    setOverlays: guard((next) => {
      overlays = { ...overlays, ...(next && typeof next === "object" ? next : {}) };
      overlayEnabled = Boolean(next?.enabled ?? overlayEnabled);
      if (overlayEnabled) startOverlay();
      else stopOverlay();
      return ok({ overlays: { enabled: overlayEnabled, ...overlays } });
    }),

    setState: guard((name) => {
      const value = String(name);
      const bridge = homeBridge();
      if (!bridge) throw new Error("Play/Idle/Build states need the Home window.");
      if (value === "build") {
        bridge.setMode("idle");
        setStructureMode("add-floor");
      } else if (value === "play" || value === "idle") {
        bridge.setMode(value);
        if (structureMode() && structureMode() !== "furnish") setStructureMode("furnish");
      } else throw new Error(`Unknown state "${value}".`);
      return ok({ presence: presence() });
    }),

    setStructureMode: guard((mode) => ok({ structureMode: setStructureMode(mode) })),

    setAnimation: guard((actorId, animation) => {
      const bridge = homeBridge();
      if (!bridge) throw new Error("Animation preview needs the Home window.");
      const actor = bridge.setAnimation(String(actorId), String(animation));
      if (!actor) throw new Error("That actor is not currently active in Home.");
      return ok({ actor: core.actorTelemetry(actor) });
    }),

    animationNames: guard((actorId) => ok({ names: homeBridge()?.animationNames(String(actorId)) ?? [] })),

    drainConsole: guard(() => {
      const entries = consoleBuffer.splice(0, consoleBuffer.length);
      return ok({ entries });
    }),
  };

  window.addEventListener("pointerdown", onPickPointerDown, true);
  captureConsole();
  window.__POCKET_BUDDY_STUDIO__ = api;
  pushConsole("info", [`Pocket Buddy Studio agent attached (${surface})`]);
})();
