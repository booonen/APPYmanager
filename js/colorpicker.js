// ============================================================
// COLORPICKER — Custom hex/palette picker (Brick 13 v0.12.2)
// ============================================================
// Replaces `<input type="color">` everywhere with a popover that
// shows a curated 24-swatch palette plus a hex input. Output is
// always a 6-digit hex (`#xxxxxx`), so existing colour fields read
// the same value either way.
//
// API:
//   colorPickerHTML(currentValue, onChange) → string of HTML
//     `onChange(color)` fires when the user picks a swatch or commits
//     the hex input.
//   resetColorPickers() — clears the callback registry. Call it
//     before re-rendering a panel that uses pickers (keeps the map
//     from growing unbounded).
//
// Internals: each generated button carries a `data-cp-id` referencing
// a registered callback. The popover sits as a single body-level div
// (`#color-picker-popover`); opening positions it near the trigger.

const _COLOR_PICKER_PALETTE = [
  '#ffffff', '#c4c8d6', '#8b8fa4', '#5c5f73', '#2a2d3e', '#0f1117',
  '#c1272d', '#e05555', '#d97757', '#ee9d4e', '#e0a855', '#b58300',
  '#55c07a', '#48b287', '#3f7e3f', '#0d8a8a', '#5c8f5c', '#7c8c5b',
  '#3aa2c7', '#6f86d6', '#175c8c', '#5a4ea3', '#9b6dd0', '#7b3a8a',
];

const _colorPickerCallbacks = new Map(); // id → fn(color)
let   _cpNextId = 0;
let   _cpActiveId = null;  // currently open trigger id (if any)

function resetColorPickers() {
  _colorPickerCallbacks.clear();
  closeColorPicker();
}

function colorPickerHTML(currentValue, onChange) {
  const id = 'cp-' + (++_cpNextId);
  _colorPickerCallbacks.set(id, onChange);
  const safe = _cpEsc(currentValue || '#888888');
  return `<button class="color-picker-btn" type="button" data-cp-id="${id}"
    onclick="openColorPicker(event)">
    <span class="color-picker-swatch" style="background:${safe}"></span>
    <span class="color-picker-hex">${safe}</span>
  </button>`;
}

function _cpEsc(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>&"']/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function _ensureColorPickerPopover() {
  let pop = document.getElementById('color-picker-popover');
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'color-picker-popover';
  pop.className = 'color-picker-popover';
  pop.style.display = 'none';
  document.body.appendChild(pop);
  return pop;
}

function openColorPicker(event) {
  event.preventDefault();
  event.stopPropagation();
  const btn = event.currentTarget;
  const id = btn && btn.dataset && btn.dataset.cpId;
  if (!id || !_colorPickerCallbacks.has(id)) return;
  _cpActiveId = id;

  const pop = _ensureColorPickerPopover();
  const current = (btn.querySelector('.color-picker-hex')?.textContent || '#888888').trim();

  const swatches = _COLOR_PICKER_PALETTE.map(c => `
    <button class="color-picker-swatch-btn" type="button"
      title="${_cpEsc(c)}"
      style="background:${_cpEsc(c)}"
      onclick="onColorPickerSwatch('${_cpEsc(c)}')"></button>
  `).join('');
  pop.innerHTML = `
    <div class="color-picker-grid">${swatches}</div>
    <div class="color-picker-hex-row">
      <span class="color-picker-hex-prefix">#</span>
      <input type="text" id="color-picker-hex-input" maxlength="6"
        value="${_cpEsc(current.replace(/^#/, ''))}"
        oninput="onColorPickerHexInput(this.value)"
        onkeydown="if (event.key === 'Enter') closeColorPicker()">
    </div>
  `;

  // Position below the button, clamped to the viewport.
  pop.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  let left = rect.left;
  let top  = rect.bottom + 4;
  if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
  if (top  + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - 4;
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top  = Math.max(8, top)  + 'px';

  // Dismiss on outside click. Defer registration so the current
  // click doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', _cpOnDocClick, { capture: true });
  }, 0);
}

function _cpOnDocClick(e) {
  const pop = document.getElementById('color-picker-popover');
  if (!pop) return;
  if (pop.contains(e.target)) return;
  closeColorPicker();
}

function closeColorPicker() {
  const pop = document.getElementById('color-picker-popover');
  if (pop) pop.style.display = 'none';
  document.removeEventListener('mousedown', _cpOnDocClick, { capture: true });
  _cpActiveId = null;
}

function onColorPickerSwatch(color) {
  _cpCommit(color);
  closeColorPicker();
}

function onColorPickerHexInput(value) {
  // Accept 3- or 6-digit hex (with or without leading #).
  const v = String(value || '').replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v)) return;
  const norm = v.length === 3
    ? '#' + v.split('').map(c => c + c).join('')
    : '#' + v.toLowerCase();
  _cpCommit(norm);
}

// Fires the registered callback and updates the trigger button's
// swatch / hex display to match. Does NOT close the popover (the
// user might want to keep tweaking via hex input).
function _cpCommit(color) {
  if (!_cpActiveId) return;
  const cb = _colorPickerCallbacks.get(_cpActiveId);
  if (typeof cb === 'function') {
    try { cb(color); } catch (_) { /* swallow */ }
  }
  const btn = document.querySelector(`[data-cp-id="${_cpActiveId}"]`);
  if (btn) {
    const sw = btn.querySelector('.color-picker-swatch');
    const hx = btn.querySelector('.color-picker-hex');
    if (sw) sw.style.background = color;
    if (hx) hx.textContent = color;
  }
}
