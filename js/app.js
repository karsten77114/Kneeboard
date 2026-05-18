import store from './store.js';
import * as Home       from './views/home.js';
import * as FlightCrew from './views/flightcrew.js';
import * as PA         from './views/pa.js';
import * as Tools      from './views/tools.js';
import { fetchBriefing, ensureLido, preloadMetarForFlight, preloadElbForFlight } from './services/api.js';
import { showToast, todayStr, toICAO } from './utils.js';
import storage from './services/storage.js';

const TABS = [
  { id: 'home',       label: 'Home',         icon: '🏠', mod: Home       },
  { id: 'flightcrew', label: 'Flight Crew',  icon: '✈️', mod: FlightCrew },
  { id: 'pa',         label: 'PA',           icon: '🎙', mod: PA         },
  { id: 'tools',      label: 'Tools',        icon: '🔧', mod: Tools      },
];

let activeTabId    = 'home';
let activeView     = null;
let _clockTimer    = null;
let _sbSearching   = false;
const mainEl       = document.getElementById('main');
const topbarEl     = document.getElementById('topbar');
const searchbarEl  = document.getElementById('searchbar');
const tabbarEl     = document.getElementById('tabbar');
const sidebarEl    = document.getElementById('sidebar');

// ── Bootstrap ─────────────────────────────────────────────────────

function init() {
  _buildTabBar();
  _buildSidebar();
  _renderTopBar();
  _renderSearchBar();
  _startClock();
  _switchTab('home');

  store.subscribe(() => {
    _renderTopBar();
    _renderSearchBar();
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

  const std = f.std || '';
  const sta = f.sta || '';
  const times = [std, sta].filter(Boolean).join('→');
  topbarEl.innerHTML = `
    <div class="topbar-logo">KB</div>
    <div class="topbar-flight">
      <div class="topbar-main-row">
        <span class="topbar-flt-num">${f.flightNumber || ''}</span>
        <span class="topbar-route">
          <span>${toICAO(f.dep) || ''}</span>
          <span class="topbar-arrow">→</span>
          <span>${toICAO(f.dest) || ''}</span>
        </span>
      </div>
      <div class="topbar-meta">
        ${f.reg   ? `<span class="topbar-reg">${f.reg}</span>` : ''}
        ${times   ? `<span class="topbar-times">${times}</span>` : ''}
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

// ── Search Bar ────────────────────────────────────────────────────

function _renderSearchBar() {
  const f = store.flight;

  if (f) {
    // Flight loaded — show compact info + change button
    searchbarEl.innerHTML = `
      <div class="sb-flight-info">
        <span class="sb-flt">${f.flightNumber || ''}</span>
        <span class="sb-route">${toICAO(f.dep) || ''}→${toICAO(f.dest) || ''}
          ${f.std ? `<span style="font-size:11px;color:var(--text3);margin-left:4px">${f.std}</span>` : ''}
        </span>
      </div>
      <div class="sb-search-form" style="flex:0 0 auto">
        <input class="sb-input" id="sb-flt-input" placeholder="換班號" maxlength="4"
               style="width:90px;font-size:13px">
        <button class="btn btn-ghost btn-sm" id="sb-btn"
                style="height:30px;padding:0 10px;font-size:12px;white-space:nowrap">查詢</button>
      </div>`;
  } else {
    // No flight — show prominent search
    searchbarEl.innerHTML = `
      <div class="sb-search-form">
        <span class="sb-hint">班號</span>
        <input class="sb-input" id="sb-flt-input" placeholder="800" maxlength="4">
        <button class="btn btn-primary btn-sm" id="sb-btn"
                style="height:30px;padding:0 14px;font-size:13px;font-weight:700;white-space:nowrap">
          ${_sbSearching ? '查詢中…' : '查詢'}
        </button>
        ${_sbSearching ? '<div class="spinner" style="width:16px;height:16px;border-width:2px;flex-shrink:0"></div>' : ''}
      </div>`;
  }

  const input = searchbarEl.querySelector('#sb-flt-input');
  const btn   = searchbarEl.querySelector('#sb-btn');

  // Restore last flight number
  const last = storage.getLastSearch();
  if (input && last.flight && !f) input.value = last.flight;

  btn?.addEventListener('click', _doSbSearch);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') _doSbSearch(); });
}

async function _doSbSearch() {
  if (_sbSearching) return;
  const input  = searchbarEl.querySelector('#sb-flt-input');
  const flight = (input?.value || '').trim().replace(/^JX/i, '');
  if (!flight) { showToast('請輸入班號'); input?.focus(); return; }

  const date = todayStr();
  _sbSearching = true;
  _renderSearchBar();

  try {
    const ready = await ensureLido();
    if (!ready) {
      showToast('⚠ 請先在首頁登入 LIDO');
      _switchTab('home');
      return;
    }

    const data = await fetchBriefing(flight, date, '', '');
    store.setBriefing(data);
    store.setFlight({
      legId:        data.legId,
      flightNumber: data.flightNumber,
      dep:          data.dep,
      dest:         data.dest,
      std:          data.times?.std || '',
      sta:          data.times?.sta || '',
      stdLocal:     data.times?.stdLocal || '',
      staLocal:     data.times?.staLocal || '',
      ete:          data.times?.ete  || '',
      reg:          data.aircraft?.registration || data.ofp?.reg || '',
      date:         data.date,
    });
    storage.saveLastSearch({ flight, dep: data.dep, dest: data.dest });
    showToast(`✅ JX${flight} 已載入`);

    // Background preloads
    const reg = data.aircraft?.registration || data.ofp?.reg || '';
    if (reg && store.auth.elb.status === 'ok') preloadElbForFlight(reg).catch(() => {});
    const wxApts = [data.dep, data.dest,
      data.ofp?.altnApt || data.ofp?.altn || data.altn || data.alternate,
      ...(data.wxAirports || [])].filter(Boolean).map(toICAO);
    preloadMetarForFlight([...new Set(wxApts)]).catch(() => {});
  } catch (e) {
    if (e.message === 'session_expired') {
      showToast('⚠ LIDO session 過期，請重新登入');
      _switchTab('home');
    } else {
      showToast(`❌ ${e.message}`);
    }
  } finally {
    _sbSearching = false;
    _renderSearchBar();
  }
}

// Start
init();
