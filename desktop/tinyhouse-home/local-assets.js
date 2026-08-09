(() => {
  "use strict";

  const manifest = window.TINYHOUSE_MANIFEST;
  const recipes = window.TINYHOUSE_GENERATED_RECIPES || {};
  if (!manifest || !Array.isArray(manifest.assets)) {
    throw new Error("TinyHouse metadata manifest is missing");
  }

  let resolveReady;
  window.TINYHOUSE_ASSETS_READY = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const manifestPaths = [...new Set(manifest.assets.flatMap((asset) => [
    asset.path,
    ...(Array.isArray(asset.frames) ? asset.frames : []),
  ]).filter(Boolean).map(stripManifestPrefix))];
  const originalPaths = new Set(manifestPaths.filter((path) => !path.startsWith(".generated/")));
  for (const recipe of Object.values(recipes)) {
    if (recipe.type === "compose") {
      originalPaths.add(normalizePath(recipe.base));
      for (const overlay of recipe.overlays || []) originalPaths.add(normalizePath(overlay));
    } else if (recipe.type === "slice") {
      originalPaths.add(normalizePath(recipe.source));
    }
  }

  // Optional developer path: ?pack=<base-url> loads the pack over HTTP from a
  // local server (see serve-local.mjs) instead of prompting for the folder on
  // every reload. The folder picker below stays the default, and the licence
  // position is unchanged either way - the files are read from wherever the
  // user keeps them and are never copied into this repository.
  const packBase = new URLSearchParams(location.search).get("pack");
  if (packBase) {
    attachFromBaseUrl(packBase)
      .then(() => resolveReady())
      .catch((error) => {
        console.error("TinyHouse pack load failed", error);
        document.body.insertAdjacentHTML("afterbegin",
          `<pre id="pack-load-error" style="padding:1rem;color:#b00">TinyHouse pack failed to load from ${packBase}\n${String(error && error.message || error)}</pre>`);
      });
    return;
  }

  const overlay = document.createElement("section");
  overlay.id = "local-asset-gate";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "asset-gate-title");
  overlay.innerHTML = `
    <div class="asset-gate-card">
      <div class="asset-gate-kicker">POCKET BUDDY+ LOCAL ASSET MODE</div>
      <h1 id="asset-gate-title">Load your TinyHouse pack</h1>
      <p>This game uses your purchased Pixel Salvaje files directly from your computer. The files are never uploaded or copied into this repository.</p>
      <ol>
        <li>Unzip <code>TinyHouse_0.17(@Pixel_Salvaje).zip</code>.</li>
        <li>Select the extracted TinyHouse folder below.</li>
        <li>Build immediately. Your room saves in this browser.</li>
      </ol>
      <label class="asset-folder-button">
        SELECT EXTRACTED FOLDER
        <input id="tinyhouse-folder" type="file" webkitdirectory directory multiple accept="image/png,image/gif" />
      </label>
      <div id="asset-gate-status" aria-live="polite">Waiting for the 0.17 asset folder…</div>
      <details>
        <summary>Why select the folder?</summary>
        <p>The asset license permits using the art in a project but does not permit redistributing the source asset pack. This loader keeps the public game code separate from your private purchased files.</p>
      </details>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector("#tinyhouse-folder");
  const status = overlay.querySelector("#asset-gate-status");
  input.addEventListener("change", async () => {
    try {
      input.disabled = true;
      status.textContent = `Indexing ${input.files.length.toLocaleString()} files…`;
      await attachFiles([...input.files]);
      status.textContent = `${manifest.count.toLocaleString()} placeable objects ready.`;
      overlay.classList.add("loaded");
      setTimeout(() => overlay.remove(), 220);
      resolveReady();
    } catch (error) {
      console.error("[tinyhouse/local-assets]", error);
      input.disabled = false;
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  async function attachFromBaseUrl(base) {
    const root = base.endsWith("/") ? base : `${base}/`;
    const urlByPath = new Map();
    const missing = [];
    for (const required of originalPaths) {
      const path = normalizePath(required);
      const response = await fetch(root + path.split("/").map(encodeURIComponent).join("/"));
      if (!response.ok) { missing.push(path); continue; }
      urlByPath.set(path, URL.createObjectURL(await response.blob()));
    }
    if (missing.length) {
      throw new Error(`${missing.length} required PNGs are missing under ${root} (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", …" : ""}).`);
    }
    for (const [generatedPath, recipe] of Object.entries(recipes)) {
      urlByPath.set(normalizePath(generatedPath), await renderRecipe(recipe, urlByPath));
    }
    for (const asset of manifest.assets) {
      const path = stripManifestPrefix(asset.path);
      asset.dataUrl = urlByPath.get(path);
      if (Array.isArray(asset.frames)) {
        asset.frameDataUrls = asset.frames.map((frame) => urlByPath.get(stripManifestPrefix(frame)));
      }
    }
    window.addEventListener("pagehide", () => {
      for (const url of urlByPath.values()) URL.revokeObjectURL(url);
    }, { once: true });
  }

  async function attachFiles(files) {
    if (!files.length) throw new Error("No files selected.");
    const suffixes = buildSuffixIndex(files);
    const fileForPath = new Map();
    const missing = [];

    for (const required of originalPaths) {
      const normalizedRequired = normalizePath(required);
      const file = suffixes.get(normalizedRequired.toLowerCase());
      if (file) fileForPath.set(normalizedRequired, file);
      else missing.push(normalizedRequired);
    }

    if (missing.length) {
      const sample = missing.slice(0, 4).join(", ");
      throw new Error(`Wrong or incomplete folder: ${missing.length} required PNGs are missing (${sample}${missing.length > 4 ? ", …" : ""}).`);
    }

    const urlByPath = new Map();
    for (const [path, file] of fileForPath) urlByPath.set(path, URL.createObjectURL(file));
    for (const [generatedPath, recipe] of Object.entries(recipes)) {
      urlByPath.set(normalizePath(generatedPath), await renderRecipe(recipe, urlByPath));
    }

    for (const asset of manifest.assets) {
      const path = stripManifestPrefix(asset.path);
      asset.dataUrl = urlByPath.get(path);
      if (Array.isArray(asset.frames)) {
        asset.frameDataUrls = asset.frames.map((frame) => urlByPath.get(stripManifestPrefix(frame)));
      }
    }

    window.addEventListener("pagehide", () => {
      for (const url of urlByPath.values()) URL.revokeObjectURL(url);
    }, { once: true });
  }

  async function renderRecipe(recipe, urls) {
    if (recipe.type === "compose") {
      const base = await loadImage(urls.get(normalizePath(recipe.base)));
      const canvas = document.createElement("canvas");
      canvas.width = base.naturalWidth;
      canvas.height = base.naturalHeight;
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.drawImage(base, 0, 0);
      for (const overlayPath of recipe.overlays || []) {
        const layer = await loadImage(urls.get(normalizePath(overlayPath)));
        context.drawImage(layer, 0, 0);
      }
      return canvasUrl(canvas);
    }
    if (recipe.type === "slice") {
      const sheet = await loadImage(urls.get(normalizePath(recipe.source)));
      const canvas = document.createElement("canvas");
      canvas.width = recipe.width;
      canvas.height = recipe.height;
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = false;
      context.drawImage(sheet, recipe.x, recipe.y, recipe.width, recipe.height, 0, 0, recipe.width, recipe.height);
      return canvasUrl(canvas);
    }
    throw new Error(`Unknown generated-frame recipe: ${recipe.type}`);
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not decode local asset: ${url}`));
      image.src = url;
    });
  }

  function canvasUrl(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Could not render generated animation frame")), "image/png");
    });
  }

  function buildSuffixIndex(files) {
    const index = new Map();
    for (const file of files) {
      const raw = normalizePath(file.webkitRelativePath || file.name);
      const segments = raw.split("/").filter(Boolean);
      for (let start = 0; start < segments.length; start += 1) {
        const suffix = segments.slice(start).join("/").toLowerCase();
        if (!index.has(suffix)) index.set(suffix, file);
      }
    }
    return index;
  }

  function stripManifestPrefix(path) {
    return normalizePath(path).replace(/^assets\/tinyhouse\//i, "");
  }

  function normalizePath(path) {
    return String(path || "")
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join("/");
  }
})();
