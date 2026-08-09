(() => {
  "use strict";

  const runtime = window.TinyHouseStructureRuntime;
  const templatesCore = window.TinyHouseRoomTemplatesCore;
  if (!runtime || !templatesCore) return;

  runtime.use({ name: "room-templates", init(ctx) {
    const BACKUP_KEY = "pocket-buddy-plus-tinyhouse-template-backup-v1";
    const previewUrls = new Map();
    let drawer;
    let restoreButton;
    let activeTemplateId = null;

    const serializablePlacements = () => ctx.state.placements.map(({ lastFrameAt, ...placement }) => ({ ...placement }));
    const houseSnapshot = () => ({
      version: 1,
      structure: ctx.grid.toJSON(),
      floorAssetId: ctx.state.floorAsset?.id || null,
      leftWallAssetId: ctx.state.leftWallAsset?.id || null,
      rightWallAssetId: ctx.state.rightWallAsset?.id || null,
      placements: serializablePlacements(),
    });

    function saveBackup() {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(houseSnapshot()));
      } catch (error) {
        console.warn("[tinyhouse/templates] Could not store template backup", error);
      }
      updateRestoreButton();
    }

    function updateRestoreButton() {
      if (!restoreButton) return;
      try {
        restoreButton.disabled = !localStorage.getItem(BACKUP_KEY);
      } catch (_error) {
        restoreButton.disabled = true;
      }
    }

    function refreshItems(preferredId = null) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      requestAnimationFrame(() => {
        if (!preferredId) return;
        ctx.state.selectedItemId = preferredId;
        const node = ctx.itemLayer.querySelector(`[data-id="${CSS.escape(preferredId)}"]`);
        node?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }

    function restoreHouse(snapshot, toast = "Previous house restored") {
      if (!snapshot?.structure) return false;
      ctx.state.floorAsset = ctx.findAsset(snapshot.floorAssetId) || ctx.state.floorAsset;
      ctx.state.leftWallAsset = ctx.findAsset(snapshot.leftWallAssetId) || ctx.state.leftWallAsset;
      ctx.state.rightWallAsset = ctx.findAsset(snapshot.rightWallAssetId) || ctx.state.rightWallAsset;
      ctx.restoreStructure(snapshot.structure);
      ctx.state.placements = Array.isArray(snapshot.placements)
        ? snapshot.placements
          .filter((placement) => ctx.findAsset(placement.assetId))
          .map((placement) => ({ ...placement, lastFrameAt: performance.now() }))
        : [];
      ctx.state.idCounter = Math.max(0, ...ctx.state.placements.map((placement) =>
        Number(String(placement.id || "").match(/(\d+)$/)?.[1]) || 0)) + 1;
      ctx.state.layerCounter = Math.max(0, ...ctx.state.placements.map((placement) =>
        Number(placement.layer) || 0)) + 1;
      ctx.state.selectedItemId = null;
      ctx.state.selectedAsset = null;
      ctx.persistStructure();
      ctx.renderStructure();
      refreshItems();
      ctx.fitHouse();
      ctx.showToast(toast);
      return true;
    }

    function restoreBackup() {
      try {
        const raw = localStorage.getItem(BACKUP_KEY);
        if (!raw) return false;
        const restored = restoreHouse(JSON.parse(raw));
        if (restored) localStorage.removeItem(BACKUP_KEY);
        updateRestoreButton();
        return restored;
      } catch (error) {
        console.error("[tinyhouse/templates] Could not restore template backup", error);
        ctx.showToast("Previous house could not be restored");
        return false;
      }
    }

    function createBasePlacement(asset, recipe) {
      const column = Number(recipe.column) || 0;
      const row = Number(recipe.row) || 0;
      const point = ctx.core.cellCenter(column, row, ctx.grid.room);
      return {
        id: `item-${ctx.state.idCounter++}`,
        assetId: asset.id,
        column,
        row,
        x: point.x,
        y: point.y,
        scale: Number(recipe.scale) || asset.defaultScale || 1,
        flip: Boolean(recipe.flip),
        layer: Number(recipe.layer) || ctx.state.layerCounter++,
        supportId: null,
        supportOffsetX: 0,
        frameIndex: 0,
        playing: asset.animationMode === "loop",
        animationDirection: 1,
        lastFrameAt: performance.now(),
      };
    }

    function wallTarget(recipe) {
      const descriptor = recipe.wall;
      const top = ctx.core.wallTopLeft(
        descriptor.axis,
        descriptor.column,
        descriptor.row,
        ctx.grid.room,
      );
      return {
        side: descriptor.axis,
        index: descriptor.axis === "left" ? descriptor.row : descriptor.column,
        column: descriptor.column,
        row: descriptor.row,
        structureEdgeKey: ctx.core.edgeKey(
          descriptor.axis,
          descriptor.column,
          descriptor.row,
        ),
        x: top.x + (Number(descriptor.offsetX) || 64),
        y: top.y + (Number(descriptor.offsetY) || 58),
      };
    }

    function buildPlacements(template) {
      const placedByKey = new Map();
      const pendingSupports = [];

      for (const recipe of template.placements) {
        const asset = ctx.findAsset(recipe.assetId);
        if (!asset) continue;
        const placement = createBasePlacement(asset, recipe);
        if (recipe.wall) {
          window.TinyHouseWallCore?.applyWallPlacement(placement, wallTarget(recipe));
        }
        if (recipe.supportKey) pendingSupports.push({ placement, recipe });
        ctx.state.placements.push(placement);
        if (recipe.key) placedByKey.set(recipe.key, placement);
      }

      for (const { placement, recipe } of pendingSupports) {
        const support = placedByKey.get(recipe.supportKey);
        if (!support) continue;
        placement.supportId = support.id;
        placement.supportOffsetX = Number(recipe.supportOffsetX) || 0;
        placement.column = support.column;
        placement.row = support.row;
        placement.x = support.x;
        placement.y = support.y;
      }
      return placedByKey;
    }

    function applyTemplate(templateId) {
      const template = templatesCore.templateById(templateId);
      if (!template) return false;
      const missing = templatesCore.missingAssetIds(template, ctx.state.manifest);
      if (missing.length) {
        ctx.showToast(`Template is missing ${missing.length} licensed asset${missing.length === 1 ? "" : "s"}`);
        console.warn("[tinyhouse/templates] Missing assets", { templateId, missing });
        return false;
      }
      if (ctx.state.placements.length
        && !confirm(`Replace the current house with the ${template.name} template? A one-step backup will be kept.`)) {
        return false;
      }

      saveBackup();
      activeTemplateId = template.id;
      ctx.state.selectedAsset = null;
      ctx.state.selectedItemId = null;
      ctx.state.hoverSupportId = null;
      ctx.state.idCounter = 1;
      ctx.state.layerCounter = 1;
      ctx.state.placements = [];

      ctx.state.floorAsset = ctx.findAsset(template.theme.floorAssetId) || ctx.state.floorAsset;
      ctx.state.leftWallAsset = ctx.findAsset(template.theme.leftWallAssetId) || ctx.state.leftWallAsset;
      ctx.state.rightWallAsset = ctx.findAsset(template.theme.rightWallAssetId) || ctx.state.rightWallAsset;
      ctx.grid = ctx.core.HouseGrid.createDefault({
        columns: template.structure.columns,
        rows: template.structure.rows,
        floorAssetId: ctx.state.floorAsset?.id,
        leftWallAssetId: ctx.state.leftWallAsset?.id,
        rightWallAssetId: ctx.state.rightWallAsset?.id,
        doorAssetId: ctx.defaultDoorAsset()?.id,
        room: ctx.playable.room,
      });

      const placed = buildPlacements(template);
      ctx.persistStructure();
      ctx.renderStructure();
      refreshItems(placed.values().next().value?.id || null);
      ctx.fitHouse();
      updateTemplateCards();
      ctx.showToast(`${template.name} loaded · every object stays movable and interactive`);
      return true;
    }

    function playAllAnimations() {
      let animated = 0;
      ctx.state.placements.forEach((placement, index) => {
        const asset = ctx.findAsset(placement.assetId);
        if (!asset?.animated) return;
        animated += 1;
        setTimeout(() => ctx.playable.activatePlacement(placement), index * 80);
      });
      if (!animated) return ctx.showToast("This room has no animated objects");
      ctx.showToast(`Playing ${animated} room animation${animated === 1 ? "" : "s"}`);
    }

    function updateTemplateCards() {
      drawer?.querySelectorAll("[data-template-id]").forEach((card) => {
        card.classList.toggle("active", card.dataset.templateId === activeTemplateId);
        const url = previewUrls.get(card.dataset.templateId);
        if (!url) return;
        const previewContainer = card.querySelector(".room-template-preview");
        let preview = previewContainer?.querySelector("img");
        if (!preview && previewContainer) {
          preview = document.createElement("img");
          preview.alt = "";
          previewContainer.replaceChildren(preview);
        }
        if (preview) preview.src = url;
      });
    }

    function setPreviewFile(templateId, file, notify = true) {
      const template = templatesCore.templateById(templateId);
      if (!template || !file) return false;
      const oldUrl = previewUrls.get(templateId);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      previewUrls.set(templateId, URL.createObjectURL(file));
      updateTemplateCards();
      if (notify) ctx.showToast(`${template.name} showcase preview attached locally`);
      return true;
    }

    function attachPreviewFiles(files) {
      let matched = 0;
      let unmatched = 0;
      for (const file of files) {
        const matchedId = templatesCore.matchPreviewFile(file.name);
        if (matchedId) {
          setPreviewFile(matchedId, file, false);
          matched += 1;
        } else {
          unmatched += 1;
        }
      }
      const unmatchedMessage = unmatched
        ? ` · ${unmatched} file${unmatched === 1 ? "" : "s"} need a room card's Choose Preview button`
        : "";
      ctx.showToast(`${matched} named showcase preview${matched === 1 ? "" : "s"} matched${unmatchedMessage}`);
      return { matched, unmatched };
    }

    function buildDrawer() {
      drawer = document.createElement("section");
      drawer.id = "room-template-drawer";
      drawer.className = "pixel-frame";
      drawer.hidden = true;
      drawer.innerHTML = `
        <div class="room-template-heading">
          <div><span class="panel-kicker">LICENSED LOCAL PRESETS</span><h2>Room Templates</h2></div>
          <button type="button" data-template-action="close" aria-label="Close room templates">×</button>
        </div>
        <p class="room-template-intro">These recipes rebuild the showcase rooms from individual TinyHouse assets. The GIFs are optional local previews; they are never uploaded or committed. UUID-named files can be assigned with Choose Preview on the matching room card.</p>
        <div class="room-template-grid"></div>
        <div class="room-template-actions">
          <label class="room-template-file">AUTO-MATCH NAMED SHOWCASES<input data-template-preview-bulk type="file" multiple accept="image/gif,image/png,image/webp" /></label>
          <button type="button" data-template-action="play">PLAY ROOM ANIMATIONS</button>
          <button type="button" data-template-action="restore">RESTORE PREVIOUS HOUSE</button>
        </div>`;
      ctx.viewport.append(drawer);

      const grid = drawer.querySelector(".room-template-grid");
      for (const template of templatesCore.templates) {
        const representative = ctx.findAsset(template.placements[0]?.assetId);
        const card = document.createElement("article");
        card.className = "room-template-card";
        card.dataset.templateId = template.id;
        card.innerHTML = `
          <div class="room-template-preview">${representative?.dataUrl ? `<img src="${representative.dataUrl}" alt="" />` : `<span>${template.name.slice(0, 1)}</span>`}</div>
          <div class="room-template-copy"><h3>${template.name}</h3><p>${template.description}</p><small>${template.structure.columns}×${template.structure.rows} · ${template.placements.length} objects</small></div>
          <div class="room-template-card-actions">
            <button type="button" data-template-action="apply" data-template-id="${template.id}">BUILD ROOM</button>
            <label>CHOOSE PREVIEW<input data-template-preview="${template.id}" type="file" accept="image/gif,image/png,image/webp" /></label>
          </div>`;
        grid.append(card);
      }

      restoreButton = drawer.querySelector('[data-template-action="restore"]');
      updateRestoreButton();
      updateTemplateCards();

      drawer.addEventListener("click", (event) => {
        const button = event.target.closest("[data-template-action]");
        if (!button) return;
        const action = button.dataset.templateAction;
        if (action === "close") drawer.hidden = true;
        else if (action === "apply") applyTemplate(button.dataset.templateId);
        else if (action === "play") playAllAnimations();
        else if (action === "restore") restoreBackup();
      });
      drawer.addEventListener("change", (event) => {
        const input = event.target.closest("input[type='file']");
        if (!input) return;
        if (input.dataset.templatePreview) {
          setPreviewFile(input.dataset.templatePreview, input.files?.[0]);
        } else if (input.hasAttribute("data-template-preview-bulk")) {
          attachPreviewFiles([...input.files]);
        }
      });

      const openButton = document.createElement("button");
      openButton.id = "room-templates-button";
      openButton.className = "command";
      openButton.title = "Open editable room templates";
      openButton.innerHTML = "<span>▦</span>ROOMS";
      document.querySelector("#window-buttons")?.prepend(openButton);
      openButton.addEventListener("click", () => {
        drawer.hidden = !drawer.hidden;
      });
    }

    buildDrawer();
    window.addEventListener("pagehide", () => {
      for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    }, { once: true });

    window.TinyHouseRoomTemplates = Object.freeze({
      applyTemplate,
      restoreBackup,
      playAllAnimations,
      setPreviewFile,
      attachPreviewFiles,
      get activeTemplateId() { return activeTemplateId; },
      templates: templatesCore.templates,
    });
  }});
})();