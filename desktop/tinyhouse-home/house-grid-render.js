(() => {
  "use strict";
  const runtime = window.TinyHouseStructureRuntime;
  if (!runtime) return;

  runtime.use({ name: "house-grid-render", init(ctx) {
    let doorAnimation = new WeakMap();

    const tileImage = (asset, x, y, zIndex, className) => {
      const image = document.createElement("img");
      image.className = `tile ${className}`;
      image.src = ctx.assetUrl(asset);
      image.alt = "";
      image.style.left = `${x}px`;
      image.style.top = `${y}px`;
      image.style.zIndex = String(zIndex);
      return image;
    };
    const wallAsset = (edge) => ctx.findAsset(edge.assetId)
      || (edge.axis === "left" ? ctx.state.leftWallAsset : ctx.state.rightWallAsset);
    const doorFrameIndex = (edge, asset) => {
      const count = Array.isArray(asset?.frameDataUrls) ? asset.frameDataUrls.length : 0;
      return count && edge.open ? count - 1 : 0;
    };

    function animateDoor(button, edge, asset, opening) {
      const frames = asset?.frameDataUrls || [];
      if (frames.length < 2) return;
      const previous = doorAnimation.get(button);
      if (previous) clearInterval(previous);
      const sequence = opening ? [...frames.keys()] : [...frames.keys()].reverse();
      let index = 0;
      const image = button.querySelector("img");
      image.src = frames[sequence[index]];
      const timer = setInterval(() => {
        index += 1;
        if (index >= sequence.length) {
          clearInterval(timer);
          doorAnimation.delete(button);
          return;
        }
        image.src = frames[sequence[index]];
      }, Math.max(45, 1000 / ctx.clamp(Number(asset.fps) || 10, 4, 20)));
      doorAnimation.set(button, timer);
    }

    function renderDoor(edge, point, zIndex) {
      const asset = ctx.findAsset(edge.doorAssetId) || ctx.defaultDoorAsset();
      if (!asset) return null;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `structure-door ${edge.open ? "open" : "closed"} axis-${edge.axis}`;
      button.dataset.edge = ctx.core.edgeKey(edge.axis, edge.column, edge.row);
      button.title = edge.open ? "Close door" : "Open door";
      Object.assign(button.style, {
        left: `${point.x}px`, top: `${point.y}px`,
        width: `${Math.min(128, asset.width)}px`, height: `${Math.min(128, asset.height)}px`,
        zIndex: String(zIndex + 2),
      });
      const image = document.createElement("img");
      image.alt = edge.open ? "Open door" : "Closed door";
      image.src = ctx.assetUrl(asset, doorFrameIndex(edge, asset));
      button.append(image);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (ctx.mode !== "furnish") return;
        const opening = !edge.open;
        ctx.grid.toggleDoor(edge.axis, edge.column, edge.row);
        button.classList.toggle("open", opening);
        button.classList.toggle("closed", !opening);
        button.title = opening ? "Close door" : "Open door";
        animateDoor(button, edge, asset, opening);
        ctx.persistStructure();
        ctx.updateStatus?.();
        ctx.showToast(opening ? "Door opened · passage connected" : "Door closed · passage blocked");
      });
      return button;
    }

    function renderFloors() {
      ctx.floorLayer.replaceChildren();
      const floors = [...ctx.grid.floors.values()].sort((a, b) => (a.column + a.row) - (b.column + b.row));
      for (const floor of floors) {
        const asset = ctx.findAsset(floor.assetId) || ctx.state.floorAsset;
        if (!asset) continue;
        const point = ctx.core.floorTopLeft(floor.column, floor.row, ctx.playable.room);
        const node = tileImage(asset, point.x, point.y, 100 + Math.round((floor.column + floor.row) * 4), "floor-tile structure-floor");
        node.dataset.cell = ctx.core.cellKey(floor.column, floor.row);
        ctx.floorLayer.append(node);
      }
    }

    function renderWalls() {
      ctx.wallLayer.replaceChildren();
      const edges = [...ctx.grid.edges.values()].sort((a, b) => (a.column + a.row) - (b.column + b.row));
      for (const edge of edges) {
        const point = ctx.core.wallTopLeft(edge.axis, edge.column, edge.row, ctx.playable.room);
        const zIndex = 260 + Math.round((edge.column + edge.row) * 8) + (edge.axis === "right" ? 2 : 0);
        if (edge.kind === "door") {
          const door = renderDoor(edge, point, zIndex);
          if (door) ctx.wallLayer.append(door);
          continue;
        }
        const asset = wallAsset(edge);
        if (!asset) continue;
        const node = tileImage(asset, point.x, point.y, zIndex, `${edge.axis}-wall-tile structure-wall axis-${edge.axis}`);
        node.dataset.edge = ctx.core.edgeKey(edge.axis, edge.column, edge.row);
        ctx.wallLayer.append(node);
      }
    }

    ctx.renderStructure = () => {
      renderFloors();
      renderWalls();
      ctx.renderHitTargets?.();
      ctx.updateStatus?.();
    };

    ctx.fitHouse = () => {
      const bounds = ctx.grid.bounds();
      if (!bounds) return;
      const corners = [
        ctx.core.floorTopLeft(bounds.minColumn, bounds.minRow, ctx.playable.room),
        ctx.core.floorTopLeft(bounds.maxColumn, bounds.minRow, ctx.playable.room),
        ctx.core.floorTopLeft(bounds.minColumn, bounds.maxRow, ctx.playable.room),
        ctx.core.floorTopLeft(bounds.maxColumn, bounds.maxRow, ctx.playable.room),
      ];
      const minX = Math.min(...corners.map((point) => point.x)) - 100;
      const maxX = Math.max(...corners.map((point) => point.x)) + 228;
      const minY = Math.min(...corners.map((point) => point.y)) - 140;
      const maxY = Math.max(...corners.map((point) => point.y)) + 160;
      const rect = ctx.viewport.getBoundingClientRect();
      const scale = ctx.clamp(Math.min((rect.width - 360) / (maxX - minX), (rect.height - 120) / (maxY - minY)), 0.38, 1.25);
      ctx.state.scale = scale;
      ctx.state.panX = (rect.width + 300) / 2 - ((minX + maxX) / 2) * scale;
      ctx.state.panY = rect.height / 2 - ((minY + maxY) / 2) * scale;
      ctx.stage.style.transform = `translate(${ctx.state.panX}px, ${ctx.state.panY}px) scale(${ctx.state.scale})`;
    };

    const resolvedAnchor = (placement) => {
      if (!placement.supportId) return { x: Number(placement.x) || 0, y: Number(placement.y) || 0 };
      const support = ctx.state.placements.find((candidate) => candidate.id === placement.supportId);
      const geometry = support && ctx.playable.supportGeometry(support);
      return geometry ? {
        x: geometry.centerX + ctx.clamp(Number(placement.supportOffsetX) || 0, -geometry.halfWidth, geometry.halfWidth),
        y: geometry.centerY + geometry.halfHeight * 0.28,
      } : { x: Number(placement.x) || 0, y: Number(placement.y) || 0 };
    };
    const placementZ = (placement, anchor) => {
      if (placement.supportId) {
        const support = ctx.state.placements.find((candidate) => candidate.id === placement.supportId);
        if (support) return 1000 + Math.round((Number(support.y) || 0) * 10 + 600 + (Number(placement.layer) || 0));
      }
      if (placement.wallSide && window.TinyHouseWallCore) return window.TinyHouseWallCore.wallZIndex(placement);
      return 1000 + Math.round(anchor.y * 10 + (Number(placement.layer) || 0));
    };
    const loadImage = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not decode house asset: ${src}`));
      image.src = src;
    });

    ctx.exportHouse = async () => {
      const drawables = [];
      for (const floor of ctx.grid.floors.values()) {
        const asset = ctx.findAsset(floor.assetId) || ctx.state.floorAsset;
        const src = ctx.assetUrl(asset);
        if (!asset || !src) continue;
        const point = ctx.core.floorTopLeft(floor.column, floor.row, ctx.playable.room);
        drawables.push({ src, x: point.x, y: point.y, width: asset.width, height: asset.height, z: 100 + (floor.column + floor.row) * 4 });
      }
      for (const edge of ctx.grid.edges.values()) {
        const point = ctx.core.wallTopLeft(edge.axis, edge.column, edge.row, ctx.playable.room);
        const asset = edge.kind === "door" ? (ctx.findAsset(edge.doorAssetId) || ctx.defaultDoorAsset()) : wallAsset(edge);
        const src = asset && ctx.assetUrl(asset, edge.kind === "door" ? doorFrameIndex(edge, asset) : 0);
        if (!asset || !src) continue;
        drawables.push({ src, x: point.x, y: point.y, width: Math.min(128, asset.width), height: Math.min(128, asset.height), flip: edge.kind === "door" && edge.axis === "right", z: 260 + (edge.column + edge.row) * 8 });
      }
      for (const placement of ctx.state.placements) {
        const asset = ctx.findAsset(placement.assetId);
        if (!asset) continue;
        const anchor = resolvedAnchor(placement);
        const width = asset.width * placement.scale;
        const height = asset.height * placement.scale;
        const src = ctx.assetUrl(asset, placement.frameIndex || 0);
        if (src) drawables.push({ src, x: anchor.x - width / 2, y: anchor.y - height, width, height, flip: Boolean(placement.flip), z: placementZ(placement, anchor) });
      }
      if (!drawables.length) throw new Error("Nothing to export");
      drawables.sort((a, b) => a.z - b.z);
      const margin = 48;
      const minX = Math.floor(Math.min(...drawables.map((entry) => entry.x)) - margin);
      const minY = Math.floor(Math.min(...drawables.map((entry) => entry.y)) - margin);
      const maxX = Math.ceil(Math.max(...drawables.map((entry) => entry.x + entry.width)) + margin);
      const maxY = Math.ceil(Math.max(...drawables.map((entry) => entry.y + entry.height)) + margin);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.min(8192, maxX - minX));
      canvas.height = Math.max(1, Math.min(8192, maxY - minY));
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#49464b";
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const drawable of drawables) {
        const image = await loadImage(drawable.src);
        const x = drawable.x - minX;
        const y = drawable.y - minY;
        context.save();
        if (drawable.flip) {
          context.translate(x + drawable.width, y);
          context.scale(-1, 1);
          context.drawImage(image, 0, 0, drawable.width, drawable.height);
        } else context.drawImage(image, x, y, drawable.width, drawable.height);
        context.restore();
      }
      const link = document.createElement("a");
      link.download = "tinyhouse-structure.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      ctx.showToast(`House exported · ${ctx.grid.floors.size} floor tiles`);
    };
  }});
})();
