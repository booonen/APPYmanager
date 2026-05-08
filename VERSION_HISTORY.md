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
