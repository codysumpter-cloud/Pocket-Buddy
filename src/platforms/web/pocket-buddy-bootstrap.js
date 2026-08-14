// Pocket Buddy web bootstrap.
// Keeps the Pocket Bird-derived runtime/art intact while giving Pocket Buddy a
// stable, self-owned embed entry point plus host-aware web affordances.

(() => {
  "use strict";

  const GLOBAL_KEY = "__POCKET_BUDDY_EMBED__";
  if (window[GLOBAL_KEY]?.status === "ready" || window[GLOBAL_KEY]?.status === "loading") return;

  const currentScript = document.currentScript;
  const sourceUrl = currentScript instanceof HTMLScriptElement ? currentScript.src : "";
  const runtimeUrl = sourceUrl
    ? new URL("birb.embed.js", sourceUrl).href
    : "./birb.embed.js";
  const featherSpriteUrl = sourceUrl
    ? new URL("../../sprites/feather.png", sourceUrl).href
    : "";

  const isPrismtekHost = ["prismtek.dev", "www.prismtek.dev", "localhost", "127.0.0.1"].includes(window.location.hostname);
  const SAVE_KEY = "birbSaveData";
  const CHAT_HISTORY_KEY = "pocketBuddySiteChatMessagesV1";
  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const PERCH_SELECTOR = [
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
  const COMMON_FEATHER_SPECIES = [
    "bluebird", "shimaEnaga", "tuftedTitmouse", "europeanRobin", "redCardinal",
    "americanGoldfinch", "barnSwallow", "mistletoebird", "scarletRobin", "americanRobin",
    "carolinaWren", "blackCappedChickadee", "blueJay", "darkEyedJunco", "houseFinch",
    "redWingedBlackbird", "pigeon", "stellarsJay", "mourningDove", "littleCrow",
  ];
  const UNCOMMON_FEATHER_SPECIES = [
    "redAvadavat", "pinkRobin", "spangledCotinga", "elegantEuphonia", "paintedBunting",
    "redWarbler", "cubanTody", "violetBackedStarling", "whiteWingedFairywren", "redpoll",
  ];

  const state = {
    version: "2026.08.14.2",
    status: "loading",
    runtimeUrl,
    error: null,
    diagnostics: {
      mobileGuard: false,
      fieldGuideGuard: false,
      layoutPerches: 0,
      featherBooster: false,
      cloudChatBridge: false,
    },
  };
  window[GLOBAL_KEY] = state;

  let hostShadowRoot = null;
  let rootObserver = null;
  let siteObserver = null;
  let perchFrame = 0;
  let featherTimer = 0;
  let cloudChatInstalled = false;
  const perchMarkers = new Map();

  function safeJsonParse(raw, fallback) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
  }

  function applyMobileViewportGuard(shadowRoot) {
    if (shadowRoot.getElementById("pocket-buddy-web-viewport-guard")) return;

    const style = document.createElement("style");
    style.id = "pocket-buddy-web-viewport-guard";
    style.textContent = `
      @media (max-width: 720px) {
        #birb-field-guide,
        #birb-field-guide.pb-field-guide {
          width: calc(100vw - 16px) !important;
          max-width: calc(100vw - 16px) !important;
          max-height: calc(100dvh - 24px) !important;
          box-sizing: border-box !important;
        }
        #birb-field-guide .birb-window-header {
          position: sticky !important;
          top: 0 !important;
          z-index: 20 !important;
        }
        #birb-field-guide .birb-window-content {
          max-height: calc(100dvh - 70px) !important;
          overflow: auto !important;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        #birb-field-guide .birb-window-close {
          display: flex !important;
          min-width: 34px !important;
          min-height: 34px !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
          touch-action: manipulation;
        }
      }
      @supports (padding: env(safe-area-inset-bottom)) {
        #birb:not(.birb-absolute) {
          bottom: calc(92px + env(safe-area-inset-bottom)) !important;
        }
      }
    `;
    shadowRoot.appendChild(style);
    state.diagnostics.mobileGuard = true;
  }

  function clampWindowToViewport(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return;
    const margin = 8;
    const rect = element.getBoundingClientRect();
    let left = Number.parseFloat(element.style.left);
    let top = Number.parseFloat(element.style.top);
    if (!Number.isFinite(left)) left = rect.left;
    if (!Number.isFinite(top)) top = rect.top;

    if (rect.right > window.innerWidth - margin) left -= rect.right - (window.innerWidth - margin);
    if (rect.left < margin) left += margin - rect.left;
    if (rect.bottom > window.innerHeight - margin) top -= rect.bottom - (window.innerHeight - margin);
    if (rect.top < margin) top += margin - rect.top;

    const nextLeft = `${Math.round(Math.max(margin, left))}px`;
    const nextTop = `${Math.round(Math.max(margin, top))}px`;
    if (element.style.left !== nextLeft) element.style.left = nextLeft;
    if (element.style.top !== nextTop) element.style.top = nextTop;
  }

  function wireFieldGuide(shadowRoot) {
    const guide = shadowRoot.getElementById("birb-field-guide");
    if (!(guide instanceof HTMLElement)) return;

    const closeButton = guide.querySelector(".birb-window-close");
    if (closeButton instanceof HTMLElement && !closeButton.dataset.pocketBuddyAccessibleClose) {
      closeButton.dataset.pocketBuddyAccessibleClose = "1";
      closeButton.setAttribute("role", "button");
      closeButton.setAttribute("tabindex", "0");
      closeButton.setAttribute("aria-label", "Close Field Guide");
      closeButton.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          closeButton.click();
        }
      });
    }

    if (!guide.dataset.pocketBuddyWebGuide) {
      guide.dataset.pocketBuddyWebGuide = "1";
      guide.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target.closest(".birb-grid-item") : null;
        if (!target || target.classList.contains("birb-grid-item-locked")) return;
        window.setTimeout(() => {
          if (guide.isConnected) guide.remove();
        }, 0);
      });
    }

    window.requestAnimationFrame(() => clampWindowToViewport(guide));
    state.diagnostics.fieldGuideGuard = true;
  }

  function installFieldGuideGuard(shadowRoot) {
    wireFieldGuide(shadowRoot);
    if (rootObserver) return;
    rootObserver = new MutationObserver(() => wireFieldGuide(shadowRoot));
    rootObserver.observe(shadowRoot, { childList: true, subtree: true });

    window.addEventListener("resize", () => wireFieldGuide(shadowRoot), { passive: true });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const guide = shadowRoot.getElementById("birb-field-guide");
      if (guide) guide.remove();
    });
  }

  function markerTopForTarget(target, rect) {
    if (target.matches(".site-header")) return rect.bottom;
    if (target.matches(".site-footer")) return rect.top;
    return rect.top;
  }

  function updatePerchMarkers() {
    perchFrame = 0;
    if (!isPrismtekHost || !document.body) return;

    const targets = Array.from(document.querySelectorAll(PERCH_SELECTOR))
      .filter((target) => target instanceof HTMLElement && target.isConnected)
      .filter((target) => {
        const rect = target.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 18;
      })
      .slice(0, 24);
    const liveTargets = new Set(targets);

    for (const [target, marker] of perchMarkers.entries()) {
      if (liveTargets.has(target)) continue;
      marker.remove();
      perchMarkers.delete(target);
    }

    for (const target of targets) {
      let marker = perchMarkers.get(target);
      if (!marker) {
        marker = document.createElement("img");
        marker.src = TRANSPARENT_PIXEL;
        marker.alt = "";
        marker.setAttribute("aria-hidden", "true");
        marker.dataset.pocketBuddyPerchMarker = "1";
        Object.assign(marker.style, {
          position: "fixed",
          height: "1px",
          minHeight: "1px",
          pointerEvents: "none",
          userSelect: "none",
          opacity: "1",
          zIndex: "-1",
        });
        document.body.appendChild(marker);
        perchMarkers.set(target, marker);
      }

      const rect = target.getBoundingClientRect();
      const top = markerTopForTarget(target, rect);
      const usableTop = top < 80 && rect.bottom >= 80 ? rect.bottom : top;
      const inViewport = rect.right > 0 && rect.left < window.innerWidth && usableTop >= 80 && usableTop <= window.innerHeight;
      marker.style.display = inViewport ? "block" : "none";
      if (!inViewport) continue;
      marker.style.left = `${Math.round(clamp(rect.left, 0, Math.max(0, window.innerWidth - 100)))}px`;
      marker.style.top = `${Math.round(usableTop)}px`;
      marker.style.width = `${Math.max(100, Math.round(Math.min(rect.width, window.innerWidth - Math.max(0, rect.left))))}px`;
    }

    state.diagnostics.layoutPerches = perchMarkers.size;
  }

  function schedulePerchRefresh() {
    if (perchFrame) return;
    perchFrame = window.requestAnimationFrame(updatePerchMarkers);
  }

  function installLayoutPerches() {
    if (!isPrismtekHost || siteObserver || !document.body) return;
    updatePerchMarkers();
    window.addEventListener("scroll", schedulePerchRefresh, { passive: true });
    window.addEventListener("resize", schedulePerchRefresh, { passive: true });
    siteObserver = new MutationObserver(schedulePerchRefresh);
    siteObserver.observe(document.body, { childList: true, subtree: true });
  }

  function readBirdSave() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(SAVE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function lockedSpeciesForFeathers() {
    const save = readBirdSave();
    const unlocked = new Set(Array.isArray(save.unlockedSpecies) ? save.unlockedSpecies : ["bluebird"]);
    const common = COMMON_FEATHER_SPECIES.filter((id) => !unlocked.has(id));
    const uncommon = UNCOMMON_FEATHER_SPECIES.filter((id) => !unlocked.has(id));
    return { common, uncommon };
  }

  function chooseFeatherSpecies() {
    const { common, uncommon } = lockedSpeciesForFeathers();
    const preferred = Math.random() < 0.15 ? uncommon : common;
    const pool = preferred.length ? preferred : (common.length ? common : uncommon);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  function buddyToast(text) {
    if (!hostShadowRoot) return;
    hostShadowRoot.querySelector(".pb-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "pb-toast";
    toast.textContent = String(text).slice(0, 180);
    hostShadowRoot.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  function collectBoosterFeather(speciesId, feather) {
    const save = readBirdSave();
    const unlocked = new Set(Array.isArray(save.unlockedSpecies) ? save.unlockedSpecies : ["bluebird"]);
    if (!unlocked.has(speciesId)) unlocked.add(speciesId);
    save.unlockedSpecies = Array.from(unlocked);
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      window.dispatchEvent(new Event("focus"));
      buddyToast("Feather found! A new bird joined your Field Guide.");
    } catch (error) {
      console.warn("Pocket Buddy: could not save booster feather", error);
    }
    feather.remove();
    scheduleFeatherDrop(false);
  }

  function spawnBoosterFeather() {
    featherTimer = 0;
    if (!isPrismtekHost || !featherSpriteUrl || !document.body) return;
    if (document.hidden) {
      scheduleFeatherDrop(false, 45_000);
      return;
    }
    if (hostShadowRoot?.getElementById("birb-feather") || document.getElementById("pocket-buddy-web-feather")) {
      scheduleFeatherDrop(false, 60_000);
      return;
    }

    const speciesId = chooseFeatherSpecies();
    if (!speciesId) return;

    const feather = document.createElement("button");
    feather.id = "pocket-buddy-web-feather";
    feather.type = "button";
    feather.setAttribute("aria-label", "Collect Pocket Buddy feather");
    const image = document.createElement("img");
    image.src = featherSpriteUrl;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.style.width = "28px";
    image.style.height = "28px";
    image.style.imageRendering = "pixelated";
    feather.appendChild(image);

    const startX = Math.round(randomBetween(24, Math.max(25, window.innerWidth - 54)));
    const landingY = Math.max(100, window.innerHeight - 150);
    Object.assign(feather.style, {
      position: "fixed",
      left: `${startX}px`,
      top: "-36px",
      width: "38px",
      height: "38px",
      padding: "5px",
      border: "0",
      background: "transparent",
      cursor: "pointer",
      zIndex: "2147482000",
      touchAction: "manipulation",
      filter: "drop-shadow(2px 3px 0 rgba(17, 12, 21, .34))",
    });
    feather.addEventListener("click", () => collectBoosterFeather(speciesId, feather), { once: true });
    document.body.appendChild(feather);
    state.diagnostics.featherBooster = true;

    const startedAt = performance.now();
    const duration = randomBetween(7_000, 11_000);
    const drift = randomBetween(-36, 36);
    const fall = (now) => {
      if (!feather.isConnected) return;
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 2);
      const y = -36 + (landingY + 36) * eased;
      const x = drift * eased + Math.sin(progress * Math.PI * 6) * 10;
      feather.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(Math.sin(progress * Math.PI * 5) * 12).toFixed(1)}deg)`;
      if (progress < 1) {
        window.requestAnimationFrame(fall);
        return;
      }
      window.setTimeout(() => {
        if (!feather.isConnected) return;
        feather.remove();
        scheduleFeatherDrop(false);
      }, 45_000);
    };
    window.requestAnimationFrame(fall);
  }

  function scheduleFeatherDrop(first = false, overrideDelay = 0) {
    if (!isPrismtekHost || featherTimer) return;
    const { common, uncommon } = lockedSpeciesForFeathers();
    if (!common.length && !uncommon.length) return;
    const delay = overrideDelay || (first ? randomBetween(45_000, 90_000) : randomBetween(120_000, 300_000));
    featherTimer = window.setTimeout(spawnBoosterFeather, delay);
  }

  function sanitizeChatMessages(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((message) => message && (message.role === "user" || message.role === "buddy") && typeof message.text === "string")
      .map((message) => ({
        role: message.role,
        text: message.text.trim().slice(0, 2000),
        at: Number.isFinite(message.at) ? message.at : Date.now(),
      }))
      .filter((message) => message.text)
      .slice(-80);
  }

  function readCloudChatHistory(fallbackMessages) {
    const stored = safeJsonParse(window.localStorage.getItem(CHAT_HISTORY_KEY) || "[]", []);
    const history = sanitizeChatMessages(stored);
    return history.length ? history : sanitizeChatMessages(fallbackMessages);
  }

  function saveCloudChatHistory(messages) {
    try {
      window.localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sanitizeChatMessages(messages)));
    } catch (error) {
      console.warn("Pocket Buddy: could not persist website chat history", error);
    }
  }

  function installCloudChatBridge() {
    if (!isPrismtekHost || cloudChatInstalled || !window.PocketBuddy?.brain) return false;
    const brain = window.PocketBuddy.brain;
    if (typeof brain.talk !== "function" || typeof brain.snapshot !== "function") return false;

    const originalTalk = brain.talk.bind(brain);
    const originalSnapshot = brain.snapshot.bind(brain);
    let history = readCloudChatHistory(originalSnapshot()?.brain?.messages || []);

    brain.snapshot = (...args) => {
      const snapshot = originalSnapshot(...args);
      if (!snapshot?.brain) return snapshot;
      return {
        ...snapshot,
        brain: {
          ...snapshot.brain,
          messages: sanitizeChatMessages(history),
        },
      };
    };

    brain.talk = async (message, now = Date.now()) => {
      const input = typeof message === "string" ? message.trim().slice(0, 500) : "";
      if (!input) return { reply: "", snapshot: brain.snapshot(now) };

      const localResult = await originalTalk(input, now);
      history = [...history, { role: "user", text: input, at: now }].slice(-80);
      saveCloudChatHistory(history);

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            mode: "site",
            messages: history.slice(-20).map((entry) => ({
              role: entry.role === "user" ? "user" : "assistant",
              content: entry.text,
            })),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || typeof payload.reply !== "string" || !payload.reply.trim()) {
          throw new Error(typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`);
        }
        const reply = payload.reply.trim().slice(0, 2000);
        history = [...history, { role: "buddy", text: reply, at: Date.now() }].slice(-80);
        saveCloudChatHistory(history);
        return { reply, snapshot: brain.snapshot(Date.now()), transport: payload.transport || "site-ai" };
      } catch (error) {
        console.warn("Pocket Buddy: site AI unavailable, using local Buddy brain", error);
        const reply = typeof localResult?.reply === "string" && localResult.reply.trim()
          ? localResult.reply.trim().slice(0, 2000)
          : "I’m still here — the website AI is offline right now.";
        history = [...history, { role: "buddy", text: reply, at: Date.now() }].slice(-80);
        saveCloudChatHistory(history);
        return { reply, snapshot: brain.snapshot(Date.now()), transport: "local-fallback" };
      }
    };

    cloudChatInstalled = true;
    state.diagnostics.cloudChatBridge = true;
    return true;
  }

  function installCoreBridgeWatcher() {
    if (installCloudChatBridge()) return;
    window.addEventListener("pocket-buddy-core-ready", installCloudChatBridge, { once: true });
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (installCloudChatBridge() || attempts >= 240) window.clearInterval(timer);
    }, 50);
  }

  function installPrismtekWebEnhancements(shadowRoot) {
    if (!isPrismtekHost) return;
    installFieldGuideGuard(shadowRoot);
    installLayoutPerches();
    scheduleFeatherDrop(true);
    installCoreBridgeWatcher();
  }

  function markReady(host) {
    const shadowRoot = host?.shadowRoot;
    if (!shadowRoot) return false;
    hostShadowRoot = shadowRoot;
    applyMobileViewportGuard(shadowRoot);
    installPrismtekWebEnhancements(shadowRoot);
    state.status = "ready";
    window.dispatchEvent(new CustomEvent("pocket-buddy-ready", { detail: { version: state.version } }));
    return true;
  }

  function watchForRuntime() {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      const host = document.getElementById("birb-shadow-host");
      if (markReady(host)) {
        window.clearInterval(timer);
        return;
      }
      if (attempts >= 240) {
        window.clearInterval(timer);
        state.status = "error";
        state.error = "Pocket Bird runtime did not create birb-shadow-host.";
        console.error("Pocket Buddy:", state.error);
      }
    }, 50);
  }

  const existingHost = document.getElementById("birb-shadow-host");
  if (markReady(existingHost)) return;

  const runtimeScript = document.createElement("script");
  runtimeScript.src = runtimeUrl;
  runtimeScript.defer = true;
  runtimeScript.dataset.pocketBuddyRuntime = "true";
  runtimeScript.addEventListener("load", watchForRuntime, { once: true });
  runtimeScript.addEventListener("error", () => {
    state.status = "error";
    state.error = `Failed to load Pocket Buddy runtime from ${runtimeUrl}`;
    console.error("Pocket Buddy:", state.error);
  }, { once: true });
  document.head.appendChild(runtimeScript);
})();
