// ============================================================
// CORE — Data model & shared utilities
// ============================================================
// The single global `data` object holds the entire project state.
// It is persisted to IndexedDB by persistence.js. Each top-level key is an
// array (or object map) that can be serialised to JSON without loss.
//
// Shape (will grow brick-by-brick):
//   plots          — atomic geographic units (Brick 2+)
//   boundaries     — higher-level regions, each = set of plots OR sub-boundaries (Brick 3+)
//   boundaryTypes  — strict hierarchy of boundary type definitions (Brick 3+)
//   propertySchemas — declarations for numeric / categoric / percentage properties (Brick 4+)
//   settings       — project-level config (name, language, ...)
let data = {
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

function updateSystemName() {
  const el = document.getElementById('system-name-header');
  if (el) el.textContent = getProjectName();
  updateSavesDropdownLabel();
}
