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
relation(area.searchArea)${importFilter};
(._;>;);
out body;`;
}

function buildByIdQuery(relationId) {
  return `[out:json][timeout:60];
relation(${Number(relationId)});
(._;>;);
out body;`;
}

function buildCustomQuery(text) {
  // Trust the user's query but ensure JSON output. If they already have a
  // settings block (e.g. [bbox:...];), merge [out:json] into it rather
  // than prepending a second block — Overpass only allows one.
  text = text.trim();
  if (!text) return text;

  // If [out:json] appears anywhere — even after a leading comment block —
  // trust the user's query verbatim. Otherwise we'd prepend a second
  // settings block and Overpass would 400.
  if (/\[out:json\b/.test(text)) return text;

  const leading = text.match(/^((?:\[[^\]]+\]\s*)+);/);
  if (leading) {
    let settings = leading[1].trim();
    const rest = text.slice(leading[0].length);
    if (/\[out:[^\]]+\]/.test(settings)) {
      // User specified an output format — force json so our parser works.
      settings = settings.replace(/\[out:[^\]]+\]/, '[out:json]');
    } else {
      settings = `[out:json]${settings}`;
    }
    return `${settings};\n${rest.replace(/^\s+/, '')}`;
  }

  return `[out:json][timeout:60];\n${text}`;
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

  if (resp.status === 429) {
    // Rate-limited. Probe /api/status so we can tell the user how long
    // to wait, instead of dumping the rate-limit HTML body into a toast.
    let retryAfter = null;
    try {
      const status = await getOverpassStatus();
      retryAfter = status.nextSlotInSeconds;
    } catch (_) { /* status probe failed — leave retryAfter null */ }
    const e = new Error(retryAfter != null
      ? `rate-limited (next slot in ~${retryAfter}s)`
      : 'rate-limited');
    e.is429 = true;
    e.retryAfter = retryAfter;
    throw e;
  }

  if (!resp.ok) {
    // For non-429 errors keep a small (and stripped) preview of the body
    // so we don't paste rate-limit HTML into a toast.
    const raw = await resp.text().catch(() => '');
    const body = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    throw new Error(`HTTP ${resp.status}${body ? ': ' + body.slice(0, 160) : ''}`);
  }

  return resp.json();
}

async function getOverpassStatus() {
  const url = OGF_OVERPASS_URL.replace(/\/interpreter$/, '/status');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`status HTTP ${resp.status}`);
  const text = await resp.text();
  // The text body lists "Slot available after: <timestamp>, in <N> seconds."
  // when slots are exhausted. Lowest N wins.
  const matches = [...text.matchAll(/in\s+(\d+)\s+seconds?\b/g)];
  const nexts = matches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n));
  return {
    raw: text,
    nextSlotInSeconds: nexts.length > 0 ? Math.min(...nexts) : null,
  };
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

  // Synthetic id allocator for nodes that arrive without explicit ids
  // (the `out geom;` case — overpass-turbo's wizard uses this). Synthetic
  // ids sit far below the local-id zone (data.osm._nextLocalId starts at
  // 0 and decrements by 1) so they can't collide with split-midpoint or
  // hand-drawn objects in later bricks.
  const SYNTH_BASE = -1000000000;
  let _synth = 0;
  const synthId = () => SYNTH_BASE + (--_synth);

  for (const el of (json && json.elements) || []) {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    } else if (el.type === 'way') {
      const refs = (el.nodes || []).slice();
      ways[el.id] = { nodes: refs };
      // `out geom` on a way includes inline lat/lon parallel to .nodes.
      // Populate the nodes pool from it when no separate node element
      // arrived for that id.
      if (Array.isArray(el.geometry) && el.geometry.length === refs.length) {
        for (let i = 0; i < refs.length; i++) {
          const nid = refs[i];
          const g = el.geometry[i];
          if (g && nodes[nid] === undefined) {
            nodes[nid] = { lat: g.lat, lon: g.lon };
          }
        }
      }
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
      let w = ways[m.ref];
      // `out geom` on a relation embeds way geometry inline on the
      // member without emitting a separate way element. Synthesise a
      // way (and its nodes) so the rest of the pipeline behaves
      // uniformly. We allocate synthetic ids in a deep negative range
      // so they don't conflict with OGF ids or with locally-allocated
      // ids in later bricks.
      if (!w && Array.isArray(m.geometry) && m.geometry.length > 0) {
        const nodeIds = [];
        for (const g of m.geometry) {
          if (!g) continue;
          const nid = synthId();
          nodes[nid] = { lat: g.lat, lon: g.lon };
          nodeIds.push(nid);
        }
        ways[m.ref] = { nodes: nodeIds };
        w = ways[m.ref];
      }
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
