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

  /**
   * Pop-outs are mutually exclusive. They were previously shown at their
   * original docked coordinates, so opening two stacked them on top of each
   * other and left the pair unusable.
   */
  function togglePanel(entry, button) {
    if (!panelFor(entry)) return;
    const wasOpen = isOpen(entry);
    for (const other of POPOUTS) if (other.id !== entry.id) hidePanel(other);
    wasOpen ? hidePanel(entry) : showPanel(entry);
    syncLauncherState();
  }

  function syncLauncherState() {
    for (const button of document.querySelectorAll("#pb-home-launcher button[data-panel]")) {
      const entry = POPOUTS.find((item) => item.id === button.dataset.panel);
      button.dataset.open = entry && isOpen(entry) ? "true" : "false";
    }
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
      button.dataset.panel = entry.id;
    }

    // Size is the base scale of the house; zoom moves the camera relative to
    // it. Keeping them separate means zooming in no longer permanently
    // changes how big the house sits on your desktop.
    make("SIZE −", "Smaller house", () => nudgeSize(1 / 1.12));
    make("SIZE +", "Bigger house", () => nudgeSize(1.12));

    const follow = make("FOLLOW", "Keep the camera on your character", (self) => {
      setFollow(!following);
      self.dataset.open = following ? "true" : "false";
    });
    follow.dataset.open = "false";
    follow.dataset.follow = "true";

    make("CENTER", "Frame the whole house", () => {
      setFollow(false);
      centerHouse(readSize());
    });

    make(overlay ? "WINDOWED" : "DESKTOP", "Switch how Home is displayed", () => {
      bridge?.setMode?.(overlay ? "window" : "desktop");
    }).dataset.role = "mode";

    shell.append(bar);
  }

  // --------------------------------------------------------------- camera

  const SIZE_KEY = "pocket-buddy.home.sizeScale";
  let following = false;
  let followFrame = 0;

  function readSize() {
    const stored = Number(localStorage.getItem(SIZE_KEY));
    return Number.isFinite(stored) && stored > 0 ? Math.min(3, Math.max(0.4, stored)) : 1;
  }

  function applySize(value) {
    const camera = window.TinyHouseCamera;
    if (!camera?.setScale) return;
    localStorage.setItem(SIZE_KEY, String(value));
    camera.setScale(value);
  }

  function nudgeSize(multiplier) {
    const next = Math.min(3, Math.max(0.4, readSize() * multiplier));
    localStorage.setItem(SIZE_KEY, String(next));
    // Resize about the house rather than the old stage origin.
    if (!centerHouse(next)) applySize(next);
  }

  /** Ride the camera on the player. Not a first-person view — the art is 8-way isometric. */
  function followTick() {
    followFrame = 0;
    if (!following) return;
    const point = window.PocketBuddyHomeView?.playerPoint?.();
    const camera = window.TinyHouseCamera;
    if (point && camera?.centerOn) camera.centerOn(point.x, point.y);
    followFrame = requestAnimationFrame(followTick);
  }

  function setFollow(value) {
    following = Boolean(value);
    const button = document.querySelector('#pb-home-launcher button[data-follow]');
    if (button) button.dataset.open = following ? "true" : "false";
    if (following && !followFrame) followFrame = requestAnimationFrame(followTick);
    if (!following && followFrame) { cancelAnimationFrame(followFrame); followFrame = 0; }
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

  /**
   * Overlay mode gives the page the whole screen while the stage keeps its
   * original offset, so the house lands off to one side and zooming toward the
   * viewport centre appears to shove it away. Frame it once the grid exists.
   */
  function houseCentre() {
    const grid = window.TinyHouseStructure?.grid;
    const core = window.TinyHouseGridCore;
    const bounds = grid?.bounds?.();
    if (!grid || !core?.cellCenter || !bounds) return null;
    return core.cellCenter(
      (bounds.minColumn + bounds.maxColumn) / 2,
      (bounds.minRow + bounds.maxRow) / 2,
      grid.room,
    );
  }

  /**
   * Centre on the house at the chosen size. Deliberately not TinyHouseCamera.fit,
   * whose framing is tuned for the fixed 1200x675 builder shell and leaves the
   * house hundreds of pixels off-centre in a full-screen overlay — which is what
   * made zooming feel like it shoved the house away.
   */
  function centerHouse(scale) {
    const centre = houseCentre();
    if (centre) window.TinyHouseCamera?.centerOn?.(centre.x, centre.y, scale);
    return Boolean(centre);
  }

  function frameHouseWhenReady(attempt = 0) {
    if (attempt > 40) return;
    if (!window.TinyHouseCamera?.centerOn || !centerHouse(readSize())) {
      setTimeout(() => frameHouseWhenReady(attempt + 1), 250);
    }
  }

  /**
   * The life controls ship as their own absolutely-positioned bar. On the
   * desktop overlay that landed on top of the launcher and ran off the right
   * edge of the screen, so fold its buttons into the single launcher bar.
   */
  function absorbLifeControls(attempt = 0) {
    const bar = $("#pb-home-launcher");
    const controls = $("#pb-home-life-controls");
    if (!bar) return;
    if (!controls) {
      if (attempt < 40) setTimeout(() => absorbLifeControls(attempt + 1), 250);
      return;
    }
    if (controls.dataset.pbAbsorbed === "true") return;
    controls.dataset.pbAbsorbed = "true";
    bar.append(...controls.querySelectorAll("button"));
    controls.remove();
  }

  function boot() {
    buildLauncher();
    absorbLifeControls();
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!POPOUTS.some(isOpen)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      collapseAll();
      syncLauncherState();
    }, true);
    if (overlay) collapseAll();
    installClickThrough();
    frameHouseWhenReady();
    window.addEventListener("resize", () => {
      if (!following) centerHouse();
    });

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
