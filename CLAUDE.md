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
  its look/feel and save-file implementation. If a local clone isn't
  available on the current host, read via
  `gh api repos/booonen/BRIXYmanager/contents/<path>?ref=main`.
- `booonen/CRUFYmanager` — secondary reference (less directly relevant).

**Cross-app data flow:** BRIXY will eventually import APPY data (boundaries
and settlements act as anchors for rail networks); APPY does **not**
import from BRIXY. Design the export side accordingly when it lands.

## Build philosophy

**Brick by brick.** The user wants to sign off on each increment before the
next is started. Do not steam ahead. Do not implement features that haven't
been explicitly agreed.

## Architecture (mirrors BRIXY)

- **Single-page, in-browser, no build step.** Vanilla JS, plain `<script>`
  tags, no bundler.
- **Geomap only.** No schematic / Beckmap view. APPY visualises actual
  OGF geometry; abstract / topological views are out of scope.
- `index.html` redirects to `appymanager.html` (the actual shell).
- Module split under `js/`:
  - `core.js` — global `data` object, `uid()`, `esc()`, color palette
  - `persistence.js` — IndexedDB multi-slot save manager + JSON import/export
  - `ui.js` — modal, toast, `appConfirm`, `appPrompt`
  - `l10n.js` — `t()`, `registerLanguage()`, `l10nHydrate()`
  - `map.js` — Leaflet wrapper, OGF tile layer
  - (later) `plots.js`, `boundaries.js`, `settlements.js`,
    `properties.js`, `overpass.js`
- `lang/en.js` — registers English strings via `registerLanguage('en', ...)`.
- `styles.css` — dark theme based on BRIXY tokens (`--bg #0f1117`),
  with a Pompeian red accent (`--accent #c1272d`) to differentiate
  APPY from its sister projects (BRIXY blue, CRUFY green). DM Sans /
  Fraunces / JetBrains Mono.

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

### Settlement
A lightweight point-of-interest reference, *not* load-bearing for the
demographics aggregation engine.
- A settlement is a single OGF `place=*` node (point, lat/lng) imported
  from Overpass. Stored fields: id, lat/lng, name, OGF node id, parent
  reference (plot OR boundary), notes.
- Each settlement is linked to **one parent** — a plot or a boundary —
  for hierarchy and `.osc` round-tripping.
- Settlements participate in `.osc` export so users can edit OGF's
  `place=*` nodes through APPY, but they do not drive aggregation,
  override semantics, or choropleth.

### Future / deferred
- Historic component: properties varying over time. Deferred entirely.
  Default cadence between data points is **irregular** (user-defined
  dates per property type) — not every property updates yearly.
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
the log below as they ship.

The data-model rules above (Plot, Boundary, Property, Settlement) are
the canonical source for nuance; each brick description below names
which rules it implements but does not re-state them in full. Read the
§Data model section before starting any brick.

### Decisions & rationale

- **Phase 4 (plot ops) comes after Phase 3 (properties).** Hard to test
  property-redistribution-on-split without properties existing first.
  The user might split plots before assigning many properties, but
  building the engine in this order keeps testing clean.
- **Brick 5 (auto-subdivision) is the geometrically hardest** and may
  split into sub-steps (e.g. 5a basic overlay + manual reconciliation,
  5b full auto-merge with snap). Not every brick will be a one-shot.
- **Property aggregation override semantics**: user-set on a higher
  boundary always wins, but the computed value is also stored so the
  mismatch can be flagged. Under-sum is critical; over-sum is OK
  because OGF mapping is often incomplete.
- **Land/water split is data-bearing, not visual.** Internal storage
  stays mixed; the split is applied on load when enabled. Properties
  can then be set separately on land vs. water portions.
- **Default property set + custom is a hard requirement.** A new
  project bootstraps with population, area, etc.; users add custom
  properties. Property kind (numeric / categorical / percentage) is
  declared per-property along with aggregation rule.
- **Boundary containment is transitive and exclusive (Brick 6).** The
  `primitiveId` on a boundary type declares only the *immediate*
  primitive, but a boundary of type T is allowed to contain anything
  that sits *anywhere* below T in the chain. This lets mappers skip
  levels where they have no data (e.g. a Province directly holds Plots
  where no Municipality has been defined). Simultaneously, membership
  is exclusive: a plot already inside a sub-municipality cannot also be
  directly assigned to a parent municipality — the parent already covers
  it transitively. Overlap = data error, enforced at assignment time.

### Phase 1 — Geographic foundation

- **Brick 1** — Project shell. HTML/CSS chrome mirroring BRIXY,
  IndexedDB save manager (debounced 300 ms auto-save, multi-slot
  rename/duplicate/delete, JSON import/export with timestamped
  filenames), Leaflet map with OGF tiles, l10n scaffolding. No
  plot/boundary/property logic.
- **Brick 2** — Plot data model + Overpass import for top-level
  boundaries. Define the Plot record (id, geometry, name, OGF relation
  id, notes). Three Overpass entry-point modes (the user wants both
  presets and custom queries):
  (a) paste a relation ID;
  (b) pick from a preset (e.g. country admin boundary by `admin_level`);
  (c) paste a custom Overpass query.
  Each imported relation becomes one plot. Plots are non-overlapping;
  the imported area defines the canvas including any gaps the user
  provided. Render polygons on the map; click-highlight; persist.
- **Brick 3** — Plot interaction. Click-on-map → inspector panel, plot
  list view (sortable / searchable), edit name and notes, delete plot
  with confirmation. Compute and display plot area.

### Phase 2 — Boundary hierarchy

- **Brick 4** — Boundary-type schema editor. Per-project list of
  boundary types, each with name and level. The hierarchy is strict:
  a type can only contain types strictly below it. Plots are the
  implicit lowest level. UI to add/edit/delete types and visualise the
  tree. Bootstrapped defaults: TBD (probably Country / Province /
  Municipality / Plot, but user-editable).
- **Brick 5** — Smaller-boundary Overpass import + **auto-subdivision**.
  When a smaller-scale boundary set is imported, overlay its borders
  onto the existing plot map and merge — wherever new borders create a
  newly demarked area, a new plot is created. Snap distance is
  configurable but small (must preserve plots in dense urban areas).
  After this, plots may no longer correspond to single OGF objects.
  Likely needs sub-bricks (5a / 5b) for manual reconciliation vs. full
  auto-merge.
- **Brick 6** — Boundary entities. A boundary is either a collection of
  plots OR a collection of sub-boundaries of a strictly lower level.
  UI: assign plots/sub-boundaries to a parent. Map layer toggle per
  boundary level (show/hide each level independently). Boundary list
  view per type.
  **Containment rules (critical — read before building):**
  - **Transitive containment**: a boundary of type T may contain any
    plot or boundary whose type sits *anywhere* below T in the
    primitiveId chain — not just the immediate declared primitive.
    Example: if Province → Municipality → Plot, a Province can directly
    hold a Municipality *or* a Plot (where no Municipality has been
    defined for that area yet). This enables variable-depth hierarchies
    where some municipalities have sub-municipalities and some do not.
  - **Exclusivity / no-overlap rule**: membership is exclusive. A plot
    or boundary already assigned to any boundary cannot be assigned to
    another boundary at the same or higher level. Specifically, if plot
    P is a member of sub-municipality S, P may not also be directly
    assigned to municipality M — it is already transitively covered by
    M through S. Enforce this at assignment time; flag violations in
    the issues panel (Brick 14).

### Phase 2.5 — Settlements

- **Brick 7** — Settlements. Import OGF `place=*` nodes via Overpass
  using the same three entry modes as Brick 2 (paste node ID, pick a
  preset by `place=*` value, paste a custom query). Each settlement is
  a point linked to **one parent** — either a plot or a boundary —
  selectable in the inspector. Render markers on the map (clickable),
  list view (sortable by parent / name), edit name / parent / notes,
  delete. Settlements aren't load-bearing for aggregation; they're
  worldbuilding labels that need to round-trip via `.osc` later.

### Phase 3 — Properties

- **Brick 8** — Property schema editor. Three kinds: numeric (declare
  sum vs. weighted-average; if weighted, declare weight property),
  categorical (roll-up disabled by default, opt-in distribution
  aggregation), percentage (declare denominator property).
  Bootstrap each new project with a default demographic set
  (population, area, language, etc.). User can add/remove custom
  properties.
- **Brick 9** — Property values on plots. Enter numeric / categorical /
  percentage values per plot. For percentages, dual input: user can
  type either the % or the raw number, and switching one updates the
  other given the denominator's current value (and vice versa when
  the denominator changes).
- **Brick 10** — Property aggregation on boundaries. For each property
  on each boundary, store both the user-set value (if any) and the
  computed-from-children value. User-set takes precedence for
  display/use; computed is kept for comparison. Detect mismatches:
  **under-sum** (boundary < sum of children) = critical error;
  **over-sum** (boundary > sum of children) = acceptable warning
  because OGF mapping is often incomplete. Inline flagging in the
  inspector; central listing arrives in Brick 14.

### Phase 4 — Plot operations

- **Brick 11** — Manual plot split editor. User draws a cut line on a
  plot → two plots. UI for property redistribution: numeric properties
  default to area-proportional split with manual override; categorical
  inherits to both; percentage recomputes from its denominator. Show
  the two new plots' areas (and population once Brick 17 lands) to help
  electorate-style splitting decisions.
- **Brick 12** — Land/water split. Fetch coastlines (`way` with
  `natural=coastline`) and water relations from OGF. Internal plot
  storage stays mixed (one polygon per plot). When the split is
  enabled, plots are split into land/water portions on load.
  Properties can be set separately on land vs. water portions.
  Toggling off does **not** destroy data — kept separately and re-applied
  if the split is toggled on again.

### Phase 5 — Visualisation & UX

- **Brick 13** — Choropleth. Pick a property, color all
  plots/boundaries by its value. Continuous colour scales for
  numeric/percentage properties; distinct colours per category for
  categorical. Legend display. Per-property colour-scheme
  customisation can wait.
- **Brick 14** — Issues panel + filter/search. Central list of all
  detected mismatches and data-quality issues (from Brick 10 onwards).
  Click an issue → highlight on map + open inspector. Filter
  plots/boundaries by property values, name, type. Plain-text search
  by name.

### Phase 6 — OGF round-trip

- **Brick 15** — `.osc` export. Generate OsmChange XML for the current
  plot polygons (one OSM way / multipolygon relation per plot) plus
  any new/edited settlement nodes. User downloads the file and uploads
  it to OGF via JOSM or similar.
- **Brick 16** — Re-sync from OGF. After upload, query OGF for the
  newly-created objects and match plots and settlements back to their
  assigned OGF IDs. Matching strategy is non-trivial (geometry-based
  for plots, position-based for settlement nodes, with user
  confirmation for ambiguous cases). Together with Brick 15 this is
  the OGF round-trip.

### Phase 7 — Population integration

- **Brick 17** — Fold `ogf-population-estimator(8).html` in. (1) When a
  new plot is created, run the estimator's density-preset logic to
  bootstrap a population value. (2) During a manual plot split (Brick
  11), look up residential ways/relations inside the plot and
  ratio-split their estimated population between the two new plots
  by area.

### Deferred (post-MVP)

- **Historic** — properties varying over time. Likely 2–3 bricks once
  we get there. Will need a time-axis dimension on every property
  value, plus UI to scrub through years. Default cadence between data
  points is **irregular** (user-defined dates per property type) — not
  every property updates yearly.
- **Roads** — separate program, separate brick stream. Sister to
  demographics under the same shell, but no shared data model.
- **i18n expansion** — additional languages beyond English, translation
  completeness reporting (BRIXY has tooling we can port).

Things will inevitably surface that aren't on this list. Add them as
they come up; the plan is a living document.

## Brick log

- **Brick 1** ✓ (committed) — the shell. HTML/CSS chrome mirroring
  BRIXY, IndexedDB save manager, JSON import/export, l10n scaffolding,
  Leaflet map with OGF tiles. No plot/boundary/property logic yet.
- **v0.0.2** ✓ (committed, cosmetic) — Pompeian red accent (`#c1272d`)
  replaces BRIXY blue, distinguishing APPY from BRIXY (blue) and CRUFY
  (green). Token-only change; no behavioural difference.
- **Brick 2** ✓ (PR open on `feature/brick-2-plots`) — local mini-OSM
  store (`data.osm`), Plot record with outer/inner ring refs, Plots
  tab with a read-only table, Import modal with three modes (Search /
  By ID / Custom Overpass) plus inset preview map, overlap-reject
  policy, Map-tab plot rendering with click-to-select. OGF treated
  strictly as a sync target — saves work offline; the OGF relation id
  is metadata, not the source of geometry. Polish round in v0.0.4
  (canonical `(._;>;);out body;` query idiom; bbox-aware custom
  query; single-button Import → inline Commit flow; neutral map
  colors; disabled-button styling; no-results toast).
- **Brick 3** ✓ (merged to main) — plot interaction. Plots tab gained
  name-search + sortable headers (Name / Area / OGF Relation ID) + Area
  column (spherical excess, holes subtracted). Row click opens a detail
  modal with editable name + notes (auto-save on blur), read-only
  metadata, an inset Leaflet map, and a Delete button (appConfirm;
  orphan osm nodes/ways kept for adjacent-plot safety).
- **Brick 4** ✓ (merged to main) — boundary-type schema editor. Boundary
  Types tab added to nav. Hierarchy card shows bottom-up collapsible tree
  (Plots → Municipality → Province → Country) with `primitiveId` model
  (each type declares what it *contains*). Types table rolled into the tree
  with count badges. Add/Edit/Delete with cycle detection and dep-relinking
  on delete. Bootstrap: Country / Province / Municipality seeded on first
  visit. Transitive containment + exclusivity rules for Brick 6 documented
  in CLAUDE.md.
- **Brick 5a** ✓ (PR open on `feature/brick-5a-subdivide`) — smaller-boundary
  import + auto-subdivision. Turf.js v6 added via CDN. `js/subdivide.js`
  new geometry engine: classifies candidates as free vs. subdividers, computes
  `turf.intersect` / `turf.difference` per parent plot, stores results as local
  negative-id OSM nodes+ways, creates sub-plots and remainder plots (≥ 1 ha).
  Import preview shows split tree (parent → children + remainder). Commit
  replaces parent plots with sub-plots in place. Snap tolerance deferred to 5b.
- **Brick 5b** (next) — snap tolerance: merge nearly-coincident vertices across
  boundaries imported from different OGF sources.
