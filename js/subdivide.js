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
// SNAP
// ============================================================
// Before handing geometries to Turf, snap the candidate's vertices
// toward the nearest vertex of the parent plot within the tolerance.
// One-directional: only the candidate is modified (returned as a new
// feature); the parent stays canonical. This eliminates the tiny slivers
// that arise when two OGF sources describe the same border with slightly
// different node positions.
//
// toleranceDeg: max snap distance in degrees. Convert from metres using
//   toleranceDeg = snapToleranceM / 111320
// Pass 0 to disable (no-op returns the original feature).

function _collectGeoJSONVerts(feature) {
  const geom = feature.geometry;
  const groups = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat(1);
  const out = [];
  for (const ring of groups) for (const pt of ring) out.push(pt);
  return out;
}

function _snapFeatureToVerts(feature, targetVerts, toleranceDeg) {
  // Returns a deep-cloned copy of feature with vertices snapped.
  const clone = JSON.parse(JSON.stringify(feature));
  const geom = clone.geometry;
  const groups = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat(1);
  for (const ring of groups) {
    for (let i = 0; i < ring.length; i++) {
      const v = ring[i]; // [lon, lat]
      let bestDist = toleranceDeg;
      let snap = null;
      for (const t of targetVerts) {
        const d = Math.sqrt((v[0] - t[0]) ** 2 + (v[1] - t[1]) ** 2);
        if (d < bestDist) { bestDist = d; snap = t; }
      }
      if (snap) ring[i] = [snap[0], snap[1]];
    }
  }
  return clone;
}

function snapCandidateToParent(cFeature, pFeature) {
  const toleranceM  = getSetting('snapToleranceM', 10);
  const toleranceDeg = Number(toleranceM) / 111320;
  if (!(toleranceDeg > 0)) return cFeature;
  const parentVerts = _collectGeoJSONVerts(pFeature);
  return _snapFeatureToVerts(cFeature, parentVerts, toleranceDeg);
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

  // Per-candidate classification:
  //   wrapped[]  — existing plots fully inside the candidate (kept as-is, candidate becomes a wrapper)
  //   partial[]  — existing plots that partially overlap (subdivider case, parent gets replaced)
  // A candidate may produce both (mixed): wrap the wrapped plots + subdivide the partials.
  // Pure-partial cases stay on the legacy subdivider path so behaviour is unchanged for top-down imports.
  const subdividersByPlot = new Map();
  const wraps = [];

  for (const c of candidates) {
    const cFeature = candidateToGeoJSONFeature(c, nodes, ways);
    if (!cFeature) { free.push(c); continue; }

    const wrapped = [];
    const partial = [];
    for (const plot of data.plots) {
      if (!plotsOverlap(c.geometry, resolvePlotGeometry(plot))) continue;
      const pFeature = plotToGeoJSONFeature(plot);
      if (!pFeature) { partial.push({ plot, pFeature: null }); continue; }
      // Plot is fully inside candidate iff (plot - candidate) is empty / noise.
      let outsideC = null;
      try { outsideC = turf.difference(pFeature, cFeature); } catch (_) {}
      const fullyInside = !outsideC || turf.area(outsideC) < REMAINDER_NOISE_FLOOR_M2;
      if (fullyInside) wrapped.push({ plot, pFeature });
      else             partial.push({ plot, pFeature });
    }

    if (wrapped.length === 0 && partial.length === 0) {
      free.push(c);
      continue;
    }

    // Wrap branch: any fully-contained plots go here. Compute the gap (area
    // of `c` not covered by ANY overlapping plot, wrapped or partial).
    if (wrapped.length > 0) {
      let gap = cFeature;
      for (const { pFeature } of [...wrapped, ...partial]) {
        if (!gap) break;
        if (!pFeature) continue;
        try { gap = turf.difference(gap, pFeature); } catch (_) { gap = null; break; }
      }
      const gapFeature = (gap && turf.area(gap) >= REMAINDER_NOISE_FLOOR_M2) ? gap : null;
      wraps.push({
        candidate: c,
        wrappedPlots: wrapped.map(w => w.plot),
        gapFeature,
      });
    }

    // Subdivider branch: partial overlaps go through the legacy split flow.
    for (const { plot } of partial) {
      if (!subdividersByPlot.has(plot.id)) subdividersByPlot.set(plot.id, []);
      subdividersByPlot.get(plot.id).push({ candidate: c, cFeature });
    }
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
      const cSnapped = snapCandidateToParent(cFeature, pFeature);

      let intersection = null;
      try { intersection = turf.intersect(pFeature, cSnapped); } catch (_) {}
      if (!intersection || turf.area(intersection) < 1) continue;

      pieces.push({
        name: c.name || '',
        ogfRelationId: c.ogfRelationId || null,
        feature: intersection,
        candidate: c,
      });

      if (remainderFeature) {
        try { remainderFeature = turf.difference(remainderFeature, cSnapped); } catch (_) {
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

  const wrapGapCount = wraps.reduce((s, w) => s + (w.gapFeature ? 1 : 0), 0);
  const newPlotCount = free.length
    + splits.reduce((s, sp) => s + sp.pieces.length + (sp.remainder ? 1 : 0), 0)
    + wrapGapCount;

  return { free, splits, wraps, newPlotCount };
}

// ============================================================
// PLAN EXECUTION
// ============================================================
// Merges the OGF node/way pools, creates new plots, removes
// replaced parents. Call this from runImportCommit().

// target: { kind: 'plot' } (default) or { kind: 'boundary', typeId }.
// When 'boundary', each imported OGF relation also becomes a Boundary record
// of the chosen type, with its resulting sub-plots as members.
function executeSubdivisionPlan(plan, nodes, ways, target) {
  target = target || { kind: 'plot' };

  // 1. Merge imported pool into data.osm
  for (const id of Object.keys(nodes)) osmAddNode(id, nodes[id].lat, nodes[id].lon);
  for (const id of Object.keys(ways)) osmAddWay(id, ways[id].nodes);

  // Track which plot ids were created for which candidate so the boundary
  // wrap step (below) knows what to bundle.
  const candidateToPlotIds = new Map();
  const trackPlot = (candidate, plotId) => {
    if (!candidate) return;
    if (!candidateToPlotIds.has(candidate)) candidateToPlotIds.set(candidate, []);
    candidateToPlotIds.get(candidate).push(plotId);
  };

  // 2. Free candidates → normal plots
  for (const c of plan.free) {
    const p = createPlot({ name: c.name, ogfRelationId: c.ogfRelationId, outers: c.outers, inners: c.inners });
    trackPlot(c, p.id);
  }

  // 3. Splits: store clipped geometry, create sub-plots, queue parent for removal
  const toRemove = new Set();
  for (const { parentPlot, pieces, remainder } of plan.splits) {
    toRemove.add(parentPlot.id);

    for (const piece of pieces) {
      const polys = _normalizeFeature(piece.feature);
      const { outers, inners } = storeSubdivisionGeometry(polys);
      const p = createPlot({ name: piece.name, ogfRelationId: piece.ogfRelationId, outers, inners });
      trackPlot(piece.candidate, p.id);
    }
    if (remainder) {
      const polys = _normalizeFeature(remainder.feature);
      const { outers, inners } = storeSubdivisionGeometry(polys);
      createPlot({ name: remainder.name, ogfRelationId: null, outers, inners, flags: ['subdivision_remainder'] });
      // Remainders aren't tied to any incoming candidate, so they don't get wrapped.
    }
  }

  // 3b. Wraps: each wrapped existing plot is kept as-is and tracked under
  // the wrapping candidate so the boundary step picks it up. If the
  // candidate has a non-trivial gap (area not covered by any wrapped or
  // partial plot), create a gap plot and track that too.
  for (const w of (plan.wraps || [])) {
    for (const wp of w.wrappedPlots) {
      trackPlot(w.candidate, wp.id);
    }
    if (w.gapFeature) {
      const polys = _normalizeFeature(w.gapFeature);
      const { outers, inners } = storeSubdivisionGeometry(polys);
      const baseName = w.candidate.name || '';
      const gapName  = baseName ? baseName + ' ' + t('import.remainder') : t('import.remainder');
      const p = createPlot({ name: gapName, ogfRelationId: null, outers, inners, flags: ['subdivision_remainder'] });
      trackPlot(w.candidate, p.id);
    }
  }

  // 4. Remove replaced parents. Any boundary that had a parent plot as a
  // direct member is rewritten to instead reference the new sub-plots that
  // came from it — preserving the visual coverage. Exclusivity is preserved
  // because the parent itself is gone.
  if (toRemove.size > 0) {
    // For every parent plot that just got replaced by sub-plots, build the
    // list of new plot ids that cover it. Boundaries that had the parent
    // plot as a direct member are rewritten to reference the new sub-plots,
    // preserving visual coverage.
    const replacements = new Map();
    for (const { parentPlot, pieces } of plan.splits) {
      const ids = [];
      for (const piece of pieces) {
        for (const id of (candidateToPlotIds.get(piece.candidate) || [])) ids.push(id);
      }
      replacements.set(parentPlot.id, [...new Set(ids)]);
    }
    for (const b of data.boundaries) {
      const newMembers = [];
      for (const m of (b.members || [])) {
        if (m.kind === 'plot' && replacements.has(m.id)) {
          for (const newId of replacements.get(m.id)) {
            newMembers.push({ kind: 'plot', id: newId });
          }
        } else {
          newMembers.push(m);
        }
      }
      b.members = newMembers;
    }
    data.plots = data.plots.filter(p => !toRemove.has(p.id));
  }

  // 5. Wrap each candidate as a boundary if the user chose that target.
  if (target.kind === 'boundary' && target.typeId) {
    for (const [candidate, plotIds] of candidateToPlotIds) {
      if (plotIds.length === 0) continue;
      createBoundary({
        name:    candidate.name || '',
        typeId:  target.typeId,
        members: plotIds.map(id => ({ kind: 'plot', id })),
      });
    }
  }
}
