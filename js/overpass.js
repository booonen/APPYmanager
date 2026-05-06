// ============================================================
// OVERPASS — Query builders, fetcher, response parser
// ============================================================
// Three import modes share a single fetch + parse pipeline:
//   Search: two-step area + to-import filter, AND'd key-value rows.
//   By ID:  paste a relation ID directly.
//   Custom: power-user override; we send the query verbatim.
// All modes ultimately produce an Overpass JSON response, which is
// parsed into import candidates (one per relation) plus the underlying
// node/way pool. The pool is committed into data.osm only on Import,
// after the overlap test partitions accept vs. reject.

function buildSearchQuery(areaTags, importTags) {
  const areaFilter = areaTags.map(([k, v]) => tagFilter(k, v)).join('');
  const importFilter = importTags.map(([k, v]) => tagFilter(k, v)).join('');
  return `[out:json][timeout:60];
area${areaFilter}->.searchArea;
(
  relation(area.searchArea)${importFilter};
);
out body;
>;
out skel qt;`;
}

function buildByIdQuery(relationId) {
  return `[out:json][timeout:60];
relation(${Number(relationId)});
out body;
>;
out skel qt;`;
}

function buildCustomQuery(text) {
  // Trust the user's query, but ensure JSON output so our parser works.
  return /\[out:json\]/.test(text) ? text : `[out:json][timeout:60];\n${text}`;
}

function tagFilter(key, value) {
  // Overpass tag filter — quote both sides; escape backslashes and quotes.
  const escapeQuotes = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `["${escapeQuotes(key)}"="${escapeQuotes(value)}"]`;
}

// ============================================================
// FETCH
// ============================================================

async function overpassFetch(query) {
  const resp = await fetch(OGF_OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}${body ? ': ' + body.slice(0, 200) : ''}`);
  }
  return resp.json();
}

// ============================================================
// PARSE
// ============================================================
// Walks Overpass JSON and produces:
//   nodes:      { [id]: { lat, lon } }
//   ways:       { [id]: { nodes: [id, ...] } }
//   candidates: [{ ogfRelationId, name, outers, inners, geometry, tags }]
// where each candidate is a relation that successfully assembles into
// closed outer (and optionally inner) rings. Relations whose member
// ways don't chain cleanly are skipped — caller surfaces the count.

function parseImport(json) {
  const nodes = {};
  const ways = {};
  const relations = [];

  for (const el of (json && json.elements) || []) {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    } else if (el.type === 'way') {
      ways[el.id] = { nodes: (el.nodes || []).slice() };
    } else if (el.type === 'relation') {
      relations.push(el);
    }
  }

  const candidates = [];
  let skipped = 0;
  for (const rel of relations) {
    const outerWays = [];
    const innerWays = [];
    for (const m of (rel.members || [])) {
      if (m.type !== 'way') continue;
      const w = ways[m.ref];
      if (!w) continue;
      const bucket = (m.role === 'inner') ? innerWays : outerWays;
      bucket.push({ id: m.ref, nodes: w.nodes });
    }
    if (outerWays.length === 0) { skipped++; continue; }

    const outers = groupWaysIntoRings(outerWays);
    const inners = innerWays.length > 0 ? groupWaysIntoRings(innerWays) : [];
    if (!outers || !inners) { skipped++; continue; }

    const candidate = {
      ogfRelationId: rel.id,
      name: (rel.tags && rel.tags.name) || '',
      tags: rel.tags || {},
      outers,
      inners,
    };
    candidate.geometry = resolvePlotGeometry(candidate, nodes, ways);
    candidates.push(candidate);
  }

  return { nodes, ways, candidates, skipped };
}
