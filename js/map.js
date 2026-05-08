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
let _mapSettlementLayer  = null;        // L.featureGroup for settlement markers (always on)
let _mapBoundaryLayer    = null;        // single L.featureGroup for boundary polygons
let _mapCurrentTypeId    = null;        // type selected in dropdown (null = uninitialized → Plots)
let _drillStack          = [];          // [{ boundaryId, name, typeId }, ...]
let _boundaryClickTimer  = null;        // single-click vs double-click guard

// Polygon index for hover highlights: 'kind:id' → L.Polygon.
// Rebuilt on every redraw; lets _hoverMapItem mutate styles in-place.
let _polyIndex       = new Map();
let _hoverLayer      = null;            // featureGroup for temporary hover polygons
let _hoveredPolyKind = null;
let _hoveredPolyId   = null;
let _hoveredTempPoly = null;

// Track settlement draw order so we can restore z-stacking after a
// hover bringToFront — otherwise the hovered marker stays above its
// peers even after mouseleave.
let _settlementMarkerOrder = [];        // array of settlement ids, smallest-rank first

// Persist the place-filter dropdown's open state across toolbar
// re-renders (which otherwise wipe `<details open>` and snap shut).
let _placesFilterOpen = false;

// Sentinel id for the synthetic "Plots" dropdown option.
const PLOTS_TYPE_SENTINEL = '__plots__';

function initMap() {
  const el = document.getElementById('map');
  if (!el) return;
  if (_map) { _map.invalidateSize(); redrawMap(); startGeometryPrecompute(); return; }

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

  _mapPlotLayer       = L.featureGroup().addTo(_map);
  _mapBoundaryLayer   = L.featureGroup().addTo(_map);
  _mapSettlementLayer = L.featureGroup().addTo(_map);
  _hoverLayer         = L.featureGroup().addTo(_map);

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
  startGeometryPrecompute();
}

// ============================================================
// PLOT STYLING (shared with detail map)
// ============================================================

// ============================================================
// SETTLEMENT MARKER STYLING
// ============================================================
// Radius scales by place type so cities read as more important than
// hamlets at a glance. Fill colour follows the JOSM-style PLACE_COLORS
// map in settlements.js. Selected settlements get a brighter accent
// stroke and a slightly larger radius.

function _settlementRadius(place) {
  switch (place) {
    case 'city':                     return 12;
    case 'town':                     return 10;
    case 'village':                  return 8;
    case 'borough':                  return 7;
    case 'suburb':                   return 7;
    case 'hamlet':                   return 6;
    case 'quarter':                  return 6;
    case 'neighbourhood':            return 6;
    case 'isolated_dwelling':        return 5;
    case 'locality':                 return 5;
    default:                         return 5;
  }
}

function settlementMarkerStyle(settlement, selected) {
  const fill = (typeof colorForPlaceType === 'function')
    ? colorForPlaceType(settlement?.place)
    : '#7f8c8d';
  return {
    radius:      _settlementRadius(settlement?.place) + (selected ? 2 : 0),
    color:       selected ? '#c1272d' : '#0f1117',
    weight:      selected ? 2.5 : 1.5,
    fillColor:   fill,
    fillOpacity: selected ? 1 : 0.9,
  };
}

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

// Draw settlement candidates as circle markers in the preview map
// (Brick 7b). One marker per candidate, gold to match the settlements
// accent. Bounds fit to the marker set.
function drawPreviewSettlements(candidates) {
  if (!_previewMap || !_previewLayer) return;
  _previewLayer.clearLayers();
  const all = L.latLngBounds([]);
  // Sort smallest-rank first so important markers stack on top in the preview too.
  const sorted = candidates.slice().sort((a, b) => {
    const ra = (typeof rankForPlaceType === 'function') ? rankForPlaceType(a.place) : 0;
    const rb = (typeof rankForPlaceType === 'function') ? rankForPlaceType(b.place) : 0;
    return ra - rb;
  });
  for (const c of sorted) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const fill = (typeof colorForPlaceType === 'function') ? colorForPlaceType(c.place) : '#7f8c8d';
    const m = L.circleMarker([c.lat, c.lng], {
      radius: _settlementRadius(c.place),
      color: '#0f1117',
      weight: 1.5,
      fillColor: fill,
      fillOpacity: 0.9,
    });
    m.bindTooltip(c.name ? c.name : `(${c.place})`);
    _previewLayer.addLayer(m);
    all.extend([c.lat, c.lng]);
  }
  if (all.isValid()) _previewMap.fitBounds(all, { padding: [20, 20] });
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
  // Default to the Plots view so the map is immediately usable without
  // waiting for boundary union work. The background precompute fills
  // the geometry cache so switching the dropdown feels instant.
  const isKnownType = _mapCurrentTypeId === PLOTS_TYPE_SENTINEL
    || data.boundaryTypes.some(t => t.id === _mapCurrentTypeId);
  if (!isKnownType) {
    _mapCurrentTypeId = PLOTS_TYPE_SENTINEL;
  }
}

function redrawMap() {
  if (!_map || !_mapPlotLayer || !_mapBoundaryLayer) return;
  _normalizeMapState();
  _unhoverMapItem();
  _polyIndex.clear();
  _mapPlotLayer.clearLayers();
  _mapBoundaryLayer.clearLayers();
  if (_mapSettlementLayer) _mapSettlementLayer.clearLayers();
  if (_hoverLayer) _hoverLayer.clearLayers();

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

  // Settlements live on a dedicated always-on layer so they remain
  // visible regardless of which boundary level is selected. Sorted
  // smallest-rank first so cities draw on top of hamlets etc.; filtered
  // through data.settings.visiblePlaceTypes when set.
  const visible = data.settings?.visiblePlaceTypes;
  const isPlaceVisible = (place) => !Array.isArray(visible) || visible.includes(place);
  const settlementsToDraw = (data.settlements || [])
    .filter(s => isPlaceVisible(s.place))
    .sort((a, b) => {
      const ra = (typeof rankForPlaceType === 'function') ? rankForPlaceType(a.place) : 0;
      const rb = (typeof rankForPlaceType === 'function') ? rankForPlaceType(b.place) : 0;
      return ra - rb;
    });
  _settlementMarkerOrder = [];
  for (const s of settlementsToDraw) {
    _drawSettlementMarker(s);
    _settlementMarkerOrder.push(s.id);
  }

  renderMapToolbar();
  renderMapSidePanel();
}

function _drawSettlementMarker(s) {
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
  const isSelected = _selectedItemKind === 'settlement' && _selectedItemId === s.id;
  const m = L.circleMarker([s.lat, s.lng], settlementMarkerStyle(s, isSelected));
  m._appySettlementId = s.id;
  if (s.name) m.bindTooltip(s.name);
  m.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    _selectItem('settlement', s.id);
  });
  _mapSettlementLayer.addLayer(m);
  _polyIndex.set('settlement:' + s.id, m);
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
  _polyIndex.set('plot:' + plot.id, poly);
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
  _polyIndex.set('boundary:' + b.id, poly);
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

// ── Hover highlights (side-panel children) ──

function _hoverMapItem(kind, id) {
  _unhoverMapItem();
  _hoveredPolyKind = kind;
  _hoveredPolyId   = id;
  const indexed = _polyIndex.get(kind + ':' + id);
  if (indexed) {
    if (kind === 'boundary') {
      const b = data.boundaries.find(x => x.id === id);
      const c = colorForBoundaryType(b?.typeId);
      indexed.setStyle({ color: c, weight: 3.5, fillColor: c, fillOpacity: 0.55, lineJoin: 'round' });
    } else if (kind === 'plot') {
      indexed.setStyle({ color: '#1f2937', weight: 3, fillColor: '#475569', fillOpacity: 0.45 });
    } else if (kind === 'settlement') {
      const s = data.settlements?.find(x => x.id === id);
      const r = _settlementRadius(s?.place) + 3;
      const c = (typeof colorForPlaceType === 'function') ? colorForPlaceType(s?.place) : '#7f8c8d';
      indexed.setStyle({ radius: r, weight: 2.5, color: '#c1272d', fillColor: c, fillOpacity: 1 });
      // Push the hovered marker above its peers so it isn't occluded.
      if (typeof indexed.bringToFront === 'function') indexed.bringToFront();
    }
  } else if (_hoverLayer) {
    // Not currently drawn at this level: draw a temporary highlight
    if (kind === 'boundary') {
      const b = data.boundaries.find(x => x.id === id);
      if (b) {
        const geom = resolveBoundaryGeometry(b);
        if (geom && geom.polygons.length) {
          const c = colorForBoundaryType(b.typeId);
          _hoveredTempPoly = L.polygon(geom.polygons,
            { color: c, weight: 3, fillColor: c, fillOpacity: 0.55, lineJoin: 'round', dashArray: '6,4' });
          _hoverLayer.addLayer(_hoveredTempPoly);
        }
      }
    } else if (kind === 'plot') {
      const p = data.plots.find(x => x.id === id);
      if (p) {
        const geo = resolvePlotGeometry(p);
        if (geo.polygons.length) {
          _hoveredTempPoly = L.polygon(geo.polygons,
            { color: '#1f2937', weight: 3, fillColor: '#475569', fillOpacity: 0.45, dashArray: '6,4' });
          _hoverLayer.addLayer(_hoveredTempPoly);
        }
      }
    } else if (kind === 'settlement') {
      const s = data.settlements?.find(x => x.id === id);
      if (s && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
        const c = (typeof colorForPlaceType === 'function') ? colorForPlaceType(s.place) : '#7f8c8d';
        _hoveredTempPoly = L.circleMarker([s.lat, s.lng],
          { radius: _settlementRadius(s.place) + 3, color: '#c1272d', weight: 2.5,
            fillColor: c, fillOpacity: 1, dashArray: '4,3' });
        _hoverLayer.addLayer(_hoveredTempPoly);
      }
    }
  }
}

function _unhoverMapItem() {
  if (_hoveredTempPoly) {
    _hoverLayer && _hoverLayer.removeLayer(_hoveredTempPoly);
    _hoveredTempPoly = null;
  }
  if (_hoveredPolyKind && _hoveredPolyId) {
    const indexed = _polyIndex.get(_hoveredPolyKind + ':' + _hoveredPolyId);
    if (indexed) {
      const isSelected = _selectedItemKind === _hoveredPolyKind && _selectedItemId === _hoveredPolyId;
      if (_hoveredPolyKind === 'boundary') {
        const b = data.boundaries.find(x => x.id === _hoveredPolyId);
        indexed.setStyle(boundaryFilledStyle(colorForBoundaryType(b?.typeId), isSelected));
      } else if (_hoveredPolyKind === 'plot') {
        indexed.setStyle(plotPolygonStyle(isSelected));
      } else if (_hoveredPolyKind === 'settlement') {
        const s = data.settlements?.find(x => x.id === _hoveredPolyId);
        indexed.setStyle(settlementMarkerStyle(s, isSelected));
        // _hoverMapItem brought this marker to the SVG front, which would
        // otherwise stick across hover sessions. Re-stack by re-fronting
        // every settlement that should sit above it in draw order.
        const idx = _settlementMarkerOrder.indexOf(_hoveredPolyId);
        if (idx >= 0) {
          for (let i = idx + 1; i < _settlementMarkerOrder.length; i++) {
            const m = _polyIndex.get('settlement:' + _settlementMarkerOrder[i]);
            if (m && typeof m.bringToFront === 'function') m.bringToFront();
          }
        }
      }
    }
  }
  _hoveredPolyKind = null;
  _hoveredPolyId   = null;
}

// ── Panel navigation ──

// Click a parent in the membership chain → show that type at root, select it
function _panelNavigateToParent(parentId, kind) {
  kind = kind || 'boundary';
  _unhoverMapItem();
  if (kind === 'plot') {
    const p = data.plots.find(x => x.id === parentId);
    if (!p) return;
    _mapCurrentTypeId = PLOTS_TYPE_SENTINEL;
    _drillStack = [];
    _selectItem('plot', parentId);
    const geo = resolvePlotGeometry(p);
    if (geo.polygons.length) {
      const bounds = L.polygon(geo.polygons).getBounds();
      if (bounds.isValid()) _map && _map.fitBounds(bounds, { padding: [40, 40] });
    }
    return;
  }
  const b = data.boundaries.find(x => x.id === parentId);
  if (!b) return;
  _mapCurrentTypeId = b.typeId;
  _drillStack = [];
  _selectItem('boundary', parentId);
  try {
    const geom = resolveBoundaryGeometry(b);
    if (geom && geom.polygons.length) {
      const bounds = L.polygon(geom.polygons).getBounds();
      if (bounds.isValid()) _map && _map.fitBounds(bounds, { padding: [40, 40] });
    }
  } catch (e) {}
}

// Click a settlement in a boundary's Settlements section → just pan and select.
// No drill change; settlements are always visible.
function _panelSelectSettlement(id) {
  const s = data.settlements?.find(x => x.id === id);
  if (!s) return;
  _unhoverMapItem();
  _selectItem('settlement', id);
  if (_map && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
    _map.setView([s.lat, s.lng], Math.max(_map.getZoom(), 9));
  }
}

// Click a child in the members list → drill into current boundary, select child
function _panelNavigateToChild(childKind, childId) {
  if (_selectedItemKind !== 'boundary' || !_selectedItemId) return;
  const parent = data.boundaries.find(b => b.id === _selectedItemId);
  if (!parent) return;
  _unhoverMapItem();
  _mapCurrentTypeId = parent.typeId;
  _drillStack = [{
    boundaryId: parent.id,
    name: parent.name || getBoundaryTypeName(parent.typeId) || '?',
    typeId: parent.typeId,
  }];
  _selectItem(childKind, childId);
  // Fit to child geometry
  if (childKind === 'boundary') {
    const child = data.boundaries.find(b => b.id === childId);
    try {
      const geom = child && resolveBoundaryGeometry(child);
      if (geom && geom.polygons.length) {
        const bounds = L.polygon(geom.polygons).getBounds();
        if (bounds.isValid()) _map && _map.fitBounds(bounds, { padding: [30, 30] });
      }
    } catch (e) {}
  } else {
    const p = data.plots.find(x => x.id === childId);
    if (p) {
      const geo = resolvePlotGeometry(p);
      if (geo.polygons.length) {
        const bounds = L.polygon(geo.polygons).getBounds();
        if (bounds.isValid()) _map && _map.fitBounds(bounds, { padding: [30, 30] });
      }
    }
  }
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

function _renderChildren(boundary) {
  const members = boundary.members || [];
  if (members.length === 0) return '';
  let html = `<div class="map-panel-section">Members (${members.length})</div>`;
  for (const m of members) {
    let name, typeChip;
    if (m.kind === 'plot') {
      const p = data.plots.find(x => x.id === m.id);
      name     = p?.name ? esc(p.name) : '<em class="text-muted">Unnamed</em>';
      typeChip = `<span class="map-panel-member-type" style="background:#475569">Plot</span>`;
    } else {
      const sub = data.boundaries.find(x => x.id === m.id);
      const color = colorForBoundaryType(sub?.typeId);
      const tName = getBoundaryTypeName(sub?.typeId);
      name     = sub?.name ? esc(sub.name) : '<em class="text-muted">Unnamed</em>';
      typeChip = `<span class="map-panel-member-type" style="background:${color}">${esc(tName)}</span>`;
    }
    html += `
      <div class="map-panel-child"
        onmouseenter="_hoverMapItem('${m.kind}','${m.id}')"
        onmouseleave="_unhoverMapItem()"
        onclick="_panelNavigateToChild('${m.kind}','${m.id}')">
        ${typeChip}
        <span class="map-panel-child-name">${name}</span>
      </div>`;
  }
  return html;
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
        <a class="map-panel-member-link" onclick="_panelNavigateToParent('${esc(b.id)}')">
          <span class="map-panel-member-type" style="background:${color}">${esc(typeName)}</span>
          ${b.name ? esc(b.name) : '<em>Unnamed</em>'}
        </a>
      </div>`;
  });
  return html;
}

// Settlements transitively contained by a boundary, or directly attached
// to a plot. Renders as a hover/click list — same chrome as the members
// section, but pans+selects rather than drilling (settlements are always
// visible).
function _renderSettlementsSection(items) {
  if (!items || items.length === 0) return '';
  // Auto-collapse big lists to keep the panel snappy: rendering 500
  // hover-bindable rows is noticeably slow.
  const COLLAPSE_THRESHOLD = 20;
  const collapse = items.length > COLLAPSE_THRESHOLD;
  // Sort by rank descending so the heaviest settlements lead the list.
  const sorted = items.slice().sort((a, b) => {
    const ra = (typeof rankForPlaceType === 'function') ? rankForPlaceType(a.place) : 0;
    const rb = (typeof rankForPlaceType === 'function') ? rankForPlaceType(b.place) : 0;
    return rb - ra;
  });
  let rows = '';
  for (const s of sorted) {
    const nm = s.name ? esc(s.name) : '<em class="text-muted">Unnamed</em>';
    const c  = (typeof colorForPlaceType === 'function') ? colorForPlaceType(s.place) : '#7f8c8d';
    rows += `
      <div class="map-panel-child"
        onmouseenter="_hoverMapItem('settlement','${s.id}')"
        onmouseleave="_unhoverMapItem()"
        onclick="_panelSelectSettlement('${s.id}')">
        <span class="map-panel-member-type" style="background:${c}">${esc(s.place || 'place')}</span>
        <span class="map-panel-child-name">${nm}</span>
      </div>`;
  }
  if (collapse) {
    return `
      <details class="map-panel-collapse">
        <summary class="map-panel-section">Settlements (${items.length}) — click to expand</summary>
        ${rows}
      </details>`;
  }
  return `<div class="map-panel-section">Settlements (${items.length})</div>${rows}`;
}

// Settlement's parent block: direct parent + (when parent is a boundary)
// the rest of the ancestor chain so the user sees full transitive context.
function _renderSettlementParent(s) {
  if (!s.parent) return `<div class="map-panel-membership-none">No parent assigned</div>`;
  const info = (typeof getSettlementParentInfo === 'function') ? getSettlementParentInfo(s) : null;
  if (!info) return `<div class="map-panel-membership-none">Parent missing</div>`;
  const parentColor = s.parent.kind === 'plot'
    ? '#475569'
    : colorForBoundaryType(data.boundaries.find(b => b.id === s.parent.id)?.typeId);
  const parentName = info.name ? esc(info.name) : '<em>Unnamed</em>';
  let html = `<div class="map-panel-section">Parent</div>
    <div class="map-panel-membership">
      <span class="map-panel-member-label">Direct member of</span>
      <a class="map-panel-member-link" onclick="_panelNavigateToParent('${esc(s.parent.id)}','${s.parent.kind}')">
        <span class="map-panel-member-type" style="background:${parentColor}">${esc(info.typeLabel)}</span>
        ${parentName}
      </a>
    </div>`;
  if (s.parent.kind === 'boundary') {
    const ancestors = _getAncestorChain('boundary', s.parent.id);
    ancestors.forEach(b => {
      const c = colorForBoundaryType(b.typeId);
      const tn = getBoundaryTypeName(b.typeId);
      html += `
        <div class="map-panel-membership">
          <span class="map-panel-member-label">Also within</span>
          <a class="map-panel-member-link" onclick="_panelNavigateToParent('${esc(b.id)}')">
            <span class="map-panel-member-type" style="background:${c}">${esc(tn)}</span>
            ${b.name ? esc(b.name) : '<em>Unnamed</em>'}
          </a>
        </div>`;
    });
  }
  return html;
}

function renderMapSidePanel() {
  const el = document.getElementById('map-side-panel');
  if (!el) return;

  // If the selected item was deleted, clear stale selection silently.
  if (_selectedItemId) {
    let exists = false;
    if (_selectedItemKind === 'boundary')   exists = data.boundaries.some(x => x.id === _selectedItemId);
    else if (_selectedItemKind === 'plot')  exists = data.plots.some(x => x.id === _selectedItemId);
    else if (_selectedItemKind === 'settlement') exists = (data.settlements || []).some(x => x.id === _selectedItemId);
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
        ${_renderChildren(b)}
        ${_renderSettlementsSection(typeof flattenSettlementsForBoundary === 'function' ? flattenSettlementsForBoundary(b) : [])}
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
        ${_renderSettlementsSection(typeof settlementsForPlot === 'function' ? settlementsForPlot(p.id) : [])}
        ${_renderMemberships('plot', p.id)}
        <button class="btn btn-sm btn-primary" style="width:100%;margin-top:4px"
          onclick="openPlotDetail('${esc(p.id)}')">Open full details</button>
      </div>`;

  } else if (_selectedItemKind === 'settlement') {
    const s = (data.settlements || []).find(x => x.id === _selectedItemId);
    if (!s) { el.style.display = 'none'; return; }
    const coords = `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`;
    const placeColor = (typeof colorForPlaceType === 'function') ? colorForPlaceType(s.place) : '#7f8c8d';
    html = `
      <div class="map-panel-inner">
        <div class="map-panel-hdr">
          <span class="map-popup-type" style="background:${placeColor}">${esc(s.place || 'place')}</span>
          <button class="map-panel-close" onclick="_clearMapSelection()" title="Deselect">✕</button>
        </div>
        <div class="map-panel-field">
          <label class="map-panel-label">Name</label>
          <input class="input map-panel-input" value="${esc(s.name || '')}"
            onblur="_panelSaveName(this.value)" placeholder="Unnamed">
        </div>
        <div class="map-panel-meta">${coords}${s.ogfNodeId ? ` · #${esc(s.ogfNodeId)}` : ''}</div>
        <div class="map-panel-field">
          <label class="map-panel-label">Notes</label>
          <textarea class="input map-panel-notes" onblur="_panelSaveNotes(this.value)"
            rows="3" placeholder="No notes">${esc(s.notes || '')}</textarea>
        </div>
        ${_renderSettlementParent(s)}
        <button class="btn btn-sm btn-primary" style="width:100%;margin-top:4px"
          onclick="openSettlementDetail('${esc(s.id)}')">Open full details</button>
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
  } else if (_selectedItemKind === 'settlement') {
    const s = (data.settlements || []).find(x => x.id === _selectedItemId);
    if (!s) return;
    s.name = value.trim();
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
  } else if (_selectedItemKind === 'settlement') {
    const s = (data.settlements || []).find(x => x.id === _selectedItemId);
    if (s) { s.notes = value; save(); }
  }
}

// ============================================================
// DRILL NAVIGATION
// ============================================================

function drillIntoBoundary(boundaryId) {
  const b = data.boundaries.find(x => x.id === boundaryId);
  if (!b) return;

  // Find the deepest stack entry whose boundary directly contains this one.
  // Truncate to that entry (preserving its ancestors) then push, so sibling-
  // drilling keeps the common ancestry visible (e.g. drilling Province B when
  // Province A is open leaves Country's layer intact).
  // If no stack entry contains the new boundary, start fresh.
  let insertAt = -1;
  for (let i = _drillStack.length - 1; i >= 0; i--) {
    const entryB = data.boundaries.find(x => x.id === _drillStack[i].boundaryId);
    if (entryB && (entryB.members || []).some(m => m.kind === 'boundary' && m.id === boundaryId)) {
      insertAt = i;
      break;
    }
  }
  _drillStack = insertAt >= 0 ? _drillStack.slice(0, insertAt + 1) : [];

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

  // Single toolbar row: boundary-type "Show:" select + place-filter
  // popover. Both controls share width so they line up tidily. The
  // place filter is rendered inside `<details>`; its body is positioned
  // absolutely so opening it doesn't push the map down (no scroll on
  // the Map tab).
  const types = _typesLargestFirst();
  const haveAny = types.length > 0 || data.plots.length > 0;
  let rowHtml = '';
  if (haveAny || (data.settlements || []).length > 0) {
    let selectHtml = '';
    if (haveAny) {
      const typeOpts = types.map(ty =>
        `<option value="${esc(ty.id)}"${ty.id === _mapCurrentTypeId ? ' selected' : ''}>${esc(ty.name)}</option>`
      ).join('');
      const plotsSelected = _mapCurrentTypeId === PLOTS_TYPE_SENTINEL;
      const plotsOpt = `<option value="${PLOTS_TYPE_SENTINEL}"${plotsSelected ? ' selected' : ''}>${t('map.layer_plots')}</option>`;
      selectHtml = `
        <label class="import-target-label">${t('map.show_label')}</label>
        <select class="map-toolbar-control" onchange="onMapTypeChange(this.value)">${typeOpts}${plotsOpt}</select>`;
    }

    let placesHtml = '';
    if ((data.settlements || []).length > 0 && typeof PLACE_TYPES !== 'undefined') {
      const visible = data.settings?.visiblePlaceTypes;
      const isVis = (pt) => !Array.isArray(visible) || visible.includes(pt);
      const counts = {};
      for (const s of data.settlements) counts[s.place] = (counts[s.place] || 0) + 1;
      const total = data.settlements.length;
      const onCount = data.settlements.filter(s => isVis(s.place)).length;
      const allOn = PLACE_TYPES.every(pt => isVis(pt));

      const chips = PLACE_TYPES.map(pt => {
        const checked = isVis(pt);
        const c = colorForPlaceType(pt);
        const n = counts[pt] || 0;
        return `
          <label class="place-chip${n === 0 ? ' place-chip-empty' : ''}" title="${n} in project">
            <input type="checkbox" value="${esc(pt)}" ${checked ? 'checked' : ''}
              onchange="onMapPlaceFilterChange(this)">
            <span class="place-color-dot" style="background:${c}"></span>
            <span>${esc(pt)}</span>
            ${n > 0 ? `<span class="place-chip-count">${n}</span>` : ''}
          </label>`;
      }).join('');

      // Master "All types" toggle — checked when every type is on,
      // indeterminate when some are off, unchecked when none are.
      // Setting `indeterminate` happens after innerHTML in a follow-up
      // pass since HTML attributes can't express it.
      const masterChip = `
        <label class="place-chip place-chip-master">
          <input type="checkbox" id="map-places-master" ${allOn ? 'checked' : ''}
            onchange="onMapPlaceFilterMaster(this.checked)">
          <span><strong>${t('map.places_all_types')}</strong></span>
        </label>`;

      placesHtml = `
        <details class="map-places-filter" ${_placesFilterOpen ? 'open' : ''}
          ontoggle="onMapPlacesFilterToggle(this.open)">
          <summary class="map-toolbar-control">
            <span>${t('map.places_filter', { on: onCount, total })}</span>
            <span class="map-toolbar-caret">▾</span>
          </summary>
          <div class="map-places-filter-body">
            ${masterChip}
            <div class="place-chips" style="margin-top:6px">${chips}</div>
          </div>
        </details>`;
    }

    rowHtml = `<div class="map-toolbar-row">${selectHtml}${placesHtml}</div>`;
  }

  el.innerHTML = breadcrumbHtml + rowHtml;

  // The "All types" master needs its indeterminate state set
  // imperatively (HTML can't represent it).
  const master = document.getElementById('map-places-master');
  if (master) {
    const visible = data.settings?.visiblePlaceTypes;
    const isVis = (pt) => !Array.isArray(visible) || visible.includes(pt);
    const allOn  = PLACE_TYPES.every(pt => isVis(pt));
    const noneOn = PLACE_TYPES.every(pt => !isVis(pt));
    master.indeterminate = !allOn && !noneOn;
  }
}

function onMapPlaceFilterChange(checkbox) {
  // Materialise the visibility set when the user first interacts (it
  // may be undefined = all-on) so we can subtract from it.
  const cur = data.settings.visiblePlaceTypes
    ? data.settings.visiblePlaceTypes.slice()
    : PLACE_TYPES.slice();
  const v = checkbox.value;
  const idx = cur.indexOf(v);
  if (checkbox.checked && idx < 0) cur.push(v);
  if (!checkbox.checked && idx >= 0) cur.splice(idx, 1);
  data.settings.visiblePlaceTypes = cur;
  save();
  redrawMap();
}

function onMapPlaceFilterMaster(on) {
  data.settings.visiblePlaceTypes = on ? PLACE_TYPES.slice() : [];
  save();
  redrawMap();
}

// Inline-handler-friendly setter — top-level `let` bindings aren't
// reachable from `ontoggle="..."` directly in classic-script mode.
function onMapPlacesFilterToggle(open) { _placesFilterOpen = !!open; }

// Backwards-compat alias, in case anything still calls the old name.
function redrawMapBoundaries() { redrawMap(); }
