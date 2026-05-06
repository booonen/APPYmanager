// ============================================================
// OSM — Local mini-OSM data store
// ============================================================
// Stores nodes and ways imported from OGF (and locally created in later
// bricks) so plots can reference shared geometry without coordinate
// duplication. APPY owns this data: loading a save must work offline,
// and OGF is a sync target, not a source of truth.
//
// data.osm = {
//   nodes:        { [id]: { lat, lon } },
//   ways:         { [id]: { nodes: [nodeId, ...] } },
//   _nextLocalId: <decrementing negative integer>
// }
//
// ID convention (JOSM-style):
//   positive int  = OGF-known id (adopted as our local id on import,
//                   automatically deduping shared borders across imports)
//   negative int  = local-only object (split midpoints, subdivision-
//                   created ways, hand-drawn anything later); a single
//                   counter spans both nodes and ways since OSM's id
//                   namespace is per-type anyway

function osmAddNode(id, lat, lon) {
  data.osm.nodes[id] = data.osm.nodes[id] || { lat, lon };
}

function osmAddWay(id, nodeIds) {
  data.osm.ways[id] = data.osm.ways[id] || { nodes: nodeIds.slice() };
}

function nextLocalOsmId() {
  data.osm._nextLocalId = (data.osm._nextLocalId || 0) - 1;
  return data.osm._nextLocalId;
}

// ============================================================
// RING ASSEMBLY
// ============================================================
// A "ring" is an ordered list of way IDs whose endpoints chain together
// to form a closed loop. Relations carry these as outer/inner members
// in any order; groupWaysIntoRings sorts them into traversal order.
//
// assembleRing then walks an ordered ring, picking each way's direction
// based on which endpoint matches the previous way's tail, and emits
// Leaflet-friendly [lat, lon] coords.

function groupWaysIntoRings(ways) {
  // Input: [{ id, nodes: [nodeId, ...] }, ...] in any order.
  // Output: [[wayId, ...], ...] where each inner list is an ordered ring.
  // Returns null if any way can't be chained into a closed ring.
  const rings = [];
  const remaining = ways.slice();

  while (remaining.length > 0) {
    const first = remaining.shift();
    const ring = [first.id];
    const ringStart = first.nodes[0];
    let ringEnd = first.nodes[first.nodes.length - 1];

    // Self-closed way: complete ring on its own.
    if (ringStart === ringEnd) {
      rings.push(ring);
      continue;
    }

    while (ringEnd !== ringStart) {
      const idx = remaining.findIndex(w =>
        w.nodes[0] === ringEnd || w.nodes[w.nodes.length - 1] === ringEnd
      );
      if (idx < 0) return null; // unclosed
      const next = remaining.splice(idx, 1)[0];
      ring.push(next.id);
      ringEnd = (next.nodes[0] === ringEnd)
        ? next.nodes[next.nodes.length - 1]
        : next.nodes[0];
    }
    rings.push(ring);
  }
  return rings;
}

function assembleRing(wayIds, nodeStore, wayStore) {
  // Walks an ordered ring of way IDs and returns [[lat, lon], ...].
  // nodeStore / wayStore default to data.osm but can be supplied (used
  // by the import preview to assemble shapes before they're committed).
  const nodes = nodeStore || data.osm.nodes;
  const ways = wayStore || data.osm.ways;

  if (!wayIds || wayIds.length === 0) return [];

  // Single self-closed way: take its node sequence directly.
  if (wayIds.length === 1) {
    const w = ways[wayIds[0]];
    if (!w) return [];
    return w.nodes
      .map(nid => nodes[nid])
      .filter(n => n)
      .map(n => [n.lat, n.lon]);
  }

  // Multi-way ring: figure out the first way's direction by looking at
  // which endpoint connects to the second way.
  const first = ways[wayIds[0]];
  const second = ways[wayIds[1]];
  if (!first || !second) return [];

  const firstStart = first.nodes[0];
  const firstEnd = first.nodes[first.nodes.length - 1];
  const secondStart = second.nodes[0];
  const secondEnd = second.nodes[second.nodes.length - 1];

  let firstSeq;
  let tail;
  if (firstEnd === secondStart || firstEnd === secondEnd) {
    firstSeq = first.nodes;
    tail = firstEnd;
  } else if (firstStart === secondStart || firstStart === secondEnd) {
    firstSeq = first.nodes.slice().reverse();
    tail = firstStart;
  } else {
    return []; // disconnected
  }

  const coords = [];
  for (const nid of firstSeq) {
    const n = nodes[nid];
    if (n) coords.push([n.lat, n.lon]);
  }

  for (let i = 1; i < wayIds.length; i++) {
    const w = ways[wayIds[i]];
    if (!w) return [];
    const wStart = w.nodes[0];
    const wEnd = w.nodes[w.nodes.length - 1];

    let seq;
    if (wStart === tail) {
      seq = w.nodes.slice(1); // skip the duplicated junction node
      tail = wEnd;
    } else if (wEnd === tail) {
      seq = w.nodes.slice(0, -1).reverse();
      tail = wStart;
    } else {
      return []; // disconnected
    }
    for (const nid of seq) {
      const n = nodes[nid];
      if (n) coords.push([n.lat, n.lon]);
    }
  }

  return coords;
}
