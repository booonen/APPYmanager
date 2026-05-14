// ============================================================
// MERGE — Manual plot merge (Brick 11c)
// ============================================================
// Combines N source plots into one new plot. Mirror-inverse of split.
//
//   • Geometry: turf.union folded across the source plots. Adjacent
//     sources produce a Polygon; non-adjacent sources produce a
//     MultiPolygon (decision D.ii — non-contig merges allowed). Result
//     is run through `storeSubdivisionGeometry` to allocate fresh local
//     OSM ids, then `createPlotMaybeClipped` for project-mode clipping.
//   • Property reconciliation: `proposePlotMergeValues` in properties.js
//     proposes per-schema merged values. The merge modal renders these
//     as editable defaults (decision C).
//   • Boundary memberships: at each boundary type where 2+ source plots
//     have *different* direct parents, ask the user to pick which one
//     the merged plot inherits (decision B.b). Types where all sources
//     agree are inherited automatically.
//   • Settlements: re-anchored via the existing
//     invalidateBoundaryGeometry → reconcileSettlementParents hook.
//   • ogfRelationId: null on the merged plot (decision E.i).
//
// Coordinate conventions (mirrors split.js):
//   Internal / Leaflet: [lat, lon]
//   GeoJSON / Turf:     [lon, lat]
//
// `computePlotMerge` is pure (no mutations). `executePlotMerge` is the
// only function that mutates `data`.

// Pre-flight: returns { sourcePlots, sourceAreas, mergedFeature,
//   isAdjacent, conflicts, autoMemberships, proposedValues,
//   proposedName, proposedNotes }. On failure: { error: '<code>' }.
function computePlotMerge(plotIds) {
  if (!Array.isArray(plotIds) || plotIds.length < 2) {
    return { error: 'merge_too_few' };
  }
  const sourcePlots = plotIds
    .map(id => (data.plots || []).find(p => p.id === id))
    .filter(Boolean);
  if (sourcePlots.length !== plotIds.length) {
    return { error: 'merge_missing_plot' };
  }

  const sourceFeatures = sourcePlots.map(_plotToTurfFeatureForMerge).filter(Boolean);
  if (sourceFeatures.length === 0) return { error: 'no_geometry' };

  let merged = sourceFeatures[0];
  for (let i = 1; i < sourceFeatures.length; i++) {
    try {
      const u = turf.union(merged, sourceFeatures[i]);
      if (u) merged = u;
    } catch (_) { /* keep last successful merge */ }
  }
  const isAdjacent = merged.geometry && merged.geometry.type === 'Polygon';

  const { conflicts, autoMemberships } = _detectBoundaryConflicts(sourcePlots);
  const sourceAreas = sourcePlots.map(p =>
    (typeof plotArea === 'function') ? plotArea(p) : 0
  );
  const proposedValues = (typeof proposePlotMergeValues === 'function')
    ? proposePlotMergeValues(sourcePlots, sourceAreas)
    : {};

  return {
    sourcePlots,
    sourceAreas,
    mergedFeature: merged,
    isAdjacent,
    conflicts,
    autoMemberships,
    proposedValues,
    proposedName:  sourcePlots[0].name  || '',
    proposedNotes: sourcePlots[0].notes || '',
  };
}

// For each boundary type, find every boundary at that type that holds
// at least one of the source plots as a DIRECT member.
//   • 0 such boundaries at a type    → not relevant for this merge.
//   • 1 such boundary                → auto-inherited.
//   • 2+ such boundaries             → conflict, user picks via modal.
function _detectBoundaryConflicts(sourcePlots) {
  const sourceIds = new Set(sourcePlots.map(p => p.id));
  const byType = new Map(); // typeId → Set<boundaryId>
  for (const b of (data.boundaries || [])) {
    for (const m of (b.members || [])) {
      if (m.kind === 'plot' && sourceIds.has(m.id)) {
        if (!byType.has(b.typeId)) byType.set(b.typeId, new Set());
        byType.get(b.typeId).add(b.id);
        break; // one match per boundary is enough
      }
    }
  }
  const conflicts = [];
  const autoMemberships = [];
  for (const [typeId, set] of byType) {
    const ids = Array.from(set);
    if (ids.length === 1) autoMemberships.push(ids[0]);
    else                   conflicts.push({ typeId, boundaryIds: ids });
  }
  return { conflicts, autoMemberships };
}

// Convert a plot to a turf Polygon / MultiPolygon for unioning.
function _plotToTurfFeatureForMerge(plot) {
  if (typeof resolvePlotGeometry !== 'function') return null;
  let geo;
  try { geo = resolvePlotGeometry(plot); } catch (_) { return null; }
  if (!geo || !geo.polygons || geo.polygons.length === 0) return null;

  const polysLngLat = [];
  for (const polygon of geo.polygons) {
    if (!polygon[0] || polygon[0].length < 3) continue;
    const rings = polygon.map(ring => {
      const out = ring.map(([lat, lon]) => [lon, lat]);
      if (out.length >= 2 &&
          (out[0][0] !== out[out.length - 1][0] ||
           out[0][1] !== out[out.length - 1][1])) {
        out.push([out[0][0], out[0][1]]);
      }
      return out;
    });
    polysLngLat.push(rings);
  }
  if (polysLngLat.length === 0) return null;
  try {
    if (polysLngLat.length === 1) return turf.polygon(polysLngLat[0]);
    return turf.multiPolygon(polysLngLat);
  } catch (_) { return null; }
}

// Commit the merge. propertyValues / name / notes feed the new plot.
// boundarySelections: { [conflictTypeId]: chosenBoundaryId | '' (none) }.
// Returns the new plot id or null on failure.
function executePlotMerge(plotIds, name, notes, propertyValues, boundarySelections) {
  if (!Array.isArray(plotIds) || plotIds.length < 2) return null;
  const pre = computePlotMerge(plotIds);
  if (pre.error) return null;
  const { mergedFeature, conflicts, autoMemberships } = pre;

  const polygonsForStore = _mergedFeatureToStorePolygons(mergedFeature);
  if (polygonsForStore.length === 0) return null;
  const { outers, inners } = storeSubdivisionGeometry(polygonsForStore);

  const newPlot = createPlotMaybeClipped({
    name:          name != null ? name : '',
    notes:         notes != null ? notes : '',
    ogfRelationId: null,
    outers,
    inners,
    flags:         [],
  });
  if (!newPlot) return null;

  // Apply property values onto the new plot.
  const valMap = propertyValues || {};
  for (const [schemaId, value] of Object.entries(valMap)) {
    if (value === undefined || value === null || value === '') continue;
    newPlot.propertyValues = newPlot.propertyValues || {};
    newPlot.propertyValues[schemaId] = value;
  }

  // Resolve final boundary memberships.
  const finalBoundaryIds = new Set(autoMemberships || []);
  const selections = boundarySelections || {};
  for (const c of (conflicts || [])) {
    const chosen = selections[c.typeId];
    if (chosen) finalBoundaryIds.add(chosen);
  }

  // Rewrite boundary memberships in one pass:
  //   • drop every source plot id from every boundary
  //   • add the new plot id to boundaries the user kept (or that
  //     auto-inherited)
  const sourceIdSet = new Set(plotIds);
  for (const b of (data.boundaries || [])) {
    const incoming = Array.isArray(b.members) ? b.members : [];
    let touched = false;
    let alreadyHasNew = false;
    const next = [];
    for (const m of incoming) {
      if (m.kind === 'plot' && sourceIdSet.has(m.id)) { touched = true; continue; }
      if (m.kind === 'plot' && m.id === newPlot.id) alreadyHasNew = true;
      next.push(m);
    }
    if (finalBoundaryIds.has(b.id) && !alreadyHasNew) {
      next.push({ kind: 'plot', id: newPlot.id });
      touched = true;
    }
    if (touched) b.members = next;
  }

  // Remove the source plots themselves.
  data.plots = (data.plots || []).filter(p => !sourceIdSet.has(p.id));

  if (typeof invalidateBoundaryGeometry === 'function') invalidateBoundaryGeometry();
  if (typeof save === 'function') save();
  return newPlot.id;
}

function _mergedFeatureToStorePolygons(feature) {
  if (!feature || !feature.geometry) return [];
  const g = feature.geometry;
  const out = [];
  if (g.type === 'Polygon') {
    out.push(_geoJSONPolygonToStoreShape(g.coordinates));
  } else if (g.type === 'MultiPolygon') {
    for (const polyCoords of g.coordinates) {
      out.push(_geoJSONPolygonToStoreShape(polyCoords));
    }
  }
  return out.filter(p => p.outer && p.outer.length >= 3);
}

function _geoJSONPolygonToStoreShape(polyCoords) {
  const rings = polyCoords.map(ring => ring.map(([lon, lat]) => [lat, lon]));
  return {
    outer: _openRingForMerge(rings[0]),
    holes: rings.slice(1).map(_openRingForMerge),
  };
}

function _openRingForMerge(ring) {
  if (!ring || ring.length < 2) return ring || [];
  const f = ring[0], l = ring[ring.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) return ring.slice(0, -1);
  return ring.slice();
}
