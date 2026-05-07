// ============================================================
// SUBDIVIDE — Polygon-clipping engine for Brick 5
// ============================================================
// When imported boundaries overlap existing plots, instead of
// rejecting them we intersect them with the existing plot canvas
// and create new sub-plots. Each parent plot that gets touched is
// replaced by the intersection pieces plus any remainder.
//
// Coordinate conventions:
//   Internal (data.osm / Leaflet): [lat, lon]
//   GeoJSON / Turf.js:             [lon, lat]
//
// Local OSM ids: `nextLocalOsmId()` returns decrementing negative
// integers. One node per vertex, one self-closing way per ring.

// Remainders smaller than this are pure floating-point noise from Turf and are
// dropped silently. Anything above it is kept and flagged 'subdivision_remainder'
// so Brick 14's issues panel can surface it for user review.
const REMAINDER_NOISE_FLOOR_M2 = 1;

// ============================================================
// COORDINATE HELPERS
// ============================================================

function _ringToGeoJSON(ring) {
  // [lat,lon][] → closed GeoJSON ring [lon,lat][]
  const coords = ring.map(([lat, lon]) => [lon, lat]);
  if (coords.length > 0) {
    const f = coords[0], l = coords[coords.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) coords.push([f[0], f[1]]);
  }
  return coords;
}

function _geoJSONToRing(coords) {
  // GeoJSON ring [lon,lat][] → open [lat,lon][] (drops closing duplicate)
  const pts = coords.map(([lon, lat]) => [lat, lon]);
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) pts.pop();
  }
  return pts;
}

// ============================================================
// FEATURE BUILDERS
// ============================================================

function plotToGeoJSONFeature(plot) {
  const geo = resolvePlotGeometry(plot);
  return _geoFromPolygons(geo.polygons);
}

function candidateToGeoJSONFeature(candidate, nodes, ways) {
  const geo = resolvePlotGeometry(candidate, nodes, ways);
  return _geoFromPolygons(geo.polygons);
}

function _geoFromPolygons(polygons) {
  const valid = polygons.filter(p => p.length > 0 && p[0].length >= 3);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    const [outer, ...holes] = valid[0];
    try {
      return turf.polygon([_ringToGeoJSON(outer), ...holes.map(_ringToGeoJSON)]);
    } catch (_) { return null; }
  }
  try {
    return turf.multiPolygon(
      valid.map(([outer, ...holes]) => [_ringToGeoJSON(outer), ...holes.map(_ringToGeoJSON)])
    );
  } catch (_) { return null; }
}

// Flatten a Turf Feature (Polygon or MultiPolygon) back to {outer,holes}[] using our coord system.
function _normalizeFeature(feature) {
  if (!feature) return [];
  const geom = feature.geometry || feature;
  if (geom.type === 'Polygon') {
    const [outer, ...holes] = geom.coordinates;
    return [{ outer: _geoJSONToRing(outer), holes: holes.map(_geoJSONToRing) }];
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map(([outer, ...holes]) => ({
      outer: _geoJSONToRing(outer),
      holes: holes.map(_geoJSONToRing),
    }));
  }
  return [];
}

// ============================================================
// OSM WRITE-BACK
// ============================================================
// Stores computed polygon rings into data.osm as local negative-id
// nodes + a single self-closing way per ring. Returns arrays of
// way-id-lists ready to drop into createPlot({ outers, inners }).

function storeSubdivisionGeometry(polygons) {
  const outerRings = [];
  const innerRings = [];
  for (const { outer, holes } of polygons) {
    if (outer.length >= 3) outerRings.push(_storeRingAsWay(outer));
    for (const hole of holes) {
      if (hole.length >= 3) innerRings.push(_storeRingAsWay(hole));
    }
  }
  return { outers: outerRings, inners: innerRings };
}

function _storeRingAsWay(ring) {
  const wayId = nextLocalOsmId();
  const nodeIds = ring.map(([lat, lon]) => {
    const nid = nextLocalOsmId();
    data.osm.nodes[nid] = { lat, lon };
    return nid;
  });
  // Self-closing: last node = first node (OSM multipolygon convention).
  if (nodeIds.length > 0) nodeIds.push(nodeIds[0]);
  data.osm.ways[wayId] = { nodes: nodeIds };
  return [wayId];
}

// ============================================================
// SUBDIVISION PLAN
// ============================================================
// A "plan" is pure data — no side effects on data.osm / data.plots.
// The preview step builds it; the commit step executes it.
//
// plan = {
//   free:   [candidate, ...],   // will become new plots as-is
//   splits: [{
//     parentPlot,               // existing plot being replaced
//     pieces: [{                // one per overlapping candidate
//       name, ogfRelationId,
//       feature,                // Turf Feature for preview map
//     }],
//     remainder: { name, feature } | null,
//   }],
//   newPlotCount: number,       // free.length + sum(pieces) + remainders
// }

function computeSubdivisionPlan(candidates, nodes, ways) {
  const free = [];

  // Map: plotId → [{candidate, candidateFeature}]
  const subdividersByPlot = new Map();

  for (const c of candidates) {
    const cFeature = candidateToGeoJSONFeature(c, nodes, ways);
    if (!cFeature) { free.push(c); continue; }

    let overlapsAny = false;
    for (const plot of data.plots) {
      if (!plotsOverlap(c.geometry, resolvePlotGeometry(plot))) continue;
      overlapsAny = true;
      if (!subdividersByPlot.has(plot.id)) subdividersByPlot.set(plot.id, []);
      subdividersByPlot.get(plot.id).push({ candidate: c, cFeature });
    }
    if (!overlapsAny) free.push(c);
  }

  const splits = [];
  for (const [plotId, entries] of subdividersByPlot) {
    const parentPlot = data.plots.find(p => p.id === plotId);
    if (!parentPlot) continue;

    const pFeature = plotToGeoJSONFeature(parentPlot);
    if (!pFeature) continue;

    const pieces = [];
    let remainderFeature = pFeature;

    for (const { candidate: c, cFeature } of entries) {
      let intersection = null;
      try { intersection = turf.intersect(pFeature, cFeature); } catch (_) {}
      if (!intersection || turf.area(intersection) < 1) continue;

      pieces.push({
        name: c.name || '',
        ogfRelationId: c.ogfRelationId || null,
        feature: intersection,
      });

      if (remainderFeature) {
        try { remainderFeature = turf.difference(remainderFeature, cFeature); } catch (_) {
          remainderFeature = null;
        }
      }
    }

    let remainder = null;
    if (remainderFeature && turf.area(remainderFeature) >= REMAINDER_NOISE_FLOOR_M2) {
      const base = parentPlot.name || '';
      remainder = {
        name: base ? base + ' ' + t('import.remainder') : t('import.remainder'),
        feature: remainderFeature,
      };
    }

    if (pieces.length > 0) {
      splits.push({ parentPlot, pieces, remainder });
    }
  }

  const newPlotCount = free.length
    + splits.reduce((s, sp) => s + sp.pieces.length + (sp.remainder ? 1 : 0), 0);

  return { free, splits, newPlotCount };
}

// ============================================================
// PLAN EXECUTION
// ============================================================
// Merges the OGF node/way pools, creates new plots, removes
// replaced parents. Call this from runImportCommit().

function executeSubdivisionPlan(plan, nodes, ways) {
  // 1. Merge imported pool into data.osm
  for (const id of Object.keys(nodes)) osmAddNode(id, nodes[id].lat, nodes[id].lon);
  for (const id of Object.keys(ways)) osmAddWay(id, ways[id].nodes);

  // 2. Free candidates → normal plots
  for (const c of plan.free) {
    createPlot({ name: c.name, ogfRelationId: c.ogfRelationId, outers: c.outers, inners: c.inners });
  }

  // 3. Splits: store clipped geometry, create sub-plots, queue parent for removal
  const toRemove = new Set();
  for (const { parentPlot, pieces, remainder } of plan.splits) {
    toRemove.add(parentPlot.id);

    for (const piece of pieces) {
      const polys = _normalizeFeature(piece.feature);
      const { outers, inners } = storeSubdivisionGeometry(polys);
      createPlot({ name: piece.name, ogfRelationId: piece.ogfRelationId, outers, inners });
    }
    if (remainder) {
      const polys = _normalizeFeature(remainder.feature);
      const { outers, inners } = storeSubdivisionGeometry(polys);
      createPlot({ name: remainder.name, ogfRelationId: null, outers, inners, flags: ['subdivision_remainder'] });
    }
  }

  // 4. Remove replaced parents
  data.plots = data.plots.filter(p => !toRemove.has(p.id));
}
