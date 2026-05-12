// ============================================================
// SPLIT — Manual plot split (Brick 11)
// ============================================================
// Two split flavours:
//   • CUT-LINE  — user draws a polyline through a contiguous plot;
//                 the plot becomes two new plots, joined along the cut.
//   • COMPONENT — non-contiguous plot (>1 outer ring) is split into N
//                 plots, one per connected component. No drawing needed.
//
// Both flavours funnel through `executeSplit`, which:
//   - writes new geometry into data.osm via storeSubdivisionGeometry (Brick 5),
//   - creates new plots and copies redistributed property values onto them,
//   - rewrites every boundary's `members` to swap the old plot for the new ids,
//   - invalidates boundary geometry (which also re-anchors settlements).
//
// Coordinate conventions (mirrors subdivide.js):
//   Internal / Leaflet: [lat, lon]
//   GeoJSON / Turf:     [lon, lat]
//
// The two `compute*Split` functions return pure data (no side effects).
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
// COMPONENT SPLIT
// ============================================================
// Splits a non-contiguous plot along its connected components. Each
// polygon in `resolvePlotGeometry().polygons` becomes its own piece.

function computeComponentSplit(plot) {
  if (!plot) return { pieces: [], error: 'no_plot' };
  const geo = resolvePlotGeometry(plot);
  if (geo.polygons.length < 2) {
    return { pieces: [], error: 'contiguous' };
  }
  const pieces = geo.polygons.map(polygon => {
    const [outer, ...holes] = polygon;
    const piece = { outer, holes };
    piece.area = _pieceArea(piece);
    return piece;
  });
  return { pieces };
}

// ============================================================
// CUT-LINE SPLIT
// ============================================================
// User-drawn polyline cuts a contiguous plot into two pieces. The cut
// must enter and exit the outer ring exactly twice. Holes ride along
// with whichever piece contains their first vertex (v1 limitation —
// holes crossed by the cut aren't sub-split).
//
// Returns { pieces: [piece1, piece2], cutVertices } on success, where
// `cutVertices` is the in-polygon portion of the cut for preview rendering.
// Returns { pieces: [], error: '<code>' } on failure.

function computeCutLineSplit(plot, cutLatLngs) {
  if (!plot) return { pieces: [], error: 'no_plot' };
  if (!Array.isArray(cutLatLngs) || cutLatLngs.length < 2) {
    return { pieces: [], error: 'cut_too_short' };
  }

  const geo = resolvePlotGeometry(plot);
  if (geo.polygons.length === 0) return { pieces: [], error: 'no_geometry' };
  if (geo.polygons.length > 1) {
    return { pieces: [], error: 'non_contiguous' };
  }

  const [outer, ...holes] = geo.polygons[0];
  if (!outer || outer.length < 3) return { pieces: [], error: 'no_geometry' };

  // Defensively close the ring — assembleRing returns OPEN rings for
  // multi-way relations but CLOSED rings for single self-closed ways.
  const ringClosed = outer.slice();
  const _f = ringClosed[0], _l = ringClosed[ringClosed.length - 1];
  if (_f[0] !== _l[0] || _f[1] !== _l[1]) ringClosed.push([_f[0], _f[1]]);
  const ringLine = turf.lineString(ringClosed.map(([lat, lon]) => [lon, lat]));
  const cutLine  = turf.lineString(cutLatLngs.map(([lat, lon]) => [lon, lat]));

  // Find all crossings, dedup tightly-clustered ones (turf can return
  // a vertex-coincident hit twice — once per adjacent ring segment).
  const xs = turf.lineIntersect(ringLine, cutLine);
  const xPts = _dedupePoints(xs.features.map(f => f.geometry.coordinates));
  if (xPts.length !== 2) {
    return { pieces: [], error: xPts.length < 2 ? 'cut_does_not_cross' : 'cut_crosses_too_many_times' };
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
  // so `arcAB.coords[end]` and `cutInside.coords[end]` both *intend* to be
  // q.pt but disagree by ~1e-12. Without correction, piece1's ring-side
  // hits q-via-ring while its cut-side hits q-via-cut — a tiny sliver
  // triangle at each crossing. Most consumers (Leaflet, area math)
  // tolerate it, but turf.union (run when a parent boundary re-dissolves
  // piece1+piece2) latches onto the mismatch and leaves the sliver as a
  // visible boundary artefact. Forcing both ends of both arcs AND both
  // ends of the cut to the SAME canonical xPt value eliminates the
  // disagreement at source.
  const pCoord = [p.pt[0], p.pt[1]];
  const qCoord = [q.pt[0], q.pt[1]];
  cutCoordsAtoB[0]                      = pCoord;
  cutCoordsAtoB[cutCoordsAtoB.length-1] = qCoord;
  arcABCoords[0]                        = pCoord;
  arcABCoords[arcABCoords.length-1]     = qCoord;
  arcBACoords[0]                        = qCoord;
  arcBACoords[arcBACoords.length-1]     = pCoord;

  // Piece 1 outer = arcAB (p→q along ring) + reversed cut (q→p along cut)
  // Piece 2 outer = arcBA (q→p along ring) + cut (p→q along cut)
  // Each is a closed ring traversed in one direction with no duplicate
  // endpoint; storeSubdivisionGeometry will self-close on write.
  const piece1Outer = _joinRingFragments(arcABCoords, cutCoordsAtoB.slice().reverse());
  const piece2Outer = _joinRingFragments(arcBACoords, cutCoordsAtoB);

  // Convert back to [lat, lon] for our internal coord system.
  const piece1OuterLatLng = piece1Outer.map(([lon, lat]) => [lat, lon]);
  const piece2OuterLatLng = piece2Outer.map(([lon, lat]) => [lat, lon]);

  // Assign holes by point-in-polygon on the hole's first vertex. Holes
  // that aren't unambiguously inside either piece are dropped (rare;
  // would mean the hole sits exactly on the cut line).
  const piece1Feature = turf.polygon([piece1Outer.concat([piece1Outer[0]])]);
  const piece2Feature = turf.polygon([piece2Outer.concat([piece2Outer[0]])]);
  const piece1Holes = [];
  const piece2Holes = [];
  for (const hole of holes) {
    if (!hole || hole.length < 3) continue;
    const probe = turf.point([hole[0][1], hole[0][0]]);
    if (turf.booleanPointInPolygon(probe, piece1Feature)) piece1Holes.push(hole);
    else if (turf.booleanPointInPolygon(probe, piece2Feature)) piece2Holes.push(hole);
  }

  const piece1 = { outer: piece1OuterLatLng, holes: piece1Holes };
  const piece2 = { outer: piece2OuterLatLng, holes: piece2Holes };
  piece1.area = _pieceArea(piece1);
  piece2.area = _pieceArea(piece2);

  // Sanity: refuse the split if either piece collapsed to ~zero area
  // (would mean the cut grazes the polygon without really dividing it).
  if (piece1.area < 1 || piece2.area < 1) {
    return { pieces: [], error: 'degenerate_split' };
  }

  return {
    pieces: [piece1, piece2],
    cutInside: cutCoordsAtoB.map(([lon, lat]) => [lat, lon]),
  };
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

// ============================================================
// EXECUTOR
// ============================================================
// Replaces `plot` with one new plot per piece. Writes geometry,
// rewrites boundary memberships, applies property values, removes
// the original, and invalidates caches.
//
// names: ['name1', 'name2', ...] — one entry per piece.
// propertyValuesPerPiece: [{ [schemaId]: <value> }, ...] — one entry
//   per piece. Values follow the same shape as plot.propertyValues.
// notesPerPiece: optional. Defaults to inheriting the original's notes
//   on every piece.

function executeSplit(plot, pieces, names, propertyValuesPerPiece, notesPerPiece) {
  if (!plot || !pieces || pieces.length < 2) return null;

  const newPlotIds = [];
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    // storeSubdivisionGeometry self-closes the ring on write, so we MUST
    // hand it an OPEN ring or we'd duplicate the closing vertex.
    const polygons = [{
      outer: _openRing(piece.outer),
      holes: (piece.holes || []).map(_openRing),
    }];
    const { outers, inners } = storeSubdivisionGeometry(polygons);
    const newPlot = createPlot({
      name:          names && names[i] != null ? names[i] : (plot.name || ''),
      notes:         notesPerPiece && notesPerPiece[i] != null ? notesPerPiece[i] : (plot.notes || ''),
      ogfRelationId: null, // split breaks the round-trip mapping; cleared until re-sync
      outers,
      inners,
      flags:         [],
    });
    const valueMap = (propertyValuesPerPiece && propertyValuesPerPiece[i]) || {};
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
