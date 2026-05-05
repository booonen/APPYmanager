// ============================================================
// MAP — Leaflet wrapper with OGF tile layer
// ============================================================
// In Brick 1 the map is empty. Future bricks will add plot polygons,
// boundary overlays, and the Overpass import flow.

const OGF_TILE_URL = 'https://tile.opengeofiction.net/ogf-carto/{z}/{x}/{y}.png';
const OGF_OVERPASS_URL = 'https://overpass.opengeofiction.net/api/interpreter';

let _map = null;
let _mapTileLayer = null;

function initMap() {
  const el = document.getElementById('map');
  if (!el) return;
  if (_map) { _map.invalidateSize(); return; }

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

  // Restore the user's last view if persisted on this project.
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
}
