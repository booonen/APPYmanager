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
  if (kind === 'sequential') return _interpStops(_SEQUENTIAL_STOPS, t);
  return _interpStops(_VIRIDIS_STOPS, t);
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
        stroke: { color: '#0f1117', width: 1, opacity: 0.9 },
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
        stroke: { color: '#0f1117', width: 0.4, opacity: 0.7 },
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
  const tally = new Map();
  for (const e of entities) {
    const v = _resolveLayerValue(e.entity, kind, schema.id);
    if (v === null || v === undefined || v === '') continue;
    const key = String(v);
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
  const map = new Map();
  for (let i = 0; i < sorted.length && i < _CATEGORICAL_PALETTE.length; i++) {
    map.set(sorted[i][0], _CATEGORICAL_PALETTE[i]);
  }
  return map;  // values not in `map` → "Other"
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

function _simplificationToleranceDeg(extent, simplificationPercent) {
  const pct = Math.max(0, Math.min(100, Number(simplificationPercent) || 0));
  if (pct <= 0) return 0;
  const dLat = (extent.maxLat - extent.minLat) || 0;
  const dLng = (extent.maxLng - extent.minLng) || 0;
  const diag = Math.sqrt(dLat * dLat + dLng * dLng);
  // 100% → 1% of diagonal; 50% → 0.5%; etc.
  return diag * (pct / 100) * 0.01;
}

// Simplify a polygon (outer + holes) using turf. Skips if tolerance is
// zero or turf isn't available. Returns the same shape (lat/lng arrays).
function _simplifyPolygon(polygon, tolerance) {
  if (!tolerance || tolerance <= 0) return polygon;
  if (typeof turf === 'undefined' || typeof turf.simplify !== 'function') return polygon;
  try {
    const lngLat = polygon.map(ring => {
      const closed = ring.map(([la, ln]) => [ln, la]);
      if (closed.length >= 2 &&
          (closed[0][0] !== closed[closed.length - 1][0] ||
           closed[0][1] !== closed[closed.length - 1][1])) {
        closed.push([closed[0][0], closed[0][1]]);
      }
      return closed;
    });
    const poly = turf.polygon(lngLat);
    const simp = turf.simplify(poly, { tolerance, highQuality: false });
    if (!simp || !simp.geometry) return polygon;
    return simp.geometry.coordinates.map(ring => ring.map(([ln, la]) => [la, ln]));
  } catch (_) { return polygon; }
}

// ────────────────────────────────────────────────────────────
// SVG PATH BUILDERS
// ────────────────────────────────────────────────────────────

function _ringToPathD(ring) {
  if (!ring || ring.length === 0) return '';
  const parts = [];
  for (let i = 0; i < ring.length; i++) {
    const [lat, lng] = ring[i];
    parts.push((i === 0 ? 'M' : 'L') + lng + ',' + (-lat));
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
  const w = extent.maxLng - extent.minLng;
  const h = extent.maxLat - extent.minLat;
  const tolerance = _simplificationToleranceDeg(extent, page.simplification);

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
    const entities = layer.kind === 'plot_fill'
      ? _layerPlotFeatures(layer)
      : _layerBoundaryFeatures(layer);
    if (schema.kind === 'categorical') {
      ctx.categoricalMaps.set(layer.id, _buildCategoricalMap(entities, layer.kind === 'plot_fill' ? 'plot' : 'boundary', schema));
    } else {
      const dom = _computeNumericDomain(entities, layer.kind === 'plot_fill' ? 'plot' : 'boundary', schema);
      if (dom) ctx.domains.set(layer.id, dom);
    }
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'atlas-page-svg');
  svg.setAttribute('viewBox', `${extent.minLng} ${-extent.maxLat} ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // Plain dark background (decision X).
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', extent.minLng);
  bg.setAttribute('y', -extent.maxLat);
  bg.setAttribute('width', w);
  bg.setAttribute('height', h);
  bg.setAttribute('fill', getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#0f1117');
  svg.appendChild(bg);

  // Layer rendering — in order; index 0 = bottom.
  for (const layer of (page.layers || [])) {
    if (!layer || layer.visible === false) continue;
    if (layer.kind === 'boundary_fill') _renderPolygonLayer(svg, layer, _layerBoundaryFeatures(layer), 'boundary', ctx, tolerance);
    else if (layer.kind === 'plot_fill') _renderPolygonLayer(svg, layer, _layerPlotFeatures(layer), 'plot', ctx, tolerance);
    else if (layer.kind === 'boundary_outline') _renderOutlineLayer(svg, layer, _layerBoundaryFeatures(layer), tolerance);
    else if (layer.kind === 'settlements') _renderSettlementLayer(svg, layer);
  }
  wrap.appendChild(svg);

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

function _renderPolygonLayer(svg, layer, features, kind, ctx, tolerance) {
  const stroke = layer.stroke || { color: '#0f1117', width: 0.4, opacity: 0.8 };
  const fill = layer.fill || { mode: 'static', color: '#475569' };
  const schema = fill.mode === 'property' ? ctx.schemaById.get(fill.schemaId) : null;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-layer atlas-layer-' + layer.kind);
  for (const feat of features) {
    const polys = tolerance > 0
      ? feat.polygons.map(p => _simplifyPolygon(p, tolerance))
      : feat.polygons;
    const d = _polygonsToPathD(polys);
    if (!d) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', _fillColorForEntity(feat.entity, kind, layer, ctx));
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('stroke', stroke.color || '#0f1117');
    path.setAttribute('stroke-width', _strokeWidthSVG(stroke.width || 1));
    path.setAttribute('stroke-opacity', stroke.opacity != null ? stroke.opacity : 0.85);
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('data-entity-name', feat.entity.name || (kind === 'plot' ? '(plot)' : '(boundary)'));
    if (schema) {
      const v = _resolveLayerValue(feat.entity, kind, fill.schemaId);
      const disp = _formatPropertyValueForTooltip(schema, v);
      if (disp) path.setAttribute('data-entity-value', `${schema.name}: ${disp}`);
    }
    g.appendChild(path);
  }
  svg.appendChild(g);
}

function _renderOutlineLayer(svg, layer, features, tolerance) {
  const stroke = layer.stroke || { color: '#8b8fa4', width: 0.6, opacity: 0.8 };
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-layer atlas-layer-' + layer.kind);
  for (const feat of features) {
    const polys = tolerance > 0
      ? feat.polygons.map(p => _simplifyPolygon(p, tolerance))
      : feat.polygons;
    const d = _polygonsToPathD(polys);
    if (!d) continue;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', _strokeWidthSVG(stroke.width));
    path.setAttribute('stroke-opacity', stroke.opacity);
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    path.setAttribute('data-entity-name', feat.entity.name || '(boundary)');
    g.appendChild(path);
  }
  svg.appendChild(g);
}

function _renderSettlementLayer(svg, layer) {
  const markers = _layerSettlementMarkers(layer);
  const style = layer.style || {};
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-layer atlas-layer-settlements');
  for (const s of markers) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', s.lng);
    c.setAttribute('cy', -s.lat);
    // Radius is in viewBox units; we want the dot to read at a stable
    // pixel size regardless of zoom. Use vector-effect on stroke and
    // compute a small radius via a fraction of the diagonal — keeps
    // settlements visible across both tiny and country-scale pages.
    c.setAttribute('r', (style.radius || 4) * 0.0005); // ~stable pixel feel
    const fillColor = style.fill ||
      (typeof colorForPlaceType === 'function' ? colorForPlaceType(s.place) : '#7f8c8d');
    c.setAttribute('fill', fillColor);
    c.setAttribute('stroke', style.stroke || '#0f1117');
    c.setAttribute('stroke-width', _strokeWidthSVG(style.strokeWidth || 0.5));
    c.setAttribute('vector-effect', 'non-scaling-stroke');
    c.setAttribute('data-entity-name', s.name || '(unnamed)');
    if (s.place) c.setAttribute('data-entity-value', s.place);
    g.appendChild(c);
  }
  svg.appendChild(g);
}

// SVG stroke widths are in viewBox units — but everything here is in
// degrees. We want px-like widths, so scale by ~0.0005 (works out to
// ~0.5–1 px on a typical country bbox). non-scaling-stroke keeps them
// constant under zoom.
function _strokeWidthSVG(widthPx) {
  return ((Number(widthPx) || 1)) * 0.0005;
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
