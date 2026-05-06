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
  return {
    color: selected ? '#9e1f25' : '#c1272d',
    weight: selected ? 3 : 2,
    fillColor: '#c1272d',
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
      color: rejected ? '#e0a855' : '#c1272d',
      weight: 2,
      dashArray: rejected ? '4,4' : null,
      fillColor: rejected ? '#e0a855' : '#c1272d',
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
