(() => {
  "use strict";

  const runtime = window.TinyHouseStructureRuntime;
  const blueprintCore = window.TinyHouseBlueprintCore;
  if (!runtime || !blueprintCore) return;

  runtime.use({ name: "house-grid-blueprint", init(ctx) {
    const panel = document.querySelector("#structure-tools");
    const hitLayer = document.querySelector("#structure-hit-layer");
    const roomActions = panel?.querySelector(".structure-room-actions");
    if (!panel || !hitLayer || !roomActions) return;

    const HISTORY_LIMIT = 64;
    const undoStack = [];
    const redoStack = [];
    let undoButton;
    let redoButton;
    let plannerStatus;

    const snapshot = () => JSON.stringify(ctx.grid.toJSON());
    const restore = (serialized) => {
      ctx.restoreStructure(JSON.parse(serialized));
      ctx.renderStructure();
    };
    const updateHistoryButtons = () => {
      if (undoButton) undoButton.disabled = undoStack.length === 0;
      if (redoButton) redoButton.disabled = redoStack.length === 0;
    };
    const begin = (label) => ({ label, before: snapshot() });
    const commit = (transaction) => {
      if (!transaction) return false;
      const after = snapshot();
      if (after === transaction.before) return false;
      undoStack.push({ label: transaction.label, state: transaction.before });
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack.length = 0;
      updateHistoryButtons();
      return true;
    };
    const transact = (label, action) => {
      const transaction = begin(label);
      const result = action();
      commit(transaction);
      return result;
    };
    const undo = () => {
      const target = undoStack.pop();
      if (!target) return false;
      redoStack.push({ label: target.label, state: snapshot() });
      restore(target.state);
      updateHistoryButtons();
      ctx.showToast(`Undo: ${target.label}`);
      return true;
    };
    const redo = () => {
      const target = redoStack.pop();
      if (!target) return false;
      undoStack.push({ label: target.label, state: snapshot() });
      restore(target.state);
      updateHistoryButtons();
      ctx.showToast(`Redo: ${target.label}`);
      return true;
    };

    function buildPlanner() {
      const sizes = Array.from({ length: 7 }, (_, index) => index + 2)
        .map((size) => `<option value="${size}"${size === 3 ? " selected" : ""}>${size}</option>`)
        .join("");
      roomActions.innerHTML = `
        <div class="blueprint-heading"><span>ROOM PLANNER</span><small>Blueprint-style connected additions</small></div>
        <label class="blueprint-field"><span>DIRECTION</span><select data-blueprint-field="direction"><option value="east">EAST</option><option value="south">SOUTH</option></select></label>
        <label class="blueprint-field"><span>WIDTH</span><select data-blueprint-field="width">${sizes}</select></label>
        <label class="blueprint-field"><span>DEPTH</span><select data-blueprint-field="depth">${sizes}</select></label>
        <button type="button" data-blueprint-action="add-room">ADD CONNECTED ROOM</button>
        <button type="button" data-blueprint-action="fit">FIT HOUSE</button>
        <div class="blueprint-history" role="toolbar" aria-label="Structure history">
          <button type="button" data-blueprint-action="undo" title="Undo structure edit (Ctrl/Cmd+Z)">UNDO</button>
          <button type="button" data-blueprint-action="redo" title="Redo structure edit (Ctrl/Cmd+Shift+Z)">REDO</button>
        </div>
        <p class="blueprint-status" aria-live="polite"></p>`;
      undoButton = roomActions.querySelector('[data-blueprint-action="undo"]');
      redoButton = roomActions.querySelector('[data-blueprint-action="redo"]');
      plannerStatus = roomActions.querySelector(".blueprint-status");
      updateHistoryButtons();
      updatePlanStatus();
    }

    function readPlan() {
      return blueprintCore.connectedRoomPlan(
        ctx.grid,
        roomActions.querySelector('[data-blueprint-field="direction"]')?.value,
        roomActions.querySelector('[data-blueprint-field="width"]')?.value,
        roomActions.querySelector('[data-blueprint-field="depth"]')?.value,
      );
    }

    function updatePlanStatus() {
      const plan = readPlan();
      if (!plannerStatus) return;
      plannerStatus.textContent = plan.valid
        ? `${plan.width}×${plan.depth} room · ${plan.floors.length} floor tiles · working door`
        : plan.reason;
      plannerStatus.classList.toggle("invalid", !plan.valid);
    }

    function addPlannedRoom() {
      const plan = readPlan();
      if (!plan.valid) return ctx.showToast(plan.reason);
      transact(`Add ${plan.width}×${plan.depth} ${plan.direction} room`, () => {
        ctx.grid.addConnectedRoom(plan.direction, plan.width, plan.depth);
        ctx.persistStructure();
        ctx.renderStructure();
        ctx.fitHouse();
      });
      updatePlanStatus();
      ctx.showToast(`Connected ${plan.width}×${plan.depth} room added with a working door`);
    }

    roomActions.addEventListener("change", updatePlanStatus);
    roomActions.addEventListener("click", (event) => {
      const action = event.target.closest("[data-blueprint-action]")?.dataset.blueprintAction;
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "add-room") addPlannedRoom();
      else if (action === "fit") ctx.fitHouse();
      else if (action === "undo") undo();
      else if (action === "redo") redo();
    }, true);

    hitLayer.addEventListener("click", (event) => {
      const floor = event.target.closest(".structure-floor-hit");
      if (floor && ctx.mode === "remove-floor") {
        const column = Number(floor.dataset.column);
        const row = Number(floor.dataset.row);
        if (!event.altKey && blueprintCore.wouldSplitFootprint(ctx.grid, column, row)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          ctx.showToast("That removal would split the house footprint. Hold Alt to force it.");
          return;
        }
      }
      const mutation = floor || event.target.closest(".structure-edge-hit");
      if (!mutation) return;
      const transaction = begin(floor ? "Edit floor" : "Edit wall or door");
      setTimeout(() => {
        if (commit(transaction)) updatePlanStatus();
      }, 0);
    }, true);

    document.querySelector("#reset-room")?.addEventListener("click", () => {
      const transaction = begin("Reset house structure");
      setTimeout(() => {
        if (commit(transaction)) updatePlanStatus();
      }, 30);
    }, true);

    ctx.assetGrid?.addEventListener("click", () => {
      const asset = ctx.state.selectedAsset;
      if (!["Floors", "Walls"].includes(asset?.category)) return;
      const transaction = begin(`Apply ${asset.category.toLowerCase()} style`);
      setTimeout(() => commit(transaction), 30);
    }, true);

    window.addEventListener("keydown", (event) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
      if (typing || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        event.stopImmediatePropagation();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        event.stopImmediatePropagation();
        redo();
      }
    }, true);

    buildPlanner();
    const help = panel.querySelector(".structure-help");
    if (help) help.textContent = "Floors are cells. Walls and doors are edges. Undo structure edits here. Hold Alt only when intentionally splitting the floor footprint.";

    window.TinyHouseBlueprint = Object.freeze({
      begin,
      commit,
      transact,
      undo,
      redo,
      readPlan,
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
    });
  }});
})();
