// ============================================================
// SPLIT — Manual plot split (Brick 11 + 11b)
// ============================================================
// `computePlotSplit(plot, cuts)` builds a planar subdivision (Brick 11b
// #1) from the plot's outer rings + zero or more user-drawn cuts.
//
//   • Cuts is an array of polylines. Empty / sub-2-vertex cuts are
//     ignored. Self-intersecting cuts are rejected upfront.
//   • Algorithm per outer ring:
//       1. Find every intersection: cut↔cut (pairwise), cut↔ring.
//       2. Slice each cut at its intersection points → sub-segments,
//          each labelled by endpoint type: 'ring' / 'cutcut' / 'endpoint'.
//       3. Discard sub-segments whose midpoint lies outside the plot
//          (outside the outer ring, or inside a hole).
//       4. Iterative dangling-trim: a sub-segment with an 'endpoint'
//          end, or a 'cutcut' end whose node now has fewer than 2
//          slices touching it, is discarded. Repeat until stable.
//       5. Slice the outer ring at all ring↔cut intersection points.
//       6. Feed (ring segments + retained cut sub-segments) to
//          turf.polygonize. Each bounded face inside the plot is a
//          piece.
//       7. Holes (inner rings) ride along with whichever piece
//          contains their first vertex (today's punt — a cut that
//          physically crosses a hole boundary is unsupported, the
//          dangling-trim discards those segments quietly).
//   • No cuts (or every cut dangles away to nothing) → one piece per
//     outer ring (the old component-mode default).
//
// Pieces feed into output groups (Brick 11b #2): the redistribution
// panel exposes an "Output" dropdown per piece, multiple pieces merge
// into one output, cross-ring merges produce multi-polygon outputs.
// `executeSplit` consumes the user's groupings (not raw pieces).
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
function computePlotSplit(plot, cuts) {
  if (!plot) return { pieces: [], error: 'no_plot' };
  const geo = resolvePlotGeometry(plot);
  if (geo.polygons.length === 0) return { pieces: [], error: 'no_geometry' };

  // Drop empty / single-vertex cuts.
  const liveCuts = (Array.isArray(cuts) ? cuts : [])
    .filter(c => Array.isArray(c) && c.length >= 2);

  // No usable cuts → one piece per outer ring (component fallthrough).
  if (liveCuts.length === 0) {
    const pieces = geo.polygons.map(polygon => {
      const [outer, ...holes] = polygon;
      const piece = { outer, holes, cutAffected: false };
      piece.area = _pieceArea(piece);
      return piece;
    }).filter(p => p.outer && p.outer.length >= 3);
    return { pieces, cutInside: null };
  }

  // Self-intersection check — reject the whole split with a single
  // error pointing at the offending cut index (v0.9.2 trial showed
  // self-intersecting cuts double-count the loop's interior).
  for (let i = 0; i < liveCuts.length; i++) {
    if (_cutSelfIntersects(liveCuts[i])) {
      return { pieces: [], error: 'cut_self_intersects' };
    }
  }

  const allPieces = [];
  const allCutInside = [];
  let crossedAny = false;
  for (const polygon of geo.polygons) {
    const [outer, ...holes] = polygon;
    if (!outer || outer.length < 3) continue;

    const res = _multiCutOneRing(outer, holes, liveCuts);
    if (res.error) return { pieces: [], error: res.error };
    allPieces.push(...res.pieces);
    if (res.cutInside) allCutInside.push(...res.cutInside);
    if (res.crossedAny) crossedAny = true;
  }

  if (!crossedAny) {
    return { pieces: [], error: 'cut_does_not_cross' };
  }
  return { pieces: allPieces, cutInside: allCutInside };
}

// Per-outer-ring planar subdivision. See the module header for the
// full algorithm. Returns:
//   { pieces, cutInside, crossedAny }     — success (≥ 1 piece)
//   { pieces: [], error: '...' }          — hard failure
function _multiCutOneRing(outer, holes, cuts) {
  // Close the ring for line ops.
  const ringClosed = outer.slice();
  const _rf = ringClosed[0], _rl = ringClosed[ringClosed.length - 1];
  if (_rf[0] !== _rl[0] || _rf[1] !== _rl[1]) ringClosed.push([_rf[0], _rf[1]]);
  const ringLine = turf.lineString(ringClosed.map(([lat, lon]) => [lon, lat]));
  const cutLines = cuts.map(c => turf.lineString(c.map(([lat, lon]) => [lon, lat])));

  // Cut↔ring intersections per cut.
  const cutRingIxs = cutLines.map(cl =>
    _dedupePoints(turf.lineIntersect(cl, ringLine).features.map(f => f.geometry.coordinates))
  );
  // Cut↔cut intersections (pairwise) — collected per cut.
  const cutCutIxs = cutLines.map(() => []);
  for (let i = 0; i < cutLines.length; i++) {
    for (let j = i + 1; j < cutLines.length; j++) {
      const pts = _dedupePoints(
        turf.lineIntersect(cutLines[i], cutLines[j]).features.map(f => f.geometry.coordinates)
      );
      cutCutIxs[i].push(...pts);
      cutCutIxs[j].push(...pts);
    }
  }

  // Slice each cut at (ringIxs ∪ cutCutIxs); label endpoint types.
  // We don't early-return on "no ring crossings" because a closed loop
  // formed by cuts crossing each other entirely inside the ring (no
  // touching the ring at all) is a legitimate enclave — the planar
  // subdivision should still find it.
  const slices = [];
  for (let i = 0; i < cutLines.length; i++) {
    slices.push(..._sliceCutAtPoints(cutLines[i], cutRingIxs[i], cutCutIxs[i]));
  }

  // Drop slices whose midpoint lies outside the outer ring or inside
  // a hole — those segments don't divide the plot interior.
  const insideSlices = slices.filter(s => _sliceMidpointInsidePlot(s, ringClosed, holes));

  // Iterative dangling-trim: keep only slices whose endpoints are
  // either on the ring OR at a cutcut node with ≥ 2 surviving touches.
  const retained = _trimDangling(insideSlices);
  if (retained.length === 0) {
    // No retained slices → no cut affected this ring. Tagging the
    // piece as untouched lets the panel keep islands grouped in the
    // default output (v0.11.2).
    const piece = { outer, holes: holes || [], cutAffected: false };
    piece.area = _pieceArea(piece);
    return { pieces: [piece], cutInside: null, crossedAny: false };
  }

  // Build the noded linework for polygonize: ring segments + retained
  // cut slices. The ring is sliced at every cut-ring intersection that
  // survived dangling-trim (an intersection from a fully-discarded cut
  // would be a spurious node).
  const ringNodes = [];
  for (const s of retained) {
    if (s.a === 'ring') ringNodes.push(s.coords[0]);
    if (s.b === 'ring') ringNodes.push(s.coords[s.coords.length - 1]);
  }
  const ringSegments = _sliceRingAtPoints(ringLine, _dedupePoints(ringNodes));
  const lineworkFeatures = [
    ...ringSegments.map(coords => turf.lineString(coords)),
    ...retained.map(s => turf.lineString(s.coords)),
  ];

  let faces;
  try {
    faces = turf.polygonize(turf.featureCollection(lineworkFeatures));
  } catch (e) {
    return { pieces: [], error: 'cut_slice_failed' };
  }
  if (!faces || !Array.isArray(faces.features)) {
    return { pieces: [], error: 'cut_slice_failed' };
  }

  // Collect raw faces (with their turf features kept for the nesting
  // pass below — we need point-in-polygon tests against the original
  // face geometry).
  const rawPieces = [];  // [{ piece, feature }]
  for (const face of faces.features) {
    if (!face.geometry || face.geometry.type !== 'Polygon') continue;
    if (!_faceInsidePlot(face, ringClosed, holes)) continue;
    const faceLatLng = face.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
    const piece = { outer: faceLatLng, holes: [], cutAffected: true };
    // Original plot holes (from plot.inners) — assign by first-vertex PIP.
    for (const h of (holes || [])) {
      if (!h || h.length < 3) continue;
      const probe = turf.point([h[0][1], h[0][0]]);
      try { if (turf.booleanPointInPolygon(probe, face)) piece.holes.push(h); }
      catch (_) { /* skip degenerate */ }
    }
    piece.area = _pieceArea(piece);
    if (piece.area > 1) rawPieces.push({ piece, feature: face });
  }

  // Nesting fix-up (v0.10.1): polygonize emits each bounded face
  // independently — for an enclave-style topology (a cut entering the
  // plot once, looped back on itself by a second cut), polygonize
  // returns BOTH the enclave AND the surrounding face uncorrected,
  // leaving the enclave double-counted in the outer face. Detect each
  // face's immediate enclosing face and convert the enclosed outer ring
  // into a hole of the enclosing face.
  if (rawPieces.length > 1) {
    rawPieces.sort((a, b) => b.piece.area - a.piece.area);
    for (let i = 0; i < rawPieces.length; i++) {
      const { piece: child, feature: childFeat } = rawPieces[i];
      let parentPiece = null;
      let probe;
      try { probe = turf.pointOnFeature(childFeat); }
      catch (_) { continue; }
      // Largest containing piece encountered first; the *smallest*
      // container is the last one to test true → keep overwriting.
      for (let j = 0; j < i; j++) {
        try {
          if (turf.booleanPointInPolygon(probe, rawPieces[j].feature)) {
            parentPiece = rawPieces[j].piece;
          }
        } catch (_) { /* skip */ }
      }
      if (parentPiece) parentPiece.holes.push(child.outer);
    }
    // Re-compute area for any piece that gained holes.
    for (const x of rawPieces) x.piece.area = _pieceArea(x.piece);
  }
  const pieces = rawPieces.map(x => x.piece).filter(p => p.area > 1);
  if (pieces.length === 0) {
    return { pieces: [], error: 'degenerate_split' };
  }

  const cutInside = retained.map(s => s.coords.map(([lon, lat]) => [lat, lon]));
  return { pieces, cutInside, crossedAny: true };
}

// Slice a single cut polyline at the given ring- and cutcut- intersection
// points. Returns an array of { coords, a, b } slices, where coords is
// [[lon,lat],…] and a/b are endpoint types: 'ring' | 'cutcut' | 'endpoint'.
function _sliceCutAtPoints(cutLine, ringIxs, cutCutIxs) {
  const cutLen = turf.length(cutLine);
  const nodes = [];
  for (const pt of ringIxs) {
    const t = turf.nearestPointOnLine(cutLine, turf.point(pt)).properties.location;
    nodes.push({ t, pt, type: 'ring' });
  }
  for (const pt of cutCutIxs) {
    const t = turf.nearestPointOnLine(cutLine, turf.point(pt)).properties.location;
    nodes.push({ t, pt, type: 'cutcut' });
  }
  nodes.sort((a, b) => a.t - b.t);

  const startCoord = cutLine.geometry.coordinates[0];
  const endCoord   = cutLine.geometry.coordinates[cutLine.geometry.coordinates.length - 1];
  const full = [
    { t: 0,      pt: startCoord, type: 'endpoint' },
    ...nodes,
    { t: cutLen, pt: endCoord,   type: 'endpoint' },
  ];

  const subs = [];
  for (let i = 0; i < full.length - 1; i++) {
    const a = full[i], b = full[i + 1];
    if (b.t - a.t < 1e-9) continue;
    const seg = _safeLineSliceAlong(cutLine, a.t, b.t, cutLen);
    if (!seg) continue;
    const coords = seg.geometry.coordinates;
    coords[0]                  = [a.pt[0], a.pt[1]];  // canonical node coords
    coords[coords.length - 1]  = [b.pt[0], b.pt[1]];
    subs.push({ coords, a: a.type, b: b.type });
  }
  return subs;
}

// Slice the outer ring at the given (deduped) intersection points. The
// ring is closed; we walk around it once, emitting one segment per
// node→next-node arc.
function _sliceRingAtPoints(ringLine, points) {
  if (!points.length) return [ringLine.geometry.coordinates];
  const ringLen = turf.length(ringLine);
  const ts = points.map(pt => ({
    t: turf.nearestPointOnLine(ringLine, turf.point(pt)).properties.location,
    pt,
  })).sort((a, b) => a.t - b.t);

  const segments = [];
  for (let i = 0; i < ts.length; i++) {
    const cur = ts[i];
    const nxt = ts[(i + 1) % ts.length];
    let segCoords;
    if (i + 1 < ts.length) {
      const seg = _safeLineSliceAlong(ringLine, cur.t, nxt.t, ringLen);
      if (!seg) continue;
      segCoords = seg.geometry.coordinates;
    } else {
      // Wrap segment: cur.t → ringLen, then 0 → nxt.t.
      const first  = _safeLineSliceAlong(ringLine, cur.t, ringLen, ringLen);
      const second = _safeLineSliceAlong(ringLine, 0, nxt.t, ringLen);
      if (!first || !second) continue;
      segCoords = first.geometry.coordinates
        .concat(second.geometry.coordinates.slice(1));
    }
    if (segCoords.length < 2) continue;
    segCoords[0]                     = [cur.pt[0], cur.pt[1]];
    segCoords[segCoords.length - 1]  = [nxt.pt[0], nxt.pt[1]];
    segments.push(segCoords);
  }
  return segments;
}

// Iterative dangling-trim. A slice's endpoint is acceptable if it is:
//   • 'ring' — sits on the outer ring,    OR
//   • 'cutcut' — sits at a node that ≥ 2 surviving slices touch.
// Anything else (an 'endpoint' free-end, or a cutcut node now alone)
// makes the slice danglate; we discard, then re-check until stable.
function _trimDangling(slices) {
  let kept = slices.slice();
  let changed = true;
  const key = (pt) => `${pt[0].toFixed(9)},${pt[1].toFixed(9)}`;
  while (changed) {
    changed = false;
    const counts = new Map();
    for (const s of kept) {
      if (s.a === 'cutcut') counts.set(key(s.coords[0]), (counts.get(key(s.coords[0])) || 0) + 1);
      if (s.b === 'cutcut') {
        const k = key(s.coords[s.coords.length - 1]);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    kept = kept.filter(s => {
      const aOK = s.a === 'ring' ||
        (s.a === 'cutcut' && (counts.get(key(s.coords[0])) || 0) >= 2);
      const bOK = s.b === 'ring' ||
        (s.b === 'cutcut' && (counts.get(key(s.coords[s.coords.length - 1])) || 0) >= 2);
      const keep = aOK && bOK;
      if (!keep) changed = true;
      return keep;
    });
  }
  return kept;
}

function _sliceMidpointInsidePlot(slice, ringClosed, holes) {
  if (!slice || !slice.coords || slice.coords.length < 2) return false;
  let mid;
  try {
    const tl = turf.lineString(slice.coords);
    const len = turf.length(tl);
    mid = turf.along(tl, len / 2);
  } catch (_) { return false; }
  return _pointInsidePlot(mid, ringClosed, holes);
}

function _faceInsidePlot(face, ringClosed, holes) {
  let probe;
  try { probe = turf.pointOnFeature(face); } catch (_) { return false; }
  return _pointInsidePlot(probe, ringClosed, holes);
}

function _pointInsidePlot(probePoint, ringClosed, holes) {
  const outerPoly = turf.polygon([ringClosed.map(([lat, lon]) => [lon, lat])]);
  try { if (!turf.booleanPointInPolygon(probePoint, outerPoly)) return false; }
  catch (_) { return false; }
  for (const h of (holes || [])) {
    if (!h || h.length < 3) continue;
    const hClosed = h.slice();
    const f = hClosed[0], l = hClosed[hClosed.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) hClosed.push([f[0], f[1]]);
    let holePoly;
    try { holePoly = turf.polygon([hClosed.map(([lat, lon]) => [lon, lat])]); }
    catch (_) { continue; }
    try { if (turf.booleanPointInPolygon(probePoint, holePoly)) return false; }
    catch (_) { /* skip degenerate */ }
  }
  return true;
}

// Self-intersection: check every pair of non-adjacent segments. Adjacent
// segments share an endpoint by construction, so those don't count.
function _cutSelfIntersects(latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length < 4) return false;
  for (let i = 0; i < latLngs.length - 1; i++) {
    for (let j = i + 2; j < latLngs.length - 1; j++) {
      if (_segmentsCross(latLngs[i], latLngs[i + 1], latLngs[j], latLngs[j + 1])) {
        return true;
      }
    }
  }
  return false;
}

// Standard 2D segment-segment proper-intersection test (shared endpoints
// don't count). Works in [lat, lng] just fine since it's pure topology.
function _segmentsCross(a, b, c, d) {
  const dx1 = b[1] - a[1], dy1 = b[0] - a[0];
  const dx2 = d[1] - c[1], dy2 = d[0] - c[0];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-15) return false;
  const tx = c[1] - a[1], ty = c[0] - a[0];
  const t = (tx * dy2 - ty * dx2) / denom;
  const u = (tx * dy1 - ty * dx1) / denom;
  const eps = 1e-9;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

// Legacy entry points retained as thin wrappers.
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
