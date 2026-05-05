# APPYmanager — Scope & Architecture Notes

This file locks in the design decisions agreed across the planning sessions
so future Claude Code sessions stay aligned. Update it as decisions evolve.

## Project identity

APPYmanager is a sister tool to **BRIXYmanager** (rail networks) and
**CRUFYmanager** for the OpenGeofiction (OGF) worldbuilding community. It
helps OGF mappers manage **demographics** and (later) **roads** for the
fictional countries they map.

Demographics and roads do not interact much — they are effectively two
separate apps under one roof. **Demographics is being built first.** Roads
are deferred.

## Reference repos

- `booonen/BRIXYmanager` — primary visual + architectural reference. Mirror
  its look/feel and save-file implementation. (Cloned to
  `/home/user/_reference/BRIXYmanager` for inspection.)
- `booonen/CRUFYmanager` — secondary reference (less directly relevant).

GitHub MCP tools are scoped to `booonen/appymanager` only; the other repos
must be cloned via shell for reference.

## Build philosophy

**Brick by brick.** The user wants to sign off on each increment before the
next is started. Do not steam ahead. Do not implement features that haven't
been explicitly agreed.

## Architecture (mirrors BRIXY)

- **Single-page, in-browser, no build step.** Vanilla JS, plain `<script>`
  tags, no bundler.
- `index.html` redirects to `appymanager.html` (the actual shell).
- Module split under `js/`:
  - `core.js` — global `data` object, `uid()`, `esc()`, color palette
  - `persistence.js` — IndexedDB multi-slot save manager + JSON import/export
  - `ui.js` — modal, toast, `appConfirm`, `appPrompt`
  - `l10n.js` — `t()`, `registerLanguage()`, `l10nHydrate()`
  - `map.js` — Leaflet wrapper, OGF tile layer
  - (later) `plots.js`, `boundaries.js`, `properties.js`, `overpass.js`
- `lang/en.js` — registers English strings via `registerLanguage('en', ...)`.
- `styles.css` — dark theme, BRIXY tokens (`--bg #0f1117`,
  `--accent #5b8af5`, DM Sans / Fraunces / JetBrains Mono).

## Persistence (mirrors BRIXY)

- IndexedDB database name: `appymanager`.
- Two object stores: `registry` (id, name, modified, stats) + `saves` (id, data).
- Active save id stored in `localStorage` under key `appymanager:active`.
- 300 ms debounced auto-save via `save()` → `flushSave()`.
- JSON export: timestamped filename, `showSaveFilePicker` if available.
- JSON import: creates new save slot, switches to it.
- Multi-slot manager UI mirrors BRIXY exactly (rename / duplicate / delete /
  import / export, storage estimate at the bottom).

## OGF integration

- Tile server: `https://tile.opengeofiction.net/ogf-carto/{z}/{x}/{y}.png`
  (maxZoom 19).
- Overpass endpoint: `https://overpass.opengeofiction.net/api/interpreter`.

## Data model — agreed primitives

### Plot
The atomic geographic unit. Properties:
- Strictly tiled, non-overlapping.
- Covers exactly the area the user has imported. If the input has gaps,
  the gaps remain.
- Can be non-contiguous, but the user must be able to split a non-contiguous
  plot into contiguous parts.
- Initially formed by importing a top-level boundary via Overpass (one plot
  per imported relation).
- When a smaller-scale boundary set is imported, plots are auto-subdivided
  by overlaying the new borders on the existing plot map and merging — new
  plots are created wherever borders create a new demarked area. After this,
  plots may no longer correspond to a single OGF object.
- A manual split editor lets the user split a plot into two pieces.
- The user can export current plots to a `.osc` file; after upload to OGF,
  the program needs to **re-sync** to assign the correct OGF IDs back to
  each plot.
- A plot can optionally be split between **land** and **water** (outside
  coastline / inside water relations). Internally, plots are stored
  **mixed**; the land/water split is applied on load when enabled.
  Properties can be set independently on land vs. water portions when the
  split is on.

### Boundary
A higher-level region built from primitives.
- A boundary can be a collection of **plots** OR a collection of **other
  boundaries** of a strictly lower hierarchy level.
- Each project has a strict **boundary-type hierarchy** (e.g.
  Country > Province > Municipality > Plot). A boundary type can only
  contain types strictly below it.
- (Schema for boundary-type hierarchy is TBD — to be designed in a later
  brick.)

### Property
Demographic / categorical data attached to plots or boundaries.
- Three property kinds:
  - **Numeric** (e.g. population, area)
  - **Text / categorical** (e.g. predominant language)
  - **Percentage of another property** (e.g. "% Spanish-speakers" =
    percentage of population). The denominator property is declared
    per-property. The user can enter either a percentage or a raw number;
    when the denominator changes, the other form updates.
- A default set of demographic properties is bootstrapped per project;
  user-defined custom properties are supported.
- **Override semantics**: a value set by the user on a higher-level
  boundary takes precedence over the value computed from constituent
  plots. Both values are stored. Mismatches are flagged. An *under-sum*
  mismatch (boundary set lower than computed) is treated as a critical
  error; an *over-sum* mismatch (computed lower than set) is acceptable
  (incomplete OGF mapping is a normal case).
- **Aggregation rules**:
  - Numeric: per-property declaration of sum vs. weighted-average.
  - Categorical: roll-up disabled by default; opt-in distribution
    aggregation (40% A / 60% B).
  - Percentage: weighted by the declared denominator property.

### Future / deferred
- Historic component: properties varying over time. Deferred entirely.
- Roads: deferred.
- Population estimator integration: the existing
  `ogf-population-estimator(8).html` will eventually be folded into the
  app to bootstrap plot population values and to ratio-split residential
  way population during plot splits. Not part of early bricks.

## Geometry

- Snap distance for boundary-merge auto-subdivision: small enough that
  small urban plots remain createable. (Exact value TBD.)

## Versioning

- `VERSION_HISTORY.md` at the repo root, BRIXY style: each entry has a
  semver-ish tag and a short bullet list. Start at `0.0.1`.

## Long-term plan (demographics MVP)

This is the agreed brick-by-brick plan for the demographics app. Roads
stay deferred (separate brick stream). Each brick is a sign-off-able
increment; each phase is a coherent capability. Mark bricks complete in
the log below as they ship. Note: not every brick will be a one-shot —
e.g. Brick 5 (auto-subdivision) may split into sub-steps.

### Phase 1 — Geographic foundation
- **Brick 1** — Project shell, save manager, OGF map.
- **Brick 2** — Plot data model + Overpass import for top-level
  boundaries (paste relation ID / pick preset → one plot per relation →
  polygon rendered on map → persisted).
- **Brick 3** — Plot interaction: click-to-inspect, plot list view,
  basic edit (name, notes), delete.

### Phase 2 — Boundary hierarchy
- **Brick 4** — Boundary-type schema editor: define the hierarchy for
  this project (e.g. Country > Province > Municipality > Plot).
  Validation: types can only contain types strictly below.
- **Brick 5** — Smaller-boundary Overpass import + **auto-subdivision**
  (overlay borders on existing plot map, merge with snap tolerance).
  Geometrically hardest brick — likely needs internal sub-steps.
- **Brick 6** — Boundary entities (collections of plots OR
  sub-boundaries), with map layer toggles per boundary level.

### Phase 3 — Properties
- **Brick 7** — Property schema editor: numeric / categorical /
  percentage, with bootstrapped demographic defaults (population, area,
  language, etc.) and per-property aggregation rule (sum vs.
  weighted-avg, denominator declaration for percentages).
- **Brick 8** — Property values on plots: enter numeric / categorical /
  percentage values, with the % ↔ raw-number dual input.
- **Brick 9** — Property aggregation on boundaries: user-set value
  precedence, computed value alongside, mismatch flagging (under-sum =
  critical, over-sum = acceptable).

### Phase 4 — Plot operations
- **Brick 10** — Manual plot split editor (draw a cut line → two plots,
  with property redistribution UI).
- **Brick 11** — Land/water split: fetch coastlines / water relations
  from OGF, apply split on load when enabled, allow setting properties
  separately on land vs. water portions.

### Phase 5 — Visualisation & UX
- **Brick 12** — Choropleth: color plots/boundaries by any selected
  property.
- **Brick 13** — Issues panel (mismatch warnings + data-quality checks)
  + filter / search.

### Phase 6 — OGF round-trip
- **Brick 14** — `.osc` export of current plot polygons for upload to OGF.
- **Brick 15** — Re-sync flow: re-query OGF after upload, match plots
  back to their newly-assigned OGF IDs.

### Phase 7 — Population integration
- **Brick 16** — Fold `ogf-population-estimator(8).html` in: bootstrap
  plot population values from density presets, and ratio-split
  residential way population when plots are manually split.

### Deferred (post-MVP)
- **Historic** — properties varying over time. Likely 2–3 bricks once
  we get there.
- **Roads** — separate program, separate brick stream.
- **i18n expansion** — additional languages, translation tooling.

Things will inevitably surface that aren't on this list. Add them as
they come up; the plan is a living document.

## Brick log

- **Brick 1** ✓ (committed) — the shell. HTML/CSS chrome mirroring
  BRIXY, IndexedDB save manager, JSON import/export, l10n scaffolding,
  Leaflet map with OGF tiles. No plot/boundary/property logic yet.
- **Brick 2** (next, not started) — see Phase 1 above.
