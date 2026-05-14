// ============================================================
// PLOTS — Plot data layer
// ============================================================
// A plot is the atomic geographic unit. It owns its geometry as
// references into data.osm (way IDs grouped into outer/inner rings),
// not as inline coordinates. The OGF relation id is metadata for
// round-trip — it does NOT determine the shape (some plots in later
// bricks won't have one at all).
//
// plot = {
//   id,                 // local uid (string)
//   name, notes,
//   ogfRelationId,      // optional, nullable
//   outers: [[wayId, ...], ...],  // list of outer rings
//   inners: [[wayId, ...], ...],  // list of inner rings (holes)
//   flags: [string, ...],         // issue flags; surfaced in Brick 14
//                                 // known values: 'subdivision_remainder'
// }

function createPlot({ name, notes, ogfRelationId, outers, inners, flags }) {
  const plot = {
    id: uid(),
    name: name || '',
    notes: notes || '',
    ogfRelationId: ogfRelationId || null,
    outers: outers || [],
    inners: inners || [],
    flags: flags || [],
  };
  data.plots.push(plot);
  return plot;
}

// Wraps createPlot with project-level mode clipping (v0.9.0). If the
// project's land/water mode requires clipping AND a water cache is
// present, the provided geometry is run through clipPolygonsToMode
// before storage. Plots fully consumed by the clip are rejected (toast
// + null return) rather than created. Modes 'combined' or no-cache
// fall through to plain createPlot with the caller's original refs.
//
// Inputs match createPlot. Returns the new plot, or null on rejection.
function createPlotMaybeClipped(meta) {
  const mode = (data.settings && data.settings.landWaterMode) || 'land_only_sea_water';
  if (mode === 'combined' || !data.waterCache || !data.waterCache.waterGeometry) {
    return createPlot(meta);
  }
  if (typeof clipPolygonsToMode !== 'function' ||
      typeof storeSubdivisionGeometry !== 'function') {
    return createPlot(meta);
  }
  const tempPlot = { outers: meta.outers || [], inners: meta.inners || [] };
  const geo = resolvePlotGeometry(tempPlot);
  if (!geo || !geo.polygons || geo.polygons.length === 0) return createPlot(meta);

  const clip = clipPolygonsToMode(geo.polygons, mode);
  if (clip.dropped || clip.polygons.length === 0) {
    if (typeof toast === 'function') {
      toast(t('landwater.toast_plot_all_water', { name: meta.name || '?' }), 'warning');
    }
    return null;
  }
  // Reference-equal return means clipPolygonsToMode short-circuited
  // (no-cache or 'combined' fallback) and the caller's refs are still
  // good.
  if (clip.polygons === geo.polygons) return createPlot(meta);

  const polysForStore = clip.polygons.map(poly => ({
    outer: _openRingForCreate(poly[0]),
    holes: (poly.slice(1) || []).map(_openRingForCreate),
  })).filter(p => p.outer.length >= 3);
  if (polysForStore.length === 0) {
    if (typeof toast === 'function') {
      toast(t('landwater.toast_plot_all_water', { name: meta.name || '?' }), 'warning');
    }
    return null;
  }
  const { outers, inners } = storeSubdivisionGeometry(polysForStore);
  return createPlot({ ...meta, outers, inners });
}

function _openRingForCreate(ring) {
  if (!ring || ring.length < 2) return ring || [];
  const f = ring[0], l = ring[ring.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) return ring.slice(0, -1);
  return ring.slice();
}

// ============================================================
// GEOMETRY RESOLUTION
// ============================================================
// resolvePlotGeometry walks the plot's way refs and returns Leaflet-
// ready coordinates as a multi-polygon: an array of polygons, each a
// list whose first entry is the outer ring and remaining entries are
// holes. Inners are associated to their containing outer by point-in-
// polygon on the inner's first vertex.

function resolvePlotGeometry(plot, nodeStore, wayStore) {
  const outers = (plot.outers || [])
    .map(ids => assembleRing(ids, nodeStore, wayStore))
    .filter(r => r.length > 0);
  const inners = (plot.inners || [])
    .map(ids => assembleRing(ids, nodeStore, wayStore))
    .filter(r => r.length > 0);

  const polygons = outers.map(outer => [outer]);
  for (const inner of inners) {
    const idx = polygons.findIndex(([outer]) => pointInRing(inner[0], outer));
    if (idx >= 0) polygons[idx].push(inner);
  }
  return { polygons };
}

function plotBounds(plot) {
  return boundsFromGeometry(resolvePlotGeometry(plot));
}

function boundsFromGeometry(geo) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  for (const poly of geo.polygons) {
    for (const ring of poly) {
      for (const [lat, lon] of ring) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
    }
  }
  if (!isFinite(minLat)) return null;
  return { minLat, maxLat, minLon, maxLon };
}

function bboxesIntersect(a, b) {
  if (!a || !b) return false;
  return !(a.maxLat < b.minLat || a.minLat > b.maxLat ||
           a.maxLon < b.minLon || a.minLon > b.maxLon);
}

// ============================================================
// POINT-IN-POLYGON (ray casting)
// ============================================================
// Standard even-odd rule. ring is [[lat, lon], ...]. A vertex on the
// boundary may classify either way — fine for the overlap heuristic
// since we mainly care about strict interior containment.

function pointInRing(pt, ring) {
  const lat = pt[0], lon = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const latI = ring[i][0], lonI = ring[i][1];
    const latJ = ring[j][0], lonJ = ring[j][1];
    const denom = (latJ - latI) || Number.EPSILON;
    const intersect = ((latI > lat) !== (latJ > lat)) &&
      (lon < (lonJ - lonI) * (lat - latI) / denom + lonI);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, polygon) {
  // polygon = [outer, ...holes]
  if (polygon.length === 0 || !pointInRing(pt, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(pt, polygon[i])) return false;
  }
  return true;
}

// ============================================================
// OVERLAP TEST
// ============================================================
// Brick 2 policy: reject overlapping imports, accept disjoint.
// Approach: bbox prefilter, then test if any outer-ring vertex of one
// plot lies strictly inside the other plot. Misses pure edge-crossing
// overlap with no vertex containment, but that's astronomically rare
// for admin polygons — acceptable for this brick.

function plotsOverlap(geoA, geoB) {
  const bbA = boundsFromGeometry(geoA);
  const bbB = boundsFromGeometry(geoB);
  if (!bboxesIntersect(bbA, bbB)) return false;

  for (const polyA of geoA.polygons) {
    for (const polyB of geoB.polygons) {
      for (const v of polyA[0]) {
        if (pointInPolygon(v, polyB)) return true;
      }
      for (const v of polyB[0]) {
        if (pointInPolygon(v, polyA)) return true;
      }
    }
  }
  return false;
}

// ============================================================
// AREA
// ============================================================
// Spherical-excess approximation — same routine Leaflet's geometryutil
// plugin uses. WGS84 reference radius gives results within a few percent
// of true geodesic area for plots up to country-scale, which is plenty
// for demographic stewardship (no surveying-grade requirement here).

const _EARTH_RADIUS_M = 6378137;

function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const d2r = Math.PI / 180;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += (b[1] - a[1]) * d2r * (2 + Math.sin(a[0] * d2r) + Math.sin(b[0] * d2r));
  }
  return Math.abs(sum * _EARTH_RADIUS_M * _EARTH_RADIUS_M / 2);
}

function plotArea(plot) {
  const geo = resolvePlotGeometry(plot);
  let total = 0;
  for (const polygon of geo.polygons) {
    if (polygon.length === 0) continue;
    total += ringAreaM2(polygon[0]);
    for (let i = 1; i < polygon.length; i++) {
      total -= ringAreaM2(polygon[i]);
    }
  }
  return Math.max(0, total);
}

function formatArea(m2) {
  if (!isFinite(m2) || m2 <= 0) return '—';
  if (m2 < 10000) return `${Math.round(m2)} m²`;
  const km2 = m2 / 1e6;
  return `${km2.toFixed(2)} km²`;
}
