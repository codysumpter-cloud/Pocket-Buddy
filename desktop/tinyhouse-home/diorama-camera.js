(() => {
  "use strict";

  const runtime = window.TinyHouseStructureRuntime;
  if (!runtime) return;

  runtime.use({ name: "diorama-camera-feel", init(ctx) {
    const MIN_SCALE = 0.38;
    const MAX_SCALE = 2.2;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointers = new Map();
    const target = {
      scale: Number(ctx.state.scale) || 1,
      panX: Number(ctx.state.panX) || 0,
      panY: Number(ctx.state.panY) || 0,
    };
    let frame = 0;
    let pan = null;
    let pinch = null;

    function renderNow() {
      ctx.state.scale = target.scale;
      ctx.state.panX = target.panX;
      ctx.state.panY = target.panY;
      ctx.stage.style.transform = `translate(${target.panX}px, ${target.panY}px) scale(${target.scale})`;
    }

    function animate() {
      frame = 0;
      const factor = reducedMotion ? 1 : 0.18;
      ctx.state.scale += (target.scale - ctx.state.scale) * factor;
      ctx.state.panX += (target.panX - ctx.state.panX) * factor;
      ctx.state.panY += (target.panY - ctx.state.panY) * factor;
      if (Math.abs(target.scale - ctx.state.scale) < 0.0005) ctx.state.scale = target.scale;
      if (Math.abs(target.panX - ctx.state.panX) < 0.05) ctx.state.panX = target.panX;
      if (Math.abs(target.panY - ctx.state.panY) < 0.05) ctx.state.panY = target.panY;
      ctx.stage.style.transform = `translate(${ctx.state.panX}px, ${ctx.state.panY}px) scale(${ctx.state.scale})`;
      if (ctx.state.scale !== target.scale || ctx.state.panX !== target.panX || ctx.state.panY !== target.panY) {
        frame = requestAnimationFrame(animate);
      }
    }

    function startAnimation() {
      if (reducedMotion) return renderNow();
      if (!frame) frame = requestAnimationFrame(animate);
    }

    function syncTarget() {
      target.scale = Number(ctx.state.scale) || 1;
      target.panX = Number(ctx.state.panX) || 0;
      target.panY = Number(ctx.state.panY) || 0;
    }

    function zoomAt(clientX, clientY, nextScale) {
      const rect = ctx.viewport.getBoundingClientRect();
      const oldScale = target.scale;
      const scale = ctx.clamp(nextScale, MIN_SCALE, MAX_SCALE);
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const worldX = (localX - target.panX) / oldScale;
      const worldY = (localY - target.panY) / oldScale;
      target.scale = scale;
      target.panX = localX - worldX * scale;
      target.panY = localY - worldY * scale;
      startAnimation();
    }

    function zoomCenter(multiplier) {
      const rect = ctx.viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, target.scale * multiplier);
    }

    function fitHouseSmooth() {
      const bounds = ctx.grid?.bounds?.();
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
      target.scale = ctx.clamp(
        Math.min((rect.width - 360) / (maxX - minX), (rect.height - 120) / (maxY - minY)),
        MIN_SCALE,
        1.35,
      );
      target.panX = (rect.width + 300) / 2 - ((minX + maxX) / 2) * target.scale;
      target.panY = rect.height / 2 - ((minY + maxY) / 2) * target.scale;
      startAnimation();
    }

    ctx.fitHouse = fitHouseSmooth;

    function shouldPan(event) {
      if (event.target.closest?.("#catalog, #camera-tools, #selection-tools, #window-buttons, #structure-tools, #room-template-drawer, #cozy-panel")) return false;
      if (event.target.closest?.(".placed-item, .structure-door, .structure-floor-hit, .structure-edge-hit")) return false;
      if (event.button === 1 || ctx.state.spaceDown) return true;
      return event.button === 0 && !ctx.state.selectedAsset && ctx.mode === "furnish";
    }

    ctx.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const multiplier = Math.exp(-event.deltaY * 0.0015);
      zoomAt(event.clientX, event.clientY, target.scale * multiplier);
    }, { passive: false, capture: true });

    ctx.viewport.addEventListener("pointerdown", (event) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
      if (event.pointerType === "touch" && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rect = ctx.viewport.getBoundingClientRect();
        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          scale: target.scale,
          worldX: (midpoint.x - rect.left - target.panX) / target.scale,
          worldY: (midpoint.y - rect.top - target.panY) / target.scale,
        };
        pan = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!shouldPan(event)) return;
      pan = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        velocityX: 0,
        velocityY: 0,
      };
      try { ctx.viewport.setPointerCapture(event.pointerId); } catch (_error) { /* synthetic pointers */ }
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    ctx.viewport.addEventListener("pointermove", (event) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rect = ctx.viewport.getBoundingClientRect();
        target.scale = ctx.clamp(pinch.scale * distance / pinch.distance, MIN_SCALE, MAX_SCALE);
        target.panX = midpoint.x - rect.left - pinch.worldX * target.scale;
        target.panY = midpoint.y - rect.top - pinch.worldY * target.scale;
        startAnimation();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!pan || pan.pointerId !== event.pointerId) return;
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      pan.x = event.clientX;
      pan.y = event.clientY;
      pan.velocityX = dx;
      pan.velocityY = dy;
      target.panX += dx;
      target.panY += dy;
      startAnimation();
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    function endPointer(event) {
      pointers.delete(event.pointerId);
      if (pinch && pointers.size < 2) pinch = null;
      if (!pan || pan.pointerId !== event.pointerId) return;
      if (!reducedMotion) {
        target.panX += pan.velocityX * 7;
        target.panY += pan.velocityY * 7;
        startAnimation();
      }
      pan = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    ctx.viewport.addEventListener("pointerup", endPointer, true);
    ctx.viewport.addEventListener("pointercancel", endPointer, true);

    const interceptButton = (selector, action) => {
      document.querySelector(selector)?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        action();
      }, true);
    };
    interceptButton("#zoom-in", () => zoomCenter(1.18));
    interceptButton("#zoom-out", () => zoomCenter(1 / 1.18));
    interceptButton("#center-view", fitHouseSmooth);

    window.addEventListener("resize", () => {
      if (ctx.grid?.floors?.size) fitHouseSmooth();
    });

    const dockHint = document.querySelector("#camera-tools .space-hint span");
    if (dockHint) dockHint.textContent = "DRAG EMPTY SPACE · WHEEL/PINCH TO ZOOM";

    window.TinyHouseCamera = Object.freeze({
      mode: "fixed-isometric-2d",
      orbitSupported: false,
      zoomAt,
      zoomIn() { zoomCenter(1.18); },
      zoomOut() { zoomCenter(1 / 1.18); },
      fit: fitHouseSmooth,
      syncTarget,
      get view() {
        return { scale: target.scale, panX: target.panX, panY: target.panY };
      },
    });

    syncTarget();
    console.info("[tinyhouse/camera] Diorama-style pan, damping, cursor zoom, and pinch ready");
  }});
})();