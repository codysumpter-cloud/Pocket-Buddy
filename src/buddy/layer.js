import { createBuddyStorage } from "./storage.js";
import { createBuddyBrain } from "./brain.js";
import { createPetLibrary } from "./pet-importer.js";
import { createPetRuntime } from "./pet-runtime.js";
import { createHome } from "./home.js";
import { createThemeController } from "./theme.js";
import { OPENPETS_GALLERY_URL } from "./pet-recipes.js";

const POCKET_BUDDY_VERSION = "__POCKET_BUDDY_VERSION__";
const OPENPETS_CATALOG_V3 = "https://openpets.dev/pets/catalog.v3.json";
const OPENPETS_BASE = "https://openpets.dev/pets/";
const OPENPETS_VISIBLE_STEP = 80;

let catalogCache = null;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeOpenPetsUrl(value, base = OPENPETS_BASE) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "openpets.dev" && !url.hostname.endsWith(".openpets.dev")) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeCatalogEntry(value) {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.displayName !== "string") return null;
  const id = value.id.trim().slice(0, 80);
  const displayName = value.displayName.trim().slice(0, 120);
  if (!id || !displayName) return null;
  const zip = safeOpenPetsUrl(value.zip ?? value.downloadUrl ?? value.packageUrl, OPENPETS_BASE);
  return {
    ...value,
    id,
    displayName,
    description: typeof value.description === "string" ? value.description.trim().slice(0, 500) : "",
    ...(zip ? { zip } : {}),
  };
}

async function openPetsCatalog() {
  if (catalogCache) return catalogCache;
  try {
    const first = await fetch(OPENPETS_CATALOG_V3, { credentials: "omit", cache: "force-cache" });
    if (!first.ok) throw new Error(`catalog ${first.status}`);
    const index = await first.json();
    const all = [];
    const seen = new Set();
    const add = (entry) => {
      const pet = normalizeCatalogEntry(entry);
      if (!pet || seen.has(pet.id)) return;
      seen.add(pet.id);
      all.push(pet);
    };
    (Array.isArray(index?.pets) ? index.pets : Array.isArray(index?.items) ? index.items : []).forEach(add);
    for (const page of Array.isArray(index?.pages) ? index.pages : []) {
      const raw = typeof page === "string" ? page : typeof page?.url === "string" ? page.url : null;
      const url = safeOpenPetsUrl(raw, OPENPETS_BASE);
      if (!url) continue;
      const response = await fetch(url, { credentials: "omit", cache: "force-cache" });
      if (!response.ok) continue;
      const data = await response.json();
      const entries = Array.isArray(data) ? data : Array.isArray(data?.pets) ? data.pets : Array.isArray(data?.items) ? data.items : [];
      entries.forEach(add);
    }
    catalogCache = all;
    return all;
  } catch (error) {
    console.warn("Pocket Buddy: OpenPets catalog unavailable on this host", error);
    return [];
  }
}

const waitRoot = () => new Promise((resolve, reject) => {
  let attempts = 0;
  const timer = setInterval(() => {
    const host = document.getElementById("birb-shadow-host");
    if (host?.shadowRoot) {
      clearInterval(timer);
      resolve(host.shadowRoot);
    } else if (++attempts > 240) {
      clearInterval(timer);
      reject(new Error("Pocket Bird runtime did not create its shadow root."));
    }
  }, 50);
});

const btn = (label, action, className = "") => {
  const button = document.createElement("button");
  button.textContent = label;
  button.className = className;
  button.onclick = action;
  return button;
};

function closeBaseMenu(root) {
  root.getElementById("birb-menu")?.remove();
  root.getElementById("birb-menu-exit")?.remove();
}

function windowBox(root, id, title) {
  root.getElementById(id)?.remove();
  const windowElement = document.createElement("div");
  windowElement.id = id;
  windowElement.className = "birb-window pb-window";
  const header = document.createElement("div");
  header.className = "birb-window-header";
  const titleElement = document.createElement("div");
  titleElement.className = "birb-window-title";
  titleElement.textContent = title;
  const close = document.createElement("div");
  close.className = "birb-window-close";
  close.textContent = "x";
  close.onclick = () => windowElement.remove();
  header.append(titleElement, close);
  const content = document.createElement("div");
  content.className = "birb-window-content pb-content";
  windowElement.append(header, content);
  root.append(windowElement);
  windowElement.style.left = `${Math.max(8, innerWidth / 2 - windowElement.offsetWidth / 2)}px`;
  windowElement.style.top = `${Math.max(8, innerHeight / 2 - windowElement.offsetHeight / 2)}px`;
  return { w: windowElement, c: content };
}

function toast(root, text) {
  root.querySelector(".pb-toast")?.remove();
  const element = document.createElement("div");
  element.className = "pb-toast";
  element.textContent = String(text).slice(0, 220);
  root.append(element);
  setTimeout(() => element.remove(), 2200);
}

function styles(root) {
  if (root.getElementById("pb-layer-style")) return;
  const style = document.createElement("style");
  style.id = "pb-layer-style";
  style.textContent = `
    .pb-window{width:min(420px,calc(100vw - 24px));max-height:min(620px,calc(100vh - 24px))}
    .pb-content{padding:8px;gap:7px;overflow:auto;align-items:stretch}
    .pb-menu-item{width:calc(100% - 4px)}
    .pb-row{display:flex;gap:6px;flex-wrap:wrap}
    .pb-row button,.pb-content button,.pb-content input{font:inherit;border:2px solid var(--birb-border-color);background:var(--birb-background-color);padding:5px;color:#222}
    .pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:7px;width:100%}
    .pb-card{position:relative;border:2px solid var(--birb-highlight);background:color-mix(in srgb,var(--birb-highlight) 18%,var(--birb-background-color));padding:6px;min-height:75px;cursor:pointer;box-sizing:border-box}
    .pb-card:hover,.pb-card.active{outline:2px solid var(--birb-border-color);outline-offset:1px}
    .pb-card.locked{opacity:.55;filter:grayscale(1);cursor:default}
    .pb-card.selected{outline:2px solid var(--birb-border-color);outline-offset:1px}
    .pb-small{font-size:10px;opacity:.72}
    .pb-bar{height:8px;border:1px solid var(--birb-border-color);background:color-mix(in srgb,var(--birb-background-color) 75%,#777)}
    .pb-bar>i{display:block;height:100%;background:var(--birb-highlight)}
    .pb-chat{height:220px;overflow:auto;border:2px solid var(--birb-highlight);background:var(--birb-background-color);padding:6px}
    .pb-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:2147483647;background:var(--birb-background-color);border:2px solid var(--birb-border-color);padding:6px;box-shadow:4px 4px 0 var(--birb-border-color);font:12px Monocraft,monospace}
    .pb-guide-tabs{display:flex;gap:4px;padding:6px 8px;position:sticky;top:0;z-index:3;background:var(--birb-background-color)}
    .pb-guide-tabs button{flex:1;font:10px Monocraft,monospace;border:2px solid var(--birb-highlight);background:var(--birb-background-color);padding:5px 3px;color:#222;cursor:pointer}
    .pb-guide-tabs button.active{background:var(--birb-highlight);color:#fff}
    .pb-guide-panel{width:100%;box-sizing:border-box}
    .pb-guide-panel[hidden]{display:none!important}
    .pb-guide-tools{display:flex;gap:6px;padding:7px 9px;flex-wrap:wrap}
    .pb-guide-tools input{min-width:0;flex:1 1 190px;font:10px Monocraft,monospace;border:2px solid var(--birb-highlight);background:var(--birb-background-color);padding:5px;color:#222}
    .pb-guide-tools button{font:10px Monocraft,monospace;border:2px solid var(--birb-highlight);background:var(--birb-background-color);padding:5px;color:#222;cursor:pointer}
    .pb-guide-status{padding:2px 9px 6px;font:9px Monocraft,monospace;opacity:.68}
    .pb-guide-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:6px;padding:4px 9px 12px}
    .pb-menu-separator{height:2px;margin:3px 6px;background:var(--birb-highlight);opacity:.45}
    .pb-theme-swatch{height:24px;border:1px solid var(--birb-border-color);margin-bottom:5px;display:flex;overflow:hidden}
    .pb-theme-swatch>i{display:block;flex:1}
    #birb-field-guide.pb-field-guide{width:min(650px,94vw)}
  `;
  root.append(style);
}

function importButton(root, library, after) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,application/zip";
  input.hidden = true;
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const pack = await library.importFile(file);
      toast(root, `${pack.displayName} imported`);
      await after(pack);
    } catch (error) {
      toast(root, error?.message || "Import failed");
    } finally {
      input.value = "";
    }
  };
  root.append(input);
  return btn("Import pet ZIP", () => input.click());
}

function menuItem(label, action) {
  const element = document.createElement("div");
  element.className = "birb-menu-item pb-menu-item";
  element.textContent = label;
  element.onclick = action;
  return element;
}

function menuSeparator() {
  const element = document.createElement("div");
  element.className = "birb-window-separator pb-menu-separator";
  return element;
}

function isSettingsMenu(menu) {
  if (menu.dataset.pocketBuddySubmenu) return false;
  const first = menu.querySelector(".birb-window-content > .birb-menu-item");
  return first?.textContent?.trim() === "Go Back";
}

function card(name, description, action, { active = false, locked = false } = {}) {
  const element = document.createElement("div");
  element.className = `pb-card${active ? " active" : ""}${locked ? " locked" : ""}`;
  const title = document.createElement("b");
  title.textContent = name;
  const detail = document.createElement("div");
  detail.className = "pb-small";
  detail.textContent = description;
  element.append(title, detail);
  if (action && !locked) element.onclick = action;
  return element;
}

export async function initializeBuddyLayer() {
  if (window.PocketBuddy?.coreVersion) return window.PocketBuddy;

  const root = await waitRoot();
  styles(root);
  const storage = createBuddyStorage();
  const library = createPetLibrary(storage);
  let runtime;
  const brain = createBuddyBrain(storage, { onReaction: (reaction) => runtime?.react(reaction) });
  await brain.load();
  runtime = createPetRuntime(library, root);
  await runtime.start();
  const home = createHome({ storage, brain, petRuntime: runtime, petLibrary: library, shadowRoot: root });
  const themes = createThemeController({ storage, root, library });
  await themes.start();

  async function care(action) {
    const result = await brain.care(action);
    if (action === "feed") runtime.react("eating", 1400);
    toast(root, result.message);
    return result;
  }

  function showCare() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-care", "Care");
    const snap = brain.snapshot();
    for (const [key, label] of [["hunger", "Food"], ["energy", "Energy"], ["happiness", "Fun"], ["affection", "Bond"], ["health", "Health"]]) {
      const row = document.createElement("div");
      row.textContent = `${label} ${Math.round(snap.lifecycle[key])}`;
      const bar = document.createElement("div");
      bar.className = "pb-bar";
      bar.innerHTML = `<i style="width:${Math.round(snap.lifecycle[key])}%"></i>`;
      c.append(row, bar);
    }
    const actions = document.createElement("div");
    actions.className = "pb-row";
    for (const [action, label] of [["feed", "Feed"], ["play", "Play"], ["pet", "Pet"], ["nap", "Nap"], ["clean", "Clean"], ["medicine", "Medicine"]]) {
      actions.append(btn(label, () => care(action).then(showCare)));
    }
    c.append(actions);
  }

  function showStatus() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-brain", "Buddy");
    const snapshot = brain.snapshot();
    const title = document.createElement("b");
    title.textContent = snapshot.displayName;
    const meta = document.createElement("div");
    meta.className = "pb-small";
    meta.textContent = `${snapshot.stage} • level ${snapshot.level} • ${snapshot.mood}`;
    const explanation = document.createElement("div");
    explanation.textContent = "Personality, relationship memory, stats, notes, and care history belong to this Buddy everywhere Pocket Buddy runs.";
    const relationship = document.createElement("div");
    relationship.className = "pb-small";
    relationship.textContent = `Trust ${Math.round(snapshot.brain.relationship.trust * 100)} • Familiarity ${Math.round(snapshot.brain.relationship.familiarity * 100)} • Notes ${snapshot.brain.notes.length}`;
    const name = document.createElement("input");
    name.value = snapshot.displayName;
    name.maxLength = 64;
    const note = document.createElement("input");
    note.placeholder = "Remember a note…";
    c.append(
      title,
      meta,
      explanation,
      relationship,
      name,
      btn("Rename", () => brain.rename(name.value).then(() => toast(root, "Buddy renamed"))),
      note,
      btn("Remember", () => brain.addNote(note.value).then(() => {
        note.value = "";
        toast(root, "Remembered");
      })),
    );
  }

  function showTalk() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-talk", `Talk to ${brain.snapshot().displayName}`);
    const log = document.createElement("div");
    log.className = "pb-chat";
    for (const message of brain.snapshot().brain.messages.slice(-20)) {
      const line = document.createElement("div");
      line.textContent = `${message.role === "user" ? "You" : "Buddy"}: ${message.text}`;
      log.append(line);
    }
    const row = document.createElement("div");
    row.className = "pb-row";
    const input = document.createElement("input");
    input.placeholder = "Say something…";
    input.style.flex = "1";
    const send = btn("Send", async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      await brain.talk(text);
      showTalk();
    });
    input.onkeydown = (event) => {
      if (event.key === "Enter") send.click();
    };
    row.append(input, send);
    c.append(log, row);
    setTimeout(() => input.focus(), 0);
  }

  function showThemes() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-themes", "UI Theme");
    const intro = document.createElement("div");
    intro.className = "pb-small";
    intro.textContent = "Auto keeps the classic Pocket Bird behavior: the UI follows your selected bird or Buddy. Pick a theme here to override it everywhere.";
    const grid = document.createElement("div");
    grid.className = "pb-grid";
    const selected = themes.snapshot().id;
    for (const theme of themes.themes()) {
      const themeCard = document.createElement("div");
      themeCard.className = `pb-card${selected === theme.id ? " selected" : ""}`;
      if (theme.id === "auto") {
        themeCard.innerHTML = `<b>${theme.label}</b><div class="pb-small">${theme.description}</div>`;
      } else {
        const swatch = document.createElement("div");
        swatch.className = "pb-theme-swatch";
        swatch.innerHTML = `<i style="background:${theme.accent}"></i><i style="background:${theme.background}"></i>`;
        const label = document.createElement("b");
        label.textContent = theme.label;
        themeCard.append(swatch, label);
      }
      themeCard.onclick = async () => {
        await themes.set(theme.id);
        toast(root, theme.id === "auto" ? "Theme follows Buddy" : `${theme.label} theme active`);
        showThemes();
      };
      grid.append(themeCard);
    }
    c.append(intro, grid);
  }

  async function selectPet(id) {
    await library.setActive(id);
    await runtime.select(id);
    await storage.setJson("chillActor", "pet");
    const pack = id === "pocket-bird" ? null : (await library.listInstalled()).find((item) => item.id === id) ?? null;
    await themes.setActiveBuddy(id, pack);
    toast(root, id === "pocket-bird" ? "Pocket Buddy pet active" : `${pack?.displayName ?? "Buddy"} active`);
  }

  async function setChillActor(kind) {
    if (kind === "human") {
      const humanId = await library.homeHumanId();
      if (!humanId) {
        toast(root, "Import or install a PixelLab human first.");
        return false;
      }
      await runtime.select(humanId);
      await storage.setJson("chillActor", "human");
      toast(root, "Human is chilling on the desktop");
      return true;
    }
    await runtime.select(await library.activeId());
    await storage.setJson("chillActor", "pet");
    toast(root, "Pet is chilling on the desktop");
    return true;
  }

  async function restoreChillActor() {
    const preferred = await storage.getJson("chillActor", "pet");
    if (preferred === "human" && await library.homeHumanId()) return setChillActor("human");
    return setChillActor("pet");
  }

  function showChill() {
    closeBaseMenu(root);
    const { c } = windowBox(root, "pb-chill", "Chill Mode");
    const intro = document.createElement("div");
    intro.textContent = "Choose who hangs out on your desktop. Home still uses the human as your player and your selected pet as their companion.";
    const row = document.createElement("div");
    row.className = "pb-row";
    row.append(
      btn("Human", () => setChillActor("human").then(() => root.getElementById("pb-chill")?.remove())),
      btn("Pet", () => setChillActor("pet").then(() => root.getElementById("pb-chill")?.remove())),
      btn("Go Home", () => { root.getElementById("pb-chill")?.remove(); void home.open(); }),
    );
    c.append(intro, row);
  }

  async function installCatalogPet(entry, refresh) {
    if (!entry.zip) {
      toast(root, "This catalog entry has no package URL. Download it from OpenPets and use Import pet ZIP.");
      return;
    }
    try {
      const response = await fetch(entry.zip, { credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error(`download ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], `${entry.id}.zip`, { type: "application/zip" });
      const pack = await library.importFile(file);
      await selectPet(pack.id);
      toast(root, `${pack.displayName} installed`);
      await refresh?.();
    } catch (error) {
      console.warn("Pocket Buddy: direct OpenPets install failed", error);
      toast(root, "Direct install was blocked. Download the ZIP and use My Pets → Import pet ZIP.");
    }
  }

  async function renderMyPets(panel) {
    panel.textContent = "";
    const tools = document.createElement("div");
    tools.className = "pb-guide-tools";
    const status = document.createElement("div");
    status.className = "pb-guide-status";
    const grid = document.createElement("div");
    grid.className = "pb-guide-grid";

    const installed = await library.listInstalled();
    const activeId = await library.activeId();
    const humanId = await library.homeHumanId();

    tools.append(importButton(root, library, async (pack) => {
      if (pack.kind === "human") {
        await library.setHomeHuman(pack.id);
        await home.reloadHuman();
        toast(root, `${pack.displayName} is now the Home player`);
      } else {
        await selectPet(pack.id);
      }
      await renderMyPets(panel);
    }));
    status.textContent = installed.length
      ? `${installed.filter((pack) => pack.kind !== "human").length} Buddy pet${installed.filter((pack) => pack.kind !== "human").length === 1 ? "" : "s"} installed${humanId ? " • Home human installed" : ""}.`
      : "No imported pets yet. Import a PixelLab or OpenPets ZIP.";

    for (const pack of installed) {
      if (pack.kind === "human") {
        grid.append(card(
          pack.displayName,
          `${pack.source} • ${pack.id === humanId ? "HOME PLAYER" : "tap to use as Home player"}`,
          async () => {
            await library.setHomeHuman(pack.id);
            await home.reloadHuman();
            toast(root, `${pack.displayName} is now the Home player`);
            await renderMyPets(panel);
          },
          { active: pack.id === humanId },
        ));
      } else {
        grid.append(card(
          pack.displayName,
          `${pack.source}${pack.id === activeId ? " • ACTIVE" : " • tap to use"}`,
          async () => {
            await selectPet(pack.id);
            await renderMyPets(panel);
          },
          { active: pack.id === activeId },
        ));
      }
    }
    panel.append(tools, status, grid);
  }

  async function renderOpenPets(panel) {
    panel.textContent = "";
    const tools = document.createElement("div");
    tools.className = "pb-guide-tools";
    const search = document.createElement("input");
    search.placeholder = "Search every OpenPets pet…";
    const website = btn("OpenPets website", () => window.open(OPENPETS_GALLERY_URL, "_blank", "noopener"));
    tools.append(search, website);
    const status = document.createElement("div");
    status.className = "pb-guide-status";
    status.textContent = "Loading the complete OpenPets catalog…";
    const grid = document.createElement("div");
    grid.className = "pb-guide-grid";
    const more = btn("Show more", () => {});
    more.style.margin = "0 9px 12px";
    panel.append(tools, status, grid, more);

    const pets = await openPetsCatalog();
    const installed = await library.listInstalled();
    const installedById = new Map(installed.map((pack) => [pack.id, pack]));
    let visible = OPENPETS_VISIBLE_STEP;

    const render = async () => {
      const query = search.value.trim().toLowerCase();
      const matches = pets.filter((pet) => !query || `${pet.displayName} ${pet.id} ${pet.description}`.toLowerCase().includes(query));
      const activeId = await library.activeId();
      grid.textContent = "";
      for (const pet of matches.slice(0, visible)) {
        const installedPack = installedById.get(pet.id);
        grid.append(card(
          pet.displayName,
          installedPack
            ? `${installedPack.source}${pet.id === activeId ? " • ACTIVE" : " • installed"}`
            : `${pet.description || pet.id}${pet.zip ? " • tap to install" : " • download ZIP to import"}`,
          installedPack
            ? async () => {
                await selectPet(installedPack.id);
                await render();
              }
            : () => installCatalogPet(pet, async () => {
                const refreshed = await library.listInstalled();
                installedById.clear();
                for (const pack of refreshed) installedById.set(pack.id, pack);
                await render();
              }),
          { active: Boolean(installedPack && pet.id === activeId) },
        ));
      }
      status.textContent = pets.length
        ? `${pets.length} OpenPets pets in the Field Guide${query ? ` • ${matches.length} match` : ""}.`
        : "This host blocked the OpenPets catalog. My Pets can still import any OpenPets ZIP locally.";
      more.hidden = matches.length <= visible;
    };

    search.oninput = () => {
      visible = OPENPETS_VISIBLE_STEP;
      void render();
    };
    more.onclick = () => {
      visible += OPENPETS_VISIBLE_STEP;
      void render();
    };
    await render();
  }

  function augmentFieldGuide(guide) {
    if (guide.dataset.pocketBuddy) return;
    const content = guide.querySelector(".birb-window-content");
    const original = content?.firstElementChild;
    if (!content || !original) return;
    guide.dataset.pocketBuddy = "1";
    guide.classList.add("pb-field-guide");

    const tabs = document.createElement("div");
    tabs.className = "pb-guide-tabs";
    const pocketTab = btn("Pocket Buddy", () => activate("pocket"));
    const myTab = btn("My Pets", () => activate("mine"));
    const openTab = btn("OpenPets", () => activate("openpets"));
    tabs.append(pocketTab, myTab, openTab);

    const pocketPanel = document.createElement("div");
    pocketPanel.className = "pb-guide-panel";
    pocketPanel.append(original);
    const myPanel = document.createElement("div");
    myPanel.className = "pb-guide-panel";
    const openPanel = document.createElement("div");
    openPanel.className = "pb-guide-panel";
    let openPetsLoaded = false;

    const activate = (tab) => {
      pocketPanel.hidden = tab !== "pocket";
      myPanel.hidden = tab !== "mine";
      openPanel.hidden = tab !== "openpets";
      pocketTab.classList.toggle("active", tab === "pocket");
      myTab.classList.toggle("active", tab === "mine");
      openTab.classList.toggle("active", tab === "openpets");
      if (tab === "mine") void renderMyPets(myPanel);
      if (tab === "openpets" && !openPetsLoaded) {
        openPetsLoaded = true;
        void renderOpenPets(openPanel);
      }
    };

    content.replaceChildren(tabs, pocketPanel, myPanel, openPanel);
    activate("pocket");
  }

  function showBuddySubmenu(menu, rootNodes) {
    const content = menu.querySelector(".birb-window-content");
    if (!content) return;
    menu.dataset.pocketBuddySubmenu = "1";
    const goBack = menuItem("Go Back", () => {
      delete menu.dataset.pocketBuddySubmenu;
      content.replaceChildren(...rootNodes);
    });
    const status = menuItem("Status", () => showStatus());
    const talk = menuItem("Talk", () => showTalk());
    const careItem = menuItem("Care", () => showCare());
    content.replaceChildren(goBack, menuSeparator(), status, talk, careItem);
  }

  function augmentMainMenu(menu) {
    if (menu.dataset.pocketBuddyMain) return;
    const content = menu.querySelector(".birb-window-content");
    if (!content) return;
    menu.dataset.pocketBuddyMain = "1";

    const originalItems = [...content.querySelectorAll(":scope > .birb-menu-item")];
    const first = originalItems[0];
    if (!first) return;

    first.textContent = "Pet Buddy";
    first.addEventListener("click", () => {
      void brain.care("pet").then((result) => toast(root, result.message));
    });

    let settingsItem = null;
    let hideItem = null;
    for (const item of originalItems.slice(1)) {
      const label = item.textContent?.trim() ?? "";
      if (label === "Settings") settingsItem = item;
      if (/^Hide (Bird|Birb)$/i.test(label)) {
        item.textContent = "Hide Buddy";
        hideItem = item;
      }
    }

    const homeItem = menuItem("Home", () => {
      closeBaseMenu(root);
      void home.open();
    });
    const buddyItem = menuItem("Buddy", () => {});
    const chillItem = menuItem("Chill Mode", () => showChill());
    const myPetsItem = menuItem("My Pets", () => {
      closeBaseMenu(root);
      const { c } = windowBox(root, "pb-my-pets", "My Pets");
      void renderMyPets(c);
    });
    const quitItem = window.PocketBuddyDesktop?.quit
      ? menuItem("Quit Pocket Buddy", () => {
          closeBaseMenu(root);
          window.PocketBuddyDesktop.quit();
        })
      : null;

    const leanRoot = [first, homeItem, chillItem, buddyItem, myPetsItem, menuSeparator(), settingsItem, hideItem, quitItem].filter(Boolean);
    content.replaceChildren(...leanRoot);
    const rootNodes = [...content.childNodes];
    buddyItem.onclick = () => showBuddySubmenu(menu, rootNodes);
  }

  function augmentSettingsMenu(menu) {
    if (menu.dataset.pocketBuddySettings) return;
    menu.dataset.pocketBuddySettings = "1";
    const content = menu.querySelector(".birb-window-content");
    if (!content) return;
    const item = menuItem("", () => {});
    item.textContent = `UI Theme: ${themes.snapshot().label}`;
    item.onclick = () => {
      closeBaseMenu(root);
      showThemes();
    };
    const firstSeparator = content.querySelector(".birb-window-separator");
    if (firstSeparator) firstSeparator.after(item);
    else content.append(item);
  }

  const observer = new MutationObserver(() => {
    const menu = root.getElementById("birb-menu");
    if (menu && !menu.dataset.pocketBuddySubmenu) {
      if (isSettingsMenu(menu)) augmentSettingsMenu(menu);
      else augmentMainMenu(menu);
    }
    const guide = root.getElementById("birb-field-guide");
    if (guide) augmentFieldGuide(guide);
  });
  observer.observe(root, { childList: true, subtree: true });

  setInterval(() => void brain.tick(), 60_000);

  window.PocketBuddy = {
    coreVersion: POCKET_BUDDY_VERSION,
    brain,
    library,
    runtime,
    home,
    themes,
    showTalk,
    showCare,
    showStatus,
    showThemes,
    showChill,
    setChillActor,
    restoreChillActor,
    care,
    openPetsCatalog,
  };
  window.dispatchEvent(new CustomEvent("pocket-buddy-core-ready", { detail: { version: window.PocketBuddy.coreVersion } }));
  return window.PocketBuddy;
}
