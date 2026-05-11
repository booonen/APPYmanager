## 0.5.1 — Branching-hierarchy warning on boundary-type delete
Polish on the v0.5.0 schema-promotion-on-type-delete behaviour. When a
boundary type has multiple parents (a branching hierarchy) AND there
are schemas rooted at that type, the deletion confirm dialog now
appends an explicit heads-up:
- Names the affected schemas.
- Names the "winner" parent (the one the schema's rootLevelId promotes
  to — first deterministically).
- Names the "loser" parent(s) — sibling parents that won't receive the
  promotion.
- Notes that property values on the loser branch's boundaries become
  hidden (still in the save file, but not surfaced).
- Suggests re-rooting manually after deletion if needed.

Pre-emptive — once Brick 10b/10c land and boundaries can carry
property values, this warning protects users from quietly losing data
on the non-promoted branch. Doesn't change any current behaviour
(boundary values don't exist yet); just makes the future failure mode
visible. New l10n key: `boundary_types.confirm_delete_branching_schemas`.

## 0.5.0 — Brick 10a: rootLevelId schema field
First sub-step of Brick 10 (property aggregation on boundaries). Pure
schema-side prerequisite — no boundary-side rendering or aggregation
engine yet (those land as 10b and 10c).

- **New schema field `rootLevelId`** (default `'plot'`). The boundary
  level where a property is normally recorded. Replaces the
  multi-select `appliesTo` model floated earlier on 2026-05-11 — the
  single-root version is much simpler and matches the natural "data
  lives at one level, rolls up" mental model. The rule for whether
  a property appears at level T: T must be `R` itself, or `R` must
  be reachable from T downward through the `primitiveId` chain.
  Smaller-than-R and unrelated-chain levels don't show the row.
- **Schema editor: "Defined at" dropdown** between Kind and the
  kind-specific block. Options: Plot (the implicit default, pinned at
  the top), then every boundary type in hierarchy order
  (smallest-containers-first, mirroring the Boundary Types tab).
  Powered by new helper `boundaryTypesInHierarchyOrder()` in
  `boundaries.js` — walks reverse-`primitiveId` from the type with
  `primitiveId=null` upward.
- **Plot inspector filter.** The plot detail modal's Properties
  section now hides any schema with `rootLevelId !== 'plot'`. The
  "no properties defined" empty state still references the
  unfiltered schema list so the user doesn't get a misleading message
  when they've got boundary-only schemas defined.
- **Properties tab chip.** When a schema is rooted at a boundary
  type, the Behaviour column gets a small accent-tinted
  "Defined at: \<type name\>" chip. Plot-rooted schemas (the common
  default) show nothing — keeps the table quiet for the typical case.
- **Boundary-type deletion cleanup.** `deleteBoundaryType` now
  promotes any schema rooted at the deleted type to that type's
  *parent* (the type whose `primitiveId` pointed at it). Least-impact
  relink so data stays at a higher / more-aggregate level rather than
  sliding down into a smaller one. Top-level deletions (no parent)
  fall back to `'plot'`. Branching hierarchies: pick the first parent
  deterministically.
- **Bootstrap.** Population + Predominant language now seed with
  explicit `rootLevelId: 'plot'` (matches the default, but makes
  intent clear in the bootstrap code).
- **Migration.** Schemas loaded from older saves with no
  `rootLevelId` default to `'plot'` via the `|| 'plot'` fallback at
  every read site — no destructive migration.
- l10n: `properties.defined_at_label`, `defined_at_help`,
  `defined_at_plot`, `defined_at_chip`.
- CLAUDE.md: Brick 10 plan rewritten around the new model; the old
  `appliesTo` scoping note preserved as a "superseded" sentence so
  future-me can see why we picked this shape.

## 0.4.3 — Brick 9 polish round 3: typeahead fix, Area rename, auto-round
- **Typeahead dropdown background fix.** v0.4.2's `.ta-dropdown` was
  styled `background: var(--bg-card)` — a token that doesn't exist in
  the APPY palette, so the dropdown rendered transparently over the
  modal (unselected rows were invisible against the modal background).
  Switched to `var(--bg-input)` for the dropdown + items, and
  `var(--bg-hover)` for the highlight state, so hovered/keyboard-
  highlighted rows now stand out cleanly. Items themselves also carry
  an explicit background so they don't show through to whatever sits
  underneath.
- **Plot area → Area.** Renamed the virtual schema's user-facing name
  from "Plot area" to "Area". Every entity (plot or boundary) has one,
  so no need to disambiguate. The underlying `AREA_VIRTUAL_ID`
  (`__plot_area__`) stays put so saves from older versions still load
  correctly. The "Area" virtual now also carries `autoRound: true`
  (m² values are naturally integers for our purposes).
- **Auto-round on numeric properties.** New schema field
  `autoRound: boolean` (numeric kind only). When on:
  - Numeric input commit rounds the entered value to integer before
    storing — and reflects the rounded value back into the input so
    the user sees the snap.
  - Percentage's RAW side rounds via `_effectiveAutoRound(schema)`,
    which walks the denominator chain to its terminal numeric. So
    `% Urban` of an auto-rounded Population rounds its raw side
    automatically — no per-percentage flag needed.
  - `resolveNumericValueForPlot` and `derivePercentageDisplay` round
    via the same helper, so any downstream consumer (chained
    percentages, future boundary roll-up) sees the rounded value.
  - On commit of the percent side: no rounding (percent values are in
    %, not subject to this flag).
  - On commit of the raw side: round via `_effectiveAutoRound`, then
    re-derive the percent sibling from the rounded raw.
  Defaults: **on** for the bootstrapped Population schema and the
  virtual Area schema; **off** for new user-created numerics. The
  schema editor's numeric kind block gains a "Round to whole numbers"
  checkbox (with explanatory help text).
- CLAUDE.md: Brick 9c scoping refined per discussion —
  - `{Plot area}` → `{Area}` (matches the rename).
  - Ternary uses `? else` instead of `? :` (more readable; no separate
    `if()` function).
  - `round(value, digits)`, `ceil`, `floor`, `avg` added to the
    proposed function list.
  - Two **open questions** flagged:
    - `{Pop}` shorthand for `Population` — fragile if hardcoded.
      Proposed: per-schema `aliases: string[]` declared by the user.
    - `{{Property}}` to return the schema's name as a string literal
      (for "predominant animal"-style outputs). Alternative:
      `argmax / argmin` returning the name of the larger / smaller ref.

## 0.4.2 — Brick 9 polish round 2: unit-suffix, typeahead, percentage chains
- **Unit-as-suffix.** The schema's `unit` no longer sits as a chip next
  to the property name. It's rendered *inside* the input frame as a
  trailing suffix span (`.input-with-suffix` / `.input-suffix`), so the
  unit reads as part of the value the user is typing. Numeric rows get
  one wrapper; percentage rows get two (raw side suffixed with the
  denominator's unit, percent side suffixed with `%`). The redundant
  trailing `%` glyph between the two inputs is gone — replaced with a
  single `=` separator. Source-of-truth highlight (accent border on
  the side the user typed into) moves to the wrapper via `:has()`.
  The Plot area read-only row keeps its "computed" chip in the label
  slot — that chip is intel about the row's behaviour, not a unit.
- **Native typeahead.** New `js/typeahead.js` — a search-as-you-type
  dropdown modeled on BRIXY's `nodePicker*`, adapted for free-text
  accept so categorical inputs can record values that don't appear in
  the suggestions list. Arrow keys navigate (↑ / ↓), Enter commits
  (highlighted option if any, else the typed value), Escape dismisses,
  outside-click dismisses, mousedown on a dropdown item beats the
  input's blur so the click registers cleanly. Replaces the
  browser-default `<datalist>` on every categorical row. CSS classes:
  `.typeahead`, `.ta-input`, `.ta-dropdown`, `.ta-item`,
  `.ta-item.highlighted`, `.ta-empty`. The component is generic — wired
  by passing `optionsFnName` and `commitFnName` as data attrs, looked
  up on `window` at runtime. First user is categorical property
  values; reusable for future selectors.
- **Percentages can now be denominators of other percentages.** Schema
  editor's denominator dropdown now lists both numerics and percentages
  (alongside the virtual `Plot area`). `getDenominatorPropertyOptions`
  is the new fn (the existing `getNumericPropertyOptions` stays as the
  weight-reference source — weighting by a percentage is conceptually
  strange). Validation accepts `kind === 'numeric' || kind ===
  'percentage'`. Chains like `Population → % Urban → % Spanish in
  urban` resolve bottom-up via the existing
  `resolveNumericValueForPlot` recursion. The plot detail modal
  renders chained percentages nested recursively (`renderChildren`
  walks the children-by-denominator map depth-first; `ancestors` set
  guards against cycles).
  `_refreshDependentPercentageRows` similarly walks dependents
  transitively so a change to A re-derives B (% of A), then C (% of B),
  etc.
- l10n: new `typeahead.no_match` ("No matches — press Enter to use as
  a new value."), renamed `error_denominator_not_numeric` to
  `error_denominator_invalid` with updated copy, updated
  `denominator_help` to mention percentage chains.

## 0.4.1 — Brick 9 polish: nesting, Plot area, categorical autocomplete
- **Percentage rows nest under their denominator** in the plot detail
  modal. Visual indent + left-border connector make it obvious which
  numeric a percentage is pulling from. The redundant
  "of {name} = {value}" hint is dropped when the parent row sits
  directly above; the "denominator unset on this plot" and "no
  denominator schema" notes still surface (they describe problems the
  user needs to act on). Orphan percentages whose denominator schema
  was deleted or never linked collect under a small subheader at the
  bottom of the section.
- **`Plot area` as a virtual denominator** — new `AREA_VIRTUAL_ID =
  '__plot_area__'` in `js/properties.js`:
  - `findPropertySchema` returns a synthetic numeric schema
    (`name: 'Plot area'`, `unit: 'm²'`, `__virtual: true`).
  - `getNumericPropertyOptions` prepends the virtual so it's
    selectable as a percentage denominator in the schema editor.
  - `resolveNumericValueForPlot` special-cases the virtual id and
    returns `plotArea(plot)` (m²).
  - `_propertyRefSelect` (schema editor dropdown) pins virtual entries
    to the top of the list with a "(computed)" suffix.
  - Plot detail modal now also surfaces Area as a read-only row at the
    top of the Properties section, so the user can see what their
    `% urbanised`-style children pull from.
  - Brick 10 will need a parallel `resolveNumericValueForBoundary`
    that returns `boundaryArea(boundary)` for the same magic id.
- **Categorical inputs gain a `<datalist>`** populated from every
  distinct non-empty value already in use for that schema across all
  plots (the in-flight value on this plot is included too so it shows
  up immediately). Native browser autocomplete — fights typos when
  reusing the same category across plots.
- New CSS: `.plot-property-row-readonly`, `.plot-property-row-nested`,
  `.plot-property-subhead`.
- CLAUDE.md log + long-term plan updated: **Brick 9c (Calculated source)**
  and **Brick 9d (Overpass-derived source)** added as deferred bricks
  with brief scoping notes — both need a design session before we
  build (expression language, query templates, refresh semantics,
  rate-limit accounting).

## 0.4.0 — Brick 9: Property values on plots
- Plot detail modal gains a **Properties** section listing every
  property schema with a kind-appropriate input. Auto-saves on blur
  (numeric / categorical) or live as you type (percentage).
- Storage: `plot.propertyValues = { [schemaId]: <value> }`. Shape per
  kind:
  - **numeric** → bare number
  - **categorical** → bare string
  - **percentage** → `{ mode: 'raw' | 'percent', value: number }`
- **Percentage UX** (the load-bearing piece): two inputs side by side.
  Type into either the raw amount or the %, and the other side derives
  live from the denominator's current value on this plot. Whichever
  side the user typed is the "source of truth"; the other re-derives.
  Changing the denominator's value updates the derived side while
  preserving the source. The source input is accented so the user can
  see which side is authoritative at a glance.
- Percentage row also surfaces context: schema name + unit chip,
  denominator name and current value, plus a warning if the
  denominator schema isn't set on this plot yet.
- New helpers in `js/properties.js`: `getPlotPropertyValue` /
  `setPlotPropertyValue` / `clearPlotPropertyValue`,
  `resolveNumericValueForPlot`, `derivePercentageDisplay`,
  `formatPropertyNumber`.
- **Cascade cleanup**: `deletePropertySchema` now walks all plots and
  drops any stored value for the deleted schema (no orphan entries).
  Boundary values arrive in Brick 10 — extend then.
- New CSS block (`.plot-property-row` / `.plot-property-input-percent`)
  and a `.plot-detail-section-label` to label the new section.
- Empty input deletes the value entirely; the modal will never persist
  a `''` or `NaN` placeholder.

## 0.3.0 — Brick 8: Property schema editor
- New "Properties" tab in the Geography section (after Settlements,
  before Map). Lists every property schema with Name / Kind /
  Behaviour / Unit columns plus per-row Edit and Delete.
- `js/properties.js` data layer:
  - `propertySchema` record: `{ id, name, unit, kind, notes,
    aggregation, weightPropertyId, rollupDistribution,
    denominatorPropertyId }`. Three kinds: numeric, categorical,
    percentage.
  - `bootstrapPropertySchemas()` seeds two starter properties on first
    visit: **Population** (numeric, sum, unit "people") and
    **Predominant language** (categorical, no rollup).
  - `createPropertySchema`, `deletePropertySchema`,
    `findPropertySchema`, `findPropertyDependents`,
    `getNumericPropertyOptions`, `describePropertyBehaviour`,
    `_hasPropertyRefCycle`.
- Add/Edit modal with kind-conditional fields:
  - **Numeric**: aggregation = sum or weighted-average; if weighted,
    pick a numeric weight property.
  - **Categorical**: opt-in "Roll up as distribution on boundaries"
    checkbox (off by default — matches CLAUDE.md decision).
  - **Percentage**: pick a numeric denominator property.
- Validation enforced on save:
  - Name required and unique (case-insensitive).
  - Weight / denominator must be an existing numeric property.
  - No self-reference; no cycles in the combined weight/denominator
    dependency graph (`_hasPropertyRefCycle`).
- Kind is locked on edit (data-integrity hedge — Brick 9 plot values
  shouldn't have to handle a numeric→categorical schema flip mid-flight).
- Delete is blocked when another schema references the target as
  weight or denominator; the toast names the dependents so the user
  can fix them first.
- Dashboard already had a Properties stat tile via
  `data.propertySchemas.length`; bootstrap now actually populates it
  on first visit.

## 0.2.7 — Settlement auto-assign: name-match boundary preferred
- `autoAssignSettlementParent(lat, lng, name)` gains a name-matching
  pass that runs before the existing smallest-region logic. Walks
  containing boundaries largest-type-first and returns the first
  whose `name` equals the settlement's `name` (case-insensitive,
  trimmed). When several levels match (e.g. Country, Province, and
  Municipality all named "Foo"), the largest wins so the settlement
  anchors to the most encompassing matching entity.
- Falls back to the existing logic (smallest containing plot, then
  smallest containing boundary) for nameless candidates and for
  settlements with no matching curated boundary.
- All three call sites (preview, reconcile, manual auto-assign) now
  forward the settlement's name.

## 0.2.6 — Brick 7d: Settlements table + edit modal (Brick 7 done)
- Settlements tab now has a sortable, searchable table mirroring the
  Plots tab. Sort columns: Name (alpha), Place (rank, so cities lead),
  Parent (display string), OGF Node ID (numeric). Search matches name,
  place, parent display, or ogfNodeId.
- Row click opens the new settlement detail modal:
  - Editable Name + Notes (auto-save on blur).
  - Place type dropdown (auto-save on change; recolours the marker).
  - Parent row with Change… / Auto-assign / Clear actions. Auto-assign
    runs `autoAssignSettlementParent`; Clear nulls the parent (next
    reconcile may re-claim it).
  - Read-only coords, OGF Node ID, settlement ID.
  - Delete button with `appConfirm`, drops the record, refreshes
    the table and map.
- Parent picker (sub-modal): search-filtered list of all plots +
  boundaries, current pick highlighted. Click commits and re-opens
  the detail modal.
- Settlement side panel grows the missing "Open full details" button
  linking to the new detail modal.

## 0.2.5 — Map tab polish: no-scroll layout + filter UX
- Map tab is now a true no-scroll layout. `#panel-map.active` flexes
  vertically with `overflow: hidden`; page header and toolbar take
  their natural heights and `.map-with-panel` flexes to fill the rest.
  `min-height: 0` on the map row lets it shrink rather than push the
  page below the viewport.
- The place filter is now a popover: its body is `position: absolute`
  below the trigger, so opening it never grows the toolbar or pushes
  the map down.
- Boundary "Show:" select and the place-filter trigger now share the
  uniform `.map-toolbar-control` class — both 220 × 32 px, same
  padding/border/colours — and sit on the same toolbar row.
- "All types" master checkbox added at the top of the chip strip.
  Tri-state: checked when every type is on, indeterminate when some
  are off, unchecked when none are. Toggling it flips the whole set.
  Replaces the previous All/None button pair.
- Filter dropdown stays open across selection changes. Tracked open
  state in `_placesFilterOpen` and reapplied on each toolbar render
  (otherwise the toolbar's innerHTML rebuild snapped `<details>` shut
  on every chip click).
- Hover z-order properly resets. We track settlement draw order in
  `_settlementMarkerOrder` and on unhover re-front every higher-rank
  marker so the previously hovered one returns to its proper layer.

## 0.2.4 — Settlement marker polish: JOSM colours, draw order, filter
- New `PLACE_COLORS` map in `js/settlements.js` — JOSM-style hues per
  `place=*`: city purple, town dark-orange, village orange, suburb
  yellow-orange, hamlet yellow, borough dark-green, quarter pink,
  neighbourhood tan, isolated_dwelling light-green, locality grey.
  Used by markers, side-panel chips, list-view chips, import preview,
  and the place-filter dropdown.
- `PLACE_RANK` controls draw order: settlements rendered smallest-rank
  first so cities sit above hamlets and so on. Same sort applies to
  the import preview map and the side-panel members lists.
- Bigger marker radii overall (city 12, town 10, village 8, … locality
  5). Selected and hover styles also bumped.
- New place-type filter in the Map toolbar: collapsible chip strip
  ("Places: 8/10 ▾") with a coloured dot + per-type count, plus
  All/None shortcuts. State persists under
  `data.settings.visiblePlaceTypes` (undefined = all visible).
- Hovering a settlement in the side panel calls `bringToFront()` on
  its marker so dense clusters stop occluding the highlight.
- Settlements section in the side panel auto-collapses when more than
  20 items would be rendered, avoiding lag on country-wide selections.

## 0.2.3 — Settlement parent reconciliation
- `reconcileSettlementParents()` in `js/settlements.js` sweeps the
  settlement list and (a) drops dangling parent references whose plot
  or boundary has been deleted, (b) re-runs `autoAssignSettlementParent`
  on any settlement at `parent: null`. Returns `true` when at least one
  parent changed.
- Hooked into `invalidateBoundaryGeometry` so it fires after every
  plot/boundary commit + delete. A settlement imported before its
  covering plot now auto-anchors as soon as that plot lands rather
  than sticking at "no parent (uncovered)" forever.
- Also runs once on app load (with `save()` if anything changed) so
  saves carrying stale parent state from before this fix get cleaned
  up the first time the file is opened in v0.2.3+.

## 0.2.2 — Brick 7c: Settlements on the map + side-panel integration
- New `_mapSettlementLayer` always-on featureGroup. Markers are gold
  circles sized by `place=*` (city = 7 px, town = 6, village = 5,
  hamlet/quarter = 4, others = 3). Visible regardless of which boundary
  type is selected; remain on top during drill.
- Click a marker → side panel selects the settlement. Selected markers
  get a heavier accent stroke and a slightly larger radius. `_polyIndex`
  now also holds markers (under `'settlement:<id>'`) so hover/unhover
  works the same way as for polygons.
- New side-panel branch for settlements: editable name + notes,
  coordinates and OGF node id readout, and a Parent section that
  walks the ancestor chain (direct parent → "Also within" each higher
  boundary). Clicking the parent navigates the map; clicking a higher
  ancestor jumps the dropdown to that type and selects it.
- `_panelNavigateToParent(id, kind)` now accepts a `kind` parameter so
  settlements with a plot parent navigate to the Plots view; default
  remains 'boundary' for the existing call sites.
- Boundary side panel grows a "Settlements (N)" section listing
  every transitively-contained settlement (`flattenSettlementsForBoundary`).
  Hover highlights on the map (boosting the marker style in-place);
  click pans to the settlement and selects it without changing drill.
- Plot side panel grows a Settlements section showing settlements
  directly attached to that plot.
- Hover/unhover handle markers as well as polygons; temporary
  out-of-view highlights work for settlements too.

## 0.2.1 — Brick 7b: Settlements import flow
- Three-mode Overpass import for settlements, mirroring Brick 2's plot
  flow:
  - **Search** — area-tag rows (seeded from `data.settings.defaultSearchArea`)
    plus a `place=*` chip strip; common types (city, town, village)
    default on, the rest are opt-in.
  - **By ID** — paste a single OGF node id.
  - **Custom** — full Overpass QL passthrough (re-using `buildCustomQuery`
    so `[out:json]` injection works the same way as plot import).
- New helpers in `js/overpass.js`: `buildSettlementSearchQuery`,
  `buildSettlementByIdQuery`, `parseSettlementImport` (drops anything
  without a `place` tag, picks `name:<lang>` first, falls back to `name`).
- `autoAssignSettlementParent(lat, lng)` in `js/settlements.js` picks
  the most-specific containing region: plot first, then boundaries
  smallest-type-first via point-in-polygon. Runs at preview time so the
  user sees what each candidate will attach to before commit.
- Inset preview map shows candidate dots with name tooltips
  (`drawPreviewSettlements` in `js/map.js`).
- Dedup at preview time against existing `ogfNodeId`. The user sees
  separate counts for "found", "already imported", and "non-place node
  skipped".
- Settlements tab shows a read-only list (Name, Place chip, Parent, OGF
  Node ID) so imports can be verified without map markers — those land
  in 7c. Sortable/searchable table + edit modal land in 7d.
- l10n keys for all new strings; `EMPTY_DATA` migration unchanged.

## 0.2.0 — Brick 7a: Settlements scaffolding
- New `data.settlements` array (with `EMPTY_DATA` migration so existing
  saves pick up `[]` on next load — no schema bump needed).
- `js/settlements.js` defines the record shape and CRUD primitives:
  `createSettlement`, `deleteSettlement`, `findSettlementByOgfNodeId`,
  `getSettlementParentInfo`, `flattenSettlementsForBoundary`,
  `settlementsForPlot`, plus the `PLACE_TYPES` preset list for the
  upcoming import preset selector.
- Sidebar gets a Settlements item under Geography (between Boundaries
  and Map). Empty `panel-settlements` tab with placeholder import
  button (disabled — full import flow lands in 7b).
- Dashboard shows a Settlements stat card.
- Bumped to v0.2.0 — Phase 2.5 begins.

## 0.1.11 — Map side panel, single drill chain, scoped viewport fit
- **Side panel replaces popups.** Single-clicking a boundary or plot on
  the map no longer opens a Leaflet popup. Instead a 280 px side panel
  slides open to the right of the map. The panel shows the type chip,
  editable name, area, editable notes, and an "Open full details" button.
  The selected polygon is highlighted (heavier stroke + stronger fill).
  Click ✕ or click an empty area of the map to deselect.
- **Membership chain in the panel.** The panel shows every ancestor of
  the selected item: "Direct member of [Province X]" for the immediate
  parent, then "Also within [Country Y]" for each ancestor above that.
  Clicking any ancestor name opens its detail modal. Items with no
  parent show "No parent boundary".
- **Single drill chain.** Double-clicking a boundary that is NOT a
  direct child of the current drill-stack top now resets the chain
  rather than appending an unrelated entry. Drilling from root always
  starts a fresh chain; drilling a child extends it. This prevents
  stray multi-branch stacks.
- **Viewport fit scoped to drilled boundary.** Drilling into a boundary
  now fits the viewport to *that boundary's own geometry* only, rather
  than all loaded objects. Navigating back via the breadcrumb fits to
  the ancestor boundary's geometry; returning to root fits all layers.
- **Inline name/notes editing.** Name and notes in the side panel are
  editable and auto-saved on blur, updating map tooltips and the drill-
  stack breadcrumb label without opening a modal.

## 0.1.10 — Brick 6c polish: stacked drill, popups, plots view, absorption fix
- **Stacked drill levels.** Drilling no longer hides the rest of the
  map: the dropdown's selected type stays rendered at the bottom and
  each drill step adds the next level on top. You can now see the
  whole hierarchy three (or more) levels deep at once.
- **"Plots" is back as a dropdown option.** Picks the original flat
  plot view from any project state; bypassed entirely when a project
  has no boundary types yet.
- **Click → popup, not modal.** Single-click on any polygon now opens
  a small Leaflet popup with the name, a type chip, the area, and an
  "Open details" button that promotes you into the full detail modal.
  Double-click on a boundary still drills (the popup is dismissed
  cleanly). Dark-themed popup wrapper override added to styles.css.
- **Absorption fix for the locality scenario.** When an import
  subdivides existing municipality plots, the locality boundary used
  to come out empty: `resolveBoundaryMembersForPlots` was skipping
  plots already claimed by the municipality. Now it includes them
  and the post-create promotion loop wedges each new locality
  between its parent municipality and the sub-plot — locality gains
  the plot, municipality gains the locality (replacing the bare
  sub-plot reference). Promotion failures (sister-type claims) drop
  the member rather than leak a double-claim.

## 0.1.9 — Brick 6c: hierarchical map view + import absorption
- **Map view rebuilt around the hierarchy.** Replaced the multi-layer
  chip strip with a single dropdown picking which boundary type to
  display. Default = the largest type (root of the primitiveId chain).
  At top level the map shows every boundary of that type, rendered
  filled in the type's color (the same visual treatment as plots).
- **Drill steps one level down.** Double-clicking a boundary descends
  into its *direct members* — sub-boundaries get their own type-color
  fill, plots in the neutral plot style. Single-click on any polygon
  opens its detail modal. Breadcrumb above the dropdown shows the
  drill path back to "All [type]".
- **Plots in drill view open the plot detail.** The previous
  click-to-highlight behaviour is gone (the modal is the inspection
  surface across the app).
- **Import-as-boundary now absorbs intermediate boundaries.** When a
  newly-imported boundary's plot set is fully covered by existing
  intermediate-type boundaries, those intermediates become its members
  instead of the raw plots. Greedy largest-first absorption: a Province
  imported on top of two existing Municipalities ends up as
  `[Mun1, Mun2]` rather than `[P1..Pn]`. Existing `promoteMember`
  follow-up wedges the new boundary between any prior claimer
  (e.g. a Country) and each absorbed member, preserving exclusivity.

## 0.1.8 — Brick 6b: boundary map layers, toggle strip, drill-through
- **Dissolved boundary geometry via Turf**: `resolveBoundaryGeometry`
  (in `js/boundaries.js`) flattens a boundary to its transitive plot
  set, builds a GeoJSON Feature per plot, and folds `turf.union` over
  them. Output is converted back to Leaflet `[lat,lon][][][]`
  multipolygon shape. Result cached per boundary id; mutation sites
  (member add/remove, plot delete, subdivision commit, boundary delete,
  flush) call `invalidateBoundaryGeometry()`.
- **Per-type Leaflet layers**: each boundary type gets its own
  `L.featureGroup`, stroke-only (`fill: false`) so plots stay readable
  underneath. Color cycles a small palette by type index, computed
  deterministically.
- **Toggle strip + breadcrumb**: a single-line chip strip above the map
  with one chip per layer (Plots first, then each boundary type sorted
  alphabetically). Chips show an ◯ when off and a ● in the type's color
  when on. Strip uses `overflow-x: auto` so it stays single-line for
  any number of types. A breadcrumb appears above the strip when
  drilled in, with clickable ancestors back to "All".
- **Click vs. double-click**:
  - Single-click on a boundary opens its detail modal (240 ms
    debounce so it can be cancelled by a double-click).
  - Double-click drills into the boundary: the map filters to plots
    and sub-boundaries transitively contained by it; the breadcrumb
    deepens. Default Leaflet dblclick-zoom is disabled on the map so
    this doesn't fight zoom.
- New CSS: `.map-chip-strip`, `.map-chip`, `.map-crumbs`,
  `.map-crumb-link/current/sep`. New l10n keys: `map.layer_plots`,
  `map.crumb_root`.

## 0.1.7 — Settings: default search area + flush; unified "Create as" dropdown
- **Unified "Create as" dropdown** in the Import modal: replaced the
  radio + separate type select with a single `<select>` whose first
  option is "Plot" followed by all boundary types as peers. Cleaner UI,
  same behaviour.
- **Default search area** setting (per save file): a key-value row editor
  in Settings (`data.settings.defaultSearchArea`). Rows saved here are
  pre-filled as the Search area in the Import modal when it opens,
  saving repetitive typing for your country filter.
- **Flush save file** setting: a confirmation-gated destructive action in
  Settings that wipes `data.plots`, `data.boundaries`, and `data.osm`
  while leaving boundary types and all other settings intact. Intended
  for testing.

## 0.1.6 — Fix bordering imports treated as overlapping
- Plots that just *border* an existing plot (share an edge but have no
  actual area overlap) were being misclassified as overlapping by the
  vertex-in-polygon prefilter `plotsOverlap` — a vertex sitting exactly
  on the parent's edge can classify as "inside" depending on
  floating-point details. The candidate then went through the wrap /
  partial classification, where `turf.difference` correctly reported no
  real overlap, so the candidate was lost (no free, no split, no wrap)
  and the user saw "Nothing new to import".
- Fix: in the per-plot classification loop, also check the real
  overlap area via `turf.area(parent) − turf.area(parent − candidate)`.
  When the real overlap is below the noise floor (1 m²), skip that
  plot — it lets the candidate fall through to `free` if no other
  plots actually overlap it. Bordering imports now create new plots
  as expected.

## 0.1.5 — Import commit button: never silently disappear
- Re-importing a relation that's already a plot would classify it as a
  pure wrap with no gap. `newPlotCount` then evaluated to 0 and the
  Commit button vanished without explanation. Two fixes:
  - The button is now rendered inside its own `import-commit-container`
    that re-renders when the import target radio (Plot / Boundary) flips.
  - When `newPlotCount === 0` AND target is Boundary, the button stays
    visible with a "Commit ({n} boundary)" label — wrapping existing
    plots into a new boundary record is a valid commit-time action even
    when no new plots are created.
  - When neither is true (target = Plot, only wraps with no gap), an
    explicit "Nothing new to import" message replaces the missing button
    so the user knows why nothing's actionable.

## 0.1.4 — Fix membership rewriting on cross-parent splits
- When a single imported relation is split across two existing plots
  (e.g. a city straddling two provinces), each parent plot's owning
  boundary should keep ownership of *its own* sub-pieces plus its own
  remainder. The previous logic indexed replacements by candidate, so
  a parent boundary inherited its sibling's pieces and lost its own
  remainder. Fix: build the parent→replacement map directly during the
  per-parent split loop, listing only that parent's own pieces +
  remainder. Each parent boundary now ends up with exactly the new
  plots that cover the area its old parent plot covered.

## 0.1.3 — Bottom-up import (wrap mode)
- Subdivision now detects when an incoming candidate fully **contains**
  an existing plot, instead of being contained by one. Previously this
  case was handled as a regular subdivision, which resulted in the
  existing plot being "subdivided" by a shape larger than itself —
  producing a duplicate plot with the candidate's name and silently
  destroying the original. The frequent symptom: importing a Country
  after Provinces would rename every Province to "Country".
- New **wrap** classification in `computeSubdivisionPlan`. For each
  candidate, overlapping plots are split into `wrapped` (fully inside)
  and `partial` (still subdivides). Wrapped plots are kept as-is; the
  candidate's gap (area not covered by any overlapping plot) becomes a
  flagged remainder plot when ≥ 1 m². Mixed candidates (some wrapped,
  some partial) get both treatments simultaneously.
- New plan field `plan.wraps`. The import preview gets a "Will wrap N
  existing plot(s)" section listing the candidate, its wrapped plots
  ("kept"), and any gap remainder.
- Importing **as boundary** automatically picks up wrapped plots as
  members — so importing provinces first then a Country boundary now
  builds the right hierarchy in one step.

## 0.1.2 — Brick 6a polish: import-as-boundary + member promotion
- **Import as boundary** — the import modal now has a "Create as: Plot |
  Boundary [Type]" selector at the top. Plot is the default (existing
  behaviour). When Boundary is chosen, every imported OGF relation also
  becomes a Boundary record of the chosen type, with all sub-plots that
  came from that relation as direct members. The boundary's name is
  inherited from the relation's `name:<lang>` (or `name=*`) tag.
- **Plot reference rewriting** — when subdivision replaces a parent plot
  with sub-plots, any boundary that had the parent as a direct member is
  rewritten to reference all the new sub-plots that cover the same area.
  No silent data loss when subdividing already-grouped plots.
- **Member promotion (inbetweener)** — the picker no longer hard-blocks
  items already claimed by another boundary. If the claiming boundary's
  type may transitively contain the new boundary's type, the row renders
  in green with a "in: X — will move" tag. On commit, the item is moved
  from the claimer to the new boundary, and the new boundary is added to
  the claimer (wedged between). Items that fail the chain-validity check
  remain blocked with the existing "claimed" badge.
- New `boundaries.js` helpers: `canTypeContain`, `findClaimingBoundary`,
  `promoteMember`. New `import.create_as` / `target_*` /
  `wrapped_as_boundary_toast` strings, and a green
  `boundary-picker-promote` chip.

## 0.1.1 — Brick 6a: boundary entities (table-driven core)
- New **`js/boundaries.js`** data layer: `createBoundary`, type-chain
  walkers (`_typeChainBelow`, `_typeChainReachesPlots`),
  `buildClaimedSet`, `getEligibleMembers`, `flattenBoundaryToPlotIds`,
  `boundaryArea` (sum of transitively-contained plot areas).
- New **Boundaries** sidebar tab between Boundary Types and Map.
  Searchable + sortable table (Name / Type / Members / Area).
  Empty states for "no types defined yet" (redirects to Boundary Types)
  and "no boundaries yet" (with create button).
- **Create modal** — name + type selector. Type cannot be changed after
  creation (changing it would invalidate already-assigned members);
  delete + recreate to switch.
- **Detail modal** — editable name + notes (auto-save on blur), type /
  ID / total-area metadata trio, members list with per-row Remove,
  "+ Add members" button, Delete at the footer with `appConfirm`.
- **Member picker modal** — search-filtered list grouped by section
  (Plots first, then each eligible boundary type). Items already in
  the boundary render as checked + disabled (current); items claimed
  by another boundary render greyed out with a `claimed` tag.
  Footer shows live count + an `Add N` primary button. Replaces the
  detail modal in the single modal slot; on Cancel/Add we reopen the
  detail modal so state stays continuous.
- **Rule enforcement** in `getEligibleMembers`:
  - **Transitive containment** — eligible types are the entire
    primitiveId chain below the parent, not just the immediate primitive.
    Plots are eligible whenever the chain bottoms out at null.
  - **Exclusivity** — `buildClaimedSet` indexes every plot/boundary
    already a direct member of any boundary; the picker hides those
    behind a `disabled + claimed` row, except for the boundary's own
    current members.
- Brick 6b (next) — map layer per type, dissolved geometry rendering,
  click-to-select on map, double-click drill-through.

## 0.1.0 — Brick 5b: snap tolerance + name:lang tag fix
- **Snap tolerance** — configurable project setting (Settings page, default 10 m,
  0 = off). Before passing geometries to Turf, candidate boundary vertices
  within this distance of an existing parent-plot vertex are snapped onto
  it. Eliminates hairline slivers that arise when two OGF relations describe
  the same border from different sources with slightly different node positions.
  Conversion: `toleranceDeg = metres / 111320` (equatorial approximation).
- **Localised name tags** — `parseImport` now prefers `name:<lang>` (e.g.
  `name:en`) over the generic `name=*` when the current project language
  has a matching tag. Falls back to `name=*` if no localised tag is present.
  Language code comes from `_lang`, so it tracks the Settings language
  automatically without any hardcoding.

## 0.0.9 — Brick 5a: smaller-boundary import + auto-subdivision (preview)
- **Turf.js v6** added via CDN — provides polygon intersection, difference,
  and area for the subdivision engine.
- **`js/subdivide.js`** — new geometry engine. Classifies imported candidates
  as "free" (don't overlap any existing plot) or "subdividers" (overlap ≥ 1
  existing plot). For each overlapping pair it computes
  `turf.intersect(plot, candidate)` → new sub-plot, and
  `turf.difference(plot, allCandidates)` → remainder plot.
  Results are stored as local negative-id nodes + ways via `nextLocalOsmId()`.
- **Subdivision preview** in the import modal — the result list now shows
  two sections: "Will subdivide N existing plot(s)" (with an indented
  child list per parent) and "Will add as new plots" (free candidates).
  Remainder plots are tagged `(remainder)`.
- **Commit** replaces each subdivided parent with its pieces + any non-trivial
  remainder (≥ 1 ha). Parent is removed from `data.plots` after all
  sub-plots are created. Free candidates are added normally alongside.
- **Name fallback**: sub-plots take the incoming OGF boundary name if it
  exists; unnamed remainder plots get `"<parent> (remainder)"`.
- The old overlap-reject policy is fully replaced — overlapping shapes
  now trigger subdivision instead of being silently skipped.
- Brick 5b (snap tolerance) is the next step.

## 0.0.8 — Brick 4: boundary-type schema editor
- **Boundary Types tab** added to the nav (between Plots and Map).
- **Hierarchy card** — visual top-to-bottom ladder showing each level
  as a row of chips, with a ▾ connector between levels and an implicit
  dimmed "Plots" row at level 0.
- **Types table** — all defined types, sorted by level descending then
  name, with Edit and Delete actions per row.
- **Add / Edit modal** — name input + level number input (≥ 1). Saves
  on "Save", validates: non-empty name, integer level ≥ 1, no duplicate
  names (case-insensitive). Default level for new types is one above the
  current highest.
- **Delete** via `appConfirm`. Blocked if any boundary already uses the
  type (future-proof guard for Brick 6; no boundaries exist yet).
- **Bootstrap defaults** — Country (3) / Province (2) / Municipality (1)
  seeded automatically the first time the tab is visited on a new or
  pre-Brick-4 save. The user can rename, delete, or extend freely.
- `btn.save` string added.

## 0.0.7 — Brick 3: plot interaction
- Plots tab now has a name-search input (case-insensitive substring)
  and sortable column headers (Name / Area / OGF Relation ID),
  defaulting to Name asc. Body re-renders on search input only,
  preserving focus across keystrokes.
- New **Area** column. Computed via spherical excess (≈ Leaflet
  geometryutil's `geodesicArea`); displayed as `m²` for tiny plots
  and `km²` with two decimals otherwise. Holes are subtracted.
- **Plot-detail modal** opens on row click. Editable name + notes
  with auto-save on blur, read-only metadata block (OGF Relation ID,
  Plot ID, Area), and an inset Leaflet map showing the plot. Map
  tab remains the visualiser; this modal is the data-stewardship
  surface, per the agreed split.
- **Delete** with `appConfirm` confirmation. Removes the plot record
  only — orphaned `osm.nodes` / `osm.ways` remain in place because
  re-imports of adjacent plots may still reference them, and they're
  cheap to keep.
- Sortable header + clickable-row styles added; meta-block grid
  for the detail modal's metadata trio.

## 0.0.6 — Default seeds + custom-query polish
- Empty seed rows in the import modal's Search tab. The previous
  `admin_level=2` defaults made a one-click "Preview" fire a
  world-spanning query against OGF, which rate-limited the user.
- `buildCustomQuery` now early-returns if `[out:json]` appears
  anywhere in the text — fixes 400s when the query starts with a
  `/* … */` comment block (overpass-turbo's wizard prefix), where
  the previous "leading settings block" detection couldn't reach
  the existing `[out:json]` and we'd prepend a second one.
- `parseImport` synthesises the way/node layer from inline `out geom;`
  member geometry. Wizard-generated queries that end in `out geom;`
  now produce candidate plots with resolvable shapes, instead of
  silently parsing to zero candidates. Synthetic ids live in a deep
  negative range (`-1e9` and below) so they can't collide with
  locally-allocated ids reserved for split-midpoints in later bricks.

## 0.0.5 — Friendlier Overpass error handling
- HTTP 429 (rate-limited) now probes `/api/status` to find the next
  available slot and surfaces "Try again in ~Ns" instead of pasting
  the rate-limit HTML body into a toast.
- Other non-2xx responses get HTML-stripped and length-capped before
  going into the error message.
- New `getOverpassStatus()` helper in `js/overpass.js` parses the
  status endpoint's "in N seconds" lines.

## 0.0.4 — Brick 2 polish (review feedback)
- **Custom Overpass + bbox** — `buildCustomQuery` now merges `[out:json]`
  into the user's leading settings block instead of prepending a
  separate one. A query starting with `[bbox:s,w,n,e];` is honoured.
- **Search / By ID query idiom** — switched both from `out body; >; out
  skel qt;` to the canonical `(._;>;); out body;` pattern so all
  member nodes/ways come back reliably (fixes "incomplete rings"
  reported on multi-result searches).
- **Flow** — dropped the separate Preview button. The footer now has
  one primary action ("Import") that runs the query and shows the
  preview; a "Commit (N)" button appears inline in the result area
  once accepted candidates are in hand.
- **Map polygons go neutral** — accent red replaced by slate
  (`#475569` / `#1f2937` for selected) so the accent stays reserved
  for UI affordances. Preview overlay matches.
- **Disabled-button styling** — `.btn:disabled` now visibly dims and
  switches to `not-allowed`; eliminates the "click does nothing"
  feedback gap.
- **Toast on no results** — `parseImport` returning zero candidates
  now also fires a warning toast (in addition to the inline message).

## 0.0.3 — Brick 2: plots + Overpass import
- Local mini-OSM data store (`data.osm.nodes` / `data.osm.ways`) so
  plots own their geometry via shared way/node references rather than
  inline coordinate copies. OGF is treated as a sync target, not a
  source of truth; saves work fully offline.
- Plot record `{ id, name, notes, ogfRelationId, outers, inners }` with
  way-list rings; geometry resolved on render via outer/inner ring
  assembly (handles way direction and multipolygons).
- Plots tab — read-only table of imported plots (Name / OGF Relation
  ID / Plot ID), Import button, empty-state hero. No row-click action
  yet (detail view is Brick 3).
- Import modal with three modes:
  - **Search** — two-step area + to-import filters as AND'd key-value
    rows. Builds an Overpass `area->.searchArea; relation(area...)`
    query.
  - **By ID** — paste an OGF relation id.
  - **Custom Overpass** — power-user passthrough; query sent verbatim.
- Always-on preview: query result is parsed into candidate plots,
  partitioned accept/reject by overlap test against existing plots,
  and rendered in a list + an inset preview map inside the modal.
  Import commits only the accepted candidates.
- Map tab renders all imported plots with the accent stroke and a
  click-to-select highlight (visual only; click-elsewhere deselects).
- ID convention adopted: positive ints = OGF-known (auto-deduped on
  reimport), negative ints = local-only (reserved for split midpoints
  and synthesized ways in later bricks).

## 0.0.2 — Pompeian red accent
- Switched the accent color from BRIXY blue (`#5b8af5`) to a Pompeian
  red (`#c1272d`) so APPYmanager is visually distinct from its sister
  projects BRIXYmanager (blue) and CRUFYmanager (green). The Via Appia
  framing makes the red thematic.
- Updated `--accent`, `--accent-dim`, `--accent-glow`, and
  `--border-focus` tokens in `styles.css`. The `--danger` token is
  unchanged; the two reds are far enough apart in saturation/depth to
  read as distinct.

## 0.0.1 — Brick 1: project shell
- Initial APPYmanager shell, mirroring BRIXYmanager's look-and-feel.
- IndexedDB multi-slot save manager (database `appymanager`, stores
  `registry` + `saves`). 300 ms debounced auto-save, multi-slot UI,
  rename / duplicate / delete, JSON import / export with timestamped
  filenames, `localStorage` tracking the active save id.
- Sidebar nav with Dashboard, Map, Settings, Import / Export.
- Leaflet map with OGF tile layer
  (`https://tile.opengeofiction.net/ogf-carto/{z}/{x}/{y}.png`); map
  view (centre + zoom) persisted per-project.
- Localization scaffolding (`l10n.js` + `lang/en.js`).
- Dark theme tokens and components ported from BRIXY (header, sidebar,
  tabs, buttons, forms, tables, modal, toast, save dropdown).
- No plot, boundary, or property logic yet — those start in Brick 2.
- `CLAUDE.md` captures the agreed scope and brick-by-brick plan.
