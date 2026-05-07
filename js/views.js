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

  tbody.innerHTML = list.map(p => {
    const hasFlags = p.flags && p.flags.length > 0;
    const flagBadge = hasFlags ? ` <span class="plot-flag-badge" title="${p.flags.map(f => t('plot_detail.flag_' + f)).join('; ')}">⚠</span>` : '';
    const nameCell = (p.name ? esc(p.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`) + flagBadge;
    return `<tr class="row-click" onclick="openPlotDetail('${esc(p.id)}')">
      <td>${nameCell}</td>
      <td class="mono">${formatArea(plotArea(p))}</td>
      <td class="mono">${p.ogfRelationId != null ? p.ogfRelationId : '<span class="text-muted">—</span>'}</td>
    </tr>`;
  }).join('');

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
  const disabled = e.claimedElsewhere && !e.currentMember;
  const checked  = e.currentMember || _pickerSelected.has(key);
  const claimedTag = disabled
    ? ` <span class="boundary-picker-claimed">${t('boundary_picker.claimed_label')}</span>`
    : '';
  const nameDisplay = e.name
    ? esc(e.name)
    : `<span class="text-muted">${e.kind === 'plot' ? t('plots.unnamed') : t('boundaries.unnamed')}</span>`;
  return `<label class="boundary-picker-row${disabled ? ' disabled' : ''}${e.currentMember ? ' current' : ''}">
    <input type="checkbox"
      data-key="${esc(key)}"
      ${checked ? 'checked' : ''}
      ${disabled || e.currentMember ? 'disabled' : ''}
      onchange="onPickerToggle('${esc(key)}', this.checked)">
    <span>${nameDisplay}${claimedTag}</span>
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
  let added = 0;
  for (const key of _pickerSelected) {
    const [kind, id] = key.split(':');
    if (!(b.members || []).some(m => m.kind === kind && m.id === id)) {
      b.members = b.members || [];
      b.members.push({ kind, id });
      added++;
    }
  }
  if (added > 0) {
    save();
    toast(t('boundary_picker.added_toast', { n: added }), 'success');
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
  `;
}

function onSnapToleranceChange(val) {
  const n = Math.max(0, Math.round(Number(val) || 0));
  data.settings = data.settings || {};
  data.settings.snapToleranceM = n;
  save();
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

  if (plan.free.length > 0) {
    listHtml += `<div class="subdivide-section-label">${t('import.subdivide_free_section')}</div>`;
    listHtml += `<ul class="import-result-list">`;
    for (const c of plan.free) {
      listHtml += `<li><span class="import-result-mark ok">✓</span> ${c.name ? esc(c.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`}${c.ogfRelationId ? ` <span class="text-muted mono">#${c.ogfRelationId}</span>` : ''}</li>`;
    }
    listHtml += `</ul>`;
  }

  const commitBtn = plan.newPlotCount > 0
    ? `<div class="flex" style="justify-content:flex-end;margin-top:12px">
         <button class="btn btn-primary" onclick="runImportCommit()">${t('import.commit_btn', { n: plan.newPlotCount })}</button>
       </div>`
    : '';

  setImportPreviewHTML(`
    ${header}
    ${listHtml}
    <div id="import-preview-map" style="height:240px;margin-top:10px;border-radius:var(--radius);border:1px solid var(--border);overflow:hidden"></div>
    ${commitBtn}
  `);

  ensurePreviewMap('import-preview-map');
  drawPreviewCandidates(parsed.candidates);
}

function runImportCommit() {
  if (!_importPreview || !_importPreview._plan) return;
  const { _plan, nodes, ways } = _importPreview;
  if (_plan.newPlotCount === 0) return;

  executeSubdivisionPlan(_plan, nodes, ways);

  const splitCount = _plan.splits.length;
  const freeCount  = _plan.free.length;

  if (splitCount > 0) {
    toast(t('import.subdivided_toast', { split: splitCount, created: _plan.newPlotCount - freeCount }), 'success');
    if (freeCount > 0) toast(t('import.imported_toast', { n: freeCount }), 'success');
  } else {
    toast(t('import.imported_toast', { n: freeCount }), 'success');
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
