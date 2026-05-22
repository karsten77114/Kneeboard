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
let _sbDate        = todayStr();
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
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SW_UPDATED') {
        showToast('✅ 應用程式已更新至最新版本');
        setTimeout(() => window.location.reload(), 1500);
      }
    });
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

function _dateStr(d) {
  if (!d) return '';
  const s = String(d).replace(/-/g, '');
  if (s.length < 8) return '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const m = parseInt(s.slice(4,6), 10) - 1;
  if (m < 0 || m > 11) return '';
  return `${s.slice(6,8)}${months[m]}${s.slice(2,4)}`;
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
        ${f.date  ? `<span class="topbar-date">${_dateStr(f.date)}</span>` : ''}
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

  const prevFlight = searchbarEl.querySelector('#sb-flt-input')?.value || '';

  if (f) {
    // Flight loaded — topbar already shows flight info, just show search form
    searchbarEl.innerHTML = `
      <div class="sb-search-form">
        <input class="sb-input" id="sb-flt-input" placeholder="換班號" maxlength="4"
               style="width:72px;font-size:13px">
        <button class="sb-nav-btn" id="sb-prev">◄</button>
        <input type="date" id="sb-date-input" class="sb-date-input"
               value="${_sbDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}">
        <button class="sb-nav-btn" id="sb-next">►</button>
        <button class="btn btn-ghost btn-sm" id="sb-btn"
                style="height:30px;padding:0 10px;font-size:12px;white-space:nowrap">查詢</button>
      </div>`;
  } else {
    // No flight — show prominent search with date picker
    searchbarEl.innerHTML = `
      <div class="sb-search-form">
        <input class="sb-input" id="sb-flt-input" placeholder="800" maxlength="4">
        <button class="sb-nav-btn" id="sb-prev">◄</button>
        <input type="date" id="sb-date-input" class="sb-date-input"
               value="${_sbDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}">
        <button class="sb-nav-btn" id="sb-next">►</button>
        <button class="btn btn-primary btn-sm" id="sb-btn"
                style="height:30px;padding:0 14px;font-size:13px;font-weight:700;white-space:nowrap">
          ${_sbSearching ? '查詢中…' : '查詢'}
        </button>
        ${_sbSearching ? '<div class="spinner" style="width:16px;height:16px;border-width:2px;flex-shrink:0"></div>' : ''}
      </div>`;
  }

  const input     = searchbarEl.querySelector('#sb-flt-input');
  const btn       = searchbarEl.querySelector('#sb-btn');
  const dateInput = searchbarEl.querySelector('#sb-date-input');
  const prevBtn   = searchbarEl.querySelector('#sb-prev');
  const nextBtn   = searchbarEl.querySelector('#sb-next');

  // Restore flight number (prefer what user was typing, then saved last)
  const last = storage.getLastSearch();
  if (input) input.value = prevFlight || (!f && last.flight ? last.flight : '');

  btn?.addEventListener('click', _doSbSearch);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') _doSbSearch(); });

  dateInput?.addEventListener('change', () => {
    _sbDate = dateInput.value.replace(/-/g, '');
  });

  prevBtn?.addEventListener('click', () => {
    const d = new Date(_sbDate.slice(0,4) + '-' + _sbDate.slice(4,6) + '-' + _sbDate.slice(6,8));
    d.setDate(d.getDate() - 1);
    _sbDate = d.toISOString().slice(0,10).replace(/-/g,'');
    _renderSearchBar();
  });

  nextBtn?.addEventListener('click', () => {
    const d = new Date(_sbDate.slice(0,4) + '-' + _sbDate.slice(4,6) + '-' + _sbDate.slice(6,8));
    d.setDate(d.getDate() + 1);
    _sbDate = d.toISOString().slice(0,10).replace(/-/g,'');
    _renderSearchBar();
  });
}

async function _doSbSearch() {
  if (_sbSearching) return;
  const input  = searchbarEl.querySelector('#sb-flt-input');
  const flight = (input?.value || '').trim().replace(/^JX/i, '');
  if (!flight) { showToast('請輸入班號'); input?.focus(); return; }

  const date = _sbDate;
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
