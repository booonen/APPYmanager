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
let _selectedPlotId = null;

// ── Brick 6b: per-type boundary layers + drill-through ──
// Each boundary type is its own toggleable Leaflet FeatureGroup, keyed by
// typeId. Visibility is sticky across tab switches via _visibleBoundaryTypes.
// Drill state: _drillStack holds the chain from root to the deepest
// drilled-into boundary; an empty stack = full project view.
const BOUNDARY_TYPE_PALETTE = [
  '#6f86d6', '#48b287', '#d97757', '#9b6dd0',
  '#d4a13d', '#3aa2c7', '#c763a3', '#7c8c5b'
];
const PLOTS_LAYER_COLOR = '#475569';
let _mapBoundaryLayers     = new Map(); // typeId → L.featureGroup
let _visibleBoundaryTypes  = null;      // Set<typeId> | null (null = uninitialized)
let _seenBoundaryTypeIds   = null;      // Set<typeId> — track which types we've already defaulted on
let _plotsLayerVisible     = true;
let _drillStack            = [];        // [{ boundaryId, name, typeId }, ...]
let _boundaryClickTimer    = null;      // single-click vs double-click guard

function initMap() {
  const el = document.getElementById('map');
  if (!el) return;
  if (_map) { _map.invalidateSize(); redrawMapPlots(); return; }

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

  _mapPlotLayer = L.featureGroup().addTo(_map);
  _map.on('click', () => {
    // Bare-map clicks deselect; clicks on plot polygons stop propagation.
    if (_selectedPlotId !== null) {
      _selectedPlotId = null;
      redrawMapPlots();
    }
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

  redrawMapPlots();
  redrawMapBoundaries();
  renderMapToolbar();
}

// ============================================================
// PLOT RENDERING
// ============================================================

function redrawMapPlots() {
  if (!_map || !_mapPlotLayer) return;
  _mapPlotLayer.clearLayers();
  const scope = _getDrillScope();
  for (const plot of data.plots) {
    if (scope && !scope.plotIds.has(plot.id)) continue;
    const geo = resolvePlotGeometry(plot);
    if (!geo.polygons.length) continue;
    const selected = plot.id === _selectedPlotId;
    const poly = L.polygon(geo.polygons, plotPolygonStyle(selected));
    poly._appyPlotId = plot.id;
    poly.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      onPlotClick(plot.id);
    });
    if (plot.name) poly.bindTooltip(plot.name);
    _mapPlotLayer.addLayer(poly);
  }
}

function plotPolygonStyle(selected) {
  // Neutral slate so plots read as data on the map without competing
  // with the accent (which is reserved for UI affordances).
  return {
    color: selected ? '#1f2937' : '#475569',
    weight: selected ? 3 : 2,
    fillColor: '#475569',
    fillOpacity: selected ? 0.28 : 0.12,
  };
}

function onPlotClick(plotId) {
  _selectedPlotId = (_selectedPlotId === plotId) ? null : plotId;
  redrawMapPlots();
}

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
// BOUNDARY RENDERING (Brick 6b)
// ============================================================
// Each boundary type gets its own L.featureGroup so we can toggle the
// whole level on/off as a unit. Geometry is the dissolved turf-union of
// constituent plots (cached by id). Stroke-only style — fills are
// reserved for future choropleth (Brick 13).

function colorForBoundaryType(typeId) {
  const idx = data.boundaryTypes.findIndex(t => t.id === typeId);
  if (idx < 0) return '#888';
  return BOUNDARY_TYPE_PALETTE[idx % BOUNDARY_TYPE_PALETTE.length];
}

function _ensureBoundaryVisibilityInit() {
  if (_visibleBoundaryTypes === null) _visibleBoundaryTypes = new Set();
  if (_seenBoundaryTypeIds === null)  _seenBoundaryTypeIds  = new Set();
  // First time we see a type id, default it to visible. After that it's
  // user-controlled — if they toggle it off it stays off.
  for (const ty of data.boundaryTypes) {
    if (_seenBoundaryTypeIds.has(ty.id)) continue;
    _seenBoundaryTypeIds.add(ty.id);
    _visibleBoundaryTypes.add(ty.id);
  }
  // Drop drill-stack entries whose boundary has since been deleted.
  while (_drillStack.length > 0) {
    const top = _drillStack[_drillStack.length - 1];
    if (data.boundaries.some(b => b.id === top.boundaryId)) break;
    _drillStack.pop();
  }
}

function _getDrillScope() {
  // Returns { plotIds, boundaryIds } limiting what's rendered, or null
  // for the unrestricted root view. Drilling into B shows everything
  // transitively contained by B but not B itself or anything above.
  if (_drillStack.length === 0) return null;
  const top = _drillStack[_drillStack.length - 1];
  const b = data.boundaries.find(x => x.id === top.boundaryId);
  if (!b) return { plotIds: new Set(), boundaryIds: new Set() };

  const plotIds = new Set(flattenBoundaryToPlotIds(b));
  const boundaryIds = new Set();
  (function walk(boundary) {
    for (const m of (boundary.members || [])) {
      if (m.kind !== 'boundary') continue;
      boundaryIds.add(m.id);
      const sub = data.boundaries.find(x => x.id === m.id);
      if (sub) walk(sub);
    }
  })(b);
  return { plotIds, boundaryIds };
}

function redrawMapBoundaries() {
  if (!_map) return;
  _ensureBoundaryVisibilityInit();

  // Tear down old layers.
  for (const layer of _mapBoundaryLayers.values()) {
    if (_map.hasLayer(layer)) _map.removeLayer(layer);
  }
  _mapBoundaryLayers.clear();

  const scope = _getDrillScope();

  // Group in-scope boundaries by typeId.
  const byType = new Map();
  for (const b of data.boundaries) {
    if (scope && !scope.boundaryIds.has(b.id)) continue;
    if (!byType.has(b.typeId)) byType.set(b.typeId, []);
    byType.get(b.typeId).push(b);
  }

  for (const [typeId, list] of byType) {
    const group = L.featureGroup();
    const color = colorForBoundaryType(typeId);
    for (const b of list) {
      const geom = resolveBoundaryGeometry(b);
      if (!geom || !geom.polygons.length) continue;
      const poly = L.polygon(geom.polygons, boundaryPolygonStyle(color));
      poly._appyBoundaryId = b.id;
      poly.bindTooltip(b.name || `(${getBoundaryTypeName(b.typeId)})`);
      poly.on('click', (e) => onBoundaryPolyClick(e, b.id));
      poly.on('dblclick', (e) => onBoundaryPolyDblClick(e, b.id));
      group.addLayer(poly);
    }
    _mapBoundaryLayers.set(typeId, group);
    if (_visibleBoundaryTypes.has(typeId)) group.addTo(_map);
  }
}

function boundaryPolygonStyle(color) {
  return { color, weight: 3, fill: false, opacity: 0.9, lineJoin: 'round' };
}

function onBoundaryPolyClick(e, boundaryId) {
  L.DomEvent.stopPropagation(e);
  // Single click defers; if a dblclick arrives within the window we cancel.
  if (_boundaryClickTimer) return;
  _boundaryClickTimer = setTimeout(() => {
    _boundaryClickTimer = null;
    if (typeof openBoundaryDetail === 'function') openBoundaryDetail(boundaryId);
  }, 240);
}

function onBoundaryPolyDblClick(e, boundaryId) {
  L.DomEvent.stopPropagation(e);
  L.DomEvent.preventDefault(e);
  if (_boundaryClickTimer) { clearTimeout(_boundaryClickTimer); _boundaryClickTimer = null; }
  drillIntoBoundary(boundaryId);
}

function drillIntoBoundary(boundaryId) {
  const b = data.boundaries.find(x => x.id === boundaryId);
  if (!b) return;
  _drillStack.push({
    boundaryId: b.id,
    name: b.name || getBoundaryTypeName(b.typeId) || '?',
    typeId: b.typeId,
  });
  redrawMapPlots();
  redrawMapBoundaries();
  renderMapToolbar();
  _fitMapToVisible();
}

function drillBackTo(level) {
  // level=0 → root; level=N → keep first N entries.
  _drillStack = _drillStack.slice(0, level);
  redrawMapPlots();
  redrawMapBoundaries();
  renderMapToolbar();
  _fitMapToVisible();
}

function _fitMapToVisible() {
  if (!_map) return;
  const bounds = L.latLngBounds([]);
  if (_plotsLayerVisible && _mapPlotLayer) {
    const b = _mapPlotLayer.getBounds();
    if (b.isValid()) bounds.extend(b);
  }
  for (const [typeId, layer] of _mapBoundaryLayers) {
    if (!_visibleBoundaryTypes.has(typeId)) continue;
    const b = layer.getBounds();
    if (b.isValid()) bounds.extend(b);
  }
  if (bounds.isValid()) _map.fitBounds(bounds, { padding: [20, 20] });
}

function togglePlotsLayer() {
  _plotsLayerVisible = !_plotsLayerVisible;
  if (!_map || !_mapPlotLayer) return;
  if (_plotsLayerVisible) _mapPlotLayer.addTo(_map);
  else _map.removeLayer(_mapPlotLayer);
  renderMapToolbar();
}

function toggleBoundaryTypeLayer(typeId) {
  _ensureBoundaryVisibilityInit();
  const layer = _mapBoundaryLayers.get(typeId);
  if (_visibleBoundaryTypes.has(typeId)) {
    _visibleBoundaryTypes.delete(typeId);
    if (layer && _map.hasLayer(layer)) _map.removeLayer(layer);
  } else {
    _visibleBoundaryTypes.add(typeId);
    if (layer) layer.addTo(_map);
  }
  renderMapToolbar();
}

// ============================================================
// MAP TOOLBAR — breadcrumb + per-layer toggle chips
// ============================================================
// Single-line strip that sits above the map. Chips toggle layer
// visibility. When drilled in, a breadcrumb appears above the strip
// with clickable ancestors back to the project root.

function renderMapToolbar() {
  const el = document.getElementById('map-toolbar');
  if (!el) return;
  _ensureBoundaryVisibilityInit();

  let breadcrumbHtml = '';
  if (_drillStack.length > 0) {
    const parts = [`<a class="map-crumb-link" onclick="drillBackTo(0)">${t('map.crumb_root')}</a>`];
    _drillStack.forEach((entry, i) => {
      const last = i === _drillStack.length - 1;
      const label = entry.name ? esc(entry.name) : '?';
      parts.push(last
        ? `<span class="map-crumb-current">${label}</span>`
        : `<a class="map-crumb-link" onclick="drillBackTo(${i + 1})">${label}</a>`);
    });
    breadcrumbHtml = `<div class="map-crumbs">${parts.join('<span class="map-crumb-sep">›</span>')}</div>`;
  }

  const chips = [];
  chips.push(_chipHtml('plots',
    t('map.layer_plots'),
    PLOTS_LAYER_COLOR,
    _plotsLayerVisible,
    `togglePlotsLayer()`));
  for (const ty of data.boundaryTypes.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    chips.push(_chipHtml(ty.id,
      ty.name,
      colorForBoundaryType(ty.id),
      _visibleBoundaryTypes.has(ty.id),
      `toggleBoundaryTypeLayer('${esc(ty.id)}')`));
  }

  el.innerHTML = breadcrumbHtml + `<div class="map-chip-strip">${chips.join('')}</div>`;
}

function _chipHtml(key, label, color, active, onclick) {
  const cls = `map-chip${active ? ' active' : ''}`;
  return `<button class="${cls}" style="--chip-color:${color}" onclick="${onclick}">
    <span class="map-chip-dot"></span>${esc(label)}
  </button>`;
}

function fitMapToPlots() {
  // Legacy helper — still wired in case anything calls it. Use _fitMapToVisible
  // when boundaries are involved.
  if (!_map || !_mapPlotLayer) return;
  const b = _mapPlotLayer.getBounds();
  if (b.isValid()) _map.fitBounds(b, { padding: [20, 20] });
}
