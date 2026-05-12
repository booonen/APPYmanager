// ============================================================
// LAND / WATER — Coastline + inland-water ingest cache (Brick 12a)
// ============================================================
// Pipeline (kicked off from the settings tab's "Fetch coastlines + water"
// button — `fetchAndCacheWater()`):
//
//   1.  Compute project bbox = union of all plot bboxes + ~10% padding.
//   2.  Overpass query restricted to that bbox for
//         way ["natural"="coastline"]
//         way ["natural"="water"]
//         relation["natural"="water"]
//       plus the recursive `(._;>;);out body;` close to pull every
//       referenced node.
//   3.  Stitch coastline ways into chains, then build SEA geometry:
//       - **Closed chains** apply the OSM/OGF "land-on-left" rule:
//         counter-clockwise = an ISLAND (land inside; subtract from sea
//         later); clockwise = an INLAND SEA (sea inside; keep).
//       - **Open chains** are clipped to the project bbox so both
//         endpoints lie on a bbox edge, then closed via a walk along
//         the bbox edge on the chain's RIGHT side (= sea side per
//         land-on-left). We build both candidate closures (CW / CCW
//         around the bbox) and pick the one containing a small
//         right-side test point at the chain's midpoint.
//   4.  Build INLAND WATER geometry from `natural=water` ways (each
//       must be a closed self-loop) and `natural=water` multipolygon
//       relations (use `groupWaysIntoRings` for outer + inner rings).
//   5.  Union sea + inland into a single MultiPolygon, split it into
//       connected components ("water bodies"), drop any below the
//       `data.settings.minWaterBodyAreaM2` threshold (default 1 ha).
//       This is what gives us the user-requested "tiny abutting
//       puddles drop, but a tiny puddle next to a big lake stays"
//       behaviour for free — abutting shapes merge in step 5 BEFORE
//       the threshold is applied.
//   6.  Persist into `data.waterCache` and save.
//
// 12a's footprint is intentionally narrow: no plot UI touches yet, no
// property side, no per-plot land/water sub-geometry. Those land in
// 12b (per-plot intersection) and 12c+12d (storage, inspector,
// aggregation).

// ------------------------------------------------------------
// PUBLIC API
// ------------------------------------------------------------

let _landwaterFetchInFlight = false;

function isLandWaterFetchInFlight() { return _landwaterFetchInFlight; }

// Yield to the event loop. Used between heavy stages so the UI can
// re-paint (toast, button state, etc.) without freezing.
function _yield() { return new Promise(r => setTimeout(r, 0)); }

async function fetchAndCacheWater() {
  if (_landwaterFetchInFlight) return;
  if (typeof overpassFetch !== 'function') {
    toast(t('landwater.toast_overpass_missing'), 'error');
    return;
  }
  const bbox = _landwaterProjectBbox();
  if (!bbox) {
    toast(t('landwater.toast_no_plots'), 'warning');
    return;
  }

  _landwaterFetchInFlight = true;
  if (typeof renderSettings === 'function') renderSettings();
  toast(t('landwater.toast_fetching'), 'info');

  try {
    // Let the toast + busy button paint before we lock the thread.
    await _yield();

    let json;
    try {
      json = await overpassFetch(_buildLandWaterQuery(bbox));
    } catch (err) {
      const msg = err && err.is429
        ? t('landwater.toast_rate_limited')
        : (err?.message || 'unknown');
      toast(t('landwater.toast_fetch_failed', { msg }), 'error');
      return;
    }

    await _yield();
    const parsed = _parseLandWaterResponse(json);

    await _yield();
    const seaGeom = await _buildSeaGeometry(parsed.coastlineWays, parsed.nodes, bbox);

    await _yield();
    const inlandGeom = await _buildInlandWaterGeometry(parsed.waterWays, parsed.waterRelations, parsed.waysById, parsed.nodes);

    await _yield();
    const minAreaM2 = Math.max(0, Number(getSetting('minWaterBodyAreaM2', 10000)) || 0);
    const merged = await _mergeAndThreshold(seaGeom, inlandGeom, minAreaM2);

    data.waterCache = {
      fetchedAt:     new Date().toISOString(),
      bbox,
      waterGeometry: merged.geometry,
      bodyCount:     merged.bodyCount,
    };
    save();

    toast(t('landwater.toast_fetched', { n: merged.bodyCount }), 'success');
    if (typeof redrawMap === 'function' && getSetting('showWaterDebugOverlay', false)) {
      redrawMap();
    }
  } finally {
    _landwaterFetchInFlight = false;
    if (typeof renderSettings === 'function') renderSettings();
  }
}

function _landwaterProjectBbox() {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const plot of (data.plots || [])) {
    const b = plotBounds(plot);
    if (!b) continue;
    if (b.minLat < minLat) minLat = b.minLat;
    if (b.maxLat > maxLat) maxLat = b.maxLat;
    if (b.minLon < minLng) minLng = b.minLon;
    if (b.maxLon > maxLng) maxLng = b.maxLon;
  }
  if (!isFinite(minLat)) return null;
  const padLat = Math.max(0.001, (maxLat - minLat) * 0.1);
  const padLng = Math.max(0.001, (maxLng - minLng) * 0.1);
  return [minLat - padLat, minLng - padLng, maxLat + padLat, maxLng + padLng];
}

function _buildLandWaterQuery(bbox) {
  const [s, w, n, e] = bbox; // [minLat, minLng, maxLat, maxLng]
  // Overpass bbox is (south, west, north, east).
  return `[out:json][timeout:60][bbox:${s},${w},${n},${e}];
(
  way["natural"="coastline"];
  way["natural"="water"];
  relation["natural"="water"];
);
(._;>;);
out body;`;
}

function _parseLandWaterResponse(json) {
  const nodes = {};
  const waysById = {};
  const relations = [];
  for (const el of (json && json.elements) || []) {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    } else if (el.type === 'way') {
      waysById[el.id] = { id: el.id, nodes: (el.nodes || []).slice(), tags: el.tags || {} };
    } else if (el.type === 'relation') {
      relations.push(el);
    }
  }
  const coastlineWays = [];
  const waterWays = [];
  const waterRelations = [];
  for (const w of Object.values(waysById)) {
    if (w.tags.natural === 'coastline') coastlineWays.push(w);
    else if (w.tags.natural === 'water') waterWays.push(w);
  }
  for (const r of relations) {
    if (r.tags?.natural === 'water' && (r.tags?.type || 'multipolygon') === 'multipolygon') {
      waterRelations.push(r);
    }
  }
  return { nodes, waysById, coastlineWays, waterWays, waterRelations };
}

// ------------------------------------------------------------
// SEA GEOMETRY FROM COASTLINES
// ------------------------------------------------------------

async function _buildSeaGeometry(coastlineWays, nodes, bbox) {
  if (!Array.isArray(coastlineWays) || coastlineWays.length === 0) return null;
  const chains = _stitchCoastlineChains(coastlineWays, nodes);
  const seaPolys = [];
  const islandPolys = [];

  for (const chain of chains) {
    if (chain.isClosed) {
      const ringLngLat = _toLngLatRing(chain.coords);
      if (!ringLngLat) continue;
      let poly;
      try { poly = turf.polygon([ringLngLat]); } catch (e) { continue; }
      // OSM convention: land on left. Signed area in lng/lat:
      //   > 0 → counter-clockwise → ISLAND (land inside).
      //   < 0 → clockwise         → INLAND SEA (sea inside).
      const sa = _signedAreaLngLat(ringLngLat);
      if (sa > 0) islandPolys.push(poly);
      else        seaPolys.push(poly);
    } else {
      // Open chain → one OR MORE inside subchains. A chain that dips
      // in and out of the bbox multiple times produces multiple
      // subchains, each entry/exit pair its own sea polygon. v0.8.0
      // kept only the longest subchain — fixed in v0.8.1.
      const segs = _clipChainToBboxAll(chain.coords, bbox);
      for (const seg of segs) {
        const closed = _closeClippedSegmentAsSea(seg, bbox);
        if (closed) seaPolys.push(closed);
      }
    }
  }

  let sea = await _unionAllAsync(seaPolys);
  if (sea) {
    for (let i = 0; i < islandPolys.length; i++) {
      if (i > 0 && i % 5 === 0) await _yield();
      try {
        const diff = turf.difference(sea, islandPolys[i]);
        if (diff) sea = diff;
      } catch (e) { /* skip degenerate */ }
    }
  }
  return sea;
}

function _stitchCoastlineChains(ways, nodes) {
  // Walks consecutive ways that share an endpoint node id, building
  // chains in node-order (preserving land-on-left direction).
  const remaining = ways.slice();
  const chains = [];
  while (remaining.length > 0) {
    const seed = remaining.shift();
    let chainIds = seed.nodes.slice();
    let extended = true;
    while (extended) {
      extended = false;

      // Extend at the tail
      const tail = chainIds[chainIds.length - 1];
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        if (w.nodes[0] === tail) {
          chainIds = chainIds.concat(w.nodes.slice(1));
          remaining.splice(i, 1); extended = true; break;
        }
        if (w.nodes[w.nodes.length - 1] === tail) {
          // Reverse-attach loses direction so SKIP — preserving the
          // land-on-left orientation is more important than completing
          // the chain. Misjoined ways = caller's data issue.
        }
      }
      if (extended) continue;

      // Extend at the head (only if its previous way ends at chain head)
      const head = chainIds[0];
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        if (w.nodes[w.nodes.length - 1] === head) {
          chainIds = w.nodes.slice(0, -1).concat(chainIds);
          remaining.splice(i, 1); extended = true; break;
        }
      }
    }
    const isClosed = chainIds.length > 2 && chainIds[0] === chainIds[chainIds.length - 1];
    const coords = chainIds.map(nid => nodes[nid]).filter(n => n).map(n => [n.lat, n.lon]);
    if (coords.length >= 2) chains.push({ coords, isClosed });
  }
  return chains;
}

function _toLngLatRing(coordsLatLng) {
  if (!coordsLatLng || coordsLatLng.length < 3) return null;
  const out = coordsLatLng.map(([lat, lng]) => [lng, lat]);
  // Force exact closure.
  if (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1]) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

function _signedAreaLngLat(ringLngLat) {
  let area = 0;
  for (let i = 0; i < ringLngLat.length - 1; i++) {
    const [x1, y1] = ringLngLat[i];
    const [x2, y2] = ringLngLat[i + 1];
    area += (x1 * y2) - (x2 * y1);
  }
  return area / 2;
}

// Closes a single inside-the-bbox subchain into a sea polygon. The
// subchain must have both endpoints lying on a bbox edge — i.e. it
// represents one entry/exit pair through the bbox boundary. Returns
// a turf Feature<Polygon> or null.
function _closeClippedSegmentAsSea(segCoords, bbox) {
  if (!segCoords || segCoords.length < 2) return null;
  if (!_onBboxEdge(segCoords[0], bbox) || !_onBboxEdge(segCoords[segCoords.length - 1], bbox)) {
    return null;
  }
  const testPt = _rightSideTestPoint(segCoords, bbox);
  if (!testPt) return null;

  for (const dir of [+1, -1]) { // try CW first, then CCW
    const closure = _closeChainAlongBbox(segCoords, bbox, dir);
    if (!closure || closure.length < 4) continue;
    const ringLngLat = _toLngLatRing(closure);
    if (!ringLngLat) continue;
    let poly;
    try { poly = turf.polygon([ringLngLat]); } catch (e) { continue; }
    const pt = turf.point([testPt[1], testPt[0]]);
    try {
      if (turf.booleanPointInPolygon(pt, poly)) return poly;
    } catch (e) { /* fall through */ }
  }
  return null;
}

// Returns ALL inside-the-bbox subchains, not just the longest. A
// coastline can dip in and out of the bbox repeatedly (think
// archipelago, or a peninsula that runs along the bbox edge), and
// each entry/exit pair forms its own sea polygon. v0.8.0 took only
// the longest segment and dropped everything else — bug fix here.
function _clipChainToBboxAll(coords, bbox) {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const inside = ([lat, lng]) =>
    lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;

  const segments = [];
  let cur = [];
  for (let i = 0; i < coords.length; i++) {
    const pt = coords[i];
    const prev = (i > 0) ? coords[i - 1] : null;
    const wasInside = prev && inside(prev);
    const isInside = inside(pt);
    if (isInside) {
      if (prev && !wasInside) {
        const ip = _segmentBboxEntry(prev, pt, bbox);
        if (ip) cur.push(ip);
      }
      cur.push(pt);
    } else if (wasInside) {
      const ip = _segmentBboxEntry(prev, pt, bbox);
      if (ip) cur.push(ip);
      if (cur.length >= 2) segments.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) segments.push(cur);
  return segments;
}

function _segmentBboxEntry(a, b, bbox) {
  // First intersection of a→b with any of the four bbox edges.
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const edges = [
    [[minLat, minLng], [minLat, maxLng]],
    [[maxLat, minLng], [maxLat, maxLng]],
    [[minLat, minLng], [maxLat, minLng]],
    [[minLat, maxLng], [maxLat, maxLng]],
  ];
  let best = null, bestT = Infinity;
  for (const [p, q] of edges) {
    const r = _seg2segIntersection(a, b, p, q);
    if (!r) continue;
    if (r.t < bestT) { bestT = r.t; best = r.pt; }
  }
  return best;
}

function _seg2segIntersection(p1, p2, p3, p4) {
  // p* = [lat, lng]; returns { pt: [lat, lng], t } or null.
  const [y1, x1] = p1, [y2, x2] = p2, [y3, x3] = p3, [y4, x4] = p4;
  const d = (y1 - y2) * (x3 - x4) - (x1 - x2) * (y3 - y4);
  if (Math.abs(d) < 1e-15) return null;
  const t = ((y1 - y3) * (x3 - x4) - (x1 - x3) * (y3 - y4)) / d;
  const u = -((y1 - y2) * (x1 - x3) - (x1 - x2) * (y1 - y3)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { pt: [y1 + t * (y2 - y1), x1 + t * (x2 - x1)], t };
}

function _onBboxEdge([lat, lng], bbox, tol = 1e-7) {
  const [minLat, minLng, maxLat, maxLng] = bbox;
  return (
    Math.abs(lat - minLat) < tol ||
    Math.abs(lat - maxLat) < tol ||
    Math.abs(lng - minLng) < tol ||
    Math.abs(lng - maxLng) < tol
  );
}

function _rightSideTestPoint(coordsLatLng, bbox) {
  // Tiny step perpendicular-right of the chain's mid-segment.
  if (coordsLatLng.length < 2) return null;
  const mid = Math.floor((coordsLatLng.length - 1) / 2);
  const a = coordsLatLng[mid];
  const b = coordsLatLng[mid + 1] || coordsLatLng[mid - 1];
  if (!a || !b) return null;
  const dlat = b[0] - a[0], dlng = b[1] - a[1];
  const len = Math.hypot(dlat, dlng);
  if (len < 1e-15) return null;
  // Rotate direction (dlat, dlng) by -90° in the (lng,lat) plane → right
  // direction = (-dlng, +dlat). v0.8.0 had this with reversed signs,
  // which put the test point on the LAND side; the closure check then
  // selected the polygon containing land, and "sea" came back as the
  // entire bbox minus the small land patch. Reported in user testing.
  const rlat = -dlng / len, rlng = dlat / len;
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const stepDeg = Math.max(maxLat - minLat, maxLng - minLng) * 0.005;
  const mlat = (a[0] + b[0]) / 2;
  const mlng = (a[1] + b[1]) / 2;
  return [mlat + rlat * stepDeg, mlng + rlng * stepDeg];
}

function _closeChainAlongBbox(chainCoords, bbox, dir) {
  // dir = +1 walk CW around bbox; -1 walk CCW. The bbox is parameterised
  // as a value in [0, 4): top-edge L→R is 0..1, right-edge T→B is 1..2,
  // bottom-edge R→L is 2..3, left-edge B→T is 3..4.
  const [minLat, minLng, maxLat, maxLng] = bbox;
  const dLat = maxLat - minLat, dLng = maxLng - minLng;
  const perimParam = ([lat, lng]) => {
    if (Math.abs(lat - maxLat) < 1e-7 && lng >= minLng - 1e-7 && lng <= maxLng + 1e-7) {
      return Math.max(0, Math.min(1, (lng - minLng) / dLng));
    }
    if (Math.abs(lng - maxLng) < 1e-7 && lat >= minLat - 1e-7 && lat <= maxLat + 1e-7) {
      return 1 + Math.max(0, Math.min(1, (maxLat - lat) / dLat));
    }
    if (Math.abs(lat - minLat) < 1e-7 && lng >= minLng - 1e-7 && lng <= maxLng + 1e-7) {
      return 2 + Math.max(0, Math.min(1, (maxLng - lng) / dLng));
    }
    if (Math.abs(lng - minLng) < 1e-7 && lat >= minLat - 1e-7 && lat <= maxLat + 1e-7) {
      return 3 + Math.max(0, Math.min(1, (lat - minLat) / dLat));
    }
    return null;
  };
  const pointAt = (p) => {
    p = ((p % 4) + 4) % 4;
    if (p <= 1) return [maxLat, minLng + p * dLng];
    if (p <= 2) return [maxLat - (p - 1) * dLat, maxLng];
    if (p <= 3) return [minLat, maxLng - (p - 2) * dLng];
    return [minLat + (p - 3) * dLat, minLng];
  };
  const pStart = perimParam(chainCoords[0]);
  const pEnd   = perimParam(chainCoords[chainCoords.length - 1]);
  if (pStart == null || pEnd == null) return null;

  const out = chainCoords.slice();
  // From pEnd, walk in `dir` until we reach pStart, inserting bbox corners
  // along the way. Limit iterations: at most 4 corners to traverse.
  let cur = pEnd;
  for (let i = 0; i < 6; i++) {
    const distToStart = dir > 0
      ? ((pStart - cur) % 4 + 4) % 4
      : ((cur - pStart) % 4 + 4) % 4;
    const nextCorner = dir > 0
      ? Math.floor(cur + 1e-9) + 1
      : Math.ceil(cur - 1e-9) - 1;
    const distToCorner = dir > 0
      ? ((nextCorner - cur) % 4 + 4) % 4
      : ((cur - nextCorner) % 4 + 4) % 4;
    if (distToStart <= distToCorner + 1e-9) {
      out.push(pointAt(pStart));
      break;
    }
    out.push(pointAt(nextCorner));
    cur = nextCorner;
  }
  return out;
}

// ------------------------------------------------------------
// INLAND WATER GEOMETRY
// ------------------------------------------------------------

async function _buildInlandWaterGeometry(waterWays, waterRelations, waysById, nodes) {
  const polys = [];

  // Self-closed ways tagged natural=water — simple polygons (no holes).
  for (const w of waterWays) {
    if (!w.nodes || w.nodes.length < 4) continue;
    if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
    const coords = w.nodes.map(nid => nodes[nid]).filter(n => n).map(n => [n.lon, n.lat]);
    if (coords.length < 4) continue;
    // Force exact closure.
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
      coords.push([coords[0][0], coords[0][1]]);
    }
    try { polys.push(turf.polygon([coords])); } catch (e) { /* skip degenerate */ }
  }

  // type=multipolygon relations with natural=water — full outer+inner support.
  for (const rel of waterRelations) {
    const outerRefs = [];
    const innerRefs = [];
    for (const m of (rel.members || [])) {
      if (m.type !== 'way') continue;
      const w = waysById[m.ref];
      if (!w) continue;
      const bucket = (m.role === 'inner') ? innerRefs : outerRefs;
      bucket.push({ id: m.ref, nodes: w.nodes });
    }
    if (outerRefs.length === 0) continue;
    const outerRings = (typeof groupWaysIntoRings === 'function') ? groupWaysIntoRings(outerRefs) : null;
    const innerRings = (innerRefs.length > 0 && typeof groupWaysIntoRings === 'function')
      ? groupWaysIntoRings(innerRefs) : [];
    if (!outerRings) continue;

    for (const outerWayList of outerRings) {
      const outerCoords = _ringCoordsLngLat(outerWayList, waysById, nodes);
      if (outerCoords.length < 4) continue;
      const polyCoords = [outerCoords];
      let outerPoly;
      try { outerPoly = turf.polygon([outerCoords]); } catch (e) { continue; }
      if (innerRings) {
        for (const innerWayList of innerRings) {
          const innerCoords = _ringCoordsLngLat(innerWayList, waysById, nodes);
          if (innerCoords.length < 4) continue;
          try {
            if (turf.booleanPointInPolygon(turf.point(innerCoords[0]), outerPoly)) {
              polyCoords.push(innerCoords);
            }
          } catch (e) { /* skip */ }
        }
      }
      try { polys.push(turf.polygon(polyCoords)); } catch (e) { /* skip degenerate */ }
    }
  }

  return await _unionAllAsync(polys);
}

function _ringCoordsLngLat(wayIds, waysById, nodes) {
  if (!Array.isArray(wayIds) || wayIds.length === 0) return [];
  if (wayIds.length === 1) {
    const w = waysById[wayIds[0]];
    if (!w) return [];
    const out = w.nodes.map(nid => nodes[nid]).filter(n => n).map(n => [n.lon, n.lat]);
    if (out.length >= 2 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
      out.push([out[0][0], out[0][1]]);
    }
    return out;
  }
  // Multi-way ring: pick the first way's direction based on which endpoint
  // connects to the second way.
  const first = waysById[wayIds[0]];
  const second = waysById[wayIds[1]];
  if (!first || !second) return [];
  const fs = first.nodes[0], fe = first.nodes[first.nodes.length - 1];
  const ss = second.nodes[0], se = second.nodes[second.nodes.length - 1];
  let firstReversed;
  if (fe === ss || fe === se) firstReversed = false;
  else if (fs === ss || fs === se) firstReversed = true;
  else return [];
  const path = firstReversed ? first.nodes.slice().reverse() : first.nodes.slice();
  for (let i = 1; i < wayIds.length; i++) {
    const w = waysById[wayIds[i]];
    if (!w) return [];
    const tail = path[path.length - 1];
    const ws = w.nodes[0], we = w.nodes[w.nodes.length - 1];
    if (ws === tail) {
      for (let j = 1; j < w.nodes.length; j++) path.push(w.nodes[j]);
    } else if (we === tail) {
      for (let j = w.nodes.length - 2; j >= 0; j--) path.push(w.nodes[j]);
    } else {
      return [];
    }
  }
  const out = path.map(nid => nodes[nid]).filter(n => n).map(n => [n.lon, n.lat]);
  if (out.length >= 2 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

// ------------------------------------------------------------
// MERGE + THRESHOLD
// ------------------------------------------------------------

// Binary-tree union of many polygons. Linear union (turf.union in a loop)
// is O(N²) because the accumulator's vertex count grows monotonically; a
// tree union halves N at each level for O(N log N) total work and lets
// us yield to the event loop between levels so the UI doesn't lock up.
async function _unionAllAsync(polyFeatures) {
  if (!Array.isArray(polyFeatures) || polyFeatures.length === 0) return null;
  if (polyFeatures.length === 1) return polyFeatures[0];
  let current = polyFeatures.slice();
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i > 0 && i % 32 === 0) await _yield();
      if (i + 1 < current.length) {
        try {
          const u = turf.union(current[i], current[i + 1]);
          next.push(u || current[i]);
        } catch (e) {
          next.push(current[i]);
        }
      } else {
        next.push(current[i]);
      }
    }
    current = next;
    await _yield(); // breath between tree levels
  }
  return current[0];
}

async function _mergeAndThreshold(seaGeom, inlandGeom, minAreaM2) {
  let merged = null;
  if (seaGeom && inlandGeom) {
    try { merged = turf.union(seaGeom, inlandGeom); } catch (e) { merged = seaGeom; }
  } else {
    merged = seaGeom || inlandGeom || null;
  }
  if (!merged) return { geometry: null, bodyCount: 0 };

  await _yield();

  // Split into connected components.
  const components = [];
  const g = merged.geometry;
  if (g.type === 'Polygon') {
    components.push(turf.polygon(g.coordinates));
  } else if (g.type === 'MultiPolygon') {
    for (const c of g.coordinates) components.push(turf.polygon(c));
  }

  // Drop anything below the threshold. The contiguous-merge above already
  // gave us the user's "tiny puddle next to big lake stays" behaviour
  // (because the puddle merged into the lake before we got here).
  const kept = components.filter(p => {
    try { return turf.area(p) >= minAreaM2; } catch (e) { return false; }
  });

  if (kept.length === 0) return { geometry: null, bodyCount: 0 };
  const allCoords = kept.map(p => p.geometry.coordinates);
  return { geometry: turf.multiPolygon(allCoords), bodyCount: kept.length };
}

// ------------------------------------------------------------
// SETTINGS HELPERS (used by views.js)
// ------------------------------------------------------------

function setLandWaterSplitEnabled(on) {
  data.settings = data.settings || {};
  data.settings.landWaterSplitEnabled = !!on;
  save();
}

function setMinWaterBodyAreaM2(val) {
  const n = Math.max(0, Math.round(Number(val) || 0));
  data.settings = data.settings || {};
  data.settings.minWaterBodyAreaM2 = n;
  save();
}

function setShowWaterDebugOverlay(on) {
  data.settings = data.settings || {};
  data.settings.showWaterDebugOverlay = !!on;
  save();
  if (typeof redrawMap === 'function') redrawMap();
}

function getWaterCacheSummary() {
  const c = data.waterCache;
  if (!c || !c.waterGeometry) return null;
  return {
    fetchedAt: c.fetchedAt,
    bbox:      c.bbox,
    bodyCount: c.bodyCount || 0,
  };
}
