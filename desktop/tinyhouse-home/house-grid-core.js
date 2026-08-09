(() => {
  "use strict";

  const DEFAULT_ROOM = Object.freeze({
    originX: 650,
    originY: 190,
    tileWidth: 128,
    tileStepX: 64,
    tileStepY: 32,
    floorTopPixelY: 36,
    wallLiftY: -48,
    leftWallShiftX: -32,
    rightWallShiftX: 32,
    maxSpan: 24,
  });

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const cellKey = (column, row) => `${number(column)},${number(row)}`;
  const edgeKey = (axis, column, row) => `${axis}:${number(column)},${number(row)}`;
  const parseCellKey = (key) => {
    const [column, row] = String(key).split(",").map(Number);
    return { column, row };
  };
  const parseEdgeKey = (key) => {
    const [axis, coordinates] = String(key).split(":");
    const [column, row] = coordinates.split(",").map(Number);
    return { axis, column, row };
  };

  function floorTopLeft(column, row, room = DEFAULT_ROOM) {
    const topX = room.originX + (column - row) * room.tileStepX;
    const topY = room.originY + (column + row) * room.tileStepY;
    return { x: topX - room.tileWidth / 2, y: topY - room.floorTopPixelY };
  }

  function cellCenter(column, row, room = DEFAULT_ROOM) {
    return {
      x: room.originX + (column - row) * room.tileStepX,
      y: room.originY + (column + row) * room.tileStepY + room.tileStepY,
    };
  }

  function cellTopVertex(column, row, room = DEFAULT_ROOM) {
    return {
      x: room.originX + (column - row) * room.tileStepX,
      y: room.originY + (column + row) * room.tileStepY,
    };
  }

  function wallTopLeft(axis, column, row, room = DEFAULT_ROOM) {
    const floor = floorTopLeft(column, row, room);
    return axis === "left"
      ? { x: floor.x + room.leftWallShiftX, y: floor.y + room.wallLiftY }
      : { x: floor.x + room.rightWallShiftX, y: floor.y + room.wallLiftY };
  }

  function gridCoordinates(x, y, room = DEFAULT_ROOM) {
    const dx = number(x) - room.originX;
    const dy = number(y) - room.tileStepY - room.originY;
    return {
      column: (dy / room.tileStepY + dx / room.tileStepX) / 2,
      row: (dy / room.tileStepY - dx / room.tileStepX) / 2,
    };
  }

  function adjacentCellsForEdge(axis, column, row) {
    const current = { column, row };
    return axis === "left"
      ? [current, { column: column - 1, row }]
      : [current, { column, row: row - 1 }];
  }

  function edgeBetween(a, b) {
    if (a.row === b.row && Math.abs(a.column - b.column) === 1) {
      const rightCell = a.column > b.column ? a : b;
      return { axis: "left", column: rightCell.column, row: rightCell.row };
    }
    if (a.column === b.column && Math.abs(a.row - b.row) === 1) {
      const lowerCell = a.row > b.row ? a : b;
      return { axis: "right", column: lowerCell.column, row: lowerCell.row };
    }
    return null;
  }

  class HouseGrid {
    constructor(snapshot = {}, defaults = {}) {
      this.room = Object.freeze({ ...DEFAULT_ROOM, ...(defaults.room || {}) });
      this.defaultFloorAssetId = snapshot.defaultFloorAssetId || defaults.floorAssetId || null;
      this.defaultLeftWallAssetId = snapshot.defaultLeftWallAssetId || defaults.leftWallAssetId || null;
      this.defaultRightWallAssetId = snapshot.defaultRightWallAssetId || defaults.rightWallAssetId || null;
      this.defaultDoorAssetId = snapshot.defaultDoorAssetId || defaults.doorAssetId || null;
      this.floors = new Map();
      this.edges = new Map();

      for (const floor of snapshot.floors || []) {
        this.floors.set(cellKey(floor.column, floor.row), {
          column: number(floor.column),
          row: number(floor.row),
          assetId: floor.assetId || this.defaultFloorAssetId,
        });
      }
      for (const edge of snapshot.edges || []) {
        if (!["left", "right"].includes(edge.axis)) continue;
        this.edges.set(edgeKey(edge.axis, edge.column, edge.row), {
          axis: edge.axis,
          column: number(edge.column),
          row: number(edge.row),
          kind: edge.kind === "door" ? "door" : "wall",
          assetId: edge.assetId || null,
          doorAssetId: edge.kind === "door" ? (edge.doorAssetId || this.defaultDoorAssetId) : null,
          open: Boolean(edge.open),
        });
      }
    }

    static createDefault(defaults = {}) {
      const columns = number(defaults.columns, 5);
      const rows = number(defaults.rows, 5);
      const grid = new HouseGrid({}, defaults);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          grid.addFloor(column, row, defaults.floorAssetId);
        }
      }
      for (let row = 0; row < rows; row += 1) {
        grid.setWall("left", 0, row, defaults.leftWallAssetId);
      }
      for (let column = 0; column < columns; column += 1) {
        grid.setWall("right", column, 0, defaults.rightWallAssetId);
      }
      return grid;
    }

    clone() {
      return new HouseGrid(this.toJSON(), { room: this.room });
    }

    toJSON() {
      return {
        schemaVersion: 1,
        defaultFloorAssetId: this.defaultFloorAssetId,
        defaultLeftWallAssetId: this.defaultLeftWallAssetId,
        defaultRightWallAssetId: this.defaultRightWallAssetId,
        defaultDoorAssetId: this.defaultDoorAssetId,
        floors: [...this.floors.values()].map((floor) => ({ ...floor })),
        edges: [...this.edges.values()].map((edge) => ({ ...edge })),
      };
    }

    hasFloor(column, row) {
      return this.floors.has(cellKey(column, row));
    }

    floorAt(column, row) {
      return this.floors.get(cellKey(column, row)) || null;
    }

    addFloor(column, row, assetId = this.defaultFloorAssetId) {
      column = number(column);
      row = number(row);
      if (!this.withinSpan(column, row)) return null;
      const floor = { column, row, assetId: assetId || this.defaultFloorAssetId };
      this.floors.set(cellKey(column, row), floor);
      return floor;
    }

    removeFloor(column, row) {
      const key = cellKey(column, row);
      if (!this.floors.delete(key)) return false;
      for (const edge of [...this.edges.values()]) {
        const adjacent = adjacentCellsForEdge(edge.axis, edge.column, edge.row);
        if (adjacent.every((cell) => !this.hasFloor(cell.column, cell.row))) {
          this.edges.delete(edgeKey(edge.axis, edge.column, edge.row));
        }
      }
      return true;
    }

    withinSpan(column, row) {
      const bounds = this.bounds();
      if (!bounds) return true;
      const minColumn = Math.min(bounds.minColumn, column);
      const maxColumn = Math.max(bounds.maxColumn, column);
      const minRow = Math.min(bounds.minRow, row);
      const maxRow = Math.max(bounds.maxRow, row);
      return maxColumn - minColumn + 1 <= this.room.maxSpan
        && maxRow - minRow + 1 <= this.room.maxSpan;
    }

    edgeAt(axis, column, row) {
      return this.edges.get(edgeKey(axis, column, row)) || null;
    }

    setWall(axis, column, row, assetId = null) {
      const edge = {
        axis,
        column: number(column),
        row: number(row),
        kind: "wall",
        assetId: assetId || (axis === "left" ? this.defaultLeftWallAssetId : this.defaultRightWallAssetId),
        doorAssetId: null,
        open: false,
      };
      this.edges.set(edgeKey(axis, column, row), edge);
      return edge;
    }

    setDoor(axis, column, row, doorAssetId = this.defaultDoorAssetId, open = false) {
      const edge = {
        axis,
        column: number(column),
        row: number(row),
        kind: "door",
        assetId: null,
        doorAssetId: doorAssetId || this.defaultDoorAssetId,
        open: Boolean(open),
      };
      this.edges.set(edgeKey(axis, column, row), edge);
      return edge;
    }

    removeEdge(axis, column, row) {
      return this.edges.delete(edgeKey(axis, column, row));
    }

    toggleDoor(axis, column, row) {
      const edge = this.edgeAt(axis, column, row);
      if (!edge || edge.kind !== "door") return null;
      edge.open = !edge.open;
      return edge.open;
    }

    bounds() {
      if (!this.floors.size) return null;
      const cells = [...this.floors.values()];
      return {
        minColumn: Math.min(...cells.map((cell) => cell.column)),
        maxColumn: Math.max(...cells.map((cell) => cell.column)),
        minRow: Math.min(...cells.map((cell) => cell.row)),
        maxRow: Math.max(...cells.map((cell) => cell.row)),
      };
    }

    nearestFloorCell(x, y, tolerance = 118) {
      const coordinates = gridCoordinates(x, y, this.room);
      const candidates = [];
      for (let dc = -1; dc <= 1; dc += 1) {
        for (let dr = -1; dr <= 1; dr += 1) {
          const column = Math.round(coordinates.column * 2) / 2 + dc * 0.5;
          const row = Math.round(coordinates.row * 2) / 2 + dr * 0.5;
          if (!this.hasFloor(Math.round(column), Math.round(row))) continue;
          const snappedColumn = Math.round(column * 2) / 2;
          const snappedRow = Math.round(row * 2) / 2;
          const center = cellCenter(snappedColumn, snappedRow, this.room);
          const distance = Math.hypot(center.x - x, (center.y - y) * 1.35);
          candidates.push({ column: snappedColumn, row: snappedRow, ...center, distance });
        }
      }
      candidates.sort((a, b) => a.distance - b.distance);
      return candidates[0]?.distance <= tolerance ? candidates[0] : null;
    }

    nearestIntegerCell(x, y) {
      const coordinates = gridCoordinates(x, y, this.room);
      const column = Math.round(coordinates.column);
      const row = Math.round(coordinates.row);
      return { column, row, ...cellCenter(column, row, this.room) };
    }

    edgeBlocks(edge) {
      return Boolean(edge && (edge.kind === "wall" || (edge.kind === "door" && !edge.open)));
    }

    canTraverse(a, b) {
      if (!this.hasFloor(a.column, a.row) || !this.hasFloor(b.column, b.row)) return false;
      const descriptor = edgeBetween(a, b);
      if (!descriptor) return false;
      return !this.edgeBlocks(this.edgeAt(descriptor.axis, descriptor.column, descriptor.row));
    }

    rooms() {
      const unvisited = new Set(this.floors.keys());
      const rooms = [];
      while (unvisited.size) {
        const first = unvisited.values().next().value;
        const queue = [parseCellKey(first)];
        const room = [];
        unvisited.delete(first);
        while (queue.length) {
          const current = queue.shift();
          room.push(current);
          const neighbors = [
            { column: current.column - 1, row: current.row },
            { column: current.column + 1, row: current.row },
            { column: current.column, row: current.row - 1 },
            { column: current.column, row: current.row + 1 },
          ];
          for (const neighbor of neighbors) {
            const key = cellKey(neighbor.column, neighbor.row);
            if (!unvisited.has(key) || !this.canTraverse(current, neighbor)) continue;
            unvisited.delete(key);
            queue.push(neighbor);
          }
        }
        rooms.push(room);
      }
      return rooms;
    }

    addConnectedRoom(direction = "east", width = 3, depth = 3) {
      const bounds = this.bounds() || { minColumn: 0, maxColumn: -1, minRow: 0, maxRow: -1 };
      width = Math.max(2, Math.min(8, Math.round(width)));
      depth = Math.max(2, Math.min(8, Math.round(depth)));
      let startColumn;
      let startRow;
      let door;

      if (direction === "south") {
        startColumn = bounds.minColumn;
        startRow = bounds.maxRow + 1;
        for (let row = startRow; row < startRow + depth; row += 1) {
          for (let column = startColumn; column < startColumn + width; column += 1) {
            this.addFloor(column, row);
          }
        }
        const doorColumn = startColumn + Math.floor(width / 2);
        for (let column = startColumn; column < startColumn + width; column += 1) {
          this.setWall("right", column, startRow);
        }
        for (let row = startRow; row < startRow + depth; row += 1) {
          this.setWall("left", startColumn, row);
        }
        door = this.setDoor("right", doorColumn, startRow, this.defaultDoorAssetId, false);
      } else {
        startColumn = bounds.maxColumn + 1;
        startRow = bounds.minRow;
        for (let row = startRow; row < startRow + depth; row += 1) {
          for (let column = startColumn; column < startColumn + width; column += 1) {
            this.addFloor(column, row);
          }
        }
        const doorRow = startRow + Math.floor(depth / 2);
        for (let row = startRow; row < startRow + depth; row += 1) {
          this.setWall("left", startColumn, row);
        }
        for (let column = startColumn; column < startColumn + width; column += 1) {
          this.setWall("right", column, startRow);
        }
        door = this.setDoor("left", startColumn, doorRow, this.defaultDoorAssetId, false);
      }
      return { startColumn, startRow, width, depth, door };
    }
  }

  window.TinyHouseGridCore = Object.freeze({
    DEFAULT_ROOM,
    HouseGrid,
    cellKey,
    edgeKey,
    parseCellKey,
    parseEdgeKey,
    floorTopLeft,
    cellCenter,
    cellTopVertex,
    wallTopLeft,
    gridCoordinates,
    adjacentCellsForEdge,
    edgeBetween,
  });
})();
