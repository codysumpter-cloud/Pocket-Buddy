# Pocket Buddy Studio

A developer-only visual inspector for the Electron app — the useful parts of a
Godot-style editor, for a runtime that has no scene editor.

Studio is **off in production**. It appears only in an unpackaged build, or in a
packaged build started with `POCKET_BUDDY_STUDIO=1`.

## Run

```sh
npm ci
npm run desktop:studio     # watch + relaunch, Studio forced on and opened
```

Other entry points:

```sh
npm run desktop:dev        # one-shot build + launch (unchanged)
npm run desktop:watch      # watch + relaunch, Studio available via the tray
```

In a development build you can also open Studio from the tray menu
(**Open Pocket Buddy Studio**), and open Chromium DevTools for the focused
Pocket Buddy window with **F12** or **Ctrl/Cmd+Shift+I**.

## What it shows

- a **live viewport** of the real desktop overlay or the real Home window;
- a **hierarchy tree** of the active visual elements, including the Buddy inside
  the overlay's shadow root;
- a **property inspector**: position, size, scale, z-order, visibility,
  collision bounds, animation/state, and the relevant computed CSS;
- **click-to-select** for Buddy, Ani, furniture, walls, floors, doors, UI panels
  and structure hit regions — in the viewport, or with **PICK** to click
  directly in the real window;
- **drag to move**, plus arrow nudges from the inspector;
- **debug overlays** for Home: walkable cells, wall/door edges and which of them
  actually block traversal, furniture footprints, actor collision radii, and a
  live readout of each actor's fractional coordinates and the grid cell beneath
  it;
- **Play / Idle / Build** state switching, and the six TinyHouse structure modes;
- the **active Buddy identity** and whether presence is owned by Desktop or Home;
- a **console panel** capturing console output and uncaught errors from the
  inspected window;
- **DevTools**, **reload** and **restart** controls.

## Design constraints

Studio is deliberately parasitic on the real app:

- **One Home renderer.** Studio never constructs house geometry. Overlays read
  the live `TinyHouseStructure.grid` and project through the same isometric
  vertex math the real renderer uses, painting into a canvas inside the real
  `#world-stage` so they inherit the real camera transform.
- **One Buddy presence.** Studio's *Open Home* asks the renderer for the same
  Home the tray opens, so the verified-art handshake and the single-presence
  contract run exactly once. Studio never opens a Home of its own.
- **Continuous movement stays continuous.** Actor nudges route through
  `PocketBuddyActorMotion.moveScreen`, so walls and closed doors still apply and
  positions stay fractional. Studio never reintroduces tile snapping.
- **Production behavior is unchanged.** Studio drives the real windows through
  `webContents.executeJavaScript` and `capturePage`. No Studio IPC exists in
  `preload.cjs` or `home-preload.cjs`, and `renderer.js` is untouched.

### Editing model

The inspector labels every selection with how far an edit reaches:

| Badge | Meaning |
| --- | --- |
| `authoritative` | Actor position, written through the canonical motion core. |
| `canonical grid` | Read from the real TinyHouse cell/edge topology. |
| `live css preview` | A visual-only nudge. **Not** written back to house state. |

Live nudges use the standalone `translate` property rather than `left`/`top`, so
they never fight an element's real layout anchors or its facing `transform`.
**RESET NUDGE** drops the offset.

## Files

- `studio-gate.mjs` — pure availability gate: unpackaged builds, or an explicit
  `POCKET_BUDDY_STUDIO` opt-in; an explicit off always wins.
- `studio-main.mjs` — main-process manager: Studio window, agent injection,
  `capturePage` streaming, and the gated `pb-studio:*` IPC surface.
- `studio-preload.cjs` — bridge for the Studio window only.
- `studio-scene-core.js` — pure geometry and classification: cell polygons, edge
  segments, collision polygons, grid debug model, actor telemetry.
- `studio-agent.js` — injected into the real windows: hierarchy walk (including
  shadow DOM), property reads, selection, live edits, debug canvas, console
  capture. Exposes `window.__POCKET_BUDDY_STUDIO__`.
- `index.html` / `studio.css` / `studio.js` — the Studio window itself.

The Home-side inspection bridge lives in `../pocket-buddy-home-actors.js` and is
installed only when the main process injected `studio: true` into the Home
config. Production Home exposes nothing.

## Verification

```sh
npm test
```

`tests/studio-mode.test.mjs` protects the production gate, the overlay geometry
against the canonical grid math, markup classification, the gated Home bridge,
continuous-motion preservation, the single-Home/single-presence contract, and
the untouched production preloads.
