(() => {
  "use strict";

  // A* over the canonical TinyHouse floor graph.
  //
  // Traversal is delegated entirely to HouseGrid.canTraverse, so walls, closed
  // doors and missing floors are respected by construction and there is no
  // second copy of the topology rules. Paths are lists of integer cells; the
  // actor still crosses between them with the continuous motion core, so this
  // never reintroduces tile snapping.

  const key = (cell) => `${cell.column},${cell.row}`;
  const cellOf = (position) => ({
    column: Math.round(Number(position?.column) || 0),
    row: Math.round(Number(position?.row) || 0),
  });

  const NEIGHBOURS = Object.freeze([
    { column: 1, row: 0 },
    { column: -1, row: 0 },
    { column: 0, row: 1 },
    { column: 0, row: -1 },
  ]);

  /** Manhattan distance: exact for a 4-connected grid with unit costs. */
  function heuristic(a, b) {
    return Math.abs(a.column - b.column) + Math.abs(a.row - b.row);
  }

  /**
   * Find a walkable route between two cells.
   * Returns [] when start or goal is unreachable, and [start] when already there.
   */
  function findPath(grid, from, to, options = {}) {
    if (!grid?.hasFloor || !grid?.canTraverse) return [];
    const start = cellOf(from);
    const goal = cellOf(to);
    if (!grid.hasFloor(start.column, start.row) || !grid.hasFloor(goal.column, goal.row)) return [];
    if (key(start) === key(goal)) return [start];

    const maxNodes = Math.max(1, Number(options.maxNodes) || 4096);
    const open = [{ cell: start, f: heuristic(start, goal) }];
    const cameFrom = new Map();
    const best = new Map([[key(start), 0]]);
    const closed = new Set();
    let expanded = 0;

    while (open.length) {
      // Small frontiers in a house-sized graph; a linear scan beats the
      // bookkeeping of a heap and keeps this readable.
      let index = 0;
      for (let i = 1; i < open.length; i += 1) if (open[i].f < open[index].f) index = i;
      const current = open.splice(index, 1)[0].cell;
      const currentKey = key(current);
      if (closed.has(currentKey)) continue;
      closed.add(currentKey);

      if (currentKey === key(goal)) {
        const path = [current];
        let cursor = currentKey;
        while (cameFrom.has(cursor)) {
          const previous = cameFrom.get(cursor);
          path.push(previous);
          cursor = key(previous);
        }
        return path.reverse();
      }

      if ((expanded += 1) > maxNodes) return [];

      for (const step of NEIGHBOURS) {
        const next = { column: current.column + step.column, row: current.row + step.row };
        const nextKey = key(next);
        if (closed.has(nextKey)) continue;
        if (!grid.canTraverse(current, next)) continue;
        const cost = (best.get(currentKey) ?? Infinity) + 1;
        if (cost >= (best.get(nextKey) ?? Infinity)) continue;
        best.set(nextKey, cost);
        cameFrom.set(nextKey, current);
        open.push({ cell: next, f: cost + heuristic(next, goal) });
      }
    }
    return [];
  }

  /** True when a route exists (doors included). */
  function isReachable(grid, from, to) {
    return findPath(grid, from, to).length > 0;
  }

  /**
   * Drop waypoints that are already behind the actor, so a continuously moving
   * actor never walks backwards to touch a cell centre it has passed.
   */
  function advancePath(path, position, reachedDistance = 0.35) {
    if (!Array.isArray(path) || !path.length) return [];
    const here = { column: Number(position?.column) || 0, row: Number(position?.row) || 0 };
    const distanceTo = (node) => Math.hypot(node.column - here.column, node.row - here.row);

    // Seek to the nearest waypoint rather than only consuming the one underfoot:
    // continuous movement can carry an actor past a node, and leaving it at the
    // head of the queue would send them walking back to it.
    let nearest = 0;
    for (let index = 1; index < path.length; index += 1) {
      if (distanceTo(path[index]) < distanceTo(path[nearest])) nearest = index;
    }
    const consumed = distanceTo(path[nearest]) <= reachedDistance && nearest < path.length - 1
      ? nearest + 1
      : nearest;
    return path.slice(consumed);
  }

  const api = Object.freeze({ findPath, isReachable, advancePath, heuristic });
  if (typeof window !== "undefined") window.PocketBuddyPathfinding = api;
  if (typeof globalThis !== "undefined") globalThis.PocketBuddyPathfinding = api;
})();
