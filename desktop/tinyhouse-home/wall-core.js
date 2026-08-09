(() => {
  "use strict";

  const WALL_PATTERN = /(?:^|[\s_\-/])(poster|painting|picture|photo|photos|canvas|diploma|blueprint|corkboard|whiteboard|board|window|projector[\s_-]*screen|television|tv|wall[\s_-]*(?:art|decor))(?:$|[\s_\-/])/i;
  const FLOOR_OR_SURFACE_PATTERN = /(?:floor|wall_[lr]|wall-[lr]|wall\s+[lr]|wall\s+left|wall\s+right|wall\s+tile)/i;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isWallMountable(asset) {
    if (!asset || asset.category === "Floors" || asset.category === "Walls") return false;
    const haystack = `${asset.id || ""} ${asset.name || ""} ${asset.folder || ""}`;
    if (FLOOR_OR_SURFACE_PATTERN.test(haystack)) return false;
    return WALL_PATTERN.test(` ${haystack} `)
      || /Televisions_TV/i.test(asset.folder || "")
      || /BigTV|Big Tv|Tv Off|TV \+ DVD/i.test(asset.name || "");
  }

  function floorTopLeft(room, column, row) {
    const topX = room.originX + (column - row) * room.tileStepX;
    const topY = room.originY + (column + row) * room.tileStepY;
    return {
      x: topX - room.tileWidth / 2,
      y: topY - room.floorTopPixelY,
    };
  }

  function wallTopLeft(room, side, index) {
    if (side === "left") {
      const floor = floorTopLeft(room, 0, index);
      return { x: floor.x + room.leftWallShiftX, y: floor.y + room.wallLiftY };
    }
    const floor = floorTopLeft(room, index, 0);
    return { x: floor.x + room.rightWallShiftX, y: floor.y + room.wallLiftY };
  }

  function structureWallTargets(hitPoint, anchorPoint) {
    const structure = window.TinyHouseStructure;
    const gridCore = window.TinyHouseGridCore;
    if (!structure?.grid || !gridCore) return [];
    const targets = [];
    for (const edge of structure.grid.edges.values()) {
      if (edge.kind !== "wall") continue;
      const top = gridCore.wallTopLeft(edge.axis, edge.column, edge.row, structure.grid.room);
      const centerX = top.x + 64;
      const centerY = top.y + 58;
      const dx = Math.abs(hitPoint.x - centerX) / 58;
      const dy = Math.abs(hitPoint.y - centerY) / 54;
      if (dx > 1.16 || dy > 1.12) continue;
      targets.push({
        side: edge.axis,
        index: edge.axis === "left" ? edge.row : edge.column,
        column: edge.column,
        row: edge.row,
        structureEdgeKey: gridCore.edgeKey(edge.axis, edge.column, edge.row),
        x: clamp(anchorPoint.x, top.x + 20, top.x + 108),
        y: clamp(anchorPoint.y, top.y + 28, top.y + 108),
        distance: Math.sqrt(dx * dx + dy * dy),
      });
    }
    return targets;
  }

  function nearestWallTarget(hitPoint, asset, room, anchorPoint = hitPoint) {
    if (!isWallMountable(asset) || !room) return null;
    const structural = structureWallTargets(hitPoint, anchorPoint)
      .sort((a, b) => a.distance - b.distance)[0];
    if (window.TinyHouseStructure) return structural || null;

    let best = null;
    let bestScore = Infinity;
    for (const side of ["left", "right"]) {
      for (let index = 0; index < (side === "left" ? room.rows : room.columns); index += 1) {
        const top = wallTopLeft(room, side, index);
        const centerX = top.x + 64;
        const centerY = top.y + 58;
        const dx = Math.abs(hitPoint.x - centerX) / 58;
        const dy = Math.abs(hitPoint.y - centerY) / 54;
        const score = dx * dx + dy * dy;
        if (dx > 1.16 || dy > 1.12 || score >= bestScore) continue;
        bestScore = score;
        best = {
          side,
          index,
          x: clamp(anchorPoint.x, top.x + 20, top.x + 108),
          y: clamp(anchorPoint.y, top.y + 28, top.y + 108),
          distance: Math.sqrt(score),
        };
      }
    }
    return best;
  }

  function applyWallPlacement(placement, target) {
    placement.supportId = null;
    placement.supportOffsetX = 0;
    placement.wallSide = target.side;
    placement.wallIndex = target.index;
    placement.structureEdgeKey = target.structureEdgeKey || null;
    placement.wallColumn = Number.isFinite(target.column) ? target.column : null;
    placement.wallRow = Number.isFinite(target.row) ? target.row : null;
    placement.column = Number.isFinite(target.column)
      ? target.column
      : (target.side === "right" ? target.index : 0);
    placement.row = Number.isFinite(target.row)
      ? target.row
      : (target.side === "left" ? target.index : 0);
    placement.x = target.x;
    placement.y = target.y;
    return placement;
  }

  function clearWallPlacement(placement) {
    placement.wallSide = null;
    placement.wallIndex = null;
    placement.structureEdgeKey = null;
    placement.wallColumn = null;
    placement.wallRow = null;
    return placement;
  }

  function wallZIndex(placement) {
    const column = Number(placement.wallColumn ?? placement.column) || 0;
    const row = Number(placement.wallRow ?? placement.row) || 0;
    const layer = Number(placement.layer) || 0;
    return 760 + Math.round((column + row) * 12) + layer;
  }

  window.TinyHouseWallCore = Object.freeze({
    isWallMountable,
    nearestWallTarget,
    applyWallPlacement,
    clearWallPlacement,
    wallTopLeft,
    wallZIndex,
  });
})();
