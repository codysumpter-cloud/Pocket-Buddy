import { LocalContext } from "../../context.js";

const PRISMTEK_HOSTS = new Set(["prismtek.dev", "www.prismtek.dev", "localhost", "127.0.0.1"]);
const PERCH_TARGET_SELECTOR = [
  ".site-header",
  ".hero",
  ".hero-card",
  ".panel",
  ".highlight-card",
  ".download-guide-card",
  ".info-card",
  ".prismcade-card",
  ".site-footer",
  "[data-pocket-buddy-perch]",
].join(",");
const STABLE_PERCH_SELECTOR = "[data-pocket-buddy-stable-perch]";
const PRESERVED_MENU_LABELS = ["Field Guide", "Wardrobe", "Sticky Note"];

function isPrismtekHost() {
  return PRISMTEK_HOSTS.has(window.location.hostname);
}

/**
 * Website-specific context for the Pocket Bird-derived movement runtime.
 *
 * The old website bridge represented panels as fixed transparent IMG elements.
 * Those markers had to be repositioned while scrolling, which could make an idle
 * Buddy appear to snap with the marker. Real page-relative perch rails move with
 * the document naturally, so switching targets stays on the original FLYING path.
 */
export class PrismtekWebContext extends LocalContext {
  constructor() {
    super();
    this.initialPerchCheckSuppressed = false;
  }

  getFocusableElements() {
    if (!isPrismtekHost()) return super.getFocusableElements();
    return [
      STABLE_PERCH_SELECTOR,
      ".birb-sticky-note",
      "video",
      "img:not([data-pocket-buddy-perch-marker]):not([data-pocket-buddy-stable-perch])",
    ];
  }

  getFocusElementTopMargin() {
    return isPrismtekHost() ? 72 : super.getFocusElementTopMargin();
  }

  isFlyingEnabled() {
    if (!super.isFlyingEnabled()) return false;
    if (!isPrismtekHost()) return true;

    // application.js intentionally asks for a teleport on its first focus check.
    // Suppress only that first website target selection: Buddy starts on the ground,
    // then every actual website perch is reached through the existing FLYING animation.
    if (!this.initialPerchCheckSuppressed) {
      this.initialPerchCheckSuppressed = true;
      return false;
    }
    return true;
  }
}

function perchTop(target, rect) {
  if (target.matches(".site-header")) return rect.bottom + window.scrollY;
  return rect.top + window.scrollY;
}

function refreshStablePerches(rails) {
  if (!isPrismtekHost() || !document.body) return;

  const targets = Array.from(document.querySelectorAll(PERCH_TARGET_SELECTOR))
    .filter((target) => target instanceof HTMLElement && target.isConnected)
    .filter((target) => {
      const rect = target.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 18;
    })
    .slice(0, 32);
  const live = new Set(targets);

  for (const [target, rail] of rails.entries()) {
    if (live.has(target)) continue;
    rail.remove();
    rails.delete(target);
  }

  for (const target of targets) {
    let rail = rails.get(target);
    if (!rail) {
      rail = document.createElement("span");
      rail.dataset.pocketBuddyStablePerch = "1";
      rail.setAttribute("aria-hidden", "true");
      Object.assign(rail.style, {
        position: "absolute",
        height: "1px",
        minHeight: "1px",
        pointerEvents: "none",
        userSelect: "none",
        opacity: "0",
        zIndex: "-1",
      });
      document.body.appendChild(rail);
      rails.set(target, rail);
    }

    const rect = target.getBoundingClientRect();
    const left = Math.max(0, rect.left + window.scrollX);
    const width = Math.max(100, Math.min(rect.width, document.documentElement.scrollWidth - left));
    rail.style.left = `${Math.round(left)}px`;
    rail.style.top = `${Math.round(perchTop(target, rect))}px`;
    rail.style.width = `${Math.round(width)}px`;
  }
}

function installStablePerches() {
  const rails = new Map();
  let frame = 0;
  let observer = null;

  const refresh = () => {
    frame = 0;
    refreshStablePerches(rails);
  };
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(refresh);
  };
  const start = () => {
    if (!document.body || observer) return;
    refresh();
    window.addEventListener("resize", schedule, { passive: true });
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start, { once: true });
}

function labelForMenuItem(item) {
  if (!(item instanceof HTMLElement)) return "";
  return item.textContent?.trim() ?? "";
}

function restorePreservedMenuItems(menu, preserved) {
  if (!(menu instanceof HTMLElement) || !menu.isConnected) return;
  const content = menu.querySelector(".birb-window-content");
  if (!(content instanceof HTMLElement)) return;

  const currentItems = Array.from(content.querySelectorAll(":scope > .birb-menu-item"));
  const firstLabel = labelForMenuItem(currentItems[0]);
  if (firstLabel === "Go Back" || menu.dataset.pocketBuddySubmenu) return;

  const missing = preserved.filter((item) => item instanceof HTMLElement && item.parentElement !== content);
  if (!missing.length) return;

  const anchor = currentItems.find((item) => labelForMenuItem(item) === "Settings")
    ?? currentItems.find((item) => /^Hide Buddy$/i.test(labelForMenuItem(item)))
    ?? null;

  for (const item of missing) {
    content.insertBefore(item, anchor);
  }
}

function installMenuToolPreserver(shadowRoot) {
  const snapshots = new WeakMap();
  let restoreQueued = false;

  const inspect = () => {
    const menu = shadowRoot.getElementById("birb-menu");
    if (!(menu instanceof HTMLElement)) return;
    const content = menu.querySelector(".birb-window-content");
    if (!(content instanceof HTMLElement)) return;

    const items = Array.from(content.querySelectorAll(":scope > .birb-menu-item"));
    let preserved = snapshots.get(menu);
    const found = PRESERVED_MENU_LABELS
      .map((label) => items.find((item) => labelForMenuItem(item) === label))
      .filter((item) => item instanceof HTMLElement);

    // Capture the actual base nodes before Pocket Buddy's lean menu detaches them.
    // Re-inserting the same nodes preserves the original Field Guide/Wardrobe handlers.
    if (found.some((item) => labelForMenuItem(item) === "Field Guide")
      && found.some((item) => labelForMenuItem(item) === "Wardrobe")) {
      preserved = found;
      snapshots.set(menu, preserved);
    }
    if (!preserved?.length || restoreQueued) return;

    restoreQueued = true;
    queueMicrotask(() => {
      restoreQueued = false;
      restorePreservedMenuItems(menu, preserved);
    });
  };

  const observer = new MutationObserver(inspect);
  observer.observe(shadowRoot, { childList: true, subtree: true });
  inspect();
}

function installMenuCompatibility() {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const host = document.getElementById("birb-shadow-host");
    if (host?.shadowRoot) {
      window.clearInterval(timer);
      installMenuToolPreserver(host.shadowRoot);
      return;
    }
    if (attempts >= 400) window.clearInterval(timer);
  }, 25);
}

export function installPrismtekWebRuntimeGuards() {
  if (!isPrismtekHost()) return;
  installStablePerches();
  installMenuCompatibility();
}
