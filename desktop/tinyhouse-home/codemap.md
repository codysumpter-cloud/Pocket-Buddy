# TinyHouse local game codemap

## Responsibility

Public-safe browser house builder that uses a user-selected licensed TinyHouse
asset folder without committing or uploading the purchased image files. The
builder preserves the approved 128×64 projection while representing the house as
editable floor cells and wall/door edges. Six editable room recipes reconstruct
the pack's Bathroom, Kitchen, Office, Japanese, Bedroom, and large mixed-use Room
showcase compositions from movable manifest assets. Optional showcase GIF/PNG
previews remain local object URLs. Cozy Mode adds local productivity, ambience,
room reactions, and a narrow Pocket Buddy+ host bridge.

## Files

- `index.html` — game shell, catalog, room layers, structure controls, Blueprint planner, room-template gallery, rotation runtime, camera runtime, and Cozy entry point.
- `styles.css` — pixel UI, room presentation, and local-folder gate.
- `house-grid.css` — editable floor/edge targets, working-door presentation, Structure panel, room planner, and history controls.
- `room-templates.css` — responsive template gallery, pixelated local previews, per-room preview inputs, and template actions.
- `manifest.js` — metadata-only catalog: stable IDs, paths, dimensions, orientation, animation groups, support classes, and tabletop flags.
- `generated-recipes.js` — source-layer composition and spritesheet-slice recipes rendered locally in the browser.
- `local-assets.js` — validates the selected folder, creates temporary object URLs, renders generated frames, then releases the game boot promise.
- `app.js` — original exact isometric transforms, furnishing placement, animation state, selection, compatibility camera state, and compatibility behavior.
- `house-grid-core.js` — canonical house topology: floor-cell coordinates, wall/door edge keys, projection helpers, bounds, room connectivity, working door state, connected-room creation, and serialization.
- `house-grid-blueprint-core.js` — pure room-plan preflight, footprint-component analysis, bridge-tile split detection, and 2–8 tile room-size normalization.
- `room-templates-core.js` — metadata-only Bathroom, Kitchen, Office, Japanese, Bedroom, and Room recipes, exact licensed manifest IDs, preview-name matching, and missing-asset validation.
- `rotation-core.js` — pure authored-direction discovery for A/B/C/D families, paired front/back views, known directional sheets, normalization, and honest two-way fallback.
- `house-grid.js` — shared structure runtime, persistence boundary, fast/late plugin initialization, and public `TinyHouseStructure` API.
- `house-grid-render.js` — dynamic floor/wall/door rendering, camera fit, and full-house PNG export.
- `house-grid-editor.js` — Structure panel, floor/edge editing, connected-room actions, house-aware furnishing placement, and complete save/load.
- `house-grid-blueprint.js` — Blueprint Room Planner UI, rectangular east/south additions, structure-only undo/redo, keyboard shortcuts, plan validation, and safe floor-removal guard.
- `room-templates.js` — Rooms gallery, six editable template applications, complete-house backup/restore, whole-room animation trigger, explicit UUID preview assignment, named-preview matching, and ephemeral preview URL lifecycle.
- `four-way-rotation.js` — authored furniture direction cycling, local sheet slicing, persistent placement rotation, catalog badges, keyboard controls, and rotation-aware export.
- `diorama-camera.js` — fixed-isometric empty-canvas/Space/middle pan, pointer-centered wheel zoom, touch pinch, damping, momentum, smooth fit-house, and reduced-motion behavior.
- `drag-core.js` — pointer-offset and complete placement snapshot helpers, including structural wall-edge anchors.
- `drag-pointer-lock.js` — grab-point-locked drag preview and release snapping to the current editable floor set.
- `wall-core.js` — wall-mount classification and targeting restricted to wall edges that exist in the current house topology.
- `wall-mount.js` — wall-item placement UI, badges, canonical structural-edge persistence, metadata, and restoration.
- `cozy-core.js` — bounded Cozy state schema, task operations, timer reconciliation, statistics, room-reaction moods, import/export, and public host snapshot.
- `cozy.js` — Cozy panel, original Web Audio ambience, persistence, keyboard shortcuts, furniture reactions, and host bridge.
- `cozy.css` — Cozy panel, room lighting themes, responsive layout, and reduced-motion behavior.
- `test-contract.mjs` — public asset boundary and original gameplay contracts.
- `test-drag-contract.mjs` — pointer-lock and editable-grid release snapping.
- `test-wall-contract.mjs` — tabletop depth and canonical structural wall mounting.
- `test-house-grid-contract.mjs` — cell/edge topology, expansion, door connectivity, exact projection, Blueprint planning, safe footprint deletion, persistence, clickable doors, and full-house export contract.
- `test-room-templates-contract.mjs` — six editable room recipes, complete manifest resolution, valid floor anchors, local preview controls, UUID-safe assignment, backup/restore, animation controls, and script ordering.
- `test-rotation-camera-contract.mjs` — authored direction families, local sheet slicing, persistent/exported rotation state, two-way fallback, pointer zoom, touch pinch, damping, momentum, fixed-isometric boundary, and script ordering.
- `test-cozy-contract.mjs` — Cozy state, timer, integration, bridge, and no-upload checks.

## Structural invariants

- A floor is identified by integer `(column,row)` coordinates on one shared grid.
- A `left` or `right` edge has one canonical key and separates at most two adjacent cells.
- A wall blocks traversal. A closed door blocks traversal. An open door connects its two adjacent floor cells.
- Removing a floor invalidates furnishing placement on that cell and removes only edges that no longer touch any floor.
- Normal floor deletion must not split the physical footprint into disconnected islands; Alt-click is the explicit override.
- Planned connected rooms are 2×2 through 8×8 tiles, remain inside the 24×24 maximum span, and include a working shared-boundary door.
- Structure undo/redo stores at most 64 serialized topology snapshots and never includes licensed asset bytes.
- Wall-mounted decor retains the canonical edge key, coordinates, and orientation across drag, duplicate, save, and load.
- Room templates store only manifest IDs, coordinates, scale, wall anchors, support relationships, rotation state, and animation metadata; they contain no purchased image bytes.
- Every room-template asset ID must resolve in the shipped manifest, and every non-wall root placement must round to a floor cell inside its template footprint.
- Applying any of the six templates creates an editable structure and movable placements, then preserves the previous complete house as a one-step local backup.
- Bedroom reconstructs the compact yellow showcase; Room reconstructs the larger bedroom/lounge/workstation showcase.
- UUID-named preview files require explicit per-room assignment; unnamed files are never guessed into arbitrary templates.
- Showcase GIF/PNG previews use revocable object URLs and never enter house saves, host snapshots, or repository source.
- Furniture uses four authored directions only when corresponding pack art exists; single-view art remains a truthful two-way mirror.
- The camera remains fixed-isometric 2D; Diorama-style navigation never claims unsupported continuous 3D orbit.
- The initial 5×5 structure renders with the exact same floor and wall coordinates as the previously verified fixed room.
- Purchased asset bytes never enter serialized house state, repository source, or host snapshots.
