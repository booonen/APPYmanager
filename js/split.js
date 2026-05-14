// ============================================================
// SPLIT — Manual plot split (Brick 11 + 11b)
// ============================================================
// Unified split engine (Brick 11b #2): a single `computePlotSplit(plot,
// cuts)` handles both contiguous and non-contiguous plots, with the
// component-mode behaviour falling out as "non-contig + no cut drawn".
//
//   • Cuts is an array of polylines (Brick 11b A.ii — `cuts: Polyline[]`).
//     v1 of #2 keeps `cuts.length <= 1` and the editor only manages
//     `cuts[0]`; Brick 11b #1 promotes this to N cuts.
//   • For each outer ring of the plot's geometry:
//       0 crossings with cut[0] → ring passes through as one piece.
//       2 crossings           → ring splits into two sub-pieces.
//       1 / 3 / 4+            → cut rejected (cut must enter and exit).
//   • An empty cut + non-contig plot → one piece per ring (component
//     behaviour preserved as the default).
//
// Pieces feed into output groups (Brick 11b B.i): the redistribution
// panel exposes an "Output" dropdown per piece, multiple pieces can
// merge into one output, and a single non-contig output is supported
// (cross-ring merge → multi-polygon plot).
//
// `executeSplit` consumes the user's output groups (not raw pieces),
// unions per-output geometry, and produces one new plot per output.
//
// Coordinate conventions (mirrors subdivide.js):
//   Internal / Leaflet: [lat, lon]
//   GeoJSON / Turf:     [lon, lat]
//
// The compute* functions return pure data (no side effects).
// `executeSplit` is the only function that mutates `data`.

// ============================================================
// PLOT-LEVEL HELPERS
// ============================================================

function isPlotNonContiguous(plot) {
  if (!plot) return false;
  const geo = resolvePlotGeometry(plot);
  return geo.polygons.length > 1;
}

// Returns the area of a single { outer, holes } piece, in m².
function _pieceArea(piece) {
  if (!piece || !piece.outer || piece.outer.length < 3) return 0;
  const outerA = ringAreaM2(piece.outer);
  const holesA = (piece.holes || []).reduce((s, h) => s + ringAreaM2(h), 0);
  return Math.max(0, outerA - holesA);
}

// ============================================================
// UNIFIED PLOT SPLIT
// ============================================================
// Single entry point. `cuts` is `Polyline[]`; Brick 11b #2 only ever
// uses cuts.length <= 1 (the active cut), but the signature accepts
// the array so #1's multi-cut work doesn't need to reshape the engine.
//
// Behaviour:
//   • No cut drawn (or cut < 2 vertices) → every outer ring becomes one
//     piece. Falls out as "component mode" for non-contig plots; for
//     contig plots it just returns the single plot as one piece (and
//     the panel disables Confirm).
//   • Cut drawn → run computeRingCutSplit per outer ring. Rings with
//     0 crossings pass through; rings with 2 crossings split; any ring
//     with 1/3/4+ crossings aborts the whole split with an error.
//
// Returns { pieces, cutInside, error? } where `cutInside` is the in-
// polygon portion of cut[0] across all crossed rings (for preview
// rendering — concatenated lat/lng segments).

function computePlotSplit(plot, cuts) {
  if (!plot) return { pieces: [], error: 'no_plot' };
  const geo = resolvePlotGeometry(plot);
  if (geo.polygons.length === 0) return { pieces: [], error: 'no_geometry' };

  const cut = Array.isArray(cuts) && cuts.length > 0 ? cuts[0] : null;
  const hasCut = Array.isArray(cut) && cut.length >= 2;

  // No cut drawn → one piece per ring (component-mode default).
  if (!hasCut) {
    const pieces = geo.polygons.map(polygon => {
      const [outer, ...holes] = polygon;
      const piece = { outer, holes };
      piece.area = _pieceArea(piece);
      return piece;
    }).filter(p => p.outer && p.outer.length >= 3);
    return { pieces, cutInside: null };
  }

  // Cut drawn → per-ring split. Each ring contributes 1 piece (no
  // crossings) or 2 pieces (2 crossings); other crossing counts reject.
  const cutLine = turf.lineString(cut.map(([lat, lon]) => [lon, lat]));
  const allPieces = [];
  const cutInsideSegments = [];
  let crossedAny = false;

  for (const polygon of geo.polygons) {
    const [outer, ...holes] = polygon;
    if (!outer || outer.length < 3) continue;

    const split = _splitOneRing(outer, holes, cutLine);
    if (split.error) return { pieces: [], error: split.error };

    allPieces.push(...split.pieces);
    if (split.cutInside) {
      cutInsideSegments.push(split.cutInside);
      crossedAny = true;
    }
  }

  if (!crossedAny) {
    return { pieces: [], error: 'cut_does_not_cross' };
  }
  return {
    pieces: allPieces,
    cutInside: cutInsideSegments.length === 1 ? cutInsideSegments[0] : cutInsideSegments,
  };
}

// Per-ring cut application. Returns:
//   { pieces: [one piece],          cutInside: null }   — 0 crossings
//   { pieces: [piece1, piece2],     cutInside: [...] }  — 2 crossings
//   { pieces: [], error: '<code>' }                     — 1 / 3 / 4+ crossings
function _splitOneRing(outer, holes, cutLine) {
  // Defensively close the ring — assembleRing returns OPEN rings for
  // multi-way relations but CLOSED rings for single self-closed ways.
  const ringClosed = outer.slice();
  const _f = ringClosed[0], _l = ringClosed[ringClosed.length - 1];
  if (_f[0] !== _l[0] || _f[1] !== _l[1]) ringClosed.push([_f[0], _f[1]]);
  const ringLine = turf.lineString(ringClosed.map(([lat, lon]) => [lon, lat]));

  const xs = turf.lineIntersect(ringLine, cutLine);
  const xPts = _dedupePoints(xs.features.map(f => f.geometry.coordinates));

  // No crossings → ring passes through unchanged.
  if (xPts.length === 0) {
    const piece = { outer, holes: holes || [] };
    piece.area = _pieceArea(piece);
    return { pieces: [piece], cutInside: null };
  }
  // Anything other than 2 crossings is malformed for this brick.
  // Brick 11b #1 (multi-cut) will revisit 4+ crossings.
  if (xPts.length !== 2) {
    return { pieces: [], error: xPts.length === 1 ? 'cut_crosses_ring_once' : 'cut_crosses_too_many_times' };
  }

  const ringLen = turf.length(ringLine);
  const cutLen  = turf.length(cutLine);

  const A = _projectPoint(ringLine, cutLine, xPts[0]);
  const B = _projectPoint(ringLine, cutLine, xPts[1]);

  // Order so the "first crossing on the cut" is A. Keeps cut traversal A→B.
  let p, q;
  if (A.cutT <= B.cutT) { p = A; q = B; } else { p = B; q = A; }

  // Cut interior: the part between the two crossings, oriented p→q.
  const cutInside = _safeLineSliceAlong(cutLine, p.cutT, q.cutT, cutLen);
  if (!cutInside) return { pieces: [], error: 'cut_slice_failed' };
  const cutCoordsAtoB = cutInside.geometry.coordinates;

  // Ring arcs: two complementary spans of the ring, both walked forward.
  // arcAB goes p.ringT → q.ringT; arcBA goes q.ringT → p.ringT (wraps).
  const arcAB = _ringSliceForward(ringLine, p.ringT, q.ringT, ringLen);
  const arcBA = _ringSliceForward(ringLine, q.ringT, p.ringT, ringLen);
  if (!arcAB || !arcBA) return { pieces: [], error: 'cut_slice_failed' };
  const arcABCoords = arcAB.geometry.coordinates;
  const arcBACoords = arcBA.geometry.coordinates;

  // **Snap intersection endpoints to canonical coords.** turf.lineSliceAlong
  // rebuilds each endpoint independently from the line's parameterisation,
  // so the ring-side and cut-side endpoints disagree by ~1e-12 even
  // though they "should" be the same point. Forcing both to the canonical
  // xPt value avoids sliver triangles at each crossing (which surface in
  // turf.union later when a parent boundary re-dissolves the pieces).
  const pCoord = [p.pt[0], p.pt[1]];
  const qCoord = [q.pt[0], q.pt[1]];
  cutCoordsAtoB[0]                      = pCoord;
  cutCoordsAtoB[cutCoordsAtoB.length-1] = qCoord;
  arcABCoords[0]                        = pCoord;
  arcABCoords[arcABCoords.length-1]     = qCoord;
  arcBACoords[0]                        = qCoord;
  arcBACoords[arcBACoords.length-1]     = pCoord;

  const piece1Outer = _joinRingFragments(arcABCoords, cutCoordsAtoB.slice().reverse());
  const piece2Outer = _joinRingFragments(arcBACoords, cutCoordsAtoB);

  const piece1OuterLatLng = piece1Outer.map(([lon, lat]) => [lat, lon]);
  const piece2OuterLatLng = piece2Outer.map(([lon, lat]) => [lat, lon]);

  // Assign holes by point-in-polygon on the hole's first vertex.
  const piece1Feature = turf.polygon([piece1Outer.concat([piece1Outer[0]])]);
  const piece2Feature = turf.polygon([piece2Outer.concat([piece2Outer[0]])]);
  const piece1Holes = [];
  const piece2Holes = [];
  for (const hole of (holes || [])) {
    if (!hole || hole.length < 3) continue;
    const probe = turf.point([hole[0][1], hole[0][0]]);
    if (turf.booleanPointInPolygon(probe, piece1Feature)) piece1Holes.push(hole);
    else if (turf.booleanPointInPolygon(probe, piece2Feature)) piece2Holes.push(hole);
  }

  const piece1 = { outer: piece1OuterLatLng, holes: piece1Holes };
  const piece2 = { outer: piece2OuterLatLng, holes: piece2Holes };
  piece1.area = _pieceArea(piece1);
  piece2.area = _pieceArea(piece2);

  // Sanity: refuse if either sub-piece collapsed to ~zero area.
  if (piece1.area < 1 || piece2.area < 1) {
    return { pieces: [], error: 'degenerate_split' };
  }

  return {
    pieces: [piece1, piece2],
    cutInside: cutCoordsAtoB.map(([lon, lat]) => [lat, lon]),
  };
}

// Legacy entry points retained as thin wrappers. The unified engine
// fully covers both — these exist so any straggler caller from earlier
// bricks keeps working until grep confirms they're all migrated.
function computeCutLineSplit(plot, cutLatLngs) {
  return computePlotSplit(plot, [cutLatLngs]);
}
function computeComponentSplit(plot) {
  return computePlotSplit(plot, []);
}

// ============================================================
// CUT-LINE INTERNALS
// ============================================================

// Two GeoJSON points within ~1e-9 degrees are "the same point" — a
// crossing that lands on a ring vertex is reported twice by turf,
// once per adjacent segment. Dedup so the two-crossings count is honest.
function _dedupePoints(coords) {
  const eps = 1e-9;
  const out = [];
  for (const c of coords) {
    if (out.some(o => Math.abs(o[0] - c[0]) < eps && Math.abs(o[1] - c[1]) < eps)) continue;
    out.push(c);
  }
  return out;
}

// Returns { pt, ringT, cutT } where ringT and cutT are distances along
// ringLine and cutLine respectively (km, turf default units).
function _projectPoint(ringLine, cutLine, lonLat) {
  const pt = turf.point(lonLat);
  const nr = turf.nearestPointOnLine(ringLine, pt);
  const nc = turf.nearestPointOnLine(cutLine, pt);
  return {
    pt: lonLat,
    ringT: nr.properties.location,
    cutT:  nc.properties.location,
  };
}

// turf.lineSliceAlong rejects start === stop and can NaN on
// floating-point fuzz at the very ends. This guard nudges the bounds
// away from collisions.
function _safeLineSliceAlong(line, start, stop, totalLen) {
  if (!(stop > start)) return null;
  // Clamp to [0, totalLen] with a tiny epsilon to avoid turf's edge cases.
  const eps = Math.min(1e-6, totalLen * 1e-6);
  const s = Math.max(0, Math.min(totalLen - eps, start));
  const e = Math.max(s + eps, Math.min(totalLen, stop));
  try { return turf.lineSliceAlong(line, s, e); }
  catch (_) { return null; }
}

// Walk a closed ring forward from start to end (both distances along
// ringLine, in km). When start > end the slice wraps through the ring's
// origin: two slices stitched together.
function _ringSliceForward(ringLine, start, end, totalLen) {
  if (start === end) return null;
  if (start < end) return _safeLineSliceAlong(ringLine, start, end, totalLen);
  const first  = _safeLineSliceAlong(ringLine, start, totalLen, totalLen);
  const second = _safeLineSliceAlong(ringLine, 0, end, totalLen);
  if (!first || !second) return null;
  const a = first.geometry.coordinates;
  const b = second.geometry.coordinates;
  // Drop the duplicate junction vertex (ringLine's start === ringLine's end).
  return turf.lineString(a.concat(b.slice(1)));
}

// Concat two coord sequences that share their first/last endpoints
// (arc ends at q, reversed-cut starts at q → drop one of them). The
// result is an OPEN ring (no closing duplicate); the OSM write-back
// in storeSubdivisionGeometry adds the self-close.
function _joinRingFragments(arcCoords, cutCoords) {
  if (arcCoords.length === 0) return cutCoords.slice();
  if (cutCoords.length === 0) return arcCoords.slice();
  // arc's last ≈ cut's first (both are the same intersection point).
  // Drop cut's first to avoid duplication.
  return arcCoords.concat(cutCoords.slice(1));
}

// Drop a closing duplicate vertex if the ring already wraps around to
// its start. Used before handing pieces to storeSubdivisionGeometry,
// which self-closes its rings (passing it a closed input would
// duplicate the wrap vertex into two distinct OSM nodes).
function _openRing(ring) {
  if (!ring || ring.length < 2) return ring || [];
  const f = ring[0], l = ring[ring.length - 1];
  if (f[0] === l[0] && f[1] === l[1]) return ring.slice(0, -1);
  return ring.slice();
}

// Convert an output's pieces into the [{ outer, holes }, ...] shape
// `storeSubdivisionGeometry` expects. Single-piece outputs pass straight
// through; multi-piece outputs are unioned via turf so a merged output
// becomes one new plot (potentially multi-polygon when the pieces come
// from different rings of a non-contig parent).
function _outputToStorePolygons(output) {
  const pieces = (output && output.pieces) || [];
  if (pieces.length === 0) return [];
  if (pieces.length === 1) {
    const p = pieces[0];
    return [{
      outer: _openRing(p.outer),
      holes: (p.holes || []).map(_openRing),
    }];
  }
  // Multi-piece: union to a single Feature, then unpack each polygon
  // back to { outer, holes } form.
  const features = [];
  for (const p of pieces) {
    if (!p.outer || p.outer.length < 3) continue;
    const rings = [_ringToTurf(p.outer)];
    for (const h of (p.holes || [])) {
      if (h && h.length >= 3) rings.push(_ringToTurf(h));
    }
    try { features.push(turf.polygon(rings)); } catch (_) { /* skip degenerate */ }
  }
  if (features.length === 0) return [];
  let merged = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      const u = turf.union(merged, features[i]);
      if (u) merged = u;
    } catch (_) { /* keep last successful merge */ }
  }
  const g = merged.geometry;
  const polys = [];
  if (g.type === 'Polygon') {
    polys.push(_turfPolygonToLeaflet(g.coordinates));
  } else if (g.type === 'MultiPolygon') {
    for (const polyCoords of g.coordinates) {
      polys.push(_turfPolygonToLeaflet(polyCoords));
    }
  }
  return polys;
}

// Helpers used only by _outputToStorePolygons.
function _ringToTurf(ringLatLng) {
  const out = ringLatLng.map(([lat, lon]) => [lon, lat]);
  if (out.length >= 2 &&
      (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}
function _turfPolygonToLeaflet(polyCoords) {
  const rings = polyCoords.map(ring => ring.map(([lon, lat]) => [lat, lon]));
  const outer = _openRing(rings[0]);
  const holes = rings.slice(1).map(_openRing);
  return { outer, holes };
}

// ============================================================
// EXECUTOR
// ============================================================
// Replaces `plot` with one new plot per OUTPUT (Brick 11b B.i). Each
// output is `{ pieces: [piece, ...] }` — single-piece outputs slot
// straight through, multi-piece outputs are unioned via turf so a
// merged output becomes one new plot (potentially multi-polygon when
// pieces come from different rings of a non-contig parent).
//
// names: ['name0', 'name1', ...] — one entry per output.
// propertyValuesPerOutput: [{ [schemaId]: <value> }, ...] — per output.
// notesPerOutput: optional; defaults to inheriting parent notes.

function executeSplit(plot, outputs, names, propertyValuesPerOutput, notesPerOutput) {
  if (!plot || !outputs || outputs.length < 2) return null;

  const newPlotIds = [];
  for (let i = 0; i < outputs.length; i++) {
    const output = outputs[i];
    const polygons = _outputToStorePolygons(output);
    if (polygons.length === 0) continue;

    const { outers, inners } = storeSubdivisionGeometry(polygons);
    const newPlot = createPlotMaybeClipped({
      name:          names && names[i] != null ? names[i] : (plot.name || ''),
      notes:         notesPerOutput && notesPerOutput[i] != null ? notesPerOutput[i] : (plot.notes || ''),
      ogfRelationId: null, // split breaks the round-trip mapping; re-sync restores it
      outers,
      inners,
      flags:         [],
    });
    if (!newPlot) continue;
    const valueMap = (propertyValuesPerOutput && propertyValuesPerOutput[i]) || {};
    for (const [schemaId, value] of Object.entries(valueMap)) {
      if (value === undefined || value === null || value === '') continue;
      newPlot.propertyValues = newPlot.propertyValues || {};
      newPlot.propertyValues[schemaId] = value;
    }
    newPlotIds.push(newPlot.id);
  }

  // Rewrite boundary memberships: any boundary that had `plot` as a
  // direct member now contains all the new pieces in its place.
  // Sub-boundaries that referenced `plot` indirectly (i.e. via their
  // own sub-boundaries) need no action — they reference boundary ids,
  // not plot ids.
  for (const b of data.boundaries) {
    const newMembers = [];
    let rewrote = false;
    for (const m of (b.members || [])) {
      if (m.kind === 'plot' && m.id === plot.id) {
        for (const newId of newPlotIds) newMembers.push({ kind: 'plot', id: newId });
        rewrote = true;
      } else {
        newMembers.push(m);
      }
    }
    if (rewrote) b.members = newMembers;
  }

  // Settlements pointing at `plot.id` will dangle; reconcileSettlementParents
  // (run by invalidateBoundaryGeometry) re-anchors them by point-in-polygon
  // against the new pieces.
  data.plots = data.plots.filter(p => p.id !== plot.id);
  invalidateBoundaryGeometry();
  save();

  return newPlotIds;
}
