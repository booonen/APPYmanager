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
