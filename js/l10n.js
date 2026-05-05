// ============================================================
// L10N — Localization system
// ============================================================
// Loaded first. Provides t() for string lookup with {param} interpolation.
// Language files are JS in lang/ directory (e.g., lang/en.js) — thin wrappers
// around JSON data, loaded via <script> tags to avoid file:// CORS issues.
// Hierarchical keys: t('nav.map') → _strings[_lang].nav.map
// Static HTML strings: elements with data-t="key" are hydrated by l10nHydrate().

let _lang = 'en';
let _strings = {};
let _availableLanguages = [{ code: 'en', name: 'English' }];

function registerLanguage(code, name, strings) {
  const stale = strings._stale || [];
  delete strings._stale;
  _strings[code] = strings;
  _strings[code]._staleKeys = stale;
  if (!_availableLanguages.find(l => l.code === code)) {
    _availableLanguages.push({ code, name });
  }
}

function _resolveKey(obj, key) {
  if (!obj) return undefined;
  const parts = key.split('.');
  let val = obj;
  for (const p of parts) {
    val = val?.[p];
    if (val === undefined) return undefined;
  }
  return val;
}

const _missingKeys = new Set();
function t(key, params) {
  let val = _resolveKey(_strings[_lang], key);
  if (val === undefined) val = _resolveKey(_strings.en, key);
  if (val === undefined) {
    if (!_missingKeys.has(key)) { _missingKeys.add(key); console.warn(`[l10n] Missing key: "${key}"`); }
    return key;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return val;
}

function setLanguage(code) {
  if (!_strings[code]) { toast(t('toast.lang_not_found', { code }), 'error'); return; }
  _lang = code;
  data.settings = data.settings || {};
  data.settings.language = code;
  save();
  l10nHydrate();
  refreshAll();
}

function l10nHydrate() {
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.getAttribute('data-t');
    const val = t(key);
    if (val !== key) el.textContent = val;
  });
  document.querySelectorAll('[data-t-placeholder]').forEach(el => {
    const key = el.getAttribute('data-t-placeholder');
    const val = t(key);
    if (val !== key) el.placeholder = val;
  });
  document.querySelectorAll('[data-t-title]').forEach(el => {
    const key = el.getAttribute('data-t-title');
    const val = t(key);
    if (val !== key) el.title = val;
  });
}
