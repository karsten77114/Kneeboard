import store from './store.js';
import { verifySessions, ensureLido, fetchBriefing, preloadElbForFlight, preloadMetarForFlight } from './services/api.js';
import storage from './services/storage.js';
import { todayStr, toICAO, showToast } from './utils.js';
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
let _sessionTimer = null;
const mainEl      = document.getElementById('main');
const topbarEl    = document.getElementById('topbar');
const tabbarEl    = document.getElementById('tabbar');
const sidebarEl   = document.getElementById('sidebar');

// ── Bootstrap ─────────────────────────────────────────────────────

function init() {
  _buildTabBar();
  _buildSidebar();
  _renderTopBar();
  _initTopBarSearch();
  _startClock();
  _startSessionCheck();
  _switchTab('home');

  store.subscribe(() => {
    _renderTopBar();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Also check session when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      verifySessions().catch(() => {});
    }
  });
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

// ── Session Check ─────────────────────────────────────────────────

function _startSessionCheck() {
  if (_sessionTimer) clearInterval(_sessionTimer);
  // Check once immediately (background)
  verifySessions().catch(() => {});
  // Then every 15 minutes
  _sessionTimer = setInterval(() => {
    verifySessions().catch(() => {});
  }, 15 * 60000);
}

// ── Top Bar ───────────────────────────────────────────────────────

function _utcBlock() {
  return `<div class="topbar-utc">
    <span class="topbar-utc-label">UTC</span>
    <span id="topbar-utc-time">${_utcNow()}</span>
  </div>`;
}

function _renderTopBar() {
  const row1 = document.getElementById('topbar-row1');
  if (!row1) return;
  const f = store.flight;

  if (!f) {
    row1.innerHTML = `
      <div class="topbar-logo">Kneeboard</div>
      <div></div>
      ${_utcBlock()}`;
    return;
  }

  const std = f.std || '';
  const sta = f.sta || '';
  const times = [std, sta].filter(Boolean).join('→');
  row1.innerHTML = `
    <div class="topbar-logo">KB</div>
    <div class="topbar-flight">
      <div class="topbar-main-row">
        <span class="topbar-flt-num">${f.flightNumber || ''}</span>
        <span class="topbar-route">
          <span>${f.dep || ''}</span>
          <span class="topbar-arrow">→</span>
          <span>${f.dest || ''}</span>
        </span>
      </div>
      <div class="topbar-meta">
        ${f.reg   ? `<span class="topbar-reg">${f.reg}</span>` : ''}
        ${times   ? `<span class="topbar-times">${times}</span>` : ''}
      </div>
    </div>
    ${_utcBlock()}`;
}

// ── Topbar Search ─────────────────────────────────────────────────

function _initTopBarSearch() {
  const row2 = document.getElementById('topbar-row2');
  if (!row2) return;

  const last = storage.getLastSearch();
  row2.innerHTML = `
    <input class="input input-upper" id="tb-flight" placeholder="班號" maxlength="5"
      style="width:68px;height:30px;font-size:13px;padding:4px 8px;flex-shrink:0"
      value="${last.flight || ''}">
    <button class="btn btn-ghost btn-sm" id="tb-date-prev"
      style="padding:4px 8px;height:30px;font-size:12px;flex-shrink:0">◀</button>
    <input class="input" id="tb-date" type="date"
      style="flex:1;min-width:0;max-width:160px;height:30px;font-size:13px;padding:4px 6px">
    <button class="btn btn-ghost btn-sm" id="tb-date-next"
      style="padding:4px 8px;height:30px;font-size:12px;flex-shrink:0">▶</button>
    <button class="btn btn-primary btn-sm" id="tb-search"
      style="height:30px;font-size:13px;padding:4px 14px;flex-shrink:0">查詢</button>
  `;

  document.getElementById('tb-date').value = todayStr();
  document.getElementById('tb-date-prev').onclick = () => _shiftDate(-1);
  document.getElementById('tb-date-next').onclick = () => _shiftDate(+1);
  document.getElementById('tb-search').onclick = _doSearch;
  ['tb-flight', 'tb-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _doSearch();
    });
  });
}

function _shiftDate(delta) {
  const el = document.getElementById('tb-date');
  if (!el?.value) return;
  const d = new Date(el.value + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  el.value = d.toISOString().slice(0, 10);
}

async function _doSearch() {
  const flight = document.getElementById('tb-flight')?.value.trim().replace(/^JX/i, '');
  const date   = document.getElementById('tb-date')?.value;
  const btn    = document.getElementById('tb-search');

  if (!flight) { showToast('請輸入班號', true); return; }
  if (!date)   { showToast('請選擇日期', true); return; }

  storage.saveLastSearch({ flight });

  if (btn) { btn.textContent = '查詢中…'; btn.disabled = true; }

  const ready = await ensureLido();
  if (!ready) {
    if (btn) { btn.textContent = '查詢'; btn.disabled = false; }
    showToast('請先登入 LIDO', true);
    return;
  }

  try {
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

    showToast(`✅ JX${flight} 已載入`);

    const reg = data.aircraft?.registration || data.ofp?.reg || '';
    if (reg && store.auth.elb.status === 'ok') {
      preloadElbForFlight(reg).catch(() => {});
    }
    const wxApts = [
      data.dep, data.dest,
      data.ofp?.altnApt || data.ofp?.altn || data.altn || data.alternate,
      ...(data.wxAirports || []),
    ].filter(Boolean).map(toICAO);
    preloadMetarForFlight([...new Set(wxApts)]).catch(() => {});
  } catch (e) {
    if (e.message === 'session_expired') {
      showToast('LIDO session 過期，請重新登入', true);
    } else {
      showToast(e.message, true);
    }
  } finally {
    if (btn) { btn.textContent = '查詢'; btn.disabled = false; }
  }
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
