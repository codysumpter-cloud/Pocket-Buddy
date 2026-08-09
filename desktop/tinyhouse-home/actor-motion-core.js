(() => {
  "use strict";

  const EPSILON = 1e-7;
  const DEFAULT_RADIUS = 0.10;
  const MAX_GRID_STEP = 0.075;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function roomFor(grid) {
    return grid?.room || window.TinyHouseGridCore?.DEFAULT_ROOM || {
      originX: 650,
      originY: 190,
      tileStepX: 64,
      tileStepY: 32,
    };
  }

  function cellFor(position) {
    return {
      column: Math.round(Number(position?.column) || 0),
      row: Math.round(Number(position?.row) || 0),
    };
  }

  function worldPoint(position, grid) {
    const room = roomFor(grid);
    if (window.TinyHouseGridCore?.cellCenter) {
      return window.TinyHouseGridCore.cellCenter(position.column, position.row, room);
    }
    return {
      x: room.originX + (position.column - position.row) * room.tileStepX,
      y: room.originY + (position.column + position.row) * room.tileStepY + room.tileStepY,
    };
  }

  function screenDeltaToGrid(dx, dy, grid) {
    const room = roomFor(grid);
    const stepX = Math.max(1, Number(room.tileStepX) || 64);
    const stepY = Math.max(1, Number(room.tileStepY) || 32);
    return {
      column: dx / (2 * stepX) + dy / (2 * stepY),
      row: -dx / (2 * stepX) + dy / (2 * stepY),
    };
  }

  function floorExists(grid, cell) {
    return Boolean(grid?.hasFloor?.(cell.column, cell.row));
  }

  function boundaryFor(cell, axis, sign, radius) {
    return cell[axis] + sign * (0.5 - radius);
  }

  function crossAllowed(grid, fromCell, toCell) {
    if (!floorExists(grid, fromCell) || !floorExists(grid, toCell)) return false;
    const dc = toCell.column - fromCell.column;
    const dr = toCell.row - fromCell.row;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return false;
    return Boolean(grid?.canTraverse?.(fromCell, toCell));
  }

  function moveAxis(grid, position, axis, delta, radius) {
    if (!Number.isFinite(delta) || Math.abs(delta) <= EPSILON) return { ...position };
    const result = { column: position.column, row: position.row };
    const direction = Math.sign(delta);
    let remaining = Math.abs(delta);

    while (remaining > EPSILON) {
      const step = Math.min(remaining, MAX_GRID_STEP) * direction;
      const fromCell = cellFor(result);
      if (!floorExists(grid, fromCell)) return result;

      const candidate = { ...result, [axis]: result[axis] + step };
      const toCell = cellFor(candidate);
      const otherAxis = axis === "column" ? "row" : "column";

      if (toCell[otherAxis] !== fromCell[otherAxis]) return result;
      if (toCell[axis] === fromCell[axis]) {
        const low = fromCell[axis] - 0.5 + radius;
        const high = fromCell[axis] + 0.5 - radius;
        candidate[axis] = clamp(candidate[axis], low, high);
        result[axis] = candidate[axis];
        remaining -= Math.abs(step);
        continue;
      }

      if (Math.abs(toCell[axis] - fromCell[axis]) !== 1 || !crossAllowed(grid, fromCell, toCell)) {
        result[axis] = boundaryFor(fromCell, axis, direction, radius);
        return result;
      }

      result[axis] = candidate[axis];
      remaining -= Math.abs(step);
    }

    return result;
  }

  function moveGrid(grid, position, deltaColumn, deltaRow, radius = DEFAULT_RADIUS) {
    const safeRadius = clamp(Number(radius) || DEFAULT_RADIUS, 0, 0.22);
    const start = { column: Number(position?.column) || 0, row: Number(position?.row) || 0 };
    const columnFirst = Math.abs(deltaColumn) >= Math.abs(deltaRow);

    const run = (firstAxis, firstDelta, secondAxis, secondDelta) => {
      const first = moveAxis(grid, start, firstAxis, firstDelta, safeRadius);
      return moveAxis(grid, first, secondAxis, secondDelta, safeRadius);
    };

    const primary = columnFirst
      ? run("column", deltaColumn, "row", deltaRow)
      : run("row", deltaRow, "column", deltaColumn);
    const alternate = columnFirst
      ? run("row", deltaRow, "column", deltaColumn)
      : run("column", deltaColumn, "row", deltaRow);

    const desired = { column: start.column + deltaColumn, row: start.row + deltaRow };
    const error = (candidate) => Math.hypot(candidate.column - desired.column, candidate.row - desired.row);
    return error(alternate) + EPSILON < error(primary) ? alternate : primary;
  }

  function moveScreen(grid, position, inputX, inputY, dtSeconds, speedPx = 150, radius = DEFAULT_RADIUS) {
    const magnitude = Math.hypot(inputX, inputY);
    if (!Number.isFinite(magnitude) || magnitude <= EPSILON) {
      const point = worldPoint(position, grid);
      return { position: { ...position }, dx: 0, dy: 0, moved: false, point };
    }

    const dt = clamp(Number(dtSeconds) || 0, 0, 0.05);
    const speed = Math.max(0, Number(speedPx) || 0);
    const dx = inputX / magnitude * speed * dt;
    const dy = inputY / magnitude * speed * dt;
    const delta = screenDeltaToGrid(dx, dy, grid);
    const before = worldPoint(position, grid);
    const next = moveGrid(grid, position, delta.column, delta.row, radius);
    const after = worldPoint(next, grid);
    const movedDx = after.x - before.x;
    const movedDy = after.y - before.y;
    return {
      position: next,
      dx: movedDx,
      dy: movedDy,
      moved: Math.hypot(movedDx, movedDy) > 0.05,
      point: after,
    };
  }

  function moveToward(grid, position, target, dtSeconds, speedPx = 105, stopPx = 5, radius = DEFAULT_RADIUS) {
    const from = worldPoint(position, grid);
    const to = worldPoint(target, grid);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= Math.max(0, stopPx)) {
      return { position: { ...position }, dx: 0, dy: 0, moved: false, point: from, reached: true, distance };
    }
    const result = moveScreen(grid, position, dx, dy, dtSeconds, speedPx, radius);
    return { ...result, reached: false, distance };
  }

  function randomFloorPoint(grid, rng = Math.random, inset = 0.18) {
    const floors = [...(grid?.floors?.values?.() ?? [])];
    if (!floors.length) return null;
    const floor = floors[Math.floor(clamp(Number(rng()) || 0, 0, 0.999999) * floors.length)] ?? floors[0];
    const margin = clamp(Number(inset) || 0.18, 0.05, 0.4);
    const span = 0.5 - margin;
    const jitter = () => (clamp(Number(rng()) || 0.5, 0, 1) * 2 - 1) * span;
    return {
      column: floor.column + jitter(),
      row: floor.row + jitter(),
    };
  }

  function distancePx(grid, a, b) {
    const pa = worldPoint(a, grid);
    const pb = worldPoint(b, grid);
    return Math.hypot(pb.x - pa.x, pb.y - pa.y);
  }

  window.PocketBuddyActorMotion = Object.freeze({
    DEFAULT_RADIUS,
    cellFor,
    worldPoint,
    screenDeltaToGrid,
    moveGrid,
    moveScreen,
    moveToward,
    randomFloorPoint,
    distancePx,
  });
})();
