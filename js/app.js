import store from './store.js';
import * as Home       from './views/home.js';
import * as FlightCrew from './views/flightcrew.js';
import * as PA         from './views/pa.js';
import * as Tools      from './views/tools.js';

const TABS = [
  { id: 'home',       label: 'Home',         icon: '🏠', mod: Home       },
  { id: 'flightcrew', label: 'Flight Crew',  icon: '✈️', mod: FlightCrew },
  { id: 'pa',         label: 'PA',           icon: '🎙', mod: PA         },
  { id: 'tools',      label: 'Tools',        icon: '🔧', mod: Tools      },
];

let activeTabId   = 'home';
let activeView    = null;
let _clockTimer   = null;
const mainEl      = document.getElementById('main');
const topbarEl    = document.getElementById('topbar');
const tabbarEl    = document.getElementById('tabbar');
const sidebarEl   = document.getElementById('sidebar');

// ── Bootstrap ─────────────────────────────────────────────────────

function init() {
  _buildTabBar();
  _buildSidebar();
  _renderTopBar();
  _startClock();
  _switchTab('home');

  store.subscribe(() => {
    _renderTopBar();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ── UTC Clock ─────────────────────────────────────────────────────

function _utcNow() {
  const n = new Date();
  const hh = String(n.getUTCHours()).padStart(2, '0');
  const mm = String(n.getUTCMinutes()).padStart(2, '0');
  const ss = String(n.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function _startClock() {
  if (_clockTimer) clearInterval(_clockTimer);
  _clockTimer = setInterval(() => {
    const el = document.getElementById('topbar-utc-time');
    if (el) el.textContent = _utcNow();
  }, 1000);
}

// ── Top Bar ───────────────────────────────────────────────────────

function _utcBlock() {
  return `<div class="topbar-utc">
    <span class="topbar-utc-label">UTC</span>
    <span id="topbar-utc-time">${_utcNow()}</span>
  </div>`;
}

function _renderTopBar() {
  const f = store.flight;
  if (!f) {
    topbarEl.innerHTML = `
      <div class="topbar-logo">Kneeboard</div>
      <div class="topbar-empty">尚未選擇航班 — 請在主畫面查詢</div>
      ${_utcBlock()}`;
    return;
  }

  const times = [f.std, f.sta].filter(Boolean).join(' → ') || '';
  topbarEl.innerHTML = `
    <div class="topbar-logo">KB</div>
    <div class="topbar-flight">
      <div class="topbar-flt-num">${f.flightNumber || ''}</div>
      <div class="topbar-route">
        <span>${f.dep || ''}</span>
        <span class="topbar-arrow">→</span>
        <span>${f.dest || ''}</span>
      </div>
      <div class="topbar-meta">
        ${f.reg   ? `<span class="topbar-reg">${f.reg}</span>` : ''}
        ${times   ? `<span class="topbar-times">${times}</span>` : ''}
        ${f.ete   ? `<span style="color:var(--text3)">${f.ete}</span>` : ''}
      </div>
    </div>
    ${_utcBlock()}`;
}

// ── Tab Bar ───────────────────────────────────────────────────────

function _buildTabBar() {
  tabbarEl.innerHTML = TABS.map(t => `
    <button class="tab-btn ${t.id === activeTabId ? 'active' : ''}" data-tab="${t.id}">
      <span class="tab-icon">${t.icon}</span>
      <span>${t.label}</span>
    </button>`).join('');

  tabbarEl.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => _switchTab(btn.dataset.tab);
  });
}

function _buildSidebar() {
  if (!sidebarEl) return;
  sidebarEl.innerHTML = TABS.map(t => `
    <button class="sidebar-btn ${t.id === activeTabId ? 'active' : ''}" data-tab="${t.id}">
      <span>${t.icon}</span>
      <span>${t.label}</span>
    </button>`).join('');

  sidebarEl.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.onclick = () => _switchTab(btn.dataset.tab);
  });
}

function _switchTab(id) {
  if (id === activeTabId && activeView) return;

  // Unmount current
  const prevTab = TABS.find(t => t.id === activeTabId);
  if (prevTab?.mod?.unmount && activeView) prevTab.mod.unmount(activeView);

  activeTabId = id;

  // Update tab button styles
  document.querySelectorAll('.tab-btn, .sidebar-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === id);
  });

  // Mount new view
  mainEl.innerHTML = '';
  activeView = mainEl;
  const tab = TABS.find(t => t.id === id);
  if (tab?.mod?.mount) tab.mod.mount(activeView);
}

// Start
init();
