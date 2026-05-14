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
- Plot geometry is shaped by the project's **land/water mode**, set
  at save creation and immutable thereafter (see Brick 12 entry below
  for the four modes). Under the default `'land_only_sea_water'` mode,
  plots are clipped against the cached water geometry the moment they
  are created — no dual storage, no portion-aware property model. Each
  plot stores a single polygon; everything else (boundary dissolution,
  Area, aggregation) reads from it as-is.

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
  **Schema-side prerequisite (Brick 10a)** — each property schema grows
  a `rootLevelId: 'plot' | <boundaryTypeId>` field (default `'plot'`).
  A property defined at root `R` appears at level `T` iff `T === R` OR
  `R` is reachable from `T` downward through the `primitiveId` chain
  (i.e. `T` is `R` itself or sits above `R` in a chain containing it).
  Smaller-than-R levels and unrelated chains don't show the row at
  all. At larger-than-R levels the row appears as a roll-up (with the
  user-set override semantics intact). Default of `'plot'` means
  every existing property behaves exactly as before (recorded on
  plots, rolled up everywhere else). Motivating cases: voting lives
  on Province / Country only (rootLevelId = Province); population
  lives on plots (rootLevelId = 'plot'). When a boundary type is
  deleted, schemas rooted at it promote to that type's parent — the
  type whose `primitiveId` pointed at it — so data stays at a
  higher / more-aggregate level rather than sliding down. Top-level
  deletions fall back to `'plot'`.
  *(Earlier scoping floated an `appliesTo: string[]` multi-select;
  superseded by the simpler single-root model on 2026-05-11. The
  multi-select would have been more flexible but the single root
  matches the natural "data lives at one level, rolls up" mental
  model for ~all real cases.)*
  *(Calculated and Overpass-derived property sources — formerly
  scoped here as Brick 9c / 9d — were moved to Phase 8 in the
  2026-05-11 plan refresh. See below.)*

### Phase 4 — Plot operations

- **Brick 11** — Manual plot split editor. User draws a cut line on a
  plot → two plots. UI for property redistribution: numeric properties
  default to area-proportional split with manual override; categorical
  inherits to both; percentage recomputes from its denominator. Show
  the two new plots' areas (and population once Brick 17 lands) to help
  electorate-style splitting decisions.
- **Brick 12** — Land/water mode. Fetch coastlines (`way` with
  `natural=coastline`) and water relations from OGF, cache them as
  `data.waterCache`, and use that geometry to shape plot polygons at
  creation time. The project's `data.settings.landWaterMode` is set
  at save creation and is read-only after — it picks one of four
  shapes for what a "plot" geometrically is:
    - `'land_only_sea_water'` (default) — clip against sea AND inland
      water; the plot is land.
    - `'land_only_sea'` — clip against sea only; inland lakes stay
      part of the plot.
    - `'water_only'` — keep only the water portion.
    - `'combined'` — no clipping; legacy "as imported" behaviour.
  Every plot-creation path (Overpass import, boundary-merge
  subdivision, manual split) routes through `createPlotMaybeClipped`,
  which runs the proposed polygons through `clipPolygonsToMode` and
  rejects all-water imports with a toast. Properties live on the
  single resulting polygon — no per-portion storage, no
  `appliesTo` flag on schemas. The plot-split UI's area-proportional
  suggestions are land-area-weighted (relevant only under `'combined'`
  mode; the other modes already clip plots to a single portion).

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

### Phase 8 — Derived properties

By this point the user has weeks of real mapping behind them with
manual property values, plus boundary aggregation (10), choropleth
(13), the issues panel (14), the OGF round-trip (15/16), and the
population estimator (17). That's enough usage signal to design the
derived-property layer concretely instead of in a vacuum.

Both bricks share a new **Source** axis on the property schema:
`'manual'` (today's behaviour), `'overpass'`, `'calculated'`. The
schema editor grows a Source selector under Kind with source-
conditional fields below. Likely a dedicated "Derived properties"
subsection in the Properties tab once both have landed.

- **Brick 18** *(was Brick 9d)* — **Overpass-derived** property
  source. Built first because it's technically simpler (no language
  design) and its per-entity value cache is something Brick 19 will
  reuse. Per-property query template; spatial filter binds to the
  entity's polygon via Overpass `poly:` form (`{{geometry}}`
  placeholder substituted at fetch time). Result reduction: an
  "aggregator" picker — `count` / `sum of tag` / `average of tag` /
  `first tag value`. Manual "Refresh values" button on the schema;
  results cached alongside the property value (no auto-refresh).
  Counts against the existing Overpass rate-limit budget. Boundary
  roll-up: same default as manual — sum / weighted-avg per the
  schema's aggregation rule, *unless* the schema opts into "refetch
  for boundary geometry" (treat the boundary's own polygon as the
  query target instead of summing children).
- **Brick 19** *(was Brick 9c)* — **Calculated** property source. A
  property whose value is derived from a small expression referencing
  other properties.
  **Mini-language sketch:**
  - Refs: `{Property Name}` resolves per entity (plot / boundary).
    The virtual area schema is referenced as `{Area}` — every entity
    has one, no need to disambiguate "plot area" vs "boundary area".
  - Operators: `+ - * / % ** ( )`; comparison `> < >= <= == !=`;
    ternary `cond ? a else b`. (`%` is modulo / remainder; `**` is
    power-raising — `2 ** 10 → 1024`. Using `else` instead of `:` to
    make the branch boundary unambiguous — slightly unusual but more
    readable than the C-style colon. No separate `if()` function —
    the ternary covers it.)
  - Functions:
    - `min(a, b, …)`, `max(a, b, …)` — variadic.
    - `clamp(value, lo, hi)` — clamps `value` into the `[lo, hi]`
      range. Equivalent to `max(lo, min(hi, value))` but reads better
      in formulas that bound a derived result (e.g.
      `clamp({Pop density}, 0, 30000)`).
    - `abs(x)`.
    - `sum(a, b, …)`, `avg(a, b, …)` — variadic numeric helpers.
    - `round(value)` (to integer), `round(value, digits)` (to N
      decimals, negative digits round to tens/hundreds — `round(4657,
      -2) → 4700`). `ceil(x)`, `floor(x)`.
  - Literals: numbers; `"strings"` for categorical outputs.
  - Context refs we may want: `{my level}` for level-aware formulas.
  - Example calculated numeric (density per km²):
    `{Population} / ({Area} / 1000000)`
  - Example calculated categorical:
    `{Cows} > {Chickens} ? "cattle" else "poultry"`
  - **Open question — short-name aliases.** Should `{Pop}` work as
    shorthand for `Population`? Hardcoded aliases are fragile (user
    can rename / delete `Population`). Better: each schema grows an
    `aliases: string[]` field; the user declares short forms
    themselves. Schema editor would surface this as an "Aliases"
    text input. Refs in formulas resolve by name OR alias. Deferred
    decision — open to just "name your schema 'Pop' if you want
    short refs" instead, which is simpler.
  - **Open question — `{{Property}}` name-of operator.** Idea:
    double curlies return the schema *name* as a string literal, so
    formulas like `{Cows} > {Chickens} ? {{Cows}} else {{Chickens}}`
    produce `"Cows"` or `"Chickens"`. Useful when the output is
    categorical derived from numeric comparisons. Alternative:
    `argmax(a, b)` / `argmin(a, b)` return the *name* of the larger
    / smaller ref. Both are workable; we'll pick when we build.
  Cycle detection: extend the current `_propertyRefId` walker to walk
  every `{…}` ref in the formula's parsed AST, not just the single
  `weightPropertyId` / `denominatorPropertyId` pointer.
  Boundary roll-up: a calculated value on a boundary is computed from
  that boundary's resolved input properties — *not* aggregated from
  children. (i.e. density is computed from boundary's population and
  boundary's area, not summed from children's densities.)
  Synergy with Brick 17: the population estimator's density-preset
  logic is itself an early "calculated" use case. By building 17
  first we get a concrete worked example informing the language; by
  building 19 after we can optionally re-express 17's bootstrap as
  a built-in calculated formula.

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
- **Brick 5b** ✓ (PR open on `feature/brick-5a-subdivide`) — snap tolerance:
  configurable metres-to-degrees threshold stored in `data.settings.snapToleranceM`
  (default 10 m). Before Turf intersection, candidate vertices within tolerance
  of parent-plot vertices are snapped onto them, eliminating hairline slivers
  from independently-drawn OGF borders. Also: `parseImport` now prefers
  `name:<lang>` tags over `name=*` when a localised tag is present, using
  the current `_lang` value.
- **Brick 6a** ✓ (merged to main) — boundary entities, table-driven.
  `js/boundaries.js` data layer + Boundaries sidebar tab. Searchable/sortable
  list (Name / Type / Members / Area). Detail modal with editable name+notes,
  members list with Remove, type-locked-after-creation. Member picker modal:
  search-filtered, grouped by section (Plots first, then each boundary type
  in the type-chain below the parent). Enforces transitive containment +
  exclusivity. **v0.1.2 follow-ups:** (1) "Create as: Plot | Boundary [type]"
  selector in the import modal — when Boundary is chosen, each imported OGF
  relation is wrapped in a Boundary of the chosen type with its sub-plots as
  members; subdivision rewrites boundary plot-references to the new sub-plots.
  (2) Member promotion (inbetweener): claimed items render promotable when
  the claimer's type chain allows wedging the new boundary; on commit the
  item moves and the new boundary is inserted between claimer and item.
  No map rendering yet — that's Brick 6b.
- **Brick 6b** ✓ (superseded by 6c) — first cut of boundary map rendering
  used a multi-layer chip strip with stroke-only fills. Replaced in 6c
  by the hierarchical dropdown view; `resolveBoundaryGeometry` (the
  cached turf.union folder in boundaries.js) survived from 6b.
- **Brick 6c** ✓ (PR open on `feature/brick-6a-boundaries`) — hierarchical
  map view + import absorption. The Map tab uses a single dropdown that
  picks one boundary type to display (largest first by `primitiveId`
  depth, plus a synthetic "Plots" option at the bottom for the flat
  plot view). At root the map renders every boundary of the chosen
  type filled in the type's color, like plots are rendered. Drilling
  via double-click STACKS additional levels on top: the dropdown's
  level stays visible underneath, the drilled-into boundary's direct
  members render on top, and each subsequent dblclick adds another
  level (so 3+ depth-levels can coexist on the map). Single-click on
  any polygon spawns a Leaflet popup with name / type chip / area /
  "Open details" button (the button promotes to the full detail
  modal); a 240 ms debounce defers the popup so dblclick on a
  boundary can cancel it cleanly. Breadcrumb above the dropdown
  returns to any ancestor view. On import-as-boundary,
  `resolveBoundaryMembersForPlots` (boundaries.js) performs greedy
  largest-first absorption: an imported Province whose plots are
  fully covered by existing Municipalities becomes a Boundary whose
  members are those Municipalities, not the raw plots. Subdivide
  step 5 then runs each proposed member through `promoteMember`,
  filtering out members whose claimer can't transitively contain the
  new boundary's type — this is what makes the locality-inside-
  municipality import work (locality boundary claims the new sub-plot
  from its parent municipality).
- **Brick 7** ✓ (merged to main) — Settlements. Import OGF `place=*` nodes
  via Overpass; one parent per settlement (plot or boundary); markers,
  list view, edit/delete. Brick 7d added a sortable/searchable table +
  detail modal (auto-save, parent picker, auto-assign, delete). v0.2.7
  polish: `autoAssignSettlementParent` first looks for a same-named
  containing boundary (largest-first), falling back to the existing
  smallest-region logic — fixes the canonical OGF case where a
  `place=city` node and its `boundary=administrative` polygon share a
  name. Not load-bearing for aggregation.
- **Brick 8** ✓ (PR open on `claude/brick-8-start-qJz0D`) — property
  schema editor. New `js/properties.js` data layer + Properties sidebar
  tab. Three kinds: numeric (sum / weighted-average + weight property
  ref), categorical (opt-in distribution roll-up), percentage (with a
  numeric denominator ref). Add/Edit modal with kind-conditional
  fields; kind locked on edit (Brick 9 hedge). Validation: unique
  case-insensitive name, refs must be numeric, no self-ref, no cycles
  in the combined weight/denominator graph. Delete blocked if any
  other schema references the target as weight or denominator (the
  toast names dependents). `bootstrapPropertySchemas()` seeds two
  starter properties on first visit: Population (numeric/sum) and
  Predominant language (categorical/no-rollup) — chosen lean so the
  list isn't empty but every other property is user-defined. No plot
  values yet (Brick 9), no boundary aggregation yet (Brick 10).
- **Brick 9** ✓ (PR open on `claude/brick-8-start-qJz0D`) — property
  values on plots. Plot detail modal grew a **Properties** section
  with one row per schema. Numeric / categorical rows = single input
  with auto-save on blur. Percentage rows = two inputs (raw + %)
  linked live: typing in either updates the other from the current
  denominator value, the typed side is recorded as the "source of
  truth" (`{ mode, value }`), and changes to the denominator preserve
  the source while re-deriving the linked side. Source input is
  accent-bordered so it's obvious which side is authoritative.
  Storage on plot.propertyValues keyed by schema id: bare number /
  bare string / `{ mode: 'raw' \| 'percent', value }`. Empty input
  deletes the entry (no `''`/NaN persisted). `deletePropertySchema`
  now cascades to clear every plot's value for the deleted schema.
  Boundary user-set values + the override semantics arrive in Brick 10.
- **v0.4.1** ✓ (polish on Brick 9) — three UX tweaks:
  1. **Percentage rows nest under their denominator** in the plot
     detail modal. Visual indent + left-border connector. The redundant
     "of {name} = {value}" hint is dropped when the parent row sits
     directly above; the "denominator unset" / "no denominator schema"
     notes still surface. Orphan percentages (broken denom ref) collect
     under a small subheader at the bottom of the section.
  2. **`Plot area` as a virtual denominator** — new
     `AREA_VIRTUAL_ID = '__plot_area__'` in properties.js. The
     percentage schema editor's denominator dropdown lists "Plot area
     (computed)" pinned to the top. `findPropertySchema` returns a
     synthetic schema for the id; `resolveNumericValueForPlot`
     special-cases it to `plotArea(plot)` (m²). Plot detail modal now
     also shows Area as a read-only row at the top of the Properties
     section so users can see what their `% urbanised`-style children
     are pulling from. On boundaries (Brick 10) the same magic id
     should resolve via `boundaryArea(boundary)`.
  3. **Categorical inputs gain a `<datalist>`** populated from every
     distinct value already in use for that schema across all plots.
     Native browser autocomplete fights typos when reusing the same
     category across plots. *(Replaced in v0.4.2 with the BRIXY-style
     typeahead.)*
- **v0.4.2** ✓ (polish round 2) — three more tweaks:
  1. **Unit-as-suffix.** Schema's `unit` no longer renders as a chip
     next to the name. It's a trailing `.input-suffix` span inside the
     input frame (`.input-with-suffix`), so the unit reads as part of
     the value. Percentage rows get two wrappers (raw side suffixed
     with denom unit, percent side suffixed with `%`); the trailing
     `%` glyph between inputs is gone, replaced with a single `=`
     separator. Source-of-truth accent moves to the wrapper via
     CSS `:has()`. The Plot area read-only row keeps its "computed"
     chip in the label slot — that's behaviour intel, not a unit.
  2. **Native typeahead.** New `js/typeahead.js` — a search dropdown
     modeled on BRIXY's `nodePicker*`. Adapted for **free-text accept**
     so categorical inputs accept novel values (Enter commits typed
     value when no option is highlighted). Arrow keys / Enter / Esc /
     outside-click. Mousedown on dropdown items (not click) beats the
     input's blur. Generic component — wired via `optionsFnName` and
     `commitFnName` data attrs looked up on `window`. Replaces the
     browser `<datalist>` on categorical rows. CSS classes:
     `.typeahead`, `.ta-input`, `.ta-dropdown`, `.ta-item`,
     `.ta-item.highlighted`, `.ta-empty`. Reusable for future selectors.
  3. **Percentage-of-percentage.** Schema editor's denominator dropdown
     now lists percentages alongside numerics (and the virtual
     `Plot area`). New `getDenominatorPropertyOptions` keeps weight
     references numeric-only via the existing
     `getNumericPropertyOptions`. Validation: `kind === 'numeric' ||
     kind === 'percentage'`. The existing
     `resolveNumericValueForPlot` already recurses through chains so
     `Population → % Urban → % Spanish in urban` resolves bottom-up.
     Plot detail modal renders chained percentages with depth-first
     `renderChildren` (ancestors set guards against cycles).
     `_refreshDependentPercentageRows` walks dependents transitively.
- **v0.4.3** ✓ (polish round 3) — three more tweaks:
  1. **Typeahead dropdown background fix.** v0.4.2's `.ta-dropdown` was
     styled `background: var(--bg-card)` — a token that doesn't exist
     in the palette, so the dropdown rendered transparently over the
     modal. Now `var(--bg-input)` (the same shade as input fields), and
     highlighted/hovered items get `var(--bg-hover)` for a visible
     contrast. Items themselves also carry the bg so they don't show
     through to the modal underneath.
  2. **Plot area → Area.** The virtual schema's user-facing `name`
     changed from `"Plot area"` to `"Area"` — every entity (plot
     *or* boundary) has one, no disambiguation needed. The underlying
     `AREA_VIRTUAL_ID` id (`__plot_area__`) is unchanged so loaded
     saves don't break. L10n `plot_detail.area_label` also flipped to
     "Area". Brick 9c scoping refs accordingly switched from
     `{Plot area}` to `{Area}`.
  3. **Auto-round on numeric schemas.** New schema field `autoRound:
     boolean` (numeric kind only). On: the property's values are
     stored / displayed as integers — rounding happens on commit
     (`onPlotPropertyBlur`, `onPlotPropertyPercentBlur` for the raw
     side) and in `derivePercentageDisplay` / `resolveNumericValueForPlot`.
     New helper `_effectiveAutoRound(schema)` walks a percentage's
     denom chain to the terminal numeric — so `% Urban` of an
     auto-rounded Population also rounds its raw side without needing
     its own flag. Defaults: **on** for the bootstrapped Population
     (because half-people don't exist) and the virtual Area schema;
     **off** for any newly-created numeric (user opts in via the
     schema editor's "Round to whole numbers" checkbox).
- **Brick 10c** ✓ (PR open on `claude/brick-8-start-qJz0D`) — aggregation,
  override semantics, mismatch flags. Closes Brick 10.
  New "effective value" semantics in `js/properties.js`:
  `resolveEffectiveForPlot` (just user-stored — plots are leaves) and
  `resolveEffectiveForBoundary` (user-set if any, else rolled up from
  members; `visited` set guards cycles). Roll-up rules per kind:
  numeric/sum sums members, numeric/weighted_average uses the
  `weightPropertyId` schema, percentage sums raws and divides by the
  boundary's effective denominator, categorical-with-distribution
  returns `Map<value, count>`, categorical-no-rollup returns null.
  `resolveNumericValueForBoundary` and
  `derivePercentageDisplayForBoundary` now resolve denominators via
  the Effective resolver so a `% Urban` row sees rolled-up Population
  as its denom on a Province. Mismatch detection via
  `classifyRollupMismatch(userVal, rollupVal)` → `'match' | 'under' |
  'over' | null` with floating-point tolerance. UI: each boundary
  property row gets a `.plot-property-rollup-hint` wrapper with
  `data-rollup-container=<schemaId>` so we can refresh in place; at
  the schema's root level the wrapper renders empty (CSS `:empty`
  hides it). Above-root rows show a "Rolled up: …" hint plus a
  mismatch badge: match (green), under (accent red, bold — critical
  per spec), over (warn yellow — acceptable per spec).
  `_refreshAllBoundaryRollups()` re-renders every rollup block on any
  value commit (cheap full sweep — handles denom-cascade across
  percentages without exact dep tracking).
  Categorical distribution-of-distributions is deferred; central
  issues panel arrives in Brick 14.
- **Brick 10b** ✓ (PR open on `claude/brick-8-start-qJz0D`) — boundary
  inspector with property values. Boundary detail modal grows a
  Properties section parallel to the plot one (same row layout,
  suffix-styled units, percentage chains, typeahead categoricals,
  auto-rounding, Area row at top). New `appliesAtLevel(schema, levelId)`
  helper walks the primitiveId chain downward from levelId — used to
  filter both plot and boundary inspectors (plot inspector refactored
  to use it too). New data-layer parallels in `js/properties.js`:
  `getBoundaryPropertyValue` / `setBoundaryPropertyValue` /
  `clearBoundaryPropertyValue`, `resolveNumericValueForBoundary`,
  `derivePercentageDisplayForBoundary`. Parallel view-layer functions:
  `_renderBoundaryPropertyRows` / `_renderBoundaryAreaRow` /
  `_renderBoundaryPropertyRow`, `onBoundaryPropertyBlur` /
  `onBoundaryPropertyPercentInput` / `onBoundaryPropertyPercentBlur`,
  `_refreshDependentBoundaryPercentageRows`. Cross-entity:
  `_collectCategoricalValues` walks both plots and boundaries (so
  typeahead suggestions are consistent across entities);
  `deletePropertySchema` cascades to boundary values. Still deferred
  to 10c: aggregation engine, override visual cue, mismatch flags.
- **Brick 10a** ✓ (PR open on `claude/brick-8-start-qJz0D`) — Brick 10
  schema-side prerequisite. Property schemas gain `rootLevelId`
  (default `'plot'`). Schema editor grows a "Defined at" dropdown
  between Kind and the kind-specific block, options: Plot, then
  every boundary type in hierarchy order (smallest-containers-first,
  matching the Boundary Types tab). New helper
  `boundaryTypesInHierarchyOrder()` lives in `boundaries.js` and
  walks reverse-`primitiveId` from the type with `primitiveId=null`
  upward. Plot inspector filters its property rows to schemas with
  `rootLevelId === 'plot'`. Properties-tab Behaviour column gains a
  small accent-tinted "Defined at: \<type\>" chip when the schema is
  rooted at a boundary type (Plot-rooted schemas stay quiet — keeps
  the table calm for the common default). On boundary-type deletion,
  schemas rooted at the deleted type **promote to that type's parent**
  (a type whose `primitiveId` pointed at it) — least-impact relink so
  data stays at a higher / more-aggregate level rather than sliding
  down. Top-level deletions fall back to `'plot'`. Bootstrap fills in
  `rootLevelId: 'plot'` explicitly on Population + Predominant
  language. No boundary-side rendering or aggregation yet — that's
  Brick 10b / 10c.
- **Brick 11** ✓ (PR open on `claude/phase-4-start-ERSAM`) — manual
  plot split editor. Two split flavours, both routed through a
  shared two-step modal. **Cut-line** (contiguous plots): user clicks
  a multi-vertex polyline on an inset Leaflet; the cut must enter and
  exit the outer ring exactly twice. `js/split.js` (new) drives the
  geometry: `turf.lineIntersect` finds the ring crossings (deduped
  for vertex-coincident hits), `turf.nearestPointOnLine` projects
  them onto both the ring and the cut to get distance parameters,
  `turf.lineSliceAlong` cuts the two ring arcs + the in-polygon cut
  segment, and each piece is reassembled by joining an arc to the cut
  in alternating orientations. Holes ride along with whichever piece
  contains their first vertex. **Component** (non-contiguous plots):
  each polygon in `resolvePlotGeometry().polygons` becomes its own
  new plot; no drawing. The modal auto-picks the mode by inspecting
  the plot's geometry. Cut-line on a non-contiguous plot is rejected
  with a translated toast (split into pieces first). `executeSplit`
  reuses `storeSubdivisionGeometry` for OSM write-back, rewrites
  boundary `members` (any boundary holding the old plot as a direct
  member gets the new plot ids in its place), nulls `ogfRelationId`
  on the new plots (Brick 16 re-sync re-attaches), and invokes
  `invalidateBoundaryGeometry()` which re-anchors settlements.
  Property redistribution proposed by `proposePlotSplitValues` in
  `properties.js`: numeric (sum AND weighted_average) split area-
  proportionally; categorical inherited to all pieces; percentage
  in mode='percent' inherited verbatim (raw side re-derives via the
  smaller effective denominator at read time), mode='raw' split
  area-proportionally. Weighted-average gets the same area-
  proportional treatment for v1 — Phase 7's population estimator
  will add nuance, and densities will live as calculated properties
  (Brick 19), so splitting raw values linearly works as the v1
  default. Step 1 (input) and Step 2 (preview + redistribute) share
  one modal; `← Back` preserves the cut. Map-side helpers
  (`ensureSplitMap`, `drawSplitPlot`, `drawSplitCut`,
  `drawSplitPieces`, `destroySplitMap`) mirror the detail-map
  pattern. L10n under `plot_split.*`. **v0.7.1 fix:** snap cut/arc
  endpoints to the canonical `xPts` from `turf.lineIntersect` so
  the two pieces share pixel-identical coords along the seam (else
  `turf.union` later leaves a 1e-12-tall sliver visible in parent
  boundary geometry). **v0.7.2 overhaul:** modal replaced with a
  full-viewport takeover (`#split-overlay` in `appymanager.html`,
  `.split-overlay*` CSS) so the map gets ~the whole screen; single
  live view replaces the two-step flow (every cut change
  immediately recomputes pieces + redistribution); cut polyline is
  interactive — click empty map appends, click on the cut polyline
  inserts at the closest segment, drag a vertex marker
  repositions, right-click removes; `manualOverrides` Set keeps
  user edits to names + redistribution cells stable across live
  recomputes; map.js gained `drawSplitCutPath` + `drawSplitVertices`
  + `clearSplitPieces` (replacing `drawSplitCut`), and a
  `_splitMapBoundsSet` flag so `fitBounds` runs once per overlay
  open. `interactive: false` on the pieces polygons routes clicks
  through to the cut polyline / map.
  **v0.7.3 follow-up:** crash fix (Leaflet's `dragend` event has no
  `latlng`; `_onSplitVertexDragEnd` now reads `e.target.getLatLng()`,
  same for `_onSplitVertexDrag` — the v0.7.2 throw was leaving
  `_splitDraggingVertex` set, which silently froze the vertex layer
  so subsequent appends rendered nothing); ghost midpoint markers
  (`.split-vertex-ghost`) — clickable to insert at midpoint; property
  overrides split out into a second "override" phase with per-piece
  cards (vertical layout, full-width inputs) — primary header button
  now reads "Continue →" in cut phase and "Confirm split" in override
  phase, dispatched via `onSplitPrimaryAction()`; `← Back to cut`
  link in the override panel preserves `manualOverrides` across the
  round-trip. `_renderSplitProposedTable` replaces the editable redist
  table in cut phase with a compact read-only preview.
  **v0.7.4 polish:** ghosts are now `draggable: true` (drag inserts at
  dragstart and trails the cursor until release; plain click still
  inserts at midpoint; Leaflet's drag threshold disambiguates).
  Real-vertex and ghost markers moved to separate Leaflet layers
  (`_splitVertexLayer` + `_splitGhostLayer`) so `_refreshSplitMap`
  can freeze whichever layer is being grabbed and redraw the other —
  ghost midpoints now follow real-vertex drags live. New
  `_splitHoverLayer` + `mousemove`/`mouseout` wiring shows a dashed
  preview line from the cut's nearest endpoint to the cursor; the
  empty-map-click handler also extends from the nearest endpoint
  (`unshift` vs `push` based on `_pointDistance`), so the preview
  matches the click outcome.
  **Deferred to Brick 11b** (multi-cut + piece grouping + cut on
  non-contiguous plots): the v0.7.4 hover-preview line is a touch
  visually noisy; will likely be tamed when 11b reworks the cut model
  anyway. Filed there with the other multi-cut items.
- **Brick 12a** ✓ (committed) — coastline + inland-water ingest.
  New `js/landwater.js` module. `fetchAndCacheWater()` runs a single
  Overpass query scoped to the project's plot-union bbox + 10%
  padding, then builds water geometry in three stages:
  (i) **sea** from `natural=coastline` ways — stitch into chains
      preserving node order (land-on-left), closed CCW loops →
      islands (subtracted later), closed CW loops → inland seas,
      open chains clipped to bbox and closed via a bbox-edge walk on
      the chain's right (sea) side with right-side-test-point
      disambiguation between CW/CCW closures;
  (ii) **inland water** from `natural=water` ways (self-closed)
      and `type=multipolygon` relations (outer + inner via
      `groupWaysIntoRings`);
  (iii) **merge + threshold** — union touching shapes into
      connected components, drop any below
      `data.settings.minWaterBodyAreaM2` (default 1 ha). Merge
      happens BEFORE the threshold so the user-requested behaviour
      "tiny puddle next to big lake stays, but two abutting tiny
      puddles both go" falls out for free. Cached as
      `data.waterCache = { fetchedAt, bbox, waterGeometry, bodyCount }`.
      `EMPTY_DATA` / `data` init in persistence.js / core.js know the
      shape. Settings tab grew a "Land / water split" card with
      enable toggle (auto-fetches on first enable), min-area input,
      fetch button, last-cache summary, and a "Show fetched water
      on map (debug)" overlay toggle — `_mapWaterDebugLayer` in
      map.js renders the cached `[lng,lat]` polygons under the plot
      layer for visual verification before 12b's per-plot work.
      v1 limitations filed: open chains entirely inside the bbox
      are skipped; reverse-attaching ways during stitching is
      avoided to preserve land-on-left.
- **Brick 12b** ✓ (committed) — per-plot land/water intersection +
  map render. `js/landwater.js` grew `_computePlotLandWater(plot)`
  which intersects the plot polygon with `data.waterCache.waterGeometry`
  via `turf.intersect` / `turf.difference` and returns
  `{ land, water }` Features. In-memory cache (`_landWaterByPlot`)
  keyed by plot id; invalidated on water-cache refresh, plot delete,
  plot split (`executeSplit`), and boundary-import subdivision.
  `_drawPlotPoly` in map.js is now split-aware: when the project
  split is enabled AND a water cache exists AND the plot has water,
  `waterDisplayMode === 'split'` (default) draws the full plot
  polygon plus a non-interactive blue water overlay; `'removed'`
  clips the rendered polygon to land only (clicks on the water
  region no longer select the plot — conceptually the water is
  outside the plot's effective extent). `waterDisplayMode` is a
  **map-wide** project setting (`data.settings.waterDisplayMode`),
  surfaced as one checkbox in the Land/water settings card.
  v0.8.3 originally wired this as a per-plot toggle in the plot
  inspector; user-flagged in v0.8.4 review (would be tedious to set
  across a whole country) and rewritten as the single map-wide
  setting. Future data views (Brick 13+) will each carry their own
  equivalent view-level toggle. Persisted-cache + plotArea +
  property-side changes deferred to 12c / 12d.
- **Brick 12c** ✓ (committed) — split-aware property values + inspector
  UI. Wired `appliesTo: 'land' | 'water' | 'both'` on schemas and
  `propertyValuesLand` / `propertyValuesWater` on plots. v0.8.6
  added Land + Water rows on plot Area; v0.8.8 cascaded it to
  boundary rendering and the boundary Area row. **Superseded by
  Brick 12d** — see entry below.
- **Brick 12d** ✓ (committed, v0.9.0) — pivot to land-only by
  default; dual-storage portion model removed.
  - `data.settings.landWaterMode` set at save creation, immutable:
    `'land_only_sea_water'` (default) | `'land_only_sea'` |
    `'water_only'` | `'combined'`. New-save modal in
    `persistence.js#newProject` exposes the picker; the settings
    card shows it read-only.
  - `clipPolygonsToMode(polygons, mode)` in `landwater.js` is the
    single chokepoint. `createPlotMaybeClipped` in `plots.js`
    wraps `createPlot` with the clip + all-water rejection. Wired
    into Overpass import (`subdivide.js`), boundary-merge
    subdivision, and manual split (`split.js`). The water cache
    now stores `seaGeometry` and `inlandGeometry` separately so
    `'land_only_sea'` can clip against sea alone; the merged
    `waterGeometry` stays as the union view used by the overlay
    and the other clipping modes.
  - `reclipAllPlotsToMode` walks every plot and rewrites its
    `outers`/`inners` against fresh local-id ways from
    `storeSubdivisionGeometry`. Fires automatically once on load
    after the v1→v2 migration when the resolved mode actually
    clips and a water cache is present; surfaced in the settings
    card as a "Re-clip existing plots" button for use after a
    coastline re-fetch.
  - Migration (`persistence.js#migrateData`): folds
    `propertyValuesLand` into `propertyValues` (land wins on
    conflicts; water-only entries dropped), deletes `appliesTo`,
    `landWaterSplitEnabled`, `waterDisplayMode`,
    `showWaterDebugOverlay`, `waterDisposition`. Schema version
    bumps to `2`.
  - Stripped: `getPlotLandWater`, `getBoundaryLandWater`,
    `_landWaterByPlot`, `_landWaterByBoundary`, the
    `_portionsForPlotSchema` decision tree, the dual-row Area
    render on both plot and boundary inspectors, the schema
    editor's "Applies to" dropdown, the split path in
    `_drawPlotPoly` / `_drawBoundaryPoly`. The water layer is now
    just a project-level overlay (`data.settings.showWaterOverlay`,
    default `true`).
  - Plot-split numeric redistribution: under `'combined'` mode with
    a water cache, each piece's land area is computed at
    suggestion time so a piece that's mostly lake doesn't take a
    disproportionate share. Other modes already produce land-only
    pieces so `p.area` is the right basis.
  - Tradeoff: the land-on-left convention is trusted strictly (per
    the v0.8.7 simplification). Any coastline drawn water-on-left
    inverts its mode classification.

### Phase 3 — Properties — **complete** (2026-05-11)

Bricks 8, 9, 10 are in. The properties pipeline runs end-to-end:
schema editor → values on plots → values on boundaries → aggregation
with override + mismatch flags. The central issues panel listing
project-wide flags is Brick 14's job; that's the only thing
referencing back at this layer.

**Open questions for Phase 4 (plot operations)** — flagged here so
they're visible when we kick off Brick 11:

- **Plot split + numeric property redistribution.** Plan says
  "area-proportional split with manual override." Need a UI that
  shows the proposed split and lets the user tweak before commit.
  Easy for `sum`-aggregated numerics; less obvious for
  weighted-averages.
- **Plot split + percentage property.** A `% Urban` value of 30%
  on a plot, after a cut that puts a city in the right half and
  fields in the left — the percentages on the two new plots are NOT
  30% each. Either we (a) ask the user to set both sides, (b) default
  to keeping the percent and silently re-deriving raw from the
  smaller plot's denom, or (c) try to be clever about which side the
  urbanised area is on. (b) is the simplest correct default; (c)
  is hard without semantic data.
- **Plot split + boundary aggregation.** When a plot splits into
  two, parent boundaries still need to reference the right plots
  in their `members` list. The split flow has to rewrite member
  references (parent ends up with both halves instead of the
  original). Aggregation re-runs naturally after that.
- **Land/water split (Brick 12).** Plan says "Properties can be set
  independently on land vs. water portions when the split is on."
  That's effectively a third axis on top of (entity, schema).
  Likely needs storage like `propertyValuesLand` /
  `propertyValuesWater` and adjustment to the inspectors + the
  aggregation engine. Worth scoping properly before building.

None of these block 10c's correctness — they're design calls for
when we get to Phase 4. Filed here so future-Claude doesn't
rediscover them cold.
