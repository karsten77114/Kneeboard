import store from '../store.js';
import storage from '../services/storage.js';
import { ensureLido, elbLogin, verifySessions } from '../services/api.js';
import { showToast, toICAO, formatDateDisplay } from '../utils.js';
import { mountNoticeBoard } from './notice-board.js';
import * as Roster from './roster.js';  // getCurrentPairing / estimateLegArrivalUTC

// ── PIREPS checklist definition ───────────────────────────────────
const PIREPS = [
  { id: 'P1', cat: 'P — Personal', label: 'Sign On & 更新 App' },
  { id: 'P2', cat: 'P — Personal', label: '證件 (ID / Licence / Medical)' },
  { id: 'I1', cat: 'I — Information', label: '班號 / STD / 飛時 / 巡航高度' },
  { id: 'R1', cat: 'R — Registration', label: '機號 / 旅客數 / 油量 / 水量' },
  { id: 'R2', cat: 'R — Registration', label: 'MEL Deferred Defects' },
  { id: 'R3', cat: 'R — Registration', label: '停機位 (Parking Stand)' },
  { id: 'E1', cat: 'E — Enroute Wx', label: '出發地天氣 (METAR/TAF/ATIS)' },
  { id: 'E2', cat: 'E — Enroute Wx', label: '目的地天氣' },
  { id: 'E3', cat: 'E — Enroute Wx', label: '備降場天氣' },
  { id: 'E4', cat: 'E — Enroute Wx', label: '航路天氣 / 亂流' },
  { id: 'P_1', cat: 'P — Performance', label: '起飛重量 / 落地重量' },
  { id: 'P_2', cat: 'P — Performance', label: 'MEL 限制確認' },
  { id: 'S1', cat: 'S — Special', label: 'Crew / Aircraft 特殊程序' },
  { id: 'S2', cat: 'S — Special', label: 'Airport / Weather NOTAM' },
  { id: 'S3', cat: 'S — Special', label: 'Fuel 計畫確認' },
  { id: 'F1', cat: 'Final', label: 'Fleet Notice Reviewed' },
  { id: 'F2', cat: 'Final', label: 'OFP Signed' },
];


export function mount(container) {
  container.innerHTML = `
    <div class="view-content">

      <!-- ① 今日航班卡（store.flight → pairing → 空狀態） -->
      <div id="today-flight-mount"></div>

      <!-- ② 連線狀態細條 -->
      <div class="conn-strip" id="conn-strip">
        <div class="conn-item" id="conn-lido">
          <span class="dot dot-grey" id="dot-lido"></span>
          <span class="conn-lbl">LIDO</span>
          <button class="btn btn-ghost btn-sm hidden conn-retry" id="btn-lido-retry">重連</button>
        </div>
        <div class="conn-item" id="conn-elb">
          <span class="dot dot-grey" id="dot-elb"></span>
          <span class="conn-lbl">ELB</span>
          <button class="btn btn-ghost btn-sm hidden conn-retry" id="btn-elb-retry">重連</button>
        </div>
      </div>

      <!-- ③ Notice Board -->
      <div id="notice-board-mount"></div>

      <!-- PIREPS（隱藏保留，去留未決） -->
      <div id="pireps-section" class="hidden">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="section-title" style="margin-bottom:0">PIREPS 飛行前檢查</div>
          <button class="btn btn-ghost btn-sm" id="btn-reset-pireps">重置</button>
        </div>
        <div class="card" style="margin-top:10px" id="pireps-list"></div>
      </div>

    </div>
  `;

  _applyStyles();

  mountNoticeBoard(container.querySelector('#notice-board-mount'));

  _initAuth();
  _renderAuthStatus();
  _renderTodayFlight(container);
  _renderPireps();

  const unsub = store.subscribe(() => {
    _renderAuthStatus();
    _renderTodayFlight(container);
    _renderPireps();
  });
  container._unsub = unsub;
}

export function unmount(container) {
  if (container._unsub) container._unsub();
}

// ── ① 今日航班卡 ───────────────────────────────────────────────────
// 資料源優先序：store.flight → Roster.getCurrentPairing() → 空狀態
// 只讀 store / dispatch 事件，不呼叫任何 store emit setter（遵守 emit 鐵則）。
function _renderTodayFlight(container) {
  const mount = container.querySelector('#today-flight-mount');
  if (!mount) return;

  const f = store.flight;
  if (f) {
    mount.innerHTML = _flightCardHtml(f);
    mount.querySelector('#tf-open-briefing')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('kb-switch-tab', { detail: { tab: 'flightcrew' } }));
    });
    return;
  }

  const pairing = Roster.getCurrentPairing();
  if (pairing?.legs?.length) {
    mount.innerHTML = _pairingCardHtml(pairing);
    const btn = mount.querySelector('#tf-load-flight');
    btn?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('kb-load-flight', {
        detail: { fn: btn.dataset.fn, date: btn.dataset.date }
      }));
    });
    return;
  }

  mount.innerHTML = `<div class="tf-empty">今日無班表 — 在上方輸入班號查詢</div>`;
}

function _flightCardHtml(f) {
  const dep  = toICAO(f.dep)  || f.dep  || '';
  const dest = toICAO(f.dest) || f.dest || '';
  // local 為主、Z 為輔；若無 local 則直接顯示 Z（避免重複）
  const std = { main: f.stdLocal ? `${f.stdLocal}L` : (f.std || '—'), sub: f.stdLocal ? (f.std || '') : '' };
  const sta = { main: f.staLocal ? `${f.staLocal}L` : (f.sta || '—'), sub: f.staLocal ? (f.sta || '') : '' };

  const timeCol = (lbl, t) => `
    <div class="tf-tcol">
      <span class="tf-tlbl">${lbl}</span>
      <span class="tf-tmain">${t.main}</span>
      ${t.sub ? `<span class="tf-tsub">${t.sub}</span>` : ''}
    </div>`;

  return `
    <div class="card tf-card">
      <div class="tf-head">
        <span class="tf-flt">${f.flightNumber || ''}</span>
        <span class="tf-route"><span>${dep}</span><span class="tf-arrow">→</span><span>${dest}</span></span>
        ${f.date ? `<span class="tf-date">${formatDateDisplay(String(f.date).replace(/-/g, ''))}</span>` : ''}
      </div>
      <div class="tf-times">
        ${timeCol('STD', std)}
        ${timeCol('STA', sta)}
        ${f.reg ? `<div class="tf-tcol"><span class="tf-tlbl">A/C</span><span class="tf-tmain">${f.reg}</span></div>` : ''}
      </div>
      <button class="btn btn-primary tf-open" id="tf-open-briefing">Open Briefing ✈</button>
    </div>`;
}

function _pairingCardHtml(p) {
  // 首個「預計到達尚未過」的 leg；全過了取最後一腿（與 app.js _autoLoadToday 一致）
  const now = Date.now();
  let leg = p.legs.find(lg => {
    const arr = Roster.estimateLegArrivalUTC(p.date, lg);
    return arr && arr > now;
  });
  if (!leg) leg = p.legs[p.legs.length - 1];
  const fn = String(leg.flightNumber || '').replace(/^JX/i, '');

  const legs = p.legs.map(lg => `
    <div class="tf-leg">
      <span class="tf-leg-fn">${lg.flightNumber}</span>
      <span class="tf-leg-rt">${lg.dep}→${lg.dest}</span>
      ${lg.std_local ? `<span class="tf-leg-std">${lg.std_local}L</span>` : ''}
    </div>`).join('');

  return `
    <div class="card tf-card">
      <div class="tf-head">
        <span class="tf-pairing-date">${formatDateDisplay(p.date)}</span>
        ${p.reportTime ? `<span class="tf-report">Report ${p.reportAirport || ''} ${p.reportTime}L</span>` : ''}
      </div>
      <div class="tf-legs">${legs}</div>
      <button class="btn btn-primary tf-open" id="tf-load-flight"
              data-fn="${fn}" data-date="${p.date}">載入 JX${fn} ✈</button>
    </div>`;
}

// ── Auth ──────────────────────────────────────────────────────────

function _renderAuthStatus() {
  _updateDot('lido');
  _updateDot('elb');
}

function _updateDot(system) {
  const { status } = store.auth[system];
  const dot  = document.getElementById(`dot-${system}`);
  const txt  = document.getElementById(`status-${system}`);
  const btn  = document.getElementById(`btn-${system}-retry`);
  if (!dot) return;

  const map = {
    ok:         { cls: 'dot-green',  label: '已連線' },
    connecting: { cls: 'dot-yellow', label: '連線中…' },
    error:      { cls: 'dot-red',    label: '連線失敗' },
    idle:       { cls: 'dot-grey',   label: '未連線' },
  };
  const m = map[status] || map.idle;
  dot.className = `dot ${m.cls}`;
  if (txt) txt.textContent = m.label;   // 細條無狀態文字，保留相容
  // 只有失敗時才顯示重連按鈕
  if (btn) btn.classList.toggle('hidden', status !== 'error');
}

function _initAuth() {
  // 重新連線按鈕
  document.getElementById('btn-lido-retry').onclick = () => _autoConnect('lido');
  document.getElementById('btn-elb-retry').onclick  = () => _autoConnect('elb');

  // 啟動時從 localStorage 還原 token 到 store
  const lidoToken = storage.getLidoToken();
  if (lidoToken) {
    store.setAuth('lido', { token: lidoToken, status: 'ok' });
  }
  const elbToken = storage.getELBToken();
  if (elbToken) {
    store.setAuth('elb', { token: elbToken, status: 'ok' });
  }

  // 背景驗證 / 自動登入
  verifySessions();
}

async function _autoConnect(system) {
  store.setAuth(system, { status: 'connecting' });
  try {
    if (system === 'lido') {
      const { lidoLogin: login } = await import('../services/api.js');
      const token = await login();
      storage.saveLidoToken(token);
      store.setAuth('lido', { token, status: 'ok' });
    } else {
      const token = await elbLogin();
      storage.saveELBToken(token);
      store.setAuth('elb', { token, status: 'ok' });
    }
    showToast(`✅ ${system.toUpperCase()} 已重新連線`);
  } catch (e) {
    store.setAuth(system, { status: 'error' });
    showToast(`❌ ${system.toUpperCase()} 連線失敗：${e.message}`);
  }
}

// ── PIREPS ────────────────────────────────────────────────────────

function _renderPireps() {
  return; // HIDDEN — uncomment body below to restore
  /* eslint-disable no-unreachable */
  const section = document.getElementById('pireps-section');
  const list    = document.getElementById('pireps-list');
  if (!section || !list) return;

  if (!store.flight) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const pirepsKey = store.flight.flightNumber && store.flight.date
    ? `${store.flight.flightNumber}_${store.flight.date}` : '';
  const saved = pirepsKey ? storage.getPireps(pirepsKey) : {};
  let currentCat = '';
  let html = '';

  for (const item of PIREPS) {
    if (item.cat !== currentCat) {
      if (currentCat) html += '</div>';
      html += `<div class="pirep-group"><div class="pirep-cat">${item.cat}</div>`;
      currentCat = item.cat;
    }
    const checked = !!saved[item.id];
    html += `
      <label class="pirep-item ${checked ? 'checked' : ''}" data-id="${item.id}">
        <input type="checkbox" class="pirep-cb" data-id="${item.id}" ${checked ? 'checked' : ''}>
        <span>${item.label}</span>
      </label>`;
  }
  html += '</div>';
  list.innerHTML = html;

  list.querySelectorAll('.pirep-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id    = cb.dataset.id;
      const state = storage.getPireps(pirepsKey);
      if (cb.checked) state[id] = true;
      else            delete state[id];
      storage.savePireps(pirepsKey, state);
      cb.closest('.pirep-item').classList.toggle('checked', cb.checked);
    });
  });

  document.getElementById('btn-reset-pireps').onclick = () => {
    if (pirepsKey) storage.savePireps(pirepsKey, {});
    _renderPireps();
  };
}

// ── Styles ────────────────────────────────────────────────────────

function _applyStyles() {
  if (document.getElementById('home-style')) return;
  const s = document.createElement('style');
  s.id = 'home-style';
  s.textContent = `
    /* ── 連線狀態細條 ── */
    .conn-strip {
      display: flex; align-items: center; gap: 18px;
      min-height: 36px; padding: 2px; margin-bottom: 14px;
    }
    .conn-item { display: flex; align-items: center; gap: 6px; }
    .conn-lbl  { font-size: 12px; font-weight: 600; letter-spacing: .3px; color: var(--text2); }
    .conn-retry { font-size: 11px; padding: 0 10px; margin-left: 2px; }

    /* ── ① 今日航班卡 ── */
    .tf-card { margin-bottom: 14px; }
    .tf-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .tf-flt  {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 22px; font-weight: 900; color: var(--gold); letter-spacing: -0.3px;
    }
    .tf-route { display: flex; align-items: center; gap: 6px; font-size: 17px; font-weight: 700; color: var(--text); }
    .tf-arrow { color: var(--text3); font-size: 13px; }
    .tf-date  {
      margin-left: auto; font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 13px; font-weight: 700; color: var(--text2);
    }
    .tf-times { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 14px; }
    .tf-tcol  { display: flex; flex-direction: column; gap: 1px; }
    .tf-tlbl  { font-size: 10px; font-weight: 700; letter-spacing: .6px; color: var(--text3); text-transform: uppercase; }
    .tf-tmain {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 18px; font-weight: 800; color: var(--text);
    }
    .tf-tsub  { font-family: 'JetBrains Mono', 'SF Mono', monospace; font-size: 11px; color: var(--text3); }
    .tf-open  { width: 100%; min-height: 48px; font-size: 15px; font-weight: 700; }

    /* pairing 摘要 */
    .tf-pairing-date { font-size: 16px; font-weight: 800; color: var(--text); }
    .tf-report { margin-left: auto; font-size: 12px; color: var(--text2); }
    .tf-legs { display: flex; flex-direction: column; gap: 2px; margin-bottom: 14px; }
    .tf-leg  {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 0; border-bottom: 1px solid var(--border);
    }
    .tf-leg:last-child { border-bottom: none; }
    .tf-leg-fn  { font-family: 'JetBrains Mono', 'SF Mono', monospace; font-size: 14px; font-weight: 800; color: var(--text); min-width: 62px; }
    .tf-leg-rt  { font-family: 'JetBrains Mono', 'SF Mono', monospace; font-size: 13px; color: var(--text2); }
    .tf-leg-std { margin-left: auto; font-family: 'JetBrains Mono', 'SF Mono', monospace; font-size: 13px; color: var(--text3); }

    .tf-empty { font-size: 13px; color: var(--text3); padding: 6px 2px 14px; }

    .pirep-group { margin-bottom: 12px; }
    .pirep-group:last-child { margin-bottom: 0; }
    .pirep-cat {
      font-size: 11px; font-weight: 700; letter-spacing: 0.7px;
      color: var(--text3); text-transform: uppercase; margin-bottom: 6px;
    }
    .pirep-item {
      display: flex; align-items: center; gap: 10px;
      min-height: 44px; padding: 8px 4px; border-bottom: 1px solid var(--border);
      cursor: pointer; color: var(--text); font-size: 13px;
      transition: color 0.15s;
    }
    .pirep-item:last-child { border-bottom: none; }
    .pirep-item.checked { color: var(--text3); text-decoration: line-through; }
    .pirep-item input[type=checkbox] { accent-color: var(--accent); width: 16px; height: 16px; }
  `;
  document.head.appendChild(s);
}
