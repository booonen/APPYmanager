// ============================================================
// SETTLEMENTS — OGF place=* point references (Brick 7)
// ============================================================
// A settlement is a single OGF `place=*` node — a point with a name
// and a category (city / town / village / hamlet / suburb / locality / …).
// Settlements are *not* load-bearing for demographics aggregation; they
// are worldbuilding labels that round-trip through `.osc` later (Brick
// 15). Each settlement has at most one parent — a plot OR a boundary —
// for hierarchy display and `.osc` round-tripping.
//
// settlement = {
//   id,                         // local uid
//   name,                       // display name (from OGF or user-edited)
//   lat, lng,                   // position (decimal degrees)
//   ogfNodeId,                  // OGF node id, null if user-created
//   place,                      // 'city' | 'town' | 'village' | 'hamlet' | …
//   parent: { kind, id } | null,  // 'plot' | 'boundary' | null
//   notes,
//   flags: [string, ...],
// }

// Standard OSM place=* values, ordered by typical population scale.
// Used for the import preset selector and the place chip in the UI.
const PLACE_TYPES = [
  'city', 'town', 'village', 'hamlet', 'suburb',
  'borough', 'quarter', 'neighbourhood', 'isolated_dwelling', 'locality',
];

// Sensible default for the import-modal preset selector. Pulls in the
// load-bearing settlement nodes; smaller place types stay opt-in to keep
// initial imports tight.
const PLACE_TYPES_DEFAULT_CHECKED = ['city', 'town', 'village'];

// JOSM-style colour per place=*. Used everywhere a settlement chip or
// marker is rendered (map markers, preview map, side-panel chips, list
// view, import preview, place-filter dropdown).
const PLACE_COLORS = {
  city:              '#9b59b6', // purple
  town:              '#d35400', // dark orange
  village:           '#e67e22', // orange
  suburb:            '#f39c12', // yellow-orange
  hamlet:            '#f1c40f', // yellow
  borough:           '#27ae60', // dark green
  quarter:           '#e91e63', // pink
  neighbourhood:     '#c8a165', // tan
  isolated_dwelling: '#9ccc65', // light green
  locality:          '#7f8c8d', // grey
};

// Render-order rank: higher = drawn later = on top. Mirrors the rough
// OSM importance ladder so cities sit above hamlets etc.
const PLACE_RANK = {
  city:              10,
  town:               9,
  village:            8,
  borough:            7,
  suburb:             6,
  hamlet:             5,
  quarter:            4,
  neighbourhood:      3,
  isolated_dwelling:  2,
  locality:           1,
};

function colorForPlaceType(place) {
  return PLACE_COLORS[place] || '#7f8c8d';
}

function rankForPlaceType(place) {
  return PLACE_RANK[place] || 0;
}

function createSettlement({ name, lat, lng, ogfNodeId, place, parent, notes, flags }) {
  const s = {
    id:        uid(),
    name:      name || '',
    lat:       Number(lat),
    lng:       Number(lng),
    ogfNodeId: ogfNodeId == null ? null : String(ogfNodeId),
    place:     place || '',
    parent:    parent && parent.kind && parent.id ? { kind: parent.kind, id: parent.id } : null,
    notes:     notes || '',
    flags:     flags || [],
  };
  data.settlements = data.settlements || [];
  data.settlements.push(s);
  return s;
}

function deleteSettlement(id) {
  if (!data.settlements) return;
  data.settlements = data.settlements.filter(s => s.id !== id);
}

// Look up a settlement by its OGF node id (used to dedupe re-imports).
// Returns null if not yet imported.
function findSettlementByOgfNodeId(ogfNodeId) {
  if (ogfNodeId == null) return null;
  const key = String(ogfNodeId);
  return (data.settlements || []).find(s => s.ogfNodeId === key) || null;
}

// Resolve the parent reference into a display name + type label.
// Returns { name, typeLabel } or null when the settlement is unparented.
function getSettlementParentInfo(settlement) {
  if (!settlement?.parent) return null;
  const { kind, id } = settlement.parent;
  if (kind === 'plot') {
    const p = data.plots.find(x => x.id === id);
    return p ? { name: p.name || '', typeLabel: 'Plot' } : null;
  }
  if (kind === 'boundary') {
    const b = data.boundaries.find(x => x.id === id);
    return b ? { name: b.name || '', typeLabel: getBoundaryTypeName(b.typeId) || 'Boundary' } : null;
  }
  return null;
}

// All settlements that fall under a given boundary, walking transitive
// containment: direct settlement-of-boundary attachments, plus settlements
// whose parent is a plot or sub-boundary inside this boundary. Used by
// the side panel members section (Brick 7c).
function flattenSettlementsForBoundary(boundary) {
  if (!boundary) return [];
  const plotIds = new Set(flattenBoundaryToPlotIds(boundary));
  const boundaryIds = new Set();
  (function walk(b) {
    if (!b || boundaryIds.has(b.id)) return;
    boundaryIds.add(b.id);
    for (const m of (b.members || [])) {
      if (m.kind === 'boundary') {
        walk(data.boundaries.find(x => x.id === m.id));
      }
    }
  })(boundary);
  const out = [];
  for (const s of (data.settlements || [])) {
    if (!s.parent) continue;
    if (s.parent.kind === 'plot' && plotIds.has(s.parent.id)) out.push(s);
    else if (s.parent.kind === 'boundary' && boundaryIds.has(s.parent.id)) out.push(s);
  }
  return out;
}

// Settlements directly attached to a single plot. Cheap lookup.
function settlementsForPlot(plotId) {
  return (data.settlements || []).filter(s => s.parent?.kind === 'plot' && s.parent.id === plotId);
}

// Pick the most specific containing region for a settlement at (lat, lng).
// Plot first (most specific anchor), then boundaries smallest-type-first
// (deepest in the primitiveId chain). Returns null if nothing contains
// the point — the user can still import it as an unparented settlement.
function autoAssignSettlementParent(lat, lng) {
  if (typeof turf === 'undefined') return null;
  const pt = turf.point([lng, lat]);

  for (const plot of data.plots) {
    const f = plotToGeoJSONFeature(plot);
    if (!f) continue;
    try {
      if (turf.booleanPointInPolygon(pt, f)) return { kind: 'plot', id: plot.id };
    } catch (_) {}
  }

  // _typesLargestFirst lives in map.js; reverse for smallest first.
  const types = (typeof _typesLargestFirst === 'function')
    ? _typesLargestFirst()
    : (data.boundaryTypes || []);
  for (let i = types.length - 1; i >= 0; i--) {
    const ty = types[i];
    for (const b of data.boundaries) {
      if (b.typeId !== ty.id) continue;
      const geom = (typeof resolveBoundaryGeometry === 'function') ? resolveBoundaryGeometry(b) : null;
      if (!geom?.feature) continue;
      try {
        if (turf.booleanPointInPolygon(pt, geom.feature)) return { kind: 'boundary', id: b.id };
      } catch (_) {}
    }
  }
  return null;
}

// ============================================================
// PARENT RECONCILIATION
// ============================================================
// Two situations need fixing whenever the geometry landscape changes:
//   1. Settlements imported before any covering plot/boundary exists
//      sit at parent=null; once the covering region lands, they should
//      auto-attach (otherwise they linger as "no parent (uncovered)"
//      forever after a later plot import).
//   2. A plot or boundary deletion can leave a settlement pointing at
//      a dangling id; the parent reference must be cleaned up and a
//      replacement attempted from whatever still covers the point.
//
// Hooked into invalidateBoundaryGeometry so it runs after every
// mutation that could change containment. Returns true when at least
// one settlement's parent changed so the caller can decide to persist.

function reconcileSettlementParents() {
  if (typeof turf === 'undefined') return false;
  const settlements = data.settlements || [];
  let changed = false;

  for (const s of settlements) {
    const before = s.parent ? `${s.parent.kind}:${s.parent.id}` : '';

    // Drop dangling references first.
    if (s.parent) {
      const stillExists = s.parent.kind === 'plot'
        ? data.plots.some(p => p.id === s.parent.id)
        : data.boundaries.some(b => b.id === s.parent.id);
      if (!stillExists) s.parent = null;
    }

    // Auto-assign null parents (whether they were imported uncovered
    // or just orphaned above).
    if (!s.parent) {
      const newParent = autoAssignSettlementParent(s.lat, s.lng);
      if (newParent) s.parent = newParent;
    }

    const after = s.parent ? `${s.parent.kind}:${s.parent.id}` : '';
    if (before !== after) changed = true;
  }

  return changed;
}
