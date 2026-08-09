(() => {
  const bridge = window.PocketBuddyDesktop;
  if (!bridge) return;

  let lastInteractive = null;
  let shadowRoot = null;
  let displayState = null;
  let displayObserver = null;

  function setInteractive(value) {
    const next = Boolean(value);
    if (next === lastInteractive) return;
    lastInteractive = next;
    bridge.setInteractive(next);
  }

  function findShadowRoot() {
    if (shadowRoot?.host?.isConnected) return shadowRoot;
    const host = document.getElementById("birb-shadow-host");
    shadowRoot = host?.shadowRoot ?? null;
    return shadowRoot;
  }

  function isInteractiveElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.id === "birb" || element.id === "pocket-buddy-custom-pet") return true;
    if (element.closest("#birb-menu, #birb-field-guide, .birb-window, .pb-window, .pb-toast, .pb-private-art-error")) return true;
    if (element.matches("button, input, select, textarea, a, [role='button']")) return true;
    const cursor = getComputedStyle(element).cursor;
    return cursor === "pointer" || cursor === "grab" || cursor === "grabbing";
  }

  function pointerIsInteractive(clientX, clientY) {
    const root = findShadowRoot();
    if (!root) return false;
    const elements = root.elementsFromPoint?.(clientX, clientY) ?? [];
    return elements.some(isInteractiveElement);
  }

  document.addEventListener("mousemove", (event) => {
    setInteractive(pointerIsInteractive(event.clientX, event.clientY));
  }, { passive: true });

  document.addEventListener("mouseleave", () => setInteractive(false), { passive: true });
  document.addEventListener("contextmenu", (event) => event.preventDefault());

  function displayChoices(snapshot) {
    const displays = Array.isArray(snapshot?.displays) ? snapshot.displays : [];
    const primary = displays.find((display) => display.primary);
    return [
      { id: "primary", label: primary ? `Primary — ${primary.label}` : "Primary" },
      ...displays.filter((display) => !display.primary).map((display) => ({ id: display.id, label: display.label })),
    ];
  }

  function selectedDisplayLabel(snapshot) {
    const choice = displayChoices(snapshot).find((item) => item.id === snapshot?.selected);
    return choice?.label ?? "Primary";
  }

  async function refreshDisplayState() {
    displayState = await bridge.listDisplays();
    return displayState;
  }

  async function cycleDisplay(delta) {
    const snapshot = displayState ?? await refreshDisplayState();
    const choices = displayChoices(snapshot);
    if (!choices.length) return;
    const current = Math.max(0, choices.findIndex((choice) => choice.id === snapshot.selected));
    const next = choices[(current + delta + choices.length) % choices.length];
    displayState = await bridge.selectDisplay(next.id);
    await augmentMonitorSetting();
  }

  function isSettingsMenu(menu) {
    const labels = [...menu.querySelectorAll(".birb-menu-item")].map((item) => item.textContent?.trim() ?? "");
    return labels.some((label) => label === "Go Back") && labels.some((label) => label.startsWith("UI Scale"));
  }

  async function augmentMonitorSetting() {
    const root = findShadowRoot();
    const menu = root?.querySelector("#birb-menu");
    if (!menu || !isSettingsMenu(menu)) return;
    const content = menu.querySelector(".birb-window-content");
    if (!content) return;
    if (!displayState) await refreshDisplayState();

    let row = content.querySelector(".pb-desktop-monitor-setting");
    if (!row) {
      row = document.createElement("div");
      row.className = "birb-menu-item birb-menu-item-spinner pb-desktop-monitor-setting";
      const label = document.createElement("span");
      label.className = "pb-desktop-monitor-label";
      label.title = "Click to follow the Windows/macOS primary monitor";
      label.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        displayState = await bridge.selectDisplay("primary");
        await augmentMonitorSetting();
      });
      const controls = document.createElement("div");
      controls.className = "birb-menu-item-spinner-container";
      const left = document.createElement("div");
      left.className = "birb-spinner-button birb-spinner-button-negative";
      left.textContent = "-";
      const right = document.createElement("div");
      right.className = "birb-spinner-button birb-spinner-button-positive";
      right.textContent = "+";
      left.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void cycleDisplay(-1); });
      right.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); void cycleDisplay(1); });
      controls.append(left, right);
      row.append(label, controls);
      const uiScale = [...content.querySelectorAll(".birb-menu-item")].find((item) => item.textContent?.trim().startsWith("UI Scale"));
      if (uiScale?.nextSibling) content.insertBefore(row, uiScale.nextSibling);
      else content.append(row);
    }
    const label = row.querySelector(".pb-desktop-monitor-label");
    const nextText = `Monitor: ${selectedDisplayLabel(displayState)}`;
    if (label && label.textContent !== nextText) label.textContent = nextText;
  }

  function installMonitorSettingsWatcher(root) {
    if (displayObserver) return;
    displayObserver = new MutationObserver(() => { void augmentMonitorSetting(); });
    displayObserver.observe(root, { childList: true, subtree: true });
    void refreshDisplayState().then(() => augmentMonitorSetting());
    bridge.onDisplaysChanged((snapshot) => {
      displayState = snapshot;
      void augmentMonitorSetting();
    });
  }

  const interval = setInterval(() => {
    const root = findShadowRoot();
    if (root) {
      clearInterval(interval);
      setInteractive(false);
      installMonitorSettingsWatcher(root);
    }
  }, 50);

  bridge.onHomeCare((action) => {
    const buddy = window.PocketBuddy;
    if (buddy?.care) void buddy.care(action);
  });

  bridge.onCommand((command) => {
    const buddy = window.PocketBuddy;
    if (!buddy) return;
    if (command === "home") void buddy.home?.open?.().catch((error) => showPrivateArtError(error));
    else if (command === "pets") buddy.showPets?.();
    else if (command === "chill-human") void buddy.setChillActor?.("human");
    else if (command === "chill-pet") void buddy.setChillActor?.("pet");
    else if (command === "care") buddy.showCare?.();
    else if (command === "talk") buddy.showTalk?.();
    setTimeout(() => setInteractive(true), 0);
  });

  function setPrivateArtStatus(status) {
    window.PocketBuddyPrivateArt = Object.freeze({ ...status, updatedAt: Date.now() });
    window.dispatchEvent(new CustomEvent("pocket-buddy-private-art-status", { detail: window.PocketBuddyPrivateArt }));
  }

  function showPrivateArtError(error) {
    const root = findShadowRoot();
    if (!root || root.querySelector(".pb-private-art-error")) return;
    const panel = document.createElement("div");
    panel.className = "pb-private-art-error";
    panel.style.cssText = "position:fixed;left:12px;top:12px;z-index:2147483647;max-width:420px;padding:10px;border:3px solid #3b3045;background:#fff0f0;color:#2d2634;box-shadow:5px 5px 0 #3b3045;font:12px Monocraft,monospace;pointer-events:auto;";
    const title = document.createElement("strong");
    title.textContent = "Pocket Buddy art integrity error";
    const detail = document.createElement("div");
    detail.style.marginTop = "6px";
    detail.textContent = error instanceof Error ? error.message : String(error);
    const hint = document.createElement("div");
    hint.style.marginTop = "6px";
    hint.textContent = "Bundled art was not substituted. Fix or replace the private art bundle, then restart Pocket Buddy.";
    panel.append(title, detail, hint);
    root.append(panel);
    setInteractive(true);
  }

  async function waitForPocketBuddy(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (window.PocketBuddy?.library?.importFile) return window.PocketBuddy;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Pocket Buddy core did not become ready for bundled art installation.");
  }

  function normalizeBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value && typeof value === "object" && Array.isArray(value.data)) return Uint8Array.from(value.data);
    throw new Error("Desktop bridge returned an invalid bundled art payload.");
  }

  async function installBundledArt() {
    try {
      setPrivateArtStatus({ state: "checking", total: 0, installed: 0, skipped: 0, failures: [] });
      const entries = await bridge.listBundledArt();
      if (!Array.isArray(entries) || entries.length === 0) {
        setPrivateArtStatus({ state: "none", total: 0, installed: 0, skipped: 0, failures: [] });
        return;
      }

      const buddy = await waitForPocketBuddy();
      const alreadyInstalled = await buddy.library.listInstalled();
      const installedList = Array.isArray(alreadyInstalled) ? alreadyInstalled : [];
      const installedByHash = new Map(installedList.map((pack) => [pack?.archiveSha256, pack]).filter(([hash]) => hash));
      let installed = 0;
      let skipped = 0;
      const installedPacks = [];

      for (const entry of entries) {
        if (!entry?.sha256 || !entry?.importName) throw new Error("Bundled art manifest entry is incomplete.");
        if (entry.kind === "environment") {
          skipped += 1;
          continue;
        }
        const existing = installedByHash.get(entry.sha256);
        if (existing) {
          if (entry.kind === "human" && existing.id) await buddy.library.setHomeHuman(existing.id);
          skipped += 1;
          continue;
        }
        const payload = await bridge.readBundledArt(entry.id);
        if (payload?.sha256 !== entry.sha256) throw new Error(`Bundled art bridge SHA mismatch for ${entry.displayName || entry.importName}.`);
        const bytes = normalizeBytes(payload.bytes);
        const file = new File([bytes], entry.importName, { type: "application/zip", lastModified: 0 });
        const pack = await buddy.library.importFile(file);
        if (pack?.archiveSha256 !== entry.sha256) throw new Error(`Pocket Buddy importer SHA mismatch for ${entry.displayName || entry.importName}.`);
        if (entry.kind === "human" && pack?.id) await buddy.library.setHomeHuman(pack.id);
        installedByHash.set(entry.sha256, pack);
        installedPacks.push(pack);
        installed += 1;
      }

      await buddy.home?.reloadHuman?.();
      await buddy.restoreChillActor?.();
      setPrivateArtStatus({
        state: "ready",
        total: entries.length,
        installed,
        skipped,
        failures: [],
        packs: entries.map((entry) => ({ displayName: entry.displayName, kind: entry.kind, sha256: entry.sha256 })),
      });
      if (installedPacks.length) window.dispatchEvent(new CustomEvent("pocket-buddy-private-art-installed", { detail: { packs: installedPacks } }));
    } catch (error) {
      console.error("Pocket Buddy private art installation failed", error);
      setPrivateArtStatus({ state: "error", total: 0, installed: 0, skipped: 0, failures: [error instanceof Error ? error.message : String(error)] });
      showPrivateArtError(error);
    }
  }

  void installBundledArt();
})();
