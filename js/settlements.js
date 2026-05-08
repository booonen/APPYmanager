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
