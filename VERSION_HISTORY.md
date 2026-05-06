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
