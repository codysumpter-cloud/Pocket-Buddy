(() => {
  "use strict";
  const runtime = window.TinyHouseStructureRuntime;
  if (!runtime) return;

  runtime.use({ name: "house-grid-editor", init(ctx) {
    let hitLayer;
    let panel;
    let status;

    function candidates() {
      const map = new Map();
      for (const floor of ctx.grid.floors.values()) {
        for (const cell of [floor,
          { column: floor.column - 1, row: floor.row }, { column: floor.column + 1, row: floor.row },
          { column: floor.column, row: floor.row - 1 }, { column: floor.column, row: floor.row + 1 }]) {
          map.set(ctx.core.cellKey(cell.column, cell.row), cell);
        }
      }
      return [...map.values()];
    }

    function floorHit(cell) {
      const button = document.createElement("button");
      const exists = ctx.grid.hasFloor(cell.column, cell.row);
      button.type = "button";
      button.className = `structure-floor-hit ${exists ? "existing" : "potential"}`;
      button.dataset.column = String(cell.column);
      button.dataset.row = String(cell.row);
      const point = ctx.core.floorTopLeft(cell.column, cell.row, ctx.playable.room);
      button.style.left = `${point.x}px`;
      button.style.top = `${point.y}px`;
      button.title = exists ? `Floor ${cell.column}, ${cell.row}` : `Add floor ${cell.column}, ${cell.row}`;
      return button;
    }

    function edgeHit(axis, column, row) {
      const button = document.createElement("button");
      const top = ctx.core.cellTopVertex(column, row, ctx.playable.room);
      const midpoint = axis === "left" ? { x: top.x - 32, y: top.y + 16 } : { x: top.x + 32, y: top.y + 16 };
      const edge = ctx.grid.edgeAt(axis, column, row);
      button.type = "button";
      button.className = `structure-edge-hit axis-${axis}${edge ? ` has-${edge.kind}` : ""}`;
      button.dataset.axis = axis;
      button.dataset.column = String(column);
      button.dataset.row = String(row);
      button.style.left = `${midpoint.x - 42}px`;
      button.style.top = `${midpoint.y - 12}px`;
      button.title = edge ? `${edge.kind} edge` : "Empty wall edge";
      return button;
    }

    ctx.renderHitTargets = () => {
      hitLayer.replaceChildren();
      hitLayer.dataset.mode = ctx.mode;
      if (ctx.mode === "furnish") return;
      for (const cell of candidates()) {
        if ((ctx.mode === "add-floor" && !ctx.grid.hasFloor(cell.column, cell.row))
          || (ctx.mode === "remove-floor" && ctx.grid.hasFloor(cell.column, cell.row))) hitLayer.append(floorHit(cell));
      }
      if (!["wall", "door", "erase-edge"].includes(ctx.mode)) return;
      const seen = new Set();
      for (const floor of ctx.grid.floors.values()) {
        for (const edge of [
          { axis: "left", column: floor.column, row: floor.row },
          { axis: "left", column: floor.column + 1, row: floor.row },
          { axis: "right", column: floor.column, row: floor.row },
          { axis: "right", column: floor.column, row: floor.row + 1 },
        ]) {
          const key = ctx.core.edgeKey(edge.axis, edge.column, edge.row);
          if (seen.has(key)) continue;
          seen.add(key);
          hitLayer.append(edgeHit(edge.axis, edge.column, edge.row));
        }
      }
    };

    const occupied = (column, row) => ctx.state.placements.some((placement) => !placement.wallSide
      && Math.round(placement.column) === column && Math.round(placement.row) === row);

    function editFloor(button) {
      const column = Number(button.dataset.column);
      const row = Number(button.dataset.row);
      if (ctx.mode === "add-floor") {
        if (!ctx.grid.addFloor(column, row, ctx.state.floorAsset?.id || ctx.grid.defaultFloorAssetId)) {
          ctx.showToast(`House limit is ${ctx.grid.room.maxSpan}×${ctx.grid.room.maxSpan} tiles`);
          return;
        }
        ctx.showToast(`Floor added at ${column}, ${row}`);
      } else {
        if (ctx.grid.floors.size <= 1) return ctx.showToast("A house needs at least one floor tile");
        if (occupied(column, row)) return ctx.showToast("Move the furniture off this tile first");
        ctx.grid.removeFloor(column, row);
        ctx.showToast(`Floor removed at ${column}, ${row}`);
      }
      ctx.persistStructure();
      ctx.renderStructure();
    }

    function editEdge(button) {
      const axis = button.dataset.axis;
      const column = Number(button.dataset.column);
      const row = Number(button.dataset.row);
      const adjacent = ctx.core.adjacentCellsForEdge(axis, column, row);
      if (!adjacent.some((cell) => ctx.grid.hasFloor(cell.column, cell.row))) return;
      if (ctx.mode === "wall") {
        ctx.grid.setWall(axis, column, row, axis === "left" ? ctx.state.leftWallAsset?.id : ctx.state.rightWallAsset?.id);
        ctx.showToast("Wall edge added");
      } else if (ctx.mode === "door") {
        ctx.grid.setDoor(axis, column, row, ctx.defaultDoorAsset()?.id, false);
        ctx.showToast(adjacent.every((cell) => ctx.grid.hasFloor(cell.column, cell.row)) ? "Connected-room door added" : "Exterior door added");
      } else {
        ctx.grid.removeEdge(axis, column, row);
        ctx.showToast("Wall edge removed");
      }
      ctx.persistStructure();
      ctx.renderStructure();
    }

    function setMode(mode) {
      ctx.mode = mode;
      panel.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
      ctx.viewport.dataset.structureMode = mode;
      if (mode !== "furnish") {
        ctx.state.selectedAsset = null;
        ctx.ghost.hidden = true;
      }
      ctx.renderHitTargets();
    }

    function buildPanel() {
      panel = document.createElement("section");
      panel.id = "structure-tools";
      panel.className = "pixel-frame";
      panel.setAttribute("aria-label", "House structure tools");
      panel.innerHTML = `<div class="structure-heading"><div><span class="panel-kicker">HOUSE GRID</span><h2>Structure</h2></div><button type="button" class="structure-collapse" title="Collapse structure tools">⌂</button></div>
        <div class="structure-modes" role="toolbar" aria-label="Structure edit modes">
          <button type="button" data-mode="furnish" class="active">FURNISH</button><button type="button" data-mode="add-floor">+ FLOOR</button>
          <button type="button" data-mode="remove-floor">− FLOOR</button><button type="button" data-mode="wall">+ WALL</button>
          <button type="button" data-mode="door">+ DOOR</button><button type="button" data-mode="erase-edge">− EDGE</button>
        </div><div class="structure-room-actions"><button type="button" data-house-action="east-room">ADD EAST ROOM</button>
          <button type="button" data-house-action="south-room">ADD SOUTH ROOM</button><button type="button" data-house-action="fit">FIT HOUSE</button></div>
        <p class="structure-help">Floors are cells. Walls and doors are edges. Click a door in Furnish mode to open or close its passage.</p><div class="structure-status" aria-live="polite"></div>`;
      ctx.viewport.append(panel);
      status = panel.querySelector(".structure-status");
      panel.addEventListener("click", (event) => {
        const modeButton = event.target.closest("[data-mode]");
        if (modeButton) return setMode(modeButton.dataset.mode);
        const action = event.target.closest("[data-house-action]")?.dataset.houseAction;
        if (["east-room", "south-room"].includes(action)) {
          ctx.grid.addConnectedRoom(action === "east-room" ? "east" : "south", 3, 3);
          ctx.persistStructure();
          ctx.renderStructure();
          ctx.fitHouse();
          ctx.showToast("Connected 3×3 room added with a working door");
        } else if (action === "fit") ctx.fitHouse();
        else if (event.target.closest(".structure-collapse")) panel.classList.toggle("collapsed");
      });
    }

    ctx.updateStatus = () => {
      const doors = [...ctx.grid.edges.values()].filter((edge) => edge.kind === "door");
      const open = doors.filter((edge) => edge.open).length;
      const zones = ctx.grid.rooms().length;
      status.textContent = `${ctx.grid.floors.size} tiles · ${zones} connected zone${zones === 1 ? "" : "s"} · ${open}/${doors.length} doors open`;
    };

    function createPlacement(asset, cell) {
      return { id: `item-${ctx.state.idCounter++}`, assetId: asset.id, column: cell.column, row: cell.row, x: cell.x, y: cell.y,
        scale: asset.defaultScale || 1, flip: false, layer: ctx.state.layerCounter++, supportId: null, supportOffsetX: 0,
        frameIndex: 0, playing: asset.animationMode === "loop", animationDirection: 1, lastFrameAt: performance.now() };
    }
    function forceItemRender(id = null) {
      const selectedAsset = ctx.state.selectedAsset;
      ctx.state.selectedAsset = null;
      const existing = ctx.itemLayer.querySelector(".placed-item");
      if (existing) existing.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      else if (id) {
        ctx.state.selectedItemId = id;
        const flip = ctx.tools?.querySelector('[data-action="flip"]');
        if (flip) { flip.click(); flip.click(); }
      }
      const preferred = id && ctx.itemLayer.querySelector(`[data-id="${CSS.escape(id)}"]`);
      preferred?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ctx.state.selectedAsset = selectedAsset;
    }
    const wallRuntimeWillHandle = (asset, world) => Boolean(window.TinyHouseWallCore?.isWallMountable(asset)
      && window.TinyHouseWallCore.nearestWallTarget?.(world, asset, ctx.playable.room, world));

    function saveHouse() {
      localStorage.setItem(ctx.HOUSE_SAVE_KEY, JSON.stringify({
        version: 4,
        floorAssetId: ctx.state.floorAsset?.id,
        leftWallAssetId: ctx.state.leftWallAsset?.id,
        rightWallAssetId: ctx.state.rightWallAsset?.id,
        placements: ctx.state.placements.map(({ lastFrameAt, ...placement }) => placement),
        structure: ctx.grid.toJSON(),
      }));
      ctx.persistStructure();
      ctx.showToast("House structure and furniture saved");
    }
    function loadHouse() {
      const raw = localStorage.getItem(ctx.HOUSE_SAVE_KEY);
      if (!raw) return false;
      const payload = JSON.parse(raw);
      ctx.state.floorAsset = ctx.findAsset(payload.floorAssetId) || ctx.state.floorAsset;
      ctx.state.leftWallAsset = ctx.findAsset(payload.leftWallAssetId) || ctx.state.leftWallAsset;
      ctx.state.rightWallAsset = ctx.findAsset(payload.rightWallAssetId) || ctx.state.rightWallAsset;
      ctx.state.placements = Array.isArray(payload.placements) ? payload.placements.map((placement) => ({ ...placement, lastFrameAt: performance.now() })) : [];
      ctx.state.idCounter = Math.max(0, ...ctx.state.placements.map((placement) => Number(String(placement.id || "").match(/(\d+)$/)?.[1]) || 0)) + 1;
      ctx.state.layerCounter = Math.max(0, ...ctx.state.placements.map((placement) => Number(placement.layer) || 0)) + 1;
      ctx.restoreStructure(payload.structure || null);
      ctx.renderStructure();
      forceItemRender(ctx.state.placements[0]?.id || null);
      ctx.state.selectedItemId = null;
      ctx.fitHouse();
      ctx.showToast("House structure and furniture loaded");
      return true;
    }

    function bind() {
      hitLayer.addEventListener("click", (event) => {
        const floor = event.target.closest(".structure-floor-hit");
        if (floor) return editFloor(floor);
        const edge = event.target.closest(".structure-edge-hit");
        if (edge) editEdge(edge);
      });
      ctx.viewport.addEventListener("pointermove", (event) => {
        if (ctx.mode !== "furnish" || !ctx.state.selectedAsset || ctx.ghost.hidden) return;
        if (event.target.closest("#catalog, #camera-tools, #selection-tools, #window-buttons, #structure-tools")) return;
        const asset = ctx.state.selectedAsset;
        if (["Floors", "Walls"].includes(asset.category)) return;
        const world = ctx.screenToWorld(event.clientX, event.clientY);
        if (wallRuntimeWillHandle(asset, world)) return;
        const cell = ctx.grid.nearestFloorCell(world.x, world.y);
        if (!cell) { ctx.ghost.style.opacity = "0.2"; event.stopImmediatePropagation(); return; }
        const scale = asset.defaultScale || 1;
        ctx.ghost.style.left = `${cell.x - asset.width * scale / 2}px`;
        ctx.ghost.style.top = `${cell.y - asset.height * scale}px`;
        ctx.ghost.style.opacity = "0.72";
        event.stopImmediatePropagation();
      }, true);
      ctx.viewport.addEventListener("pointerdown", (event) => {
        if (ctx.mode !== "furnish" || event.button !== 0 || ctx.state.spaceDown) return;
        if (event.target.closest("#catalog, #camera-tools, #selection-tools, #window-buttons, #structure-tools, .placed-item, .structure-door")) return;
        const asset = ctx.state.selectedAsset;
        if (!asset || ["Floors", "Walls"].includes(asset.category)) return;
        const world = ctx.screenToWorld(event.clientX, event.clientY);
        if (wallRuntimeWillHandle(asset, world)) return;
        const cell = ctx.grid.nearestFloorCell(world.x, world.y);
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!cell) return ctx.showToast("Add a floor tile here before placing furniture");
        const placement = createPlacement(asset, cell);
        ctx.state.placements.push(placement);
        ctx.state.selectedItemId = placement.id;
        forceItemRender(placement.id);
        ctx.showToast(`${asset.name} placed on house grid`);
      }, true);
      const capture = (selector, action) => document.querySelector(selector)?.addEventListener("click", (event) => {
        event.preventDefault(); event.stopImmediatePropagation(); action();
      }, true);
      capture("#save-room", () => { try { saveHouse(); } catch (error) { console.error(error); ctx.showToast("House could not be saved"); } });
      document.querySelector("#load-room")?.addEventListener("click", (event) => {
        if (!localStorage.getItem(ctx.HOUSE_SAVE_KEY)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        try { loadHouse(); } catch (error) { console.error(error); ctx.showToast("House could not be loaded"); }
      }, true);
      capture("#export-room", () => {
        ctx.showToast("Rendering the full house structure…");
        ctx.exportHouse().catch((error) => { console.error(error); ctx.showToast("House image could not be exported"); });
      });
      document.querySelector("#reset-room")?.addEventListener("click", () => setTimeout(() => { ctx.restoreStructure(null); ctx.renderStructure(); }, 0));
      ctx.assetGrid?.addEventListener("click", () => setTimeout(() => {
        const asset = ctx.state.selectedAsset;
        if (asset?.category === "Floors") {
          ctx.grid.defaultFloorAssetId = asset.id;
          for (const floor of ctx.grid.floors.values()) floor.assetId = asset.id;
        } else if (asset?.category === "Walls") {
          if (asset.orientation === "left") ctx.grid.defaultLeftWallAssetId = asset.id;
          if (asset.orientation === "right") ctx.grid.defaultRightWallAssetId = asset.id;
          for (const edge of ctx.grid.edges.values()) if (edge.kind === "wall" && edge.axis === asset.orientation) edge.assetId = asset.id;
        } else return;
        ctx.persistStructure(); ctx.renderStructure();
      }, 0));
      window.addEventListener("keydown", (event) => {
        const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
        const command = event.ctrlKey || event.metaKey;
        if (!typing && command && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopImmediatePropagation(); saveHouse(); }
        else if (!typing && command && event.key.toLowerCase() === "l" && localStorage.getItem(ctx.HOUSE_SAVE_KEY)) { event.preventDefault(); event.stopImmediatePropagation(); loadHouse(); }
        else if (!typing && event.key.toLowerCase() === "b") panel.classList.toggle("collapsed");
      }, true);
    }

    hitLayer = document.createElement("div");
    hitLayer.id = "structure-hit-layer";
    hitLayer.className = "world-layer";
    ctx.stage.insertBefore(hitLayer, ctx.itemLayer);
    buildPanel();
    bind();
  }});
})();
