// ============================================================
// ATLAS — Data-view pages (Brick 13)
// ============================================================
// A "page" is a user-authored set of layer instructions plus page-level
// settings. The renderer in this module walks the layers in order and
// emits an SVG. Every layer is a small declarative object — `kind` +
// kind-specific fields — so the renderer is just a `switch`-on-kind.
//
// Coordinate convention: pages render in equirectangular projection
// (lng → x, lat → -y so north is up). The SVG `viewBox` is the page's
// extent in lng / -lat space; we never need transforms.
//
// page = {
//   id, name, description,
//   categoryPath: string[],         // implicit category tree key
//   extent: 'auto' | { minLat, maxLat, minLng, maxLng },
//   simplification: number,         // 0–100, % of bbox diagonal
//   background: 'plain',            // v1: plain dark; tiles not used
//   layers: layer[]
// }
//
// layer kinds (v1):
//   boundary_fill    — { typeId, fill, stroke, visible }
//   boundary_outline — { typeId, stroke, visible }
//   plot_fill        — { fill, stroke, visible }
//   settlements      — { filter: { placeTypes }, style, visible }
//
// fill shape:
//   { mode: 'static' | 'property', color?, schemaId?, scale?, range? }
// scale (when mode === 'property'):
//   { kind: 'viridis' | 'sequential' | 'categorical', range?: [min, max] }
// stroke shape:
//   { color, width, opacity }

// ────────────────────────────────────────────────────────────
// PALETTES
// ────────────────────────────────────────────────────────────

// 5-stop viridis sample. Linear interpolation between stops covers
// the 0..1 input range cleanly enough for choropleth use.
const _VIRIDIS_STOPS = [
  { t: 0.00, rgb: [68,   1,  84] },
  { t: 0.25, rgb: [59,  82, 139] },
  { t: 0.50, rgb: [33, 145, 140] },
  { t: 0.75, rgb: [94, 201,  98] },
  { t: 1.00, rgb: [253, 231,  37] },
];

// Sequential single-hue (light slate → deep accent red) for users who
// want a softer ramp on dark backgrounds.
const _SEQUENTIAL_STOPS = [
  { t: 0.00, rgb: [220, 224, 235] },
  { t: 1.00, rgb: [193,  39,  45] },
];

// Categorical palette — 12 distinct hues, ~uniform luminance against
// the dark theme. Overflow categories collapse into "Other" in grey.
const _CATEGORICAL_PALETTE = [
  '#c1272d', '#0d8a8a', '#b58300', '#5a4ea3', '#3f7e3f', '#8a4c8a',
  '#d97757', '#48b287', '#6f86d6', '#9b6dd0', '#d4a13d', '#3aa2c7',
];
const _CATEGORICAL_OTHER_COLOR = '#5c5f73';
const _MISSING_COLOR           = '#3a3d4a';

function _lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}
function _rgbToHex(r) { return '#' + r.map(c => c.toString(16).padStart(2, '0')).join(''); }
function _interpStops(stops, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const a = stops[i - 1], b = stops[i];
      const u = (t - a.t) / (b.t - a.t || 1);
      return _rgbToHex(_lerpRgb(a.rgb, b.rgb, u));
    }
  }
  return _rgbToHex(stops[stops.length - 1].rgb);
}
function _scaleColor(scale, t) {
  const kind = (scale && scale.kind) || 'viridis';
  if (kind === 'custom' && Array.isArray(scale.stops) && scale.stops.length >= 2) {
    // Normalise stop positions + sort, then interpolate.
    const stops = scale.stops
      .map(s => ({ t: Math.max(0, Math.min(1, Number(s.t))), rgb: _hexToRgb(s.color) }))
      .filter(s => Number.isFinite(s.t) && s.rgb)
      .sort((a, b) => a.t - b.t);
    if (stops.length >= 2) return _interpStops(stops, t);
  }
  if (kind === 'sequential') return _interpStops(_SEQUENTIAL_STOPS, t);
  return _interpStops(_VIRIDIS_STOPS, t);
}

function _hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const h = hex.replace(/^#/, '');
  if (h.length === 3) {
    return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
  }
  if (h.length === 6) {
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// PAGE / LAYER FACTORIES
// ────────────────────────────────────────────────────────────

const ATLAS_LAYER_KINDS = ['boundary_fill', 'boundary_outline', 'plot_fill', 'settlements'];

function createBlankAtlasPage(name) {
  return {
    id:             uid(),
    name:           name || '',
    description:    '',
    categoryPath:   [],
    extent:         'auto',
    simplification: 0,
    background:     'plain',
    layers:         [],
  };
}

function createBlankAtlasLayer(kind) {
  const base = { id: uid(), kind, name: '', visible: true };
  switch (kind) {
    case 'boundary_fill':
      return {
        ...base,
        typeId: null,
        fill:   { mode: 'static', color: '#48b287' },
      };
    case 'boundary_outline':
      return {
        ...base,
        typeId: null,
        stroke: { color: '#8b8fa4', width: 0.6, opacity: 0.8 },
      };
    case 'plot_fill':
      return {
        ...base,
        fill:   { mode: 'static', color: '#475569' },
      };
    case 'settlements':
      return {
        ...base,
        filter: { placeTypes: [] }, // empty = all
        style:  {
          fill:    null, // null = use place-type colour from settlements.js
          stroke:  '#0f1117',
          radius:  4,
          opacity: 0.95,
          labels:        false,
          labelSize:     11,
          labelFont:     'Hammersmith One',
          labelColor:    '#e6e8ef',
          labelHalo:     '#0f1117',
          labelHaloWidth: 0.25,
        },
      };
  }
  return base;
}

// ────────────────────────────────────────────────────────────
// GEOMETRY FETCHERS PER LAYER
// ────────────────────────────────────────────────────────────
// Each returns:
//   { polygons: Array<Array<Array<[lat,lng]>>>, hover: [{ name, value }] }
// (parallel arrays — polygons[i] belongs to hover[i])

function _layerBoundaryFeatures(layer) {
  if (!layer.typeId) return [];
  const out = [];
  for (const b of (data.boundaries || [])) {
    if (b.typeId !== layer.typeId) continue;
    if (typeof resolveBoundaryGeometry !== 'function') continue;
    const geom = resolveBoundaryGeometry(b);
    if (!geom || !geom.polygons || geom.polygons.length === 0) continue;
    out.push({ entity: b, kind: 'boundary', polygons: geom.polygons });
  }
  return out;
}

function _layerPlotFeatures(/* layer */) {
  const out = [];
  for (const plot of (data.plots || [])) {
    if (typeof resolvePlotGeometry !== 'function') continue;
    const geo = resolvePlotGeometry(plot);
    if (!geo || !geo.polygons || geo.polygons.length === 0) continue;
    out.push({ entity: plot, kind: 'plot', polygons: geo.polygons });
  }
  return out;
}

function _layerSettlementMarkers(layer) {
  const placeTypes = (layer.filter && Array.isArray(layer.filter.placeTypes)) ? layer.filter.placeTypes : [];
  const filterOn = placeTypes.length > 0;
  const out = [];
  for (const s of (data.settlements || [])) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    if (filterOn && !placeTypes.includes(s.place)) continue;
    out.push(s);
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// VALUE RESOLUTION + SCALE COMPUTATION
// ────────────────────────────────────────────────────────────

function _resolveLayerValue(entity, kind, schemaId) {
  if (!schemaId) return null;
  const schema = (typeof findPropertySchema === 'function') ? findPropertySchema(schemaId) : null;
  if (!schema) return null;
  if (kind === 'plot') {
    if (isVirtualPropertyId && isVirtualPropertyId(schemaId)) {
      return plotArea(entity);
    }
    return getPlotPropertyValue(entity, schemaId);
  }
  // boundary
  // Categorical: no rollup (resolveEffectiveForBoundary only handles numeric/
  // percentage and returns null otherwise). Read the user-set value directly.
  if (schema.kind === 'categorical') {
    return getBoundaryPropertyValue ? getBoundaryPropertyValue(entity, schemaId) : null;
  }
  if (typeof resolveEffectiveForBoundary === 'function') {
    return resolveEffectiveForBoundary(entity, schema);
  }
  return getBoundaryPropertyValue ? getBoundaryPropertyValue(entity, schemaId) : null;
}

function _valueAsNumber(value, schema) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    // Percentage: prefer .percent display value if set, else raw value.
    if (schema && schema.kind === 'percentage') {
      if (value.mode === 'percent') return Number(value.value);
      // raw → can't render numerically without resolving the denom chain
      // here; we'll surface the raw number as-is (better than nothing).
      return Number(value.value);
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Walk every entity's value to find domain extents for a property fill.
function _computeNumericDomain(entities, kind, schema) {
  let min = Infinity, max = -Infinity;
  for (const e of entities) {
    const v = _valueAsNumber(_resolveLayerValue(e.entity, kind, schema.id), schema);
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min === max) max = min + 1;  // avoid divide-by-zero
  return { min, max };
}

function _buildCategoricalMap(entities, kind, schema) {
  // Count occurrences; cap top-N to the palette, bucket the rest as Other.
  // v0.12.1: a schema may carry user-defined `categoryColors` ({ value: hex });
  // those take precedence over the auto palette.
  const tally = new Map();
  for (const e of entities) {
    const v = _resolveLayerValue(e.entity, kind, schema.id);
    if (v === null || v === undefined || v === '') continue;
    const key = String(v);
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
  const map = new Map();
  const userColors = (schema.categoryColors && typeof schema.categoryColors === 'object')
    ? schema.categoryColors : null;
  let paletteIdx = 0;
  for (const [v] of sorted) {
    if (userColors && typeof userColors[v] === 'string') {
      map.set(v, userColors[v]);
    } else if (paletteIdx < _CATEGORICAL_PALETTE.length) {
      map.set(v, _CATEGORICAL_PALETTE[paletteIdx++]);
    }
    // beyond palette + no user colour → falls through to "Other" grey
  }
  return map;
}

function _fillColorForEntity(entity, kind, layer, ctx) {
  const fill = layer.fill;
  if (!fill || fill.mode === 'static') return fill?.color || '#475569';
  const schema = ctx.schemaById.get(fill.schemaId);
  if (!schema) return _MISSING_COLOR;
  const raw = _resolveLayerValue(entity, kind, fill.schemaId);
  if (raw === null || raw === undefined || raw === '') return _MISSING_COLOR;

  if (schema.kind === 'categorical') {
    const map = ctx.categoricalMaps.get(layer.id);
    if (!map) return _MISSING_COLOR;
    return map.get(String(raw)) || _CATEGORICAL_OTHER_COLOR;
  }
  const v = _valueAsNumber(raw, schema);
  if (v == null) return _MISSING_COLOR;
  // Percentage is anchored 0–100; everything else uses the layer's
  // domain (auto-computed unless the user gave an explicit range).
  const explicitRange = fill.range && Array.isArray(fill.range) && fill.range.length === 2;
  let lo, hi;
  if (explicitRange) {
    lo = Number(fill.range[0]); hi = Number(fill.range[1]);
  } else if (schema.kind === 'percentage') {
    lo = 0; hi = 100;
  } else {
    const dom = ctx.domains.get(layer.id);
    if (!dom) return _MISSING_COLOR;
    lo = dom.min; hi = dom.max;
  }
  if (hi === lo) hi = lo + 1;
  return _scaleColor(fill.scale || { kind: 'viridis' }, (v - lo) / (hi - lo));
}

// ────────────────────────────────────────────────────────────
// PROJECTION + SIMPLIFICATION
// ────────────────────────────────────────────────────────────
// v0.12.1: Web Mercator. The previous equirectangular projection
// matched neither OGF tiles nor user intuition for country-scale
// shapes. Mercator's y is non-linear in latitude:
//   y = ln(tan(π/4 + φ/2))
// where φ is latitude in radians. We negate y so north is up in SVG.

const _MERCATOR_MAX_LAT = 85.05112878;

function _projectLatLng(lat, lng) {
  const clamped = Math.max(-_MERCATOR_MAX_LAT, Math.min(_MERCATOR_MAX_LAT, lat));
  const rad = clamped * Math.PI / 180;
  const yMerc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  // Keep y in degree-equivalent units so viewBox math stays intuitive.
  return [lng, -yMerc * 180 / Math.PI];
}

function _projectedExtent(extent) {
  // extent in lat/lng → viewBox-ready { x, y, w, h } in projected space.
  const tl = _projectLatLng(extent.maxLat, extent.minLng);
  const br = _projectLatLng(extent.minLat, extent.maxLng);
  return { x: tl[0], y: tl[1], w: br[0] - tl[0], h: br[1] - tl[1] };
}

function _extentForPage(page) {
  if (page.extent && typeof page.extent === 'object' &&
      Number.isFinite(page.extent.minLat) && Number.isFinite(page.extent.maxLat) &&
      Number.isFinite(page.extent.minLng) && Number.isFinite(page.extent.maxLng)) {
    return page.extent;
  }
  return _autoExtentForPage(page);
}

function _autoExtentForPage(page) {
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  const consume = (lat, lng) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  };
  for (const layer of (page.layers || [])) {
    if (!layer || layer.visible === false) continue;
    if (layer.kind === 'boundary_fill' || layer.kind === 'boundary_outline') {
      for (const feat of _layerBoundaryFeatures(layer)) {
        for (const poly of feat.polygons) for (const ring of poly) for (const [la, ln] of ring) consume(la, ln);
      }
    } else if (layer.kind === 'plot_fill') {
      for (const feat of _layerPlotFeatures(layer)) {
        for (const poly of feat.polygons) for (const ring of poly) for (const [la, ln] of ring) consume(la, ln);
      }
    } else if (layer.kind === 'settlements') {
      for (const s of _layerSettlementMarkers(layer)) consume(s.lat, s.lng);
    }
  }
  if (!Number.isFinite(minLat)) return { minLat: -1, maxLat: 1, minLng: -1, maxLng: 1 };
  // 4% padding so geometry doesn't kiss the edge.
  const padLat = (maxLat - minLat) * 0.04 || 0.001;
  const padLng = (maxLng - minLng) * 0.04 || 0.001;
  return {
    minLat: minLat - padLat, maxLat: maxLat + padLat,
    minLng: minLng - padLng, maxLng: maxLng + padLng,
  };
}

// Visvalingam-Whyatt threshold from the simplification slider (0–100).
// Threshold has units of degrees² (effective-area is a triangle area
// in lat/lng degrees²). The slider is mapped logarithmically: each step
// is a multiplicative bump in the underlying side-length, because the
// algorithm's perceived effect is non-linear — the lower half barely
// touches the geometry while the top end is drastic. Concretely:
//   side(pct) = diag × 5e-5 × 100^(pct/100)
// so pct=0 → 0 (off), pct=50 → diag×5e-4, pct=100 → diag×5e-3 (≈0.5%
// of bbox on a side, same as the old linear top-end).
function _simplificationThreshold(extent, simplificationPercent) {
  const pct = Math.max(0, Math.min(100, Number(simplificationPercent) || 0));
  if (pct <= 0) return 0;
  const dLat = (extent.maxLat - extent.minLat) || 0;
  const dLng = (extent.maxLng - extent.minLng) || 0;
  const diag = Math.sqrt(dLat * dLat + dLng * dLng);
  const side = diag * 5e-5 * Math.pow(100, pct / 100);
  return side * side;
}

// Coordinate-snap grid for topology detection. Fine enough that
// "should-be-shared" vertices become bit-identical without losing
// real detail (~1 mm at the equator).
const _SNAP_GRID = 1e-8;
function _snapLatLng(lat, lng) {
  return [
    Math.round(lat / _SNAP_GRID) * _SNAP_GRID,
    Math.round(lng / _SNAP_GRID) * _SNAP_GRID,
  ];
}
function _coordKey(coord) {
  return coord[0].toFixed(9) + ',' + coord[1].toFixed(9);
}

// Topology-aware simplification across every polygon on the page. The
// strategy mirrors mapshaper's TopoJSON-arc Visvalingam (without
// explicit arc extraction):
//
//   1. Snap every coordinate to a fine grid so "same point in two
//      polygons" is bit-identical.
//   2. Build a global vertex-adjacency map: each vertex stores the
//      set of UNIQUE neighbours seen across every polygon it appears
//      in.
//   3. Junctions = vertices whose neighbour-count != 2 (corners
//      where 3+ polygons meet, or endpoints of arcs that split).
//   4. Per-ring Visvalingam-Whyatt: drop vertices in order of
//      smallest effective area, *unless* they're junctions.
//      A non-junction vertex on a shared boundary has the same EA
//      in both polygons (because EA is purely a function of the
//      vertex + its two neighbours, which are identical in both),
//      so both polygons drop it at the same threshold. Shared
//      edges stay shared.
//
// Mutates each feature's `polygons` in-place (the features array is
// freshly built per render call, so this doesn't leak into the
// boundary-geometry cache).
function _simplifyFeaturesTopologyAware(features, threshold) {
  if (threshold <= 0) return;

  // Pass 1: snap + collect adjacency.
  const adj = new Map();              // key → Set<key>
  const addEdge = (a, b) => {
    if (a === b) return;
    let s = adj.get(a);
    if (!s) { s = new Set(); adj.set(a, s); }
    s.add(b);
  };
  for (const feat of features) {
    feat.polygons = feat.polygons.map(poly => poly.map(ring => {
      // Snap, drop consecutive duplicates.
      const snapped = [];
      for (const [la, ln] of ring) {
        const [qa, qn] = _snapLatLng(la, ln);
        if (snapped.length === 0) { snapped.push([qa, qn]); continue; }
        const last = snapped[snapped.length - 1];
        if (last[0] !== qa || last[1] !== qn) snapped.push([qa, qn]);
      }
      // Drop a trailing duplicate-of-start (closed-ring noise).
      while (snapped.length > 1) {
        const f = snapped[0], l = snapped[snapped.length - 1];
        if (f[0] === l[0] && f[1] === l[1]) snapped.pop();
        else break;
      }
      const n = snapped.length;
      for (let i = 0; i < n; i++) {
        const curK = _coordKey(snapped[i]);
        const prevK = _coordKey(snapped[(i - 1 + n) % n]);
        const nextK = _coordKey(snapped[(i + 1) % n]);
        addEdge(curK, prevK);
        addEdge(curK, nextK);
      }
      return snapped;
    }));
  }

  // Junctions = vertices whose unique-neighbour count != 2.
  const junctions = new Set();
  for (const [k, neighbours] of adj) {
    if (neighbours.size !== 2) junctions.add(k);
  }

  // Pass 2: per-ring Visvalingam-Whyatt with junction protection.
  for (const feat of features) {
    feat.polygons = feat.polygons.map(poly =>
      poly.map(ring => _visvalingamRing(ring, threshold, junctions))
    );
  }
}

// Strict segment-intersection test (proper crossing, no shared endpoints).
// Points are [lat, lng]; we treat lng as x, lat as y.
function _segmentsCross(a, b, c, d) {
  // Reject shared endpoints — after coord snapping these compare bit-equal.
  if ((a[0] === c[0] && a[1] === c[1]) || (a[0] === d[0] && a[1] === d[1]) ||
      (b[0] === c[0] && b[1] === c[1]) || (b[0] === d[0] && b[1] === d[1])) return false;
  const ax = a[1], ay = a[0], bx = b[1], by = b[0];
  const cx = c[1], cy = c[0], dx = d[1], dy = d[0];
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Returns a simplified open ring (no duplicate closing vertex).
function _visvalingamRing(ring, threshold, junctions) {
  if (!ring || ring.length < 4) return ring || [];

  const n = ring.length;
  const prev = new Array(n);
  const nxt  = new Array(n);
  const alive = new Array(n).fill(true);
  for (let i = 0; i < n; i++) {
    prev[i] = (i - 1 + n) % n;
    nxt[i]  = (i + 1) % n;
  }

  function ea(i) {
    const k = _coordKey(ring[i]);
    if (junctions.has(k)) return Infinity;
    const p = ring[prev[i]];
    const v = ring[i];
    const x = ring[nxt[i]];
    // Triangle area in [lat, lng] = [y, x] space; absolute cross-prod / 2.
    return Math.abs((p[1] - v[1]) * (x[0] - v[0]) - (p[0] - v[0]) * (x[1] - v[1])) / 2;
  }

  const eas = new Array(n);
  for (let i = 0; i < n; i++) eas[i] = ea(i);

  // Would removing vertex `idx` cause the new segment (ring[prev[idx]] →
  // ring[nxt[idx]]) to cross some other alive segment of the ring?
  // Walks a window of ±W alive neighbours away from the removal point —
  // local self-intersections (the common mapshaper-style failure mode in
  // narrow island-bottlenecks) all show up within a few dozen hops, and
  // a bounded window keeps total cost at O(n·W) instead of O(n²).
  const W = 40;
  function wouldSelfIntersect(idx) {
    const p = prev[idx], x = nxt[idx];
    const newA = ring[p], newB = ring[x];
    // Forward window: segments after x, stopping before p.
    let i = x;
    for (let k = 0; k < W; k++) {
      const j = nxt[i];
      if (i === p || j === p || i === x && k > 0) break;
      if (i !== x) {
        if (_segmentsCross(newA, newB, ring[i], ring[j])) return true;
      }
      if (j === x) break;
      i = j;
    }
    // Backward window: segments before p, stopping after x.
    i = p;
    for (let k = 0; k < W; k++) {
      const j = prev[i];
      if (i === x || j === x || i === p && k > 0) break;
      if (i !== p) {
        if (_segmentsCross(newA, newB, ring[j], ring[i])) return true;
      }
      if (j === p) break;
      i = j;
    }
    return false;
  }

  // Simple O(n²) loop — fine for typical OGF polygon counts. Swap
  // to a real heap if we hit a big-country bottleneck.
  let aliveCount = n;
  while (aliveCount > 3) {
    let minEA = Infinity, minIdx = -1;
    for (let i = 0; i < n; i++) {
      if (alive[i] && eas[i] < minEA) { minEA = eas[i]; minIdx = i; }
    }
    if (minIdx < 0 || minEA >= threshold) break;
    // Veto removals that would fold the ring back across itself. Mark
    // the vertex un-removable for this pass and continue with the next
    // candidate. (Don't kill it permanently — its EA might be small only
    // because of the *current* prev/next; once neighbours change it may
    // no longer be the smallest candidate anyway.)
    if (wouldSelfIntersect(minIdx)) {
      eas[minIdx] = Infinity;
      continue;
    }
    alive[minIdx] = false;
    aliveCount--;
    const p = prev[minIdx], x = nxt[minIdx];
    nxt[p] = x;
    prev[x] = p;
    eas[p] = ea(p);
    eas[x] = ea(x);
  }

  const out = [];
  let start = -1;
  for (let i = 0; i < n; i++) if (alive[i]) { start = i; break; }
  if (start < 0) return ring;
  let i = start;
  do {
    out.push(ring[i]);
    i = nxt[i];
  } while (i !== start && out.length < n);
  return out;
}

// ────────────────────────────────────────────────────────────
// SVG PATH BUILDERS
// ────────────────────────────────────────────────────────────

function _ringToPathD(ring) {
  if (!ring || ring.length === 0) return '';
  const parts = [];
  for (let i = 0; i < ring.length; i++) {
    const [lat, lng] = ring[i];
    const [x, y] = _projectLatLng(lat, lng);
    parts.push((i === 0 ? 'M' : 'L') + x + ',' + y);
  }
  parts.push('Z');
  return parts.join('');
}

function _polygonsToPathD(polygons) {
  // polygons is Array<Array<Array<[lat,lng]>>>: multi-polygon → polygons
  // → rings → coords. Each sub-polygon emits one M-L-Z run per ring;
  // SVG `fill-rule="evenodd"` interprets nested rings as holes.
  const parts = [];
  for (const poly of polygons) {
    for (const ring of poly) parts.push(_ringToPathD(ring));
  }
  return parts.join('');
}

// ────────────────────────────────────────────────────────────
// MAIN RENDERER
// ────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

// Renders the page into the given container element. Returns the
// created SVG node. Replaces any prior content of the container.
function renderAtlasPage(page, container, opts) {
  opts = opts || {};
  if (!container) return null;
  while (container.firstChild) container.removeChild(container.firstChild);

  // Wrapper so the tooltip can sit absolute-positioned above the SVG.
  const wrap = document.createElement('div');
  wrap.className = 'atlas-page-wrap';
  container.appendChild(wrap);

  const tooltip = document.createElement('div');
  tooltip.className = 'atlas-page-tooltip';
  tooltip.style.display = 'none';
  wrap.appendChild(tooltip);

  const extent = _extentForPage(page);
  const vb = _projectedExtent(extent);
  const threshold = _simplificationThreshold(extent, page.simplification);

  // Pre-fetch features per polygon layer so we can simplify topology-
  // aware across all of them before rendering.
  const featuresByLayer = new Map(); // layer.id → features[]
  for (const layer of (page.layers || [])) {
    if (!layer || layer.visible === false) continue;
    if (layer.kind === 'settlements') continue;
    const features = (layer.kind === 'plot_fill')
      ? _layerPlotFeatures(layer)
      : _layerBoundaryFeatures(layer);
    featuresByLayer.set(layer.id, features);
  }
  if (threshold > 0) {
    const allFeatures = [];
    for (const arr of featuresByLayer.values()) allFeatures.push(...arr);
    _simplifyFeaturesTopologyAware(allFeatures, threshold);
  }

  // Pre-compute per-layer rendering context (schema lookup, domains,
  // categorical maps) once so we don't recompute inside the loop.
  const ctx = {
    schemaById: new Map(),
    domains: new Map(),         // layerId → { min, max }
    categoricalMaps: new Map(), // layerId → Map<value, color>
  };
  for (const layer of (page.layers || [])) {
    if (!layer || layer.visible === false) continue;
    const fill = layer.fill;
    if (!fill || fill.mode !== 'property') continue;
    const schema = (typeof findPropertySchema === 'function') ? findPropertySchema(fill.schemaId) : null;
    if (!schema) continue;
    ctx.schemaById.set(fill.schemaId, schema);
    const entities = featuresByLayer.get(layer.id) || [];
    if (schema.kind === 'categorical') {
      ctx.categoricalMaps.set(layer.id, _buildCategoricalMap(entities, layer.kind === 'plot_fill' ? 'plot' : 'boundary', schema));
    } else {
      const dom = _computeNumericDomain(entities, layer.kind === 'plot_fill' ? 'plot' : 'boundary', schema);
      if (dom) ctx.domains.set(layer.id, dom);
    }
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'atlas-page-svg');
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // Stash the *initial* viewBox so the zoom/pan reset button can return.
  svg.__appyInitialVB = { ...vb };
  // Plain dark background (decision X). Background is BIG so it covers
  // the visible area even when the user pans away from the initial vb.
  const bg = document.createElementNS(SVG_NS, 'rect');
  const padW = vb.w * 4, padH = vb.h * 4;
  bg.setAttribute('x', vb.x - padW);
  bg.setAttribute('y', vb.y - padH);
  bg.setAttribute('width',  vb.w + padW * 2);
  bg.setAttribute('height', vb.h + padH * 2);
  bg.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#0f1117');
  svg.appendChild(bg);

  // Layer rendering — in order; index 0 = bottom. Polygon features
  // were already simplified topology-aware above; the renderers just
  // emit paths from feat.polygons.
  for (const layer of (page.layers || [])) {
    if (!layer || layer.visible === false) continue;
    const feats = featuresByLayer.get(layer.id) || [];
    if (layer.kind === 'boundary_fill') _renderPolygonLayer(svg, layer, feats, 'boundary', ctx);
    else if (layer.kind === 'plot_fill') _renderPolygonLayer(svg, layer, feats, 'plot', ctx);
    else if (layer.kind === 'boundary_outline') _renderOutlineLayer(svg, layer, feats);
    else if (layer.kind === 'settlements') _renderSettlementLayer(svg, layer, vb);
  }
  wrap.appendChild(svg);

  // Zoom + pan plumbing. Wheel scrolls zoom around the cursor; click +
  // drag (on empty SVG area) pans. A small overlay button resets back
  // to the auto-fit view.
  _attachAtlasZoomPan(svg, bg);
  const resetBtn = document.createElement('button');
  resetBtn.className = 'atlas-reset-zoom';
  resetBtn.type = 'button';
  resetBtn.title = (typeof t === 'function' && t('atlas.reset_view')) || 'Reset view';
  resetBtn.textContent = '⟲';
  resetBtn.addEventListener('click', () => {
    const init = svg.__appyInitialVB;
    if (!init) return;
    svg.setAttribute('viewBox', `${init.x} ${init.y} ${init.w} ${init.h}`);
  });
  wrap.appendChild(resetBtn);

  // Hover plumbing — one listener on the SVG root; targets identified
  // by `data-entity-name` + `data-entity-value` on each feature node.
  svg.addEventListener('mousemove', (e) => {
    const target = e.target;
    if (!target || target.nodeName === 'svg' || target.nodeName === 'rect' && target === bg) {
      tooltip.style.display = 'none';
      return;
    }
    const name = target.getAttribute('data-entity-name');
    const value = target.getAttribute('data-entity-value');
    if (name == null && value == null) {
      tooltip.style.display = 'none';
      return;
    }
    const rect = wrap.getBoundingClientRect();
    tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
    tooltip.style.top  = (e.clientY - rect.top + 12) + 'px';
    tooltip.innerHTML = `<div class="atlas-tt-name">${esc(name || '—')}</div>` +
                       (value ? `<div class="atlas-tt-value mono">${esc(value)}</div>` : '');
    tooltip.style.display = 'block';
  });
  svg.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  return svg;
}

// Wheel zooms toward the cursor; mousedown on empty SVG area pans.
// View state is the SVG's `viewBox` attribute parsed each time —
// keeps the renderer stateless aside from `__appyInitialVB`.
function _attachAtlasZoomPan(svg, bg) {
  let panning = false;
  let panStart = null;
  let panStartVB = null;

  function readVB() {
    const parts = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  }
  function writeVB(v) {
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }
  function clientToSvg(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const v = readVB();
    if (!rect.width || !rect.height || !v) return null;
    return {
      x: v.x + ((clientX - rect.left) / rect.width)  * v.w,
      y: v.y + ((clientY - rect.top)  / rect.height) * v.h,
    };
  }

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = readVB(); if (!v) return;
    // Bigger steps for trackpads (deltaMode === 0); roll-mouse is fine
    // with the same factor.
    const factor = Math.pow(1.0015, e.deltaY);
    const at = clientToSvg(e.clientX, e.clientY); if (!at) return;
    v.x = at.x - (at.x - v.x) * factor;
    v.y = at.y - (at.y - v.y) * factor;
    v.w *= factor;
    v.h *= factor;
    writeVB(v);
  }, { passive: false });

  svg.addEventListener('mousedown', (e) => {
    // Any mousedown on the SVG (including over polygons) starts a pan.
    // Atlas pages don't bind click actions to features (decision R —
    // hover only), so swallowing the mousedown costs nothing.
    if (e.button !== 0) return; // left mouse only
    panning = true;
    panStart = { x: e.clientX, y: e.clientY };
    panStartVB = readVB();
    svg.classList.add('atlas-page-svg-panning');
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!panning || !panStartVB) return;
    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - panStart.x) / rect.width  * panStartVB.w;
    const dy = (e.clientY - panStart.y) / rect.height * panStartVB.h;
    writeVB({
      x: panStartVB.x - dx,
      y: panStartVB.y - dy,
      w: panStartVB.w,
      h: panStartVB.h,
    });
  };
  const onUp = () => {
    if (!panning) return;
    panning = false; panStartVB = null;
    svg.classList.remove('atlas-page-svg-panning');
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  // Best-effort cleanup if the SVG is removed from the DOM (no
  // explicit teardown call — both views just replace innerHTML).
  // The listeners stay attached to window but only run while
  // `panning` is true, and `panning` resets on mouseup.
}

function _renderPolygonLayer(svg, layer, features, kind, ctx) {
  const fill = layer.fill || { mode: 'static', color: '#475569' };
  const schema = fill.mode === 'property' ? ctx.schemaById.get(fill.schemaId) : null;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-layer atlas-layer-' + layer.kind);
  for (const feat of features) {
    const polys = feat.polygons;
    const fillD = _polygonsToPathD(polys);
    if (!fillD) continue;
    const fillPath = document.createElementNS(SVG_NS, 'path');
    fillPath.setAttribute('d', fillD);
    fillPath.setAttribute('fill', _fillColorForEntity(feat.entity, kind, layer, ctx));
    fillPath.setAttribute('fill-rule', 'evenodd');
    fillPath.setAttribute('stroke', 'none');
    fillPath.setAttribute('data-entity-name', feat.entity.name || (kind === 'plot' ? '(plot)' : '(boundary)'));
    if (schema) {
      const v = _resolveLayerValue(feat.entity, kind, fill.schemaId);
      const disp = _formatPropertyValueForTooltip(schema, v);
      if (disp) fillPath.setAttribute('data-entity-value', `${schema.name}: ${disp}`);
    }
    g.appendChild(fillPath);
  }
  svg.appendChild(g);
}

function _renderOutlineLayer(svg, layer, features) {
  const stroke = layer.stroke || { color: '#8b8fa4', width: 0.6, opacity: 0.8 };
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-layer atlas-layer-' + layer.kind);
  for (const feat of features) {
    const polys = feat.polygons;
    const d = _polygonsToPathD(polys);
    if (!d) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', _strokeWidthSVG(stroke.width));
    path.setAttribute('stroke-opacity', stroke.opacity);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('data-entity-name', feat.entity.name || '(boundary)');
    g.appendChild(path);
  }
  svg.appendChild(g);
}

function _renderSettlementLayer(svg, layer, vb) {
  const markers = _layerSettlementMarkers(layer);
  const style = layer.style || {};
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-layer atlas-layer-settlements');
  // Radius is in viewBox units (degrees-ish). Scale by viewBox diagonal so
  // the dot reads at a roughly stable pixel size across both small-city and
  // country-scale pages. `radius` from the layer style is a "user pixels"
  // value (slider 1–20); we then convert to viewBox units. 800px is the
  // typical rendered SVG width — this gives a 1:1-ish px feel.
  const diag = vb ? Math.hypot(vb.w, vb.h) : 1;
  const userR = Number(style.radius) > 0 ? Number(style.radius) : 4;
  const r = userR * diag / 800;
  const showLabels = !!style.labels;
  const labelSize = (Number(style.labelSize) > 0 ? Number(style.labelSize) : 11) * diag / 800;
  for (const s of markers) {
    const [cx, cy] = _projectLatLng(s.lat, s.lng);
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    c.setAttribute('r', r);
    const fillColor = style.fill ||
      (typeof colorForPlaceType === 'function' ? colorForPlaceType(s.place) : '#7f8c8d');
    c.setAttribute('fill', fillColor);
    c.setAttribute('stroke', style.stroke || '#0f1117');
    c.setAttribute('stroke-width', _strokeWidthSVG(style.strokeWidth || 0.5));
    c.setAttribute('vector-effect', 'non-scaling-stroke');
    c.setAttribute('data-entity-name', s.name || '(unnamed)');
    if (s.place) c.setAttribute('data-entity-value', s.place);
    g.appendChild(c);
    if (showLabels && s.name) {
      const tx = document.createElementNS(SVG_NS, 'text');
      tx.setAttribute('x', cx + r * 1.4);
      tx.setAttribute('y', cy + r * 0.4);
      tx.setAttribute('font-size', labelSize);
      tx.setAttribute('fill', style.labelColor || '#e6e8ef');
      const haloMult = Number(style.labelHaloWidth);
      const haloW = Number.isFinite(haloMult) ? haloMult : 0.25;
      tx.setAttribute('stroke', style.labelHalo || '#0f1117');
      tx.setAttribute('stroke-width', labelSize * haloW);
      tx.setAttribute('paint-order', 'stroke fill');
      tx.setAttribute('pointer-events', 'none');
      const fam = style.labelFont || 'Hammersmith One';
      // Quote multi-word font names; always provide a fallback stack.
      const famQuoted = /\s/.test(fam) ? `"${fam}"` : fam;
      tx.setAttribute('font-family', `${famQuoted}, "DM Sans", sans-serif`);
      tx.textContent = s.name;
      g.appendChild(tx);
    }
  }
  svg.appendChild(g);
}

// Stroke widths are authored in CSS-like pixels (1, 0.6, 2…). With
// `vector-effect: non-scaling-stroke` applied via CSS to every child of
// `.atlas-page-svg`, the value is interpreted in canvas-pixel units
// regardless of the viewBox transform, so widths stay constant under
// zoom. The earlier 0.0005 user-unit multiplier was a workaround for
// browsers that ignored the inline `vector-effect` attribute — the CSS
// rule on the parent applies consistently across all the engines we
// care about, so we can drop the divisor.
function _strokeWidthSVG(widthPx) {
  return Number(widthPx) || 1;
}

function _formatPropertyValueForTooltip(schema, v) {
  if (v === null || v === undefined || v === '') return '';
  if (schema.kind === 'percentage' && typeof v === 'object') {
    if (v.mode === 'percent') return `${formatPropertyNumber(v.value)}%`;
    if (v.mode === 'raw')     return formatPropertyNumber(v.value);
    return '';
  }
  if (typeof v === 'number') {
    return formatPropertyNumber(v) + (schema.unit ? ` ${schema.unit}` : '');
  }
  return String(v);
}
