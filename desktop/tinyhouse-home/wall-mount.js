(() => {
  "use strict";

  const viewport = document.querySelector("#world-viewport");
  const itemLayer = document.querySelector("#item-layer");
  const assetGrid = document.querySelector("#asset-grid");
  const ghost = document.querySelector("#placement-ghost");
  const tools = document.querySelector("#selection-tools");
  const selectionMeta = document.querySelector("#selection-meta");
  const modeHint = document.querySelector("#mode-hint");
  const toast = document.querySelector("#toast");
  const playable = window.TinyHousePlayable;
  const wallCore = window.TinyHouseWallCore;
  if (!viewport || !itemLayer || !ghost || !playable || !wallCore) return;

  const SAVE_KEY = "pocket-buddy-plus-tinyhouse-local-v1";
  const LEGACY_SAVE_KEY = "prismtek-tinyhouse-playable-v3";
  const state = playable.state;

  const findAsset = (id) => state.manifest.find((asset) => asset.id === id) || null;
  const findPlacement = (id) => state.placements.find((placement) => placement.id === id) || null;

  function screenToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.panX) / state.scale,
      y: (clientY - rect.top - state.panY) / state.scale,
    };
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1700);
  }

  function forceAppRender(selectedId = null) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    decorateRenderedItems();
    if (!selectedId) return;
    requestAnimationFrame(() => {
      const node = itemLayer.querySelector(`[data-id="${CSS.escape(selectedId)}"]`);
      node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      decorateRenderedItems();
      updateSelectionMetadata();
    });
  }

  function createWallPlacement(asset, target) {
    const placement = {
      id: `item-${state.idCounter++}`,
      assetId: asset.id,
      column: Number.isFinite(target.column) ? target.column : (target.side === "right" ? target.index : 0),
      row: Number.isFinite(target.row) ? target.row : (target.side === "left" ? target.index : 0),
      x: target.x,
      y: target.y,
      scale: asset.defaultScale || 1,
      flip: target.side === "right" && asset.orientation === "back",
      layer: state.layerCounter++,
      supportId: null,
      supportOffsetX: 0,
      wallSide: target.side,
      wallIndex: target.index,
      structureEdgeKey: target.structureEdgeKey || null,
      wallColumn: Number.isFinite(target.column) ? target.column : null,
      wallRow: Number.isFinite(target.row) ? target.row : null,
      frameIndex: 0,
      playing: asset.animationMode === "loop",
      animationDirection: 1,
      lastFrameAt: performance.now(),
    };
    wallCore.applyWallPlacement(placement, target);
    return placement;
  }

  function placeSelectedOnWall(target) {
    const asset = state.selectedAsset;
    if (!wallCore.isWallMountable(asset)) return false;
    const placement = createWallPlacement(asset, target);
    state.placements.push(placement);
    state.selectedAsset = null;
    state.selectedItemId = placement.id;
    state.hoverSupportId = null;
    ghost.hidden = true;
    ghost.classList.remove("wall-target");
    forceAppRender(placement.id);
    showToast(`${asset.name} mounted on the ${target.side} wall`);
    return true;
  }

  function positionWallGhost(asset, target) {
    const scale = asset.defaultScale || 1;
    ghost.hidden = false;
    ghost.classList.add("wall-target");
    ghost.style.left = `${target.x - asset.width * scale / 2}px`;
    ghost.style.top = `${target.y - asset.height * scale}px`;
    ghost.style.opacity = "0.82";
  }

  function decorateRenderedItems() {
    for (const placement of state.placements) {
      const node = itemLayer.querySelector(`[data-id="${CSS.escape(placement.id)}"]`);
      if (!node) continue;
      node.classList.toggle("wall-mounted", Boolean(placement.wallSide));
      if (placement.wallSide) node.style.zIndex = String(wallCore.wallZIndex(placement));
    }
  }

  function decorateCatalog() {
    if (!assetGrid) return;
    for (const card of assetGrid.querySelectorAll(".asset-card")) {
      const image = card.querySelector("img");
      const asset = state.manifest.find((candidate) => candidate.name === image?.alt);
      if (!wallCore.isWallMountable(asset) || card.querySelector(".wall-badge")) continue;
      const badge = document.createElement("span");
      badge.className = "wall-badge";
      badge.textContent = "WALL";
      card.append(badge);
    }
  }

  function updateSelectionMetadata() {
    const placement = findPlacement(state.selectedItemId);
    const asset = placement && findAsset(placement.assetId);
    if (!placement?.wallSide || !asset || !selectionMeta) return;
    const behavior = asset.animated ? " · INTERACTIVE" : "";
    const edge = placement.structureEdgeKey ? ` · EDGE ${placement.structureEdgeKey}` : "";
    selectionMeta.textContent = `${asset.category} · ${placement.wallSide.toUpperCase()} WALL${edge}${behavior}`;
  }

  function restoreWallPlacementsAfterLoad() {
    let raw = null;
    try {
      raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(LEGACY_SAVE_KEY);
    } catch (_error) {
      return;
    }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      const savedById = new Map((saved.placements || []).map((placement) => [String(placement.id), placement]));
      let restored = 0;
      for (const placement of state.placements) {
        const source = savedById.get(String(placement.id));
        if (!source?.wallSide) continue;
        placement.wallSide = source.wallSide;
        placement.wallIndex = Number(source.wallIndex) || 0;
        placement.structureEdgeKey = source.structureEdgeKey || null;
        placement.wallColumn = Number.isFinite(Number(source.wallColumn)) ? Number(source.wallColumn) : null;
        placement.wallRow = Number.isFinite(Number(source.wallRow)) ? Number(source.wallRow) : null;
        placement.x = Number(source.x);
        placement.y = Number(source.y);
        placement.column = Number(source.column) || 0;
        placement.row = Number(source.row) || 0;
        placement.supportId = null;
        placement.supportOffsetX = 0;
        restored += 1;
      }
      if (restored) forceAppRender();
    } catch (error) {
      console.warn("[tinyhouse/wall-mount] Could not restore wall placements", error);
    }
  }

  function duplicateSelectedWallItem(event) {
    const button = event.target.closest?.('[data-action="duplicate"]');
    const placement = findPlacement(state.selectedItemId);
    if (!button || !placement?.wallSide) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const asset = findAsset(placement.assetId);
    const target = wallCore.nearestWallTarget(
      { x: placement.x + 12, y: placement.y + 8 },
      asset,
      playable.room,
      { x: placement.x + 12, y: placement.y + 8 },
    ) || {
      side: placement.wallSide,
      index: placement.wallIndex,
      column: placement.wallColumn,
      row: placement.wallRow,
      structureEdgeKey: placement.structureEdgeKey,
      x: placement.x,
      y: placement.y,
    };
    const copy = {
      ...placement,
      id: `item-${state.idCounter++}`,
      layer: state.layerCounter++,
      lastFrameAt: performance.now(),
    };
    wallCore.applyWallPlacement(copy, target);
    state.placements.push(copy);
    forceAppRender(copy.id);
    showToast(`${asset?.name || "Wall item"} duplicated`);
  }

  viewport.addEventListener("pointermove", (event) => {
    const asset = state.selectedAsset;
    if (!wallCore.isWallMountable(asset) || state.drag) {
      ghost.classList.remove("wall-target");
      return;
    }
    const world = screenToWorld(event.clientX, event.clientY);
    const target = wallCore.nearestWallTarget(world, asset, playable.room, world);
    if (!target) {
      ghost.classList.remove("wall-target");
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    positionWallGhost(asset, target);
  }, true);

  viewport.addEventListener("pointerdown", (event) => {
    const asset = state.selectedAsset;
    if (event.button !== 0 || state.spaceDown || !wallCore.isWallMountable(asset)) return;
    const world = screenToWorld(event.clientX, event.clientY);
    const target = wallCore.nearestWallTarget(world, asset, playable.room, world);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    placeSelectedOnWall(target);
  }, true);

  tools?.addEventListener("click", duplicateSelectedWallItem, true);
  document.querySelector("#load-room")?.addEventListener("click", () => {
    setTimeout(restoreWallPlacementsAfterLoad, 0);
  });

  itemLayer.addEventListener("click", () => requestAnimationFrame(() => {
    decorateRenderedItems();
    updateSelectionMetadata();
  }), true);
  assetGrid?.addEventListener("pointerenter", decorateCatalog);

  const style = document.createElement("style");
  style.textContent = `
    #placement-ghost.wall-target { filter: drop-shadow(0 0 8px rgba(119, 230, 255, .9)); }
    .placed-item.wall-mounted { filter: drop-shadow(0 2px 2px rgba(0, 0, 0, .42)); }
    .placed-item.wall-mounted.selected { filter: drop-shadow(0 0 6px #74e6ff) drop-shadow(0 2px 2px rgba(0,0,0,.42)); }
    .wall-badge { position:absolute; left:4px; bottom:4px; z-index:4; padding:2px 4px; font-size:8px; line-height:1; color:#10242b; background:#74e6ff; border:1px solid #10242b; }
  `;
  document.head.append(style);

  if (modeHint) {
    const placeText = modeHint.querySelector("b + span");
    if (placeText) placeText.textContent = "Use Structure to alter the house, or choose an asset and click an existing floor, tabletop, or wall edge.";
  }

  window.TinyHouseWallMount = Object.freeze({
    placeSelectedOnWall,
    restoreWallPlacementsAfterLoad,
    decorateRenderedItems,
  });
})();
