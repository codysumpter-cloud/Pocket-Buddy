(() => {
  "use strict";

  // Pocket Buddy Home desktop-overlay shell.
  //
  // In "desktop" mode Home runs as a transparent always-on-top window sitting
  // on the real desktop: the builder chrome is stripped, the house is the only
  // thing painted, and the panels become pop-out menus launched from a compact
  // bar. Empty space is click-through so the desktop behind stays usable.
  //
  // This decorates the one canonical Home renderer. It never draws the house.

  const config = window.POCKET_BUDDY_HOME_CONFIG || {};
  const bridge = window.PocketBuddyHome;
  const overlay = config.mode === "desktop";

  // Panels that become pop-outs. Some are built later by the structure editor
  // and room/cozy plugins, so they are resolved lazily on every toggle.
  const POPOUTS = [
    { id: "catalog", label: "BUILD", title: "Asset library" },
    { id: "structure-tools", label: "STRUCTURE", title: "House structure" },
    { id: "top-hud", label: "FILE", title: "Save, load, export" },
    { id: "camera-tools", label: "CAMERA", title: "Zoom and fit" },
    { id: "selection-tools", label: "SELECTION", title: "Selected object" },
  ];

  // Anything under these is real content and must swallow the pointer.
  const INTERACTIVE = [
    "#pb-home-launcher", "#pb-home-life-controls", "#top-hud", "#catalog",
    "#structure-tools", "#selection-tools", "#camera-tools", "#rooms-panel",
    "#cozy-panel", "#blueprint-panel", "#structure-hit-layer", "#toast",
    ".placed-item", ".structure-door", ".structure-floor-hit", ".structure-edge-hit",
    "#pb-home-human", "#pb-home-buddy", "button", "input", "select", "textarea",
  ].join(",");

  const $ = (selector) => document.querySelector(selector);
  const hidden = new Map();
  let lastInteractive = null;
  let spaceDown = false;

  document.documentElement.dataset.pbHomeMode = overlay ? "desktop" : "window";

  // ------------------------------------------------------------- pop-outs

  function panelFor(entry) {
    return document.getElementById(entry.id);
  }

  function hidePanel(entry) {
    const panel = panelFor(entry);
    if (!panel || hidden.has(entry.id)) return;
    hidden.set(entry.id, panel.style.display);
    panel.style.display = "none";
  }

  function showPanel(entry) {
    const panel = panelFor(entry);
    if (!panel) return;
    panel.style.display = hidden.has(entry.id) ? (hidden.get(entry.id) || "") : "";
    hidden.delete(entry.id);
  }

  function isOpen(entry) {
    const panel = panelFor(entry);
    return Boolean(panel) && !hidden.has(entry.id);
  }

  function togglePanel(entry, button) {
    if (!panelFor(entry)) return;
    isOpen(entry) ? hidePanel(entry) : showPanel(entry);
    button.dataset.open = isOpen(entry) ? "true" : "false";
  }

  function collapseAll() {
    for (const entry of POPOUTS) hidePanel(entry);
  }

  // ------------------------------------------------------------- launcher

  function buildLauncher() {
    if ($("#pb-home-launcher")) return;
    const shell = $("#game-shell");
    if (!shell) return;

    const bar = document.createElement("nav");
    bar.id = "pb-home-launcher";
    bar.setAttribute("aria-label", "Pocket Buddy Home menus");

    const make = (label, title, onClick) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        onClick(button);
      });
      bar.append(button);
      return button;
    };

    for (const entry of POPOUTS) {
      const button = make(entry.label, entry.title, (self) => togglePanel(entry, self));
      button.dataset.open = "false";
    }

    make(overlay ? "WINDOWED" : "DESKTOP", "Switch how Home is displayed", () => {
      bridge?.setMode?.(overlay ? "window" : "desktop");
    }).dataset.role = "mode";

    shell.append(bar);
  }

  // -------------------------------------------------------- click-through

  /** True when the point sits on a real floor cell (walls included via halo). */
  function overHouse(clientX, clientY) {
    const core = window.TinyHouseGridCore;
    const grid = window.TinyHouseStructure?.grid;
    const stage = $("#world-stage");
    if (!core?.gridCoordinates || !grid || !stage) return false;

    const rect = stage.getBoundingClientRect();
    const scale = Number(window.TinyHouseCamera?.view?.scale) || 1;
    if (!Number.isFinite(scale) || scale <= 0) return false;

    const stageX = (clientX - rect.left) / scale;
    const stageY = (clientY - rect.top) / scale;
    const point = core.gridCoordinates(stageX, stageY, grid.room);
    const column = Math.round(point.column);
    const row = Math.round(point.row);

    // A one-cell halo: walls are drawn lifted above and beside their floor.
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        if (grid.hasFloor(column + dc, row + dr)) return true;
      }
    }
    return false;
  }

  function pointerIsInteractive(clientX, clientY) {
    if (spaceDown) return true;
    const element = document.elementFromPoint(clientX, clientY);
    if (element instanceof Element && element.closest(INTERACTIVE)) return true;
    return overHouse(clientX, clientY);
  }

  function setInteractive(value) {
    const next = Boolean(value);
    if (next === lastInteractive) return;
    lastInteractive = next;
    bridge?.setInteractive?.(next);
  }

  function installClickThrough() {
    if (!overlay) return;
    document.addEventListener("mousemove", (event) => {
      setInteractive(pointerIsInteractive(event.clientX, event.clientY));
    }, { passive: true, capture: true });
    document.addEventListener("mouseleave", () => setInteractive(false), { passive: true });

    // Space is the builder's pan modifier, so the whole surface must catch the
    // pointer while it is held.
    window.addEventListener("keydown", (event) => {
      if (event.code !== "Space") return;
      spaceDown = true;
      setInteractive(true);
    }, true);
    window.addEventListener("keyup", (event) => {
      if (event.code !== "Space") return;
      spaceDown = false;
    }, true);
    window.addEventListener("blur", () => { spaceDown = false; setInteractive(false); });

    setInteractive(false);
  }

  // ----------------------------------------------------------------- boot

  function boot() {
    buildLauncher();
    if (overlay) collapseAll();
    installClickThrough();

    // Structure, Rooms and Cozy panels are created after their plugins load;
    // keep them collapsed in overlay mode until the user asks for them.
    if (!overlay) return;
    const observer = new MutationObserver(() => {
      for (const entry of POPOUTS) {
        const panel = panelFor(entry);
        if (panel && !hidden.has(entry.id) && panel.dataset.pbSeen !== "true") {
          panel.dataset.pbSeen = "true";
          hidePanel(entry);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
