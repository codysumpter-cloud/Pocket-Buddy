(() => {
  "use strict";

  const api = Object.freeze({
    grabOffset(pointer, anchor) {
      return {
        x: Number(pointer.x) - Number(anchor.x),
        y: Number(pointer.y) - Number(anchor.y),
      };
    },

    anchorFromPointer(pointer, offset) {
      return {
        x: Number(pointer.x) - Number(offset.x),
        y: Number(pointer.y) - Number(offset.y),
      };
    },

    snapshotPlacement(placement) {
      return {
        column: placement.column,
        row: placement.row,
        x: placement.x,
        y: placement.y,
        supportId: placement.supportId,
        supportOffsetX: placement.supportOffsetX,
        wallSide: placement.wallSide || null,
        wallIndex: placement.wallIndex ?? null,
        structureEdgeKey: placement.structureEdgeKey || null,
        wallColumn: placement.wallColumn ?? null,
        wallRow: placement.wallRow ?? null,
      };
    },

    restorePlacement(placement, snapshot) {
      placement.column = snapshot.column;
      placement.row = snapshot.row;
      placement.x = snapshot.x;
      placement.y = snapshot.y;
      placement.supportId = snapshot.supportId;
      placement.supportOffsetX = snapshot.supportOffsetX;
      if (snapshot.wallSide) {
        placement.wallSide = snapshot.wallSide;
        placement.wallIndex = snapshot.wallIndex;
        placement.structureEdgeKey = snapshot.structureEdgeKey;
        placement.wallColumn = snapshot.wallColumn;
        placement.wallRow = snapshot.wallRow;
      } else {
        delete placement.wallSide;
        delete placement.wallIndex;
        delete placement.structureEdgeKey;
        delete placement.wallColumn;
        delete placement.wallRow;
      }
      return placement;
    },
  });

  window.TinyHouseDragCore = api;
})();
