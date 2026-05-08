// ============================================================
// MAP — Leaflet wrapper with OGF tile layer
// ============================================================
// The Map tab shows the geographic view: imported plot polygons with a
// click-to-select highlight. The data-stewardship surface lives in the
// table-driven views (Plots tab, plot-detail in Brick 3) — the map is
// purely a visualiser.
//
// A second, smaller Leaflet instance is created on demand inside the
// import modal to preview to-be-imported shapes before commit.

const OGF_TILE_URL = 'https://tile.opengeofiction.net/ogf-carto/{z}/{x}/{y}.png';
const OGF_OVERPASS_URL = 'https://overpass.opengeofiction.net/api/interpreter';

let _map = null;
let _mapTileLayer = null;
let _mapPlotLayer = null;

// Selection state — one item at a time (plot or boundary)
let _selectedItemKind = null;  // 'plot' | 'boundary' | null
let _selectedItemId   = null;

// ── Brick 6b/6c: hierarchical boundary view ──
// One displayed level at a time. Top-level: a dropdown picks a boundary
// type T → all boundaries of that type render filled, like the plot view.
// Double-click on a boundary drills in: the map switches to the *direct
// members* of that boundary (its sub-boundaries + any plots it directly
// contains). Each drill step descends one level. A breadcrumb above the
// dropdown lets you return to any ancestor view, including "All [type]".
const BOUNDARY_TYPE_PALETTE = [
  '#6f86d6', '#48b287', '#d97757', '#9b6dd0',
  '#d4a13d', '#3aa2c7', '#c763a3', '#7c8c5b'
];
let _mapBoundaryLayer    = null;        // single L.featureGroup for boundary polygons
let _mapCurrentTypeId    = null;        // type selected in dropdown (null = uninitialized → largest)
let _drillStack          = [];          // [{ boundaryId, name, typeId }, ...]
let _boundaryClickTimer  = null;        // single-click vs double-click guard

// Sentinel id for the synthetic "Plots" dropdown option.
const PLOTS_TYPE_SENTINEL = '__plots__';

function initMap() {
  const el = document.getElementById('map');
  if (!el) return;
  if (_map) { _map.invalidateSize(); redrawMap(); return; }

  _map = L.map(el, {
    center: [0, 0],
    zoom: 3,
    minZoom: 2,
    maxZoom: 19,
    worldCopyJump: true,
    // Brick 6b: dblclick on a boundary drills through; the default
    // dblclick-to-zoom would fight that. Users can still zoom via wheel
    // or the +/- control.
    doubleClickZoom: false
  });

  _mapTileLayer = L.tileLayer(OGF_TILE_URL, {
    maxZoom: 19,
    attribution: 'Tiles © <a href="https://opengeofiction.net">OpenGeofiction</a>'
  }).addTo(_map);

  _mapPlotLayer     = L.featureGroup().addTo(_map);
  _mapBoundaryLayer = L.featureGroup().addTo(_map);

  _map.on('click', () => {
    if (_selectedItemId !== null) _clearMapSelection();
  });

  const view = data.settings?.mapView;
  if (view && Number.isFinite(view.lat) && Number.isFinite(view.lng) && Number.isFinite(view.zoom)) {
    _map.setView([view.lat, view.lng], view.zoom);
  }

  _map.on('moveend zoomend', () => {
    const c = _map.getCenter();
    data.settings = data.settings || {};
    data.settings.mapView = { lat: c.lat, lng: c.lng, zoom: _map.getZoom() };
    save();
  });

  redrawMap();
}

// ============================================================
// PLOT STYLING (shared with detail map)
// ============================================================

function plotPolygonStyle(selected) {
  // Neutral slate so plots read as data on the map without competing
  // with the accent (which is reserved for UI affordances).
  return {
    color: selected ? '#1f2937' : '#475569',
    weight: selected ? 3 : 2,
    fillColor: '#475569',
    fillOpacity: selected ? 0.32 : 0.12,
  };
}

// Backwards-compat alias for any external callers that want to refresh
// the map after a data change.
function redrawMapPlots() { redrawMap(); }

// ============================================================
// PREVIEW MAP (inset, inside import modal)
// ============================================================
// A separate Leaflet instance lives on demand inside the import modal so
// the user can eyeball candidate shapes before commit, without leaving
// the table-driven Plots context.

let _previewMap = null;
let _previewLayer = null;

function ensurePreviewMap(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  if (_previewMap) {
    if (_previewMap._appyContainer === el) return _previewMap;
    destroyPreviewMap();
  }
  _previewMap = L.map(el, {
    center: [0, 0], zoom: 1, minZoom: 1, maxZoom: 19,
    zoomControl: true, attributionControl: false,
  });
  _previewMap._appyContainer = el;
  L.tileLayer(OGF_TILE_URL, { maxZoom: 19 }).addTo(_previewMap);
  _previewLayer = L.featureGroup().addTo(_previewMap);
  // Leaflet sizes against the container's bounding rect; modals layout
  // asynchronously, so refresh once the next frame settles.
  setTimeout(() => _previewMap && _previewMap.invalidateSize(), 50);
  return _previewMap;
}

function drawPreviewCandidates(candidates) {
  if (!_previewMap || !_previewLayer) return;
  _previewLayer.clearLayers();
  const all = L.latLngBounds([]);
  for (const c of candidates) {
    const polys = c.geometry?.polygons;
    if (!polys || !polys.length) continue;
    const rejected = !!c._rejected;
    const poly = L.polygon(polys, {
      color: rejected ? '#e0a855' : '#475569',
      weight: 2,
      dashArray: rejected ? '4,4' : null,
      fillColor: rejected ? '#e0a855' : '#475569',
      fillOpacity: 0.18,
    });
    poly.bindTooltip(c.name || `#${c.ogfRelationId}`);
    _previewLayer.addLayer(poly);
    all.extend(poly.getBounds());
  }
  if (all.isValid()) _previewMap.fitBounds(all, { padding: [10, 10] });
}

function destroyPreviewMap() {
  if (_previewLayer) { _previewLayer.clearLayers(); _previewLayer = null; }
  if (_previewMap) { _previewMap.remove(); _previewMap = null; }
}

// ============================================================
// DETAIL MAP (inset, inside the plot-detail modal — Brick 3)
// ============================================================
// Same pattern as the preview map but rendering a single committed
// plot. Used inside openPlotDetail so the user can eyeball the
// geometry without leaving the table-driven Plots context.

let _detailMap = null;
let _detailLayer = null;

function ensureDetailMap(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  if (_detailMap) {
    if (_detailMap._appyContainer === el) return _detailMap;
    destroyDetailMap();
  }
  _detailMap = L.map(el, {
    center: [0, 0], zoom: 1, minZoom: 1, maxZoom: 19,
    zoomControl: true, attributionControl: false,
  });
  _detailMap._appyContainer = el;
  L.tileLayer(OGF_TILE_URL, { maxZoom: 19 }).addTo(_detailMap);
  _detailLayer = L.featureGroup().addTo(_detailMap);
  setTimeout(() => _detailMap && _detailMap.invalidateSize(), 50);
  return _detailMap;
}

function drawDetailPlot(plot) {
  if (!_detailMap || !_detailLayer) return;
  _detailLayer.clearLayers();
  const geo = resolvePlotGeometry(plot);
  if (!geo.polygons.length) return;
  const poly = L.polygon(geo.polygons, plotPolygonStyle(false));
  _detailLayer.addLayer(poly);
  _detailMap.fitBounds(poly.getBounds(), { padding: [10, 10] });
}

function destroyDetailMap() {
  if (_detailLayer) { _detailLayer.clearLayers(); _detailLayer = null; }
  if (_detailMap) { _detailMap.remove(); _detailMap = null; }
}

// ============================================================
// HIERARCHICAL MAP RENDERING (Brick 6c)
// ============================================================
// Two view modes:
//   ROOT  — drill stack empty: map shows every boundary of the type
//           selected in the dropdown, rendered filled (the same visual
//           treatment as plots). With no boundary types defined we fall
//           back to the all-plots view.
//   DRILL — drill stack non-empty: map shows the *direct members* of the
//           top-of-stack boundary (sub-boundaries + plots it directly
//           contains). Sub-boundaries render filled in their own type's
//           color; plots render in the neutral plot style.
//
// Single-click selects an item → side panel. Double-click drills in.
// Plots are leaves — double-click does nothing extra.

function colorForBoundaryType(typeId) {
  const idx = data.boundaryTypes.findIndex(t => t.id === typeId);
  if (idx < 0) return '#888';
  return BOUNDARY_TYPE_PALETTE[idx % BOUNDARY_TYPE_PALETTE.length];
}

function boundaryFilledStyle(color, selected) {
  return {
    color,
    weight: selected ? 3.5 : 2,
    fillColor: color,
    fillOpacity: selected ? 0.35 : 0.18,
    lineJoin: 'round',
  };
}

// "Largest" = the type closest to the root of the primitiveId chain.
// Roots are types not pointed at by any other type. Multiple roots tie-break
// alphabetically.
function _typesLargestFirst() {
  const types = data.boundaryTypes;
  if (types.length === 0) return [];
  const pointedTo = new Set(types.map(t => t.primitiveId).filter(Boolean));
  const depth = new Map();
  for (const ty of types) if (!pointedTo.has(ty.id)) depth.set(ty.id, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const ty of types) {
      if (depth.has(ty.id)) continue;
      // ty is the primitive of some parent: depth = parent.depth + 1
      const parents = types.filter(p => p.primitiveId === ty.id);
      const ds = parents.map(p => depth.get(p.id)).filter(d => d !== undefined);
      if (ds.length > 0) {
        depth.set(ty.id, Math.min(...ds) + 1);
        changed = true;
      }
    }
  }
  return types.slice().sort((a, b) => {
    const da = depth.get(a.id) ?? 999;
    const db = depth.get(b.id) ?? 999;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
}

function _largestBoundaryTypeId() {
  return _typesLargestFirst()[0]?.id || null;
}

function _normalizeMapState() {
  // Drop drill-stack entries whose boundary has since been deleted.
  while (_drillStack.length > 0) {
    const top = _drillStack[_drillStack.length - 1];
    if (data.boundaries.some(b => b.id === top.boundaryId)) break;
    _drillStack.pop();
  }
  // Default the dropdown to the largest boundary type, or to "Plots" when
  // no boundary types exist yet.
  const isKnownType = _mapCurrentTypeId === PLOTS_TYPE_SENTINEL
    || data.boundaryTypes.some(t => t.id === _mapCurrentTypeId);
  if (!isKnownType) {
    _mapCurrentTypeId = _largestBoundaryTypeId() || PLOTS_TYPE_SENTINEL;
  }
}

function redrawMap() {
  if (!_map || !_mapPlotLayer || !_mapBoundaryLayer) return;
  _normalizeMapState();
  _mapPlotLayer.clearLayers();
  _mapBoundaryLayer.clearLayers();

  // Layer 0: dropdown's selected level (every boundary of that type, OR
  // every plot when the synthetic "Plots" option is picked).
  const drawnBoundaries = new Set();
  _renderRootLevel(drawnBoundaries);

  // Layers 1..N: drill stack stacked on top. Each drilled boundary
  // contributes its direct members — sub-boundaries in their own type
  // color, plots in the neutral plot style. Going deeper just keeps
  // adding levels; the parent boundaries stay visible underneath.
  for (const entry of _drillStack) {
    const parent = data.boundaries.find(b => b.id === entry.boundaryId);
    if (!parent) continue;
    for (const m of (parent.members || [])) {
      if (m.kind === 'plot') {
        const plot = data.plots.find(p => p.id === m.id);
        if (plot) _drawPlotPoly(plot);
      } else if (m.kind === 'boundary') {
        if (drawnBoundaries.has(m.id)) continue;
        const sub = data.boundaries.find(x => x.id === m.id);
        if (sub) {
          _drawBoundaryPoly(sub, colorForBoundaryType(sub.typeId));
          drawnBoundaries.add(sub.id);
        }
      }
    }
  }

  renderMapToolbar();
  renderMapSidePanel();
}

function _renderRootLevel(drawnBoundaries) {
  // No boundary types defined, or "Plots" picked from dropdown → flat plot view.
  if (_mapCurrentTypeId === PLOTS_TYPE_SENTINEL
      || data.boundaryTypes.length === 0
      || !_mapCurrentTypeId) {
    for (const plot of data.plots) _drawPlotPoly(plot);
    return;
  }
  const color = colorForBoundaryType(_mapCurrentTypeId);
  for (const b of data.boundaries) {
    if (b.typeId !== _mapCurrentTypeId) continue;
    _drawBoundaryPoly(b, color);
    drawnBoundaries.add(b.id);
  }
}

function _drawPlotPoly(plot) {
  const geo = resolvePlotGeometry(plot);
  if (!geo.polygons.length) return;
  const isSelected = _selectedItemKind === 'plot' && _selectedItemId === plot.id;
  const poly = L.polygon(geo.polygons, plotPolygonStyle(isSelected));
  poly._appyPlotId = plot.id;
  if (plot.name) poly.bindTooltip(plot.name);
  poly.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    _selectItem('plot', plot.id);
  });
  _mapPlotLayer.addLayer(poly);
}

function _drawBoundaryPoly(b, color) {
  const geom = resolveBoundaryGeometry(b);
  if (!geom || !geom.polygons.length) return;
  const isSelected = _selectedItemKind === 'boundary' && _selectedItemId === b.id;
  const poly = L.polygon(geom.polygons, boundaryFilledStyle(color, isSelected));
  poly._appyBoundaryId = b.id;
  poly.bindTooltip(b.name || `(${getBoundaryTypeName(b.typeId)})`);
  poly.on('click',    (e) => onBoundaryPolyClick(e, b));
  poly.on('dblclick', (e) => onBoundaryPolyDblClick(e, b.id));
  _mapBoundaryLayer.addLayer(poly);
}

function onBoundaryPolyClick(e, b) {
  L.DomEvent.stopPropagation(e);
  // Defer single-click so an in-flight dblclick can cancel it (drilling
  // shouldn't flash the selection before the drill takes effect).
  if (_boundaryClickTimer) return;
  const bId = b.id;
  _boundaryClickTimer = setTimeout(() => {
    _boundaryClickTimer = null;
    _selectItem('boundary', bId);
  }, 240);
}

function onBoundaryPolyDblClick(e, boundaryId) {
  L.DomEvent.stopPropagation(e);
  L.DomEvent.preventDefault(e);
  if (_boundaryClickTimer) { clearTimeout(_boundaryClickTimer); _boundaryClickTimer = null; }
  drillIntoBoundary(boundaryId);
}

// ============================================================
// SELECTION & SIDE PANEL
// ============================================================

function _selectItem(kind, id) {
  _selectedItemKind = kind;
  _selectedItemId   = id;
  redrawMap();
}

function _clearMapSelection() {
  _selectedItemKind = null;
  _selectedItemId   = null;
  redrawMap();
}

// Returns the chain of ancestor boundaries from direct parent upward.
// chain[0] = direct parent, chain[1] = grandparent, etc.
function _getAncestorChain(kind, id) {
  const chain = [];
  let curKind = kind, curId = id;
  while (true) {
    const parent = findClaimingBoundary(curKind, curId, null);
    if (!parent) break;
    chain.push(parent);
    curKind = 'boundary';
    curId   = parent.id;
  }
  return chain;
}

function _renderMemberships(kind, id) {
  const ancestors = _getAncestorChain(kind, id);
  if (ancestors.length === 0) {
    return `<div class="map-panel-membership-none">No parent boundary</div>`;
  }
  let html = `<div class="map-panel-section">Membership</div>`;
  ancestors.forEach((b, i) => {
    const typeName = getBoundaryTypeName(b.typeId);
    const color    = colorForBoundaryType(b.typeId);
    const label    = i === 0 ? 'Direct member of' : 'Also within';
    html += `
      <div class="map-panel-membership">
        <span class="map-panel-member-label">${label}</span>
        <a class="map-panel-member-link" onclick="openBoundaryDetail('${esc(b.id)}')">
          <span class="map-panel-member-type" style="background:${color}">${esc(typeName)}</span>
          ${b.name ? esc(b.name) : '<em>Unnamed</em>'}
        </a>
      </div>`;
  });
  return html;
}

function renderMapSidePanel() {
  const el = document.getElementById('map-side-panel');
  if (!el) return;

  // If the selected item was deleted, clear stale selection silently.
  if (_selectedItemId) {
    const exists = _selectedItemKind === 'boundary'
      ? data.boundaries.some(x => x.id === _selectedItemId)
      : data.plots.some(x => x.id === _selectedItemId);
    if (!exists) { _selectedItemKind = null; _selectedItemId = null; }
  }

  if (!_selectedItemId) {
    const wasVisible = el.style.display !== 'none';
    el.style.display = 'none';
    if (wasVisible) setTimeout(() => _map && _map.invalidateSize(), 0);
    return;
  }

  const wasHidden = el.style.display === 'none';
  el.style.display = '';
  if (wasHidden) setTimeout(() => _map && _map.invalidateSize(), 0);

  let html = '';

  if (_selectedItemKind === 'boundary') {
    const b = data.boundaries.find(x => x.id === _selectedItemId);
    if (!b) { el.style.display = 'none'; return; }
    const typeName = getBoundaryTypeName(b.typeId);
    const color    = colorForBoundaryType(b.typeId);
    const area     = formatArea(boundaryArea(b));
    html = `
      <div class="map-panel-inner">
        <div class="map-panel-hdr">
          <span class="map-popup-type" style="background:${color}">${esc(typeName)}</span>
          <button class="map-panel-close" onclick="_clearMapSelection()" title="Deselect">✕</button>
        </div>
        <div class="map-panel-field">
          <label class="map-panel-label">Name</label>
          <input class="input map-panel-input" value="${esc(b.name || '')}"
            onblur="_panelSaveName(this.value)" placeholder="Unnamed">
        </div>
        <div class="map-panel-meta">${area}</div>
        <div class="map-panel-field">
          <label class="map-panel-label">Notes</label>
          <textarea class="input map-panel-notes" onblur="_panelSaveNotes(this.value)"
            rows="3" placeholder="No notes">${esc(b.notes || '')}</textarea>
        </div>
        ${_renderMemberships('boundary', b.id)}
        <button class="btn btn-sm btn-primary" style="width:100%;margin-top:4px"
          onclick="openBoundaryDetail('${esc(b.id)}')">Open full details</button>
      </div>`;

  } else if (_selectedItemKind === 'plot') {
    const p = data.plots.find(x => x.id === _selectedItemId);
    if (!p) { el.style.display = 'none'; return; }
    const area = formatArea(plotArea(p));
    html = `
      <div class="map-panel-inner">
        <div class="map-panel-hdr">
          <span class="map-popup-type map-popup-type-plot">Plot</span>
          <button class="map-panel-close" onclick="_clearMapSelection()" title="Deselect">✕</button>
        </div>
        <div class="map-panel-field">
          <label class="map-panel-label">Name</label>
          <input class="input map-panel-input" value="${esc(p.name || '')}"
            onblur="_panelSaveName(this.value)" placeholder="Unnamed">
        </div>
        <div class="map-panel-meta">${area}</div>
        <div class="map-panel-field">
          <label class="map-panel-label">Notes</label>
          <textarea class="input map-panel-notes" onblur="_panelSaveNotes(this.value)"
            rows="3" placeholder="No notes">${esc(p.notes || '')}</textarea>
        </div>
        ${_renderMemberships('plot', p.id)}
        <button class="btn btn-sm btn-primary" style="width:100%;margin-top:4px"
          onclick="openPlotDetail('${esc(p.id)}')">Open full details</button>
      </div>`;
  }

  el.innerHTML = html;
}

function _panelSaveName(value) {
  if (_selectedItemKind === 'boundary') {
    const b = data.boundaries.find(x => x.id === _selectedItemId);
    if (!b) return;
    b.name = value.trim();
    // Keep drill stack label in sync
    for (const entry of _drillStack) {
      if (entry.boundaryId === b.id) entry.name = b.name || getBoundaryTypeName(b.typeId) || '?';
    }
    save();
    redrawMap();
  } else if (_selectedItemKind === 'plot') {
    const p = data.plots.find(x => x.id === _selectedItemId);
    if (!p) return;
    p.name = value.trim();
    save();
    redrawMap();
  }
}

function _panelSaveNotes(value) {
  if (_selectedItemKind === 'boundary') {
    const b = data.boundaries.find(x => x.id === _selectedItemId);
    if (b) { b.notes = value; save(); }
  } else if (_selectedItemKind === 'plot') {
    const p = data.plots.find(x => x.id === _selectedItemId);
    if (p) { p.notes = value; save(); }
  }
}

// ============================================================
// DRILL NAVIGATION
// ============================================================

function drillIntoBoundary(boundaryId) {
  const b = data.boundaries.find(x => x.id === boundaryId);
  if (!b) return;

  // Single drill chain: only extend the stack if this boundary is a direct
  // member of the current top. If it's at root level or unrelated, start
  // a fresh chain.
  if (_drillStack.length > 0) {
    const top  = _drillStack[_drillStack.length - 1];
    const topB = data.boundaries.find(x => x.id === top.boundaryId);
    const isDirectChild = topB && (topB.members || []).some(
      m => m.kind === 'boundary' && m.id === boundaryId
    );
    if (!isDirectChild) _drillStack = [];
  }

  _drillStack.push({
    boundaryId: b.id,
    name: b.name || getBoundaryTypeName(b.typeId) || '?',
    typeId: b.typeId,
  });
  redrawMap();

  // Fit viewport to the drilled boundary's own geometry only.
  try {
    const geom = resolveBoundaryGeometry(b);
    if (geom && geom.polygons.length) {
      const bounds = L.polygon(geom.polygons).getBounds();
      if (bounds.isValid()) _map.fitBounds(bounds, { padding: [20, 20] });
    }
  } catch (e) { /* geometry unavailable */ }
}

function drillBackTo(level) {
  _drillStack = _drillStack.slice(0, level);
  redrawMap();
  if (level === 0) {
    _fitMapToActiveLayers();
  } else {
    const entry = _drillStack[level - 1];
    const b = data.boundaries.find(x => x.id === entry?.boundaryId);
    if (b) {
      try {
        const geom = resolveBoundaryGeometry(b);
        if (geom && geom.polygons.length) {
          const bounds = L.polygon(geom.polygons).getBounds();
          if (bounds.isValid()) { _map.fitBounds(bounds, { padding: [20, 20] }); return; }
        }
      } catch (e) {}
    }
    _fitMapToActiveLayers();
  }
}

function onMapTypeChange(typeId) {
  _mapCurrentTypeId = typeId || null;
  _drillStack = [];
  redrawMap();
  _fitMapToActiveLayers();
}

function _fitMapToActiveLayers() {
  if (!_map) return;
  const bounds = L.latLngBounds([]);
  for (const layer of [_mapPlotLayer, _mapBoundaryLayer]) {
    if (!layer) continue;
    const b = layer.getBounds();
    if (b.isValid()) bounds.extend(b);
  }
  if (bounds.isValid()) _map.fitBounds(bounds, { padding: [20, 20] });
}

// ============================================================
// MAP TOOLBAR — breadcrumb + level dropdown
// ============================================================

function renderMapToolbar() {
  const el = document.getElementById('map-toolbar');
  if (!el) return;
  _normalizeMapState();

  // Breadcrumb: "All [largest-type] › Drilled-1 › Drilled-2 …"
  let breadcrumbHtml = '';
  if (_drillStack.length > 0) {
    const rootType = data.boundaryTypes.find(t => t.id === _mapCurrentTypeId);
    const rootLabel = rootType
      ? t('map.crumb_all_of', { type: esc(rootType.name) })
      : t('map.crumb_root');
    const parts = [`<a class="map-crumb-link" onclick="drillBackTo(0)">${rootLabel}</a>`];
    _drillStack.forEach((entry, i) => {
      const last = i === _drillStack.length - 1;
      const label = entry.name ? esc(entry.name) : '?';
      parts.push(last
        ? `<span class="map-crumb-current">${label}</span>`
        : `<a class="map-crumb-link" onclick="drillBackTo(${i + 1})">${label}</a>`);
    });
    breadcrumbHtml = `<div class="map-crumbs">${parts.join('<span class="map-crumb-sep">›</span>')}</div>`;
  }

  // Dropdown: boundary types (largest first) + a synthetic "Plots" entry
  // at the bottom. Always rendered as long as the project has plots or
  // boundary types — when neither exists we hide it.
  const types = _typesLargestFirst();
  const haveAny = types.length > 0 || data.plots.length > 0;
  let dropdownHtml = '';
  if (haveAny) {
    const typeOpts = types.map(ty =>
      `<option value="${esc(ty.id)}"${ty.id === _mapCurrentTypeId ? ' selected' : ''}>${esc(ty.name)}</option>`
    ).join('');
    const plotsSelected = _mapCurrentTypeId === PLOTS_TYPE_SENTINEL;
    const plotsOpt = `<option value="${PLOTS_TYPE_SENTINEL}"${plotsSelected ? ' selected' : ''}>${t('map.layer_plots')}</option>`;
    dropdownHtml = `
      <div class="map-toolbar-row">
        <label class="import-target-label">${t('map.show_label')}</label>
        <select onchange="onMapTypeChange(this.value)">${typeOpts}${plotsOpt}</select>
      </div>`;
  }

  el.innerHTML = breadcrumbHtml + dropdownHtml;
}

// Backwards-compat alias, in case anything still calls the old name.
function redrawMapBoundaries() { redrawMap(); }
