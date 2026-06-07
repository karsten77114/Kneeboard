import store from '../store.js';
import storage from '../services/storage.js';
import { ensureLido, elbLogin, verifySessions } from '../services/api.js';
import { showToast } from '../utils.js';
import { mountNoticeBoard } from './notice-board.js';

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

      <!-- Connection Center -->
      <div class="section-title">連線中心 Connection Hub</div>
      <div class="card" id="conn-center">
        <div class="conn-row" id="conn-lido">
          <div class="conn-left">
            <span class="dot dot-grey" id="dot-lido"></span>
            <div>
              <div class="conn-name">LIDO</div>
              <div class="conn-status" id="status-lido">連線中…</div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm hidden" id="btn-lido-retry">重新連線</button>
        </div>
        <hr class="divider">
        <div class="conn-row" id="conn-elb">
          <div class="conn-left">
            <span class="dot dot-grey" id="dot-elb"></span>
            <div>
              <div class="conn-name">ELB</div>
              <div class="conn-status" id="status-elb">連線中…</div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm hidden" id="btn-elb-retry">重新連線</button>
        </div>
      </div>

      <!-- PIREPS -->
      <div id="pireps-section" class="hidden">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="section-title" style="margin-bottom:0">PIREPS 飛行前檢查</div>
          <button class="btn btn-ghost btn-sm" id="btn-reset-pireps">重置</button>
        </div>
        <div class="card" style="margin-top:10px" id="pireps-list"></div>
      </div>

      <!-- Notice Board -->
      <div id="notice-board-mount"></div>

    </div>
  `;

  _applyStyles();

  mountNoticeBoard(container.querySelector('#notice-board-mount'));

  _initAuth();
  _renderAuthStatus();
  _renderPireps();

  const unsub = store.subscribe(() => {
    _renderAuthStatus();
    _renderPireps();
  });
  container._unsub = unsub;
}

export function unmount(container) {
  if (container._unsub) container._unsub();
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
  txt.textContent = m.label;
  // 只有失敗時才顯示重新連線按鈕
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
    .conn-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .conn-left {
      display: flex; align-items: center; gap: 10px;
    }
    .conn-name   { font-size: 14px; font-weight: 700; }
    .conn-status { font-size: 12px; color: var(--text2); margin-top: 1px; }

    .pirep-group { margin-bottom: 12px; }
    .pirep-group:last-child { margin-bottom: 0; }
    .pirep-cat {
      font-size: 11px; font-weight: 700; letter-spacing: 0.7px;
      color: var(--text3); text-transform: uppercase; margin-bottom: 6px;
    }
    .pirep-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 4px; border-bottom: 1px solid var(--border);
      cursor: pointer; color: var(--text); font-size: 13px;
      transition: color 0.15s;
    }
    .pirep-item:last-child { border-bottom: none; }
    .pirep-item.checked { color: var(--text3); text-decoration: line-through; }
    .pirep-item input[type=checkbox] { accent-color: var(--accent); width: 16px; height: 16px; }
  `;
  document.head.appendChild(s);
}
