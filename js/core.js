// ============================================================
// CORE — Data model & shared utilities
// ============================================================
// The single global `data` object holds the entire project state.
// It is persisted to IndexedDB by persistence.js. Each top-level key is an
// array (or object map) that can be serialised to JSON without loss.
//
// Shape (will grow brick-by-brick):
//   osm            — local mini-OSM store: { nodes, ways, _nextLocalId } (Brick 2+)
//   plots          — atomic geographic units, reference osm.ways for geometry (Brick 2+)
//   boundaries     — higher-level regions, each = set of plots OR sub-boundaries (Brick 6+)
//   boundaryTypes  — strict hierarchy of boundary type definitions (Brick 4+)
//   propertySchemas — declarations for numeric / categoric / percentage properties (Brick 8+)
//   settings       — project-level config (name, language, ...)
let data = {
  osm: { nodes: {}, ways: {}, _nextLocalId: 0 },
  plots: [],
  boundaries: [],
  boundaryTypes: [],
  propertySchemas: [],
  settings: {}
};

let editingId = null;

function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }
function esc(str) { if (str == null) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }
function stripDiacritics(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// ============================================================
// SETTINGS GETTERS
// ============================================================
function getSetting(key, fallback) { return data.settings?.[key] ?? fallback; }
function getProjectName() { return data.settings?.projectName || ''; }

// ============================================================
// BOUNDARY TYPE BOOTSTRAP
// ============================================================
// boundaryType = { id, name, primitiveId }
// primitiveId: id of the type this type *contains*, or null meaning
// it directly contains Plots. Each type declares exactly one primitive,
// forming a directed tree (or forest for multi-pronged hierarchies).
// Cycle detection is enforced at save time.
function bootstrapBoundaryTypes() {
  if (data.boundaryTypes.length > 0) return;
  const muni    = { id: uid(), name: 'Municipality', primitiveId: null };
  const prov    = { id: uid(), name: 'Province',     primitiveId: muni.id };
  const country = { id: uid(), name: 'Country',      primitiveId: prov.id };
  data.boundaryTypes.push(country, prov, muni);
  save();
}

function updateSystemName() {
  const el = document.getElementById('system-name-header');
  if (el) el.textContent = getProjectName();
  updateSavesDropdownLabel();
}
