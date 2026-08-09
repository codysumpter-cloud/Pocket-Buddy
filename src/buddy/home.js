const SHA256_RE = /^[0-9a-f]{64}$/;

function cleanHash(value) {
  const hash = String(value ?? "").toLowerCase();
  return SHA256_RE.test(hash) ? hash : "";
}

function configuredWebHomeUrl() {
  const raw = typeof window.POCKET_BUDDY_WEB_HOME_URL === "string" ? window.POCKET_BUDDY_WEB_HOME_URL.trim() : "";
  if (!raw) return null;
  const url = new URL(raw, window.location.href);
  if (url.origin !== window.location.origin) throw new Error("Pocket Buddy web Home must be hosted on the same origin as Pocket Buddy.");
  return url.href;
}

export function createHome({ brain, petRuntime, petLibrary, shadowRoot, onClose = () => {} }) {
  let openState = false;
  let lastError = "";
  let webShell = null;
  let webEscapeHandler = null;

  function setHomePresence(active) {
    petRuntime.setHomeActive?.(Boolean(active));
  }

  function finishClose() {
    closeWebHome();
    const wasOpen = openState;
    openState = false;
    setHomePresence(false);
    if (wasOpen) onClose();
  }

  const removeDesktopClosedListener = window.PocketBuddyDesktop?.onHomeClosed?.(() => finishClose()) ?? (() => {});
  void removeDesktopClosedListener;

  function showError(message) {
    lastError = String(message || "Home could not open.");
    shadowRoot?.querySelector(".pb-home-launch-error")?.remove();
    if (!shadowRoot) return;
    const panel = document.createElement("div");
    panel.className = "pb-home-launch-error";
    panel.style.cssText = "position:fixed;left:12px;top:12px;z-index:2147483647;max-width:420px;padding:9px;border:3px solid var(--birb-border-color);background:var(--birb-background-color);box-shadow:5px 5px 0 var(--birb-border-color);font:12px Monocraft,monospace;color:#2d2634;pointer-events:auto;";
    const title = document.createElement("strong");
    title.textContent = "Pocket Buddy Home";
    const detail = document.createElement("div");
    detail.style.marginTop = "5px";
    detail.textContent = lastError;
    const closeButton = document.createElement("button");
    closeButton.textContent = "OK";
    closeButton.style.cssText = "margin-top:7px;font:inherit;border:2px solid var(--birb-border-color);background:var(--birb-background-color);padding:4px 8px;";
    closeButton.onclick = () => panel.remove();
    panel.append(title, detail, closeButton);
    shadowRoot.append(panel);
  }

  async function homeHumanPack() {
    const id = await petLibrary.homeHumanId();
    if (!id) return null;
    return (await petLibrary.listInstalled()).find((pack) => pack.id === id) ?? null;
  }

  function closeWebHome() {
    if (webEscapeHandler) window.removeEventListener("keydown", webEscapeHandler, true);
    webEscapeHandler = null;
    webShell?.remove();
    webShell = null;
  }

  async function openWebHome(url, human) {
    if (!shadowRoot) throw new Error("Pocket Buddy web Home could not attach to the page.");
    closeWebHome();

    const shell = document.createElement("div");
    shell.className = "pb-web-home-shell";
    shell.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0e0f13;pointer-events:auto;overflow:hidden;isolation:isolate;";

    const frame = document.createElement("iframe");
    frame.className = "pb-web-home-frame";
    frame.title = "Pocket Buddy Home";
    frame.src = url;
    frame.allow = "clipboard-write";
    frame.style.cssText = "position:absolute;inset:0;display:block;width:100%;height:100%;border:0;background:#0e0f13;z-index:1;";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "← LEAVE HOME";
    closeButton.setAttribute("aria-label", "Leave Pocket Buddy Home");
    closeButton.title = "Leave Home (Esc)";
    closeButton.style.cssText = "position:absolute;right:12px;top:12px;z-index:2147483647;font:11px Monocraft,monospace;border:3px solid var(--birb-border-color);background:var(--birb-background-color);color:#2d2634;padding:8px 10px;box-shadow:4px 4px 0 var(--birb-border-color);cursor:pointer;pointer-events:auto;";
    closeButton.onclick = () => close();

    const escapeHint = document.createElement("div");
    escapeHint.textContent = "ESC";
    escapeHint.setAttribute("aria-hidden", "true");
    escapeHint.style.cssText = "position:absolute;right:132px;top:16px;z-index:2147483647;font:9px Monocraft,monospace;background:rgba(14,15,19,.78);color:#fff;padding:5px 6px;border:1px solid rgba(255,255,255,.55);pointer-events:none;";

    webEscapeHandler = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", webEscapeHandler, true);

    shell.append(frame, closeButton, escapeHint);
    shadowRoot.append(shell);
    webShell = shell;
    openState = true;
    setHomePresence(true);
    lastError = "";
    shadowRoot.querySelector(".pb-home-launch-error")?.remove();

    return {
      ok: true,
      mode: "web",
      url,
      human: human.displayName,
      donor: "6e4a80775f8a7f5b0d243b0a9f50e6653526219b",
    };
  }

  async function open() {
    try {
      const human = await homeHumanPack();
      const humanSha256 = cleanHash(human?.archiveSha256);
      if (!humanSha256) {
        throw new Error("Home requires the exact verified Ani Iso Human pack. No substitute player will be rendered.");
      }

      const bridge = window.PocketBuddyDesktop;
      if (bridge?.openHome) {
        const active = await petLibrary.loadRuntime(await petLibrary.activeId());
        const petSha256 = cleanHash(active?.pack?.archiveSha256);
        const result = await bridge.openHome({
          humanSha256,
          petSha256,
          petScale: petRuntime.scaleMultiplier(),
          uiScale: petRuntime.uiScaleMultiplier(),
          humanScale: 1.2,
          buddyName: brain.snapshot().displayName,
        });
        if (!result?.ok) throw new Error(result?.error || "Canonical Home did not open.");
        openState = true;
        setHomePresence(true);
        lastError = "";
        shadowRoot?.querySelector(".pb-home-launch-error")?.remove();
        return result;
      }

      const webUrl = configuredWebHomeUrl();
      if (webUrl) return openWebHome(webUrl, human);

      throw new Error("This host has not configured the canonical Pocket Buddy Home runtime. No substitute room will be rendered.");
    } catch (error) {
      openState = false;
      setHomePresence(false);
      showError(error instanceof Error ? error.message : String(error));
      console.error("Pocket Buddy canonical Home failed to open", error);
      return { ok: false, error: lastError };
    }
  }

  function close() {
    window.PocketBuddyDesktop?.closeHome?.();
    finishClose();
  }

  return {
    open,
    close,
    isOpen: () => openState,
    lastError: () => lastError,
    async reloadHuman() {},
  };
}
