// ============================================================
// VIEWS — Page renderers
// ============================================================
// Each function paints into the corresponding tab panel. Brick-2 adds
// the Plots tab and the Overpass import modal.

function renderDashboard() {
  const stats = document.getElementById('dashboard-stats');
  if (stats) {
    stats.innerHTML = `
      <div class="stat-card"><div class="stat-value">${data.plots.length}</div><div class="stat-label">${t('stat.plots')}</div></div>
      <div class="stat-card"><div class="stat-value">${data.boundaries.length}</div><div class="stat-label">${t('stat.boundaries')}</div></div>
      <div class="stat-card"><div class="stat-value">${data.boundaryTypes.length}</div><div class="stat-label">${t('stat.boundary_types')}</div></div>
      <div class="stat-card"><div class="stat-value">${data.propertySchemas.length}</div><div class="stat-label">${t('stat.properties')}</div></div>
    `;
  }
  const content = document.getElementById('dashboard-content');
  if (content) {
    content.innerHTML = `
      <div class="ie-card">
        <h3>${t('dashboard.welcome_title')}</h3>
        <p>${t('dashboard.welcome_body')}</p>
      </div>
    `;
  }
}

// ============================================================
// PLOTS — sortable, searchable list
// ============================================================
// Brick 3: search by name (substring, case-insensitive), sortable
// header (Name / Area / OGF Relation ID), Area column. Row click
// opens the plot-detail modal. The static chrome (search input,
// import button, table head) renders once per renderPlots call;
// renderPlotsBody is called separately on search input so the input
// keeps focus across keystrokes.

let _plotsSort = { column: 'name', direction: 'asc' };
let _plotsSearch = '';

function renderPlots() {
  const el = document.getElementById('plots-content');
  if (!el) return;
  const all = data.plots;

  const top = `
    <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <button class="btn btn-primary" onclick="openImportModal()">+ ${t('plots.import_btn')}</button>
      <span class="text-dim" style="font-size:12px">${t('plots.count', { n: all.length })}</span>
    </div>`;

  if (all.length === 0) {
    el.innerHTML = top + `
      <div class="empty-state">
        <div class="empty-icon">▱</div>
        <h3>${t('plots.empty_title')}</h3>
        <p>${t('plots.empty_body')}</p>
        <button class="btn btn-primary" onclick="openImportModal()">+ ${t('plots.import_btn')}</button>
      </div>`;
    return;
  }

  el.innerHTML = top + `
    <div style="margin-bottom:12px">
      <input type="text" id="plots-search-input"
        placeholder="${t('plots.search_placeholder')}"
        oninput="onPlotsSearch(this.value)"
        value="${esc(_plotsSearch)}"
        autocomplete="off"
        style="max-width:320px">
    </div>
    <table class="data-table">
      <thead>
        <tr>
          ${plotsSortHeader('name', t('plots.col_name'))}
          ${plotsSortHeader('area', t('plots.col_area'))}
          ${plotsSortHeader('ogfId', t('plots.col_ogf_id'))}
        </tr>
      </thead>
      <tbody id="plots-tbody"></tbody>
    </table>
    <div id="plots-empty-result"></div>`;
  renderPlotsBody();
}

function plotsSortHeader(col, label) {
  const active = _plotsSort.column === col;
  const arrow = active ? (_plotsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th class="sortable${active ? ' active' : ''}" onclick="onPlotsSort('${col}')">${label}${arrow}</th>`;
}

function renderPlotsBody() {
  const tbody = document.getElementById('plots-tbody');
  const emptyEl = document.getElementById('plots-empty-result');
  if (!tbody) return;

  const q = _plotsSearch.trim().toLowerCase();
  let list = data.plots;
  if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q));

  list = list.slice().sort((a, b) => {
    const dir = _plotsSort.direction === 'asc' ? 1 : -1;
    if (_plotsSort.column === 'name') {
      return dir * (a.name || '').localeCompare(b.name || '');
    }
    if (_plotsSort.column === 'area') {
      return dir * (plotArea(a) - plotArea(b));
    }
    if (_plotsSort.column === 'ogfId') {
      const av = a.ogfRelationId == null ? -Infinity : Number(a.ogfRelationId);
      const bv = b.ogfRelationId == null ? -Infinity : Number(b.ogfRelationId);
      return dir * (av - bv);
    }
    return 0;
  });

  tbody.innerHTML = list.map(p => `
    <tr class="row-click" onclick="openPlotDetail('${esc(p.id)}')">
      <td>${p.name ? esc(p.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`}</td>
      <td class="mono">${formatArea(plotArea(p))}</td>
      <td class="mono">${p.ogfRelationId != null ? p.ogfRelationId : '<span class="text-muted">—</span>'}</td>
    </tr>`).join('');

  if (emptyEl) {
    emptyEl.innerHTML = (q && list.length === 0)
      ? `<div class="text-dim" style="font-size:13px;padding:16px 0">${t('plots.no_search_results', { q: esc(_plotsSearch) })}</div>`
      : '';
  }
}

function onPlotsSearch(val) {
  _plotsSearch = val;
  renderPlotsBody();
}

function onPlotsSort(col) {
  if (_plotsSort.column === col) {
    _plotsSort.direction = _plotsSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    _plotsSort.column = col;
    _plotsSort.direction = 'asc';
  }
  renderPlots();
}

// ============================================================
// BOUNDARY TYPES — schema editor (Brick 4)
// ============================================================
// Each boundary type declares a primitiveId: the type it *contains*,
// or null meaning it directly contains Plots. This forms a directed
// tree (or forest for multi-pronged hierarchies). Cycle detection is
// enforced at save time; delete is blocked if any boundary uses the type.

function renderBoundaryTypes() {
  const el = document.getElementById('boundary-types-content');
  if (!el) return;

  bootstrapBoundaryTypes();

  const types = data.boundaryTypes.slice().sort((a, b) => a.name.localeCompare(b.name));

  el.innerHTML = `
    <div class="ie-card">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3>${t('boundary_types.hierarchy_title')}</h3>
        <button class="btn btn-primary btn-sm" onclick="openAddBoundaryTypeModal()">+ ${t('boundary_types.add_btn')}</button>
      </div>
      ${_buildBtypeTree(types)}
    </div>`;
}

let _btypeCollapsed = new Set();

function toggleBtype(id) {
  if (_btypeCollapsed.has(id)) _btypeCollapsed.delete(id);
  else _btypeCollapsed.add(id);
  renderBoundaryTypes();
}

function _buildBtypeTree(types) {
  function renderChildren(parentId, depth, visited) {
    return types
      .filter(t => t.primitiveId === parentId)
      .map(child => {
        if (visited.has(child.id)) return '';
        const next = new Set(visited);
        next.add(child.id);

        const hasChildren = types.some(t => t.primitiveId === child.id);
        const collapsed   = _btypeCollapsed.has(child.id);
        const count       = data.boundaries.filter(b => b.typeId === child.id).length;
        const indent      = depth * 24;

        const toggle = hasChildren
          ? `<button class="btype-toggle" onclick="toggleBtype('${esc(child.id)}')">${collapsed ? '▶' : '▼'}</button>`
          : `<span class="btype-toggle"></span>`;

        const row = `<div class="btype-tree-row" style="padding-left:${indent}px">
          ${toggle}<span class="btype-tree-branch">└─</span>
          <span class="btype-chip">${esc(child.name)}</span>
          <span class="btype-count">${count}</span>
          <div style="margin-left:auto;display:flex;gap:4px;flex-shrink:0">
            <button class="btn btn-sm" onclick="openEditBoundaryTypeModal('${esc(child.id)}')">${t('boundary_types.edit_btn')}</button>
            <button class="btn btn-sm btn-danger" onclick="deleteBoundaryType('${esc(child.id)}')">${t('boundary_types.delete_btn')}</button>
          </div>
        </div>`;

        return row + (collapsed ? '' : renderChildren(child.id, depth + 1, next));
      }).join('');
  }

  const plotsHasChildren = types.some(t => t.primitiveId === null);
  const plotsCollapsed   = _btypeCollapsed.has('plots');
  const plotsCount       = data.plots.length;

  const plotsToggle = plotsHasChildren
    ? `<button class="btype-toggle" onclick="toggleBtype('plots')">${plotsCollapsed ? '▶' : '▼'}</button>`
    : `<span class="btype-toggle"></span>`;

  const plotsRow = `<div class="btype-tree-row">
    ${plotsToggle}<span class="btype-chip">Plots</span>
    <span class="btype-count">${plotsCount}</span>
  </div>`;

  return `<div class="btype-tree">
    ${plotsRow}
    ${plotsCollapsed ? '' : renderChildren(null, 1, new Set())}
  </div>`;
}

let _btypeEditId = null;

function openAddBoundaryTypeModal() {
  _btypeEditId = null;
  _openBtypeModal(t('boundary_types.modal_add_title'), '', null);
}

function openEditBoundaryTypeModal(id) {
  const type = data.boundaryTypes.find(t => t.id === id);
  if (!type) return;
  _btypeEditId = id;
  _openBtypeModal(t('boundary_types.modal_edit_title'), type.name, type.primitiveId);
}

function _openBtypeModal(title, name, primitiveId) {
  // Build primitive options: all types except the one being edited
  const options = data.boundaryTypes
    .filter(t => t.id !== _btypeEditId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `<option value="${esc(t.id)}"${t.id === primitiveId ? ' selected' : ''}>${esc(t.name)}</option>`)
    .join('');

  openModal(title, `
    <div class="form-group">
      <label>${t('boundary_types.name_label')}</label>
      <input type="text" id="btype-name" value="${esc(name)}"
             placeholder="${t('boundary_types.name_placeholder')}" autocomplete="off">
    </div>
    <div class="form-group">
      <label>${t('boundary_types.primitive_label')}</label>
      <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('boundary_types.primitive_help')}</p>
      <select id="btype-primitive">
        <option value=""${!primitiveId ? ' selected' : ''}>${t('boundary_types.plots_implicit')}</option>
        ${options}
      </select>
    </div>
  `, `
    <button class="btn" onclick="closeModal()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" onclick="saveBoundaryType()">${t('btn.save')}</button>
  `);
  setTimeout(() => document.getElementById('btype-name')?.focus(), 50);
}

function saveBoundaryType() {
  const nameEl = document.getElementById('btype-name');
  const primEl = document.getElementById('btype-primitive');
  if (!nameEl || !primEl) return;

  const name        = nameEl.value.trim();
  const primitiveId = primEl.value || null;

  if (!name) {
    toast(t('boundary_types.error_name_empty'), 'error'); return;
  }
  const duplicate = data.boundaryTypes.find(
    t => t.name.toLowerCase() === name.toLowerCase() && t.id !== _btypeEditId
  );
  if (duplicate) {
    toast(t('boundary_types.error_name_duplicate', { name }), 'error'); return;
  }
  if (_hasBtypeCycle(_btypeEditId, primitiveId)) {
    toast(t('boundary_types.error_cycle'), 'error'); return;
  }

  if (_btypeEditId) {
    const type = data.boundaryTypes.find(t => t.id === _btypeEditId);
    if (type) { type.name = name; type.primitiveId = primitiveId; }
  } else {
    data.boundaryTypes.push({ id: uid(), name, primitiveId });
  }

  save();
  closeModal();
  renderBoundaryTypes();
}

function _hasBtypeCycle(editId, proposedPrimitiveId) {
  // Returns true if setting editId.primitiveId = proposedPrimitiveId creates a cycle.
  // For new types (editId = null) no cycle is possible yet.
  if (!editId || !proposedPrimitiveId) return false;
  let cur = proposedPrimitiveId;
  const seen = new Set();
  while (cur) {
    if (cur === editId) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = data.boundaryTypes.find(t => t.id === cur)?.primitiveId ?? null;
  }
  return false;
}

function deleteBoundaryType(id) {
  const type = data.boundaryTypes.find(t => t.id === id);
  if (!type) return;

  const inUse = data.boundaries.filter(b => b.typeId === id).length;
  if (inUse > 0) {
    toast(t('boundary_types.error_has_boundaries', { name: type.name, n: inUse }), 'error');
    return;
  }

  // Warn if other types use this as their primitive
  const dependents = data.boundaryTypes.filter(t => t.primitiveId === id);
  const msg = dependents.length > 0
    ? t('boundary_types.confirm_delete_with_deps', {
        name: type.name,
        deps: dependents.map(t => t.name).join(', ')
      })
    : t('boundary_types.confirm_delete', { name: type.name });

  appConfirm(msg, () => {
    // Detach dependents: set their primitiveId to what the deleted type pointed at
    dependents.forEach(dep => { dep.primitiveId = type.primitiveId; });
    data.boundaryTypes = data.boundaryTypes.filter(t => t.id !== id);
    save();
    toast(t('boundary_types.deleted_toast', { name: type.name }), 'success');
    renderBoundaryTypes();
  });
}

function renderSettings() {
  const el = document.getElementById('settings-content');
  if (!el) return;
  const langOpts = _availableLanguages.map(l =>
    `<option value="${l.code}"${l.code === _lang ? ' selected' : ''}>${esc(l.name)}</option>`
  ).join('');
  el.innerHTML = `
    <div class="ie-card">
      <h3>${t('settings.language')}</h3>
      <p>${t('settings.language_desc')}</p>
      <select onchange="setLanguage(this.value)" style="max-width:240px">${langOpts}</select>
    </div>
  `;
}

function renderImportExport() {
  const el = document.getElementById('import-export-content');
  if (!el) return;
  el.innerHTML = `
    <div class="ie-card">
      <h3>${t('ie.json_title')}</h3>
      <p>${t('ie.json_desc')}</p>
      <div class="flex gap-8">
        <button class="btn" onclick="importData()">↑ ${t('btn.import_json')}</button>
        <button class="btn" onclick="exportData()">↓ ${t('btn.export_json')}</button>
      </div>
    </div>
    <div class="ie-card">
      <h3>${t('ie.saves_title')}</h3>
      <p>${t('ie.saves_desc')}</p>
      <button class="btn btn-primary" onclick="openSaveManager()">${t('ie.manage_saves')}</button>
    </div>
  `;
}

// ============================================================
// IMPORT MODAL — Overpass-driven plot creation
// ============================================================
// Three modes share an Import → Commit flow:
//   Search: two-step area + to-import filters, AND'd key-value rows.
//   By ID:  paste a relation ID directly.
//   Custom: power-user passthrough.
// The footer's primary "Import" button runs the query, parses the
// response, partitions candidates accept vs. reject by overlap test,
// and renders a list + an inset preview map inside the modal. A
// "Commit" button then appears inline in the result area when there
// are accepted candidates — clicking it persists them to data.osm /
// data.plots.

let _importPreview = null;

function openImportModal() {
  _importPreview = null;
  destroyPreviewMap();

  openModal(t('import.title'), `
    <div class="import-tabs">
      <button class="import-tab active" data-mode="search" onclick="switchImportMode('search')">${t('import.tab_search')}</button>
      <button class="import-tab" data-mode="byid" onclick="switchImportMode('byid')">${t('import.tab_byid')}</button>
      <button class="import-tab" data-mode="custom" onclick="switchImportMode('custom')">${t('import.tab_custom')}</button>
    </div>

    <div class="import-pane" data-mode="search">
      <div class="form-group">
        <label>${t('import.search_area_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('import.search_area_help')}</p>
        <div id="import-area-rows" class="import-rows"></div>
        <button class="btn btn-sm" onclick="addImportRow('area')">+ ${t('import.add_row')}</button>
      </div>
      <div class="form-group">
        <label>${t('import.import_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('import.import_help')}</p>
        <div id="import-import-rows" class="import-rows"></div>
        <button class="btn btn-sm" onclick="addImportRow('import')">+ ${t('import.add_row')}</button>
      </div>
    </div>

    <div class="import-pane" data-mode="byid" style="display:none">
      <div class="form-group">
        <label>${t('import.byid_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('import.byid_help')}</p>
        <input type="number" id="import-byid-input" placeholder="12345" autocomplete="off" style="max-width:240px">
      </div>
    </div>

    <div class="import-pane" data-mode="custom" style="display:none">
      <div class="form-group">
        <label>${t('import.custom_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('import.custom_help')}</p>
        <textarea id="import-custom-input" rows="8" placeholder="[bbox:s,w,n,e];&#10;relation[&quot;name&quot;=&quot;Foo&quot;];&#10;(._;>;);&#10;out body;" style="font-family:var(--font-mono);font-size:12px"></textarea>
      </div>
    </div>

    <div id="import-preview-result" style="margin-top:16px"></div>
  `, `
    <button class="btn" onclick="closeImportModal()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" id="import-action-btn" onclick="runImportPreview()">${t('import.import_btn')}</button>
  `);

  // Empty seed rows so the user sees the structure but doesn't
  // accidentally fire a world-spanning admin_level=2 search on first click.
  addImportRow('area');
  addImportRow('import');

  // Make the modal a bit taller so the inset preview map gets room.
  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '720px';
}

function switchImportMode(mode) {
  document.querySelectorAll('.import-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.import-pane').forEach(p => p.style.display = (p.dataset.mode === mode) ? 'block' : 'none');
  setImportPreviewHTML('');
  destroyPreviewMap();
  _importPreview = null;
}

function getImportMode() {
  return document.querySelector('.import-tab.active')?.dataset.mode || 'search';
}

function addImportRow(target, seed) {
  const containerId = target === 'area' ? 'import-area-rows' : 'import-import-rows';
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'import-tag-row';
  row.innerHTML = `
    <input type="text" placeholder="${t('import.key_placeholder')}" value="${esc(seed?.key || '')}" data-field="key">
    <input type="text" placeholder="${t('import.value_placeholder')}" value="${esc(seed?.value || '')}" data-field="value">
    <button class="btn btn-sm" title="${t('import.remove_row')}" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(row);
}

function readImportRows(target) {
  const containerId = target === 'area' ? 'import-area-rows' : 'import-import-rows';
  const rows = document.getElementById(containerId)?.querySelectorAll('.import-tag-row') || [];
  const out = [];
  rows.forEach(r => {
    const key = r.querySelector('[data-field="key"]').value.trim();
    const value = r.querySelector('[data-field="value"]').value.trim();
    if (key && value) out.push([key, value]);
  });
  return out;
}

async function runImportPreview() {
  const mode = getImportMode();
  let query;
  try {
    if (mode === 'search') {
      const area = readImportRows('area');
      const imp = readImportRows('import');
      if (area.length === 0 || imp.length === 0) {
        toast(t('import.error_empty_filters'), 'error');
        return;
      }
      query = buildSearchQuery(area, imp);
    } else if (mode === 'byid') {
      const id = (document.getElementById('import-byid-input')?.value || '').trim();
      if (!id || !/^\d+$/.test(id)) { toast(t('import.error_byid_invalid'), 'error'); return; }
      query = buildByIdQuery(id);
    } else {
      const text = (document.getElementById('import-custom-input')?.value || '').trim();
      if (!text) { toast(t('import.error_custom_empty'), 'error'); return; }
      query = buildCustomQuery(text);
    }
  } catch (e) {
    toast(t('import.error_query_build', { msg: e.message }), 'error');
    return;
  }

  setImportPreviewHTML(`<div class="text-dim" style="font-size:13px">${t('import.fetching')}</div>`);
  destroyPreviewMap();
  _importPreview = null;

  setImportActionBusy(true);
  let json;
  try {
    json = await overpassFetch(query);
  } catch (e) {
    setImportPreviewHTML('');
    setImportActionBusy(false);
    if (e.is429) {
      const msg = e.retryAfter != null
        ? t('import.error_rate_limited', { seconds: e.retryAfter })
        : t('import.error_rate_limited_no_eta');
      toast(msg, 'error');
    } else {
      toast(t('import.error_fetch', { msg: e.message }), 'error');
    }
    return;
  }
  setImportActionBusy(false);

  let parsed;
  try {
    parsed = parseImport(json);
  } catch (e) {
    toast(t('import.error_parse', { msg: e.message }), 'error');
    setImportPreviewHTML('');
    return;
  }

  if (parsed.candidates.length === 0) {
    let msg = t('import.no_results');
    if (parsed.skipped > 0) msg += ' ' + t('import.skipped', { n: parsed.skipped });
    setImportPreviewHTML(`<div class="text-dim" style="font-size:13px">${msg}</div>`);
    toast(msg, 'warning');
    return;
  }

  // Partition accept vs. reject by overlap with existing plots.
  const existingGeos = data.plots.map(p => resolvePlotGeometry(p));
  for (const c of parsed.candidates) {
    c._rejected = existingGeos.some(g => plotsOverlap(c.geometry, g));
  }
  const accepted = parsed.candidates.filter(c => !c._rejected);
  const rejected = parsed.candidates.filter(c => c._rejected);
  parsed._accepted = accepted;
  parsed._rejected = rejected;
  _importPreview = parsed;

  let listHtml = `<ul class="import-result-list">`;
  for (const c of accepted) {
    listHtml += `<li><span class="import-result-mark ok">✓</span> ${c.name ? esc(c.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`} <span class="text-muted mono">#${c.ogfRelationId}</span></li>`;
  }
  for (const c of rejected) {
    listHtml += `<li class="rejected"><span class="import-result-mark warn">⊘</span> ${c.name ? esc(c.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`} <span class="text-muted mono">#${c.ogfRelationId}</span> <span class="text-muted">— ${t('import.rejected_overlap')}</span></li>`;
  }
  listHtml += `</ul>`;

  let header = `<div style="font-size:13px"><strong>${t('import.found', { n: parsed.candidates.length })}</strong>`;
  if (parsed.skipped > 0) header += ` <span class="text-dim">(${t('import.skipped', { n: parsed.skipped })})</span>`;
  header += `</div>`;

  let footer = '';
  if (rejected.length > 0) {
    footer = `<div style="font-size:12px;color:var(--warn);margin-top:6px">${t('import.rejected_summary', { n: rejected.length })}</div>`;
  }

  const commitBtn = accepted.length > 0
    ? `<div class="flex" style="justify-content:flex-end;margin-top:12px">
         <button class="btn btn-primary" onclick="runImportCommit()">${t('import.commit_btn', { n: accepted.length })}</button>
       </div>`
    : '';

  setImportPreviewHTML(`
    ${header}
    ${listHtml}
    ${footer}
    <div id="import-preview-map" style="height:240px;margin-top:10px;border-radius:var(--radius);border:1px solid var(--border);overflow:hidden"></div>
    ${commitBtn}
  `);

  ensurePreviewMap('import-preview-map');
  drawPreviewCandidates(parsed.candidates);
}

function runImportCommit() {
  if (!_importPreview || !_importPreview._accepted || _importPreview._accepted.length === 0) return;
  const { _accepted, nodes, ways } = _importPreview;

  // Merge node/way pool into data.osm (dedupes by OGF id automatically).
  for (const id of Object.keys(nodes)) {
    osmAddNode(id, nodes[id].lat, nodes[id].lon);
  }
  for (const id of Object.keys(ways)) {
    osmAddWay(id, ways[id].nodes);
  }

  for (const c of _accepted) {
    createPlot({
      name: c.name,
      ogfRelationId: c.ogfRelationId,
      outers: c.outers,
      inners: c.inners,
    });
  }

  toast(t('import.imported_toast', { n: _accepted.length }), 'success');
  save();
  closeImportModal();
  refreshAll();
  redrawMapPlots();
}

function closeImportModal() {
  _importPreview = null;
  destroyPreviewMap();
  closeModal();
}

function setImportPreviewHTML(html) {
  const el = document.getElementById('import-preview-result');
  if (el) el.innerHTML = html;
}

function setImportActionBusy(busy) {
  const btn = document.getElementById('import-action-btn');
  if (btn) btn.disabled = !!busy;
}

// ============================================================
// PLOT-DETAIL MODAL — view, edit, delete a single plot
// ============================================================
// Brick 3: row click → modal. Name + notes auto-save on blur, delete
// fires appConfirm. Read-only metadata (OGF id, plot id, area) and
// an inset Leaflet map for visual confirmation, mirroring the
// import-preview-map pattern. Map remains the visualiser; this modal
// is the data-stewardship surface.

let _detailPlotId = null;

function openPlotDetail(plotId) {
  const plot = data.plots.find(p => p.id === plotId);
  if (!plot) return;
  _detailPlotId = plotId;

  openModal(t('plot_detail.title'), `
    <div class="form-group">
      <label>${t('plot_detail.name_label')}</label>
      <input type="text" id="plot-detail-name"
        value="${esc(plot.name || '')}"
        placeholder="${t('plot_detail.name_placeholder')}"
        onblur="onPlotDetailSave()">
    </div>
    <div class="form-group">
      <label>${t('plot_detail.notes_label')}</label>
      <textarea id="plot-detail-notes" rows="3"
        placeholder="${t('plot_detail.notes_placeholder')}"
        onblur="onPlotDetailSave()">${esc(plot.notes || '')}</textarea>
    </div>
    <div class="plot-detail-meta">
      <div>
        <div class="plot-detail-meta-label">${t('plot_detail.ogf_id')}</div>
        <div class="plot-detail-meta-value mono">${plot.ogfRelationId != null ? plot.ogfRelationId : '—'}</div>
      </div>
      <div>
        <div class="plot-detail-meta-label">${t('plot_detail.plot_id')}</div>
        <div class="plot-detail-meta-value mono">${esc(plot.id)}</div>
      </div>
      <div>
        <div class="plot-detail-meta-label">${t('plot_detail.area')}</div>
        <div class="plot-detail-meta-value mono">${formatArea(plotArea(plot))}</div>
      </div>
    </div>
    <div id="plot-detail-map" style="height:240px;margin-top:12px;border-radius:var(--radius);border:1px solid var(--border);overflow:hidden"></div>
  `, `
    <button class="btn btn-danger" style="margin-right:auto" onclick="onPlotDetailDelete()">${t('plot_detail.delete_btn')}</button>
    <button class="btn" onclick="closePlotDetail()">${t('btn.close')}</button>
  `);

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '640px';

  ensureDetailMap('plot-detail-map');
  drawDetailPlot(plot);
}

function onPlotDetailSave() {
  if (!_detailPlotId) return;
  const plot = data.plots.find(p => p.id === _detailPlotId);
  if (!plot) return;
  const nameEl = document.getElementById('plot-detail-name');
  const notesEl = document.getElementById('plot-detail-notes');
  const newName = nameEl ? nameEl.value : plot.name;
  const newNotes = notesEl ? notesEl.value : plot.notes;
  if (plot.name === newName && plot.notes === newNotes) return;
  plot.name = newName;
  plot.notes = newNotes;
  save();
  renderPlotsBody();
  redrawMapPlots();
}

function onPlotDetailDelete() {
  if (!_detailPlotId) return;
  const plot = data.plots.find(p => p.id === _detailPlotId);
  if (!plot) return;
  const displayName = plot.name || t('plots.unnamed');
  appConfirm(t('plot_detail.confirm_delete', { name: displayName }), () => {
    const idx = data.plots.findIndex(p => p.id === _detailPlotId);
    if (idx < 0) return;
    data.plots.splice(idx, 1);
    save();
    closePlotDetail();
    refreshAll();
    redrawMapPlots();
    toast(t('plot_detail.deleted_toast', { name: displayName }), 'success');
  });
}

function closePlotDetail() {
  // Capture any pending edits before tearing down the modal so a click
  // straight to Close (without blurring the input first) still saves.
  onPlotDetailSave();
  _detailPlotId = null;
  destroyDetailMap();
  closeModal();
}
