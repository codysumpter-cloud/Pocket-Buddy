(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const PAGE_SIZE = 12;
  const SAVE_KEY = "pocket-buddy-plus-tinyhouse-local-v1";
  const LEGACY_SAVE_KEY = "prismtek-tinyhouse-playable-v3";
  const ROOM = Object.freeze({
    columns: 5,
    rows: 5,
    originX: 650,
    originY: 190,
    tileWidth: 128,
    tileStepX: 64,
    tileStepY: 32,
    floorTopPixelY: 36,
    floorLeftVertexY: 68,
    wallBottomLeftX: 32,
    wallBottomRightX: 96,
    wallBottomHighY: 84,
    wallBottomLowY: 116,
    wallLiftY: -48,
    leftWallShiftX: -32,
    rightWallShiftX: 32,
    placementSubdivisions: 2,
    placementTolerance: 118,
  });

  const state = {
    manifest: [],
    category: "Furniture",
    search: "",
    page: 0,
    selectedAsset: null,
    selectedItemId: null,
    hoverSupportId: null,
    placements: [],
    floorAsset: null,
    leftWallAsset: null,
    rightWallAsset: null,
    scale: 1,
    panX: 0,
    panY: -60,
    spaceDown: false,
    drag: null,
    idCounter: 1,
    layerCounter: 1,
  };

  const viewport = $("#world-viewport");
  const stage = $("#world-stage");
  const floorLayer = $("#floor-layer");
  const wallLayer = $("#wall-layer");
  const itemLayer = $("#item-layer");
  const ghost = $("#placement-ghost");
  const assetGrid = $("#asset-grid");
  const tabs = $("#tabs");
  const tools = $("#selection-tools");
  const toast = $("#toast");
  const catalogCount = $("#catalog-count");
  const selectionName = $("#selection-name");
  const selectionMeta = $("#selection-meta");
  const assetPackSummary = $("#asset-pack-summary");
  let toastTimer = 0;
  let memorySave = null;
  let animationTimer = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function roundTo(value, increment) {
    return Math.round(value / increment) * increment;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1700);
  }

  function encodePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  function assetUrl(asset) {
    if (!asset) return "";
    return asset.dataUrl || (asset.path.startsWith("data:") ? asset.path : encodePath(asset.path));
  }

  function frameUrl(asset, frameIndex = 0) {
    if (!asset) return "";
    if (Array.isArray(asset.frameDataUrls) && asset.frameDataUrls.length) {
      return asset.frameDataUrls[clamp(frameIndex, 0, asset.frameDataUrls.length - 1)];
    }
    if (Array.isArray(asset.frames) && asset.frames.length) {
      return encodePath(asset.frames[clamp(frameIndex, 0, asset.frames.length - 1)]);
    }
    return assetUrl(asset);
  }

  function frameCount(asset) {
    return Array.isArray(asset?.frames) && asset.frames.length ? asset.frames.length : 1;
  }

  function findAsset(id) {
    return state.manifest.find((asset) => asset.id === id) || null;
  }

  function findPlacement(id) {
    return state.placements.find((placement) => placement.id === id) || null;
  }

  function cellTopVertex(column, row) {
    return {
      x: ROOM.originX + (column - row) * ROOM.tileStepX,
      y: ROOM.originY + (column + row) * ROOM.tileStepY,
    };
  }

  function floorTopLeft(column, row) {
    const top = cellTopVertex(column, row);
    return {
      x: top.x - ROOM.tileWidth / 2,
      y: top.y - ROOM.floorTopPixelY,
    };
  }

  function cellCenter(column, row) {
    const top = cellTopVertex(column, row);
    return { x: top.x, y: top.y + ROOM.tileStepY };
  }

  function leftWallTopLeft(row) {
    const floor = floorTopLeft(0, row);
    return { x: floor.x + ROOM.leftWallShiftX, y: floor.y + ROOM.wallLiftY };
  }

  function rightWallTopLeft(column) {
    const floor = floorTopLeft(column, 0);
    return { x: floor.x + ROOM.rightWallShiftX, y: floor.y + ROOM.wallLiftY };
  }

  function worldToNearestCell(x, y, options = {}) {
    const subdivisions = options.subdivisions ?? ROOM.placementSubdivisions;
    const tolerance = options.tolerance ?? ROOM.placementTolerance;
    const dx = x - ROOM.originX;
    const dy = y - ROOM.tileStepY - ROOM.originY;
    const columnFloat = (dy / ROOM.tileStepY + dx / ROOM.tileStepX) / 2;
    const rowFloat = (dy / ROOM.tileStepY - dx / ROOM.tileStepX) / 2;

    // A half-cell margin lets a drop just beyond a diamond edge settle into the
    // nearest valid floor position rather than mysteriously doing nothing.
    if (columnFloat < -0.75 || rowFloat < -0.75
        || columnFloat > ROOM.columns - 0.25 || rowFloat > ROOM.rows - 0.25) return null;

    const step = 1 / subdivisions;
    const column = clamp(roundTo(columnFloat, step), 0, ROOM.columns - 1);
    const row = clamp(roundTo(rowFloat, step), 0, ROOM.rows - 1);
    const point = cellCenter(column, row);
    const distance = Math.hypot(point.x - x, (point.y - y) * 1.35);
    if (distance > tolerance) return null;
    return { column, row, ...point, distance };
  }

  function geometryChecks() {
    const floor = floorTopLeft(0, 0);
    const left = leftWallTopLeft(0);
    const right = rightWallTopLeft(0);
    const samePoint = (a, b) => a.x === b.x && a.y === b.y;
    const floorLeftLow = { x: floor.x, y: floor.y + ROOM.floorLeftVertexY };
    const floorTop = { x: floor.x + ROOM.tileWidth / 2, y: floor.y + ROOM.floorTopPixelY };
    const floorRightLow = { x: floor.x + ROOM.tileWidth, y: floor.y + ROOM.floorLeftVertexY };
    const leftLow = { x: left.x + ROOM.wallBottomLeftX, y: left.y + ROOM.wallBottomLowY };
    const leftHigh = { x: left.x + ROOM.wallBottomRightX, y: left.y + ROOM.wallBottomHighY };
    const rightHigh = { x: right.x + ROOM.wallBottomLeftX, y: right.y + ROOM.wallBottomHighY };
    const rightLow = { x: right.x + ROOM.wallBottomRightX, y: right.y + ROOM.wallBottomLowY };
    return {
      leftLow: samePoint(floorLeftLow, leftLow),
      leftHigh: samePoint(floorTop, leftHigh),
      rightHigh: samePoint(floorTop, rightHigh),
      rightLow: samePoint(floorRightLow, rightLow),
      cornerTop: left.x + 96 === right.x + 32 && left.y + 4 === right.y + 4,
      cornerBottom: left.x + 96 === right.x + 32 && left.y + 84 === right.y + 84,
    };
  }

  function chooseDefaults() {
    const floors = state.manifest.filter((asset) => asset.category === "Floors" && /128/.test(asset.folder));
    const walls = state.manifest.filter((asset) => asset.category === "Walls" && /128/.test(asset.folder));
    state.floorAsset = floors.find((asset) => /woodlight/i.test(asset.id)) || floors[0] || null;
    state.leftWallAsset = walls.find((asset) => asset.orientation === "left" && /wall-l-128-white$/i.test(asset.id))
      || walls.find((asset) => asset.orientation === "left") || null;
    state.rightWallAsset = walls.find((asset) => asset.orientation === "right" && /wall-r-128-white$/i.test(asset.id))
      || walls.find((asset) => asset.orientation === "right") || null;
  }

  function buildTabs() {
    const categories = ["Floors", "Walls", "Furniture", "Appliances", "Decor", "Structural"];
    tabs.replaceChildren(...categories.map((name) => {
      const button = document.createElement("button");
      button.className = `tab${name === state.category ? " active" : ""}`;
      button.textContent = name.toUpperCase();
      button.addEventListener("click", () => {
        state.category = name;
        state.page = 0;
        $$(".tab", tabs).forEach((candidate) => candidate.classList.toggle("active", candidate === button));
        renderCatalog();
      });
      return button;
    }));
  }

  function filteredAssets() {
    const query = state.search.trim().toLowerCase();
    return state.manifest.filter((asset) => {
      if (asset.category !== state.category) return false;
      if (asset.category === "Floors" || asset.category === "Walls") {
        if (!/128/.test(asset.folder)) return false;
      } else if (asset.width > 256 || asset.height > 256) {
        return false;
      }
      return !query || `${asset.name} ${asset.folder}`.toLowerCase().includes(query);
    });
  }

  function animationBadge(asset) {
    if (!asset.animated) return "";
    const mode = asset.animationMode;
    if (mode === "loop") return "LOOP";
    if (mode === "toggleLoop") return "ON/OFF";
    if (mode === "toggle") return "OPEN";
    if (mode === "cycle") return "STATE";
    return "PLAY";
  }

  function renderCatalog() {
    const assets = filteredAssets();
    const pageCount = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
    state.page = clamp(state.page, 0, pageCount - 1);
    const pageAssets = assets.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

    assetGrid.replaceChildren(...pageAssets.map((asset) => {
      const button = document.createElement("button");
      button.className = `asset-card${state.selectedAsset?.id === asset.id ? " active" : ""}`;
      button.title = `${asset.name}\n${asset.folder}${asset.tabletop ? "\nCan sit on tables" : ""}`;
      const image = document.createElement("img");
      image.loading = "lazy";
      image.src = frameUrl(asset, 0);
      image.alt = asset.name;
      button.append(image);
      const label = document.createElement("span");
      label.className = "asset-name";
      label.textContent = asset.name;
      button.append(label);
      if (asset.animated) {
        const badge = document.createElement("span");
        badge.className = "ani";
        badge.textContent = animationBadge(asset);
        button.append(badge);
      }
      if (asset.tabletop) {
        const badge = document.createElement("span");
        badge.className = "state";
        badge.textContent = "TOP";
        button.append(badge);
      }
      button.addEventListener("click", () => selectCatalogAsset(asset));
      return button;
    }));

    $("#page-label").textContent = `${state.page + 1} / ${pageCount}`;
    $("#prev-page").disabled = state.page === 0;
    $("#next-page").disabled = state.page >= pageCount - 1;
    if (catalogCount) catalogCount.textContent = `${assets.length.toLocaleString()} ITEMS`;
  }

  function selectCatalogAsset(asset) {
    state.selectedAsset = asset;
    state.selectedItemId = null;
    state.hoverSupportId = null;
    tools.hidden = true;

    if (asset.category === "Floors") {
      state.floorAsset = asset;
      ghost.hidden = true;
      renderSurfaces();
      showToast(`Floor: ${asset.name}`);
    } else if (asset.category === "Walls") {
      if (asset.orientation === "left") state.leftWallAsset = asset;
      if (asset.orientation === "right") state.rightWallAsset = asset;
      ghost.hidden = true;
      renderSurfaces();
      showToast(`${asset.orientation === "left" ? "Left" : "Right"} wall: ${asset.name}`);
    } else {
      ghost.hidden = false;
      ghost.replaceChildren(createGhostImage(asset));
      showToast(asset.tabletop ? `Place ${asset.name} on a table or floor` : `Place ${asset.name}`);
    }

    renderCatalog();
    renderItems();
  }

  function createGhostImage(asset) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = frameUrl(asset, 0);
    image.style.width = `${asset.width * (asset.defaultScale || 1)}px`;
    image.style.height = `${asset.height * (asset.defaultScale || 1)}px`;
    return image;
  }

  function tileImage(asset, x, y, zIndex, role) {
    const image = document.createElement("img");
    image.className = `tile ${role}`;
    image.src = assetUrl(asset);
    image.alt = "";
    image.style.left = `${x}px`;
    image.style.top = `${y}px`;
    image.style.zIndex = String(zIndex);
    return image;
  }

  function renderSurfaces() {
    floorLayer.replaceChildren();
    wallLayer.replaceChildren();
    if (state.floorAsset) {
      for (let row = 0; row < ROOM.rows; row += 1) {
        for (let column = 0; column < ROOM.columns; column += 1) {
          const point = floorTopLeft(column, row);
          floorLayer.append(tileImage(state.floorAsset, point.x, point.y, 100 + column + row, "floor-tile"));
        }
      }
    }
    for (let index = 0; index < ROOM.rows; index += 1) {
      if (state.leftWallAsset) {
        const point = leftWallTopLeft(index);
        wallLayer.append(tileImage(state.leftWallAsset, point.x, point.y, 200 + index, "left-wall-tile"));
      }
      if (state.rightWallAsset) {
        const point = rightWallTopLeft(index);
        wallLayer.append(tileImage(state.rightWallAsset, point.x, point.y, 220 + index, "right-wall-tile"));
      }
    }
  }

  function supportGeometry(placement) {
    const asset = findAsset(placement.assetId);
    if (!asset) return null;
    const width = asset.width * placement.scale;
    const height = asset.height * placement.scale;
    return {
      centerX: placement.x,
      centerY: placement.y - height * 0.49,
      halfWidth: Math.max(20, width * 0.34),
      halfHeight: Math.max(11, height * 0.13),
    };
  }

  function resolvedPlacement(placement) {
    if (!placement.supportId) return { x: placement.x, y: placement.y, support: null };
    const support = findPlacement(placement.supportId);
    const geometry = support && supportGeometry(support);
    if (!support || !geometry) return { x: placement.x, y: placement.y, support: null };
    return {
      x: geometry.centerX + clamp(placement.supportOffsetX || 0, -geometry.halfWidth, geometry.halfWidth),
      y: geometry.centerY + geometry.halfHeight * 0.28,
      support,
    };
  }

  function zIndexFor(placement) {
    const resolved = resolvedPlacement(placement);
    if (resolved.support) {
      return 1000 + Math.round(resolved.support.y * 10 + 600 + placement.layer);
    }
    return 1000 + Math.round(resolved.y * 10 + placement.layer);
  }

  function renderItems() {
    const nodes = [...state.placements]
      .sort((a, b) => zIndexFor(a) - zIndexFor(b))
      .map((placement) => {
        const asset = findAsset(placement.assetId);
        if (!asset) return document.createComment("missing asset");
        const resolved = resolvedPlacement(placement);
        const image = document.createElement("img");
        const classes = ["placed-item"];
        if (placement.id === state.selectedItemId) classes.push("selected");
        if (placement.id === state.hoverSupportId) classes.push("support-target");
        if (placement.supportId) classes.push("tabletop-item");
        image.className = classes.join(" ");
        image.dataset.id = placement.id;
        image.src = frameUrl(asset, placement.frameIndex || 0);
        image.alt = asset.name;
        image.style.width = `${asset.width * placement.scale}px`;
        image.style.height = `${asset.height * placement.scale}px`;
        image.style.left = `${resolved.x - asset.width * placement.scale / 2}px`;
        image.style.top = `${resolved.y - asset.height * placement.scale}px`;
        image.style.zIndex = String(zIndexFor(placement));
        image.style.transform = `scaleX(${placement.flip ? -1 : 1})`;
        image.addEventListener("pointerdown", onItemPointerDown);
        image.addEventListener("click", onItemClick);
        image.addEventListener("dblclick", onItemDoubleClick);
        return image;
      });
    itemLayer.replaceChildren(...nodes);
    updateSelectionTools();
  }

  function updateSelectionTools() {
    tools.hidden = !state.selectedItemId;
    const placement = selectedPlacement();
    const asset = placement && findAsset(placement.assetId);
    const activate = tools.querySelector('[data-action="activate"]');
    if (activate) {
      activate.disabled = !asset?.animated;
      activate.textContent = placement?.playing ? "Ⅱ" : "▶";
      activate.title = asset?.animated ? `${animationBadge(asset)}: ${asset.name}` : "This item has no animation";
    }
    if (selectionName) selectionName.textContent = asset?.name || "Nothing selected";
    if (selectionMeta) {
      if (!placement || !asset) {
        selectionMeta.textContent = "Choose an object in the room.";
      } else {
        const support = placement.supportId ? findPlacement(placement.supportId) : null;
        const supportAsset = support && findAsset(support.assetId);
        const location = placement.supportId
          ? `On ${supportAsset?.name || "tabletop"}`
          : `Grid ${placement.column.toFixed(1)}, ${placement.row.toFixed(1)}`;
        const behavior = asset.animated ? ` · ${animationBadge(asset)}` : "";
        selectionMeta.textContent = `${asset.category} · ${location}${behavior}`;
      }
    }
  }

  function screenToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.panX) / state.scale,
      y: (clientY - rect.top - state.panY) / state.scale,
    };
  }

  function findSupportAtWorld(world, excludeId = null) {
    let best = null;
    let bestScore = Infinity;
    for (const placement of state.placements) {
      if (placement.id === excludeId) continue;
      const asset = findAsset(placement.assetId);
      if (asset?.supportType !== "tabletop") continue;
      const geometry = supportGeometry(placement);
      const dx = Math.abs(world.x - geometry.centerX) / geometry.halfWidth;
      const dy = Math.abs(world.y - geometry.centerY) / (geometry.halfHeight * 2.2);
      const score = dx * dx + dy * dy;
      if (dx <= 1.25 && dy <= 1.35 && score < bestScore) {
        best = placement;
        bestScore = score;
      }
    }
    return best;
  }

  function animationDefaults(asset) {
    return {
      frameIndex: 0,
      playing: asset.animationMode === "loop",
      animationDirection: 1,
      lastFrameAt: performance.now(),
    };
  }

  function createPlacement(asset, anchor) {
    return {
      id: `item-${state.idCounter++}`,
      assetId: asset.id,
      column: anchor.column,
      row: anchor.row,
      x: anchor.x,
      y: anchor.y,
      scale: asset.defaultScale || 1,
      flip: false,
      layer: state.layerCounter++,
      supportId: null,
      supportOffsetX: 0,
      ...animationDefaults(asset),
    };
  }

  function placeSelectedAtCell(cell) {
    const asset = state.selectedAsset;
    if (!asset || ["Floors", "Walls"].includes(asset.category) || !cell) return null;
    const placement = createPlacement(asset, cell);
    state.placements.push(placement);
    state.selectedItemId = placement.id;
    renderItems();
    showToast(`${asset.name} placed`);
    return placement;
  }

  function attachPlacementToSupport(placement, support, world) {
    const geometry = supportGeometry(support);
    if (!geometry) return false;
    placement.supportId = support.id;
    placement.supportOffsetX = roundTo(clamp(world.x - geometry.centerX, -geometry.halfWidth, geometry.halfWidth), 4);
    placement.column = support.column;
    placement.row = support.row;
    return true;
  }

  function placeSelectedOnSupport(support, world) {
    const asset = state.selectedAsset;
    if (!asset?.tabletop || !support) return null;
    const anchor = { ...cellCenter(support.column, support.row), column: support.column, row: support.row };
    const placement = createPlacement(asset, anchor);
    attachPlacementToSupport(placement, support, world);
    state.placements.push(placement);
    state.selectedItemId = placement.id;
    state.hoverSupportId = support.id;
    renderItems();
    showToast(`${asset.name} placed on ${findAsset(support.assetId)?.name || "table"}`);
    return placement;
  }

  function selectItem(id) {
    state.selectedItemId = id;
    state.selectedAsset = null;
    state.hoverSupportId = null;
    ghost.hidden = true;
    renderItems();
    renderCatalog();
  }

  function selectedPlacement() {
    return findPlacement(state.selectedItemId);
  }

  function deleteSelected() {
    if (!state.selectedItemId) return;
    const deletedId = state.selectedItemId;
    const attached = state.placements.filter((placement) => placement.supportId === deletedId).length;
    state.placements = state.placements.filter((placement) => placement.id !== deletedId && placement.supportId !== deletedId);
    state.selectedItemId = null;
    renderItems();
    showToast(attached ? `Item and ${attached} tabletop item${attached === 1 ? "" : "s"} removed` : "Item removed");
  }

  function flipSelected() {
    const placement = selectedPlacement();
    if (!placement) return;
    placement.flip = !placement.flip;
    renderItems();
  }

  function layerSelected(delta) {
    const placement = selectedPlacement();
    if (!placement) return;
    placement.layer += delta * 1000;
    renderItems();
  }

  function activatePlacement(placement) {
    const asset = placement && findAsset(placement.assetId);
    if (!asset?.animated || frameCount(asset) < 2) return false;
    const last = frameCount(asset) - 1;
    const mode = asset.animationMode;
    placement.lastFrameAt = performance.now();
    if (mode === "loop") {
      placement.playing = !placement.playing;
    } else if (mode === "toggleLoop") {
      placement.playing = !placement.playing;
      placement.frameIndex = placement.playing ? (asset.loopStart || 1) : 0;
    } else if (mode === "toggle") {
      if (placement.playing) {
        placement.playing = false;
      } else {
        placement.animationDirection = placement.frameIndex >= last ? -1 : 1;
        placement.playing = true;
      }
    } else if (mode === "cycle") {
      placement.frameIndex = ((placement.frameIndex || 0) + 1) % frameCount(asset);
    } else {
      placement.frameIndex = 0;
      placement.animationDirection = 1;
      placement.playing = true;
    }
    updatePlacementImage(placement);
    updateSelectionTools();
    return true;
  }

  function activateSelected() {
    const placement = selectedPlacement();
    if (!placement) return;
    if (activatePlacement(placement)) showToast(`${findAsset(placement.assetId)?.name}: ${placement.playing ? "playing" : "state changed"}`);
  }

  function duplicateSelected() {
    const placement = selectedPlacement();
    if (!placement) return;
    const copy = {
      ...placement,
      id: `item-${state.idCounter++}`,
      layer: state.layerCounter++,
      lastFrameAt: performance.now(),
    };
    if (placement.supportId) {
      copy.supportOffsetX = (placement.supportOffsetX || 0) + 10;
    } else {
      const nextColumn = clamp(placement.column + 0.5, 0, ROOM.columns - 1);
      const point = cellCenter(nextColumn, placement.row);
      copy.column = nextColumn;
      copy.x = point.x;
      copy.y = point.y;
    }
    state.placements.push(copy);
    state.selectedItemId = copy.id;
    renderItems();
    showToast("Item duplicated");
  }

  function onItemPointerDown(event) {
    if (event.button !== 0 || state.spaceDown) return;
    const id = event.currentTarget.dataset.id;
    const placement = findPlacement(id);
    if (!placement) return;
    const asset = findAsset(placement.assetId);
    const world = screenToWorld(event.clientX, event.clientY);

    // Clicking a support while holding a small item means "put this here", not
    // "select and drag the table". This is the missing tabletop behavior.
    if (state.selectedAsset?.tabletop && asset?.supportType === "tabletop") {
      event.stopPropagation();
      placeSelectedOnSupport(placement, world);
      return;
    }

    event.stopPropagation();
    selectItem(id);
    state.drag = { type: "item", id, pointerId: event.pointerId };
    try { viewport.setPointerCapture(event.pointerId); } catch (_error) { /* synthetic/test pointers may not be active */ }
  }

  function onItemClick(event) {
    event.stopPropagation();
    if (state.selectedAsset) return;
    selectItem(event.currentTarget.dataset.id);
  }

  function onItemDoubleClick(event) {
    event.stopPropagation();
    const placement = findPlacement(event.currentTarget.dataset.id);
    if (!placement) return;
    selectItem(placement.id);
    if (!activatePlacement(placement)) flipSelected();
  }

  function updatePlacementImage(placement) {
    const node = itemLayer.querySelector(`[data-id="${CSS.escape(placement.id)}"]`);
    const asset = findAsset(placement.assetId);
    if (node && asset) node.src = frameUrl(asset, placement.frameIndex || 0);
  }

  function tickAnimations() {
    const now = performance.now();
    let selectionChanged = false;
    for (const placement of state.placements) {
      const asset = findAsset(placement.assetId);
      if (!asset?.animated || !placement.playing || frameCount(asset) < 2) continue;
      const interval = 1000 / clamp(Number(asset.fps) || 8, 1, 30);
      if (now - (placement.lastFrameAt || 0) < interval) continue;
      placement.lastFrameAt = now;
      const last = frameCount(asset) - 1;
      const mode = asset.animationMode;
      if (mode === "loop") {
        placement.frameIndex = ((placement.frameIndex || 0) + 1) % frameCount(asset);
      } else if (mode === "toggleLoop") {
        const start = clamp(asset.loopStart || 1, 0, last);
        placement.frameIndex = placement.frameIndex < start || placement.frameIndex >= last
          ? start
          : placement.frameIndex + 1;
      } else if (mode === "toggle") {
        const next = (placement.frameIndex || 0) + (placement.animationDirection || 1);
        placement.frameIndex = clamp(next, 0, last);
        if (placement.frameIndex === 0 || placement.frameIndex === last) placement.playing = false;
      } else if (mode === "oneshot") {
        if ((placement.frameIndex || 0) >= last) {
          placement.frameIndex = 0;
          placement.playing = false;
        } else {
          placement.frameIndex = (placement.frameIndex || 0) + 1;
        }
      }
      updatePlacementImage(placement);
      if (placement.id === state.selectedItemId) selectionChanged = true;
    }
    if (selectionChanged) updateSelectionTools();
  }

  function applyView() {
    stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  }

  function zoomBy(delta) {
    state.scale = clamp(state.scale + delta, 0.55, 1.65);
    applyView();
  }

  function centerView() {
    state.scale = 1;
    state.panX = 0;
    state.panY = -60;
    applyView();
  }

  function defaultAsset(regex, category) {
    return state.manifest.find((asset) => asset.category === category && regex.test(`${asset.id} ${asset.name}`)) || null;
  }

  function addDefaultPlacement(asset, column, row, scale = null) {
    if (!asset) return null;
    const point = cellCenter(column, row);
    const placement = createPlacement(asset, { column, row, ...point });
    if (scale != null) placement.scale = scale;
    state.placements.push(placement);
    return placement;
  }

  function addDefaultAttached(asset, support, offsetX = 0) {
    if (!asset || !support) return null;
    const point = cellCenter(support.column, support.row);
    const placement = createPlacement(asset, { column: support.column, row: support.row, ...point });
    placement.supportId = support.id;
    placement.supportOffsetX = offsetX;
    state.placements.push(placement);
    return placement;
  }

  function resetRoom(notify = true) {
    state.placements = [];
    state.selectedItemId = null;
    state.selectedAsset = null;
    state.hoverSupportId = null;
    state.idCounter = 1;
    state.layerCounter = 1;
    ghost.hidden = true;

    const desk = addDefaultPlacement(findAsset("state-office-normal-table") || defaultAsset(/desk-1/i, "Furniture"), 2, 1);
    addDefaultAttached(findAsset("ani-macbook") || defaultAsset(/macbook/i, "Appliances"), desk, -8);
    addDefaultPlacement(defaultAsset(/gaming-chair|office-chair/i, "Furniture"), 3, 2);
    addDefaultPlacement(findAsset("ani-big-tv-a") || defaultAsset(/big.*tv|television/i, "Appliances"), 0, 1);
    addDefaultPlacement(defaultAsset(/sofa/i, "Furniture"), 2, 3);
    addDefaultPlacement(defaultAsset(/carpet.*red|carpet/i, "Decor"), 2, 3);
    addDefaultPlacement(defaultAsset(/plant.*5|plant/i, "Decor"), 1, 2);
    addDefaultPlacement(findAsset("ani-cat") || defaultAsset(/cat/i, "Decor"), 1, 4);

    renderSurfaces();
    renderItems();
    renderCatalog();
    centerView();
    if (notify) showToast("Room reset");
  }

  function clearPlaced() {
    if (state.placements.length && !confirm("Clear every placed item?")) return;
    state.placements = [];
    state.selectedItemId = null;
    renderItems();
    showToast("Room cleared");
  }

  function serializePlacement(placement) {
    const { lastFrameAt, ...serializable } = placement;
    return serializable;
  }

  function saveRoom() {
    const payload = {
      version: 3,
      floorAssetId: state.floorAsset?.id,
      leftWallAssetId: state.leftWallAsset?.id,
      rightWallAssetId: state.rightWallAsset?.id,
      placements: state.placements.map(serializePlacement),
    };
    const raw = JSON.stringify(payload);
    memorySave = raw;
    try {
      localStorage.setItem(SAVE_KEY, raw);
    } catch (error) {
      console.warn("Local storage unavailable; using in-memory save", error);
    }
    showToast("Room saved");
  }

  function normalizeLoadedPlacement(input) {
    const asset = findAsset(input.assetId);
    if (!asset) return null;
    const column = clamp(Number.isFinite(Number(input.column)) ? Number(input.column) : 0, 0, ROOM.columns - 1);
    const row = clamp(Number.isFinite(Number(input.row)) ? Number(input.row) : 0, 0, ROOM.rows - 1);
    const point = cellCenter(column, row);
    return {
      id: String(input.id || `item-${state.idCounter++}`),
      assetId: asset.id,
      column,
      row,
      x: point.x,
      y: point.y,
      scale: clamp(Number(input.scale) || asset.defaultScale || 1, 0.25, 4),
      flip: Boolean(input.flip),
      layer: Number(input.layer) || state.layerCounter++,
      supportId: typeof input.supportId === "string" ? input.supportId : null,
      supportOffsetX: Number(input.supportOffsetX) || 0,
      frameIndex: clamp(Number(input.frameIndex) || 0, 0, frameCount(asset) - 1),
      playing: asset.animationMode === "loop" ? input.playing !== false : Boolean(input.playing),
      animationDirection: Number(input.animationDirection) === -1 ? -1 : 1,
      lastFrameAt: performance.now(),
    };
  }

  function loadRoom() {
    try {
      let raw = memorySave;
      try {
        raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY) || raw;
      } catch (error) {
        console.warn("Local storage unavailable; using in-memory save", error);
      }
      if (!raw) {
        showToast("No saved room yet");
        return;
      }
      const data = JSON.parse(raw);
      state.floorAsset = findAsset(data.floorAssetId) || state.floorAsset;
      state.leftWallAsset = findAsset(data.leftWallAssetId) || state.leftWallAsset;
      state.rightWallAsset = findAsset(data.rightWallAssetId) || state.rightWallAsset;
      state.idCounter = 1;
      state.layerCounter = 1;
      state.placements = Array.isArray(data.placements)
        ? data.placements.map(normalizeLoadedPlacement).filter(Boolean)
        : [];
      const ids = new Set(state.placements.map((placement) => placement.id));
      for (const placement of state.placements) {
        if (placement.supportId && !ids.has(placement.supportId)) placement.supportId = null;
      }
      state.idCounter = state.placements.length + 1;
      state.layerCounter = state.placements.length + 1;
      state.selectedItemId = null;
      renderSurfaces();
      renderItems();
      showToast(data.version === 3 ? "Room loaded" : "Older room migrated");
    } catch (error) {
      console.error(error);
      showToast("Save could not be loaded");
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  async function exportRoom() {
    showToast("Rendering room image…");
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 561;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#49464b";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const drawAsset = async (src, x, y, width, height, flip = false) => {
      if (!src) return;
      const image = await loadImage(src);
      context.save();
      if (flip) {
        context.translate(x + width, y);
        context.scale(-1, 1);
        context.drawImage(image, 0, 0, width, height);
      } else {
        context.drawImage(image, x, y, width, height);
      }
      context.restore();
    };

    for (let row = 0; row < ROOM.rows; row += 1) {
      for (let column = 0; column < ROOM.columns; column += 1) {
        const point = floorTopLeft(column, row);
        await drawAsset(assetUrl(state.floorAsset), point.x, point.y, state.floorAsset.width, state.floorAsset.height);
      }
    }
    for (let index = 0; index < ROOM.rows; index += 1) {
      const left = leftWallTopLeft(index);
      const right = rightWallTopLeft(index);
      await drawAsset(assetUrl(state.leftWallAsset), left.x, left.y, state.leftWallAsset.width, state.leftWallAsset.height);
      await drawAsset(assetUrl(state.rightWallAsset), right.x, right.y, state.rightWallAsset.width, state.rightWallAsset.height);
    }

    const sorted = [...state.placements].sort((a, b) => zIndexFor(a) - zIndexFor(b));
    for (const placement of sorted) {
      const asset = findAsset(placement.assetId);
      if (!asset) continue;
      const resolved = resolvedPlacement(placement);
      const width = asset.width * placement.scale;
      const height = asset.height * placement.scale;
      await drawAsset(frameUrl(asset, placement.frameIndex || 0), resolved.x - width / 2, resolved.y - height, width, height, placement.flip);
    }

    const link = document.createElement("a");
    link.download = "tinyhouse-room.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("Room image exported");
  }

  function bindUI() {
    $("#search").addEventListener("input", (event) => {
      state.search = event.target.value;
      state.page = 0;
      renderCatalog();
    });
    $("#prev-page").addEventListener("click", () => { state.page -= 1; renderCatalog(); });
    $("#next-page").addEventListener("click", () => { state.page += 1; renderCatalog(); });
    $("#zoom-in").addEventListener("click", () => zoomBy(0.12));
    $("#zoom-out").addEventListener("click", () => zoomBy(-0.12));
    $("#center-view").addEventListener("click", centerView);
    $("#clear-room").addEventListener("click", clearPlaced);
    $("#reset-room").addEventListener("click", () => resetRoom(true));
    $("#save-room").addEventListener("click", saveRoom);
    $("#load-room").addEventListener("click", loadRoom);
    $("#export-room").addEventListener("click", exportRoom);

    tools.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action === "activate") activateSelected();
      if (action === "flip") flipSelected();
      if (action === "layer-down") layerSelected(-1);
      if (action === "layer-up") layerSelected(1);
      if (action === "duplicate") duplicateSelected();
      if (action === "delete") deleteSelected();
    });

    viewport.addEventListener("pointerdown", (event) => {
      if (state.spaceDown || event.button === 1) {
        state.drag = {
          type: "pan",
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          panX: state.panX,
          panY: state.panY,
        };
        try { viewport.setPointerCapture(event.pointerId); } catch (_error) { /* synthetic/test pointers may not be active */ }
        event.preventDefault();
        return;
      }
      if (event.target.closest("#catalog, #camera-tools, #selection-tools, #window-buttons")) return;
      const world = screenToWorld(event.clientX, event.clientY);
      if (state.selectedAsset && !["Floors", "Walls"].includes(state.selectedAsset.category)) {
        if (state.selectedAsset.tabletop) {
          const support = findSupportAtWorld(world);
          if (support) {
            placeSelectedOnSupport(support, world);
            return;
          }
        }
        const cell = worldToNearestCell(world.x, world.y);
        if (cell) placeSelectedAtCell(cell);
      } else if (!event.target.classList.contains("placed-item")) {
        state.selectedItemId = null;
        renderItems();
      }
    });

    viewport.addEventListener("pointermove", (event) => {
      const world = screenToWorld(event.clientX, event.clientY);
      const cell = worldToNearestCell(world.x, world.y);
      const support = state.selectedAsset?.tabletop ? findSupportAtWorld(world) : null;
      const nextSupportId = support?.id || null;
      if (nextSupportId !== state.hoverSupportId) {
        state.hoverSupportId = nextSupportId;
        renderItems();
      }

      if (!ghost.hidden && state.selectedAsset) {
        const asset = state.selectedAsset;
        let anchor = cell || world;
        if (support && asset.tabletop) {
          const geometry = supportGeometry(support);
          anchor = {
            x: geometry.centerX + clamp(world.x - geometry.centerX, -geometry.halfWidth, geometry.halfWidth),
            y: geometry.centerY + geometry.halfHeight * 0.28,
          };
        }
        const scale = asset.defaultScale || 1;
        ghost.style.left = `${anchor.x - asset.width * scale / 2}px`;
        ghost.style.top = `${anchor.y - asset.height * scale}px`;
        ghost.style.opacity = support || cell ? "0.72" : "0.28";
      }

      if (state.drag?.type === "pan") {
        state.panX = state.drag.panX + event.clientX - state.drag.startX;
        state.panY = state.drag.panY + event.clientY - state.drag.startY;
        applyView();
      } else if (state.drag?.type === "item") {
        const placement = findPlacement(state.drag.id);
        const asset = placement && findAsset(placement.assetId);
        if (!placement || !asset) return;
        const targetSupport = asset.tabletop ? findSupportAtWorld(world, placement.id) : null;
        if (targetSupport) {
          attachPlacementToSupport(placement, targetSupport, world);
          state.hoverSupportId = targetSupport.id;
          renderItems();
        } else if (cell) {
          placement.supportId = null;
          placement.supportOffsetX = 0;
          placement.column = cell.column;
          placement.row = cell.row;
          placement.x = cell.x;
          placement.y = cell.y;
          state.hoverSupportId = null;
          renderItems();
        }
      }
    });

    const endPointer = (event) => {
      if (state.drag?.pointerId === event.pointerId && viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      state.drag = null;
      state.hoverSupportId = null;
      renderItems();
    };
    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 0.08 : -0.08);
    }, { passive: false });

    window.addEventListener("keydown", (event) => {
      const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
      if (event.code === "Space" && !typing) {
        state.spaceDown = true;
        event.preventDefault();
      }
      if ((event.key === "Delete" || event.key === "Backspace") && !typing) deleteSelected();
      if (event.key.toLowerCase() === "r" && !typing) flipSelected();
      if (event.key === "Enter" && !typing) activateSelected();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRoom();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        loadRoom();
      }
      if (event.key === "Escape") {
        state.selectedAsset = null;
        state.selectedItemId = null;
        state.hoverSupportId = null;
        ghost.hidden = true;
        renderItems();
        renderCatalog();
      }
    });
    window.addEventListener("keyup", (event) => {
      if (event.code === "Space") state.spaceDown = false;
    });
  }

  function runSelfTest() {
    const geometry = geometryChecks();
    const relaxed = worldToNearestCell(cellCenter(2, 2).x + 48, cellCenter(2, 2).y + 14);
    const attached = state.placements.find((placement) => placement.supportId);
    const animationAssets = state.manifest.filter((asset) => asset.animated && frameCount(asset) > 1);
    const tests = {
      manifestLoaded: state.manifest.length >= 500,
      animationGroupsMapped: animationAssets.length >= 30,
      rawAnimationFramesHidden: !state.manifest.some((asset) => /bath-ani-bath-[2-9]$/.test(asset.id)),
      floorCount: $$(".floor-tile").length === ROOM.columns * ROOM.rows,
      leftWallCount: $$(".left-wall-tile").length === ROOM.rows,
      rightWallCount: $$(".right-wall-tile").length === ROOM.columns,
      relaxedFurnitureSnap: Boolean(relaxed),
      tabletopDefaultAttached: Boolean(attached && findPlacement(attached.supportId)),
      ...geometry,
    };
    const passed = Object.values(tests).every(Boolean);
    document.documentElement.dataset.selftest = passed ? "pass" : "fail";
    const report = $("#selftest-report");
    report.hidden = false;
    report.textContent = JSON.stringify({ passed, tests });
    window.__TINYHOUSE_SELFTEST__ = { passed, tests };
  }

  async function init() {
    if (window.TINYHOUSE_ASSETS_READY) await window.TINYHOUSE_ASSETS_READY;
    const data = window.TINYHOUSE_MANIFEST;
    if (!data || !Array.isArray(data.assets)) throw new Error("Could not load the TinyHouse asset manifest");
    state.manifest = data.assets;
    if (assetPackSummary) assetPackSummary.textContent = `${data.count.toLocaleString()} objects · ${data.animationGroups} animations · local licensed art`;
    chooseDefaults();
    buildTabs();
    bindUI();
    renderCatalog();
    resetRoom(false);
    applyView();
    clearInterval(animationTimer);
    animationTimer = setInterval(tickAnimations, 50);

    const checks = geometryChecks();
    if (!Object.values(checks).every(Boolean)) throw new Error("Internal wall/floor geometry check failed");
    showToast(`${data.count.toLocaleString()} placeable assets · ${data.animationGroups} mapped animations`);
    const params = new URLSearchParams(location.search);
    if (params.get("selftest") === "1") requestAnimationFrame(runSelfTest);
  }

  window.TinyHousePlayable = Object.freeze({
    room: ROOM,
    geometryChecks,
    worldToNearestCell,
    cellCenter,
    supportGeometry,
    state,
    activatePlacement,
  });

  init().catch((error) => {
    console.error(error);
    showToast(error.message);
    document.documentElement.dataset.boot = "failed";
  });
})();
