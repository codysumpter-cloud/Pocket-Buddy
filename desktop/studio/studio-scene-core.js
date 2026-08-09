(() => {
  "use strict";

  // Pure Pocket Buddy Studio scene helpers.
  //
  // Everything here is geometry and classification only: no DOM writes, no
  // renderer of its own. The debug overlays read the canonical TinyHouse grid
  // and project through the same isometric vertex math the real Home uses, so
  // Studio can never drift into being a second Home renderer.

  const ACTOR_KINDS = Object.freeze({
    "pb-home-human": "actor-human",
    "pb-home-buddy": "actor-buddy",
    birb: "actor-buddy",
    "pocket-buddy-custom-pet": "actor-buddy",
  });

  const UI_SELECTORS = Object.freeze([
    "top-hud", "structure-panel", "blueprint-panel", "rooms-panel", "cozy-panel",
    "selection-tools", "camera-tools", "mode-hint", "catalog", "toast",
    "pb-home-life-controls", "pb-home-actor-error", "birb-menu", "birb-field-guide",
  ]);

  const number = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  /**
   * Classify a plain element descriptor. Kept data-only so the contract can be
   * tested without a DOM.
   */
  function classifyDescriptor(descriptor = {}) {
    const id = String(descriptor.id || "");
    const className = String(descriptor.className || "");
    const tagName = String(descriptor.tagName || "").toLowerCase();
    const classes = className.split(/\s+/).filter(Boolean);
    const has = (name) => classes.includes(name);

    if (ACTOR_KINDS[id]) return ACTOR_KINDS[id];
    if (has("structure-door")) return "door";
    if (has("structure-wall")) return "wall";
    if (has("structure-floor") || has("floor-tile")) return "floor";
    if (has("placed-item")) return "furniture";
    if (has("structure-floor-hit") || has("structure-edge-hit")) return "hit-region";
    if (UI_SELECTORS.includes(id)) return "ui-panel";
    if (has("builder-panel") || has("asset-card") || has("tab")) return "ui-panel";
    if (id === "floor-layer" || id === "wall-layer" || id === "item-layer" || id === "structure-hit-layer") return "layer";
    if (id === "world-stage" || id === "world-viewport" || id === "game-shell") return "stage";
    if (["button", "input", "select", "textarea"].includes(tagName)) return "ui-control";
    return "element";
  }

  /** Human-readable node label for the hierarchy tree. */
  function labelForDescriptor(descriptor = {}) {
    const kind = descriptor.kind || classifyDescriptor(descriptor);
    const id = String(descriptor.id || "");
    if (kind === "actor-human") return "Ani (human)";
    if (kind === "actor-buddy") return descriptor.buddyName ? `${descriptor.buddyName} (buddy)` : "Buddy";
    if (kind === "floor" && descriptor.cell) return `Floor ${descriptor.cell}`;
    if (kind === "wall" && descriptor.edge) return `Wall ${descriptor.edge}`;
    if (kind === "door" && descriptor.edge) return `Door ${descriptor.edge}`;
    if (kind === "furniture") return descriptor.alt || `Furniture ${descriptor.placementId || ""}`.trim();
    if (id) return `#${id}`;
    const first = String(descriptor.className || "").split(/\s+/).filter(Boolean)[0];
    return first ? `.${first}` : String(descriptor.tagName || "node").toLowerCase();
  }

  function defaultProject(column, row) {
    const core = typeof window !== "undefined" ? window.TinyHouseGridCore : null;
    const room = core?.DEFAULT_ROOM;
    if (core?.cellTopVertex && room) return core.cellTopVertex(column, row, room);
    return { x: 650 + (column - row) * 64, y: 190 + (column + row) * 32 };
  }

  function centerProject(column, row, project = defaultProject) {
    // The center of cell (c,r) is the average of its four lattice vertices,
    // which is exactly TinyHouse's cellCenter. Deriving it from the same
    // vertex projection keeps overlays locked to the canonical grid.
    const a = project(column, row);
    const b = project(column + 1, row + 1);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** Four screen-space corners of a floor cell diamond. */
  function cellPolygon(column, row, project = defaultProject) {
    return [
      project(column, row),
      project(column + 1, row),
      project(column + 1, row + 1),
      project(column, row + 1),
    ];
  }

  /**
   * Screen-space endpoints of a wall/door edge.
   * A `left` edge separates (column-1,row) from (column,row).
   * A `right` edge separates (column,row-1) from (column,row).
   */
  function edgeSegment(axis, column, row, project = defaultProject) {
    if (axis === "left") return [project(column, row), project(column, row + 1)];
    return [project(column, row), project(column + 1, row)];
  }

  /**
   * The actor collision bound is an axis-aligned box in GRID space of half
   * extent `radius` (see actor-motion-core moveAxis). In screen space that
   * projects to a diamond, so project the four grid corners directly.
   */
  function collisionPolygon(position, radius, project = defaultProject) {
    const column = number(position?.column);
    const row = number(position?.row);
    const r = clamp(number(radius, 0.1), 0, 0.5);
    return [
      centerProject(column - r, row - r, project),
      centerProject(column + r, row - r, project),
      centerProject(column + r, row + r, project),
      centerProject(column - r, row + r, project),
    ];
  }

  /** Integer grid cell currently underneath a fractional actor position. */
  function cellUnder(position) {
    return { column: Math.round(number(position?.column)), row: Math.round(number(position?.row)) };
  }

  /**
   * Build the debug model for a canonical TinyHouse grid: walkable cells,
   * wall/door edges, and which edges actually block traversal.
   */
  function gridDebugModel(grid, project = defaultProject) {
    const floors = [...(grid?.floors?.values?.() ?? [])].map((floor) => ({
      column: floor.column,
      row: floor.row,
      key: `${floor.column},${floor.row}`,
      polygon: cellPolygon(floor.column, floor.row, project),
      center: centerProject(floor.column, floor.row, project),
    }));

    const edges = [...(grid?.edges?.values?.() ?? [])].map((edge) => {
      const blocking = edge.kind === "wall" || (edge.kind === "door" && !edge.open);
      return {
        axis: edge.axis,
        column: edge.column,
        row: edge.row,
        key: `${edge.axis}:${edge.column},${edge.row}`,
        kind: edge.kind,
        open: Boolean(edge.open),
        blocking,
        segment: edgeSegment(edge.axis, edge.column, edge.row, project),
      };
    });

    return { floors, edges, walkableCount: floors.length, blockingCount: edges.filter((edge) => edge.blocking).length };
  }

  /** Footprint of a placed furniture item, in stage coordinates. */
  function furnitureFootprint(placement, asset, project = defaultProject) {
    const scale = number(placement?.scale, 1);
    const width = number(asset?.width, 0) * scale;
    const height = number(asset?.height, 0) * scale;
    const center = centerProject(number(placement?.column), number(placement?.row), project);
    return {
      width,
      height,
      center,
      box: { x: center.x - width / 2, y: center.y - height, width, height },
    };
  }

  /** Telemetry row for one actor, as shown in the Studio inspector. */
  function actorTelemetry(actor, project = defaultProject) {
    if (!actor) return null;
    const position = { column: number(actor.cell?.column), row: number(actor.cell?.row) };
    const radius = clamp(number(actor.radius, 0.1), 0, 0.5);
    return {
      id: actor.id || "",
      label: actor.label || "",
      position,
      cell: cellUnder(position),
      point: centerProject(position.column, position.row, project),
      radius,
      collisionPolygon: collisionPolygon(position, radius, project),
      direction: actor.direction || "south",
      moving: Boolean(actor.moving),
      animation: actor.animation || "",
      scale: number(actor.scale, 1),
      appearance: actor.appearance || "",
      // A pack whose animation folders are mirrored against its rotation sheet
      // will walk facing the wrong way while standing still looks correct.
      mirroredAnimations: Boolean(actor.mirroredAnimations),
      frameSrc: actor.frameSrc || "",
      attached: actor.attached !== false,
    };
  }

  const api = Object.freeze({
    ACTOR_KINDS,
    classifyDescriptor,
    labelForDescriptor,
    centerProject,
    cellPolygon,
    edgeSegment,
    collisionPolygon,
    cellUnder,
    gridDebugModel,
    furnitureFootprint,
    actorTelemetry,
  });

  if (typeof window !== "undefined") window.PocketBuddyStudioCore = api;
  if (typeof globalThis !== "undefined") globalThis.PocketBuddyStudioCore = api;
})();
