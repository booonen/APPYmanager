// ============================================================
// PERSISTENCE — IndexedDB multi-slot save system
// ============================================================
// Two object stores:
//   registry — { id, name, modified, stats }   (lightweight, for the save list)
//   saves    — { id, data }                    (full payload)
// localStorage 'appymanager:active' tracks the active save id.
// All mutations call save() which debounces a flushSave() to IndexedDB.
let _db = null;
let _activeSaveId = '';
let _saveDebounce = null;

// Bumped to 2 in the v0.9.0 land-only pivot. Pre-v2 saves are migrated on
// load by migrateData(): the portion-aware property storage is folded
// down, schema appliesTo is dropped, and the split-toggle settings are
// replaced by a single project-level mode that's then read-only.
const SCHEMA_VERSION = 3;

const VALID_LAND_WATER_MODES = [
  'land_only_sea_water',  // default — clip out sea AND inland water
  'land_only_sea',        // clip out sea only; inland lakes stay
  'water_only',           // keep only the water portion
  'combined',             // no clipping — plots include any water
];

const EMPTY_DATA = () => ({
  schemaVersion: SCHEMA_VERSION,
  osm: { nodes: {}, ways: {}, _nextLocalId: 0 },
  plots: [],
  boundaries: [],
  boundaryTypes: [],
  settlements: [],
  propertySchemas: [],
  settings: {
    landWaterMode: 'land_only_sea_water',  // set at save creation; read-only after
    showWaterOverlay: true,                // visual water layer on the map
  },
  waterCache: null,  // Brick 12a — populated by fetchAndCacheWater()
  // Brick 13: collection of user-authored Atlas pages. Each page is a
  // declarative list of layer instructions + page-level settings; the
  // SVG renderer in js/atlas.js consumes the list to produce a page.
  dataAtlas: { pages: [] },
});

// Migration: legacy saves → v2. Idempotent; runs after every load/import
// merge. Drops the portion-aware property storage that v0.7–v0.8 wired
// in (`propertyValuesLand`/`Water`, schema `appliesTo`), settles the new
// `settings.landWaterMode`, and flags the data for one-shot reclip if a
// water cache is present and the resolved mode actually clips.
function migrateData(d) {
  if (!d || typeof d !== 'object') return d;
  if (d.schemaVersion === SCHEMA_VERSION) return d;

  d.settings = d.settings || {};

  // Legacy `landWaterSplitEnabled` → new mode. Either it was on (so plots
  // had a water-aware view but were never clipped) or off (the polygons
  // weren't expected to differ from OGF). Both legacy cases migrate to
  // the new default `'land_only_sea_water'` so the user gets a clean
  // land-only model immediately. Combined mode is opt-in via the new
  // project modal.
  if (!VALID_LAND_WATER_MODES.includes(d.settings.landWaterMode)) {
    d.settings.landWaterMode = 'land_only_sea_water';
  }

  if (d.settings.showWaterOverlay === undefined) {
    d.settings.showWaterOverlay = true;
  }

  // Drop legacy settings that the new model supersedes.
  delete d.settings.landWaterSplitEnabled;
  delete d.settings.waterDisplayMode;
  delete d.settings.showWaterDebugOverlay;
  delete d.settings.coastlineDebug;

  // Fold per-portion property storage on each plot into the combined
  // `propertyValues`. Land wins on conflicts (it's the canonical
  // surviving portion); water-only entries are dropped — they were
  // never aggregated and have no place on a land-only polygon.
  for (const plot of (d.plots || [])) {
    if (plot.propertyValuesLand) {
      plot.propertyValues = plot.propertyValues || {};
      for (const [k, v] of Object.entries(plot.propertyValuesLand)) {
        if (v !== undefined && v !== null && v !== '') plot.propertyValues[k] = v;
      }
      delete plot.propertyValuesLand;
    }
    if (plot.propertyValuesWater) {
      // Water-only values disappear with the land-only pivot. If a user
      // had set e.g. salinity on water, that doesn't survive — this is
      // pre-release test data, documented loss.
      delete plot.propertyValuesWater;
    }
    delete plot.waterDisposition;  // never finalized; v0.8.4 already inert
  }

  // Drop `appliesTo` from every schema.
  for (const s of (d.propertySchemas || [])) {
    delete s.appliesTo;
  }

  // If a water cache is present and the mode actually clips, mark for a
  // one-shot reclip. landwater.js consumes the flag during the post-load
  // pass.
  if (d.waterCache && d.waterCache.waterGeometry
      && d.settings.landWaterMode !== 'combined') {
    d.__needsReclipOnLoad = true;
  }

  // v3 (Brick 13): dataAtlas container.
  if (!d.dataAtlas || typeof d.dataAtlas !== 'object') {
    d.dataAtlas = { pages: [] };
  } else if (!Array.isArray(d.dataAtlas.pages)) {
    d.dataAtlas.pages = [];
  }

  d.schemaVersion = SCHEMA_VERSION;
  return d;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('appymanager', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('registry')) db.createObjectStore('registry', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(store, obj) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = _db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function saveSlotStats() {
  return {
    plots: data.plots.length,
    boundaries: data.boundaries.length,
    boundaryTypes: data.boundaryTypes.length,
    settlements: (data.settlements || []).length,
    propertySchemas: data.propertySchemas.length
  };
}

function save() {
  if (!_activeSaveId) return;
  clearTimeout(_saveDebounce);
  _saveDebounce = setTimeout(() => flushSave(), 300);
}

async function flushSave() {
  if (!_db || !_activeSaveId) return;
  try {
    await dbPut('saves', { id: _activeSaveId, data: JSON.parse(JSON.stringify(data)) });
    await dbPut('registry', {
      id: _activeSaveId,
      name: data.settings?.projectName || t('save_mgr.unnamed'),
      modified: new Date().toISOString(),
      stats: saveSlotStats()
    });
  } catch (e) { console.error('Save failed:', e); }
}

async function load() {
  await openDB();
  _activeSaveId = localStorage.getItem('appymanager:active') || '';
  if (_activeSaveId) {
    const slot = await dbGet('saves', _activeSaveId);
    if (slot?.data) { data = { ...EMPTY_DATA(), ...slot.data }; migrateData(data); }
  }
  if (!_activeSaveId) {
    _activeSaveId = uid();
    localStorage.setItem('appymanager:active', _activeSaveId);
    await flushSave();
  }
}

async function loadSlot(id) {
  await flushSave();
  data = EMPTY_DATA();
  _activeSaveId = id;
  localStorage.setItem('appymanager:active', id);
  const slot = await dbGet('saves', id);
  if (slot?.data) { data = { ...EMPTY_DATA(), ...slot.data }; migrateData(data); }
  if (typeof _map !== 'undefined' && _map) { _map.remove(); _map = null; }
  if (data.__needsReclipOnLoad && typeof reclipAllPlotsToMode === 'function') {
    delete data.__needsReclipOnLoad;
    reclipAllPlotsToMode(data.settings?.landWaterMode);
    save();
  }
  refreshAll(); renderDashboard(); updateSystemName();
  toast(t('toast.loaded', { name: data.settings?.projectName || t('save_mgr.unnamed') }), 'success');
}

async function deleteSlot(id) {
  const reg = await dbGetAll('registry');
  const entry = reg.find(r => r.id === id);
  if (!entry) return;
  appConfirm(t('save_mgr.confirm_delete', { name: entry.name }), async () => {
    await dbDelete('saves', id);
    await dbDelete('registry', id);
    if (_activeSaveId === id) {
      const remaining = reg.filter(r => r.id !== id);
      if (remaining.length > 0) {
        await loadSlot(remaining[0].id);
      } else {
        data = EMPTY_DATA();
        _activeSaveId = uid();
        localStorage.setItem('appymanager:active', _activeSaveId);
        await flushSave();
        refreshAll(); renderDashboard(); updateSystemName();
      }
    }
    toast(t('toast.save_deleted'), 'success');
  });
}

async function duplicateSlot(id) {
  const slot = await dbGet('saves', id);
  const regEntry = await dbGet('registry', id);
  if (!slot || !regEntry) return;
  const newId = uid();
  await dbPut('saves', { id: newId, data: slot.data });
  await dbPut('registry', { id: newId, name: regEntry.name + ' (copy)', modified: new Date().toISOString(), stats: regEntry.stats });
  toast(t('toast.duplicated', { name: regEntry.name }), 'success');
  openSaveManager();
}

async function renameSlot(id) {
  const entry = await dbGet('registry', id);
  if (!entry) return;
  appPrompt(t('save_mgr.prompt_rename'), entry.name, async (newName) => {
    entry.name = newName;
    await dbPut('registry', entry);
    if (_activeSaveId === id) {
      data.settings = data.settings || {};
      data.settings.projectName = entry.name;
      save(); updateSystemName();
    }
    openSaveManager();
  });
}

async function exportData() {
  const jsonStr = JSON.stringify(data, null, 2);
  const sysName = stripDiacritics(data.settings?.projectName || 'appymanager').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'appymanager';
  const now = new Date();
  const ts = now.getFullYear().toString() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
  const defaultName = sysName + '-' + ts + '.json';
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: t('save_mgr.json_file'), accept: { 'application/json': ['.json'] } }] });
      const writable = await handle.createWritable();
      await writable.write(jsonStr);
      await writable.close();
      toast(t('toast.data_exported'), 'success');
      return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = defaultName; a.click(); URL.revokeObjectURL(a.href);
  toast(t('toast.data_exported'), 'success');
}

function importData() { document.getElementById('file-input').click(); }
function handleImport(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async function (ev) {
    try {
      const imported = JSON.parse(ev.target.result);
      const tempData = { ...EMPTY_DATA(), ...imported };
      migrateData(tempData);
      const newId = uid();
      await dbPut('saves', { id: newId, data: tempData });
      await dbPut('registry', {
        id: newId,
        name: tempData.settings?.projectName || file.name.replace(/\.json$/i, ''),
        modified: new Date().toISOString(),
        stats: {
          plots: tempData.plots.length,
          boundaries: tempData.boundaries.length,
          boundaryTypes: tempData.boundaryTypes.length,
          propertySchemas: tempData.propertySchemas.length
        }
      });
      await flushSave();
      await loadSlot(newId);
      toast(t('toast.imported'), 'success');
    } catch (err) { toast(t('toast.invalid_json'), 'error'); }
  };
  reader.readAsText(file); e.target.value = '';
}

async function getStorageEstimate() {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return { used: est.usage || 0, quota: est.quota || 0 };
  }
  return { used: 0, quota: 0 };
}

async function openSaveManager() {
  const reg = await dbGetAll('registry');
  const est = await getStorageEstimate();
  const usedMB = (est.used / 1024 / 1024).toFixed(1);
  const quotaMB = (est.quota / 1024 / 1024).toFixed(0);
  const rows = reg.sort((a, b) => new Date(b.modified) - new Date(a.modified)).map(r => {
    const isActive = r.id === _activeSaveId;
    const mod = r.modified ? new Date(r.modified).toLocaleString() : '—';
    const st = r.stats || {};
    return `<tr style="${isActive ? 'background:var(--accent-glow)' : ''}">
      <td><strong>${esc(r.name)}</strong>${isActive ? ` <span style="font-size:10px;color:var(--accent)">${t('save_mgr.active')}</span>` : ''}</td>
      <td class="text-dim" style="font-size:12px">${mod}</td>
      <td class="mono" style="font-size:12px">${st.plots||0}p · ${st.boundaries||0}b</td>
      <td class="actions-cell" style="white-space:nowrap">
        ${!isActive ? `<button class="btn btn-sm" onclick="closeModal();loadSlot('${r.id}')">${t('btn.load')}</button>` : ''}
        <button class="btn btn-sm" onclick="renameSlot('${r.id}')">${t('btn.rename')}</button>
        <button class="btn btn-sm" onclick="duplicateSlot('${r.id}')">${t('btn.duplicate')}</button>
        ${!isActive ? `<button class="btn btn-sm btn-danger" onclick="deleteSlot('${r.id}');setTimeout(openSaveManager,200)">✕</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  openModal(t('save_mgr.title'), `
    <table class="data-table"><thead><tr><th>${t('save_mgr.col_project')}</th><th>${t('save_mgr.col_modified')}</th><th>${t('save_mgr.col_stats')}</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="text-dim">${t('save_mgr.no_saves')}</td></tr>`}</tbody></table>
    <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">
      <div class="flex gap-8">
        <button class="btn btn-sm btn-primary" onclick="closeModal();newProject()">${t('btn.new_project')}</button>
        <button class="btn btn-sm" onclick="closeModal();importData()">↑ ${t('btn.import_json')}</button>
        <button class="btn btn-sm" onclick="closeModal();exportData()">↓ ${t('btn.export_json')}</button>
      </div>
      <span class="text-dim" style="font-size:11px">${t('save_mgr.storage')}: ${usedMB} MB${quotaMB > 0 ? ' / ' + quotaMB + ' MB' : ''}</span>
    </div>`,
    `<button class="btn" onclick="closeModal()">${t('btn.close')}</button>`);
}

// ---- Saves Dropdown ----
function toggleSavesDropdown(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('saves-dropdown-menu');
  if (menu.classList.contains('open')) { menu.classList.remove('open'); return; }
  renderSavesDropdown();
  menu.classList.add('open');
}

async function renderSavesDropdown() {
  const menu = document.getElementById('saves-dropdown-menu');
  if (!menu) return;
  const reg = await dbGetAll('registry');
  reg.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  let html = '';
  for (const r of reg) {
    const isActive = r.id === _activeSaveId;
    const st = r.stats || {};
    html += `<div class="saves-dropdown-item${isActive ? ' active' : ''}" onclick="${isActive ? '' : `closeSavesDropdown();loadSlot('${r.id}')`}" ${isActive ? 'style="cursor:default"' : ''}>
      <div style="font-weight:${isActive ? '600' : '400'}">${isActive ? '● ' : ''}${esc(r.name)}</div>
      <div style="font-size:11px;color:var(--text-muted)">${st.plots||0}p · ${st.boundaries||0}b</div>
    </div>`;
  }
  html += `<div class="saves-dropdown-divider"></div>`;
  html += `<div class="saves-dropdown-item" onclick="closeSavesDropdown();openSaveManager()"><span style="color:var(--accent)">⚙ ${t('save_mgr.title')}</span></div>`;
  html += `<div class="saves-dropdown-item" onclick="closeSavesDropdown();newProject()"><span style="color:var(--accent)">+ ${t('btn.new_project')}</span></div>`;
  menu.innerHTML = html;
}

function closeSavesDropdown() {
  const menu = document.getElementById('saves-dropdown-menu');
  if (menu) menu.classList.remove('open');
}

function updateSavesDropdownLabel() {
  const el = document.getElementById('saves-dropdown-label');
  if (el) el.textContent = data.settings?.projectName || t('btn.saves');
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('saves-dropdown');
  if (dd && !dd.contains(e.target)) closeSavesDropdown();
});

// New-project flow. The land/water mode is set here and is read-only
// after creation (the data model is shaped around it).
async function newProject() {
  const modeOpts = VALID_LAND_WATER_MODES.map(m => `
    <option value="${m}"${m === 'land_only_sea_water' ? ' selected' : ''}>${t('save_mgr.new_mode_' + m)}</option>
  `).join('');
  const body = `
    <p>${t('save_mgr.confirm_new')}</p>
    <label style="display:block;margin-top:14px">
      <div style="font-weight:500;margin-bottom:4px">${t('save_mgr.new_mode_label')}</div>
      <select id="new-project-mode" style="width:100%;max-width:420px">${modeOpts}</select>
      <div id="new-project-mode-help" class="text-dim" style="font-size:12px;margin-top:6px">${t('save_mgr.new_mode_help_land_only_sea_water')}</div>
    </label>
    <p class="text-dim" style="font-size:11px;margin-top:14px">${t('save_mgr.new_mode_immutable')}</p>
  `;
  const footer = `
    <button class="btn" onclick="closeModal()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" onclick="_confirmNewProject()">${t('btn.confirm')}</button>
  `;
  openModal(t('save_mgr.new_title'), body, footer);
  setTimeout(() => {
    const sel = document.getElementById('new-project-mode');
    const help = document.getElementById('new-project-mode-help');
    if (sel && help) sel.addEventListener('change', () => {
      help.textContent = t('save_mgr.new_mode_help_' + sel.value);
    });
  }, 0);
}

async function _confirmNewProject() {
  const sel = document.getElementById('new-project-mode');
  const chosen = sel && VALID_LAND_WATER_MODES.includes(sel.value)
    ? sel.value
    : 'land_only_sea_water';
  closeModal();
  await flushSave();
  data = EMPTY_DATA();
  data.settings.landWaterMode = chosen;
  _activeSaveId = uid();
  localStorage.setItem('appymanager:active', _activeSaveId);
  await flushSave();
  if (typeof _map !== 'undefined' && _map) { _map.remove(); _map = null; }
  updateSystemName();
  switchTab('dashboard');
  refreshAll(); renderDashboard();
  toast(t('toast.new_project'), 'success');
}
