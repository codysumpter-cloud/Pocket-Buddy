(() => {
  "use strict";

  const gridCore = window.TinyHouseGridCore;
  if (!gridCore) return;

  const directions = Object.freeze(["east", "south"]);
  const clampRoomSize = (value) => Math.max(2, Math.min(8, Math.round(Number(value) || 3)));

  function footprintComponents(grid, excludedCell = null) {
    const excludedKey = excludedCell
      ? gridCore.cellKey(excludedCell.column, excludedCell.row)
      : null;
    const unvisited = new Set(
      [...grid.floors.keys()].filter((key) => key !== excludedKey),
    );
    const components = [];

    while (unvisited.size) {
      const first = unvisited.values().next().value;
      const queue = [gridCore.parseCellKey(first)];
      const component = [];
      unvisited.delete(first);

      while (queue.length) {
        const current = queue.shift();
        component.push(current);
        const neighbors = [
          { column: current.column - 1, row: current.row },
          { column: current.column + 1, row: current.row },
          { column: current.column, row: current.row - 1 },
          { column: current.column, row: current.row + 1 },
        ];
        for (const neighbor of neighbors) {
          const key = gridCore.cellKey(neighbor.column, neighbor.row);
          if (!unvisited.has(key)) continue;
          unvisited.delete(key);
          queue.push(neighbor);
        }
      }
      components.push(component);
    }

    return components;
  }

  function wouldSplitFootprint(grid, column, row) {
    if (!grid.hasFloor(column, row) || grid.floors.size <= 1) return false;
    return footprintComponents(grid, { column, row }).length > 1;
  }

  function connectedRoomPlan(grid, direction = "east", width = 3, depth = 3) {
    direction = directions.includes(direction) ? direction : "east";
    width = clampRoomSize(width);
    depth = clampRoomSize(depth);
    const bounds = grid.bounds() || {
      minColumn: 0,
      maxColumn: -1,
      minRow: 0,
      maxRow: -1,
    };
    const startColumn = direction === "east" ? bounds.maxColumn + 1 : bounds.minColumn;
    const startRow = direction === "south" ? bounds.maxRow + 1 : bounds.minRow;
    const floors = [];

    for (let row = startRow; row < startRow + depth; row += 1) {
      for (let column = startColumn; column < startColumn + width; column += 1) {
        floors.push({ column, row });
      }
    }

    const collision = floors.find((cell) => grid.hasFloor(cell.column, cell.row));
    const spanOverflow = floors.find((cell) => !grid.withinSpan(cell.column, cell.row));
    const door = direction === "south"
      ? {
        axis: "right",
        column: startColumn + Math.floor(width / 2),
        row: startRow,
      }
      : {
        axis: "left",
        column: startColumn,
        row: startRow + Math.floor(depth / 2),
      };

    return {
      valid: !collision && !spanOverflow,
      reason: collision
        ? "The planned room overlaps an existing floor tile."
        : spanOverflow
          ? `The house cannot exceed ${grid.room.maxSpan}×${grid.room.maxSpan} tiles.`
          : "",
      direction,
      width,
      depth,
      startColumn,
      startRow,
      floors,
      door,
    };
  }

  window.TinyHouseBlueprintCore = Object.freeze({
    directions,
    clampRoomSize,
    footprintComponents,
    wouldSplitFootprint,
    connectedRoomPlan,
  });
})();
