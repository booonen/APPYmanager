// ============================================================
// VIEWS — Page renderers
// ============================================================
// Each function paints into the corresponding tab panel. Brick-1 versions
// are intentionally minimal; later bricks will replace them.

function renderDashboard() {
  const stats = document.getElementById('dashboard-stats');
  if (stats) {
    stats.innerHTML = `
      <div class="stat-card"><div class="stat-value">${data.plots.length}</div><div class="stat-label">${t('stat.plots')}</div></div>
      <div class="stat-card"><div class="stat-value">${data.boundaries.length}</div><div class="stat-label">${t('stat.boundaries')}</div></div>
      <div class="stat-card"><div class="stat-value">${data.boundaryTypes.length}</div><div class="stat-label">${t('stat.boundary_types')}</div></div>
      <div class="stat-card"><div class="stat-value">${data.propertySchemas.length}</div><div class="stat-label">${t('stat.properties')}</div></div>
    `;
  }
  const content = document.getElementById('dashboard-content');
  if (content) {
    content.innerHTML = `
      <div class="ie-card">
        <h3>${t('dashboard.welcome_title')}</h3>
        <p>${t('dashboard.welcome_body')}</p>
      </div>
    `;
  }
}

function renderSettings() {
  const el = document.getElementById('settings-content');
  if (!el) return;
  const langOpts = _availableLanguages.map(l =>
    `<option value="${l.code}"${l.code === _lang ? ' selected' : ''}>${esc(l.name)}</option>`
  ).join('');
  el.innerHTML = `
    <div class="ie-card">
      <h3>${t('settings.language')}</h3>
      <p>${t('settings.language_desc')}</p>
      <select onchange="setLanguage(this.value)" style="max-width:240px">${langOpts}</select>
    </div>
  `;
}

function renderImportExport() {
  const el = document.getElementById('import-export-content');
  if (!el) return;
  el.innerHTML = `
    <div class="ie-card">
      <h3>${t('ie.json_title')}</h3>
      <p>${t('ie.json_desc')}</p>
      <div class="flex gap-8">
        <button class="btn" onclick="importData()">↑ ${t('btn.import_json')}</button>
        <button class="btn" onclick="exportData()">↓ ${t('btn.export_json')}</button>
      </div>
    </div>
    <div class="ie-card">
      <h3>${t('ie.saves_title')}</h3>
      <p>${t('ie.saves_desc')}</p>
      <button class="btn btn-primary" onclick="openSaveManager()">${t('ie.manage_saves')}</button>
    </div>
  `;
}
