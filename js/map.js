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

function initMap() {
  const el = document.getElementById('map');
  if (!el) return;
  if (_map) { _map.invalidateSize(); redrawMapPlots(); return; }

  _map = L.map(el, {
    center: [0, 0],
    zoom: 3,
    minZoom: 2,
    maxZoom: 19,
    worldCopyJump: true
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
}

// ============================================================
// PLOT RENDERING
// ============================================================

function redrawMapPlots() {
  if (!_map || !_mapPlotLayer) return;
  _mapPlotLayer.clearLayers();
  for (const plot of data.plots) {
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

function fitMapToPlots() {
  if (!_map || !_mapPlotLayer) return;
  const b = _mapPlotLayer.getBounds();
  if (b.isValid()) _map.fitBounds(b, { padding: [20, 20] });
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
