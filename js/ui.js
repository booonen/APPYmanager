// ============================================================
// UI — Modal, toast, in-app confirm/prompt
// ============================================================

function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function openModal(title, bodyHtml, footerHtml) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = footerHtml || '';
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); editingId = null; }

let _modalMouseDownTarget = null;
function closeModalOnOverlay(e) {
  if (e.target === e.currentTarget && _modalMouseDownTarget === e.currentTarget) closeModal();
  _modalMouseDownTarget = null;
}

// ============================================================
// IN-APP CONFIRM / PROMPT — replaces browser confirm() and prompt()
// ============================================================

function appConfirm(message, onYes) {
  const id = 'app-confirm-overlay';
  if (document.getElementById(id)) document.getElementById(id).remove();
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `<div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:24px;max-width:440px;width:90%">
    <div style="font-size:14px;color:var(--text);margin-bottom:20px;line-height:1.6;white-space:pre-line">${esc(message)}</div>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn" id="app-confirm-no">${t('btn.cancel')}</button>
      <button class="btn btn-primary" id="app-confirm-yes">${t('btn.confirm')}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('app-confirm-yes').onclick = () => { overlay.remove(); if (onYes) onYes(); };
  document.getElementById('app-confirm-no').onclick = () => { overlay.remove(); };
  document.getElementById('app-confirm-yes').focus();
}

function appPrompt(message, defaultValue, onSubmit) {
  const id = 'app-confirm-overlay';
  if (document.getElementById(id)) document.getElementById(id).remove();
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `<div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:24px;max-width:440px;width:90%">
    <div style="font-size:14px;color:var(--text);margin-bottom:12px;line-height:1.6">${esc(message)}</div>
    <input type="text" id="app-prompt-input" value="${esc(defaultValue || '')}" style="width:100%;margin-bottom:20px">
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn" id="app-prompt-cancel">${t('btn.cancel')}</button>
      <button class="btn btn-primary" id="app-prompt-ok">${t('btn.confirm')}</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  const input = document.getElementById('app-prompt-input');
  input.focus(); input.select();
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('app-prompt-ok').click();
    if (e.key === 'Escape') document.getElementById('app-prompt-cancel').click();
  });
  document.getElementById('app-prompt-ok').onclick = () => { const val = input.value; overlay.remove(); if (onSubmit && val && val.trim()) onSubmit(val.trim()); };
  document.getElementById('app-prompt-cancel').onclick = () => { overlay.remove(); };
}

// ============================================================
// NAV
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`panel-${tab}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tab}"]`)?.classList.add('active');
  const renders = {
    dashboard: renderDashboard,
    plots: renderPlots,
    'boundary-types': renderBoundaryTypes,
    boundaries: renderBoundaries,
    settlements: renderSettlements,
    properties: renderProperties,
    map: () => {
      if (!_map) { initMap(); return; }
      _map.invalidateSize();
      redrawMap();
    },
    settings: renderSettings,
    'import-export': renderImportExport,
    atlas: () => { if (typeof renderAtlas === 'function') renderAtlas(); },
    'page-builder': () => { if (typeof renderPageBuilder === 'function') renderPageBuilder(); },
  };
  if (renders[tab]) renders[tab]();
}

function refreshAll() {
  // Re-run the active tab's renderer to pick up data changes.
  const a = document.querySelector('.nav-item.active');
  if (a) switchTab(a.dataset.tab);
}
