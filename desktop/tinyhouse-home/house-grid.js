(() => {
  "use strict";

  const core = window.TinyHouseGridCore;
  const playable = window.TinyHousePlayable;
  if (!core || !playable) return;

  const context = {
    core,
    playable,
    state: playable.state,
    HOUSE_SAVE_KEY: "pocket-buddy-plus-tinyhouse-house-v1",
    STRUCTURE_KEY: "pocket-buddy-plus-tinyhouse-structure-v1",
    viewport: document.querySelector("#world-viewport"),
    stage: document.querySelector("#world-stage"),
    floorLayer: document.querySelector("#floor-layer"),
    wallLayer: document.querySelector("#wall-layer"),
    itemLayer: document.querySelector("#item-layer"),
    ghost: document.querySelector("#placement-ghost"),
    tools: document.querySelector("#selection-tools"),
    toast: document.querySelector("#toast"),
    assetGrid: document.querySelector("#asset-grid"),
    grid: null,
    mode: "furnish",
    plugins: [],
    initialized: false,
  };
  if (!context.viewport || !context.stage || !context.floorLayer || !context.wallLayer || !context.itemLayer) return;

  context.clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  context.findAsset = (id) => context.state.manifest.find((asset) => asset.id === id) || null;
  context.assetUrl = (asset, frameIndex = 0) => {
    if (!asset) return "";
    if (Array.isArray(asset.frameDataUrls) && asset.frameDataUrls.length) {
      return asset.frameDataUrls[context.clamp(frameIndex, 0, asset.frameDataUrls.length - 1)];
    }
    return asset.dataUrl || "";
  };
  context.showToast = (message) => {
    if (!context.toast) return;
    context.toast.textContent = message;
    context.toast.classList.add("show");
    clearTimeout(context.showToast.timer);
    context.showToast.timer = setTimeout(() => context.toast.classList.remove("show"), 1800);
  };
  context.screenToWorld = (clientX, clientY) => {
    const rect = context.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - context.state.panX) / context.state.scale,
      y: (clientY - rect.top - context.state.panY) / context.state.scale,
    };
  };
  context.defaultDoorAsset = () => context.state.manifest.find((asset) => asset.id === "ani-office-glass-door")
    || context.state.manifest.find((asset) => asset.category === "Structural" && /door/i.test(`${asset.name} ${asset.folder}`) && asset.width === 128)
    || context.state.manifest.find((asset) => asset.category === "Structural" && /door/i.test(`${asset.name} ${asset.folder}`))
    || null;
  context.defaultSnapshot = () => core.HouseGrid.createDefault({
    columns: 5,
    rows: 5,
    floorAssetId: context.state.floorAsset?.id,
    leftWallAssetId: context.state.leftWallAsset?.id,
    rightWallAssetId: context.state.rightWallAsset?.id,
    doorAssetId: context.defaultDoorAsset()?.id,
    room: playable.room,
  });
  context.persistStructure = () => {
    try {
      localStorage.setItem(context.STRUCTURE_KEY, JSON.stringify(context.grid.toJSON()));
    } catch (error) {
      console.warn("[tinyhouse/structure] Could not persist structure", error);
    }
  };
  context.restoreStructure = (snapshot) => {
    context.grid = snapshot
      ? new core.HouseGrid(snapshot, {
        room: playable.room,
        floorAssetId: context.state.floorAsset?.id,
        leftWallAssetId: context.state.leftWallAsset?.id,
        rightWallAssetId: context.state.rightWallAsset?.id,
        doorAssetId: context.defaultDoorAsset()?.id,
      })
      : context.defaultSnapshot();
    if (!context.grid.floors.size) context.grid = context.defaultSnapshot();
    context.persistStructure();
  };
  context.loadInitialStructure = () => {
    try {
      const raw = localStorage.getItem(context.STRUCTURE_KEY);
      context.restoreStructure(raw ? JSON.parse(raw) : null);
    } catch (error) {
      console.warn("[tinyhouse/structure] Could not load structure snapshot", error);
      context.restoreStructure(null);
    }
  };

  const runtime = {
    context,
    use(plugin) {
      context.plugins.push(plugin);
      if (context.initialized) {
        Promise.resolve(plugin.init?.(context))
          .then(() => context.renderStructure?.())
          .catch((error) => console.error(`[tinyhouse/structure] ${plugin.name || "late plugin"} failed`, error));
      }
    },
  };
  window.TinyHouseStructureRuntime = runtime;

  function exposeApi() {
    window.TinyHouseStructure = Object.freeze({
      get grid() { return context.grid; },
      get mode() { return context.mode; },
      hasFloor(column, row) { return context.grid.hasFloor(Math.round(column), Math.round(row)); },
      worldToNearestFloorCell(x, y) { return context.grid.nearestFloorCell(x, y); },
      nearestIntegerCell(x, y) { return context.grid.nearestIntegerCell(x, y); },
      canTraverse(a, b) { return context.grid.canTraverse(a, b); },
      rooms() { return context.grid.rooms(); },
      serialize() { return context.grid.toJSON(); },
      addConnectedRoom(direction) {
        const result = context.grid.addConnectedRoom(direction);
        context.persistStructure();
        context.renderStructure?.();
        return result;
      },
      render() { context.renderStructure?.(); },
      fit() { context.fitHouse?.(); },
      export() { return context.exportHouse?.(); },
    });
  }

  async function init() {
    if (window.TINYHOUSE_ASSETS_READY) await window.TINYHOUSE_ASSETS_READY;
    await new Promise((resolve) => setTimeout(resolve, 0));
    context.loadInitialStructure();
    for (const plugin of context.plugins) await plugin.init?.(context);
    context.initialized = true;
    exposeApi();
    context.renderStructure?.();
    console.info("[tinyhouse/structure] editable isometric house grid ready", {
      floors: context.grid.floors.size,
      edges: context.grid.edges.size,
      rooms: context.grid.rooms().length,
    });
  }

  init().catch((error) => {
    console.error("[tinyhouse/structure] initialization failed", error);
    context.showToast("House structure tools could not start");
  });
})();
