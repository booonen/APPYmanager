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
// PLOTS — read-only listing
// ============================================================
// Brick 2: simple table (Name, OGF Relation ID, Plot ID) + Import
// button. Sort/search/edit/delete and the row-click detail view all
// arrive in Brick 3.

function renderPlots() {
  const el = document.getElementById('plots-content');
  if (!el) return;
  const plots = data.plots;

  const head = `
    <div class="flex" style="justify-content:space-between;align-items:center;margin-bottom:16px">
      <button class="btn btn-primary" onclick="openImportModal()">+ ${t('plots.import_btn')}</button>
      <span class="text-dim" style="font-size:12px">${t('plots.count', { n: plots.length })}</span>
    </div>`;

  if (plots.length === 0) {
    el.innerHTML = head + `
      <div class="empty-state">
        <div class="empty-icon">▱</div>
        <h3>${t('plots.empty_title')}</h3>
        <p>${t('plots.empty_body')}</p>
        <button class="btn btn-primary" onclick="openImportModal()">+ ${t('plots.import_btn')}</button>
      </div>`;
    return;
  }

  const rows = plots.map(p => `
    <tr>
      <td>${p.name ? esc(p.name) : `<span class="text-muted">${t('plots.unnamed')}</span>`}</td>
      <td class="mono">${p.ogfRelationId != null ? p.ogfRelationId : '<span class="text-muted">—</span>'}</td>
      <td class="mono text-dim" style="font-size:12px">${esc(p.id)}</td>
    </tr>`).join('');

  el.innerHTML = head + `
    <table class="data-table">
      <thead>
        <tr>
          <th>${t('plots.col_name')}</th>
          <th>${t('plots.col_ogf_id')}</th>
          <th>${t('plots.col_plot_id')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
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

  addImportRow('area', { key: 'admin_level', value: '2' });
  addImportRow('import', { key: 'admin_level', value: '2' });

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
    toast(t('import.error_fetch', { msg: e.message }), 'error');
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
