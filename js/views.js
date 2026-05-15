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
      <div class="stat-card"><div class="stat-value">${(data.settlements || []).length}</div><div class="stat-label">${t('stat.settlements')}</div></div>
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
// Brick 11c: multi-selection for the merge gesture. Set is shared by
// the Plots table (checkbox column) and the map (shift+click). The
// helpers below keep both views in sync.
let _plotsSelection = new Set();

function isPlotSelected(id) { return _plotsSelection.has(id); }
function selectedPlotIds()   { return Array.from(_plotsSelection); }
function togglePlotSelection(id) {
  if (_plotsSelection.has(id)) _plotsSelection.delete(id);
  else                          _plotsSelection.add(id);
  _refreshPlotSelectionVisuals();
}
function setPlotSelection(ids) {
  _plotsSelection = new Set(ids || []);
  _refreshPlotSelectionVisuals();
}
function clearPlotSelection() { setPlotSelection([]); }

// Repaints the Plots table body (so checkboxes + toolbar stay in sync)
// and the map (so highlight rings update). Used by both views and the
// map-side multi-select handlers.
function _refreshPlotSelectionVisuals() {
  if (typeof renderPlotsToolbar === 'function') renderPlotsToolbar();
  if (typeof renderPlotsBody === 'function')    renderPlotsBody();
  // redrawMap pulls in renderMapToolbar (where the merge floater lives)
  // AND re-strokes the plot polygons with the new multi-select state.
  if (typeof redrawMap === 'function')          redrawMap();
}

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
    <div id="plots-toolbar"></div>
    <table class="data-table">
      <thead>
        <tr>
          <th class="plots-select-col">
            <input type="checkbox" id="plots-select-all"
              onchange="onPlotsSelectAllToggle(this.checked)"
              title="${esc(t('plots.select_all'))}">
          </th>
          ${plotsSortHeader('name', t('plots.col_name'))}
          ${plotsSortHeader('area', t('plots.col_area'))}
          ${plotsSortHeader('ogfId', t('plots.col_ogf_id'))}
        </tr>
      </thead>
      <tbody id="plots-tbody"></tbody>
    </table>
    <div id="plots-empty-result"></div>`;
  renderPlotsToolbar();
  renderPlotsBody();
}

// Compact toolbar above the Plots table: selection count + Merge / Clear.
function renderPlotsToolbar() {
  const el = document.getElementById('plots-toolbar');
  if (!el) return;
  const n = _plotsSelection.size;
  if (n === 0) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="plots-toolbar">
      <span class="plots-toolbar-count">${t('plots.selected_count', { n })}</span>
      <button class="btn btn-sm btn-primary"
        onclick="openMergeModal()"
        ${n < 2 ? 'disabled' : ''}>${t('plots.merge_btn')}</button>
      <button class="btn btn-sm"
        onclick="clearPlotSelection()">${t('plots.clear_selection')}</button>
    </div>
  `;
}

function onPlotsSelectAllToggle(checked) {
  if (!checked) { clearPlotSelection(); return; }
  // Select all in current filtered view.
  const q = _plotsSearch.trim().toLowerCase();
  const ids = (data.plots || [])
    .filter(p => !q || (p.name || '').toLowerCase().includes(q))
    .map(p => p.id);
  setPlotSelection(ids);
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

  tbody.innerHTML = list.map(p => {
    const hasFlags = p.flags && p.flags.length > 0;
    const flagBadge = hasFlags ? ` <span class="plot-flag-badge" title="${p.flags.map(f => t('plot_detail.flag_' + f)).join('; ')}">⚠</span>` : '';
    const nameCell = (p.name ? esc(p.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`) + flagBadge;
    const checked = isPlotSelected(p.id) ? 'checked' : '';
    const rowCls  = 'row-click' + (isPlotSelected(p.id) ? ' row-selected' : '');
    return `<tr class="${rowCls}" onclick="openPlotDetail('${esc(p.id)}')">
      <td class="plots-select-col" onclick="event.stopPropagation()">
        <input type="checkbox" ${checked}
          onchange="togglePlotSelection('${esc(p.id)}')">
      </td>
      <td>${nameCell}</td>
      <td class="mono">${formatArea(plotArea(p))}</td>
      <td class="mono">${p.ogfRelationId != null ? p.ogfRelationId : '<span class="text-muted">—</span>'}</td>
    </tr>`;
  }).join('');

  // Header "select all" tri-state: tick if every visible row is
  // selected, unchecked if none, indeterminate if partial.
  const selAll = document.getElementById('plots-select-all');
  if (selAll) {
    const visIds = list.map(p => p.id);
    const selectedHere = visIds.filter(id => _plotsSelection.has(id)).length;
    selAll.checked = visIds.length > 0 && selectedHere === visIds.length;
    selAll.indeterminate = selectedHere > 0 && selectedHere < visIds.length;
  }

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
// MERGE MODAL (Brick 11c)
// ============================================================
// Opened from either the Plots table toolbar or the map's merge
// floater. Shows source plots, merged-plot name/notes inputs, a
// boundary-membership reconciler (per-type dropdowns for conflicts),
// and an editable property-reconciliation row per applicable schema.
// Confirm calls `executePlotMerge`.

let _mergeState = null;

function openMergeModal() {
  const ids = selectedPlotIds();
  if (ids.length < 2) { toast(t('plots.merge_need_two'), 'warning'); return; }
  if (typeof computePlotMerge !== 'function') { toast(t('plots.merge_no_engine'), 'error'); return; }
  const pre = computePlotMerge(ids);
  if (pre.error) { toast(t('plot_merge.error_' + pre.error) || pre.error, 'error'); return; }

  _mergeState = {
    ids,
    name:  pre.proposedName,
    notes: pre.proposedNotes,
    propertyValues:     { ...pre.proposedValues },
    boundarySelections: {},
    sourcePlots:        pre.sourcePlots,
    sourceAreas:        pre.sourceAreas,
    isAdjacent:         pre.isAdjacent,
    conflicts:          pre.conflicts,
    autoMemberships:    pre.autoMemberships,
  };
  // Default each conflict's selection to the boundary holding the most
  // source-area, so the modal opens with a reasonable pre-pick.
  for (const c of (_mergeState.conflicts || [])) {
    _mergeState.boundarySelections[c.typeId] = _defaultBoundaryForConflict(c);
  }

  _renderMergeModal();
}

function _defaultBoundaryForConflict(conflict) {
  // Pick the boundary in the conflict whose member-overlap with the
  // source plots covers the largest total source area.
  const sourceIds = new Set(_mergeState.ids);
  let best = conflict.boundaryIds[0] || '';
  let bestArea = -1;
  for (const bId of conflict.boundaryIds) {
    const b = (data.boundaries || []).find(x => x.id === bId);
    if (!b) continue;
    let area = 0;
    for (const m of (b.members || [])) {
      if (m.kind !== 'plot' || !sourceIds.has(m.id)) continue;
      const idx = _mergeState.ids.indexOf(m.id);
      if (idx >= 0) area += (_mergeState.sourceAreas[idx] || 0);
    }
    if (area > bestArea) { best = bId; bestArea = area; }
  }
  return best;
}

function _renderMergeModal() {
  if (!_mergeState) return;
  const s = _mergeState;
  const n = s.ids.length;

  // Source plots list.
  const sourcesHtml = s.sourcePlots.map((p, i) => `
    <div class="merge-source-row">
      <span class="merge-source-name">${p.name ? esc(p.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`}</span>
      <span class="merge-source-area mono">${esc(formatArea(s.sourceAreas[i] || 0))}</span>
    </div>
  `).join('');

  const adjacencyHint = s.isAdjacent
    ? ''
    : `<div class="merge-warn">${t('plot_merge.non_adjacent_hint')}</div>`;

  // Boundary memberships.
  let boundariesHtml = '';
  const autoNames = (s.autoMemberships || [])
    .map(bId => (data.boundaries || []).find(b => b.id === bId))
    .filter(Boolean)
    .map(b => esc(b.name || `(${getBoundaryTypeName(b.typeId)})`));
  if (autoNames.length > 0) {
    boundariesHtml += `<div class="merge-boundaries-auto">${t('plot_merge.boundaries_auto')}: ${autoNames.join(', ')}</div>`;
  }
  for (const c of (s.conflicts || [])) {
    const typeName = getBoundaryTypeName(c.typeId) || c.typeId;
    const opts = c.boundaryIds.map(bId => {
      const b = (data.boundaries || []).find(x => x.id === bId);
      const label = b ? (b.name || `(${typeName})`) : bId;
      const sel = s.boundarySelections[c.typeId] === bId ? ' selected' : '';
      return `<option value="${esc(bId)}"${sel}>${esc(label)}</option>`;
    }).join('');
    const noneSel = !s.boundarySelections[c.typeId] ? ' selected' : '';
    boundariesHtml += `
      <div class="merge-boundary-row">
        <label>${esc(typeName)}:</label>
        <select onchange="onMergeBoundaryChange('${esc(c.typeId)}', this.value)">
          <option value=""${noneSel}>${t('plot_merge.boundary_none')}</option>
          ${opts}
        </select>
      </div>
    `;
  }
  if (!boundariesHtml) {
    boundariesHtml = `<div class="text-dim" style="font-size:12px">${t('plot_merge.boundaries_none')}</div>`;
  }

  // Property reconciliation rows.
  const schemas = (data.propertySchemas || [])
    .filter(sc => appliesAtLevel(sc, 'plot') && !isVirtualPropertyId(sc.id))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const propRows = schemas.map(schema => {
    const sources = s.sourcePlots.map(p => getPlotPropertyValue(p, schema.id));
    const hasAny = sources.some(v => v !== undefined && v !== null && v !== '');
    if (!hasAny) return '';
    const sourcesDisplay = sources.map((v, i) =>
      v === undefined || v === null || v === ''
        ? '—'
        : esc(_splitFormatParentValue(schema, v))
    ).join(' · ');
    const merged = s.propertyValues[schema.id];
    const inputHtml = _renderMergeInputCell(schema, merged);
    return `
      <div class="merge-prop-row">
        <div class="merge-prop-name">${esc(schema.name)}${schema.unit ? ` <span class="merge-prop-unit">${esc(schema.unit)}</span>` : ''}</div>
        <div class="merge-prop-sources mono">${sourcesDisplay}</div>
        <div class="merge-prop-input">${inputHtml}</div>
      </div>
    `;
  }).filter(Boolean).join('');
  const propSection = propRows
    ? `<div class="merge-props">${propRows}</div>`
    : `<div class="text-dim" style="font-size:12px">${t('plot_merge.no_props')}</div>`;

  const body = `
    <div class="merge-modal-section">
      <div class="merge-modal-section-label">${t('plot_merge.sources_label')}</div>
      <div class="merge-sources-list">${sourcesHtml}</div>
      ${adjacencyHint}
    </div>
    <div class="merge-modal-section">
      <label class="merge-modal-section-label">${t('plot_merge.name_label')}</label>
      <input type="text" id="merge-name" value="${esc(s.name)}"
        oninput="_mergeState && (_mergeState.name = this.value)">
    </div>
    <div class="merge-modal-section">
      <label class="merge-modal-section-label">${t('plot_merge.notes_label')}</label>
      <textarea id="merge-notes" rows="2"
        oninput="_mergeState && (_mergeState.notes = this.value)">${esc(s.notes)}</textarea>
    </div>
    <div class="merge-modal-section">
      <div class="merge-modal-section-label">${t('plot_merge.boundaries_label')}</div>
      ${boundariesHtml}
    </div>
    <div class="merge-modal-section">
      <div class="merge-modal-section-label">${t('plot_merge.properties_label')}</div>
      ${propSection}
    </div>
  `;
  const footer = `
    <button class="btn" onclick="closeMergeModal()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" onclick="onMergeConfirm()">${t('plot_merge.confirm_btn', { n })}</button>
  `;
  openModal(t('plot_merge.title', { n }), body, footer);
}

function _renderMergeInputCell(schema, val) {
  const base = `data-schema-id="${esc(schema.id)}" data-kind="${schema.kind}"`;
  if (schema.kind === 'numeric') {
    const n = Number(val);
    const display = Number.isFinite(n) ? formatPropertyNumber(n) : '';
    return `<input type="number" step="any" class="merge-cell-input" value="${esc(display)}" ${base} oninput="onMergePropertyInput(this)">`;
  }
  if (schema.kind === 'categorical') {
    return `<input type="text" class="merge-cell-input" value="${esc(val || '')}" ${base} oninput="onMergePropertyInput(this)">`;
  }
  if (schema.kind === 'percentage') {
    const obj = (val && typeof val === 'object') ? val : { mode: 'percent', value: '' };
    const mode = obj.mode === 'raw' ? 'raw' : 'percent';
    const n = Number(obj.value);
    const display = Number.isFinite(n) ? formatPropertyNumber(n) : '';
    const suffix = mode === 'percent' ? '%' : (findPropertySchema(schema.denominatorPropertyId)?.unit || '');
    return `
      <span class="merge-percent-cell">
        <input type="number" step="any" class="merge-cell-input"
          value="${esc(display)}" ${base} data-mode="${mode}"
          oninput="onMergePropertyInput(this)">
        <span class="merge-percent-suffix">${esc(suffix || '')}</span>
      </span>
    `;
  }
  return '';
}

function onMergeBoundaryChange(typeId, value) {
  if (!_mergeState) return;
  _mergeState.boundarySelections[typeId] = value || '';
}

function onMergePropertyInput(inputEl) {
  if (!_mergeState) return;
  const schemaId = inputEl.dataset.schemaId;
  const kind     = inputEl.dataset.kind;
  const raw      = inputEl.value;
  if (raw === '' || raw == null) { delete _mergeState.propertyValues[schemaId]; return; }
  if (kind === 'numeric') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const schema = findPropertySchema(schemaId);
    _mergeState.propertyValues[schemaId] = schema?.autoRound ? Math.round(n) : n;
    return;
  }
  if (kind === 'categorical') {
    _mergeState.propertyValues[schemaId] = raw;
    return;
  }
  if (kind === 'percentage') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const mode = inputEl.dataset.mode === 'raw' ? 'raw' : 'percent';
    _mergeState.propertyValues[schemaId] = { mode, value: n };
    return;
  }
}

function onMergeConfirm() {
  if (!_mergeState) return;
  const s = _mergeState;
  if (typeof executePlotMerge !== 'function') {
    toast(t('plots.merge_no_engine'), 'error');
    return;
  }
  const newId = executePlotMerge(
    s.ids, s.name, s.notes, s.propertyValues, s.boundarySelections
  );
  if (!newId) { toast(t('plot_merge.error_execute'), 'error'); return; }
  closeMergeModal();
  clearPlotSelection();
  refreshAll();
  redrawMapPlots();
  toast(t('plot_merge.success_toast', { n: s.ids.length }), 'success');
}

function closeMergeModal() {
  _mergeState = null;
  closeModal();
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
  // Schemas rooted at this type — they'll promote to its parent on delete.
  const rootedSchemas = (data.propertySchemas || []).filter(s => s.rootLevelId === id);
  let msg = dependents.length > 0
    ? t('boundary_types.confirm_delete_with_deps', {
        name: type.name,
        deps: dependents.map(t => t.name).join(', ')
      })
    : t('boundary_types.confirm_delete', { name: type.name });

  // Branching hierarchy + rooted schemas = potential data loss once
  // boundary-level property values exist (Brick 10b/c). The schema can
  // only promote to ONE parent; sibling parents lose the rooted
  // properties in their inspectors. Surface this explicitly so the
  // user can re-root manually if they need the other branch.
  if (rootedSchemas.length > 0 && dependents.length > 1) {
    msg += '\n\n' + t('boundary_types.confirm_delete_branching_schemas', {
      schemas: rootedSchemas.map(s => s.name).join(', '),
      winner: dependents[0].name,
      losers: dependents.slice(1).map(d => d.name).join(', '),
    });
  }

  appConfirm(msg, () => {
    // Schema-root promotion (Brick 10a). A property schema rooted at the
    // deleted type promotes to that type's *parent* (a type whose
    // primitiveId pointed at the deleted one) — least-impact relink, so
    // data stays at the higher / more-aggregate level rather than
    // sliding down into a smaller-than-intended one. If the deleted type
    // was top-level (no parent), fall back to 'plot'. In a branching
    // hierarchy with multiple parents we pick the first deterministically
    // (`dependents` is the list of types that pointed at this one).
    const promotedRoot = dependents.length > 0 ? dependents[0].id : 'plot';
    (data.propertySchemas || []).forEach(s => {
      if (s.rootLevelId === id) s.rootLevelId = promotedRoot;
    });
    // Detach type dependents: set their primitiveId to what the deleted type pointed at
    dependents.forEach(dep => { dep.primitiveId = type.primitiveId; });
    data.boundaryTypes = data.boundaryTypes.filter(t => t.id !== id);
    save();
    toast(t('boundary_types.deleted_toast', { name: type.name }), 'success');
    renderBoundaryTypes();
  });
}

// ============================================================
// BOUNDARIES — list view (Brick 6a)
// ============================================================
// Boundaries group plots and sub-boundaries. Hierarchy is enforced via
// the type's primitiveId chain (transitive containment) and global
// exclusivity (every plot/boundary has ≤ 1 direct parent). Map rendering
// + drill-through arrives in Brick 6b.

let _boundariesSort = { column: 'name', direction: 'asc' };
let _boundariesSearch = '';

function renderBoundaries() {
  const el = document.getElementById('boundaries-content');
  if (!el) return;
  bootstrapBoundaryTypes();

  // Without any boundary types we can't create boundaries; show a redirect.
  if (data.boundaryTypes.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">≡</div>
        <h3>${t('boundaries.no_types_title')}</h3>
        <p>${t('boundaries.no_types_body')}</p>
        <button class="btn btn-primary" onclick="switchTab('boundary-types')">${t('nav.boundary_types')}</button>
      </div>`;
    return;
  }

  const all = data.boundaries;
  const top = `
    <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <button class="btn btn-primary" onclick="openCreateBoundaryModal()">${t('boundaries.add_btn')}</button>
      <span class="text-dim" style="font-size:12px">${t('boundaries.count', { n: all.length })}</span>
    </div>`;

  if (all.length === 0) {
    el.innerHTML = top + `
      <div class="empty-state">
        <div class="empty-icon">⬢</div>
        <h3>${t('boundaries.empty_title')}</h3>
        <p>${t('boundaries.empty_body')}</p>
        <button class="btn btn-primary" onclick="openCreateBoundaryModal()">${t('boundaries.add_btn')}</button>
      </div>`;
    return;
  }

  el.innerHTML = top + `
    <div style="margin-bottom:12px">
      <input type="text" id="boundaries-search-input"
        placeholder="${t('boundaries.search_placeholder')}"
        oninput="onBoundariesSearch(this.value)"
        value="${esc(_boundariesSearch)}"
        autocomplete="off"
        style="max-width:320px">
    </div>
    <table class="data-table">
      <thead>
        <tr>
          ${boundariesSortHeader('name', t('boundaries.col_name'))}
          ${boundariesSortHeader('type', t('boundaries.col_type'))}
          ${boundariesSortHeader('members', t('boundaries.col_members'))}
          ${boundariesSortHeader('area', t('boundaries.col_area'))}
        </tr>
      </thead>
      <tbody id="boundaries-tbody"></tbody>
    </table>
    <div id="boundaries-empty-result"></div>`;
  _renderBoundariesBody();
}

function boundariesSortHeader(col, label) {
  const active = _boundariesSort.column === col;
  const arrow = active ? (_boundariesSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th class="sortable${active ? ' active' : ''}" onclick="onBoundariesSort('${col}')">${label}${arrow}</th>`;
}

function _renderBoundariesBody() {
  const tbody = document.getElementById('boundaries-tbody');
  const emptyEl = document.getElementById('boundaries-empty-result');
  if (!tbody) return;

  const q = _boundariesSearch.trim().toLowerCase();
  let list = data.boundaries;
  if (q) list = list.filter(b => (b.name || '').toLowerCase().includes(q));

  list = list.slice().sort((a, b) => {
    const dir = _boundariesSort.direction === 'asc' ? 1 : -1;
    if (_boundariesSort.column === 'name')    return dir * (a.name || '').localeCompare(b.name || '');
    if (_boundariesSort.column === 'type')    return dir * getBoundaryTypeName(a.typeId).localeCompare(getBoundaryTypeName(b.typeId));
    if (_boundariesSort.column === 'members') return dir * (getBoundaryMemberCount(a) - getBoundaryMemberCount(b));
    if (_boundariesSort.column === 'area')    return dir * (boundaryArea(a) - boundaryArea(b));
    return 0;
  });

  tbody.innerHTML = list.map(b => {
    const hasFlags = b.flags && b.flags.length > 0;
    const flagBadge = hasFlags ? ` <span class="plot-flag-badge">⚠</span>` : '';
    const nameCell = (b.name ? esc(b.name) : `<span class="text-muted">${t('boundaries.unnamed')}</span>`) + flagBadge;
    return `<tr class="row-click" onclick="openBoundaryDetail('${esc(b.id)}')">
      <td>${nameCell}</td>
      <td>${esc(getBoundaryTypeName(b.typeId)) || '<span class="text-muted">—</span>'}</td>
      <td class="mono">${getBoundaryMemberCount(b)}</td>
      <td class="mono">${formatArea(boundaryArea(b))}</td>
    </tr>`;
  }).join('');

  if (emptyEl) {
    emptyEl.innerHTML = (q && list.length === 0)
      ? `<div class="text-dim" style="font-size:13px;padding:16px 0">${t('boundaries.no_search_results', { q: esc(_boundariesSearch) })}</div>`
      : '';
  }
}

function onBoundariesSearch(val) {
  _boundariesSearch = val;
  _renderBoundariesBody();
}

function onBoundariesSort(col) {
  if (_boundariesSort.column === col) {
    _boundariesSort.direction = _boundariesSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    _boundariesSort.column = col;
    _boundariesSort.direction = 'asc';
  }
  renderBoundaries();
}

// ============================================================
// SETTLEMENTS — list view (Brick 7a, table polished in 7d)
// ============================================================
// Sortable + searchable table mirroring the Plots tab. Row click
// opens the detail modal (`openSettlementDetail`).

let _settlementsSort = { column: 'name', direction: 'asc' };
let _settlementsSearch = '';

function renderSettlements() {
  const el = document.getElementById('settlements-content');
  if (!el) return;
  const all = data.settlements || [];

  if (all.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◉</div>
        <h3>${t('settlements.empty_title')}</h3>
        <p>${t('settlements.empty_body')}</p>
        <button class="btn btn-primary" onclick="openSettlementImportModal()">+ ${t('settlements.import_btn')}</button>
      </div>`;
    return;
  }

  const top = `
    <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <button class="btn btn-primary" onclick="openSettlementImportModal()">+ ${t('settlements.import_btn')}</button>
      <span class="text-dim" style="font-size:12px">${t('settlements.count', { n: all.length })}</span>
    </div>`;

  el.innerHTML = top + `
    <div style="margin-bottom:12px">
      <input type="text" id="settlements-search-input"
        placeholder="${t('settlements.search_placeholder')}"
        oninput="onSettlementsSearch(this.value)"
        value="${esc(_settlementsSearch)}"
        autocomplete="off"
        style="max-width:320px">
    </div>
    <table class="data-table">
      <thead>
        <tr>
          ${settlementsSortHeader('name', t('settlements.col_name'))}
          ${settlementsSortHeader('place', t('settlements.col_place'))}
          ${settlementsSortHeader('parent', t('settlements.col_parent'))}
          ${settlementsSortHeader('ogfId', t('settlements.col_ogf_id'))}
        </tr>
      </thead>
      <tbody id="settlements-tbody"></tbody>
    </table>
    <div id="settlements-empty-result"></div>`;
  renderSettlementsBody();
}

function settlementsSortHeader(col, label) {
  const active = _settlementsSort.column === col;
  const arrow = active ? (_settlementsSort.direction === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th class="sortable${active ? ' active' : ''}" onclick="onSettlementsSort('${col}')">${label}${arrow}</th>`;
}

function _settlementParentDisplayString(s) {
  const info = (typeof getSettlementParentInfo === 'function') ? getSettlementParentInfo(s) : null;
  if (!info) return '';
  return `${info.typeLabel}: ${info.name || ''}`;
}

function renderSettlementsBody() {
  const tbody = document.getElementById('settlements-tbody');
  const emptyEl = document.getElementById('settlements-empty-result');
  if (!tbody) return;

  const q = _settlementsSearch.trim().toLowerCase();
  let list = data.settlements || [];
  if (q) list = list.filter(s => {
    if ((s.name || '').toLowerCase().includes(q)) return true;
    if ((s.place || '').toLowerCase().includes(q)) return true;
    if (_settlementParentDisplayString(s).toLowerCase().includes(q)) return true;
    if ((s.ogfNodeId || '').includes(q)) return true;
    return false;
  });

  list = list.slice().sort((a, b) => {
    const dir = _settlementsSort.direction === 'asc' ? 1 : -1;
    if (_settlementsSort.column === 'name') {
      return dir * (a.name || '').localeCompare(b.name || '');
    }
    if (_settlementsSort.column === 'place') {
      // Sort by rank so cities/towns cluster together.
      const ra = (typeof rankForPlaceType === 'function') ? rankForPlaceType(a.place) : 0;
      const rb = (typeof rankForPlaceType === 'function') ? rankForPlaceType(b.place) : 0;
      return dir * (rb - ra); // higher rank first when asc (city > town > …)
    }
    if (_settlementsSort.column === 'parent') {
      return dir * _settlementParentDisplayString(a).localeCompare(_settlementParentDisplayString(b));
    }
    if (_settlementsSort.column === 'ogfId') {
      const av = a.ogfNodeId == null ? -Infinity : Number(a.ogfNodeId);
      const bv = b.ogfNodeId == null ? -Infinity : Number(b.ogfNodeId);
      return dir * (av - bv);
    }
    return 0;
  });

  if (list.length === 0) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.innerHTML = `<div class="empty-state-inline">${t('settlements.no_search_results')}</div>`;
    return;
  }
  if (emptyEl) emptyEl.innerHTML = '';

  tbody.innerHTML = list.map(s => {
    const info = getSettlementParentInfo(s);
    const parentLabel = info
      ? `${esc(info.typeLabel)}: ${info.name ? esc(info.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`}`
      : `<span class="text-muted">${t('settlements.no_parent')}</span>`;
    const placeColor = (typeof colorForPlaceType === 'function') ? colorForPlaceType(s.place) : '#7f8c8d';
    return `
      <tr class="row-click" onclick="openSettlementDetail('${esc(s.id)}')">
        <td>${s.name ? esc(s.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`}</td>
        <td><span class="map-popup-type" style="background:${placeColor}">${esc(s.place || '')}</span></td>
        <td>${parentLabel}</td>
        <td class="text-mono text-dim" style="font-size:11px">${esc(s.ogfNodeId || '')}</td>
      </tr>`;
  }).join('');
}

function onSettlementsSearch(value) {
  _settlementsSearch = value;
  renderSettlementsBody();
}

function onSettlementsSort(col) {
  if (_settlementsSort.column === col) {
    _settlementsSort.direction = _settlementsSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    _settlementsSort.column = col;
    _settlementsSort.direction = 'asc';
  }
  renderSettlements();
}

// ============================================================
// SETTLEMENT IMPORT MODAL (Brick 7b)
// ============================================================
// Mirrors the plot import modal: same three modes (Search / By ID /
// Custom), same Overpass plumbing, same default-search-area seeding.
// Distinct module-level state (_settlementImport*) so the two modals
// don't collide. Auto-parent assignment runs at preview time so the
// user can see what each candidate would attach to before committing.

let _settlementImportPreview = null;

function openSettlementImportModal() {
  _settlementImportPreview = null;
  destroyPreviewMap();

  const placeChips = PLACE_TYPES.map(pt => {
    const checked = PLACE_TYPES_DEFAULT_CHECKED.includes(pt);
    return `
      <label class="place-chip">
        <input type="checkbox" value="${esc(pt)}" ${checked ? 'checked' : ''}>
        <span>${esc(pt)}</span>
      </label>`;
  }).join('');

  openModal(t('settlements.import_title'), `
    <div class="import-tabs">
      <button class="import-tab active" data-mode="search" onclick="switchSettlementImportMode('search')">${t('import.tab_search')}</button>
      <button class="import-tab" data-mode="byid" onclick="switchSettlementImportMode('byid')">${t('import.tab_byid')}</button>
      <button class="import-tab" data-mode="custom" onclick="switchSettlementImportMode('custom')">${t('import.tab_custom')}</button>
    </div>

    <div class="import-pane" data-mode="search">
      <div class="form-group">
        <label>${t('import.search_area_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('import.search_area_help')}</p>
        <div id="settlement-import-area-rows" class="import-rows"></div>
        <button class="btn btn-sm" onclick="addSettlementAreaRow()">+ ${t('import.add_row')}</button>
      </div>
      <div class="form-group">
        <label>${t('settlements.import_place_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('settlements.import_place_help')}</p>
        <div id="settlement-place-chips" class="place-chips">${placeChips}</div>
      </div>
    </div>

    <div class="import-pane" data-mode="byid" style="display:none">
      <div class="form-group">
        <label>${t('settlements.import_byid_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('settlements.import_byid_help')}</p>
        <input type="number" id="settlement-import-byid-input" placeholder="12345" autocomplete="off" style="max-width:240px">
      </div>
    </div>

    <div class="import-pane" data-mode="custom" style="display:none">
      <div class="form-group">
        <label>${t('settlements.import_custom_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('settlements.import_custom_help')}</p>
        <textarea id="settlement-import-custom-input" rows="8" placeholder="[bbox:s,w,n,e];&#10;node[place=city];&#10;out body;" style="font-family:var(--font-mono);font-size:12px"></textarea>
      </div>
    </div>

    <div id="settlement-import-preview-result" style="margin-top:16px"></div>
  `, `
    <button class="btn" onclick="closeSettlementImportModal()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" id="settlement-import-action-btn" onclick="runSettlementImportPreview()">${t('import.import_btn')}</button>
  `);

  const defaultArea = getSetting('defaultSearchArea', []);
  if (defaultArea.length > 0) {
    for (const row of defaultArea) addSettlementAreaRow(row);
  } else {
    addSettlementAreaRow();
  }

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '720px';
}

function closeSettlementImportModal() {
  closeModal();
  destroyPreviewMap();
  _settlementImportPreview = null;
}

function switchSettlementImportMode(mode) {
  document.querySelectorAll('#modal .import-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('#modal .import-pane').forEach(p => p.style.display = (p.dataset.mode === mode ? '' : 'none'));
  _setSettlementPreviewHTML('');
  destroyPreviewMap();
  _settlementImportPreview = null;
  _setSettlementActionBtn(t('import.import_btn'), false);
}

function addSettlementAreaRow(seed) {
  const c = document.getElementById('settlement-import-area-rows');
  if (!c) return;
  const row = document.createElement('div');
  row.className = 'import-tag-row';
  row.innerHTML = `
    <input type="text" placeholder="${t('import.key_placeholder')}" value="${esc(seed?.key || seed?.[0] || '')}" data-field="key">
    <input type="text" placeholder="${t('import.value_placeholder')}" value="${esc(seed?.value || seed?.[1] || '')}" data-field="value">
    <button class="btn btn-sm" title="${t('import.remove_row')}" onclick="this.parentElement.remove()">✕</button>`;
  c.appendChild(row);
}

function _readSettlementAreaRows() {
  const rows = document.querySelectorAll('#settlement-import-area-rows .import-tag-row');
  const out = [];
  rows.forEach(r => {
    const k = r.querySelector('[data-field="key"]').value.trim();
    const v = r.querySelector('[data-field="value"]').value.trim();
    if (k && v) out.push([k, v]);
  });
  return out;
}

function _readSettlementPlaceTypes() {
  const boxes = document.querySelectorAll('#settlement-place-chips input[type=checkbox]');
  return Array.from(boxes).filter(b => b.checked).map(b => b.value);
}

function _settlementImportMode() {
  return document.querySelector('#modal .import-tab.active')?.dataset.mode || 'search';
}

function _setSettlementPreviewHTML(html) {
  const el = document.getElementById('settlement-import-preview-result');
  if (el) el.innerHTML = html;
}

function _setSettlementActionBtn(label, busy) {
  const b = document.getElementById('settlement-import-action-btn');
  if (!b) return;
  b.textContent = label;
  b.disabled = !!busy;
}

async function runSettlementImportPreview() {
  const mode = _settlementImportMode();
  let query;
  try {
    if (mode === 'search') {
      const area = _readSettlementAreaRows();
      const types = _readSettlementPlaceTypes();
      if (area.length === 0) { toast(t('import.error_empty_filters'), 'error'); return; }
      if (types.length === 0) { toast(t('settlements.error_no_place_types'), 'error'); return; }
      query = buildSettlementSearchQuery(area, types);
    } else if (mode === 'byid') {
      const id = (document.getElementById('settlement-import-byid-input')?.value || '').trim();
      if (!id || !/^\d+$/.test(id)) { toast(t('import.error_byid_invalid'), 'error'); return; }
      query = buildSettlementByIdQuery(id);
    } else {
      const text = (document.getElementById('settlement-import-custom-input')?.value || '').trim();
      if (!text) { toast(t('import.error_custom_empty'), 'error'); return; }
      query = buildCustomQuery(text);
    }
  } catch (e) {
    toast(t('import.error_query_build', { msg: e.message }), 'error');
    return;
  }

  _setSettlementPreviewHTML(`<div class="text-dim" style="font-size:13px">${t('import.fetching')}</div>`);
  destroyPreviewMap();
  _settlementImportPreview = null;

  _setSettlementActionBtn(t('import.import_btn'), true);
  let json;
  try {
    json = await overpassFetch(query);
  } catch (e) {
    _setSettlementPreviewHTML('');
    _setSettlementActionBtn(t('import.import_btn'), false);
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
  _setSettlementActionBtn(t('import.import_btn'), false);

  let parsed;
  try { parsed = parseSettlementImport(json); }
  catch (e) {
    toast(t('import.error_parse', { msg: e.message }), 'error');
    _setSettlementPreviewHTML('');
    return;
  }

  // Dedup against existing settlements; mark dupes for display so the user
  // can see what was already in the project.
  const dupCount = parsed.candidates.filter(c => findSettlementByOgfNodeId(c.ogfNodeId)).length;
  const fresh    = parsed.candidates.filter(c => !findSettlementByOgfNodeId(c.ogfNodeId));

  if (parsed.candidates.length === 0) {
    let msg = t('settlements.import_no_results');
    if (parsed.skipped > 0) msg += ' ' + t('settlements.skipped_no_place', { n: parsed.skipped });
    _setSettlementPreviewHTML(`<div class="text-dim" style="font-size:13px">${msg}</div>`);
    toast(msg, 'warning');
    return;
  }

  if (fresh.length === 0) {
    _setSettlementPreviewHTML(`<div class="text-dim" style="font-size:13px">${t('settlements.all_dupes', { n: dupCount })}</div>`);
    toast(t('settlements.all_dupes', { n: dupCount }), 'warning');
    return;
  }

  // Auto-assign parents now so the preview shows what each candidate will
  // attach to. Stored on the candidate; the user will be able to override
  // per-row in Brick 7d.
  for (const c of fresh) c._parent = autoAssignSettlementParent(c.lat, c.lng, c.name);
  _settlementImportPreview = { fresh, dupCount, skipped: parsed.skipped };

  // Build preview HTML
  let header = `<div style="font-size:13px"><strong>${t('settlements.import_found', { n: fresh.length })}</strong>`;
  if (dupCount > 0)        header += ` <span class="text-dim">(${t('settlements.skipped_dupes', { n: dupCount })})</span>`;
  if (parsed.skipped > 0)  header += ` <span class="text-dim">(${t('settlements.skipped_no_place', { n: parsed.skipped })})</span>`;
  header += `</div>`;

  let listHtml = `<ul class="import-result-list">`;
  for (const c of fresh) {
    const parentInfo = c._parent
      ? _settlementParentDescriptor(c._parent)
      : `<span class="text-muted">${t('settlements.no_parent')}</span>`;
    const nameHtml = c.name ? esc(c.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`;
    listHtml += `
      <li>
        <span class="map-popup-type" style="background:${colorForPlaceType(c.place)};margin-right:6px">${esc(c.place)}</span>
        <strong>${nameHtml}</strong>
        <span class="text-dim" style="font-size:11px"> · #${esc(c.ogfNodeId)}</span>
        <div class="text-dim" style="font-size:12px;margin-top:2px">→ ${parentInfo}</div>
      </li>`;
  }
  listHtml += `</ul>`;

  // Inset preview map with circle markers
  const mapHtml = `<div id="settlement-preview-map" style="height:260px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--border);margin-top:10px"></div>`;
  _setSettlementPreviewHTML(header + mapHtml + listHtml);
  ensurePreviewMap('settlement-preview-map');
  drawPreviewSettlements(fresh);

  _setSettlementActionBtn(t('settlements.commit_btn', { n: fresh.length }), false);
  const btn = document.getElementById('settlement-import-action-btn');
  if (btn) btn.setAttribute('onclick', 'runSettlementImportCommit()');
}

function _settlementParentDescriptor(parent) {
  if (!parent) return '';
  if (parent.kind === 'plot') {
    const p = data.plots.find(x => x.id === parent.id);
    const nm = p?.name ? esc(p.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`;
    return `Plot: ${nm}`;
  }
  if (parent.kind === 'boundary') {
    const b = data.boundaries.find(x => x.id === parent.id);
    if (!b) return '';
    const tName = getBoundaryTypeName(b.typeId);
    const nm = b.name ? esc(b.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`;
    return `${esc(tName)}: ${nm}`;
  }
  return '';
}

// ============================================================
// SETTLEMENT DETAIL MODAL (Brick 7d)
// ============================================================
// Editable name, place type, parent (with picker + auto-assign),
// notes, plus the read-only OGF node id and lat/lng. Delete with
// confirmation.

let _settlementDetailId = null;
let _settlementParentSearch = '';

function openSettlementDetail(id) {
  const s = (data.settlements || []).find(x => x.id === id);
  if (!s) return;
  _settlementDetailId = id;
  _settlementParentSearch = '';

  const placeOpts = PLACE_TYPES.map(p =>
    `<option value="${esc(p)}"${p === s.place ? ' selected' : ''}>${esc(p)}</option>`
  ).join('');

  openModal(t('settlement_detail.title'), `
    <div class="form-group">
      <label>${t('settlement_detail.name_label')}</label>
      <input type="text" id="settlement-detail-name"
        value="${esc(s.name || '')}"
        placeholder="${t('settlement_detail.name_placeholder')}"
        onblur="onSettlementDetailSave()">
    </div>
    <div class="form-group">
      <label>${t('settlement_detail.place_label')}</label>
      <select id="settlement-detail-place" onchange="onSettlementDetailPlaceChange(this.value)">
        ${placeOpts}
      </select>
    </div>
    <div class="form-group">
      <label>${t('settlement_detail.parent_label')}</label>
      <div id="settlement-detail-parent-row">${_renderSettlementDetailParentRow(s)}</div>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="openSettlementParentPicker()">${t('settlement_detail.parent_change_btn')}</button>
        <button class="btn btn-sm" onclick="onSettlementDetailAutoAssign()">${t('settlement_detail.parent_auto_btn')}</button>
        <button class="btn btn-sm" onclick="onSettlementDetailClearParent()">${t('settlement_detail.parent_clear_btn')}</button>
      </div>
    </div>
    <div class="form-group">
      <label>${t('settlement_detail.notes_label')}</label>
      <textarea id="settlement-detail-notes" rows="3"
        placeholder="${t('settlement_detail.notes_placeholder')}"
        onblur="onSettlementDetailSave()">${esc(s.notes || '')}</textarea>
    </div>
    <div class="plot-detail-meta">
      <div>
        <div class="plot-detail-meta-label">${t('settlement_detail.coords_label')}</div>
        <div class="plot-detail-meta-value mono">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</div>
      </div>
      <div>
        <div class="plot-detail-meta-label">${t('settlement_detail.ogf_id_label')}</div>
        <div class="plot-detail-meta-value mono">${s.ogfNodeId != null ? esc(s.ogfNodeId) : '—'}</div>
      </div>
      <div>
        <div class="plot-detail-meta-label">${t('settlement_detail.id_label')}</div>
        <div class="plot-detail-meta-value mono">${esc(s.id)}</div>
      </div>
    </div>
  `, `
    <button class="btn btn-danger" style="margin-right:auto" onclick="onSettlementDetailDelete()">${t('settlement_detail.delete_btn')}</button>
    <button class="btn" onclick="closeSettlementDetail()">${t('btn.close')}</button>
  `);

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '560px';
}

function _renderSettlementDetailParentRow(s) {
  const info = getSettlementParentInfo(s);
  if (!info) {
    return `<span class="text-muted">${t('settlements.no_parent')}</span>`;
  }
  let chipColor = '#475569';
  if (s.parent.kind === 'boundary') {
    const b = data.boundaries.find(x => x.id === s.parent.id);
    chipColor = (typeof colorForBoundaryType === 'function') ? colorForBoundaryType(b?.typeId) : '#475569';
  }
  const nameHtml = info.name ? esc(info.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`;
  return `
    <span class="map-popup-type" style="background:${chipColor};margin-right:6px">${esc(info.typeLabel)}</span>
    ${nameHtml}`;
}

function onSettlementDetailSave() {
  if (!_settlementDetailId) return;
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;
  const nameEl  = document.getElementById('settlement-detail-name');
  const notesEl = document.getElementById('settlement-detail-notes');
  const newName  = nameEl  ? nameEl.value  : s.name;
  const newNotes = notesEl ? notesEl.value : s.notes;
  if (s.name === newName && s.notes === newNotes) return;
  s.name  = newName;
  s.notes = newNotes;
  save();
  renderSettlementsBody();
  redrawMap();
}

function onSettlementDetailPlaceChange(value) {
  if (!_settlementDetailId) return;
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;
  s.place = value;
  save();
  renderSettlementsBody();
  redrawMap();
}

function onSettlementDetailClearParent() {
  if (!_settlementDetailId) return;
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;
  s.parent = null;
  save();
  _refreshSettlementDetailParentRow();
  renderSettlementsBody();
  redrawMap();
}

function onSettlementDetailAutoAssign() {
  if (!_settlementDetailId) return;
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;
  const newParent = (typeof autoAssignSettlementParent === 'function')
    ? autoAssignSettlementParent(s.lat, s.lng, s.name)
    : null;
  if (!newParent) {
    toast(t('settlement_detail.auto_no_match'), 'warning');
    return;
  }
  s.parent = newParent;
  save();
  _refreshSettlementDetailParentRow();
  renderSettlementsBody();
  redrawMap();
}

function _refreshSettlementDetailParentRow() {
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  const el = document.getElementById('settlement-detail-parent-row');
  if (!s || !el) return;
  el.innerHTML = _renderSettlementDetailParentRow(s);
}

function onSettlementDetailDelete() {
  if (!_settlementDetailId) return;
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;
  const displayName = s.name || t('plots.unnamed');
  appConfirm(t('settlement_detail.confirm_delete', { name: displayName }), () => {
    deleteSettlement(_settlementDetailId);
    save();
    closeSettlementDetail();
    refreshAll();
    redrawMap();
    toast(t('settlement_detail.deleted_toast', { name: displayName }), 'success');
  });
}

function closeSettlementDetail() {
  // Capture pending edits before tearing down — close-without-blur path.
  onSettlementDetailSave();
  _settlementDetailId = null;
  closeModal();
}

// ── Parent picker (sub-modal) ──
// Replaces the detail modal contents while picking; on commit re-opens
// the detail modal with the new parent applied.

function openSettlementParentPicker() {
  // Capture in-progress edits in the detail modal before swapping content.
  onSettlementDetailSave();
  _settlementParentSearch = '';
  _renderSettlementParentPicker();
}

function _renderSettlementParentPicker() {
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;

  const q = _settlementParentSearch.trim().toLowerCase();

  const plots = (data.plots || [])
    .map(p => ({ kind: 'plot', id: p.id, name: p.name || '', typeLabel: 'Plot' }))
    .filter(e => !q || (e.name + ' ' + e.typeLabel).toLowerCase().includes(q));

  const boundaries = (data.boundaries || [])
    .map(b => ({
      kind: 'boundary',
      id:   b.id,
      name: b.name || '',
      typeLabel: getBoundaryTypeName(b.typeId) || 'Boundary',
      typeId:    b.typeId,
    }))
    .filter(e => !q || (e.name + ' ' + e.typeLabel).toLowerCase().includes(q));

  const currentKey = s.parent ? `${s.parent.kind}:${s.parent.id}` : '';

  const renderRow = (e) => {
    const isCur = (`${e.kind}:${e.id}` === currentKey);
    const color = e.kind === 'plot'
      ? '#475569'
      : ((typeof colorForBoundaryType === 'function') ? colorForBoundaryType(e.typeId) : '#475569');
    const nm = e.name ? esc(e.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`;
    return `
      <div class="boundary-picker-row${isCur ? ' current' : ''}"
        onclick="onSettlementParentPicked('${e.kind}','${esc(e.id)}')">
        <span class="map-popup-type" style="background:${color}">${esc(e.typeLabel)}</span>
        <span style="margin-left:8px">${nm}</span>
        ${isCur ? `<span class="text-dim" style="margin-left:auto;font-size:11px">${t('settlement_detail.parent_current')}</span>` : ''}
      </div>`;
  };

  const boundaryHtml = boundaries.length > 0
    ? `<div class="boundary-picker-section-label">${t('settlement_detail.parent_section_boundaries', { n: boundaries.length })}</div>${boundaries.map(renderRow).join('')}`
    : '';
  const plotHtml = plots.length > 0
    ? `<div class="boundary-picker-section-label">${t('settlement_detail.parent_section_plots', { n: plots.length })}</div>${plots.map(renderRow).join('')}`
    : '';
  const noResults = (boundaries.length + plots.length === 0)
    ? `<div class="text-dim" style="font-size:13px;padding:12px">${t('settlement_detail.parent_no_match')}</div>`
    : '';

  openModal(t('settlement_detail.parent_picker_title'), `
    <div class="form-group">
      <input type="text" id="settlement-parent-search"
        placeholder="${t('settlement_detail.parent_search_placeholder')}"
        oninput="onSettlementParentSearch(this.value)"
        value="${esc(_settlementParentSearch)}"
        autocomplete="off">
    </div>
    <div id="boundary-picker-list">${boundaryHtml}${plotHtml}${noResults}</div>
  `, `
    <button class="btn" onclick="openSettlementDetail(_settlementDetailId)">${t('btn.cancel')}</button>
  `);

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '560px';
}

function onSettlementParentSearch(value) {
  _settlementParentSearch = value;
  // Re-render only the list, keep the search input focused.
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;
  const q = value.trim().toLowerCase();

  const plots = (data.plots || [])
    .map(p => ({ kind: 'plot', id: p.id, name: p.name || '', typeLabel: 'Plot' }))
    .filter(e => !q || (e.name + ' ' + e.typeLabel).toLowerCase().includes(q));
  const boundaries = (data.boundaries || [])
    .map(b => ({
      kind: 'boundary', id: b.id, name: b.name || '',
      typeLabel: getBoundaryTypeName(b.typeId) || 'Boundary', typeId: b.typeId,
    }))
    .filter(e => !q || (e.name + ' ' + e.typeLabel).toLowerCase().includes(q));

  const currentKey = s.parent ? `${s.parent.kind}:${s.parent.id}` : '';
  const renderRow = (e) => {
    const isCur = (`${e.kind}:${e.id}` === currentKey);
    const color = e.kind === 'plot'
      ? '#475569'
      : ((typeof colorForBoundaryType === 'function') ? colorForBoundaryType(e.typeId) : '#475569');
    const nm = e.name ? esc(e.name) : `<em class="text-muted">${t('plots.unnamed')}</em>`;
    return `
      <div class="boundary-picker-row${isCur ? ' current' : ''}"
        onclick="onSettlementParentPicked('${e.kind}','${esc(e.id)}')">
        <span class="map-popup-type" style="background:${color}">${esc(e.typeLabel)}</span>
        <span style="margin-left:8px">${nm}</span>
        ${isCur ? `<span class="text-dim" style="margin-left:auto;font-size:11px">${t('settlement_detail.parent_current')}</span>` : ''}
      </div>`;
  };

  const list = document.getElementById('boundary-picker-list');
  if (!list) return;
  const boundaryHtml = boundaries.length > 0
    ? `<div class="boundary-picker-section-label">${t('settlement_detail.parent_section_boundaries', { n: boundaries.length })}</div>${boundaries.map(renderRow).join('')}`
    : '';
  const plotHtml = plots.length > 0
    ? `<div class="boundary-picker-section-label">${t('settlement_detail.parent_section_plots', { n: plots.length })}</div>${plots.map(renderRow).join('')}`
    : '';
  const noResults = (boundaries.length + plots.length === 0)
    ? `<div class="text-dim" style="font-size:13px;padding:12px">${t('settlement_detail.parent_no_match')}</div>`
    : '';
  list.innerHTML = boundaryHtml + plotHtml + noResults;
}

function onSettlementParentPicked(kind, id) {
  const s = (data.settlements || []).find(x => x.id === _settlementDetailId);
  if (!s) return;
  s.parent = { kind, id };
  save();
  renderSettlementsBody();
  redrawMap();
  // Re-open the detail modal so the user sees the new parent reflected.
  openSettlementDetail(_settlementDetailId);
}

function runSettlementImportCommit() {
  const preview = _settlementImportPreview;
  if (!preview || preview.fresh.length === 0) return;
  for (const c of preview.fresh) {
    createSettlement({
      name:      c.name,
      lat:       c.lat,
      lng:       c.lng,
      ogfNodeId: c.ogfNodeId,
      place:     c.place,
      parent:    c._parent || null,
    });
  }
  save();
  closeSettlementImportModal();
  toast(t('settlements.commit_toast', { n: preview.fresh.length }), 'success');
  refreshAll();
}

// ============================================================
// CREATE BOUNDARY MODAL
// ============================================================

function openCreateBoundaryModal() {
  const types = data.boundaryTypes.slice().sort((a, b) => a.name.localeCompare(b.name));
  const typeOpts = types.map(ty =>
    `<option value="${esc(ty.id)}">${esc(ty.name)}</option>`
  ).join('');

  openModal(t('boundaries.modal_add_title'), `
    <div class="form-group">
      <label>${t('boundaries.name_label')}</label>
      <input type="text" id="boundary-create-name"
        placeholder="${t('boundaries.name_placeholder')}" autocomplete="off">
    </div>
    <div class="form-group">
      <label>${t('boundaries.type_label')}</label>
      <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('boundaries.type_help')}</p>
      <select id="boundary-create-type"><option value="">—</option>${typeOpts}</select>
    </div>
  `, `
    <button class="btn" onclick="closeModal()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" onclick="saveCreateBoundary()">${t('btn.save')}</button>
  `);
  setTimeout(() => document.getElementById('boundary-create-name')?.focus(), 50);
}

function saveCreateBoundary() {
  const name   = document.getElementById('boundary-create-name')?.value.trim() || '';
  const typeId = document.getElementById('boundary-create-type')?.value || '';
  if (!name)   { toast(t('boundaries.error_name_empty'), 'error');   return; }
  if (!typeId) { toast(t('boundaries.error_type_required'), 'error'); return; }

  const b = createBoundary({ name, typeId });
  save();
  closeModal();
  toast(t('boundaries.created_toast', { name }), 'success');
  refreshAll();
  openBoundaryDetail(b.id);
}

// ============================================================
// BOUNDARY DETAIL MODAL
// ============================================================

let _boundaryDetailId = null;

function openBoundaryDetail(boundaryId) {
  const b = data.boundaries.find(x => x.id === boundaryId);
  if (!b) return;
  _boundaryDetailId = boundaryId;
  const typeName = getBoundaryTypeName(b.typeId);

  const memberRows = (b.members || []).map(m => {
    const ref = resolveMember(m);
    const name = ref?.name || (m.kind === 'plot' ? t('plots.unnamed') : t('boundaries.unnamed'));
    const subType = (m.kind === 'boundary' && ref) ? getBoundaryTypeName(ref.typeId) : t('boundary_detail.kind_plot');
    const orphan = !ref ? ` <span class="text-muted">(missing)</span>` : '';
    return `<div class="boundary-member-row">
      <div class="boundary-member-info">
        <span class="boundary-member-name">${esc(name)}${orphan}</span>
        <span class="boundary-member-type text-dim">${esc(subType)}</span>
      </div>
      <button class="btn btn-sm btn-danger" onclick="removeBoundaryMember('${esc(m.kind)}','${esc(m.id)}')">${t('boundary_detail.remove_member_btn')}</button>
    </div>`;
  }).join('');

  const memberSection = b.members && b.members.length > 0
    ? `<div class="boundary-member-list">${memberRows}</div>`
    : `<div class="text-dim" style="font-size:13px;padding:8px 0">${t('boundary_detail.members_empty')}</div>`;

  const flagsBlock = b.flags && b.flags.length > 0 ? `
    <div class="plot-flags-block">
      ${b.flags.map(f => `<div class="plot-flag-row"><span class="plot-flag-icon">⚠</span>${t('plot_detail.flag_' + f) || f}</div>`).join('')}
    </div>` : '';

  openModal(t('boundary_detail.title'), `
    <div class="form-group">
      <label>${t('boundary_detail.name_label')}</label>
      <input type="text" id="boundary-detail-name"
        value="${esc(b.name || '')}"
        placeholder="${t('boundary_detail.name_placeholder')}"
        onblur="onBoundaryDetailSave()">
    </div>
    <div class="form-group">
      <label>${t('boundary_detail.notes_label')}</label>
      <textarea id="boundary-detail-notes" rows="3"
        placeholder="${t('boundary_detail.notes_placeholder')}"
        onblur="onBoundaryDetailSave()">${esc(b.notes || '')}</textarea>
    </div>
    <div class="plot-detail-properties-section">
      <div class="plot-detail-section-label">${t('plot_detail.properties_label')}</div>
      <div id="boundary-detail-properties">${_renderBoundaryPropertyRows(b)}</div>
    </div>
    <div class="plot-detail-meta">
      <div>
        <div class="plot-detail-meta-label">${t('boundary_detail.type')}</div>
        <div class="plot-detail-meta-value">${esc(typeName) || '—'}</div>
      </div>
      <div>
        <div class="plot-detail-meta-label">${t('boundary_detail.boundary_id')}</div>
        <div class="plot-detail-meta-value mono">${esc(b.id)}</div>
      </div>
      <div>
        <div class="plot-detail-meta-label">${t('boundary_detail.area')}</div>
        <div class="plot-detail-meta-value mono">${formatArea(boundaryArea(b))}</div>
      </div>
    </div>
    ${flagsBlock}
    <div class="boundary-members-section">
      <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <strong>${t('boundary_detail.members_title')}</strong>
          <span class="text-dim" style="font-size:12px;margin-left:6px">${t('boundary_detail.members_count', { n: b.members?.length || 0 })}</span>
        </div>
        <button class="btn btn-sm btn-primary" onclick="openMembersPicker()">${t('boundary_detail.add_members_btn')}</button>
      </div>
      ${memberSection}
    </div>
  `, `
    <button class="btn btn-danger" style="margin-right:auto" onclick="onBoundaryDetailDelete()">${t('boundary_detail.delete_btn')}</button>
    <button class="btn" onclick="closeBoundaryDetail()">${t('btn.close')}</button>
  `);

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '640px';
}

function onBoundaryDetailSave() {
  if (!_boundaryDetailId) return;
  const b = data.boundaries.find(x => x.id === _boundaryDetailId);
  if (!b) return;
  const nameEl  = document.getElementById('boundary-detail-name');
  const notesEl = document.getElementById('boundary-detail-notes');
  const newName  = nameEl  ? nameEl.value  : b.name;
  const newNotes = notesEl ? notesEl.value : b.notes;
  if (b.name === newName && b.notes === newNotes) return;
  b.name  = newName;
  b.notes = newNotes;
  save();
  _renderBoundariesBody();
}

function removeBoundaryMember(kind, memberId) {
  if (!_boundaryDetailId) return;
  const b = data.boundaries.find(x => x.id === _boundaryDetailId);
  if (!b) return;
  b.members = (b.members || []).filter(m => !(m.kind === kind && m.id === memberId));
  invalidateBoundaryGeometry();
  save();
  openBoundaryDetail(_boundaryDetailId); // re-render in place
  _renderBoundariesBody();
}

function onBoundaryDetailDelete() {
  if (!_boundaryDetailId) return;
  const b = data.boundaries.find(x => x.id === _boundaryDetailId);
  if (!b) return;
  const displayName = b.name || t('boundaries.unnamed');
  appConfirm(t('boundaries.confirm_delete', { name: displayName }), () => {
    data.boundaries = data.boundaries.filter(x => x.id !== _boundaryDetailId);
    invalidateBoundaryGeometry();
    save();
    closeBoundaryDetail();
    refreshAll();
    toast(t('boundaries.deleted_toast', { name: displayName }), 'success');
  });
}

function closeBoundaryDetail() {
  onBoundaryDetailSave();
  _boundaryDetailId = null;
  closeModal();
}

// ============================================================
// MEMBERS PICKER MODAL
// ============================================================
// Replaces the detail modal in the single modal slot. On commit/cancel
// we re-open the detail modal. Selected items live in a Set keyed by
// "kind:id"; items already in the boundary or claimed elsewhere render
// as disabled rows.

let _pickerSelected = new Set();
let _pickerSearch   = '';

function openMembersPicker() {
  if (!_boundaryDetailId) return;
  // Capture pending name/notes edits before swapping modal contents.
  onBoundaryDetailSave();
  _pickerSelected = new Set();
  _pickerSearch   = '';
  const b = data.boundaries.find(x => x.id === _boundaryDetailId);
  if (!b) return;
  const typeName = getBoundaryTypeName(b.typeId);

  openModal(t('boundary_picker.title'), `
    <p class="text-dim" style="font-size:12px;margin-bottom:8px">${t('boundary_picker.intro')}</p>
    <div style="margin-bottom:10px">
      <input type="text" id="boundary-picker-search"
        placeholder="${t('boundary_picker.search_placeholder')}"
        oninput="onPickerSearch(this.value)"
        value=""
        autocomplete="off">
    </div>
    <div id="boundary-picker-list" data-type-name="${esc(typeName)}"></div>
  `, `
    <span id="boundary-picker-counter" class="text-dim" style="margin-right:auto;font-size:12px">${t('boundary_picker.selected_count', { n: 0 })}</span>
    <button class="btn" onclick="cancelMembersPicker()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" id="boundary-picker-add-btn" onclick="commitMembersPicker()" disabled>${t('boundary_picker.add_btn', { n: 0 })}</button>
  `);

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '560px';

  _renderPickerList();
  setTimeout(() => document.getElementById('boundary-picker-search')?.focus(), 50);
}

function _renderPickerList() {
  const listEl = document.getElementById('boundary-picker-list');
  if (!listEl || !_boundaryDetailId) return;
  const b = data.boundaries.find(x => x.id === _boundaryDetailId);
  if (!b) return;

  const eligible = getEligibleMembers(b.typeId, b.id);
  const q = _pickerSearch.trim().toLowerCase();
  const filtered = q
    ? eligible.filter(e => (e.name || '').toLowerCase().includes(q))
    : eligible;

  if (filtered.length === 0) {
    const typeName = getBoundaryTypeName(b.typeId);
    listEl.innerHTML = `<div class="text-dim" style="font-size:13px;padding:12px 0">
      ${t('boundary_picker.no_eligible', { type: esc(typeName) })}
    </div>`;
    return;
  }

  // Group: plots first, then boundaries grouped by typeName.
  const plots = filtered.filter(e => e.kind === 'plot');
  const bys = new Map();
  for (const e of filtered) {
    if (e.kind !== 'boundary') continue;
    const key = e.typeName || '—';
    if (!bys.has(key)) bys.set(key, []);
    bys.get(key).push(e);
  }

  let html = '';
  if (plots.length > 0) {
    html += `<div class="boundary-picker-section-label">${t('boundary_picker.section_plots')}</div>`;
    html += plots.map(_pickerRow).join('');
  }
  for (const [typeName, items] of bys) {
    html += `<div class="boundary-picker-section-label">${t('boundary_picker.section_boundary_type', { type: esc(typeName) })}</div>`;
    html += items.map(_pickerRow).join('');
  }
  listEl.innerHTML = html;
}

function _pickerRow(e) {
  const key = e.kind + ':' + e.id;
  // Three states for a claimed item:
  //   currentMember: in this boundary already (checked, locked)
  //   promotable:    in another boundary, but a wedge is geometrically valid (checkable)
  //   blocked:       in another boundary, no valid wedge (disabled)
  const blocked    = e.claimedElsewhere && !e.currentMember && !e.promotable;
  const promotable = e.claimedElsewhere && !e.currentMember && e.promotable;
  const checked    = e.currentMember || _pickerSelected.has(key);
  const nameDisplay = e.name
    ? esc(e.name)
    : `<span class="text-muted">${e.kind === 'plot' ? t('plots.unnamed') : t('boundaries.unnamed')}</span>`;

  let tag = '';
  if (blocked)    tag = ` <span class="boundary-picker-claimed">${t('boundary_picker.claimed_label')}</span>`;
  if (promotable) tag = ` <span class="boundary-picker-promote">${t('boundary_picker.promote_from', { name: esc(e.claimingBoundaryName || e.claimingBoundaryType || '') })}</span>`;

  const cls = [
    'boundary-picker-row',
    blocked    ? 'disabled'   : '',
    promotable ? 'promotable' : '',
    e.currentMember ? 'current' : '',
  ].filter(Boolean).join(' ');

  return `<label class="${cls}">
    <input type="checkbox"
      data-key="${esc(key)}"
      ${checked ? 'checked' : ''}
      ${blocked || e.currentMember ? 'disabled' : ''}
      onchange="onPickerToggle('${esc(key)}', this.checked)">
    <span>${nameDisplay}${tag}</span>
  </label>`;
}

function onPickerSearch(val) {
  _pickerSearch = val;
  _renderPickerList();
}

function onPickerToggle(key, checked) {
  if (checked) _pickerSelected.add(key);
  else         _pickerSelected.delete(key);
  const count = _pickerSelected.size;
  const counter = document.getElementById('boundary-picker-counter');
  const addBtn  = document.getElementById('boundary-picker-add-btn');
  if (counter) counter.textContent = t('boundary_picker.selected_count', { n: count });
  if (addBtn) {
    addBtn.textContent = t('boundary_picker.add_btn', { n: count });
    addBtn.disabled = count === 0;
  }
}

function commitMembersPicker() {
  if (!_boundaryDetailId) return;
  const b = data.boundaries.find(x => x.id === _boundaryDetailId);
  if (!b) { closeModal(); return; }
  let added = 0, promoted = 0;
  b.members = b.members || [];
  for (const key of _pickerSelected) {
    const [kind, id] = key.split(':');
    if (b.members.some(m => m.kind === kind && m.id === id)) continue;
    // If this item is already claimed by another boundary, attempt promotion
    // (wedge `b` between the claimer and the item).
    const claimer = findClaimingBoundary(kind, id, b.id);
    if (claimer) {
      const ok = promoteMember(kind, id, b);
      if (!ok) continue; // shouldn't happen — UI only checked promotable rows
      promoted++;
    }
    b.members.push({ kind, id });
    added++;
  }
  if (added > 0) {
    invalidateBoundaryGeometry();
    save();
    if (promoted > 0) {
      toast(t('boundary_picker.added_with_promote_toast', { added, promoted }), 'success');
    } else {
      toast(t('boundary_picker.added_toast', { n: added }), 'success');
    }
  }
  _pickerSelected.clear();
  openBoundaryDetail(_boundaryDetailId);
  _renderBoundariesBody();
}

function cancelMembersPicker() {
  _pickerSelected.clear();
  if (_boundaryDetailId) openBoundaryDetail(_boundaryDetailId);
  else                   closeModal();
}

function renderSettings() {
  const el = document.getElementById('settings-content');
  if (!el) return;
  const langOpts = _availableLanguages.map(l =>
    `<option value="${l.code}"${l.code === _lang ? ' selected' : ''}>${esc(l.name)}</option>`
  ).join('');
  const snapVal = getSetting('snapToleranceM', 10);
  const lwMode    = getSetting('landWaterMode', 'land_only_sea_water');
  const lwMinArea = Number(getSetting('minWaterBodyAreaM2', 10000)) || 0;
  const lwOverlay = !!getSetting('showWaterOverlay', true);
  const lwSummary = (typeof getWaterCacheSummary === 'function') ? getWaterCacheSummary() : null;
  const lwBusy    = (typeof isLandWaterFetchInFlight === 'function') && isLandWaterFetchInFlight();
  const lwClips   = lwMode !== 'combined';

  const defaultArea = getSetting('defaultSearchArea', []);
  const areaRows = defaultArea.map((r, i) => `
    <div class="import-tag-row" data-dsa-idx="${i}">
      <input type="text" placeholder="${t('import.key_placeholder')}" value="${esc(r.key || '')}" data-field="key" onchange="onDefaultSearchAreaChange()">
      <input type="text" placeholder="${t('import.value_placeholder')}" value="${esc(r.value || '')}" data-field="value" onchange="onDefaultSearchAreaChange()">
      <button class="btn btn-sm" onclick="removeDefaultSearchAreaRow(${i})">✕</button>
    </div>`).join('');

  el.innerHTML = `
    <div class="ie-card">
      <h3>${t('settings.language')}</h3>
      <p>${t('settings.language_desc')}</p>
      <select onchange="setLanguage(this.value)" style="max-width:240px">${langOpts}</select>
    </div>
    <div class="ie-card">
      <h3>${t('settings.snap_tolerance')}</h3>
      <p>${t('settings.snap_tolerance_desc')}</p>
      <div class="flex" style="align-items:center;gap:8px;margin-top:8px">
        <input type="number" min="0" max="1000" step="1"
          value="${esc(snapVal)}"
          onchange="onSnapToleranceChange(this.value)"
          style="max-width:100px">
        <span class="text-dim">${t('settings.snap_tolerance_unit')}</span>
      </div>
    </div>
    <div class="ie-card">
      <h3>${t('settings.default_search_area')}</h3>
      <p>${t('settings.default_search_area_desc')}</p>
      <div id="settings-dsa-rows" class="import-rows" style="margin-bottom:8px">${areaRows}</div>
      <button class="btn btn-sm" onclick="addDefaultSearchAreaRow()">+ ${t('import.add_row')}</button>
    </div>
    <div class="ie-card">
      <h3>${t('settings.landwater_title')}</h3>
      <p>${t('settings.landwater_desc')}</p>
      <div style="margin-top:10px">
        <div class="text-dim" style="font-size:12px;margin-bottom:2px">${t('settings.landwater_mode_label')}</div>
        <div class="mono">${esc(t('save_mgr.new_mode_' + lwMode))}</div>
      </div>
      <div class="flex" style="align-items:center;gap:8px;margin-top:14px">
        <span>${t('settings.landwater_min_area')}:</span>
        <input type="number" min="0" step="1000"
          value="${esc(lwMinArea)}"
          onchange="onMinWaterBodyAreaChange(this.value)"
          style="max-width:140px">
        <span class="text-dim">${t('settings.landwater_min_area_unit')}</span>
      </div>
      <div class="flex" style="align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="onFetchWaterClick()"${lwBusy ? ' disabled' : ''}>${lwBusy ? t('settings.landwater_fetching_btn') : t('settings.landwater_fetch_btn')}</button>
        ${lwClips ? `<button class="btn btn-sm" onclick="onReclipPlotsClick()" ${lwSummary ? '' : 'disabled'} title="${esc(t('settings.landwater_reclip_help'))}">${t('settings.landwater_reclip_btn')}</button>` : ''}
        ${lwSummary ? `<span class="text-dim" style="font-size:12px">${t('settings.landwater_cache_summary', {
          when: new Date(lwSummary.fetchedAt).toLocaleString(),
          n: lwSummary.bodyCount
        })}</span>` : `<span class="text-dim" style="font-size:12px">${t('settings.landwater_no_cache')}</span>`}
      </div>
      <label class="flex" style="align-items:center;gap:8px;margin-top:10px">
        <input type="checkbox" ${lwOverlay ? 'checked' : ''} onchange="onShowWaterOverlayChange(this.checked)">
        <span>${t('settings.landwater_overlay_label')}</span>
      </label>
    </div>
    <div class="ie-card" style="border-color:var(--danger,#7a1a1a)">
      <h3 style="color:var(--accent)">${t('settings.flush_title')}</h3>
      <p>${t('settings.flush_desc')}</p>
      <button class="btn btn-danger" onclick="flushSaveFile()">${t('settings.flush_btn')}</button>
    </div>
  `;
}

function onSnapToleranceChange(val) {
  const n = Math.max(0, Math.round(Number(val) || 0));
  data.settings = data.settings || {};
  data.settings.snapToleranceM = n;
  save();
}

// Land/water settings handlers (v0.9.0)
function onMinWaterBodyAreaChange(val) {
  setMinWaterBodyAreaM2(val);
}

function onFetchWaterClick() {
  fetchAndCacheWater();
}

function onShowWaterOverlayChange(checked) {
  setShowWaterOverlay(!!checked);
}

function onReclipPlotsClick() {
  if (typeof reclipAllPlotsToMode !== 'function') return;
  if (!data.waterCache || !data.waterCache.waterGeometry) {
    toast(t('landwater.toast_reclip_no_cache'), 'warning');
    return;
  }
  const mode = getSetting('landWaterMode', 'land_only_sea_water');
  const res = reclipAllPlotsToMode(mode);
  save();
  toast(t('landwater.toast_reclipped', { kept: res.kept, dropped: res.dropped }), 'success');
  if (typeof redrawMap === 'function') redrawMap();
  renderSettings();
}

function _readDefaultSearchAreaRows() {
  const rows = document.getElementById('settings-dsa-rows')?.querySelectorAll('.import-tag-row') || [];
  const out = [];
  rows.forEach(r => {
    const key   = r.querySelector('[data-field="key"]')?.value.trim() || '';
    const value = r.querySelector('[data-field="value"]')?.value.trim() || '';
    if (key || value) out.push({ key, value });
  });
  return out;
}

function onDefaultSearchAreaChange() {
  data.settings = data.settings || {};
  data.settings.defaultSearchArea = _readDefaultSearchAreaRows();
  save();
}

function addDefaultSearchAreaRow() {
  const container = document.getElementById('settings-dsa-rows');
  if (!container) return;
  const idx = container.querySelectorAll('.import-tag-row').length;
  const row = document.createElement('div');
  row.className = 'import-tag-row';
  row.dataset.dsaIdx = idx;
  row.innerHTML = `
    <input type="text" placeholder="${t('import.key_placeholder')}" data-field="key" onchange="onDefaultSearchAreaChange()">
    <input type="text" placeholder="${t('import.value_placeholder')}" data-field="value" onchange="onDefaultSearchAreaChange()">
    <button class="btn btn-sm" onclick="this.parentElement.remove(); onDefaultSearchAreaChange()">✕</button>
  `;
  container.appendChild(row);
}

function removeDefaultSearchAreaRow(idx) {
  const container = document.getElementById('settings-dsa-rows');
  if (!container) return;
  const rows = container.querySelectorAll('.import-tag-row');
  if (rows[idx]) rows[idx].remove();
  onDefaultSearchAreaChange();
}

function flushSaveFile() {
  appConfirm(t('settings.flush_confirm'), () => {
    data.plots = [];
    data.boundaries = [];
    data.osm = { nodes: {}, ways: {}, _nextLocalId: 0 };
    invalidateBoundaryGeometry();
    save();
    refreshAll();
    toast(t('settings.flush_toast'), 'success');
  });
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

  // Unified "Create as" dropdown: Plot first, then all boundary types.
  const btypeOpts = data.boundaryTypes.slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(ty => `<option value="${esc(ty.id)}">${esc(ty.name)}</option>`)
    .join('');
  const noTypes = data.boundaryTypes.length === 0;

  openModal(t('import.title'), `
    <div class="import-target-row">
      <label class="import-target-label">${t('import.create_as')}</label>
      <select id="import-target-select" onchange="onImportTargetChange()">
        <option value="plot">${t('import.target_plot')}</option>
        ${btypeOpts}
      </select>
      ${noTypes ? `<span class="text-dim" style="font-size:11px;margin-left:4px">${t('import.target_boundary_no_types')}</span>` : ''}
    </div>
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

  // Seed area rows from default search area setting (or one empty row).
  const defaultArea = getSetting('defaultSearchArea', []);
  if (defaultArea.length > 0) {
    for (const row of defaultArea) addImportRow('area', row);
  } else {
    addImportRow('area');
  }
  addImportRow('import');

  // Make the modal a bit taller so the inset preview map gets room.
  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '720px';
}

function onImportTargetChange() {
  // A target switch can flip whether anything is committable (e.g. wrap-only
  // re-imports become committable as boundaries). Refresh the commit area.
  _refreshImportCommitContainer();
}

function getImportTarget() {
  const val = document.getElementById('import-target-select')?.value || 'plot';
  if (val !== 'plot') return { kind: 'boundary', typeId: val };
  return { kind: 'plot' };
}

// Decide whether the current plan + selected target can produce any commit-time action.
// Returns { canCommit, label } where canCommit=false ⇒ show "nothing new" message instead.
function _evaluateImportCommit(plan, target) {
  const candidatesTouched = plan.free.length + plan.wraps.length
    + new Set(plan.splits.flatMap(s => s.pieces.map(p => p.candidate))).size;
  if (plan.newPlotCount > 0) {
    return { canCommit: true, label: t('import.commit_btn', { n: plan.newPlotCount }) };
  }
  // newPlotCount === 0 — only meaningful if we're wrapping into boundaries.
  if (target.kind === 'boundary' && candidatesTouched > 0) {
    return { canCommit: true, label: t('import.commit_boundary_only', { n: candidatesTouched }) };
  }
  return { canCommit: false, label: '' };
}

function _refreshImportCommitContainer() {
  const el = document.getElementById('import-commit-container');
  if (!el) return;
  if (!_importPreview || !_importPreview._plan) { el.innerHTML = ''; return; }
  const target = getImportTarget();
  const { canCommit, label } = _evaluateImportCommit(_importPreview._plan, target);
  if (canCommit) {
    el.innerHTML = `<div class="flex" style="justify-content:flex-end">
      <button class="btn btn-primary" onclick="runImportCommit()">${esc(label)}</button>
    </div>`;
  } else {
    el.innerHTML = `<div class="text-dim" style="font-size:12px;text-align:center;padding:8px 0">${t('import.nothing_new')}</div>`;
  }
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

  // Classify candidates as free (no overlap) vs. subdividers (overlap existing plots).
  // parseImport already sets candidate.geometry via resolvePlotGeometry.
  const plan = computeSubdivisionPlan(parsed.candidates, parsed.nodes, parsed.ways);
  parsed._plan = plan;
  _importPreview = parsed;

  // ── Build result list HTML ──
  let header = `<div style="font-size:13px"><strong>${t('import.found', { n: parsed.candidates.length })}</strong>`;
  if (parsed.skipped > 0) header += ` <span class="text-dim">(${t('import.skipped', { n: parsed.skipped })})</span>`;
  header += `</div>`;

  let listHtml = '';

  if (plan.splits.length > 0) {
    listHtml += `<div class="subdivide-section-label">${t('import.subdivide_section', { n: plan.splits.length })}</div>`;
    listHtml += `<ul class="import-result-list">`;
    for (const { parentPlot, pieces, remainder } of plan.splits) {
      const parentName = parentPlot.name
        ? esc(parentPlot.name)
        : `<span class="text-muted">${t('plots.unnamed')}</span>`;
      listHtml += `<li><span class="import-result-mark warn">⚡</span> ${parentName} ${t('import.subdivide_splits_into')}`;
      listHtml += `<ul class="subdivide-children">`;
      for (const piece of pieces) {
        const pName = piece.name ? esc(piece.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`;
        listHtml += `<li><span class="import-result-mark ok">✓</span> ${pName}${piece.ogfRelationId ? ` <span class="text-muted mono">#${piece.ogfRelationId}</span>` : ''}</li>`;
      }
      if (remainder) {
        listHtml += `<li><span class="import-result-mark muted">⌁</span> <em>${esc(remainder.name)}</em></li>`;
      }
      listHtml += `</ul></li>`;
    }
    listHtml += `</ul>`;
  }

  if (plan.wraps && plan.wraps.length > 0) {
    listHtml += `<div class="subdivide-section-label">${t('import.wrap_section', { n: plan.wraps.length })}</div>`;
    listHtml += `<ul class="import-result-list">`;
    for (const w of plan.wraps) {
      const wrapName = w.candidate.name
        ? esc(w.candidate.name)
        : `<span class="text-muted">${t('plots.unnamed')}</span>`;
      listHtml += `<li><span class="import-result-mark ok">⊕</span> ${wrapName}${w.candidate.ogfRelationId ? ` <span class="text-muted mono">#${w.candidate.ogfRelationId}</span>` : ''} ${t('import.wraps_existing')}`;
      listHtml += `<ul class="subdivide-children">`;
      for (const wp of w.wrappedPlots) {
        const wpName = wp.name ? esc(wp.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`;
        listHtml += `<li><span class="import-result-mark muted">↳</span> ${wpName} <span class="text-dim" style="font-size:11px">${t('import.kept_as_is')}</span></li>`;
      }
      if (w.gapFeature) {
        listHtml += `<li><span class="import-result-mark muted">⌁</span> <em>${esc(w.candidate.name || '')} ${t('import.remainder')}</em></li>`;
      }
      listHtml += `</ul></li>`;
    }
    listHtml += `</ul>`;
  }

  if (plan.free.length > 0) {
    listHtml += `<div class="subdivide-section-label">${t('import.subdivide_free_section')}</div>`;
    listHtml += `<ul class="import-result-list">`;
    for (const c of plan.free) {
      listHtml += `<li><span class="import-result-mark ok">✓</span> ${c.name ? esc(c.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`}${c.ogfRelationId ? ` <span class="text-muted mono">#${c.ogfRelationId}</span>` : ''}</li>`;
    }
    listHtml += `</ul>`;
  }

  setImportPreviewHTML(`
    ${header}
    ${listHtml}
    <div id="import-preview-map" style="height:240px;margin-top:10px;border-radius:var(--radius);border:1px solid var(--border);overflow:hidden"></div>
    <div id="import-commit-container" style="margin-top:12px"></div>
  `);

  ensurePreviewMap('import-preview-map');
  drawPreviewCandidates(parsed.candidates);
  _refreshImportCommitContainer();
}

function runImportCommit() {
  if (!_importPreview || !_importPreview._plan) return;
  const { _plan, nodes, ways } = _importPreview;
  const target = getImportTarget();
  // The button is hidden when there's nothing to commit (see _evaluateImportCommit),
  // so reaching here implies either new plots OR a wrap into a new boundary.
  const { canCommit } = _evaluateImportCommit(_plan, target);
  if (!canCommit) return;

  executeSubdivisionPlan(_plan, nodes, ways, target);
  invalidateBoundaryGeometry();

  const splitCount = _plan.splits.length;
  const wrapCount  = (_plan.wraps || []).length;
  const freeCount  = _plan.free.length;
  const splitCreated = _plan.splits.reduce((s, sp) => s + sp.pieces.length + (sp.remainder ? 1 : 0), 0);

  if (splitCount > 0) toast(t('import.subdivided_toast', { split: splitCount, created: splitCreated }), 'success');
  if (wrapCount  > 0) toast(t('import.wrapped_toast',    { n: wrapCount }), 'success');
  if (freeCount  > 0) toast(t('import.imported_toast',   { n: freeCount }), 'success');

  if (target.kind === 'boundary') {
    const typeName = getBoundaryTypeName(target.typeId);
    const candCount = _plan.free.length
      + (_plan.wraps || []).length
      + new Set(_plan.splits.flatMap(s => s.pieces.map(p => p.candidate))).size;
    toast(t('import.wrapped_as_boundary_toast', { n: candCount, type: typeName }), 'success');
  }

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
    <div class="plot-detail-properties-section">
      <div class="plot-detail-section-label">${t('plot_detail.properties_label')}</div>
      <div id="plot-detail-properties">${_renderPlotPropertyRows(plot)}</div>
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
    ${plot.flags && plot.flags.length > 0 ? `
    <div class="plot-flags-block">
      ${plot.flags.map(f => `<div class="plot-flag-row"><span class="plot-flag-icon">⚠</span>${t('plot_detail.flag_' + f)}</div>`).join('')}
    </div>` : ''}
    <div id="plot-detail-map" style="height:240px;margin-top:12px;border-radius:var(--radius);border:1px solid var(--border);overflow:hidden"></div>
  `, `
    <button class="btn btn-danger" onclick="onPlotDetailDelete()">${t('plot_detail.delete_btn')}</button>
    <button class="btn" onclick="onPlotDetailSplit()">${t('plot_detail.split_btn')}</button>
    <button class="btn" style="margin-left:auto" onclick="closePlotDetail()">${t('btn.close')}</button>
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
    invalidateBoundaryGeometry();
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

// ============================================================
// PLOT PROPERTY VALUE ENTRY (Brick 9)
// ============================================================
// Renders one row per property schema inside the plot detail modal,
// with a kind-appropriate input:
//   - numeric:     <input type="number">
//   - categorical: <input type="text">
//   - percentage:  two inputs (raw + percent) linked live; the side
//                  the user typed becomes the "source of truth" and
//                  is what we persist; the other side is derived from
//                  the current denominator value.
//
// Auto-save fires on blur (numeric / categorical) or on each keystroke
// (percentage — so the linked field can update live).  Empty inputs
// delete the value entirely.

function _renderPlotPropertyRows(plot) {
  // Plot inspector shows schemas where `appliesAtLevel(s, 'plot')` is
  // true — currently equivalent to "rooted at 'plot'" but uses the
  // generic helper so the rule lives in one place. The "empty" message
  // refers to the unfiltered list so users don't get a misleading
  // "no properties" when they've only got boundary-only schemas.
  const allSchemas = data.propertySchemas || [];
  const schemas = allSchemas.filter(s => appliesAtLevel(s, 'plot'));
  if (allSchemas.length === 0) {
    return `<div class="text-dim" style="font-size:12px;padding:8px 0">
      ${t('plot_detail.properties_empty')}
      <a href="javascript:void(0)" onclick="closePlotDetail();switchTab('properties')">${t('plot_detail.properties_empty_link')}</a>
    </div>`;
  }

  // Group percentage schemas by their denominator id so we can nest them
  // visually under whichever property they pull from. A percentage's
  // denominator may itself be a percentage (chains like "Population →
  // % Urban → % Spanish in urban"), which is why we render recursively.
  // Schemas without a resolvable denominator land in `orphans`.
  const childrenByDenom = new Map(); // denomId → percentageSchema[]
  const orphans = [];
  for (const s of schemas) {
    if (s.kind !== 'percentage') continue;
    const denomId = s.denominatorPropertyId;
    let valid = false;
    if (denomId) {
      if (isVirtualPropertyId(denomId)) valid = true;
      else if ((data.propertySchemas || []).some(x => x.id === denomId)) valid = true;
    }
    if (!valid) { orphans.push(s); continue; }
    if (!childrenByDenom.has(denomId)) childrenByDenom.set(denomId, []);
    childrenByDenom.get(denomId).push(s);
  }
  for (const arr of childrenByDenom.values()) {
    arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  // Recursively render a parent's percentage children, grandchildren, etc.
  const renderChildren = (parentId, ancestors) => {
    if (ancestors.has(parentId)) return '';
    const next = new Set(ancestors);
    next.add(parentId);
    let h = '';
    for (const pct of (childrenByDenom.get(parentId) || [])) {
      h += _renderPlotPropertyRow(plot, pct, true);
      h += renderChildren(pct.id, next);
    }
    return h;
  };

  const numerics    = schemas.filter(s => s.kind === 'numeric')
                             .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const categorical = schemas.filter(s => s.kind === 'categorical')
                             .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let html = '';
  html += _renderPlotAreaRow(plot);
  html += renderChildren(AREA_VIRTUAL_ID, new Set());
  for (const num of numerics) {
    html += _renderPlotPropertyRow(plot, num, false);
    html += renderChildren(num.id, new Set());
  }
  for (const cat of categorical) {
    html += _renderPlotPropertyRow(plot, cat, false);
  }
  if (orphans.length > 0) {
    html += `<div class="plot-property-subhead">${t('plot_detail.property_orphan_section')}</div>`;
    for (const pct of orphans) html += _renderPlotPropertyRow(plot, pct, false);
  }
  return html;
}

function _renderPlotAreaRow(plot) {
  const total = (typeof plotArea === 'function') ? plotArea(plot) : 0;
  const fmt = (typeof formatArea === 'function')
    ? (n) => formatArea(n) : (n) => String(n);
  const baseRow = (labelChip, value) => `
    <div class="plot-property-row plot-property-row-readonly" data-area-row="1">
      <div class="plot-property-label">
        <span class="plot-property-name">${t('plot_detail.area_label')}</span>
        ${labelChip}
      </div>
      <div class="plot-property-input">
        <span class="plot-property-readonly-value mono">${esc(value)}</span>
      </div>
    </div>`;

  return baseRow(`<span class="property-unit-chip">${t('plot_detail.computed_chip')}</span>`, fmt(total));
}

// Wrap an <input>'s HTML in a `.input-with-suffix` frame. The suffix
// (e.g. "people", "m²", "%") sits inside the input frame, right-aligned,
// so the unit reads as part of the value rather than as a separate
// label-side chip.
function _inputWithSuffix(inputHtml, suffix) {
  if (!suffix) return `<div class="input-with-suffix">${inputHtml}</div>`;
  return `<div class="input-with-suffix has-suffix">${inputHtml}<span class="input-suffix">${esc(suffix)}</span></div>`;
}

function _renderPlotPropertyRow(plot, schema, isNested) {
  const stored = getPlotPropertyValue(plot, schema.id);
  const label = `<div class="plot-property-label">
    <span class="plot-property-name">${esc(schema.name)}</span>
  </div>`;
  const rowClass = isNested ? 'plot-property-row plot-property-row-nested' : 'plot-property-row';

  if (schema.kind === 'numeric') {
    const val = stored != null && stored !== '' ? esc(String(stored)) : '';
    const input = `<input type="number" step="any" data-schema-id="${esc(schema.id)}" data-kind="numeric"
      value="${val}" placeholder="${t('plot_detail.property_empty_placeholder')}"
      onblur="onPlotPropertyBlur(this)">`;
    return `<div class="${rowClass}">
      ${label}
      <div class="plot-property-input">
        ${_inputWithSuffix(input, schema.unit || '')}
      </div>
    </div>`;
  }

  if (schema.kind === 'categorical') {
    const val = typeof stored === 'string' ? stored : '';
    const taId = `ta-${plot.id}-${schema.id}`;
    return `<div class="${rowClass}">
      ${label}
      <div class="plot-property-input">
        ${typeaheadHTML({
          id: taId,
          value: val,
          placeholder: t('plot_detail.property_empty_placeholder'),
          optionsFnName: 'categoricalSuggestionsForInput',
          commitFnName: 'onPlotPropertyBlur',
          dataAttrs: { 'schema-id': schema.id, 'kind': 'categorical' }
        })}
      </div>
    </div>`;
  }

  if (schema.kind === 'percentage') {
    const display = derivePercentageDisplay(plot, schema, stored);
    const denomName = display.denomSchema?.name || '';
    const denomUnit = display.denomSchema?.unit || '';
    const denomUnitTxt = denomUnit ? ` ${denomUnit}` : '';
    const rawSourceIsRaw = stored?.mode === 'raw';
    const rawSourceIsPct = stored?.mode === 'percent';
    const rawVal = display.raw    != null ? formatPropertyNumber(display.raw)    : '';
    const pctVal = display.percent != null ? formatPropertyNumber(display.percent) : '';
    // When the percentage is nested under its denominator's row, the
    // "of <denom> = <value>" hint is redundant — the denominator row sits
    // directly above. We still show the "denominator unset on this plot"
    // hint and the "no denominator schema" warning, since those describe
    // a problem the user needs to know about.
    let denomNote = '';
    if (!display.denomSchema) {
      denomNote = `<div class="plot-property-warning">${t('plot_detail.property_no_denominator')}</div>`;
    } else if (display.denomVal == null) {
      denomNote = `<div class="plot-property-hint">${t('plot_detail.property_denominator_unset', { name: esc(denomName) })}</div>`;
    } else if (!isNested) {
      denomNote = `<div class="plot-property-hint">${t('plot_detail.property_denominator_of', {
        name: esc(denomName),
        value: formatPropertyNumber(display.denomVal) + esc(denomUnitTxt)
      })}</div>`;
    }

    const rawInput = `<input type="number" step="any"
      data-schema-id="${esc(schema.id)}" data-kind="percentage" data-mode="raw"
      value="${rawVal}" placeholder="${t('plot_detail.property_raw_placeholder')}"
      ${rawSourceIsRaw ? 'data-source="1"' : ''}
      oninput="onPlotPropertyPercentInput(this)"
      onblur="onPlotPropertyPercentBlur(this)">`;
    const pctInput = `<input type="number" step="any"
      data-schema-id="${esc(schema.id)}" data-kind="percentage" data-mode="percent"
      value="${pctVal}" placeholder="${t('plot_detail.property_percent_placeholder')}"
      ${rawSourceIsPct ? 'data-source="1"' : ''}
      oninput="onPlotPropertyPercentInput(this)"
      onblur="onPlotPropertyPercentBlur(this)">`;

    return `<div class="${rowClass} plot-property-row-percent">
      ${label}
      <div class="plot-property-input plot-property-input-percent">
        ${_inputWithSuffix(rawInput, denomUnit || '')}
        <span class="plot-property-eq">=</span>
        ${_inputWithSuffix(pctInput, '%')}
        ${denomNote}
      </div>
    </div>`;
  }
  return '';
}

// ============================================================
// BOUNDARY INSPECTOR — property rows (Brick 10b)
// ============================================================
// Mirrors the plot inspector functions one-for-one, swapping plot
// helpers for boundary helpers. The DOM container is
// `#boundary-detail-properties` and state lives on `_boundaryDetailId`.
// No aggregation engine yet — values entered here are purely user-set.
// Roll-up + override flags arrive in Brick 10c.

function _renderBoundaryPropertyRows(boundary) {
  if (!boundary) return '';
  const allSchemas = data.propertySchemas || [];
  const schemas = allSchemas.filter(s => appliesAtLevel(s, boundary.typeId));
  if (allSchemas.length === 0) {
    return `<div class="text-dim" style="font-size:12px;padding:8px 0">
      ${t('plot_detail.properties_empty')}
      <a href="javascript:void(0)" onclick="closeBoundaryDetail();switchTab('properties')">${t('plot_detail.properties_empty_link')}</a>
    </div>`;
  }
  if (schemas.length === 0) {
    return `<div class="text-dim" style="font-size:12px;padding:8px 0">
      ${t('boundary_detail.properties_none_apply')}
    </div>`;
  }

  // Group percentage schemas by their denominator id, exactly as on plots.
  const childrenByDenom = new Map();
  const orphans = [];
  for (const s of schemas) {
    if (s.kind !== 'percentage') continue;
    const denomId = s.denominatorPropertyId;
    let valid = false;
    if (denomId) {
      if (isVirtualPropertyId(denomId)) valid = true;
      else if ((data.propertySchemas || []).some(x => x.id === denomId)) valid = true;
    }
    if (!valid) { orphans.push(s); continue; }
    if (!childrenByDenom.has(denomId)) childrenByDenom.set(denomId, []);
    childrenByDenom.get(denomId).push(s);
  }
  for (const arr of childrenByDenom.values()) {
    arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  const renderChildren = (parentId, ancestors) => {
    if (ancestors.has(parentId)) return '';
    const next = new Set(ancestors);
    next.add(parentId);
    let h = '';
    for (const pct of (childrenByDenom.get(parentId) || [])) {
      h += _renderBoundaryPropertyRow(boundary, pct, true);
      h += renderChildren(pct.id, next);
    }
    return h;
  };

  const numerics    = schemas.filter(s => s.kind === 'numeric')
                             .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const categorical = schemas.filter(s => s.kind === 'categorical')
                             .slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  let html = '';
  html += _renderBoundaryAreaRow(boundary);
  html += renderChildren(AREA_VIRTUAL_ID, new Set());
  for (const num of numerics) {
    html += _renderBoundaryPropertyRow(boundary, num, false);
    html += renderChildren(num.id, new Set());
  }
  for (const cat of categorical) {
    html += _renderBoundaryPropertyRow(boundary, cat, false);
  }
  if (orphans.length > 0) {
    html += `<div class="plot-property-subhead">${t('plot_detail.property_orphan_section')}</div>`;
    for (const pct of orphans) html += _renderBoundaryPropertyRow(boundary, pct, false);
  }
  return html;
}

function _renderBoundaryAreaRow(boundary) {
  const total = (typeof boundaryArea === 'function') ? boundaryArea(boundary) : 0;
  const fmt = (typeof formatArea === 'function')
    ? (n) => formatArea(n) : (n) => String(n);

  return `<div class="plot-property-row plot-property-row-readonly" data-area-row="1">
    <div class="plot-property-label">
      <span class="plot-property-name">${t('plot_detail.area_label')}</span>
      <span class="property-unit-chip">${t('plot_detail.computed_chip')}</span>
    </div>
    <div class="plot-property-input">
      <span class="plot-property-readonly-value mono">${esc(fmt(total))}</span>
    </div>
  </div>`;
}

function _renderBoundaryPropertyRow(boundary, schema, isNested) {
  const stored = getBoundaryPropertyValue(boundary, schema.id);
  const label = `<div class="plot-property-label">
    <span class="plot-property-name">${esc(schema.name)}</span>
  </div>`;
  const rowClass = isNested ? 'plot-property-row plot-property-row-nested' : 'plot-property-row';
  // Brick 10c: rollup hint + mismatch badge live in a stable wrapper so
  // we can refresh just the rollup region in place when a value
  // changes (no row re-render = no focus loss).
  const rollupBlock = _renderBoundaryRollupBlock(boundary, schema);

  if (schema.kind === 'numeric') {
    const val = stored != null && stored !== '' ? esc(String(stored)) : '';
    const input = `<input type="number" step="any" data-schema-id="${esc(schema.id)}" data-kind="numeric"
      value="${val}" placeholder="${t('plot_detail.property_empty_placeholder')}"
      onblur="onBoundaryPropertyBlur(this)">`;
    return `<div class="${rowClass}">
      ${label}
      <div class="plot-property-input">
        ${_inputWithSuffix(input, schema.unit || '')}
        ${rollupBlock}
      </div>
    </div>`;
  }

  if (schema.kind === 'categorical') {
    const val = typeof stored === 'string' ? stored : '';
    const taId = `ta-b-${boundary.id}-${schema.id}`;
    return `<div class="${rowClass}">
      ${label}
      <div class="plot-property-input">
        ${typeaheadHTML({
          id: taId,
          value: val,
          placeholder: t('plot_detail.property_empty_placeholder'),
          optionsFnName: 'categoricalSuggestionsForInput',
          commitFnName: 'onBoundaryPropertyBlur',
          dataAttrs: { 'schema-id': schema.id, 'kind': 'categorical' }
        })}
        ${rollupBlock}
      </div>
    </div>`;
  }

  if (schema.kind === 'percentage') {
    const display = derivePercentageDisplayForBoundary(boundary, schema, stored);
    const denomName = display.denomSchema?.name || '';
    const denomUnit = display.denomSchema?.unit || '';
    const denomUnitTxt = denomUnit ? ` ${denomUnit}` : '';
    const rawSourceIsRaw = stored?.mode === 'raw';
    const rawSourceIsPct = stored?.mode === 'percent';
    const rawVal = display.raw    != null ? formatPropertyNumber(display.raw)    : '';
    const pctVal = display.percent != null ? formatPropertyNumber(display.percent) : '';
    let denomNote = '';
    if (!display.denomSchema) {
      denomNote = `<div class="plot-property-warning">${t('plot_detail.property_no_denominator')}</div>`;
    } else if (display.denomVal == null) {
      denomNote = `<div class="plot-property-hint">${t('plot_detail.property_denominator_unset', { name: esc(denomName) })}</div>`;
    } else if (!isNested) {
      denomNote = `<div class="plot-property-hint">${t('plot_detail.property_denominator_of', {
        name: esc(denomName),
        value: formatPropertyNumber(display.denomVal) + esc(denomUnitTxt)
      })}</div>`;
    }

    const rawInput = `<input type="number" step="any"
      data-schema-id="${esc(schema.id)}" data-kind="percentage" data-mode="raw"
      value="${rawVal}" placeholder="${t('plot_detail.property_raw_placeholder')}"
      ${rawSourceIsRaw ? 'data-source="1"' : ''}
      oninput="onBoundaryPropertyPercentInput(this)"
      onblur="onBoundaryPropertyPercentBlur(this)">`;
    const pctInput = `<input type="number" step="any"
      data-schema-id="${esc(schema.id)}" data-kind="percentage" data-mode="percent"
      value="${pctVal}" placeholder="${t('plot_detail.property_percent_placeholder')}"
      ${rawSourceIsPct ? 'data-source="1"' : ''}
      oninput="onBoundaryPropertyPercentInput(this)"
      onblur="onBoundaryPropertyPercentBlur(this)">`;

    return `<div class="${rowClass} plot-property-row-percent">
      ${label}
      <div class="plot-property-input plot-property-input-percent">
        ${_inputWithSuffix(rawInput, denomUnit || '')}
        <span class="plot-property-eq">=</span>
        ${_inputWithSuffix(pctInput, '%')}
        ${denomNote}
        ${rollupBlock}
      </div>
    </div>`;
  }
  return '';
}

// Brick 10c — rollup hint + mismatch badge for a single property row
// on a boundary. The wrapper is always rendered (carries
// `data-rollup-container="<schemaId>"`) so we can refresh it in place
// when values change. CSS `:empty` hides it when nothing to show.
function _renderBoundaryRollupBlock(boundary, schema) {
  return `<div class="plot-property-rollup-hint"
    data-rollup-container="${esc(schema.id)}">${
      _renderBoundaryRollupBlockInner(boundary, schema)
    }</div>`;
}

function _renderBoundaryRollupBlockInner(boundary, schema) {
  if (!boundary || !schema) return '';
  const root = schema.rootLevelId || 'plot';
  // At the source-of-truth level: no rollup hint (this IS where the
  // value is recorded). Rollups only make sense at LARGER levels.
  if (root === boundary.typeId) return '';

  if (schema.kind === 'numeric') {
    const rollup = computeRollupNumeric(boundary, schema, new Set([boundary.id]));
    if (rollup == null) return '';
    const unitTxt = schema.unit ? ` ${esc(schema.unit)}` : '';
    const hint = t('boundary_detail.rollup_value', {
      value: formatPropertyNumber(rollup) + unitTxt,
    });
    const userVal = resolveNumericValueForBoundary(boundary, schema);
    const mm = classifyRollupMismatch(userVal, rollup);
    return hint + _renderMismatchBadge(mm);
  }

  if (schema.kind === 'percentage') {
    const r = computeRollupPercentage(boundary, schema, new Set([boundary.id]));
    if (!r) return '';
    const denomUnit = r.denomSchema?.unit || '';
    const denomUnitTxt = denomUnit ? ` ${esc(denomUnit)}` : '';
    const parts = [];
    if (r.raw != null)     parts.push(formatPropertyNumber(r.raw) + denomUnitTxt);
    if (r.percent != null) parts.push(formatPropertyNumber(r.percent) + '%');
    const hint = parts.length > 0
      ? t('boundary_detail.rollup_value', { value: parts.join(' = ') })
      : '';
    const userVal = resolveNumericValueForBoundary(boundary, schema); // raw
    const mm = classifyRollupMismatch(userVal, r.raw);
    return hint + _renderMismatchBadge(mm);
  }

  if (schema.kind === 'categorical' && schema.rollupDistribution) {
    const dist = computeRollupCategoricalDistribution(boundary, schema, new Set([boundary.id]));
    if (!dist || dist.size === 0) return '';
    const total = Array.from(dist.values()).reduce((a, b) => a + b, 0);
    if (total === 0) return '';
    const formatted = Array.from(dist.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([val, count]) => `${esc(val)} ${Math.round((count / total) * 100)}%`)
      .join(', ');
    return t('boundary_detail.rollup_distribution', { dist: formatted });
  }
  return '';
}

function _renderMismatchBadge(cls) {
  if (!cls) return '';
  if (cls === 'match') return `<span class="rollup-mismatch-badge rollup-mismatch-match">${t('boundary_detail.rollup_match')}</span>`;
  if (cls === 'under') return `<span class="rollup-mismatch-badge rollup-mismatch-under">${t('boundary_detail.rollup_under')}</span>`;
  if (cls === 'over')  return `<span class="rollup-mismatch-badge rollup-mismatch-over">${t('boundary_detail.rollup_over')}</span>`;
  return '';
}

// Refresh every rollup block on the open boundary inspector. Called
// after any value commit on the boundary, because:
//   - The boundary's user-set value just changed → mismatch may shift.
//   - Effective denom of this boundary may change → percentage rows'
//     rollup percents may shift even though their rollup raws don't.
// Cheap to walk all rows; the alternative (computing exact deps) isn't
// worth the complexity.
function _refreshAllBoundaryRollups() {
  if (!_boundaryDetailId) return;
  const boundary = data.boundaries.find(b => b.id === _boundaryDetailId);
  if (!boundary) return;
  const schemas = (data.propertySchemas || []).filter(s => appliesAtLevel(s, boundary.typeId));
  for (const s of schemas) {
    const container = document.querySelector(
      `#boundary-detail-properties [data-rollup-container="${s.id}"]`
    );
    if (container) container.innerHTML = _renderBoundaryRollupBlockInner(boundary, s);
  }
}

// Distinct non-empty categorical values seen across all plots AND
// boundaries (Brick 10b) for the given schema. Drives the typeahead's
// suggestions on categorical rows — fights typos when reusing the
// same category across entities. Ordered by **prevalence** (most-used
// first, descending count across plots + boundaries), with alphabetical
// as tiebreaker. The in-flight value on the input being edited is
// included with count 0 so it appears in the list even when distinct
// from anything stored — but lands after real matches of equal alpha
// order.
function _collectCategoricalValues(schemaId, currentVal) {
  const counts = new Map(); // canonicalised value → count
  const tally = (v) => {
    if (typeof v === 'string' && v.trim()) {
      const key = v.trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  };
  for (const plot of (data.plots || [])) {
    tally(plot.propertyValues?.[schemaId]);
  }
  for (const b of (data.boundaries || [])) {
    tally(b.propertyValues?.[schemaId]);
  }
  if (typeof currentVal === 'string' && currentVal.trim()) {
    const key = currentVal.trim();
    if (!counts.has(key)) counts.set(key, 0);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

// Suggestion source for typeaheadHTML on categorical rows. Looked up by
// name via the typeahead's `data-options-fn` attribute — must stay a
// top-level (global) function. Reads the schema id off the input.
function categoricalSuggestionsForInput(input) {
  const schemaId = input.getAttribute('data-schema-id');
  if (!schemaId) return [];
  return _collectCategoricalValues(schemaId, input.value);
}

// Re-render every percentage row whose schema depends on `changedSchemaId`
// as its denominator. Used after a numeric (or percentage!) value
// changes — dependents recompute their derived side without disturbing
// the source side. Walks transitively: when A changes, B (% of A)
// refreshes, then C (% of B) also refreshes, etc. `visited` guards
// against any cycle that schema validation might have missed.
function _refreshDependentPercentageRows(changedSchemaId, visited) {
  if (!_detailPlotId) return;
  visited = visited || new Set();
  if (visited.has(changedSchemaId)) return;
  visited.add(changedSchemaId);
  const plot = data.plots.find(p => p.id === _detailPlotId);
  if (!plot) return;
  const dependents = (data.propertySchemas || []).filter(s =>
    s.kind === 'percentage' && s.denominatorPropertyId === changedSchemaId
  );
  for (const dep of dependents) {
    const rawInput = document.querySelector(
      `#plot-detail-properties input[data-schema-id="${dep.id}"][data-mode="raw"]`
    );
    const pctInput = document.querySelector(
      `#plot-detail-properties input[data-schema-id="${dep.id}"][data-mode="percent"]`
    );
    if (!rawInput || !pctInput) continue;
    const stored = getPlotPropertyValue(plot, dep.id);
    const display = derivePercentageDisplay(plot, dep, stored);
    // Update the derived side only; leave the source side alone.
    if (stored?.mode === 'raw') {
      pctInput.value = display.percent != null ? formatPropertyNumber(display.percent) : '';
    } else if (stored?.mode === 'percent') {
      rawInput.value = display.raw != null ? formatPropertyNumber(display.raw) : '';
    } else {
      // Nothing stored — both sides empty, but if the denominator now has
      // a value the user can type into either side.
      rawInput.value = '';
      pctInput.value = '';
    }
    // This dep's resolved value just changed, so anything that uses it
    // as a denominator needs to recompute too.
    _refreshDependentPercentageRows(dep.id, visited);
  }
}

function onPlotPropertyBlur(inputEl) {
  if (!_detailPlotId) return;
  const plot = data.plots.find(p => p.id === _detailPlotId);
  if (!plot) return;
  const schemaId = inputEl.dataset.schemaId;
  const kind = inputEl.dataset.kind;
  const raw = inputEl.value;

  if (kind === 'numeric') {
    if (raw === '' || raw == null) {
      clearPlotPropertyValue(plot, schemaId);
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return; // invalid — leave previous value alone
      const schema = findPropertySchema(schemaId);
      const stored = schema?.autoRound ? Math.round(n) : n;
      setPlotPropertyValue(plot, schemaId, stored);
      // Reflect the rounded value back into the input so the user sees
      // what got persisted (rather than 50.8 silently becoming 51 in
      // the next render).
      if (stored !== n) inputEl.value = String(stored);
    }
    save();
    _refreshDependentPercentageRows(schemaId);
  } else if (kind === 'categorical') {
    if (raw === '' || raw == null) clearPlotPropertyValue(plot, schemaId);
    else                            setPlotPropertyValue(plot, schemaId, raw);
    save();
  }
}

// Percentage input — live-link the two fields. Each keystroke in one
// field updates the other field's value AND updates storage with the
// new source (mode + value).  An empty field deletes the value entirely
// and clears the linked field too.
function onPlotPropertyPercentInput(inputEl) {
  if (!_detailPlotId) return;
  const plot = data.plots.find(p => p.id === _detailPlotId);
  if (!plot) return;
  const schemaId = inputEl.dataset.schemaId;
  const mode = inputEl.dataset.mode; // 'raw' | 'percent'
  const schema = findPropertySchema(schemaId);
  if (!schema) return;
  const raw = inputEl.value;

  // Empty input → clear both sides and storage.
  if (raw === '' || raw == null) {
    clearPlotPropertyValue(plot, schemaId);
    const otherMode = mode === 'raw' ? 'percent' : 'raw';
    const otherInput = document.querySelector(
      `#plot-detail-properties input[data-schema-id="${schemaId}"][data-mode="${otherMode}"]`
    );
    if (otherInput) otherInput.value = '';
    // Reset source attribute on both inputs.
    document.querySelectorAll(
      `#plot-detail-properties input[data-schema-id="${schemaId}"]`
    ).forEach(el => el.removeAttribute('data-source'));
    save();
    return;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return; // invalid — leave alone

  setPlotPropertyValue(plot, schemaId, { mode, value: n });
  // Mark this input as source, clear source on its sibling.
  document.querySelectorAll(
    `#plot-detail-properties input[data-schema-id="${schemaId}"]`
  ).forEach(el => {
    if (el === inputEl) el.setAttribute('data-source', '1');
    else el.removeAttribute('data-source');
  });

  // Recompute the derived sibling.
  const display = derivePercentageDisplay(plot, schema, { mode, value: n });
  const siblingMode = mode === 'raw' ? 'percent' : 'raw';
  const sibling = document.querySelector(
    `#plot-detail-properties input[data-schema-id="${schemaId}"][data-mode="${siblingMode}"]`
  );
  if (sibling) {
    const derived = siblingMode === 'raw' ? display.raw : display.percent;
    sibling.value = derived != null ? formatPropertyNumber(derived) : '';
  }
  save();
}

// Percentage blur — save() is already called inside the input handler
// for every keystroke (debounced 300 ms by save()), so blur is just a
// belt-and-braces flush in case focus loss happens without a final
// input event.
function onPlotPropertyPercentBlur(inputEl) {
  // Apply auto-round on commit (not on each keystroke — that would
  // interfere with typing decimals). Only the raw side participates
  // in auto-round: the percent side is in % and isn't rounded by the
  // `autoRound` flag.
  if (_detailPlotId && inputEl?.dataset?.mode === 'raw') {
    const plot = data.plots.find(p => p.id === _detailPlotId);
    const schemaId = inputEl.dataset.schemaId;
    const schema = schemaId ? findPropertySchema(schemaId) : null;
    if (plot && schema && _effectiveAutoRound(schema)) {
      const stored = getPlotPropertyValue(plot, schemaId);
      if (stored && typeof stored === 'object' && stored.mode === 'raw'
          && Number.isFinite(Number(stored.value))) {
        const rounded = Math.round(Number(stored.value));
        if (rounded !== Number(stored.value)) {
          setPlotPropertyValue(plot, schemaId, { mode: 'raw', value: rounded });
          inputEl.value = String(rounded);
          // The percent sibling derives from the now-rounded raw — refresh it.
          const sibling = document.querySelector(
            `#plot-detail-properties input[data-schema-id="${schemaId}"][data-mode="percent"]`
          );
          if (sibling) {
            const display = derivePercentageDisplay(plot, schema, { mode: 'raw', value: rounded });
            sibling.value = display.percent != null ? formatPropertyNumber(display.percent) : '';
          }
          _refreshDependentPercentageRows(schemaId);
        }
      }
    }
  }
  save();
}

// ============================================================
// BOUNDARY INSPECTOR — value handlers (Brick 10b)
// ============================================================
// Parallel to onPlotProperty* — same logic, swap plot helpers for
// boundary helpers, swap `_detailPlotId` for `_boundaryDetailId`, swap
// `#plot-detail-properties` for `#boundary-detail-properties`.

function _refreshDependentBoundaryPercentageRows(changedSchemaId, visited) {
  if (!_boundaryDetailId) return;
  visited = visited || new Set();
  if (visited.has(changedSchemaId)) return;
  visited.add(changedSchemaId);
  const boundary = data.boundaries.find(b => b.id === _boundaryDetailId);
  if (!boundary) return;
  const dependents = (data.propertySchemas || []).filter(s =>
    s.kind === 'percentage' && s.denominatorPropertyId === changedSchemaId
  );
  for (const dep of dependents) {
    const rawInput = document.querySelector(
      `#boundary-detail-properties input[data-schema-id="${dep.id}"][data-mode="raw"]`
    );
    const pctInput = document.querySelector(
      `#boundary-detail-properties input[data-schema-id="${dep.id}"][data-mode="percent"]`
    );
    if (!rawInput || !pctInput) continue;
    const stored = getBoundaryPropertyValue(boundary, dep.id);
    const display = derivePercentageDisplayForBoundary(boundary, dep, stored);
    if (stored?.mode === 'raw') {
      pctInput.value = display.percent != null ? formatPropertyNumber(display.percent) : '';
    } else if (stored?.mode === 'percent') {
      rawInput.value = display.raw != null ? formatPropertyNumber(display.raw) : '';
    } else {
      rawInput.value = '';
      pctInput.value = '';
    }
    _refreshDependentBoundaryPercentageRows(dep.id, visited);
  }
}

function onBoundaryPropertyBlur(inputEl) {
  if (!_boundaryDetailId) return;
  const boundary = data.boundaries.find(b => b.id === _boundaryDetailId);
  if (!boundary) return;
  const schemaId = inputEl.dataset.schemaId;
  const kind = inputEl.dataset.kind;
  const raw = inputEl.value;

  if (kind === 'numeric') {
    if (raw === '' || raw == null) {
      clearBoundaryPropertyValue(boundary, schemaId);
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      const schema = findPropertySchema(schemaId);
      const stored = schema?.autoRound ? Math.round(n) : n;
      setBoundaryPropertyValue(boundary, schemaId, stored);
      if (stored !== n) inputEl.value = String(stored);
    }
    save();
    _refreshDependentBoundaryPercentageRows(schemaId);
    _refreshAllBoundaryRollups();
  } else if (kind === 'categorical') {
    if (raw === '' || raw == null) {
      clearBoundaryPropertyValue(boundary, schemaId);
    } else {
      setBoundaryPropertyValue(boundary, schemaId, raw);
    }
    save();
    _refreshAllBoundaryRollups();
  }
}

function onBoundaryPropertyPercentInput(inputEl) {
  if (!_boundaryDetailId) return;
  const boundary = data.boundaries.find(b => b.id === _boundaryDetailId);
  if (!boundary) return;
  const schemaId = inputEl.dataset.schemaId;
  const mode = inputEl.dataset.mode;
  const schema = findPropertySchema(schemaId);
  if (!schema) return;
  const raw = inputEl.value;

  if (raw === '' || raw == null) {
    clearBoundaryPropertyValue(boundary, schemaId);
    const otherMode = mode === 'raw' ? 'percent' : 'raw';
    const otherInput = document.querySelector(
      `#boundary-detail-properties input[data-schema-id="${schemaId}"][data-mode="${otherMode}"]`
    );
    if (otherInput) otherInput.value = '';
    document.querySelectorAll(
      `#boundary-detail-properties input[data-schema-id="${schemaId}"]`
    ).forEach(el => el.removeAttribute('data-source'));
    save();
    _refreshDependentBoundaryPercentageRows(schemaId);
    _refreshAllBoundaryRollups();
    return;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return;

  setBoundaryPropertyValue(boundary, schemaId, { mode, value: n });
  document.querySelectorAll(
    `#boundary-detail-properties input[data-schema-id="${schemaId}"]`
  ).forEach(el => {
    if (el === inputEl) el.setAttribute('data-source', '1');
    else el.removeAttribute('data-source');
  });

  const display = derivePercentageDisplayForBoundary(boundary, schema, { mode, value: n });
  const siblingMode = mode === 'raw' ? 'percent' : 'raw';
  const sibling = document.querySelector(
    `#boundary-detail-properties input[data-schema-id="${schemaId}"][data-mode="${siblingMode}"]`
  );
  if (sibling) {
    const derived = siblingMode === 'raw' ? display.raw : display.percent;
    sibling.value = derived != null ? formatPropertyNumber(derived) : '';
  }
  save();
  _refreshDependentBoundaryPercentageRows(schemaId);
  _refreshAllBoundaryRollups();
}

function onBoundaryPropertyPercentBlur(inputEl) {
  if (_boundaryDetailId && inputEl?.dataset?.mode === 'raw') {
    const boundary = data.boundaries.find(b => b.id === _boundaryDetailId);
    const schemaId = inputEl.dataset.schemaId;
    const schema = schemaId ? findPropertySchema(schemaId) : null;
    if (boundary && schema && _effectiveAutoRound(schema)) {
      const stored = getBoundaryPropertyValue(boundary, schemaId);
      if (stored && typeof stored === 'object' && stored.mode === 'raw'
          && Number.isFinite(Number(stored.value))) {
        const rounded = Math.round(Number(stored.value));
        if (rounded !== Number(stored.value)) {
          setBoundaryPropertyValue(boundary, schemaId, { mode: 'raw', value: rounded });
          inputEl.value = String(rounded);
          const sibling = document.querySelector(
            `#boundary-detail-properties input[data-schema-id="${schemaId}"][data-mode="percent"]`
          );
          if (sibling) {
            const display = derivePercentageDisplayForBoundary(boundary, schema, { mode: 'raw', value: rounded });
            sibling.value = display.percent != null ? formatPropertyNumber(display.percent) : '';
          }
          _refreshDependentBoundaryPercentageRows(schemaId);
        }
      }
    }
  }
  save();
  // Always refresh rollup display on commit — covers any user-set change
  // even if no rounding happened.
  _refreshAllBoundaryRollups();
}

// ============================================================
// PROPERTIES — schema editor (Brick 8)
// ============================================================
// Three kinds: numeric (sum / weighted-average), categorical (no rollup
// by default; opt-in distribution aggregation), percentage (of another
// property). Plot-level value entry arrives in Brick 9; aggregation in
// Brick 10. This brick is the schema layer only.

let _propertyEditId = null;

function renderProperties() {
  const el = document.getElementById('properties-content');
  if (!el) return;

  bootstrapPropertySchemas();

  const all = (data.propertySchemas || []).slice().sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  const top = `
    <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:12px">
      <button class="btn btn-primary" onclick="openAddPropertyModal()">+ ${t('properties.add_btn')}</button>
      <span class="text-dim" style="font-size:12px">${t('properties.count', { n: all.length })}</span>
    </div>`;

  if (all.length === 0) {
    el.innerHTML = top + `
      <div class="empty-state">
        <div class="empty-icon">◊</div>
        <h3>${t('properties.empty_title')}</h3>
        <p>${t('properties.empty_body')}</p>
        <button class="btn btn-primary" onclick="openAddPropertyModal()">+ ${t('properties.add_btn')}</button>
      </div>`;
    return;
  }

  el.innerHTML = top + `
    <table class="data-table">
      <thead>
        <tr>
          <th>${t('properties.col_name')}</th>
          <th>${t('properties.col_kind')}</th>
          <th>${t('properties.col_behaviour')}</th>
          <th>${t('properties.col_unit')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${all.map(_renderPropertyRow).join('')}
      </tbody>
    </table>`;
}

function _renderPropertyRow(schema) {
  const kindLabel = t('properties.kind_' + schema.kind) || schema.kind;
  const beh = describePropertyBehaviour(schema);
  let behLabel;
  if (beh.code === 'sum')                  behLabel = t('properties.beh_sum');
  else if (beh.code === 'weighted_average') behLabel = beh.refName
                                                ? t('properties.beh_weighted_by', { name: esc(beh.refName) })
                                                : `<span class="text-muted">${t('properties.beh_weighted_unset')}</span>`;
  else if (beh.code === 'distribution')     behLabel = t('properties.beh_distribution');
  else if (beh.code === 'no_rollup')        behLabel = t('properties.beh_no_rollup');
  else if (beh.code === 'percentage_of')    behLabel = beh.refName
                                                ? t('properties.beh_percent_of', { name: esc(beh.refName) })
                                                : `<span class="text-muted">${t('properties.beh_percent_unset')}</span>`;
  else                                      behLabel = '<span class="text-muted">—</span>';

  // Append a "Defined at: <type>" chip when the schema is rooted at a
  // boundary type. Plot-rooted schemas (the common default) stay quiet
  // so the column doesn't get noisy for the typical case.
  const root = schema.rootLevelId || 'plot';
  if (root !== 'plot') {
    const rootType = (data.boundaryTypes || []).find(bt => bt.id === root);
    if (rootType) {
      behLabel += ` <span class="property-root-chip">${t('properties.defined_at_chip', { name: esc(rootType.name) })}</span>`;
    }
  }

  return `<tr>
    <td><strong>${esc(schema.name)}</strong></td>
    <td>${esc(kindLabel)}</td>
    <td>${behLabel}</td>
    <td class="text-dim">${schema.unit ? esc(schema.unit) : '<span class="text-muted">—</span>'}</td>
    <td class="actions-cell" style="white-space:nowrap;text-align:right">
      <button class="btn btn-sm" onclick="openEditPropertyModal('${esc(schema.id)}')">${t('properties.edit_btn')}</button>
      <button class="btn btn-sm btn-danger" onclick="deleteProperty('${esc(schema.id)}')">${t('properties.delete_btn')}</button>
    </td>
  </tr>`;
}

function openAddPropertyModal() {
  _propertyEditId = null;
  _openPropertyModal(t('properties.modal_add_title'), null);
}

function openEditPropertyModal(id) {
  const schema = findPropertySchema(id);
  if (!schema) return;
  _propertyEditId = id;
  _openPropertyModal(t('properties.modal_edit_title'), schema);
}

function _openPropertyModal(title, schema) {
  if (typeof resetColorPickers === 'function') resetColorPickers();
  const isEdit = !!schema;
  const name = schema?.name || '';
  const unit = schema?.unit || '';
  const notes = schema?.notes || '';
  const kind = schema?.kind || 'numeric';
  const aggregation = schema?.aggregation || 'sum';
  const weightId = schema?.weightPropertyId || '';
  const denominatorId = schema?.denominatorPropertyId || '';
  const rollup = !!schema?.rollupDistribution;
  const autoRound = !!schema?.autoRound;
  const rootLevelId = schema?.rootLevelId || 'plot';

  // Kind dropdown is locked on edit (data-integrity hedge for Brick 9).
  // Add: dropdown is enabled and onchange swaps the kind-specific block.
  const kindSelectHtml = isEdit
    ? `<select id="property-kind" disabled>
         ${PROPERTY_KINDS.map(k => `<option value="${k}"${k === kind ? ' selected' : ''}>${esc(t('properties.kind_' + k))}</option>`).join('')}
       </select>
       <p class="text-dim" style="font-size:11px;margin-top:4px">${t('properties.kind_locked_help')}</p>`
    : `<select id="property-kind" onchange="onPropertyKindChange(this.value)">
         ${PROPERTY_KINDS.map(k => `<option value="${k}"${k === kind ? ' selected' : ''}>${esc(t('properties.kind_' + k))}</option>`).join('')}
       </select>`;

  openModal(title, `
    <div class="form-group">
      <label>${t('properties.name_label')}</label>
      <input type="text" id="property-name" value="${esc(name)}"
        placeholder="${t('properties.name_placeholder')}" autocomplete="off">
    </div>
    <div class="form-group">
      <label>${t('properties.unit_label')}</label>
      <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('properties.unit_help')}</p>
      <input type="text" id="property-unit" value="${esc(unit)}"
        placeholder="${t('properties.unit_placeholder')}" autocomplete="off" style="max-width:160px">
    </div>
    <div class="form-group">
      <label>${t('properties.kind_label')}</label>
      <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('properties.kind_help')}</p>
      ${kindSelectHtml}
    </div>
    <div class="form-group">
      <label>${t('properties.defined_at_label')}</label>
      <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('properties.defined_at_help')}</p>
      ${_definedAtSelect(rootLevelId)}
    </div>
    <div id="property-kind-fields">
      ${_renderPropertyKindFields(kind, { aggregation, weightId, denominatorId, rollup, autoRound, schema })}
    </div>
    <div class="form-group">
      <label>${t('properties.notes_label')}</label>
      <textarea id="property-notes" rows="2"
        placeholder="${t('properties.notes_placeholder')}">${esc(notes)}</textarea>
    </div>
  `, `
    <button class="btn" onclick="closeModal()">${t('btn.cancel')}</button>
    <button class="btn btn-primary" onclick="saveProperty()">${t('btn.save')}</button>
  `);

  const modalEl = document.getElementById('modal');
  if (modalEl) modalEl.style.width = '560px';
  setTimeout(() => document.getElementById('property-name')?.focus(), 50);
}

function _renderPropertyKindFields(kind, opts) {
  // opts: { aggregation, weightId, denominatorId, rollup, autoRound }
  const numericOpts = getNumericPropertyOptions(_propertyEditId);
  const denomOpts   = getDenominatorPropertyOptions(_propertyEditId);
  if (kind === 'numeric') {
    const aggSel = `
      <select id="property-aggregation" onchange="onPropertyAggregationChange(this.value)">
        ${NUMERIC_AGGREGATIONS.map(a => `<option value="${a}"${a === opts.aggregation ? ' selected' : ''}>${esc(t('properties.agg_' + a))}</option>`).join('')}
      </select>`;
    const showWeight = opts.aggregation === 'weighted_average';
    const weightSelect = `
      <div class="form-group" id="property-weight-group" style="${showWeight ? '' : 'display:none'}">
        <label>${t('properties.weight_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('properties.weight_help')}</p>
        ${_propertyRefSelect('property-weight', numericOpts, opts.weightId, t('properties.ref_pick_placeholder'))}
      </div>`;
    const autoRoundBlock = `
      <div class="form-group">
        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="property-auto-round"${opts.autoRound ? ' checked' : ''} style="margin:0">
          <span>${t('properties.auto_round_label')}</span>
        </label>
        <p class="text-dim" style="font-size:12px;margin-top:4px">${t('properties.auto_round_help')}</p>
      </div>`;
    return `
      <div class="form-group">
        <label>${t('properties.aggregation_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('properties.aggregation_help')}</p>
        ${aggSel}
      </div>
      ${weightSelect}
      ${autoRoundBlock}`;
  }
  if (kind === 'categorical') {
    return `
      <div class="form-group">
        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="property-rollup-distribution"${opts.rollup ? ' checked' : ''} style="margin:0">
          <span>${t('properties.rollup_distribution_label')}</span>
        </label>
        <p class="text-dim" style="font-size:12px;margin-top:4px">${t('properties.rollup_distribution_help')}</p>
      </div>
      ${_renderCategoryColorsEditor(opts.schema)}
    `;
  }
  if (kind === 'percentage') {
    return `
      <div class="form-group">
        <label>${t('properties.denominator_label')}</label>
        <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('properties.denominator_help')}</p>
        ${_propertyRefSelect('property-denominator', denomOpts, opts.denominatorId, t('properties.ref_pick_placeholder'))}
      </div>`;
  }
  return '';
}

// Category-colours editor (v0.12.1). Surfaces only in EDIT mode for
// a categorical schema — values are collected from existing plots +
// boundaries. The colour picker per value writes through to
// `schema.categoryColors`; the atlas renderer reads it for fills.
function _renderCategoryColorsEditor(schema) {
  if (!schema) {
    return `<div class="form-group"><p class="text-dim" style="font-size:12px">${t('properties.category_colors_save_first')}</p></div>`;
  }
  // Collect distinct values for this schema across plots + boundaries.
  const seen = new Map(); // value → count
  for (const p of (data.plots || [])) {
    const v = p.propertyValues?.[schema.id];
    if (v != null && v !== '') seen.set(String(v), (seen.get(String(v)) || 0) + 1);
  }
  for (const b of (data.boundaries || [])) {
    const v = b.propertyValues?.[schema.id];
    if (v != null && v !== '') seen.set(String(v), (seen.get(String(v)) || 0) + 1);
  }
  const values = Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(([v]) => v);
  if (values.length === 0) {
    return `<div class="form-group">
      <label>${t('properties.category_colors_label')}</label>
      <p class="text-dim" style="font-size:12px">${t('properties.category_colors_empty')}</p>
    </div>`;
  }
  const colors = (schema.categoryColors && typeof schema.categoryColors === 'object')
    ? schema.categoryColors : {};
  const rows = values.map(v => {
    const c = colors[v] || '#888888';
    const pickerHtml = colorPickerHTML(c, (color) => {
      onCategoryColorChange(schema.id, v, color);
    });
    return `
      <div class="category-color-row">
        ${pickerHtml}
        <span class="category-color-value">${esc(v)}</span>
        <span class="category-color-count text-dim">${seen.get(v)}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="form-group">
      <label>${t('properties.category_colors_label')}</label>
      <p class="text-dim" style="font-size:12px;margin-bottom:6px">${t('properties.category_colors_help')}</p>
      <div class="category-colors-list">${rows}</div>
    </div>
  `;
}

function onCategoryColorChange(schemaId, value, color) {
  const schema = (data.propertySchemas || []).find(s => s.id === schemaId);
  if (!schema) return;
  schema.categoryColors = schema.categoryColors || {};
  schema.categoryColors[value] = color;
  save();
}

// "Defined at" dropdown — single select of the boundary level where this
// property is normally recorded. Plot (the implicit lowest level) pins
// at the top; user-defined boundary types follow in hierarchy order
// (smallest containers first, matching the Boundary Types tab).
function _definedAtSelect(currentValue) {
  const types = (typeof boundaryTypesInHierarchyOrder === 'function')
    ? boundaryTypesInHierarchyOrder()
    : [];
  const current = currentValue || 'plot';
  const plotOpt = `<option value="plot"${current === 'plot' ? ' selected' : ''}>${t('properties.defined_at_plot')}</option>`;
  const typeOpts = types.map(bt =>
    `<option value="${esc(bt.id)}"${bt.id === current ? ' selected' : ''}>${esc(bt.name)}</option>`
  ).join('');
  return `<select id="property-defined-at">${plotOpt}${typeOpts}</select>`;
}

function _propertyRefSelect(id, numericOpts, currentValue, placeholderLabel) {
  if (numericOpts.length === 0) {
    return `<select id="${id}" disabled>
        <option value="">${esc(t('properties.ref_no_numerics'))}</option>
      </select>`;
  }
  // Virtual entries (e.g. Plot area) pin to the top with a "(computed)"
  // suffix so users can spot them; user-defined numerics follow,
  // alphabetical.
  const sorted = numericOpts.slice().sort((a, b) => {
    if (a.__virtual && !b.__virtual) return -1;
    if (!a.__virtual && b.__virtual) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  const options = sorted.map(p => {
    const label = p.__virtual
      ? `${p.name} ${t('properties.ref_computed_suffix')}`
      : p.name;
    return `<option value="${esc(p.id)}"${p.id === currentValue ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
  return `<select id="${id}">
      <option value=""${!currentValue ? ' selected' : ''}>${esc(placeholderLabel)}</option>
      ${options}
    </select>`;
}

function onPropertyKindChange(kind) {
  const container = document.getElementById('property-kind-fields');
  if (!container) return;
  // When the user toggles kinds we discard any in-progress fields for the
  // previous kind (their state lives in DOM only). That's fine: switching
  // kind in the add modal is a rare action and the alternative would be
  // building a parallel state object just to round-trip values you may
  // not want.
  container.innerHTML = _renderPropertyKindFields(kind, {
    aggregation: 'sum',
    weightId: '',
    denominatorId: '',
    rollup: false,
  });
}

function onPropertyAggregationChange(aggregation) {
  const grp = document.getElementById('property-weight-group');
  if (!grp) return;
  grp.style.display = aggregation === 'weighted_average' ? '' : 'none';
}

function saveProperty() {
  const nameEl = document.getElementById('property-name');
  const unitEl = document.getElementById('property-unit');
  const kindEl = document.getElementById('property-kind');
  const notesEl = document.getElementById('property-notes');
  if (!nameEl || !kindEl) return;

  const name = nameEl.value.trim();
  const unit = (unitEl?.value || '').trim();
  const kind = kindEl.value;
  const notes = (notesEl?.value || '').trim();

  if (!name) {
    toast(t('properties.error_name_empty'), 'error');
    return;
  }
  if (!PROPERTY_KINDS.includes(kind)) {
    toast(t('properties.error_kind_invalid'), 'error');
    return;
  }
  const dup = (data.propertySchemas || []).find(p =>
    p.name.toLowerCase() === name.toLowerCase() && p.id !== _propertyEditId
  );
  if (dup) {
    toast(t('properties.error_name_duplicate', { name }), 'error');
    return;
  }

  // Kind-specific field collection + validation.
  let aggregation = null;
  let weightPropertyId = null;
  let denominatorPropertyId = null;
  let rollupDistribution = false;
  let autoRound = false;
  // Common across all kinds: which level this property is defined at.
  // Empty / unknown id falls back to 'plot'.
  const rootLevelId = document.getElementById('property-defined-at')?.value || 'plot';

  if (kind === 'numeric') {
    aggregation = document.getElementById('property-aggregation')?.value || 'sum';
    autoRound = !!document.getElementById('property-auto-round')?.checked;
    if (!NUMERIC_AGGREGATIONS.includes(aggregation)) {
      toast(t('properties.error_aggregation_invalid'), 'error');
      return;
    }
    if (aggregation === 'weighted_average') {
      weightPropertyId = document.getElementById('property-weight')?.value || null;
      if (!weightPropertyId) {
        toast(t('properties.error_weight_required'), 'error');
        return;
      }
      if (weightPropertyId === _propertyEditId) {
        toast(t('properties.error_weight_self'), 'error');
        return;
      }
      const weightProp = findPropertySchema(weightPropertyId);
      if (!weightProp || weightProp.kind !== 'numeric') {
        toast(t('properties.error_weight_not_numeric'), 'error');
        return;
      }
      if (_hasPropertyRefCycle(_propertyEditId, weightPropertyId)) {
        toast(t('properties.error_cycle'), 'error');
        return;
      }
    }
  } else if (kind === 'categorical') {
    rollupDistribution = !!document.getElementById('property-rollup-distribution')?.checked;
  } else if (kind === 'percentage') {
    denominatorPropertyId = document.getElementById('property-denominator')?.value || null;
    if (!denominatorPropertyId) {
      toast(t('properties.error_denominator_required'), 'error');
      return;
    }
    if (denominatorPropertyId === _propertyEditId) {
      toast(t('properties.error_denominator_self'), 'error');
      return;
    }
    const denomProp = findPropertySchema(denominatorPropertyId);
    if (!denomProp || (denomProp.kind !== 'numeric' && denomProp.kind !== 'percentage')) {
      toast(t('properties.error_denominator_invalid'), 'error');
      return;
    }
    if (_hasPropertyRefCycle(_propertyEditId, denominatorPropertyId)) {
      toast(t('properties.error_cycle'), 'error');
      return;
    }
  }

  if (_propertyEditId) {
    const schema = findPropertySchema(_propertyEditId);
    if (schema) {
      schema.name = name;
      schema.unit = unit;
      schema.notes = notes;
      schema.rootLevelId = rootLevelId;
      // Kind is locked on edit; we leave schema.kind alone.
      if (schema.kind === 'numeric') {
        schema.aggregation = aggregation;
        schema.weightPropertyId = aggregation === 'weighted_average' ? weightPropertyId : null;
        schema.autoRound = autoRound;
      } else if (schema.kind === 'categorical') {
        schema.rollupDistribution = rollupDistribution;
      } else if (schema.kind === 'percentage') {
        schema.denominatorPropertyId = denominatorPropertyId;
      }
    }
  } else {
    createPropertySchema({
      name, unit, kind, notes,
      aggregation, weightPropertyId,
      rollupDistribution,
      denominatorPropertyId,
      autoRound,
      rootLevelId,
    });
  }

  save();
  closeModal();
  renderProperties();
  renderDashboard();
  toast(_propertyEditId ? t('properties.updated_toast', { name }) : t('properties.created_toast', { name }), 'success');
  _propertyEditId = null;
}

function deleteProperty(id) {
  const schema = findPropertySchema(id);
  if (!schema) return;
  const dependents = findPropertyDependents(id);
  if (dependents.length > 0) {
    toast(t('properties.error_has_dependents', {
      name: schema.name,
      deps: dependents.map(d => d.name).join(', ')
    }), 'error');
    return;
  }
  appConfirm(t('properties.confirm_delete', { name: schema.name }), () => {
    deletePropertySchema(id);
    save();
    toast(t('properties.deleted_toast', { name: schema.name }), 'success');
    renderProperties();
    renderDashboard();
  });
}

// ============================================================
// PLOT SPLIT OVERLAY (Brick 11)
// ============================================================
// Full-viewport takeover (#split-overlay in appymanager.html) — NOT a
// modal — so the map fills the screen. Layout: header bar on top with
// Cancel / title / Confirm; below it a 2-column grid (map on the
// left, info panel on the right). All cut edits trigger an immediate
// recompute; the panel updates live. No separate preview step.
//
// Cut editing (cut mode, contiguous plots):
//   • click empty map        → append a vertex
//   • click on cut polyline  → insert a vertex at the click position
//   • drag a vertex marker   → reposition live
//   • right-click a vertex   → remove
//   • clear-cut button       → wipes the cut
//   • Esc                    → close overlay (same as Cancel)
//
// Mode is auto-picked by plot geometry: contiguous → 'cut' (needs
// drawing); non-contiguous → 'component' (each polygon becomes its
// own piece; no drawing needed, preview shows immediately).
//
// User overrides on names + redistribution cells are tracked in
// `manualOverrides` so subsequent recomputes don't blow them away
// when the geometry changes slightly under a live drag.

let _splitState = null;
let _splitDraggingVertex = null; // truthy while a real vertex marker is being dragged
let _splitDraggingGhost = null;  // { vertexIdx } while a ghost marker is being dragged
let _splitHoverLatLng   = null;  // last cursor position on the split map (for the hover-preview line)
const _SPLIT_HOVER_PREVIEW_PX = 60; // hover-preview shows only this close to an endpoint (Brick 11b H.iii)

// Pixel distance between two [lat, lng] points on the split map.
function _latLngToContainerDistance(a, b) {
  if (!_splitMap) return Infinity;
  const pa = _splitMap.latLngToContainerPoint(L.latLng(a[0], a[1]));
  const pb = _splitMap.latLngToContainerPoint(L.latLng(b[0], b[1]));
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

function onPlotDetailSplit() {
  if (!_detailPlotId) return;
  const plot = data.plots.find(p => p.id === _detailPlotId);
  if (!plot) return;
  // closePlotDetail captures pending edits, nulls _detailPlotId,
  // tears down the detail map, and closes the modal — exactly what
  // we want before opening the takeover overlay.
  closePlotDetail();
  _initSplitState(plot);
  _openSplitOverlay();
}

function _initSplitState(plot) {
  _splitState = {
    plotId:          plot.id,
    // Brick 11b A.ii / #1: cuts is an array of polylines. The editor
    // targets cuts[activeCutIdx]; only the active cut's vertices,
    // ghosts and hover-preview are interactive (decision B.i).
    cuts:            [[]],
    activeCutIdx:    0,
    // Optional per-cut hover highlight (driven by the cuts list).
    hoverCutIdx:     null,
    // Piece indices currently being hovered in the panel — applied as
    // a thicker stroke on the map. Set by hovering a piece row (one
    // entry) or an output card (every piece in that bucket).
    hoverPieceIdxs:  null,
    // Phase 1: 'cut' — user draws / edits cut(s) and groups pieces.
    // Phase 2: 'override' — groupings locked, user edits per-output
    // names + property values.
    phase:           'cut',
    pieces:          null,
    cutInside:       null,
    // Brick 11b B.i: piece → output assignment. outputs[pieceIdx] is the
    // (zero-based) output bucket the piece belongs to. Default seeded in
    // _recomputeSplit when pieces are first computed (one output per piece).
    outputs:         [],
    // names + propertyValues + manualOverrides are keyed by OUTPUT index
    // (not piece index). manualOverrides keys are "outputIdx:schemaId".
    names:           [],
    propertyValues:  [],
    manualOverrides: new Set(),
    manualNames:     new Set(),
    status:          null,
    error:           null,
  };
}

function _splitPlot() {
  return _splitState ? data.plots.find(p => p.id === _splitState.plotId) : null;
}

// ----- Overlay open / close --------------------------------------------

function _openSplitOverlay() {
  const plot = _splitPlot();
  if (!plot) return;
  const overlay = document.getElementById('split-overlay');
  if (!overlay) return;

  document.getElementById('split-title').textContent = t('plot_split.title', {
    name: plot.name || t('plots.unnamed')
  });
  document.getElementById('split-panel').innerHTML = '';
  document.getElementById('split-status').textContent = '';
  document.getElementById('split-status').className = 'split-overlay-status';

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  ensureSplitMap('split-map', {
    onMapClick:      _onSplitMapClick,
    onCutLineClick:  _onSplitCutLineClick,
    onMapMouseMove:  _onSplitMapMouseMove,
    onMapMouseOut:   _onSplitMapMouseOut,
  });
  // Initial paint — also kicks off component mode's pieces immediately.
  _recomputeSplit();

  document.addEventListener('keydown', _onSplitKeyDown);
}

function closeSplitOverlay() {
  const overlay = document.getElementById('split-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _onSplitKeyDown);
  destroySplitMap();
  _splitState = null;
  _splitDraggingVertex = null;
  _splitDraggingGhost = null;
  _splitHoverLatLng = null;
}

function _onSplitKeyDown(e) {
  if (e.key === 'Escape') closeSplitOverlay();
}

// ----- Cut editing handlers --------------------------------------------

function _onSplitMapClick(e) {
  if (!_splitState || _splitState.phase !== 'cut') return;
  if (_splitDraggingVertex || _splitDraggingGhost) return;
  const verts = _splitState.cuts[_splitState.activeCutIdx];
  const click = [e.latlng.lat, e.latlng.lng];
  // Extend from whichever endpoint is closer. Trivial cases (≤ 1 vertex)
  // always append. This matches the hover-line preview, which always
  // points at the nearest endpoint.
  if (verts.length <= 1) {
    verts.push(click);
  } else {
    const dStart = _pointDistance(click, verts[0]);
    const dEnd   = _pointDistance(click, verts[verts.length - 1]);
    if (dStart < dEnd) verts.unshift(click);
    else               verts.push(click);
  }
  _recomputeSplit();
}

function _onSplitCutLineClick(e) {
  // Click on the cut polyline → insert a vertex at the closest segment.
  if (!_splitState || _splitState.phase !== 'cut') return;
  const verts = _splitState.cuts[_splitState.activeCutIdx];
  if (verts.length < 2) return;
  const click = [e.latlng.lat, e.latlng.lng];
  const idx = _findClosestSegment(click, verts);
  if (idx < 0) return;
  verts.splice(idx + 1, 0, click);
  L.DomEvent.stopPropagation(e);
  _recomputeSplit();
}

// Ghost (midpoint) markers — three callbacks. A *click* without drag
// inserts a vertex at the midpoint position. A *drag* inserts a vertex
// at dragstart and the same ghost icon serves as the live position
// indicator until release, so insert + position happen in one gesture.

function _onSplitGhostClick(segIdx, e) {
  if (!_splitState || _splitState.phase !== 'cut') return;
  const verts = _splitState.cuts[_splitState.activeCutIdx];
  if (segIdx < 0 || segIdx >= verts.length - 1) return;
  const a = verts[segIdx], b = verts[segIdx + 1];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  verts.splice(segIdx + 1, 0, mid);
  L.DomEvent.stopPropagation(e);
  _recomputeSplit();
}

function _onSplitGhostDragStart(segIdx, e) {
  if (!_splitState || _splitState.phase !== 'cut') return;
  const verts = _splitState.cuts[_splitState.activeCutIdx];
  if (segIdx < 0 || segIdx >= verts.length - 1) return;
  // Insert at the ghost's initial midpoint position. dragstart fires
  // before any latlng update, so e.target.getLatLng() === midpoint.
  const ll = e.target.getLatLng();
  const insertedAt = segIdx + 1;
  verts.splice(insertedAt, 0, [ll.lat, ll.lng]);
  _splitDraggingGhost = { vertexIdx: insertedAt };
  if (e.target._icon) e.target._icon.classList.add('dragging');
  drawSplitHoverLine(null, null);
}

function _onSplitGhostDrag(segIdx, e) {
  if (!_splitState || !_splitDraggingGhost) return;
  const ll = e.target.getLatLng();
  _splitState.cuts[_splitState.activeCutIdx][_splitDraggingGhost.vertexIdx] = [ll.lat, ll.lng];
  _recomputeSplit();
}

function _onSplitGhostDragEnd(segIdx, e) {
  if (!_splitState || !_splitDraggingGhost) return;
  const ll = e.target.getLatLng();
  _splitState.cuts[_splitState.activeCutIdx][_splitDraggingGhost.vertexIdx] = [ll.lat, ll.lng];
  if (e.target._icon) e.target._icon.classList.remove('dragging');
  _splitDraggingGhost = null;
  _recomputeSplit();
}

function _onSplitMapMouseMove(e) {
  if (!_splitState) return;
  if (_splitState.phase !== 'cut') {
    _splitHoverLatLng = null;
    drawSplitHoverLine(null, null);
    return;
  }
  if (_splitDraggingVertex || _splitDraggingGhost) {
    // Dragging provides its own visual; hide the hover line so it
    // doesn't double up.
    _splitHoverLatLng = null;
    drawSplitHoverLine(null, null);
    return;
  }
  _splitHoverLatLng = [e.latlng.lat, e.latlng.lng];
  _refreshSplitHoverLine();
}

function _onSplitMapMouseOut() {
  _splitHoverLatLng = null;
  drawSplitHoverLine(null, null);
}

function _refreshSplitHoverLine() {
  if (!_splitState || !_splitHoverLatLng) {
    drawSplitHoverLine(null, null);
    return;
  }
  const verts = _splitState.cuts[_splitState.activeCutIdx];
  if (!verts || verts.length === 0) {
    drawSplitHoverLine(null, null);
    return;
  }
  const start = verts[0];
  const end   = verts[verts.length - 1];
  let nearest = end;
  let nearestDist = _pointDistance(_splitHoverLatLng, end);
  if (verts.length > 1) {
    const dStart = _pointDistance(_splitHoverLatLng, start);
    if (dStart < nearestDist) { nearest = start; nearestDist = dStart; }
  }
  // Brick 11b H.iii: only show the preview when the cursor is actually
  // close to a cut endpoint, so the line doesn't drag across the whole
  // map every time the mouse moves.
  const px = _splitMap ? _latLngToContainerDistance(nearest, _splitHoverLatLng) : Infinity;
  if (px > _SPLIT_HOVER_PREVIEW_PX) {
    drawSplitHoverLine(null, null);
    return;
  }
  drawSplitHoverLine(nearest, _splitHoverLatLng);
}

function _onSplitVertexDragStart(i, e) {
  _splitDraggingVertex = e.target;
  if (e.target._icon) e.target._icon.classList.add('dragging');
}

function _onSplitVertexDrag(i, e) {
  if (!_splitState) return;
  // Use the marker's current position rather than e.latlng so this stays
  // consistent with _onSplitVertexDragEnd. Leaflet's `dragend` event has
  // no `latlng` field — accessing e.latlng there throws TypeError, which
  // would leave `_splitDraggingVertex` set and silently skip future vertex
  // renders (this was v0.7.2's "added node doesn't appear" bug).
  const ll = e.target.getLatLng();
  _splitState.cuts[_splitState.activeCutIdx][i] = [ll.lat, ll.lng];
  _recomputeSplit();
}

function _onSplitVertexDragEnd(i, e) {
  if (!_splitState) return;
  const ll = e.target.getLatLng();
  _splitState.cuts[_splitState.activeCutIdx][i] = [ll.lat, ll.lng];
  if (e.target._icon) e.target._icon.classList.remove('dragging');
  _splitDraggingVertex = null;
  _recomputeSplit();
}

function _onSplitVertexRemove(i, e) {
  if (!_splitState) return;
  L.DomEvent.stopPropagation(e);
  L.DomEvent.preventDefault(e);
  if (i < 0 || i >= _splitState.cuts[_splitState.activeCutIdx].length) return;
  _splitState.cuts[_splitState.activeCutIdx].splice(i, 1);
  _recomputeSplit();
}

function onSplitClearCut() {
  if (!_splitState) return;
  _splitState.cuts[_splitState.activeCutIdx] = [];
  _recomputeSplit();
}

// Append a new empty cut and make it active. Triggered by the "+ Cut"
// button in the cuts list.
function onSplitAddCut() {
  if (!_splitState) return;
  _splitState.cuts.push([]);
  _splitState.activeCutIdx = _splitState.cuts.length - 1;
  _splitDraggingVertex = null;
  _splitDraggingGhost = null;
  _splitHoverLatLng = null;
  _recomputeSplit();
}

// Switch the active cut. If the previously-active cut is empty
// (decision D), drop it on the way out so we don't accumulate ghosts.
function onSplitSetActiveCut(idx) {
  if (!_splitState) return;
  if (idx < 0 || idx >= _splitState.cuts.length) return;
  const cur = _splitState.activeCutIdx;
  if (cur !== idx && (_splitState.cuts[cur] || []).length === 0) {
    _splitState.cuts.splice(cur, 1);
    if (cur < idx) idx -= 1;
  }
  _splitState.activeCutIdx = idx;
  _splitState.hoverCutIdx = null;
  _splitDraggingVertex = null;
  _splitDraggingGhost = null;
  _splitHoverLatLng = null;
  _recomputeSplit();
}

// Delete a cut outright. Triggered by the per-cut "✕" in the list.
function onSplitDeleteCut(idx) {
  if (!_splitState) return;
  if (idx < 0 || idx >= _splitState.cuts.length) return;
  _splitState.cuts.splice(idx, 1);
  if (_splitState.cuts.length === 0) _splitState.cuts.push([]);
  if (_splitState.activeCutIdx >= _splitState.cuts.length) {
    _splitState.activeCutIdx = _splitState.cuts.length - 1;
  } else if (_splitState.activeCutIdx > idx) {
    _splitState.activeCutIdx -= 1;
  }
  _splitState.hoverCutIdx = null;
  _recomputeSplit();
}

// Highlight a cut on the map when the user hovers its row in the list.
function onSplitHoverCut(idx) {
  if (!_splitState) return;
  _splitState.hoverCutIdx = (idx === null || idx === undefined) ? null : idx;
  _refreshSplitMap();
}

// Highlight a single piece when the user hovers its row in the panel.
function onSplitHoverPiece(idx) {
  if (!_splitState) return;
  _splitState.hoverPieceIdxs = (idx === null || idx === undefined) ? null : [idx];
  _refreshSplitMap();
}

// Highlight every piece assigned to an output bucket when the user
// hovers that output's card (in either the cut or override phase).
function onSplitHoverOutput(outputIdx) {
  if (!_splitState) return;
  if (outputIdx === null || outputIdx === undefined) {
    _splitState.hoverPieceIdxs = null;
  } else {
    const idxs = [];
    for (let i = 0; i < (_splitState.outputs || []).length; i++) {
      if (_splitState.outputs[i] === outputIdx) idxs.push(i);
    }
    _splitState.hoverPieceIdxs = idxs.length ? idxs : null;
  }
  _refreshSplitMap();
}

// ----- Geometry helpers ------------------------------------------------

function _findClosestSegment(pt, vertices) {
  let bestIdx = -1, bestDist = Infinity;
  for (let i = 0; i < vertices.length - 1; i++) {
    const d = _pointSegmentDistance(pt, vertices[i], vertices[i + 1]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

function _pointDistance(a, b) {
  const dx = a[1] - b[1], dy = a[0] - b[0];
  return Math.sqrt(dx * dx + dy * dy);
}

function _pointSegmentDistance(pt, a, b) {
  // Euclidean in lat/lon — good enough for picking which segment
  // a click is closest to. (Real distance not needed; ranking is.)
  const dx = b[1] - a[1], dy = b[0] - a[0];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-20) {
    const dx0 = pt[1] - a[1], dy0 = pt[0] - a[0];
    return Math.sqrt(dx0 * dx0 + dy0 * dy0);
  }
  const t = Math.max(0, Math.min(1, ((pt[1] - a[1]) * dx + (pt[0] - a[0]) * dy) / lenSq));
  const cx = a[1] + t * dx, cy = a[0] + t * dy;
  const ddx = pt[1] - cx, ddy = pt[0] - cy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

// ----- Core update loop -------------------------------------------------

function _recomputeSplit() {
  const plot = _splitPlot();
  if (!plot) return;

  const result = computePlotSplit(plot, _splitState.cuts);

  if (!result.pieces || result.pieces.length === 0) {
    _splitState.pieces    = null;
    _splitState.cutInside = null;
    _splitState.status    = 'invalid';
    _splitState.error     = result.error || 'unknown';
    _refreshSplitMap();
    _refreshSplitPanel();
    _refreshSplitConfirmBtn();
    return;
  }

  const oldPieceCount = _splitState.pieces ? _splitState.pieces.length : 0;
  _splitState.pieces    = result.pieces;
  _splitState.cutInside = result.cutInside || null;
  _splitState.error     = null;
  // 'pending' = computed cleanly but only 1 piece → no actual split to
  // confirm. Single-piece contig + empty cut lands here; the panel
  // prompts to draw a cut. 'valid' = 2+ pieces and ready to commit.
  _splitState.status = result.pieces.length >= 2 ? 'valid' : 'pending';

  // Piece count changed → reset output assignments + names + values.
  // v0.11.2: pieces from rings the cut(s) didn't touch stay GROUPED
  // in one default output. Pieces from cut-affected rings each get
  // their own output, so the cut actually divides things. Without a
  // cut, every piece is untouched → all in one output.
  if (oldPieceCount !== result.pieces.length) {
    let nextOut = 1;
    const raw = result.pieces.map(p =>
      p.cutAffected ? nextOut++ : 0
    );
    _splitState.outputs         = _normalizeOutputs(raw);
    _splitState.names           = _defaultOutputNames(plot, _outputCount());
    _splitState.propertyValues  = result.pieces.map(() => ({}));
    _splitState.manualOverrides = new Set();
    _splitState.manualNames     = new Set();
  }
  _reseedProposedValues(plot);

  _refreshSplitMap();
  _refreshSplitPanel();
  _refreshSplitConfirmBtn();
}

// Number of distinct output buckets currently in use (== rendered cards
// / dropdown options).
function _outputCount() {
  if (!_splitState || !Array.isArray(_splitState.outputs)) return 0;
  return new Set(_splitState.outputs).size;
}

// Re-seeds proposed property values per output. Each output's seed
// area is the sum of its constituent pieces' land-areas (so the
// redistribution suggestion follows the user's grouping).
function _reseedProposedValues(plot) {
  if (!_splitState || !_splitState.pieces) return;
  const pieceAreas = _splitPieceLandAreas(_splitState.pieces);
  const outputs = _splitState.outputs;
  const nOutputs = _outputCount();
  if (nOutputs === 0) return;

  const outputAreas = new Array(nOutputs).fill(0);
  for (let i = 0; i < outputs.length; i++) {
    const k = outputs[i];
    outputAreas[k] = (outputAreas[k] || 0) + (pieceAreas[i] || 0);
  }
  const proposed = proposePlotSplitValues(plot, outputAreas);

  // Ensure propertyValues is sized to nOutputs.
  while (_splitState.propertyValues.length < nOutputs) _splitState.propertyValues.push({});
  _splitState.propertyValues.length = nOutputs;

  for (let k = 0; k < nOutputs; k++) {
    const obj = _splitState.propertyValues[k] || (_splitState.propertyValues[k] = {});
    for (const schemaId of Object.keys(obj)) {
      if (!_splitState.manualOverrides.has(`${k}:${schemaId}`) && !(schemaId in proposed)) {
        delete obj[schemaId];
      }
    }
    for (const [schemaId, vals] of Object.entries(proposed)) {
      if (vals[k] === undefined) continue;
      if (_splitState.manualOverrides.has(`${k}:${schemaId}`)) continue;
      obj[schemaId] = vals[k];
    }
  }
}

// Re-key outputs to dense [0, K-1] in order of first appearance,
// preserving the user's intent while keeping the storage indexed.
function _normalizeOutputs(outputs) {
  const seen = new Map();
  let next = 0;
  return outputs.map(k => {
    if (!seen.has(k)) seen.set(k, next++);
    return seen.get(k);
  });
}

// User changed a piece's output assignment via the per-piece dropdown.
// Value '__new__' creates a fresh output bucket.
function onSplitPieceOutputChange(pieceIdx, valueStr) {
  if (!_splitState || !_splitState.pieces) return;
  if (pieceIdx < 0 || pieceIdx >= _splitState.outputs.length) return;
  const plot = _splitPlot();
  if (!plot) return;
  let target;
  if (valueStr === '__new__') {
    target = _splitState.outputs.reduce((m, k) => Math.max(m, k), -1) + 1;
  } else {
    const n = Number(valueStr);
    if (!Number.isFinite(n)) return;
    target = n;
  }
  _splitState.outputs[pieceIdx] = target;
  _splitState.outputs = _normalizeOutputs(_splitState.outputs);
  // Re-grouping shifts what each output "is" — reset values + names,
  // then re-seed. (v1 simplification: manual overrides don't survive
  // a re-group; user can still rename freely afterwards.)
  const nOutputs = _outputCount();
  _splitState.names           = _defaultOutputNames(plot, nOutputs);
  _splitState.propertyValues  = Array.from({ length: nOutputs }, () => ({}));
  _splitState.manualOverrides = new Set();
  _splitState.manualNames     = new Set();
  _reseedProposedValues(plot);

  _refreshSplitMap();
  _refreshSplitPanel();
  _refreshSplitConfirmBtn();
}

function _defaultOutputNames(plot, n) {
  const base = plot.name || t('plots.unnamed');
  return Array.from({ length: n }, (_, i) => `${base} (${i + 1})`);
}

// Returns each piece's effective land area (m²) for use as the
// proportional-split basis in proposePlotSplitValues. Under any clipping
// mode the piece geometry is already land-only, so we trust `p.area`.
// Under 'combined' mode with a water cache we subtract the water
// intersection so a piece that's mostly lake doesn't take a
// disproportionate share of (e.g.) population. Falls back to p.area
// when there's no cache.
function _splitPieceLandAreas(pieces) {
  const mode = getSetting('landWaterMode', 'land_only_sea_water');
  const cache = data.waterCache;
  if (mode !== 'combined' || !cache || !cache.waterGeometry) {
    return pieces.map(p => p.area || 0);
  }
  return pieces.map(piece => {
    const total = piece.area || 0;
    if (total <= 0) return 0;
    try {
      const outer = piece.outer.slice();
      if (outer.length && (outer[0][0] !== outer[outer.length - 1][0] ||
                           outer[0][1] !== outer[outer.length - 1][1])) {
        outer.push([outer[0][0], outer[0][1]]);
      }
      const lngLat = [outer.map(([lat, lng]) => [lng, lat])];
      for (const h of (piece.holes || [])) {
        const ring = h.slice();
        if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] ||
                            ring[0][1] !== ring[ring.length - 1][1])) {
          ring.push([ring[0][0], ring[0][1]]);
        }
        lngLat.push(ring.map(([lat, lng]) => [lng, lat]));
      }
      const tp = turf.polygon(lngLat);
      const inter = turf.intersect(tp, cache.waterGeometry);
      const waterArea = inter ? turf.area(inter) : 0;
      return Math.max(0, total - waterArea);
    } catch (_) {
      return total;  // any turf hiccup → safe fallback to total area
    }
  });
}

// When a vertex is inserted at idx, override keys for pieces ≥ idx
// don't need updating (there's only ever 2 pieces in cut mode, and
// component mode doesn't insert). This is a placeholder for future
// per-piece override stability; today it's a no-op.
function _shiftManualOverrides(_atIdx, _delta) { /* reserved */ }

// ----- Map refresh -----------------------------------------------------

function _refreshSplitMap() {
  const plot = _splitPlot();
  if (!plot) return;
  const haveValidPieces = !!_splitState.pieces;
  drawSplitPlot(plot, haveValidPieces ? 'faded' : 'normal');
  if (haveValidPieces) drawSplitPieces(_splitState.pieces, _splitState.outputs, _splitState.hoverPieceIdxs);
  else clearSplitPieces();
  drawSplitCutPath(_splitState.cuts, _splitState.activeCutIdx, _splitState.cutInside, _splitState.hoverCutIdx);

  // Real vs ghost vertices live in separate layers (map.js) so we can
  // freeze whichever marker is being dragged while the other still
  // tracks the live geometry:
  //   • real-vertex drag → freeze real layer; redraw ghosts so the
  //     midpoint dots on adjacent segments follow the vertex live.
  //   • ghost drag       → freeze BOTH; the dragged ghost is also the
  //     live position indicator for the just-inserted vertex.
  //   • no drag          → redraw both.
  // Override phase has no editable cut, so both layers clear.
  if (_splitState.phase === 'cut') {
    if (!_splitDraggingVertex && !_splitDraggingGhost) {
      drawSplitRealVertices(_splitState.cuts[_splitState.activeCutIdx], {
        onDragStart: _onSplitVertexDragStart,
        onDrag:      _onSplitVertexDrag,
        onDragEnd:   _onSplitVertexDragEnd,
        onRemove:    _onSplitVertexRemove,
      });
    }
    if (!_splitDraggingGhost) {
      drawSplitGhostVertices(_splitState.cuts[_splitState.activeCutIdx], {
        onClick:     _onSplitGhostClick,
        onDragStart: _onSplitGhostDragStart,
        onDrag:      _onSplitGhostDrag,
        onDragEnd:   _onSplitGhostDragEnd,
      });
    }
    _refreshSplitHoverLine();
  } else {
    drawSplitRealVertices([], {});
    drawSplitGhostVertices([], {});
    drawSplitHoverLine(null, null);
  }
}

// ----- Panel refresh ---------------------------------------------------

function _refreshSplitPanel() {
  const panel = document.getElementById('split-panel');
  if (!panel) return;
  const plot = _splitPlot();
  if (!plot) return;

  if (_splitState.phase === 'override' && _splitState.pieces) {
    panel.innerHTML = _renderSplitPanelOverride(plot, _splitState);
  } else {
    panel.innerHTML = _renderSplitPanelCut(plot, _splitState);
  }

  _refreshSplitStatusBar();
}

function _renderSplitPanelCut(plot, state) {
  const valid = state.status === 'valid';
  let html = '';

  if (valid || state.status === 'pending') {
    // Pieces list with per-piece output dropdown (Brick 11b B.i).
    // Multiple pieces sharing an output bucket = "merge these into one
    // new plot". Each output gets its own colour so the map and panel
    // agree on the grouping at a glance.
    const nOutputs = _outputCount();
    const outputOpts = (currentOut) => {
      const opts = [];
      for (let k = 0; k < nOutputs; k++) {
        opts.push(`<option value="${k}"${k === currentOut ? ' selected' : ''}>${t('plot_split.output_n', { n: k + 1 })}</option>`);
      }
      opts.push(`<option value="__new__">${t('plot_split.output_new')}</option>`);
      return opts.join('');
    };
    const piecesHtml = state.pieces.map((piece, i) => {
      const outIdx = state.outputs[i] != null ? state.outputs[i] : 0;
      const color  = _SPLIT_PIECE_COLORS[outIdx % _SPLIT_PIECE_COLORS.length];
      const dropdown = nOutputs > 1 || state.pieces.length > 1
        ? `<select class="split-overlay-piece-output" data-output-idx="${i}" onchange="onSplitPieceOutputChange(${i}, this.value)">${outputOpts(outIdx)}</select>`
        : '';
      return `
        <div class="split-overlay-piece-row"
             onmouseenter="onSplitHoverPiece(${i})"
             onmouseleave="onSplitHoverPiece(null)">
          <span class="split-overlay-piece-swatch" style="background:${color}"></span>
          <span class="split-overlay-piece-area mono">${esc(formatArea(piece.area || 0))}</span>
          ${dropdown}
        </div>
      `;
    }).join('');
    html += `
      <div class="split-overlay-section">
        <div class="split-overlay-section-label">${t('plot_split.pieces_label')}</div>
        <div class="split-overlay-pieces-list">${piecesHtml}</div>
      </div>
    `;

    // Per-output cards (name + read-only proposed values).
    if (valid) {
      const outputCardsHtml = _renderSplitOutputSummaries(plot, state);
      html += `
        <div class="split-overlay-section">
          <div class="split-overlay-section-label">${t('plot_split.outputs_label')}</div>
          ${outputCardsHtml}
          <div class="split-overlay-hint-edit">${t('plot_split.proposed_hint')}</div>
        </div>
      `;
    } else {
      // Single-piece result = no actual split. Prompt the user.
      html += `
        <div class="split-overlay-section">
          <div class="split-overlay-warn">${t('plot_split.no_split_yet')}</div>
        </div>
      `;
    }
  } else if (state.error) {
    const code = state.error;
    const kind = (code === 'cut_does_not_cross') ? 'warn' : 'error';
    html += `
      <div class="split-overlay-section">
        <div class="split-overlay-${kind}">${t('plot_split.error_' + code)}</div>
      </div>
    `;
  }

  // Cuts list — click to switch active, hover to highlight, ✕ to delete.
  // The active cut shows a "Clear" button at the end of its row.
  const rows = state.cuts.map((c, i) => {
    const isActive = i === state.activeCutIdx;
    const color    = _SPLIT_CUT_COLORS[i % _SPLIT_CUT_COLORS.length];
    const vn       = (c || []).length;
    const cls      = 'split-cuts-row' + (isActive ? ' active' : '');
    const clearBtn = isActive && vn > 0
      ? `<button class="btn btn-xs" onclick="onSplitClearCut()" onmouseenter="event.stopPropagation()">${t('plot_split.clear_cut')}</button>`
      : '';
    return `
      <div class="${cls}"
           onclick="onSplitSetActiveCut(${i})"
           onmouseenter="onSplitHoverCut(${i})"
           onmouseleave="onSplitHoverCut(null)">
        <span class="split-overlay-piece-swatch" style="background:${color}"></span>
        <span class="split-cuts-name">${t('plot_split.cut_n', { n: i + 1 })}</span>
        <span class="split-cuts-vcount mono">${t('plot_split.cut_vertices', { n: vn })}</span>
        ${clearBtn}
        <button class="split-cuts-del" title="${esc(t('plot_split.delete_cut'))}"
                onclick="event.stopPropagation();onSplitDeleteCut(${i})"
                ${state.cuts.length === 1 && vn === 0 ? 'disabled' : ''}>✕</button>
      </div>
    `;
  }).join('');
  html += `
    <div class="split-overlay-section">
      <div class="split-overlay-section-label">${t('plot_split.cuts_label')}</div>
      <div class="split-cuts-list">${rows}</div>
      <div class="split-cuts-add">
        <button class="btn btn-sm" onclick="onSplitAddCut()">${t('plot_split.add_cut')}</button>
      </div>
      <div class="split-overlay-hint-edit">${t('plot_split.edit_hint')}</div>
    </div>
  `;

  return html;
}

// Per-output summary: name input + area + compact list of proposed
// stored values. Used in the cut phase below the pieces list.
function _renderSplitOutputSummaries(plot, state) {
  const nOutputs = _outputCount();
  const outputAreas = new Array(nOutputs).fill(0);
  for (let i = 0; i < state.pieces.length; i++) {
    outputAreas[state.outputs[i]] += state.pieces[i].area || 0;
  }
  const schemas = (data.propertySchemas || []).filter(s => {
    if (!appliesAtLevel(s, 'plot')) return false;
    if (isVirtualPropertyId(s.id)) return false;
    const v = getPlotPropertyValue(plot, s.id);
    return v !== undefined && v !== null && v !== '';
  });
  let html = '';
  for (let k = 0; k < nOutputs; k++) {
    const color = _SPLIT_PIECE_COLORS[k % _SPLIT_PIECE_COLORS.length];
    const propLines = schemas.map(schema => {
      const v = state.propertyValues[k] ? state.propertyValues[k][schema.id] : undefined;
      const txt = _renderSplitProposedValueText(schema, v);
      if (!txt) return '';
      return `<div class="split-output-prop"><span class="split-output-prop-name">${esc(schema.name)}</span><span class="split-output-prop-value mono">${txt}</span></div>`;
    }).filter(Boolean).join('');
    html += `
      <div class="split-output-summary"
           onmouseenter="onSplitHoverOutput(${k})"
           onmouseleave="onSplitHoverOutput(null)">
        <div class="split-output-summary-header">
          <span class="split-overlay-piece-swatch" style="background:${color}"></span>
          <input type="text" class="split-overlay-piece-name" value="${esc(state.names[k] || '')}" data-output-idx="${k}" oninput="onSplitNameInput(this)">
          <span class="split-overlay-piece-area mono">${esc(formatArea(outputAreas[k]))}</span>
        </div>
        ${propLines ? `<div class="split-output-summary-props">${propLines}</div>` : ''}
      </div>
    `;
  }
  return html;
}

// Lightweight stringifier for a proposed value (numeric / categorical /
// percentage) — read-only cut-phase display.
function _renderSplitProposedValueText(schema, v) {
  if (v === undefined || v === null || v === '') return '';
  if (schema.kind === 'percentage' && typeof v === 'object') {
    if (v.mode === 'raw')      return formatPropertyNumber(v.value);
    if (v.mode === 'percent')  return formatPropertyNumber(v.value) + '%';
    return '';
  }
  if (typeof v === 'number') return formatPropertyNumber(v);
  return esc(String(v));
}

function _renderSplitPanelOverride(plot, state) {
  // Per-output cards stacked vertically — one card per *output plot*,
  // not per *piece*. Two pieces grouped into one output show as a
  // single card whose area is their sum.
  const nOutputs = _outputCount();
  const outputAreas = new Array(nOutputs).fill(0);
  for (let i = 0; i < state.pieces.length; i++) {
    outputAreas[state.outputs[i]] += state.pieces[i].area || 0;
  }
  const schemas = (data.propertySchemas || []).filter(s => {
    if (!appliesAtLevel(s, 'plot')) return false;
    if (isVirtualPropertyId(s.id)) return false;
    const v = getPlotPropertyValue(plot, s.id);
    return v !== undefined && v !== null && v !== '';
  });
  const cards = [];
  for (let k = 0; k < nOutputs; k++) {
    const color = _SPLIT_PIECE_COLORS[k % _SPLIT_PIECE_COLORS.length];
    const propRowsHtml = schemas.map(schema => {
      const val = state.propertyValues[k] ? state.propertyValues[k][schema.id] : undefined;
      const unitChip = schema.unit ? ` <span class="split-unit-chip">${esc(schema.unit)}</span>` : '';
      return `
        <div class="split-override-prop-row">
          <label>${esc(schema.name)}${unitChip}</label>
          ${_renderSplitInputCell(schema, val, k)}
        </div>
      `;
    }).join('');
    cards.push(`
      <div class="split-override-piece"
           onmouseenter="onSplitHoverOutput(${k})"
           onmouseleave="onSplitHoverOutput(null)">
        <div class="split-override-piece-header">
          <span class="split-overlay-piece-swatch" style="background:${color}"></span>
          <input type="text" class="split-override-piece-name" value="${esc(state.names[k] || '')}" data-output-idx="${k}" oninput="onSplitNameInput(this)">
          <span class="split-override-piece-area mono">${esc(formatArea(outputAreas[k]))}</span>
        </div>
        ${propRowsHtml ? `<div class="split-override-piece-properties">${propRowsHtml}</div>` : ''}
      </div>
    `);
  }

  return `
    <div class="split-overlay-section">
      <button type="button" class="split-override-back" onclick="onSplitBack()">${t('plot_split.back_btn')}</button>
      <div class="split-overlay-hint-edit">${t('plot_split.override_intro')}</div>
    </div>
    <div class="split-override-pieces">${cards.join('')}</div>
  `;
}

function _refreshSplitStatusBar() {
  const status = document.getElementById('split-status');
  if (!status) return;
  let txt, cls = 'split-overlay-status';
  if (_splitState.phase === 'override') {
    txt = t('plot_split.status_override');
  } else if (_splitState.status === 'valid') {
    txt = t('plot_split.status_outputs', { n: _outputCount() });
  } else if (_splitState.status === 'pending') {
    txt = t('plot_split.status_pending');
    cls += ' split-overlay-status-warn';
  } else {
    const code = _splitState.error;
    txt = code ? t('plot_split.error_' + code) : t('plot_split.status_pending');
    cls += (code === 'cut_does_not_cross')
      ? ' split-overlay-status-warn'
      : ' split-overlay-status-error';
  }
  status.className = cls;
  status.textContent = txt;
}

function _refreshSplitConfirmBtn() {
  const btn = document.getElementById('split-confirm-btn');
  if (!btn) return;
  if (_splitState.phase === 'override') {
    btn.textContent = t('plot_split.confirm_btn');
    btn.disabled = false; // cut already validated to enter this phase
  } else {
    btn.textContent = t('plot_split.continue_btn');
    btn.disabled = _splitState.status !== 'valid';
  }
}

// ----- Phase transitions ------------------------------------------------

function onSplitPrimaryAction() {
  // Single header button — its meaning depends on phase.
  if (!_splitState) return;
  if (_splitState.phase === 'override') {
    onSplitConfirm();
  } else {
    onSplitContinue();
  }
}

function onSplitContinue() {
  if (!_splitState || _splitState.status !== 'valid') return;
  _splitState.phase = 'override';
  _refreshSplitPanel();
  _refreshSplitMap();
  _refreshSplitConfirmBtn();
}

function onSplitBack() {
  if (!_splitState) return;
  _splitState.phase = 'cut';
  _refreshSplitPanel();
  _refreshSplitMap();
  _refreshSplitConfirmBtn();
}

// Bundle the user's current grouping into one entry per output. Each
// entry is `{ pieces: [piece, ...] }` — executeSplit unions them.
function _splitOutputGroups() {
  const nOutputs = _outputCount();
  const groups = Array.from({ length: nOutputs }, () => ({ pieces: [] }));
  for (let i = 0; i < _splitState.pieces.length; i++) {
    const k = _splitState.outputs[i];
    if (groups[k]) groups[k].pieces.push(_splitState.pieces[i]);
  }
  return groups;
}

// ----- Per-piece value rendering (used by override-phase cards) --------

function _renderSplitInputCell(schema, val, outputIdx) {
  const base = `data-output-idx="${outputIdx}" data-schema-id="${esc(schema.id)}" data-kind="${schema.kind}"`;
  if (schema.kind === 'numeric') {
    const n = Number(val);
    const display = Number.isFinite(n) ? formatPropertyNumber(n) : '';
    return `<input type="number" step="any" class="split-cell-input" value="${esc(display)}" ${base} oninput="onSplitPropertyInput(this)">`;
  }
  if (schema.kind === 'categorical') {
    return `<input type="text" class="split-cell-input" value="${esc(val || '')}" ${base} oninput="onSplitPropertyInput(this)">`;
  }
  if (schema.kind === 'percentage') {
    const obj = (val && typeof val === 'object') ? val : { mode: 'percent', value: '' };
    const mode = obj.mode === 'raw' ? 'raw' : 'percent';
    const n = Number(obj.value);
    const display = Number.isFinite(n) ? formatPropertyNumber(n) : '';
    const denomSchema = findPropertySchema(schema.denominatorPropertyId);
    const suffix = mode === 'percent' ? '%' : (denomSchema?.unit || '');
    return `
      <span class="split-cell-pct">
        <input type="number" step="any" class="split-cell-input" value="${esc(display)}" ${base} data-mode="${mode}" oninput="onSplitPropertyInput(this)">
        ${suffix ? `<span class="split-cell-suffix">${esc(suffix)}</span>` : ''}
      </span>
    `;
  }
  return '';
}

function _splitFormatParentValue(schema, val) {
  if (schema.kind === 'numeric') {
    const n = Number(val);
    if (!Number.isFinite(n)) return '—';
    return formatPropertyNumber(n) + (schema.unit ? ' ' + schema.unit : '');
  }
  if (schema.kind === 'categorical') {
    return val ? String(val) : '—';
  }
  if (schema.kind === 'percentage') {
    if (typeof val !== 'object') return '—';
    const n = Number(val.value);
    if (!Number.isFinite(n)) return '—';
    if (val.mode === 'percent') return formatPropertyNumber(n) + '%';
    const denom = findPropertySchema(schema.denominatorPropertyId);
    return formatPropertyNumber(n) + (denom?.unit ? ' ' + denom.unit : '');
  }
  return '—';
}

// ----- Panel input handlers -------------------------------------------

function onSplitNameInput(inputEl) {
  if (!_splitState) return;
  const idx = parseInt(inputEl.dataset.outputIdx, 10);
  if (!Number.isFinite(idx)) return;
  _splitState.names[idx] = inputEl.value;
  _splitState.manualNames.add(idx);
}

function onSplitPropertyInput(inputEl) {
  if (!_splitState) return;
  const idx      = parseInt(inputEl.dataset.outputIdx, 10);
  const schemaId = inputEl.dataset.schemaId;
  const kind     = inputEl.dataset.kind;
  if (!Number.isFinite(idx) || !schemaId) return;
  const obj = _splitState.propertyValues[idx];
  if (!obj) return;
  const raw = inputEl.value;
  const overrideKey = `${idx}:${schemaId}`;
  _splitState.manualOverrides.add(overrideKey);

  if (raw === '' || raw == null) {
    delete obj[schemaId];
    return;
  }
  if (kind === 'numeric') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const schema = findPropertySchema(schemaId);
    obj[schemaId] = schema?.autoRound ? Math.round(n) : n;
    return;
  }
  if (kind === 'categorical') {
    obj[schemaId] = String(raw);
    return;
  }
  if (kind === 'percentage') {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const mode = inputEl.dataset.mode === 'raw' ? 'raw' : 'percent';
    obj[schemaId] = { mode, value: n };
    return;
  }
}

// ----- Commit ----------------------------------------------------------

function onSplitConfirm() {
  if (!_splitState || !_splitState.pieces) return;
  const plot = _splitPlot();
  if (!plot) { closeSplitOverlay(); return; }

  const newIds = executeSplit(
    plot,
    _splitOutputGroups(),
    _splitState.names,
    _splitState.propertyValues
  );
  if (!newIds || newIds.length < 2) {
    toast(t('plot_split.error_execute'), 'error');
    return;
  }
  const n = newIds.length;
  closeSplitOverlay();
  refreshAll();
  redrawMapPlots();
  toast(t('plot_split.success_toast', { n }), 'success');
}

// ============================================================
// ATLAS BROWSER (Brick 13)
// ============================================================
// Browses pages organised into user-defined nested categories. The
// tree is built implicitly from pages' `categoryPath: string[]`
// arrays — renaming a category cascades to every page whose path
// starts with that segment.

let _atlasState = {
  selectedPageId:     null,
  expandedCategories: new Set(['__root__']),
};

function renderAtlas() {
  const el = document.getElementById('atlas-content');
  if (!el) return;
  const pages = (data.dataAtlas && Array.isArray(data.dataAtlas.pages)) ? data.dataAtlas.pages : [];

  if (pages.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">▦</div>
        <h3>${t('atlas.empty_title')}</h3>
        <p>${t('atlas.empty_body')}</p>
        <button class="btn btn-primary" onclick="onAtlasNewPage()">+ ${t('atlas.new_page_btn')}</button>
      </div>`;
    return;
  }

  const tree = _buildAtlasTree(pages);
  const selectedPage = pages.find(p => p.id === _atlasState.selectedPageId);

  el.innerHTML = `
    <div class="atlas-layout">
      <aside class="atlas-tree">
        <div class="atlas-tree-actions">
          <button class="btn btn-sm btn-primary" onclick="onAtlasNewPage()">+ ${t('atlas.new_page_btn')}</button>
        </div>
        ${_renderAtlasTreeNode(tree, '__root__', 0)}
      </aside>
      <main class="atlas-viewer">
        ${selectedPage
          ? _renderAtlasPageView(selectedPage)
          : `<div class="atlas-viewer-empty">${t('atlas.pick_page_hint')}</div>`}
      </main>
    </div>
  `;

  if (selectedPage) _refreshAtlasViewerSVG();
}

function _buildAtlasTree(pages) {
  // Recursive structure: { name, children: Map<segment, node>, pages: page[] }
  const root = { name: '', children: new Map(), pages: [] };
  for (const page of pages) {
    let node = root;
    const path = Array.isArray(page.categoryPath) ? page.categoryPath : [];
    for (const seg of path) {
      const key = String(seg || '').trim();
      if (!key) continue;
      if (!node.children.has(key)) {
        node.children.set(key, { name: key, children: new Map(), pages: [] });
      }
      node = node.children.get(key);
    }
    node.pages.push(page);
  }
  return root;
}

function _renderAtlasTreeNode(node, key, depth) {
  // Sort categories alphabetically; pages by name.
  const catEntries = Array.from(node.children.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const pages = node.pages.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const expanded = _atlasState.expandedCategories.has(key);
  const isRoot   = key === '__root__';

  // Render the node header (only for non-root). Pages directly under
  // this node + sub-category headers render inside the body when open.
  const headerHtml = isRoot ? '' : `
    <div class="atlas-tree-cat-header" style="padding-left:${depth * 14 + 4}px"
         onclick="onAtlasToggleCategory('${esc(key)}')">
      <span class="atlas-tree-caret">${expanded ? '▾' : '▸'}</span>
      <span class="atlas-tree-cat-name">${esc(node.name)}</span>
      <button class="atlas-tree-rename"
        title="${esc(t('atlas.rename_category'))}"
        onclick="event.stopPropagation();onAtlasRenameCategory('${esc(key)}')">✎</button>
    </div>`;

  let bodyHtml = '';
  if (isRoot || expanded) {
    for (const [k, sub] of catEntries) {
      const childKey = isRoot ? k : `${key}/${k}`;
      bodyHtml += _renderAtlasTreeNode(sub, childKey, isRoot ? 0 : depth + 1);
    }
    for (const p of pages) {
      const sel = p.id === _atlasState.selectedPageId ? ' atlas-tree-page-active' : '';
      bodyHtml += `
        <div class="atlas-tree-page${sel}"
             style="padding-left:${(depth + (isRoot ? 0 : 1)) * 14 + 14}px"
             onclick="onAtlasSelectPage('${esc(p.id)}')">
          ${esc(p.name || t('atlas.untitled_page'))}
        </div>`;
    }
  }

  return headerHtml + (bodyHtml ? `<div class="atlas-tree-children">${bodyHtml}</div>` : '');
}

function onAtlasToggleCategory(key) {
  if (_atlasState.expandedCategories.has(key)) _atlasState.expandedCategories.delete(key);
  else _atlasState.expandedCategories.add(key);
  renderAtlas();
}

function onAtlasSelectPage(pageId) {
  _atlasState.selectedPageId = pageId;
  renderAtlas();
}

function onAtlasNewPage() {
  if (typeof createBlankAtlasPage !== 'function') return;
  const page = createBlankAtlasPage(t('atlas.new_page_default_name'));
  data.dataAtlas = data.dataAtlas || { pages: [] };
  data.dataAtlas.pages.push(page);
  save();
  // Send the user to the page builder to compose it.
  _pageBuilderState.editingId = page.id;
  switchTab('page-builder');
}

// Renames the rightmost segment of the path-key (e.g. 'Demographics/By Province'
// renames 'By Province' on every page whose path starts with
// ['Demographics', 'By Province']).
function onAtlasRenameCategory(pathKey) {
  if (!pathKey || pathKey === '__root__') return;
  const segments = pathKey.split('/');
  const last = segments[segments.length - 1];
  const newName = (window.prompt && window.prompt(t('atlas.rename_category_prompt'), last));
  if (newName == null) return;
  const trimmed = String(newName).trim();
  if (!trimmed || trimmed === last) return;

  const prefix = segments.slice();
  for (const page of (data.dataAtlas?.pages || [])) {
    const cp = Array.isArray(page.categoryPath) ? page.categoryPath : [];
    if (cp.length < prefix.length) continue;
    let matches = true;
    for (let i = 0; i < prefix.length; i++) {
      if (cp[i] !== prefix[i]) { matches = false; break; }
    }
    if (!matches) continue;
    page.categoryPath = cp.slice();
    page.categoryPath[prefix.length - 1] = trimmed;
  }
  save();
  // Refresh expanded set so the renamed category remains expanded.
  const oldKey = pathKey;
  const newKey = segments.slice(0, -1).concat([trimmed]).join('/');
  if (_atlasState.expandedCategories.has(oldKey)) {
    _atlasState.expandedCategories.delete(oldKey);
    _atlasState.expandedCategories.add(newKey);
  }
  renderAtlas();
}

function _renderAtlasPageView(page) {
  const path = (Array.isArray(page.categoryPath) ? page.categoryPath : []).join(' / ');
  return `
    <div class="atlas-viewer-header">
      <div>
        <h2 class="atlas-viewer-title">${esc(page.name || t('atlas.untitled_page'))}</h2>
        ${path ? `<div class="atlas-viewer-path">${esc(path)}</div>` : ''}
        ${page.description ? `<p class="atlas-viewer-desc">${esc(page.description)}</p>` : ''}
      </div>
      <div class="atlas-viewer-actions">
        <button class="btn btn-sm" onclick="onAtlasEditPage('${esc(page.id)}')">${t('atlas.edit_btn')}</button>
        <button class="btn btn-sm" onclick="onAtlasDuplicatePage('${esc(page.id)}')">${t('atlas.duplicate_btn')}</button>
        <button class="btn btn-sm btn-danger" onclick="onAtlasDeletePage('${esc(page.id)}')">${t('atlas.delete_btn')}</button>
      </div>
    </div>
    <div class="atlas-viewer-svg" id="atlas-viewer-svg"></div>
  `;
}

function _refreshAtlasViewerSVG() {
  const container = document.getElementById('atlas-viewer-svg');
  if (!container) return;
  const page = (data.dataAtlas?.pages || []).find(p => p.id === _atlasState.selectedPageId);
  if (!page) { container.innerHTML = ''; return; }
  if (typeof renderAtlasPage === 'function') renderAtlasPage(page, container);
}

function onAtlasEditPage(pageId) {
  _pageBuilderState.editingId = pageId;
  switchTab('page-builder');
}

function onAtlasDuplicatePage(pageId) {
  const src = (data.dataAtlas?.pages || []).find(p => p.id === pageId);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.name = (src.name || '') + ' ' + t('atlas.copy_suffix');
  for (const layer of (copy.layers || [])) layer.id = uid();
  data.dataAtlas.pages.push(copy);
  save();
  _atlasState.selectedPageId = copy.id;
  renderAtlas();
}

function onAtlasDeletePage(pageId) {
  const page = (data.dataAtlas?.pages || []).find(p => p.id === pageId);
  if (!page) return;
  appConfirm(t('atlas.confirm_delete', { name: page.name || t('atlas.untitled_page') }), () => {
    data.dataAtlas.pages = data.dataAtlas.pages.filter(p => p.id !== pageId);
    if (_atlasState.selectedPageId === pageId) _atlasState.selectedPageId = null;
    if (_pageBuilderState.editingId === pageId) _pageBuilderState.editingId = null;
    save();
    renderAtlas();
  });
}

// ============================================================
// PAGE BUILDER (Brick 13)
// ============================================================
// Composes pages out of layer instructions. The page selector at the
// top lets the user switch between pages; everything below edits the
// currently-selected page. The SVG preview on the right re-renders on
// any state change (debounced).

let _pageBuilderState = {
  editingId:       null,
  selectedLayerId: null,
  refreshDebounce: null,
};

function renderPageBuilder() {
  const el = document.getElementById('page-builder-content');
  if (!el) return;
  if (typeof resetColorPickers === 'function') resetColorPickers();
  const pages = (data.dataAtlas && Array.isArray(data.dataAtlas.pages)) ? data.dataAtlas.pages : [];

  if (pages.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✎</div>
        <h3>${t('page_builder.empty_title')}</h3>
        <p>${t('page_builder.empty_body')}</p>
        <button class="btn btn-primary" onclick="onPageBuilderNewPage()">+ ${t('atlas.new_page_btn')}</button>
      </div>`;
    return;
  }

  if (!_pageBuilderState.editingId || !pages.find(p => p.id === _pageBuilderState.editingId)) {
    _pageBuilderState.editingId = pages[0].id;
    _pageBuilderState.selectedLayerId = null;
  }
  const page = pages.find(p => p.id === _pageBuilderState.editingId);

  const pageOpts = pages.slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(p => `<option value="${esc(p.id)}"${p.id === page.id ? ' selected' : ''}>${esc(p.name || t('atlas.untitled_page'))}</option>`)
    .join('');

  el.innerHTML = `
    <div class="page-builder-header">
      <select class="page-builder-page-select"
        onchange="onPageBuilderSelectPage(this.value)">${pageOpts}</select>
      <button class="btn btn-sm" onclick="onPageBuilderNewPage()">+ ${t('atlas.new_page_btn')}</button>
      <button class="btn btn-sm" onclick="onAtlasDuplicatePage('${esc(page.id)}')">${t('atlas.duplicate_btn')}</button>
      <button class="btn btn-sm btn-danger" onclick="onAtlasDeletePage('${esc(page.id)}')">${t('atlas.delete_btn')}</button>
    </div>
    <div class="page-builder-layout">
      <aside class="page-builder-sidebar">
        ${_renderPageBuilderMetadata(page)}
        ${_renderPageBuilderLayerList(page)}
        ${_renderPageBuilderLayerEditor(page)}
      </aside>
      <main class="page-builder-preview" id="page-builder-preview"></main>
    </div>
  `;
  _refreshPageBuilderPreview();
}

function _renderPageBuilderMetadata(page) {
  const catPath = Array.isArray(page.categoryPath) ? page.categoryPath.join(' / ') : '';
  const ext = page.extent && typeof page.extent === 'object' ? page.extent : null;
  return `
    <div class="pb-section">
      <h4>${t('page_builder.section_meta')}</h4>
      <label class="pb-row">
        <span>${t('page_builder.name')}</span>
        <input type="text" value="${esc(page.name || '')}"
          oninput="onPageBuilderEditMeta('name', this.value)">
      </label>
      <label class="pb-row">
        <span>${t('page_builder.category_path')}</span>
        <input type="text" value="${esc(catPath)}"
          placeholder="${t('page_builder.category_placeholder')}"
          oninput="onPageBuilderEditCategoryPath(this.value)">
      </label>
      <label class="pb-row">
        <span>${t('page_builder.description')}</span>
        <textarea rows="2" oninput="onPageBuilderEditMeta('description', this.value)">${esc(page.description || '')}</textarea>
      </label>
      <label class="pb-row">
        <span>${t('page_builder.extent')}</span>
        <select onchange="onPageBuilderToggleExtent(this.value)">
          <option value="auto"${page.extent === 'auto' ? ' selected' : ''}>${t('page_builder.extent_auto')}</option>
          <option value="explicit"${ext ? ' selected' : ''}>${t('page_builder.extent_explicit')}</option>
        </select>
      </label>
      ${ext ? `
        <div class="pb-extent-grid">
          ${['minLat','maxLat','minLng','maxLng'].map(k => `
            <label>
              <span>${k}</span>
              <input type="number" step="any" value="${ext[k] != null ? ext[k] : ''}"
                oninput="onPageBuilderEditExtent('${k}', this.value)">
            </label>
          `).join('')}
        </div>
      ` : ''}
      <label class="pb-row">
        <span>${t('page_builder.simplification')}</span>
        <input type="range" min="0" max="100" step="1"
          value="${Number(page.simplification) || 0}"
          oninput="onPageBuilderEditMeta('simplification', this.value, this)">
        <span class="mono" data-pb-simplification-readout>${Number(page.simplification) || 0}%</span>
      </label>
    </div>
  `;
}

function _renderPageBuilderLayerList(page) {
  const layers = Array.isArray(page.layers) ? page.layers : [];
  const rows = layers.map((layer, i) => {
    const sel = layer.id === _pageBuilderState.selectedLayerId ? ' pb-layer-row-active' : '';
    const kindLabel = t('page_builder.layer_kind_' + layer.kind) || layer.kind;
    const upDisabled   = i === 0 ? 'disabled' : '';
    const downDisabled = i === layers.length - 1 ? 'disabled' : '';
    return `
      <div class="pb-layer-row${sel}"
           onclick="onPageBuilderSelectLayer('${esc(layer.id)}')">
        <input type="checkbox" ${layer.visible !== false ? 'checked' : ''}
          onclick="event.stopPropagation()"
          onchange="onPageBuilderEditLayer('${esc(layer.id)}', 'visible', this.checked)">
        <span class="pb-layer-name">${esc(layer.name || kindLabel)}</span>
        <span class="pb-layer-kind">${esc(kindLabel)}</span>
        <button class="btn btn-xs" ${upDisabled}
          onclick="event.stopPropagation();onPageBuilderMoveLayer('${esc(layer.id)}', -1)">↑</button>
        <button class="btn btn-xs" ${downDisabled}
          onclick="event.stopPropagation();onPageBuilderMoveLayer('${esc(layer.id)}', 1)">↓</button>
        <button class="btn btn-xs btn-danger"
          onclick="event.stopPropagation();onPageBuilderDeleteLayer('${esc(layer.id)}')">✕</button>
      </div>
    `;
  }).join('');
  const addOpts = ATLAS_LAYER_KINDS.map(k => `<option value="${k}">${esc(t('page_builder.layer_kind_' + k))}</option>`).join('');
  return `
    <div class="pb-section">
      <h4>${t('page_builder.section_layers')}</h4>
      <div class="pb-layer-list">${rows || `<div class="text-dim" style="font-size:12px">${t('page_builder.no_layers')}</div>`}</div>
      <div class="pb-add-layer">
        <select id="pb-add-layer-kind">${addOpts}</select>
        <button class="btn btn-sm" onclick="onPageBuilderAddLayer()">+ ${t('page_builder.add_layer')}</button>
      </div>
    </div>
  `;
}

function _renderPageBuilderLayerEditor(page) {
  const layer = (page.layers || []).find(l => l.id === _pageBuilderState.selectedLayerId);
  if (!layer) return '';
  let kindFields = '';
  if (layer.kind === 'boundary_fill' || layer.kind === 'boundary_outline') {
    const typeOpts = (data.boundaryTypes || []).map(bt =>
      `<option value="${esc(bt.id)}"${bt.id === layer.typeId ? ' selected' : ''}>${esc(bt.name)}</option>`
    ).join('');
    kindFields += `
      <label class="pb-row">
        <span>${t('page_builder.boundary_type')}</span>
        <select onchange="onPageBuilderEditLayer('${esc(layer.id)}', 'typeId', this.value || null)">
          <option value="">${t('page_builder.boundary_type_none')}</option>
          ${typeOpts}
        </select>
      </label>
    `;
  }
  if (layer.kind === 'boundary_fill' || layer.kind === 'plot_fill') {
    kindFields += _renderPbFillEditor(layer);
  }
  if (layer.kind === 'boundary_fill' || layer.kind === 'boundary_outline' || layer.kind === 'plot_fill') {
    kindFields += _renderPbStrokeEditor(layer);
  }
  if (layer.kind === 'settlements') {
    kindFields += _renderPbSettlementsEditor(layer);
  }
  return `
    <div class="pb-section">
      <h4>${t('page_builder.section_layer_edit')}</h4>
      <label class="pb-row">
        <span>${t('page_builder.layer_name')}</span>
        <input type="text" value="${esc(layer.name || '')}"
          oninput="onPageBuilderEditLayer('${esc(layer.id)}', 'name', this.value)">
      </label>
      ${kindFields}
    </div>
  `;
}

function _renderPbFillEditor(layer) {
  const fill = layer.fill || { mode: 'static', color: '#475569' };
  const isProperty = fill.mode === 'property';
  // Schemas applicable to the layer's level.
  let schemaOpts = '';
  let levelId = null;
  if (layer.kind === 'plot_fill') levelId = 'plot';
  else if (layer.typeId) levelId = layer.typeId;
  if (levelId) {
    const schemas = (data.propertySchemas || []).filter(s => appliesAtLevel(s, levelId));
    // Add virtual Area too (it applies everywhere).
    const all = [_virtualAreaSchema(), ...schemas];
    schemaOpts = all.map(s =>
      `<option value="${esc(s.id)}"${s.id === fill.schemaId ? ' selected' : ''}>${esc(s.name)}</option>`
    ).join('');
  }
  return `
    <label class="pb-row">
      <span>${t('page_builder.fill_mode')}</span>
      <select onchange="onPageBuilderEditFillMode('${esc(layer.id)}', this.value)">
        <option value="static"${!isProperty ? ' selected' : ''}>${t('page_builder.fill_static')}</option>
        <option value="property"${isProperty ? ' selected' : ''}>${t('page_builder.fill_property')}</option>
      </select>
    </label>
    ${!isProperty ? `
      <label class="pb-row">
        <span>${t('page_builder.fill_color')}</span>
        ${colorPickerHTML(fill.color || '#475569', (c) => onPageBuilderEditFillField(layer.id, 'color', c))}
      </label>
    ` : `
      <label class="pb-row">
        <span>${t('page_builder.fill_property_schema')}</span>
        <select onchange="onPageBuilderEditFillField('${esc(layer.id)}', 'schemaId', this.value || null)">
          <option value="">${t('page_builder.fill_property_none')}</option>
          ${schemaOpts}
        </select>
      </label>
      ${_renderPbScaleEditor(layer)}
      ${_renderPbCategoryColorsEditor(layer)}
    `}
  `;
}

// If the selected property is categorical, surface the same per-category
// colour editor that lives in the Properties tab. Writes through to
// `schema.categoryColors`, so changes propagate to every page that
// fills by this schema.
function _renderPbCategoryColorsEditor(layer) {
  const fill = layer.fill || {};
  if (fill.mode !== 'property' || !fill.schemaId) return '';
  const schema = (typeof findPropertySchema === 'function') ? findPropertySchema(fill.schemaId) : null;
  if (!schema || schema.kind !== 'categorical') return '';
  // Collect distinct values for this schema across plots + boundaries
  // (same logic as _renderCategoryColorsEditor).
  const seen = new Map();
  for (const p of (data.plots || [])) {
    const v = p.propertyValues?.[schema.id];
    if (v != null && v !== '') seen.set(String(v), (seen.get(String(v)) || 0) + 1);
  }
  for (const b of (data.boundaries || [])) {
    const v = b.propertyValues?.[schema.id];
    if (v != null && v !== '') seen.set(String(v), (seen.get(String(v)) || 0) + 1);
  }
  const values = Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(([v]) => v);
  if (values.length === 0) {
    return `<div class="pb-row"><span>${t('properties.category_colors_label')}</span>
      <div class="text-dim" style="font-size:11px">${t('properties.category_colors_empty')}</div>
    </div>`;
  }
  const colors = (schema.categoryColors && typeof schema.categoryColors === 'object')
    ? schema.categoryColors : {};
  const rows = values.map(v => {
    const c = colors[v] || '#888888';
    const pickerHtml = colorPickerHTML(c, (color) => {
      onCategoryColorChange(schema.id, v, color);
      _refreshPageBuilderPreview();
    });
    return `
      <div class="category-color-row">
        ${pickerHtml}
        <span class="category-color-value">${esc(v)}</span>
        <span class="category-color-count text-dim">${seen.get(v)}</span>
      </div>
    `;
  }).join('');
  return `
    <div class="pb-row" style="align-items:flex-start">
      <span>${t('properties.category_colors_label')}</span>
      <div class="category-colors-list" style="flex:1;max-height:200px">${rows}</div>
    </div>
  `;
}

// Scale editor for property fills. Picks between viridis / sequential
// presets or a "Custom" stops editor. Custom stops are persisted on
// the layer's fill.scale as { kind: 'custom', stops: [{t, color}] }.
function _renderPbScaleEditor(layer) {
  const fill = layer.fill || {};
  // The scale only applies to numeric / percentage fills. Categorical
  // properties paint by per-category colour (see
  // _renderPbCategoryColorsEditor) so the scale picker is suppressed.
  const schema = fill.schemaId
    ? ((typeof findPropertySchema === 'function') ? findPropertySchema(fill.schemaId) : null)
    : null;
  if (schema && schema.kind === 'categorical') return '';
  const scale = fill.scale || { kind: 'viridis' };
  const kind = scale.kind || 'viridis';
  let stopsHtml = '';
  if (kind === 'custom') {
    const stops = Array.isArray(scale.stops) ? scale.stops : [];
    const rows = stops.map((s, i) => `
      <div class="pb-scale-stop">
        <input type="number" step="0.05" min="0" max="1" value="${s.t}"
          class="pb-scale-stop-t"
          oninput="onPageBuilderEditScaleStop('${esc(layer.id)}', ${i}, 't', this.value)">
        ${colorPickerHTML(s.color || '#888888', (c) => onPageBuilderEditScaleStop(layer.id, i, 'color', c))}
        <button class="btn btn-xs btn-danger" ${stops.length <= 2 ? 'disabled' : ''}
          onclick="onPageBuilderRemoveScaleStop('${esc(layer.id)}', ${i})">✕</button>
      </div>
    `).join('');
    stopsHtml = `
      <div class="pb-scale-stops">
        ${rows}
        <button class="btn btn-xs" onclick="onPageBuilderAddScaleStop('${esc(layer.id)}')">+ ${t('page_builder.scale_add_stop')}</button>
      </div>
    `;
  }
  return `
    <label class="pb-row">
      <span>${t('page_builder.fill_scale')}</span>
      <select onchange="onPageBuilderEditScaleKind('${esc(layer.id)}', this.value)">
        <option value="viridis"${kind === 'viridis' ? ' selected' : ''}>${t('page_builder.scale_viridis')}</option>
        <option value="sequential"${kind === 'sequential' ? ' selected' : ''}>${t('page_builder.scale_sequential')}</option>
        <option value="custom"${kind === 'custom' ? ' selected' : ''}>${t('page_builder.scale_custom')}</option>
      </select>
    </label>
    ${stopsHtml}
  `;
}

function _renderPbStrokeEditor(layer) {
  const s = layer.stroke || { color: '#0f1117', width: 1, opacity: 0.85 };
  return `
    <label class="pb-row">
      <span>${t('page_builder.stroke_color')}</span>
      ${colorPickerHTML(s.color || '#000000', (c) => onPageBuilderEditStroke(layer.id, 'color', c))}
    </label>
    <label class="pb-row">
      <span>${t('page_builder.stroke_width')}</span>
      <input type="number" step="0.1" min="0" value="${s.width != null ? s.width : 1}"
        oninput="onPageBuilderEditStroke('${esc(layer.id)}', 'width', this.value)">
    </label>
    <label class="pb-row">
      <span>${t('page_builder.stroke_opacity')}</span>
      <input type="range" min="0" max="1" step="0.05"
        value="${s.opacity != null ? s.opacity : 0.85}"
        oninput="onPageBuilderEditStroke('${esc(layer.id)}', 'opacity', this.value)">
    </label>
  `;
}

function _renderPbSettlementsEditor(layer) {
  const filterTypes = (layer.filter && Array.isArray(layer.filter.placeTypes)) ? layer.filter.placeTypes : [];
  const types = (typeof PLACE_TYPES !== 'undefined' && Array.isArray(PLACE_TYPES))
    ? PLACE_TYPES
    : ['city','town','village','suburb','hamlet','quarter','neighbourhood','isolated_dwelling','locality','borough'];
  const checks = types.map(pt => `
    <label class="pb-check">
      <input type="checkbox" ${filterTypes.includes(pt) ? 'checked' : ''}
        onchange="onPageBuilderTogglePlaceType('${esc(layer.id)}', '${esc(pt)}', this.checked)">
      ${esc(pt)}
    </label>
  `).join('');
  const style  = layer.style || {};
  const radius = style.radius != null ? Number(style.radius) : 4;
  const labels = !!style.labels;
  const labelSize = style.labelSize != null ? Number(style.labelSize) : 11;
  return `
    <div class="pb-row">
      <span>${t('page_builder.settlement_filter')}</span>
      <div class="pb-checks">${checks}</div>
      <div class="text-dim" style="font-size:11px;margin-top:4px">${t('page_builder.settlement_filter_hint')}</div>
    </div>
    <label class="pb-row">
      <span>${t('page_builder.settlement_radius')}</span>
      <input type="range" min="1" max="20" step="0.5" value="${radius}"
        oninput="onPageBuilderEditSettlementStyle('${esc(layer.id)}', 'radius', this.value, this)">
      <span class="mono" data-pb-radius-readout>${radius}px</span>
    </label>
    <label class="pb-row">
      <span>${t('page_builder.settlement_labels')}</span>
      <input type="checkbox" ${labels ? 'checked' : ''}
        onchange="onPageBuilderEditSettlementStyle('${esc(layer.id)}', 'labels', this.checked)">
    </label>
    <label class="pb-row" style="${labels ? '' : 'display:none'}" data-pb-label-size-row>
      <span>${t('page_builder.settlement_label_size')}</span>
      <input type="range" min="8" max="22" step="1" value="${labelSize}"
        oninput="onPageBuilderEditSettlementStyle('${esc(layer.id)}', 'labelSize', this.value, this)">
      <span class="mono" data-pb-label-size-readout>${labelSize}px</span>
    </label>
  `;
}

function onPageBuilderNewPage() {
  if (typeof createBlankAtlasPage !== 'function') return;
  const page = createBlankAtlasPage(t('atlas.new_page_default_name'));
  data.dataAtlas = data.dataAtlas || { pages: [] };
  data.dataAtlas.pages.push(page);
  _pageBuilderState.editingId = page.id;
  _pageBuilderState.selectedLayerId = null;
  save();
  renderPageBuilder();
}

function onPageBuilderSelectPage(pageId) {
  _pageBuilderState.editingId = pageId;
  _pageBuilderState.selectedLayerId = null;
  renderPageBuilder();
}

function _currentPbPage() {
  if (!_pageBuilderState.editingId) return null;
  return (data.dataAtlas?.pages || []).find(p => p.id === _pageBuilderState.editingId) || null;
}

function onPageBuilderEditMeta(field, value, inputEl) {
  const page = _currentPbPage();
  if (!page) return;
  if (field === 'simplification') {
    value = Math.max(0, Math.min(100, Number(value) || 0));
    // Live-update the inline readout without re-rendering the whole panel
    // (which would steal focus from the range thumb during drag).
    if (inputEl && inputEl.parentElement) {
      const out = inputEl.parentElement.querySelector('[data-pb-simplification-readout]');
      if (out) out.textContent = value + '%';
    }
  }
  page[field] = value;
  save();
  _refreshPageBuilderPreview();
}

function onPageBuilderEditCategoryPath(value) {
  const page = _currentPbPage();
  if (!page) return;
  page.categoryPath = String(value).split('/').map(s => s.trim()).filter(Boolean);
  save();
  // Don't re-render the whole panel (would steal focus); just save.
}

function onPageBuilderToggleExtent(value) {
  const page = _currentPbPage();
  if (!page) return;
  if (value === 'explicit') {
    const auto = (typeof _autoExtentForPage === 'function') ? _autoExtentForPage(page) : null;
    page.extent = auto || { minLat: -1, maxLat: 1, minLng: -1, maxLng: 1 };
  } else {
    page.extent = 'auto';
  }
  save();
  renderPageBuilder();
}

function onPageBuilderEditExtent(field, value) {
  const page = _currentPbPage();
  if (!page || typeof page.extent !== 'object') return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  page.extent[field] = n;
  save();
  _refreshPageBuilderPreview();
}

function onPageBuilderAddLayer() {
  const page = _currentPbPage();
  if (!page) return;
  const sel = document.getElementById('pb-add-layer-kind');
  const kind = sel ? sel.value : 'boundary_fill';
  if (!ATLAS_LAYER_KINDS.includes(kind)) return;
  const layer = createBlankAtlasLayer(kind);
  page.layers = page.layers || [];
  page.layers.push(layer);
  _pageBuilderState.selectedLayerId = layer.id;
  save();
  renderPageBuilder();
}

function onPageBuilderSelectLayer(layerId) {
  _pageBuilderState.selectedLayerId = layerId;
  renderPageBuilder();
}

function onPageBuilderEditLayer(layerId, field, value) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer) return;
  if (field === 'visible') value = !!value;
  layer[field] = value;
  save();
  // Some edits only affect the preview (visible, typeId) — rerendering the
  // sidebar would steal focus. Only refresh preview.
  if (field === 'name') { renderPageBuilder(); return; }
  _refreshPageBuilderPreview();
}

function onPageBuilderEditFillMode(layerId, mode) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer) return;
  layer.fill = layer.fill || {};
  layer.fill.mode = (mode === 'property') ? 'property' : 'static';
  if (layer.fill.mode === 'static' && !layer.fill.color) layer.fill.color = '#475569';
  if (layer.fill.mode === 'property' && !layer.fill.scale) layer.fill.scale = { kind: 'viridis' };
  save();
  renderPageBuilder();
}

function onPageBuilderEditFillField(layerId, field, value) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer || !layer.fill) return;
  layer.fill[field] = value;
  save();
  _refreshPageBuilderPreview();
}

function onPageBuilderEditScaleKind(layerId, kind) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer || !layer.fill) return;
  if (kind === 'custom') {
    // Initialise with a sensible 3-stop default so the user has
    // something to nudge.
    const prev = layer.fill.scale || {};
    layer.fill.scale = (Array.isArray(prev.stops) && prev.stops.length >= 2)
      ? { kind: 'custom', stops: prev.stops }
      : { kind: 'custom', stops: [
          { t: 0,    color: '#1f2937' },
          { t: 0.5,  color: '#c1272d' },
          { t: 1,    color: '#fdf6b2' },
        ] };
  } else {
    layer.fill.scale = { kind: (kind === 'sequential') ? 'sequential' : 'viridis' };
  }
  save();
  renderPageBuilder();
}

function onPageBuilderEditScaleStop(layerId, idx, field, value) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer || !layer.fill || !layer.fill.scale ||
      !Array.isArray(layer.fill.scale.stops)) return;
  const stop = layer.fill.scale.stops[idx];
  if (!stop) return;
  if (field === 't') {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    stop.t = Math.max(0, Math.min(1, n));
  } else {
    stop.color = String(value);
  }
  save();
  _refreshPageBuilderPreview();
}

function onPageBuilderAddScaleStop(layerId) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer || !layer.fill || !layer.fill.scale ||
      !Array.isArray(layer.fill.scale.stops)) return;
  // Drop the new stop in the middle of the largest gap so it's useful
  // by default rather than colliding with an existing stop.
  const sorted = layer.fill.scale.stops.slice().sort((a, b) => a.t - b.t);
  let bestGap = -1, gapStart = 0, gapEnd = 1;
  for (let i = 0; i < sorted.length - 1; i++) {
    const g = sorted[i + 1].t - sorted[i].t;
    if (g > bestGap) { bestGap = g; gapStart = sorted[i].t; gapEnd = sorted[i + 1].t; }
  }
  layer.fill.scale.stops.push({ t: (gapStart + gapEnd) / 2, color: '#888888' });
  save();
  renderPageBuilder();
}

function onPageBuilderRemoveScaleStop(layerId, idx) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer || !layer.fill || !layer.fill.scale ||
      !Array.isArray(layer.fill.scale.stops)) return;
  if (layer.fill.scale.stops.length <= 2) return;  // need at least 2
  layer.fill.scale.stops.splice(idx, 1);
  save();
  renderPageBuilder();
}

function onPageBuilderEditStroke(layerId, field, value) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer) return;
  layer.stroke = layer.stroke || {};
  if (field === 'width' || field === 'opacity') value = Number(value);
  layer.stroke[field] = value;
  save();
  _refreshPageBuilderPreview();
}

function onPageBuilderTogglePlaceType(layerId, pt, checked) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer) return;
  layer.filter = layer.filter || { placeTypes: [] };
  const set = new Set(layer.filter.placeTypes || []);
  if (checked) set.add(pt); else set.delete(pt);
  layer.filter.placeTypes = Array.from(set);
  save();
  _refreshPageBuilderPreview();
}

function onPageBuilderEditSettlementStyle(layerId, field, value, inputEl) {
  const page = _currentPbPage();
  if (!page) return;
  const layer = (page.layers || []).find(l => l.id === layerId);
  if (!layer) return;
  layer.style = layer.style || {};
  if (field === 'radius' || field === 'labelSize') {
    value = Number(value);
    layer.style[field] = value;
    // Live readout next to the slider (avoid re-rendering the panel,
    // which would steal focus from the range thumb during drag).
    if (inputEl && inputEl.parentElement) {
      const sel = field === 'radius' ? '[data-pb-radius-readout]' : '[data-pb-label-size-readout]';
      const out = inputEl.parentElement.querySelector(sel);
      if (out) out.textContent = value + 'px';
    }
  } else if (field === 'labels') {
    layer.style.labels = !!value;
    // Show/hide the label-size row without a full panel re-render.
    if (inputEl) {
      const sidebar = inputEl.closest('.page-builder-sidebar');
      const row = sidebar ? sidebar.querySelector('[data-pb-label-size-row]') : null;
      if (row) row.style.display = layer.style.labels ? '' : 'none';
    }
  } else {
    layer.style[field] = value;
  }
  save();
  _refreshPageBuilderPreview();
}

function onPageBuilderMoveLayer(layerId, delta) {
  const page = _currentPbPage();
  if (!page || !Array.isArray(page.layers)) return;
  const i = page.layers.findIndex(l => l.id === layerId);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= page.layers.length) return;
  const [moved] = page.layers.splice(i, 1);
  page.layers.splice(j, 0, moved);
  save();
  renderPageBuilder();
}

function onPageBuilderDeleteLayer(layerId) {
  const page = _currentPbPage();
  if (!page) return;
  page.layers = (page.layers || []).filter(l => l.id !== layerId);
  if (_pageBuilderState.selectedLayerId === layerId) _pageBuilderState.selectedLayerId = null;
  save();
  renderPageBuilder();
}

// Debounced SVG re-render of the page-builder preview pane. Cheap
// because rendering is a small DOM swap; the debounce just smooths
// rapid slider drags.
function _refreshPageBuilderPreview() {
  if (_pageBuilderState.refreshDebounce) {
    clearTimeout(_pageBuilderState.refreshDebounce);
    _pageBuilderState.refreshDebounce = null;
  }
  _pageBuilderState.refreshDebounce = setTimeout(() => {
    const page = _currentPbPage();
    const container = document.getElementById('page-builder-preview');
    if (!page || !container) return;
    if (typeof renderAtlasPage === 'function') renderAtlasPage(page, container);
  }, 180);
}
