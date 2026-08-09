(() => {
  "use strict";

  const runtime = window.TinyHouseStructureRuntime;
  const core = window.TinyHouseRotationCore;
  if (!runtime || !core) return;

  runtime.use({ name: "four-way-furniture-rotation", async init(ctx) {
    const rotationIndex = core.buildRotationIndex(ctx.state.manifest);
    const sheetFrames = new Map();
    const itemLayer = ctx.itemLayer;
    const catalog = ctx.assetGrid;
    let scheduled = false;

    const findPlacement = (id) => ctx.state.placements.find((placement) => placement.id === id) || null;
    const rotationFor = (asset) => rotationIndex.get(asset?.id) || null;

    async function sliceSheet(asset, rotation) {
      if (!asset?.dataUrl || !rotation?.sheet || sheetFrames.has(asset.id)) return;
      const image = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error(`Could not decode rotation sheet: ${asset.name}`));
        candidate.src = asset.dataUrl;
      });
      const frames = [];
      for (let column = 0; column < rotation.sheet.columns; column += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = rotation.sheet.cellWidth;
        canvas.height = rotation.sheet.cellHeight;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        context.drawImage(
          image,
          column * rotation.sheet.cellWidth,
          rotation.sheet.row * rotation.sheet.cellHeight,
          rotation.sheet.cellWidth,
          rotation.sheet.cellHeight,
          0,
          0,
          rotation.sheet.cellWidth,
          rotation.sheet.cellHeight,
        );
        frames.push(canvas.toDataURL("image/png"));
      }
      sheetFrames.set(asset.id, frames);
    }

    await Promise.all(ctx.state.manifest
      .filter((asset) => rotationFor(asset)?.mode === "sheet")
      .map((asset) => sliceSheet(asset, rotationFor(asset))));

    function placementRotationIndex(placement, rotation) {
      if (Number.isFinite(Number(placement.rotationIndex))) {
        return core.normalizeIndex(placement.rotationIndex, rotation.count);
      }
      return placement.flip ? Math.max(0, rotation.count - 1) : 0;
    }

    function visualFor(placement) {
      const baseAsset = placement && ctx.findAsset(placement.assetId);
      if (!baseAsset) return null;
      const rotation = rotationFor(baseAsset);
      if (!rotation) {
        return {
          asset: baseAsset,
          src: ctx.assetUrl(baseAsset, placement.frameIndex || 0),
          width: baseAsset.width,
          height: baseAsset.height,
          flip: Boolean(placement.flip),
          count: 2,
          index: placement.flip ? 1 : 0,
          label: placement.flip ? "RIGHT" : "LEFT",
          mode: "mirror",
        };
      }
      const index = placementRotationIndex(placement, rotation);
      const state = core.stateFor(rotation, index);
      const asset = ctx.findAsset(state?.assetId) || baseAsset;
      const frames = rotation.mode === "sheet" ? sheetFrames.get(baseAsset.id) : null;
      const src = frames?.[state.sheetFrame] || ctx.assetUrl(asset, placement.frameIndex || 0);
      return {
        asset,
        src,
        width: rotation.mode === "sheet" ? rotation.sheet.cellWidth : asset.width,
        height: rotation.mode === "sheet" ? rotation.sheet.cellHeight : asset.height,
        flip: Boolean(state?.flip),
        count: rotation.count,
        index,
        label: rotation.labels[index] || `${index + 1}/${rotation.count}`,
        mode: rotation.mode,
      };
    }

    function supportGeometry(placement) {
      const visual = visualFor(placement);
      if (!visual) return null;
      const width = visual.width * placement.scale;
      const height = visual.height * placement.scale;
      return {
        centerX: Number(placement.x) || 0,
        centerY: (Number(placement.y) || 0) - height * 0.49,
        halfWidth: Math.max(20, width * 0.34),
        halfHeight: Math.max(11, height * 0.13),
      };
    }

    function resolvedAnchor(placement) {
      if (!placement.supportId) {
        return { x: Number(placement.x) || 0, y: Number(placement.y) || 0, support: null };
      }
      const support = findPlacement(placement.supportId);
      const geometry = support && supportGeometry(support);
      if (!support || !geometry) {
        return { x: Number(placement.x) || 0, y: Number(placement.y) || 0, support: null };
      }
      return {
        x: geometry.centerX + ctx.clamp(Number(placement.supportOffsetX) || 0, -geometry.halfWidth, geometry.halfWidth),
        y: geometry.centerY + geometry.halfHeight * 0.28,
        support,
      };
    }

    function setStyle(node, property, value) {
      if (node.style[property] !== value) node.style[property] = value;
    }

    function applyPlacementNode(node) {
      const placement = findPlacement(node.dataset.id);
      const visual = visualFor(placement);
      if (!placement || !visual) return;
      const anchor = resolvedAnchor(placement);
      const width = visual.width * placement.scale;
      const height = visual.height * placement.scale;
      if (node.src !== visual.src) node.src = visual.src;
      if (node.alt !== visual.asset.name) node.alt = visual.asset.name;
      setStyle(node, "width", `${width}px`);
      setStyle(node, "height", `${height}px`);
      setStyle(node, "left", `${anchor.x - width / 2}px`);
      setStyle(node, "top", `${anchor.y - height}px`);
      setStyle(node, "transform", `scaleX(${visual.flip ? -1 : 1})`);
      node.dataset.rotationIndex = String(visual.index);
      node.dataset.rotationCount = String(visual.count);
    }

    function applyCatalogPreviews() {
      const assetsByName = new Map();
      for (const asset of ctx.state.manifest) {
        if (!assetsByName.has(asset.name)) assetsByName.set(asset.name, asset);
      }
      catalog?.querySelectorAll(".asset-card img").forEach((image) => {
        const asset = assetsByName.get(image.alt);
        const rotation = rotationFor(asset);
        if (!asset || rotation?.mode !== "sheet") return;
        const src = sheetFrames.get(asset.id)?.[0];
        if (src && image.src !== src) image.src = src;
      });
    }

    function updateInspector() {
      const placement = findPlacement(ctx.state.selectedItemId);
      const visual = visualFor(placement);
      const button = ctx.tools?.querySelector('[data-action="flip"], [data-action="rotate"]');
      if (button) {
        button.dataset.action = "rotate";
        button.dataset.label = "ROTATE";
        button.textContent = "⟳";
        button.title = visual?.count === 4
          ? "Rotate 90° through four authored isometric directions (R)"
          : "Mirror between the available authored directions (R)";
      }
      const meta = document.querySelector("#selection-meta");
      if (meta && visual && !meta.textContent.includes("Facing")) {
        meta.textContent += ` · Facing ${visual.label} · ${visual.count}-way`;
      }
    }

    function applyAll() {
      scheduled = false;
      itemLayer.querySelectorAll(".placed-item").forEach(applyPlacementNode);
      applyCatalogPreviews();
      updateInspector();
    }

    function scheduleApply() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(applyAll);
    }

    const observer = new MutationObserver(scheduleApply);
    observer.observe(itemLayer, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style"] });
    if (catalog) observer.observe(catalog, { childList: true, subtree: true });
    scheduleApply();

    function rotatePlacement(placement, delta = 1) {
      if (!placement || placement.wallSide) {
        if (placement?.wallSide) ctx.showToast("Drag wall decor to another wall orientation");
        return false;
      }
      const asset = ctx.findAsset(placement.assetId);
      const rotation = rotationFor(asset);
      if (!rotation) return false;
      const current = placementRotationIndex(placement, rotation);
      placement.rotationIndex = core.normalizeIndex(current + delta, rotation.count);
      placement.flip = false;
      const next = visualFor(placement);
      scheduleApply();
      ctx.showToast(next.count === 4
        ? `${asset.name} rotated · ${next.label}`
        : `${asset.name} mirrored · ${next.label}`);
      window.dispatchEvent(new CustomEvent("tinyhouse:rotationchange", {
        detail: { placementId: placement.id, rotationIndex: placement.rotationIndex, count: next.count },
      }));
      return true;
    }

    ctx.tools?.addEventListener("click", (event) => {
      const button = event.target.closest('[data-action="rotate"], [data-action="flip"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      rotatePlacement(findPlacement(ctx.state.selectedItemId), event.shiftKey ? -1 : 1);
    }, true);

    window.addEventListener("keydown", (event) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
      if (typing || event.key.toLowerCase() !== "r") return;
      const placement = findPlacement(ctx.state.selectedItemId);
      if (!placement) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      rotatePlacement(placement, event.shiftKey ? -1 : 1);
    }, true);

    document.addEventListener("dblclick", (event) => {
      const node = event.target.closest?.(".placed-item");
      if (!node) return;
      const placement = findPlacement(node.dataset.id);
      const asset = placement && ctx.findAsset(placement.assetId);
      if (!placement || asset?.animated) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      ctx.state.selectedItemId = placement.id;
      rotatePlacement(placement, 1);
    }, true);

    const originalExport = ctx.exportHouse;
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
        const asset = edge.kind === "door"
          ? (ctx.findAsset(edge.doorAssetId) || ctx.defaultDoorAsset())
          : (ctx.findAsset(edge.assetId) || (edge.axis === "left" ? ctx.state.leftWallAsset : ctx.state.rightWallAsset));
        const frameCount = Array.isArray(asset?.frameDataUrls) ? asset.frameDataUrls.length : 0;
        const src = asset && ctx.assetUrl(asset, edge.kind === "door" && edge.open && frameCount ? frameCount - 1 : 0);
        if (!asset || !src) continue;
        drawables.push({
          src,
          x: point.x,
          y: point.y,
          width: Math.min(128, asset.width),
          height: Math.min(128, asset.height),
          flip: edge.kind === "door" && edge.axis === "right",
          z: 260 + (edge.column + edge.row) * 8,
        });
      }
      for (const placement of ctx.state.placements) {
        const visual = visualFor(placement);
        if (!visual?.src) continue;
        const anchor = resolvedAnchor(placement);
        const width = visual.width * placement.scale;
        const height = visual.height * placement.scale;
        const support = placement.supportId && findPlacement(placement.supportId);
        const z = support
          ? 1000 + Math.round((Number(support.y) || 0) * 10 + 600 + (Number(placement.layer) || 0))
          : placement.wallSide && window.TinyHouseWallCore
            ? window.TinyHouseWallCore.wallZIndex(placement)
            : 1000 + Math.round(anchor.y * 10 + (Number(placement.layer) || 0));
        drawables.push({
          src: visual.src,
          x: anchor.x - width / 2,
          y: anchor.y - height,
          width,
          height,
          flip: visual.flip,
          z,
        });
      }
      if (!drawables.length) return originalExport?.();
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
        const image = await new Promise((resolve, reject) => {
          const candidate = new Image();
          candidate.onload = () => resolve(candidate);
          candidate.onerror = reject;
          candidate.src = drawable.src;
        });
        const x = drawable.x - minX;
        const y = drawable.y - minY;
        context.save();
        if (drawable.flip) {
          context.translate(x + drawable.width, y);
          context.scale(-1, 1);
          context.drawImage(image, 0, 0, drawable.width, drawable.height);
        } else {
          context.drawImage(image, x, y, drawable.width, drawable.height);
        }
        context.restore();
      }
      const link = document.createElement("a");
      link.download = "tinyhouse-structure.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      ctx.showToast("House exported · rotations preserved");
    };

    window.TinyHouseRotation = Object.freeze({
      rotationFor,
      visualFor,
      rotatePlacement,
      rotateSelected(delta = 1) {
        return rotatePlacement(findPlacement(ctx.state.selectedItemId), delta);
      },
      get countFourWayAssets() {
        return [...rotationIndex.values()].filter((rotation) => rotation.count === 4).length;
      },
    });

    console.info("[tinyhouse/rotation] authored direction mapping ready", {
      fourWayAssets: window.TinyHouseRotation.countFourWayAssets,
      sheetAssets: sheetFrames.size,
    });
  }});
})();