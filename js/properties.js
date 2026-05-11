// ============================================================
// PROPERTIES — Property schema data layer (Brick 8)
// ============================================================
// A propertySchema declares one piece of demographic / categorical data
// that can be attached to plots and boundaries. This brick only handles
// the schema (kind, aggregation rule, references between properties).
// Plot-level value entry arrives in Brick 9; boundary aggregation in
// Brick 10.
//
// propertySchema = {
//   id,                       // local uid
//   name,                     // 'Population', 'Predominant language'
//   unit,                     // free-form display unit ('people', '%', 'km²'); optional
//   kind,                     // 'numeric' | 'categorical' | 'percentage'
//   notes,                    // free-form
//
//   // numeric only:
//   aggregation,              // 'sum' | 'weighted_average'
//   weightPropertyId,         // → another propertySchema id; required when aggregation='weighted_average'
//
//   // categorical only:
//   rollupDistribution,       // bool; opt-in. false = no boundary roll-up.
//
//   // percentage only:
//   denominatorPropertyId,    // → another propertySchema id; required.
// }

const PROPERTY_KINDS = ['numeric', 'categorical', 'percentage'];
const NUMERIC_AGGREGATIONS = ['sum', 'weighted_average'];

// ============================================================
// VIRTUAL PROPERTIES (Brick 9 polish, v0.4.1)
// ============================================================
// Some numeric "properties" don't live in `data.propertySchemas` —
// they're computed from geometry. We expose them as virtual schemas
// so percentage properties can use them as denominators (e.g.
// "% Urbanised" = % of Plot area).
//
// AREA_VIRTUAL_ID — the entity's computed area in m². Resolves via
// `plotArea` for plots; on boundaries (Brick 10) via `boundaryArea`.
// The id keeps its `__plot_area__` underscore form so older saves don't
// break when re-loaded, but the user-facing name is just "Area" — every
// entity (plot or boundary) has one, no need to disambiguate.

const AREA_VIRTUAL_ID = '__plot_area__';

function _virtualAreaSchema() {
  return {
    id:          AREA_VIRTUAL_ID,
    name:        'Area',
    unit:        'm²',
    kind:        'numeric',
    aggregation: 'sum',
    notes:       '',
    autoRound:   true,
    __virtual:   true,
  };
}

function isVirtualPropertyId(id) { return id === AREA_VIRTUAL_ID; }

// `autoRound` is declared per-numeric-schema. For a percentage, its raw
// side is in its denominator's units — so we walk the denom chain until
// we hit a numeric, and use that numeric's flag. Returns false if the
// chain is broken (no denom, deleted denom, etc.) or the terminal is
// not numeric.
function _effectiveAutoRound(schema) {
  if (!schema) return false;
  if (schema.kind === 'numeric') return !!schema.autoRound;
  if (schema.kind === 'percentage') {
    const seen = new Set();
    let cur = schema;
    while (cur && cur.kind === 'percentage') {
      if (seen.has(cur.id)) return false;
      seen.add(cur.id);
      cur = findPropertySchema(cur.denominatorPropertyId);
    }
    return !!(cur && cur.kind === 'numeric' && cur.autoRound);
  }
  return false;
}

function _maybeRound(value, schema) {
  if (value == null || !Number.isFinite(value)) return value;
  return _effectiveAutoRound(schema) ? Math.round(value) : value;
}

function createPropertySchema({ name, unit, kind, notes,
                                aggregation, weightPropertyId,
                                rollupDistribution,
                                denominatorPropertyId,
                                autoRound,
                                rootLevelId }) {
  const schema = {
    id:                    uid(),
    name:                  name || '',
    unit:                  unit || '',
    kind:                  kind || 'numeric',
    notes:                 notes || '',
    aggregation:           kind === 'numeric' ? (aggregation || 'sum') : null,
    weightPropertyId:      kind === 'numeric' && aggregation === 'weighted_average'
                             ? (weightPropertyId || null)
                             : null,
    rollupDistribution:    kind === 'categorical' ? !!rollupDistribution : false,
    denominatorPropertyId: kind === 'percentage' ? (denominatorPropertyId || null) : null,
    autoRound:             kind === 'numeric' ? !!autoRound : false,
    // The boundary level where this property is normally recorded. The
    // property rolls up to larger levels and is hidden on smaller /
    // unrelated ones. 'plot' is the implicit-lowest level used as the
    // default. Brick 10a.
    rootLevelId:           rootLevelId || 'plot',
  };
  data.propertySchemas = data.propertySchemas || [];
  data.propertySchemas.push(schema);
  return schema;
}

function deletePropertySchema(id) {
  if (!data.propertySchemas) return;
  data.propertySchemas = data.propertySchemas.filter(p => p.id !== id);
  // Cascade: drop any stored value for this schema across plots AND
  // boundaries (Brick 10b) so we don't leave orphan entries hanging
  // around.
  for (const plot of (data.plots || [])) {
    if (plot.propertyValues && plot.propertyValues[id] !== undefined) {
      delete plot.propertyValues[id];
    }
  }
  for (const b of (data.boundaries || [])) {
    if (b.propertyValues && b.propertyValues[id] !== undefined) {
      delete b.propertyValues[id];
    }
  }
}

function findPropertySchema(id) {
  if (id === AREA_VIRTUAL_ID) return _virtualAreaSchema();
  return (data.propertySchemas || []).find(p => p.id === id) || null;
}

// Bootstrap: seed two demonstrative properties on first visit so the
// editor isn't empty. Users add the rest. Re-running is a no-op once
// any schemas exist (matches bootstrapBoundaryTypes' contract).
function bootstrapPropertySchemas() {
  data.propertySchemas = data.propertySchemas || [];
  if (data.propertySchemas.length > 0) return;
  const pop = createPropertySchema({
    name: 'Population',
    unit: 'people',
    kind: 'numeric',
    aggregation: 'sum',
    autoRound: true,
    rootLevelId: 'plot',
  });
  createPropertySchema({
    name: 'Predominant language',
    unit: '',
    kind: 'categorical',
    rollupDistribution: false,
    rootLevelId: 'plot',
  });
  // Reference pop so future weighted-avg seeds can link without re-querying.
  void pop;
  save();
}

// ============================================================
// VALIDATION
// ============================================================
// Rules enforced at save-time of the add/edit modal:
//   - name required, unique (case-insensitive)
//   - kind ∈ PROPERTY_KINDS
//   - numeric+weighted_average: weightPropertyId references an existing
//     numeric schema (the weight has to itself be a number)
//   - percentage: denominatorPropertyId references an existing numeric
//     schema (the denominator has to be a number)
//   - no self-reference for weight/denominator
//   - no cycles across the combined weight/denominator dependency graph

function _refPropertyId(schema) {
  // Returns the id this schema points at (weight or denominator), or null.
  if (schema.kind === 'numeric' && schema.aggregation === 'weighted_average') {
    return schema.weightPropertyId || null;
  }
  if (schema.kind === 'percentage') {
    return schema.denominatorPropertyId || null;
  }
  return null;
}

// True if assigning ref `proposedRefId` to `editId` (or to a not-yet-saved
// new schema when editId=null) would create a cycle through existing
// weight/denominator references.
function _hasPropertyRefCycle(editId, proposedRefId) {
  if (!proposedRefId) return false;
  if (editId && proposedRefId === editId) return true;
  let cur = proposedRefId;
  const seen = new Set();
  while (cur) {
    if (editId && cur === editId) return true;
    if (seen.has(cur)) break;
    seen.add(cur);
    const next = findPropertySchema(cur);
    if (!next) break;
    cur = _refPropertyId(next);
  }
  return false;
}

// Check whether `schema` is referenced by any other schema as weight or
// denominator. Returns the list of dependents (possibly empty).
function findPropertyDependents(id) {
  if (!id) return [];
  return (data.propertySchemas || []).filter(p => {
    if (p.id === id) return false;
    return _refPropertyId(p) === id;
  });
}

// Weight references (weighted-average numerics) only accept true numerics
// — weighting by a percentage is conceptually strange. The virtual
// "Plot area" is included at the head of the list so users can pick
// "weighted by plot area" without having to declare an Area schema.
function getNumericPropertyOptions(excludeId) {
  const userOpts = (data.propertySchemas || []).filter(p =>
    p.kind === 'numeric' && p.id !== excludeId
  );
  return [_virtualAreaSchema(), ...userOpts];
}

// Denominator references (percentage schemas) accept numerics *and*
// percentages. A percentage resolves to its raw computed value, so
// chains like "Population → % Urban → % Spanish-in-urban" work
// bottom-up via `resolveNumericValueForPlot` recursion. Cycle detection
// already walks `_refPropertyId` arbitrarily deep, so chained
// percentages can't form a loop.
function getDenominatorPropertyOptions(excludeId) {
  const userOpts = (data.propertySchemas || []).filter(p =>
    (p.kind === 'numeric' || p.kind === 'percentage') && p.id !== excludeId
  );
  return [_virtualAreaSchema(), ...userOpts];
}

// ============================================================
// PROPERTY VALUES ON PLOTS (Brick 9)
// ============================================================
// A plot stores raw user-entered values keyed by schema id:
//
//   plot.propertyValues = { [schemaId]: <value> }
//
// Value shape depends on the schema's kind:
//   - numeric:     bare number, e.g. 12345
//   - categorical: bare string, e.g. "English"
//   - percentage:  { mode: 'raw' | 'percent', value: number }
//                  mode records which side the user typed; the other
//                  side is derived live from the denominator value.
//                  When the denominator changes, the SOURCE value
//                  is preserved and the DERIVED side updates.
//
// Absence of a key = no value set.  Empty input deletes the key
// (don't bloat saves with empty strings).

function getPlotPropertyValue(plot, schemaId) {
  if (!plot || !plot.propertyValues) return undefined;
  return plot.propertyValues[schemaId];
}

function setPlotPropertyValue(plot, schemaId, value) {
  if (!plot) return;
  plot.propertyValues = plot.propertyValues || {};
  plot.propertyValues[schemaId] = value;
}

function clearPlotPropertyValue(plot, schemaId) {
  if (!plot?.propertyValues) return;
  delete plot.propertyValues[schemaId];
}

// ============================================================
// BOUNDARY VALUES (Brick 10b)
// ============================================================
// Boundaries carry property values in the same shape as plots:
// `boundary.propertyValues` keyed by schema id, values are bare numbers
// (numeric), bare strings (categorical), or `{ mode, value }` objects
// (percentage). Helpers mirror the plot ones one-for-one.
//
// The aggregation engine — rolling up plot/sub-boundary values onto
// parent boundaries with override detection — is Brick 10c. 10b is
// purely user-set storage on boundaries.

function getBoundaryPropertyValue(boundary, schemaId) {
  if (!boundary || !boundary.propertyValues) return undefined;
  return boundary.propertyValues[schemaId];
}

function setBoundaryPropertyValue(boundary, schemaId, value) {
  if (!boundary) return;
  boundary.propertyValues = boundary.propertyValues || {};
  boundary.propertyValues[schemaId] = value;
}

function clearBoundaryPropertyValue(boundary, schemaId) {
  if (!boundary?.propertyValues) return;
  delete boundary.propertyValues[schemaId];
}

// Does `schema` apply to entities at `levelId`?  Rule (from Brick 10a):
// applies iff `levelId === schema.rootLevelId` OR `schema.rootLevelId` is
// reachable from `levelId` downward through the primitiveId chain.
//
// `levelId` is `'plot'` for plot entities or a boundary-type id for
// boundary entities. Plot-rooted schemas apply at every boundary level
// (every chain terminates at plot/null), but boundary-rooted schemas
// only apply at their own level and above.
function appliesAtLevel(schema, levelId) {
  if (!schema) return false;
  const root = schema.rootLevelId || 'plot';
  if (root === levelId) return true;
  if (levelId === 'plot') return false; // plot has no levels below it
  let cur = (data.boundaryTypes || []).find(t => t.id === levelId);
  if (!cur) return false;
  const seen = new Set();
  while (cur) {
    if (seen.has(cur.id)) return false; // cycle guard (shouldn't happen)
    seen.add(cur.id);
    const next = cur.primitiveId;
    if (next === null || next === undefined) {
      // Reached the implicit-plot terminal — only plot-rooted schemas qualify.
      return root === 'plot';
    }
    if (next === root) return true;
    cur = (data.boundaryTypes || []).find(t => t.id === next);
  }
  return false;
}

// Numeric resolver: returns a finite number if the plot has a usable
// numeric value for `schema`, otherwise null. Handles legacy bare
// numbers and the percentage value shape (which carries `value` and
// `mode`, but `mode` is irrelevant when we just want the raw number
// — we always return the raw form when mode='raw', and the computed
// raw when mode='percent' and the denominator is resolvable).
//
// Used by the percentage row to read the denominator's current value
// so the linked input can derive in real time.
function resolveNumericValueForPlot(plot, schema) {
  if (!plot || !schema) return null;
  // Virtual schemas come from geometry, not data.propertyValues.
  if (schema.id === AREA_VIRTUAL_ID) {
    const a = (typeof plotArea === 'function') ? plotArea(plot) : 0;
    return Number.isFinite(a) ? _maybeRound(a, schema) : null;
  }
  const raw = getPlotPropertyValue(plot, schema.id);
  if (raw === undefined || raw === null || raw === '') return null;
  if (schema.kind === 'numeric') {
    const n = Number(raw);
    return Number.isFinite(n) ? _maybeRound(n, schema) : null;
  }
  if (schema.kind === 'percentage') {
    // Percent schemas store { mode, value }. Resolve to the raw amount.
    if (typeof raw !== 'object') return null;
    if (raw.mode === 'raw') {
      const n = Number(raw.value);
      return Number.isFinite(n) ? _maybeRound(n, schema) : null;
    }
    // mode = 'percent' — need the denominator to compute raw.
    const denomSchema = findPropertySchema(schema.denominatorPropertyId);
    if (!denomSchema) return null;
    const denomVal = resolveNumericValueForPlot(plot, denomSchema);
    if (denomVal == null) return null;
    const pct = Number(raw.value);
    if (!Number.isFinite(pct)) return null;
    return _maybeRound((pct / 100) * denomVal, schema);
  }
  return null;
}

// Boundary-side parallels of resolveNumericValueForPlot and
// derivePercentageDisplay. Same shape, swap plot helpers for boundary
// helpers and `plotArea` for `boundaryArea`. The two pairs are kept
// separate (rather than DRY'd through a context-passing refactor) so
// the existing plot inspector code keeps its proven hot paths.

function resolveNumericValueForBoundary(boundary, schema) {
  if (!boundary || !schema) return null;
  if (schema.id === AREA_VIRTUAL_ID) {
    const a = (typeof boundaryArea === 'function') ? boundaryArea(boundary) : 0;
    return Number.isFinite(a) ? _maybeRound(a, schema) : null;
  }
  const raw = getBoundaryPropertyValue(boundary, schema.id);
  if (raw === undefined || raw === null || raw === '') return null;
  if (schema.kind === 'numeric') {
    const n = Number(raw);
    return Number.isFinite(n) ? _maybeRound(n, schema) : null;
  }
  if (schema.kind === 'percentage') {
    if (typeof raw !== 'object') return null;
    if (raw.mode === 'raw') {
      const n = Number(raw.value);
      return Number.isFinite(n) ? _maybeRound(n, schema) : null;
    }
    const denomSchema = findPropertySchema(schema.denominatorPropertyId);
    if (!denomSchema) return null;
    const denomVal = resolveNumericValueForBoundary(boundary, denomSchema);
    if (denomVal == null) return null;
    const pct = Number(raw.value);
    if (!Number.isFinite(pct)) return null;
    return _maybeRound((pct / 100) * denomVal, schema);
  }
  return null;
}

function derivePercentageDisplayForBoundary(boundary, schema, storedValue) {
  if (!schema || schema.kind !== 'percentage') return { raw: null, percent: null };
  const denomSchema = findPropertySchema(schema.denominatorPropertyId);
  const denomVal = denomSchema ? resolveNumericValueForBoundary(boundary, denomSchema) : null;
  let raw = null;
  let percent = null;
  if (storedValue && typeof storedValue === 'object') {
    const v = Number(storedValue.value);
    if (Number.isFinite(v)) {
      if (storedValue.mode === 'raw') {
        raw = v;
        if (denomVal != null && denomVal !== 0) percent = (v / denomVal) * 100;
      } else if (storedValue.mode === 'percent') {
        percent = v;
        if (denomVal != null) raw = (v / 100) * denomVal;
      }
    }
  }
  raw = _maybeRound(raw, schema);
  return { raw, percent, denomVal, denomSchema };
}

// Compute the "other side" of a percentage value given the current
// denominator. Returns { raw, percent } with derived members possibly
// null when uncomputable.
function derivePercentageDisplay(plot, schema, storedValue) {
  if (!schema || schema.kind !== 'percentage') return { raw: null, percent: null };
  const denomSchema = findPropertySchema(schema.denominatorPropertyId);
  const denomVal = denomSchema ? resolveNumericValueForPlot(plot, denomSchema) : null;

  let raw = null;
  let percent = null;

  if (storedValue && typeof storedValue === 'object') {
    const v = Number(storedValue.value);
    if (Number.isFinite(v)) {
      if (storedValue.mode === 'raw') {
        raw = v;
        if (denomVal != null && denomVal !== 0) percent = (v / denomVal) * 100;
      } else if (storedValue.mode === 'percent') {
        percent = v;
        if (denomVal != null) raw = (v / 100) * denomVal;
      }
    }
  }
  // Round the raw side if the chain's terminal numeric is auto-rounded.
  // (Percent side is always in %, not auto-rounded by this flag.)
  raw = _maybeRound(raw, schema);

  return { raw, percent, denomVal, denomSchema };
}

// Trim trailing zeros from a numeric display string. 30 → "30",
// 30.5 → "30.5", 30.00 → "30". Returns '' for null / NaN.
function formatPropertyNumber(n) {
  if (n == null || !Number.isFinite(n)) return '';
  // Two decimal cap, then strip trailing zeros & a dangling dot.
  const s = (Math.round(n * 100) / 100).toString();
  return s;
}

// Compact human-readable summary of a schema's behaviour. Used by the
// list view's "Behaviour" column. l10n is intentionally NOT done here;
// returning a small descriptor object lets views.js localise.
function describePropertyBehaviour(schema) {
  if (schema.kind === 'numeric') {
    if (schema.aggregation === 'weighted_average') {
      const ref = findPropertySchema(schema.weightPropertyId);
      return { code: 'weighted_average', refName: ref?.name || '' };
    }
    return { code: 'sum' };
  }
  if (schema.kind === 'categorical') {
    return { code: schema.rollupDistribution ? 'distribution' : 'no_rollup' };
  }
  if (schema.kind === 'percentage') {
    const ref = findPropertySchema(schema.denominatorPropertyId);
    return { code: 'percentage_of', refName: ref?.name || '' };
  }
  return { code: '' };
}
