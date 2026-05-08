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
}

function findPropertySchema(id) {
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
function getNumericPropertyOptions(excludeId) {
  return (data.propertySchemas || []).filter(p =>
    p.kind === 'numeric' && p.id !== excludeId
  );
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
