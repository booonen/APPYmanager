// ============================================================
// typeahead.js — search-as-you-type dropdown component
// ============================================================
//
// Modeled on BRIXYmanager's `nodePicker*` pattern but adapted for
// FREE-TEXT inputs: the user can either pick from the dropdown OR type
// a value that isn't in the suggestions list. (BRIXY's picker is a
// single-select picker; ours is more of an autocompleter with native
// look and arrow-key navigation.)
//
// Render structure:
//
//   <div class="typeahead" data-options-fn="…" data-commit-fn="…">
//     <input class="ta-input" …>
//     <div class="ta-dropdown"></div>
//   </div>
//
// Wiring is via inline event handlers (matches surrounding APPY code
// style). Each handler looks up the wrapper and dispatches.
//
//   typeaheadHTML(opts)           → returns the HTML string above
//   onTypeaheadFocus(input)       → opens dropdown, filters
//   onTypeaheadInput(input)       → re-filters as user types
//   onTypeaheadKeydown(ev, input) → ↑/↓ navigate, Enter commits,
//                                   Esc dismisses
//   onTypeaheadBlur(input)        → commits + closes (after a small
//                                   delay so dropdown clicks fire)
//   onTypeaheadItemMouseDown(ev,  → handles dropdown clicks; uses
//     item)                         mousedown so it beats blur
//
// Per-input runtime state (highlighted index) is stored on the
// wrapper element via `_taState`.

function typeaheadHTML(opts) {
  // opts: {
  //   id          — unique id for the wrapper (used for unique ids inside)
  //   value       — initial input value
  //   placeholder — input placeholder
  //   optionsFnName — name of a global fn that returns string[] of
  //                   suggestions; called as window[name](input)
  //   commitFnName  — name of a global fn called on commit (blur/Enter);
  //                   called as window[name](input)
  //   dataAttrs   — object of additional data-* attrs for the input,
  //                 e.g. { 'schema-id': 'foo', 'kind': 'categorical' }
  // }
  const dataStr = Object.entries(opts.dataAttrs || {})
    .map(([k, v]) => `data-${esc(k)}="${esc(v)}"`).join(' ');
  return `<div class="typeahead" id="${esc(opts.id)}"
    data-options-fn="${esc(opts.optionsFnName || '')}"
    data-commit-fn="${esc(opts.commitFnName || '')}">
    <input type="text" class="ta-input" ${dataStr}
      value="${esc(opts.value || '')}"
      placeholder="${esc(opts.placeholder || '')}"
      autocomplete="off"
      oninput="onTypeaheadInput(this)"
      onkeydown="onTypeaheadKeydown(event,this)"
      onfocus="onTypeaheadFocus(this)"
      onblur="onTypeaheadBlur(this)">
    <div class="ta-dropdown"></div>
  </div>`;
}

function _taWrapper(input) {
  return input.closest('.typeahead');
}

function _taFilter(input) {
  const wrap = _taWrapper(input);
  if (!wrap) return;
  const dd = wrap.querySelector('.ta-dropdown');
  if (!dd) return;
  const optsFn = window[wrap.getAttribute('data-options-fn')];
  const all = (typeof optsFn === 'function') ? (optsFn(input) || []) : [];
  const q = (input.value || '').trim().toLowerCase();
  const filtered = q
    ? all.filter(s => String(s).toLowerCase().includes(q))
    : all.slice();
  if (filtered.length === 0) {
    dd.innerHTML = `<div class="ta-empty">${t('typeahead.no_match')}</div>`;
  } else {
    dd.innerHTML = filtered.map(s =>
      `<div class="ta-item" data-value="${esc(s)}"
        onmousedown="onTypeaheadItemMouseDown(event,this)">${esc(s)}</div>`
    ).join('');
  }
  wrap._taHighlighted = -1;
}

function _taOpen(input) {
  const wrap = _taWrapper(input);
  if (!wrap) return;
  wrap.querySelector('.ta-dropdown')?.classList.add('open');
  _taFilter(input);
}

function _taClose(input) {
  const wrap = _taWrapper(input);
  if (!wrap) return;
  wrap.querySelector('.ta-dropdown')?.classList.remove('open');
  wrap._taHighlighted = -1;
}

function _taCommit(input) {
  const wrap = _taWrapper(input);
  if (!wrap) return;
  const commitFn = window[wrap.getAttribute('data-commit-fn')];
  if (typeof commitFn === 'function') commitFn(input);
}

function onTypeaheadFocus(input)  { _taOpen(input); }
function onTypeaheadInput(input)  { _taOpen(input); }

function onTypeaheadKeydown(ev, input) {
  const wrap = _taWrapper(input);
  if (!wrap) return;
  const dd = wrap.querySelector('.ta-dropdown');
  const items = dd?.querySelectorAll('.ta-item') || [];
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    wrap._taHighlighted = Math.min((wrap._taHighlighted ?? -1) + 1, items.length - 1);
    _taPaintHighlight(items, wrap._taHighlighted);
  } else if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    wrap._taHighlighted = Math.max((wrap._taHighlighted ?? -1) - 1, 0);
    _taPaintHighlight(items, wrap._taHighlighted);
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    // If a dropdown item is highlighted, pick it. Otherwise, accept
    // the typed value as-is (free-text mode). Either way close + commit.
    const idx = wrap._taHighlighted ?? -1;
    if (idx >= 0 && items[idx]) {
      input.value = items[idx].getAttribute('data-value');
    }
    _taClose(input);
    _taCommit(input);
  } else if (ev.key === 'Escape') {
    _taClose(input);
  }
}

function _taPaintHighlight(items, idx) {
  items.forEach((it, i) => it.classList.toggle('highlighted', i === idx));
  if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
}

function onTypeaheadItemMouseDown(ev, item) {
  // mousedown (not click!) — fires BEFORE the input's blur, so the
  // dropdown is still open when we read the item's value.
  ev.preventDefault();
  const wrap = item.closest('.typeahead');
  if (!wrap) return;
  const input = wrap.querySelector('.ta-input');
  if (!input) return;
  input.value = item.getAttribute('data-value');
  _taClose(input);
  _taCommit(input);
}

function onTypeaheadBlur(input) {
  // Defer the close so a click on a dropdown item registers first.
  setTimeout(() => _taClose(input), 120);
  _taCommit(input);
}
