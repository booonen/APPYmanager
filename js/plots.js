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
// }

function createPlot({ name, notes, ogfRelationId, outers, inners }) {
  const plot = {
    id: uid(),
    name: name || '',
    notes: notes || '',
    ogfRelationId: ogfRelationId || null,
    outers: outers || [],
    inners: inners || [],
  };
  data.plots.push(plot);
  return plot;
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
