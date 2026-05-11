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
// AREA_VIRTUAL_ID — the plot's computed area in m². On boundaries
// (Brick 10) it'll resolve via `boundaryArea`.

const AREA_VIRTUAL_ID = '__plot_area__';

function _virtualAreaSchema() {
  return {
    id:          AREA_VIRTUAL_ID,
    name:        'Plot area',
    unit:        'm²',
    kind:        'numeric',
    aggregation: 'sum',
    notes:       '',
    __virtual:   true,
  };
}

function isVirtualPropertyId(id) { return id === AREA_VIRTUAL_ID; }

function createPropertySchema({ name, unit, kind, notes,
                                aggregation, weightPropertyId,
                                rollupDistribution,
                                denominatorPropertyId }) {
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
  };
  data.propertySchemas = data.propertySchemas || [];
  data.propertySchemas.push(schema);
  return schema;
}

function deletePropertySchema(id) {
  if (!data.propertySchemas) return;
  data.propertySchemas = data.propertySchemas.filter(p => p.id !== id);
  // Cascade: drop any plot's stored value for this schema so we don't
  // leave orphan entries hanging around. Boundary values arrive in
  // Brick 10 — extend this loop then.
  for (const plot of (data.plots || [])) {
    if (plot.propertyValues && plot.propertyValues[id] !== undefined) {
      delete plot.propertyValues[id];
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
  });
  createPropertySchema({
    name: 'Predominant language',
    unit: '',
    kind: 'categorical',
    rollupDistribution: false,
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

// Numeric properties are the only valid choice for weights/denominators.
// The virtual "Plot area" is included at the head of the list so users
// can pick "% of plot area" without having to declare an Area schema.
function getNumericPropertyOptions(excludeId) {
  const userOpts = (data.propertySchemas || []).filter(p =>
    p.kind === 'numeric' && p.id !== excludeId
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
    return Number.isFinite(a) ? a : null;
  }
  const raw = getPlotPropertyValue(plot, schema.id);
  if (raw === undefined || raw === null || raw === '') return null;
  if (schema.kind === 'numeric') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (schema.kind === 'percentage') {
    // Percent schemas store { mode, value }. Resolve to the raw amount.
    if (typeof raw !== 'object') return null;
    if (raw.mode === 'raw') {
      const n = Number(raw.value);
      return Number.isFinite(n) ? n : null;
    }
    // mode = 'percent' — need the denominator to compute raw.
    const denomSchema = findPropertySchema(schema.denominatorPropertyId);
    if (!denomSchema) return null;
    const denomVal = resolveNumericValueForPlot(plot, denomSchema);
    if (denomVal == null) return null;
    const pct = Number(raw.value);
    if (!Number.isFinite(pct)) return null;
    return (pct / 100) * denomVal;
  }
  return null;
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
