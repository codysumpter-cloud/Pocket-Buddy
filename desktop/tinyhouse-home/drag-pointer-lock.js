(() => {
  "use strict";

  const viewport = document.querySelector("#world-viewport");
  const itemLayer = document.querySelector("#item-layer");
  const core = window.TinyHouseDragCore;
  const wallCore = window.TinyHouseWallCore;
  const playable = window.TinyHousePlayable;
  if (!viewport || !itemLayer || !core || !playable) return;

  const state = playable.state;
  let active = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const roundTo = (value, increment) => Math.round(value / increment) * increment;
  const findPlacement = (id) => state.placements.find((placement) => placement.id === id) || null;
  const findAsset = (id) => state.manifest.find((asset) => asset.id === id) || null;

  function screenToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - state.panX) / state.scale,
      y: (clientY - rect.top - state.panY) / state.scale,
    };
  }

  function resolvedAnchor(placement) {
    if (!placement.supportId) return { x: placement.x, y: placement.y };
    const support = findPlacement(placement.supportId);
    const geometry = support && playable.supportGeometry(support);
    if (!geometry) return { x: placement.x, y: placement.y };
    return {
      x: geometry.centerX + clamp(placement.supportOffsetX || 0, -geometry.halfWidth, geometry.halfWidth),
      y: geometry.centerY + geometry.halfHeight * 0.28,
    };
  }

  function findSupportAtWorld(world, excludeId = null) {
    let best = null;
    let bestScore = Infinity;
    for (const placement of state.placements) {
      if (placement.id === excludeId) continue;
      const asset = findAsset(placement.assetId);
      if (asset?.supportType !== "tabletop") continue;
      const geometry = playable.supportGeometry(placement);
      if (!geometry) continue;
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

  function previewZIndex(placement, anchor) {
    if (placement.supportId) {
      const support = findPlacement(placement.supportId);
      const supportAnchor = support ? resolvedAnchor(support) : null;
      if (supportAnchor) {
        return 1000 + Math.round(supportAnchor.y * 10 + 600 + placement.layer);
      }
    }
    if (placement.wallSide && wallCore) return wallCore.wallZIndex(placement);
    return 1000 + Math.round(anchor.y * 10 + placement.layer);
  }

  function updatePreviewPositions() {
    for (const placement of state.placements) {
      const node = itemLayer.querySelector(`[data-id="${CSS.escape(placement.id)}"]`);
      const asset = findAsset(placement.assetId);
      if (!node || !asset) continue;
      const anchor = resolvedAnchor(placement);
      const width = asset.width * placement.scale;
      const height = asset.height * placement.scale;
      node.style.left = `${anchor.x - width / 2}px`;
      node.style.top = `${anchor.y - height}px`;
      node.style.zIndex = String(previewZIndex(placement, anchor));
      node.classList.toggle("support-target", placement.id === state.hoverSupportId);
      node.classList.toggle("wall-mounted", Boolean(placement.wallSide));
    }
  }

  function restoreOriginal() {
    if (!active) return;
    const placement = findPlacement(active.id);
    if (placement) core.restorePlacement(placement, active.original);
  }

  function nearestValidFloorCell(anchor) {
    const structure = window.TinyHouseStructure;
    return structure
      ? structure.worldToNearestFloorCell(anchor.x, anchor.y)
      : playable.worldToNearestCell(anchor.x, anchor.y);
  }

  function finalizeDrag(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    const placement = findPlacement(active.id);
    const asset = placement && findAsset(placement.assetId);
    if (!placement || !asset || !active.moved) {
      restoreOriginal();
      active = null;
      state.hoverSupportId = null;
      updatePreviewPositions();
      return;
    }

    const pointer = screenToWorld(event.clientX, event.clientY);
    const anchor = core.anchorFromPointer(pointer, active.offset);
    const wallTarget = wallCore?.isWallMountable(asset)
      ? wallCore.nearestWallTarget(pointer, asset, playable.room, anchor)
      : null;
    const targetSupport = !wallTarget && asset.tabletop
      ? findSupportAtWorld(anchor, placement.id)
      : null;

    if (wallTarget) {
      wallCore.applyWallPlacement(placement, wallTarget);
    } else if (targetSupport) {
      const geometry = playable.supportGeometry(targetSupport);
      wallCore?.clearWallPlacement(placement);
      placement.supportId = targetSupport.id;
      placement.supportOffsetX = roundTo(
        clamp(anchor.x - geometry.centerX, -geometry.halfWidth, geometry.halfWidth),
        4,
      );
      placement.column = targetSupport.column;
      placement.row = targetSupport.row;
      placement.x = anchor.x;
      placement.y = anchor.y;
    } else {
      const cell = nearestValidFloorCell(anchor);
      if (cell) {
        wallCore?.clearWallPlacement(placement);
        placement.supportId = null;
        placement.supportOffsetX = 0;
        placement.column = cell.column;
        placement.row = cell.row;
        placement.x = cell.x;
        placement.y = cell.y;
      } else {
        core.restorePlacement(placement, active.original);
      }
    }

    active = null;
    state.hoverSupportId = null;
    updatePreviewPositions();
  }

  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.spaceDown) return;
    const node = event.target.closest?.(".placed-item");
    if (!node) return;
    const placement = findPlacement(node.dataset.id);
    const asset = placement && findAsset(placement.assetId);
    if (!placement || !asset) return;

    if (state.selectedAsset?.tabletop && asset.supportType === "tabletop") return;

    const pointer = screenToWorld(event.clientX, event.clientY);
    const anchor = resolvedAnchor(placement);
    active = {
      id: placement.id,
      pointerId: event.pointerId,
      offset: core.grabOffset(pointer, anchor),
      original: core.snapshotPlacement(placement),
      startPointer: pointer,
      moved: false,
    };
    event.preventDefault();
  }, true);

  viewport.addEventListener("pointermove", (event) => {
    if (!active || event.pointerId !== active.pointerId) return;
    const placement = findPlacement(active.id);
    const asset = placement && findAsset(placement.assetId);
    if (!placement || !asset) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const pointer = screenToWorld(event.clientX, event.clientY);
    if (!active.moved) {
      active.moved = Math.hypot(
        pointer.x - active.startPointer.x,
        pointer.y - active.startPointer.y,
      ) >= 0.5;
    }
    if (!active.moved) return;

    const anchor = core.anchorFromPointer(pointer, active.offset);
    const wallTarget = wallCore?.isWallMountable(asset)
      ? wallCore.nearestWallTarget(pointer, asset, playable.room, anchor)
      : null;

    placement.supportId = null;
    placement.supportOffsetX = 0;
    if (wallTarget) {
      wallCore.applyWallPlacement(placement, wallTarget);
      state.hoverSupportId = null;
    } else {
      wallCore?.clearWallPlacement(placement);
      placement.x = anchor.x;
      placement.y = anchor.y;
      state.hoverSupportId = asset.tabletop
        ? findSupportAtWorld(anchor, placement.id)?.id || null
        : null;
    }
    updatePreviewPositions();
  }, true);

  viewport.addEventListener("pointerup", finalizeDrag, true);
  viewport.addEventListener("pointercancel", (event) => {
    if (!active || event.pointerId !== active.pointerId) return;
    restoreOriginal();
    active = null;
    state.hoverSupportId = null;
    updatePreviewPositions();
  }, true);
})();
