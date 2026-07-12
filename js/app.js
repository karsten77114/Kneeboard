import store from './store.js';
import * as Home       from './views/home.js';
import * as FlightCrew from './views/flightcrew.js';
import * as Roster     from './views/roster.js';  // 保留 storage helpers（savePairing / getRoster）
import * as PA         from './views/pa.js';
import * as Tools      from './views/tools.js';
import { fetchBriefing, ensureLido, preloadMetarForFlight, preloadElbForFlight } from './services/api.js';
import { showToast, todayStr, toICAO } from './utils.js';
import storage from './services/storage.js';

// Roster tab 已移至 Logbook（個人資料集中管理）
// KneeBoard 僅保留 #roster?fn=XXX&date=YYYYMMDD 深連結機制供 Logbook 跳轉使用
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
let _sbDate        = todayStr().replace(/-/g, '');  // 恆為無破折號 YYYYMMDD
let _isOffline     = !navigator.onLine;
let subbarEl       = null;
const mainEl       = document.getElementById('main');
const topbarEl     = document.getElementById('topbar');
const searchbarEl  = document.getElementById('searchbar');
const tabbarEl     = document.getElementById('tabbar');
const sidebarEl    = document.getElementById('sidebar');

// ── Bootstrap ─────────────────────────────────────────────────────

function init() {
  // 一次性清除舊版 PegaSys 明文憑證：Roster tab 及其登入 UI 已移除、不可達，
  // 但舊使用者 localStorage 可能仍殘留含明文密碼的 kb_pegasys_creds。
  storage.remove('pegasys_creds');

  // 還原 Sunlight 高對比模式（駕駛艙強光）狀態
  if (storage.get('sunlight_mode')) document.documentElement.classList.add('sunlight');
  // ☀️ 切換鈕以事件委派綁在 topbar 上：topbar 每次 store emit 會重繪 innerHTML，
  // 委派綁定於容器本身，重繪後仍有效（無需隨每次 _renderTopBar 重掛）。
  topbarEl.addEventListener('click', e => {
    if (e.target.closest('#sunlight-toggle')) _toggleSunlight();
  });

  _ensureSubbar();
  _buildTabBar();
  _buildSidebar();
  _renderTopBar();
  _renderSearchBar();
  _renderSubbar();
  _startClock();

  // 冷啟動還原：iOS 殺掉背景 PWA 後重開，把上次的 briefing 從 localStorage 拉回來，
  // 直接停在 Flight Crew，免得使用者每次重開都要重新搜尋（且離線也能還原）。
  const hydrated = store.hydrate();
  if (hydrated) {
    _sbDate = String(store.flight?.date || '').replace(/-/g, '') || todayStr().replace(/-/g, '');
    _renderSearchBar();
    const inp = searchbarEl?.querySelector('#sb-flt-input');
    if (inp) inp.value = String(store.flight?.flightNumber || '').replace(/^JX/i, '');
  }
  _switchTab(hydrated ? 'flightcrew' : 'home');

  store.subscribe(() => {
    _renderTopBar();
    _renderSearchBar();
    _renderSubbar();
  });

  // C2：連線狀態橫幅
  window.addEventListener('offline', () => { _isOffline = true;  _renderSubbar(); });
  window.addEventListener('online',  () => { _isOffline = false; _renderSubbar(); showToast('✅ 網路已恢復'); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'SW_UPDATED') {
        showToast('✅ 應用程式已更新至最新版本');
        setTimeout(() => window.location.reload(), 1500);
      }
    });
  }

  // Roster import via hash: #roster?fn=703&date=20260608
  const deepLinkConsumed = _handleRosterHash();
  // A2：無 deep link 時，若有今日/生效中的 pairing 則自動載入（停在 Home）
  _autoLoadToday(deepLinkConsumed);
}

// 在 searchbar 下方建立固定的 subbar 容器（放離線橫幅 + leg 切換 chips）
function _ensureSubbar() {
  subbarEl = document.getElementById('subbar');
  if (!subbarEl && searchbarEl) {
    subbarEl = document.createElement('div');
    subbarEl.id = 'subbar';
    searchbarEl.insertAdjacentElement('afterend', subbarEl);
  }
}

// 回傳 boolean：是否消化了 roster deep link（true 時 _autoLoadToday 不再動作）
function _handleRosterHash() {
  const hash = location.hash;
  if (!hash.startsWith('#roster?')) return false;
  const p = new URLSearchParams(hash.slice('#roster?'.length));

  // Clear hash immediately (avoids re-trigger on SW_UPDATED reload)
  history.replaceState(null, '', location.pathname + location.search);

  // ── Full pairing JSON from iOS Shortcut: #roster?data=BASE64 ──
  const dataB64 = p.get('data');
  if (dataB64) {
    try {
      const pairing = JSON.parse(atob(dataB64));
      if (pairing?.date && pairing?.legs?.length) {
        Roster.savePairing(pairing);
        showToast(`✅ ${pairing.date.slice(4,6)}/${pairing.date.slice(6,8)} 班表已匯入`);
        // 匯入後停在 home（Roster tab 已移除）；若當日班表存在，下方 kb-load-flight
        // 流程會自動載入首段 briefing 並切到 flightcrew
        if (Roster.getRoster().find(r => r.date === pairing.date)) {
          const firstLeg = pairing.legs[0];
          if (firstLeg) {
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('kb-load-flight', {
                detail: { fn: firstLeg.flightNumber.replace(/^JX/i, ''), date: pairing.date }
              }));
            }, 600);
          }
        }
        return true;
      }
    } catch (_) {}
    showToast('⚠ 無法解析班表資料');
    return true;
  }

  // ── Simple fn+date from bookmarklet button: #roster?fn=703&date=20260608 ──
  const fn   = p.get('fn');
  const date = p.get('date');
  if (!fn || !date) return true; // 是 roster hash（已清除），但缺參數，不再 auto-load

  _sbDate = date;
  setTimeout(async () => {
    const inp = searchbarEl?.querySelector('#sb-flt-input');
    if (inp) inp.value = fn;
    _renderSearchBar();
    await _doSbSearch();
    // 停在 home page — 使用者可先看公告欄，再自行切換 tab
  }, 800);
  return true;
}

// A2：App 啟動時自動帶入今日/生效中的航班（停在 Home），供 topbar 直接顯示。
function _autoLoadToday(deepLinkConsumed) {
  if (deepLinkConsumed) return;   // (a) deep link 已處理
  if (store.flight) return;       // (b) 已有航班
  const pairing = Roster.getCurrentPairing();
  if (!pairing?.legs?.length) return; // (c) 沒有生效中的 pairing

  // 選 leg：第一個「預計到達尚未過」的 leg；全過了取最後一腿。
  const now = Date.now();
  let leg = pairing.legs.find(lg => {
    const arr = Roster.estimateLegArrivalUTC(pairing.date, lg);
    return arr && arr > now;
  });
  if (!leg) leg = pairing.legs[pairing.legs.length - 1];

  const fn = String(leg.flightNumber || '').replace(/^JX/i, '');
  if (!fn) return;

  _sbDate = pairing.date;
  const inp = searchbarEl?.querySelector('#sb-flt-input');
  if (inp) inp.value = fn;          // _renderSearchBar 會保留此值
  _renderSearchBar();
  _doSbSearch({ switchTab: false, silent: true });
}

// ── Cross-view: load flight from Roster tab ───────────────────────

window.addEventListener('kb-load-flight', async (e) => {
  const { fn, date } = e.detail;
  _sbDate = date;
  const inp = searchbarEl?.querySelector('#sb-flt-input');
  if (inp) inp.value = fn;
  _renderSearchBar();
  showToast(`Loading JX${fn}…`);
  // _doSbSearch 成功後會自動切到 flightcrew，這裡不需再切換
  await _doSbSearch();
});

// ── Cross-view: switch tab (e.g. Home 今日航班卡 → Flight Crew) ─────
window.addEventListener('kb-switch-tab', (e) => {
  const tab = e.detail?.tab;
  if (tab) _switchTab(tab);
});

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

// Topbar 右側叢集：☀️ Sunlight 切換鈕 + UTC 時鐘
function _topbarRight() {
  return `<div class="topbar-right">
    <button class="sunlight-toggle" id="sunlight-toggle"
            aria-label="切換 Sunlight 高對比模式" title="Sunlight 模式">☀️</button>
    <div class="topbar-utc">
      <span class="topbar-utc-label">UTC</span>
      <span id="topbar-utc-time">${_utcNow()}</span>
    </div>
  </div>`;
}

// Sunlight 高對比模式切換：僅 toggle html.sunlight class + 存 localStorage +
// toast，不觸發 store emit（避免 render 觸發 emit 的鐵則）。
function _toggleSunlight() {
  const on = !document.documentElement.classList.contains('sunlight');
  document.documentElement.classList.toggle('sunlight', on);
  storage.set('sunlight_mode', on);
  showToast(on ? '☀️ Sunlight 模式' : '🌙 標準模式');
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
      <img class="topbar-logo" src="assets/icons/apple-touch-icon.png" alt="Kneeboard">
      <div class="topbar-empty">尚未選擇航班 — 請在主畫面查詢</div>
      ${_topbarRight()}`;
    return;
  }

  const std = f.std || '';
  const sta = f.sta || '';
  const times = [std, sta].filter(Boolean).join('→');
  topbarEl.innerHTML = `
    <img class="topbar-logo" src="assets/icons/apple-touch-icon.png" alt="KB">
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
        ${_freshnessChip()}
        ${f.reg   ? `<span class="topbar-reg">${f.reg}</span>` : ''}
        ${f.date  ? `<span class="topbar-date">${_dateStr(f.date)}</span>` : ''}
        ${times   ? `<span class="topbar-times">${times}</span>` : ''}
      </div>
    </div>
    ${_topbarRight()}`;
}

// C1：資料時效 chip — LIVE HHMMZ（綠）/ CACHED Xm（琥珀）。資料來源 store.briefing。
function _freshnessChip() {
  const b = store.briefing;
  if (!b || !b._source || !b._fetchedAt) return '';
  if (b._source === 'live') {
    const d  = new Date(b._fetchedAt);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `<span class="topbar-fresh live">LIVE ${hh}${mm}Z</span>`;
  }
  if (b._source === 'cache') {
    const mins = Math.max(0, Math.floor((Date.now() - b._fetchedAt) / 60000));
    const label = mins > 90 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    return `<span class="topbar-fresh cache">CACHED ${label}</span>`;
  }
  return '';
}

// 正規化班號為純數字，供 leg chip 高亮比對（"JX703" / "703" → "703"）
function _normFn(fn) {
  return String(fn || '').toUpperCase().replace(/[^0-9]/g, '');
}

// C2 離線橫幅 + A3 leg 切換 chips（固定於 searchbar 下方的 subbar）
function _renderSubbar() {
  if (!subbarEl) return;
  const parts = [];

  if (_isOffline) {
    parts.push(`<div class="offline-banner">📴 離線 — 顯示快取資料</div>`);
  }

  const pairing = Roster.getCurrentPairing();
  if (pairing && (pairing.legs?.length || 0) >= 2) {
    const curFn = _normFn(store.flight?.flightNumber);
    const chips = pairing.legs.map(lg => {
      const legFn  = _normFn(lg.flightNumber);
      const loaded = curFn && legFn && curFn === legFn;
      return `<button class="leg-chip${loaded ? ' active' : ''}"
              data-leg-fn="${String(lg.flightNumber || '').replace(/^JX/i, '')}"
              data-leg-date="${pairing.date}"${loaded ? ' disabled' : ''}>
        <span class="leg-chip-fn">${lg.flightNumber}</span>
        <span class="leg-chip-rt">${lg.dep}→${lg.dest}</span>
      </button>`;
    }).join('');
    parts.push(`<div class="leg-chips">${chips}</div>`);
  }

  subbarEl.innerHTML = parts.join('');

  subbarEl.querySelectorAll('.leg-chip:not(.active)').forEach(btn => {
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('kb-load-flight', {
        detail: { fn: btn.dataset.legFn, date: btn.dataset.legDate }
      }));
    });
  });

  // 依 subbar 實際高度下推 #main，避免內容被遮住；無內容則還原 CSS 預設。
  mainEl.style.top = parts.length ? `${subbarEl.getBoundingClientRect().bottom}px` : '';
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
                style="height:44px;padding:0 12px;font-size:12px;white-space:nowrap">查詢</button>
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
                style="height:44px;padding:0 16px;font-size:13px;font-weight:700;white-space:nowrap">
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

  btn?.addEventListener('click', () => _doSbSearch());
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') _doSbSearch(); });

  dateInput?.addEventListener('change', () => {
    _sbDate = dateInput.value.replace(/-/g, '');
  });

  prevBtn?.addEventListener('click', () => _shiftSbDate(-1));
  nextBtn?.addEventListener('click', () => _shiftSbDate(1));
}

// 搜尋列日期位移（±N 天）。全程 UTC 方法，避免時區混用；輸入非 8 位純數字時
// 防呆重置為今日（_sbDate 恆為無破折號 YYYYMMDD 的不變式在此保底）。
function _shiftSbDate(delta) {
  const ds = String(_sbDate || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(ds)) { _sbDate = todayStr().replace(/-/g, ''); _renderSearchBar(); return; }
  const d = new Date(Date.UTC(+ds.slice(0,4), +ds.slice(4,6) - 1, +ds.slice(6,8)));
  d.setUTCDate(d.getUTCDate() + delta);
  _sbDate = d.toISOString().slice(0,10).replace(/-/g,'');
  _renderSearchBar();
}

async function _doSbSearch({ switchTab = true, silent = false } = {}) {
  if (_sbSearching) return;
  const input  = searchbarEl.querySelector('#sb-flt-input');
  const flight = (input?.value || '').trim().replace(/^JX/i, '');
  if (!flight) {
    if (!silent) { showToast('請輸入班號'); input?.focus(); }
    return;
  }

  const date = _sbDate;
  _sbSearching = true;
  _renderSearchBar();

  try {
    // ensureLido 無 token 時會自動向 Worker 重新登入（帳密在 secrets）
    const ready = await ensureLido();
    if (!ready) {
      if (!silent) {
        showToast('⚠ LIDO 連線失敗，已自動重試，請稍後再查詢一次');
        _switchTab('home');
      }
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
    showToast(silent ? `✈ 今日 JX${flight} 已自動載入` : `✅ JX${flight} 已載入`);
    // 查詢成功自動進 Flight Crew（僅在 switchTab 時；silent auto-load 停在 Home）
    if (switchTab) _switchTab('flightcrew');

    // Background preloads
    const reg = data.aircraft?.registration || data.ofp?.reg || '';
    if (reg && store.auth.elb.status === 'ok') preloadElbForFlight(reg).catch(() => {});
    const wxApts = [data.dep, data.dest,
      data.ofp?.altnApt || data.ofp?.altn || data.altn || data.alternate,
      ...(data.wxAirports || [])].filter(Boolean).map(toICAO);
    preloadMetarForFlight([...new Set(wxApts)]).catch(() => {});
  } catch (e) {
    if (e.message === 'session_expired') {
      // token 已失效並清除，下次查詢時 ensureLido 會自動重新登入
      if (!silent) {
        showToast('⚠ LIDO 連線過期，已自動重試，請稍後再查詢一次');
        _switchTab('home');
      }
    } else if (!silent) {
      showToast(`❌ ${e.message}`);
    }
  } finally {
    _sbSearching = false;
    _renderSearchBar();
  }
}

// Start
init();
