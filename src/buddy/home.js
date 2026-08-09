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
    webShell?.remove();
    webShell = null;
  }

  async function openWebHome(url, human) {
    if (!shadowRoot) throw new Error("Pocket Buddy web Home could not attach to the page.");
    closeWebHome();

    const shell = document.createElement("div");
    shell.className = "pb-web-home-shell";
    shell.style.cssText = "position:fixed;inset:8px;z-index:2147483646;background:#0e0f13;border:3px solid var(--birb-border-color);box-shadow:6px 6px 0 var(--birb-border-color);pointer-events:auto;overflow:hidden;";

    const frame = document.createElement("iframe");
    frame.className = "pb-web-home-frame";
    frame.title = "Pocket Buddy Home";
    frame.src = url;
    frame.allow = "clipboard-write";
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#0e0f13;";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "LEAVE HOME";
    closeButton.setAttribute("aria-label", "Leave Pocket Buddy Home");
    closeButton.style.cssText = "position:absolute;right:10px;top:10px;z-index:5;font:10px Monocraft,monospace;border:2px solid var(--birb-border-color);background:var(--birb-background-color);color:#2d2634;padding:6px 8px;box-shadow:3px 3px 0 var(--birb-border-color);";
    closeButton.onclick = () => close();

    shell.append(frame, closeButton);
    shadowRoot.append(shell);
    webShell = shell;
    openState = true;
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
        const active = petRuntime.activePack();
        const petSha256 = cleanHash(active?.archiveSha256);
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
        lastError = "";
        shadowRoot?.querySelector(".pb-home-launch-error")?.remove();
        return result;
      }

      const webUrl = configuredWebHomeUrl();
      if (webUrl) return openWebHome(webUrl, human);

      throw new Error("This host has not configured the canonical Pocket Buddy Home runtime. No substitute room will be rendered.");
    } catch (error) {
      openState = false;
      showError(error instanceof Error ? error.message : String(error));
      console.error("Pocket Buddy canonical Home failed to open", error);
      return { ok: false, error: lastError };
    }
  }

  function close() {
    window.PocketBuddyDesktop?.closeHome?.();
    closeWebHome();
    openState = false;
    onClose();
  }

  return {
    open,
    close,
    isOpen: () => openState,
    lastError: () => lastError,
    async reloadHuman() {},
  };
}
