// ============================================================
// BOUNDARIES — Boundary entity data layer (Brick 6)
// ============================================================
// A boundary is a higher-level region that groups plots OR other
// boundaries. It carries no geometry of its own — its shape is the
// dissolved union of its members' geometries (rendered in 6b).
//
// boundary = {
//   id,
//   name,
//   typeId,                      // → boundaryTypes[].id
//   members: [{ kind, id }, ...] // kind: 'plot' | 'boundary'
//   notes,
//   flags: [string, ...],
// }
//
// Two rules enforced here (see CLAUDE.md / Brick 6):
//   1. Transitive containment — a boundary of type T may directly
//      hold any plot or boundary whose type sits anywhere below T
//      in the primitiveId chain (not just the immediate primitive).
//   2. Exclusivity — every plot/boundary has at most ONE direct
//      parent boundary, globally. Already-claimed items are not
//      eligible to be added to another boundary.

function createBoundary({ name, typeId, members, notes, flags }) {
  const boundary = {
    id: uid(),
    name: name || '',
    typeId: typeId || null,
    members: members || [],
    notes: notes || '',
    flags: flags || [],
  };
  data.boundaries.push(boundary);
  return boundary;
}

// ============================================================
// TYPE-CHAIN WALKERS
// ============================================================
// `primitiveId` on a boundary type points to the type it contains.
// Walking primitiveId from any starting type forms a single chain
// going DOWN to plots (plots = the implicit terminal). The chain is
// guaranteed acyclic by Brick 4's cycle detection.

function _typeChainBelow(typeId) {
  // Returns the list of type ids strictly below typeId, closest first.
  // E.g. for Country → Province → Municipality → null:
  //   _typeChainBelow(country.id) = [province.id, municipality.id]
  const chain = [];
  let cur = data.boundaryTypes.find(t => t.id === typeId);
  if (!cur) return chain;
  let next = cur.primitiveId;
  while (next) {
    chain.push(next);
    cur = data.boundaryTypes.find(t => t.id === next);
    if (!cur) break;
    next = cur.primitiveId;
  }
  return chain;
}

function _typeChainReachesPlots(typeId) {
  // True if the chain from typeId bottoms out at null (plots reachable).
  let cur = data.boundaryTypes.find(t => t.id === typeId);
  const seen = new Set();
  while (cur) {
    if (cur.primitiveId === null || cur.primitiveId === undefined) return true;
    if (seen.has(cur.id)) return false;
    seen.add(cur.id);
    cur = data.boundaryTypes.find(t => t.id === cur.primitiveId);
  }
  return false;
}

// True if a boundary of parentTypeId may transitively contain a boundary
// of childTypeId. Used by the promotion check: a boundary B can be wedged
// between an existing claimer A and the previously-direct member X iff
// A's type may contain B's type.
function canTypeContain(parentTypeId, childTypeId) {
  if (!parentTypeId || !childTypeId) return false;
  return _typeChainBelow(parentTypeId).includes(childTypeId);
}

// Returns the boundary that currently has (kind:id) as a direct member,
// excluding excludeBoundaryId. null if free.
function findClaimingBoundary(kind, id, excludeBoundaryId) {
  for (const b of data.boundaries) {
    if (excludeBoundaryId && b.id === excludeBoundaryId) continue;
    if ((b.members || []).some(m => m.kind === kind && m.id === id)) return b;
  }
  return null;
}

// ============================================================
// CLAIMED-MEMBERSHIP INDEX
// ============================================================
// Builds a Set of "kind:id" keys for every plot/boundary already a
// direct member of some boundary, optionally excluding the boundary
// being edited (so its own current members don't appear claimed).

function buildClaimedSet(excludeBoundaryId) {
  const claimed = new Set();
  for (const b of data.boundaries) {
    if (excludeBoundaryId && b.id === excludeBoundaryId) continue;
    for (const m of (b.members || [])) {
      claimed.add(m.kind + ':' + m.id);
    }
  }
  return claimed;
}

// ============================================================
// ELIGIBLE-MEMBERS PICKER LIST
// ============================================================
// Returns every plot / boundary whose type sits in the chain below
// the parent's type. Each entry carries a `claimed` flag so the UI
// can distinguish (a) already-a-member-of-this-boundary,
// (b) free, (c) claimed-by-someone-else.
//
// returns [{ kind, id, name, typeId?, typeName?, currentMember, claimedElsewhere }]

function getEligibleMembers(parentTypeId, parentBoundaryId) {
  if (!parentTypeId) return [];
  const chainTypes  = _typeChainBelow(parentTypeId);
  const reachPlots  = _typeChainReachesPlots(parentTypeId);
  const claimed     = buildClaimedSet(parentBoundaryId);

  const parent = parentBoundaryId
    ? data.boundaries.find(b => b.id === parentBoundaryId)
    : null;
  const ownMembers = new Set(
    (parent?.members || []).map(m => m.kind + ':' + m.id)
  );

  const out = [];

  const annotateClaim = (entry) => {
    if (!entry.claimedElsewhere) return entry;
    const claimer = findClaimingBoundary(entry.kind, entry.id, parentBoundaryId);
    if (claimer) {
      entry.claimingBoundaryId   = claimer.id;
      entry.claimingBoundaryName = claimer.name || '';
      entry.claimingBoundaryType = getBoundaryTypeName(claimer.typeId);
      // Promotable iff the claimer's type may contain parent's type:
      // we plan to wedge `parent` between `claimer` and `entry`.
      entry.promotable = canTypeContain(claimer.typeId, parentTypeId);
    }
    return entry;
  };

  if (reachPlots) {
    for (const p of data.plots) {
      const key = 'plot:' + p.id;
      out.push(annotateClaim({
        kind: 'plot',
        id: p.id,
        name: p.name || '',
        typeName: null,
        currentMember:    ownMembers.has(key),
        claimedElsewhere: claimed.has(key),
      }));
    }
  }

  for (const b of data.boundaries) {
    if (b.id === parentBoundaryId) continue;
    if (!chainTypes.includes(b.typeId)) continue;
    const key = 'boundary:' + b.id;
    const type = data.boundaryTypes.find(t => t.id === b.typeId);
    out.push(annotateClaim({
      kind: 'boundary',
      id: b.id,
      name: b.name || '',
      typeId: b.typeId,
      typeName: type?.name || '',
      currentMember:    ownMembers.has(key),
      claimedElsewhere: claimed.has(key),
    }));
  }

  return out;
}

// Wedge `newParentBoundary` between an existing claimer and member.
// Mutates data.boundaries: removes (kind:memberId) from claimer.members,
// adds newParentBoundary to claimer.members if not already present.
// Caller is responsible for adding (kind:memberId) to newParentBoundary.members.
function promoteMember(kind, memberId, newParentBoundary) {
  const claimer = findClaimingBoundary(kind, memberId, newParentBoundary.id);
  if (!claimer) return false;
  if (!canTypeContain(claimer.typeId, newParentBoundary.typeId)) return false;
  claimer.members = (claimer.members || []).filter(m => !(m.kind === kind && m.id === memberId));
  const newParentKey = 'boundary:' + newParentBoundary.id;
  const alreadyContains = (claimer.members || []).some(m => m.kind === 'boundary' && m.id === newParentBoundary.id);
  if (!alreadyContains) {
    claimer.members.push({ kind: 'boundary', id: newParentBoundary.id });
  }
  return true;
}

// ============================================================
// BOUNDARY HELPERS
// ============================================================

function getBoundaryTypeName(typeId) {
  return data.boundaryTypes.find(t => t.id === typeId)?.name || '';
}

function getBoundaryMemberCount(boundary) {
  return (boundary.members || []).length;
}

// Resolve a member spec into the underlying plot or boundary record.
function resolveMember(m) {
  if (m.kind === 'plot') return data.plots.find(p => p.id === m.id) || null;
  if (m.kind === 'boundary') return data.boundaries.find(b => b.id === m.id) || null;
  return null;
}

// Recursively flatten a boundary down to the set of plot ids it covers
// (transitively through sub-boundaries). Used for area aggregation
// without needing geometry; Brick 6b will compute the real dissolved
// geometry via Turf.
function flattenBoundaryToPlotIds(boundary, seen) {
  seen = seen || new Set();
  if (seen.has(boundary.id)) return [];
  seen.add(boundary.id);
  const out = [];
  for (const m of (boundary.members || [])) {
    if (m.kind === 'plot') out.push(m.id);
    else if (m.kind === 'boundary') {
      const sub = data.boundaries.find(b => b.id === m.id);
      if (sub) out.push(...flattenBoundaryToPlotIds(sub, seen));
    }
  }
  return out;
}

function boundaryArea(boundary) {
  // Sum of all transitively-contained plot areas. Brick 6b may swap
  // this for a Turf-dissolved area once geometry rendering lands.
  const plotIds = new Set(flattenBoundaryToPlotIds(boundary));
  let total = 0;
  for (const id of plotIds) {
    const p = data.plots.find(pp => pp.id === id);
    if (p) total += plotArea(p);
  }
  return total;
}

// ============================================================
// BOUNDARY GEOMETRY (Brick 6b)
// ============================================================
// Boundaries carry no geometry of their own — their shape is the dissolved
// union of all transitively-contained plot polygons. We fold turf.union
// over the plot Features and convert the resulting GeoJSON Polygon /
// MultiPolygon into Leaflet [lat,lon][][] form for rendering.
//
// Cached per boundary id. Mutation sites must call invalidateBoundaryGeometry()
// (no arg = clear all). The cache is correct because boundaries can only
// influence each other through membership chains; on any plot/boundary
// change we just nuke the whole cache.

let _boundaryGeomCache = new Map();

function invalidateBoundaryGeometry(boundaryId) {
  if (boundaryId) _boundaryGeomCache.delete(boundaryId);
  else _boundaryGeomCache.clear();
}

function resolveBoundaryGeometry(boundary) {
  if (!boundary) return null;
  const cached = _boundaryGeomCache.get(boundary.id);
  if (cached !== undefined) return cached;

  const plotIds = new Set(flattenBoundaryToPlotIds(boundary));
  const features = [];
  for (const pid of plotIds) {
    const p = data.plots.find(pp => pp.id === pid);
    if (!p) continue;
    const f = plotToGeoJSONFeature(p);
    if (f) features.push(f);
  }
  if (features.length === 0) {
    _boundaryGeomCache.set(boundary.id, null);
    return null;
  }

  let merged = features[0];
  for (let i = 1; i < features.length; i++) {
    try {
      const next = turf.union(merged, features[i]);
      if (next) merged = next;
    } catch (_) { /* skip degenerate union */ }
  }

  const polygons = _boundaryGeoJSONToLeafletPolygons(merged);
  const result = { polygons, feature: merged };
  _boundaryGeomCache.set(boundary.id, result);
  return result;
}

function _boundaryGeoJSONToLeafletPolygons(feature) {
  // Returns [[outerRing, hole1, ...], [outerRing2, ...], ...] with rings as [[lat,lon], ...]
  const geom = feature?.geometry || feature;
  if (!geom) return [];
  const toRing = ring => ring.map(([lon, lat]) => [lat, lon]);
  if (geom.type === 'Polygon') {
    return [geom.coordinates.map(toRing)];
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.map(rings => rings.map(toRing));
  }
  if (geom.type === 'GeometryCollection') {
    return (geom.geometries || []).flatMap(g => _boundaryGeoJSONToLeafletPolygons({ geometry: g }));
  }
  return [];
}
