# Pocket Buddy+ TinyHouse Local Game

A public-safe playable HTML house builder for the user's purchased Pixel Salvaje TinyHouse 0.17 asset pack.

## Run

1. Unzip `TinyHouse_0.17(@Pixel_Salvaje).zip` somewhere on your computer.
2. Open `index.html` in Chromium, Chrome, or Edge.
3. Choose **Select Extracted Folder** and select the unzipped TinyHouse folder.

The game reads the PNGs from the browser's local file handles and creates temporary object URLs. It does not upload, copy, or commit the purchased assets.

## Real isometric house grid

The floor and wall presentation uses the approved TinyHouse geometry, but the structure is no longer a fixed 5×5 picture:

- every floor is an addressable cell on the shared 128×64 isometric coordinate grid;
- every wall or door is an addressable edge between adjacent cells;
- floor cells can be added or removed individually, including beyond the original room bounds;
- wall edges can be added or removed independently, including interior partitions;
- connected rectangular rooms can be appended from the Structure panel;
- doors replace wall edges, animate, and change whether adjacent floor regions are connected;
- furniture placement and dragging accept only floor cells that currently exist;
- wall-mounted TVs, windows, pictures, and posters target only wall edges that currently exist;
- the complete structure, furniture, wall items, and door states save/load together;
- PNG export renders the complete edited house rather than the original fixed room.

The default house still opens as the exact 5×5 room whose floor and wall seams were previously verified.

## Structure controls

Open the **Structure** panel on the right side of the house:

- **Furnish** — place and move normal objects; click a structural door to open or close it.
- **+ Floor / − Floor** — grow or shrink the house one tile at a time.
- **+ Wall / − Edge** — add partitions or remove wall/door edges.
- **+ Door** — replace an edge with a working passage.
- **Room Planner** — choose east/south expansion plus a width and depth from 2–8 tiles, then add a connected room with a working door.
- **Undo / Redo** — reverse structure edits through a bounded 64-step history.
- **Fit House** — reframe the camera around the current structure.

The editor blocks removing a bridge tile when that would accidentally split the physical floor footprint. Hold **Alt** while clicking only when a disconnected structure is intentional.

Keyboard shortcuts:

- **B** — collapse or reopen the Structure panel.
- **Ctrl/Cmd+Z** — undo a structure edit.
- **Ctrl/Cmd+Shift+Z** or **Ctrl/Cmd+Y** — redo a structure edit.

## Editable room templates

The **Rooms** button opens six licensed local room recipes assembled from the pack's individual assets:

- **Bathroom** — animated bath, sink, toilet, shelves, mirror, window, toiletries, and plants.
- **Kitchen** — cabinets, animated sink and appliances, refrigerator, washing machine, oven, table, seating, and countertop props.
- **Office** — a larger 6×6 workspace with animated computers, printers, office machines, desks, chairs, partitions, storage, and wall decor.
- **Japanese Room** — tatami-style flooring, closet, low table, cushions, tea, shelving, bonsai, lantern, artwork, and an animated sliding door.
- **Bedroom** — the compact yellow showcase bedroom with bed, desk, wall TV, shelf, door, rug, plants, books, console, lamp, and cat.
- **Room** — the larger mixed-use bedroom/lounge/workspace with bed, sofa, coffee table, computer desk, wall TV, windows, plants, lava lamp, and cat.

Building a template replaces the current house only after confirmation and stores a one-step complete-house backup. **Restore Previous House** restores its topology, furnishings, wall items, animation state, and furniture rotations. Every template object remains selectable, movable, rotatable where authored views exist, interactive, saveable, and exportable.

The pack's animated full-room GIFs and PNG compositions can be used as optional local previews:

- use **Choose Preview** on a room card for UUID-named files;
- use **Auto-Match Named Showcases** when filenames contain words such as `bathroom`, `kitchen`, `office`, `japanese`, `bedroom`, or `room`;
- use **Play Room Animations** to trigger the real editable objects in the current room.

Showcase previews are read through temporary browser object URLs. They are never uploaded, copied into saves, or committed to the repository. The editable room recipes reference manifest IDs rather than embedding licensed image bytes.

## Included furnishing behavior

- Half-cell, forgiving furniture snapping on existing floor cells
- Pointer-locked dragging that preserves the exact grab point
- Tabletop/support placement and parent-following movement
- Wall mounting for compatible televisions, windows, pictures, posters, and boards
- Authored four-way furniture rotation when the pack provides directional views, with honest two-way mirroring for single-view art
- Grouped animation/state definitions instead of exposing raw frames
- Selection, layers, duplication, rotation, pan, zoom, reset, save/load, and PNG export
- Diorama-style fixed-isometric navigation: empty-canvas pan, pointer-centered wheel zoom, touch pinch, damping, momentum, and smooth fit-house
- Local-only metadata manifest with filenames and dimensions; no purchased image bytes

## Cozy Mode upgrade

The **Cozy** button opens a local productivity and ambience layer:

- Wall-clock-backed focus and break sessions
- Persistent tasks, active-task selection, room memo, session totals, and streaks
- Original Web Audio ambience generated in the browser
- Lighting themes and furniture reactions
- JSON import/export for Cozy state
- A bounded Pocket Buddy+ host bridge

Keyboard shortcuts:

- **Ctrl/Cmd+Shift+M** — open or close Cozy Mode
- **Ctrl/Cmd+Shift+F** — start, pause, or resume the current focus timer
- **Ctrl/Cmd+S** — save house structure and furnishings
- **Ctrl/Cmd+L** — load house structure and furnishings

## Verification

```sh
node test-contract.mjs
node test-drag-contract.mjs
node test-wall-contract.mjs
node test-house-grid-contract.mjs
node test-room-templates-contract.mjs
node test-rotation-camera-contract.mjs
node test-cozy-contract.mjs
```

`test-house-grid-contract.mjs` protects the real cell/edge model, exact projection, rectangular room planning, bridge-tile split detection, room expansion, door connectivity, persistence, and full-house export wiring.

`test-room-templates-contract.mjs` protects the six editable recipes, complete asset-ID resolution against the shipped manifest, valid floor anchors, explicit UUID preview assignment, local-only showcase handling, one-step restore, whole-room animation controls, and script ordering.

`test-rotation-camera-contract.mjs` protects authored directional families, known directional spritesheets, persistent/exported rotation state, two-way fallback for single-view art, and the fixed-isometric Diorama-style navigation contract.

## Asset boundary

Pixel Salvaje permits using and editing the pack in projects but does not permit redistributing the source assets. This directory intentionally contains no purchased PNG/GIF bytes. The user supplies their own licensed copy at runtime.