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
