import store from '../store.js';
import storage from '../services/storage.js';
import { lidoLogin, elbLogin, ensureLido, fetchBriefing, fetchFlightList, preloadElbForFlight, preloadMetarForFlight } from '../services/api.js';
import { showToast, fuelStr, todayStr, toICAO } from '../utils.js';

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

let pirepsKey = '';

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
              <div class="conn-status" id="status-lido">未登入</div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-lido-login">登入 Login</button>
        </div>
        <hr class="divider">
        <div class="conn-row" id="conn-elb">
          <div class="conn-left">
            <span class="dot dot-grey" id="dot-elb"></span>
            <div>
              <div class="conn-name">ELB</div>
              <div class="conn-status" id="status-elb">未登入</div>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-elb-login">登入 Login</button>
        </div>
      </div>

      <!-- Flight Search -->
      <div class="section-title">航班查詢 Flight Search</div>
      <div class="card">
        <div class="search-row">
          <input class="input input-upper" id="s-flight" placeholder="班號 850" maxlength="4" style="width:90px">
          <input class="input" id="s-date" type="date" style="width:148px">
          <input class="input input-upper" id="s-dep" placeholder="DEP" maxlength="4" style="width:64px;text-align:center">
          <span style="color:var(--text3);font-size:16px">→</span>
          <input class="input input-upper" id="s-dest" placeholder="DEST" maxlength="4" style="width:64px;text-align:center">
          <button class="btn btn-primary" id="btn-search">查詢 Query</button>
        </div>
        <div class="err-msg hidden" id="search-err"></div>
        <div id="search-loading" class="hidden" style="display:flex;align-items:center;gap:10px;margin-top:12px;color:var(--text2);font-size:13px">
          <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
          <span id="search-loading-msg">正在查詢…</span>
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

    </div>

    <!-- LIDO Auth Modal -->
    <div class="overlay hidden" id="modal-lido">
      <div class="modal">
        <div class="modal-title">🔐 LIDO 登入</div>
        <div class="modal-sub">憑證儲存於本裝置，不會上傳第三方。</div>
        <div class="err-msg hidden" id="lido-err"></div>
        <div class="form-group">
          <label class="form-label">LIDO User ID</label>
          <input class="input" id="lido-user" type="text" placeholder="例：2317073">
        </div>
        <div class="form-group">
          <label class="form-label">密碼</label>
          <input class="input" id="lido-pass" type="password">
        </div>
        <div class="modal-btns">
          <button class="btn btn-ghost" id="btn-lido-cancel">取消</button>
          <button class="btn btn-primary" id="btn-lido-submit">登入</button>
        </div>
      </div>
    </div>

    <!-- ELB Auth Modal -->
    <div class="overlay hidden" id="modal-elb">
      <div class="modal">
        <div class="modal-title">🔐 ELB 登入</div>
        <div class="modal-sub">ELB 帳號與 LIDO 帳號各自獨立。</div>
        <div class="err-msg hidden" id="elb-err"></div>
        <div class="form-group">
          <label class="form-label">ELB User ID</label>
          <input class="input" id="elb-user" type="text">
        </div>
        <div class="form-group">
          <label class="form-label">密碼</label>
          <input class="input" id="elb-pass" type="password">
        </div>
        <div class="modal-btns">
          <button class="btn btn-ghost" id="btn-elb-cancel">取消</button>
          <button class="btn btn-primary" id="btn-elb-submit">登入</button>
        </div>
      </div>
    </div>
  `;

  _applyStyles();
  _initSearch();
  _initAuth();
  _renderAuthStatus();
  _renderPireps();

  // Re-render connection status when store updates
  const unsub = store.subscribe(() => {
    _renderAuthStatus();
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
  const { status, userId } = store.auth[system];
  const dot = document.getElementById(`dot-${system}`);
  const txt = document.getElementById(`status-${system}`);
  const btn = document.getElementById(`btn-${system}-login`);
  if (!dot) return;

  const map = {
    ok:         { cls: 'dot-green',  label: userId || '已登入', btnTxt: '重新登入' },
    connecting: { cls: 'dot-yellow', label: '連線中…',         btnTxt: '取消' },
    expired:    { cls: 'dot-yellow', label: '需重新登入',       btnTxt: '登入' },
    error:      { cls: 'dot-red',    label: '連線失敗',         btnTxt: '重試' },
    idle:       { cls: 'dot-grey',   label: '未登入',           btnTxt: '登入 Login' },
  };
  const m = map[status] || map.idle;
  dot.className = `dot ${m.cls}`;
  txt.textContent = m.label;
  if (btn) btn.textContent = m.btnTxt;
}

function _initAuth() {
  // Restore stored sessions into store on mount
  const lido = storage.getLidoCredentials();
  if (lido.token && lido.userId) {
    store.setAuth('lido', { token: lido.token, userId: lido.userId, status: 'ok' });
  } else if (lido.userId) {
    store.setAuth('lido', { status: 'expired' });
  }
  const elb = storage.getELBCredentials();
  if (elb.token && elb.userId) {
    store.setAuth('elb', { token: elb.token, userId: elb.userId, status: 'ok' });
  }

  // LIDO modal
  document.getElementById('btn-lido-login').onclick = () => _openModal('lido');
  document.getElementById('btn-lido-cancel').onclick = () => _closeModal('lido');
  document.getElementById('btn-lido-submit').onclick = () => _doLogin('lido');

  // ELB modal
  document.getElementById('btn-elb-login').onclick = () => _openModal('elb');
  document.getElementById('btn-elb-cancel').onclick = () => _closeModal('elb');
  document.getElementById('btn-elb-submit').onclick = () => _doLogin('elb');
}

function _openModal(system) {
  const creds = system === 'lido' ? storage.getLidoCredentials() : storage.getELBCredentials();
  document.getElementById(`${system}-user`).value = creds.userId || '';
  document.getElementById(`${system}-pass`).value = '';
  document.getElementById(`${system}-err`).classList.add('hidden');
  document.getElementById(`modal-${system}`).classList.remove('hidden');
  setTimeout(() => {
    const field = creds.userId ? `${system}-pass` : `${system}-user`;
    document.getElementById(field)?.focus();
  }, 60);
}

function _closeModal(system) {
  document.getElementById(`modal-${system}`).classList.add('hidden');
}

async function _doLogin(system) {
  const userId = document.getElementById(`${system}-user`).value.trim();
  const pass   = document.getElementById(`${system}-pass`).value;
  const errEl  = document.getElementById(`${system}-err`);
  const btn    = document.getElementById(`btn-${system}-submit`);

  if (!userId || !pass) {
    errEl.textContent = '請填寫帳號與密碼';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');
  btn.textContent = '登入中…'; btn.disabled = true;
  store.setAuth(system, { status: 'connecting' });

  try {
    const fn = system === 'lido' ? lidoLogin : elbLogin;
    const token = await fn(userId, pass);
    if (system === 'lido') storage.saveLidoSession(userId, pass, token);
    else                   storage.saveELBSession(userId, pass, token);
    store.setAuth(system, { token, userId, status: 'ok' });
    _closeModal(system);
    showToast(`✅ ${system.toUpperCase()} 登入成功`);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
    store.setAuth(system, { status: 'error' });
  } finally {
    btn.textContent = '登入'; btn.disabled = false;
  }
}

// ── Flight Search ─────────────────────────────────────────────────

function _initSearch() {
  const dateEl = document.getElementById('s-date');
  dateEl.value = todayStr();

  const last = storage.getLastSearch();
  if (last.flight) document.getElementById('s-flight').value = last.flight;
  if (last.dep)    document.getElementById('s-dep').value    = last.dep;
  if (last.dest)   document.getElementById('s-dest').value   = last.dest;

  document.getElementById('btn-search').onclick = _doSearch;
  ['s-flight','s-date','s-dep','s-dest'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') _doSearch(); });
  });
}

async function _doSearch() {
  const flight = document.getElementById('s-flight').value.trim().replace(/^JX/i, '');
  const date   = document.getElementById('s-date').value;
  const dep    = document.getElementById('s-dep').value.trim().toUpperCase();
  const dest   = document.getElementById('s-dest').value.trim().toUpperCase();
  const errEl  = document.getElementById('search-err');
  const loadEl = document.getElementById('search-loading');
  const loadMsg = document.getElementById('search-loading-msg');

  if (!flight) { _showSearchErr('請輸入班號'); return; }
  if (!date)   { _showSearchErr('請選擇日期'); return; }

  errEl.classList.add('hidden');
  loadEl.classList.remove('hidden');
  document.getElementById('btn-search')?.setAttribute('disabled', '');

  storage.saveLastSearch({ flight, dep, dest });

  const ready = await ensureLido();
  if (!ready) {
    loadEl?.classList.add('hidden');
    document.getElementById('btn-search')?.removeAttribute('disabled');
    _showSearchErr('請先登入 LIDO');
    _openModal('lido');
    return;
  }

  loadMsg.textContent = `正在從 LIDO 取得 JX${flight}…`;

  try {
    const data = await fetchBriefing(flight, date, dep, dest);
    store.setBriefing(data);

    // Build flight summary for top bar
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

    pirepsKey = `${data.flightNumber}_${data.date}`;
    _renderPireps();
    showToast(`✅ JX${flight} 資料已載入`);

    // 背景預載 ELB 資料（不阻塞主流程）
    const reg = data.aircraft?.registration || data.ofp?.reg || '';
    if (reg && store.auth.elb.status === 'ok') {
      preloadElbForFlight(reg).catch(() => {});
    }

    // 背景預載所有相關機場 METAR/TAF（不阻塞主流程）
    const wxApts = [
      data.dep,
      data.dest,
      data.ofp?.altnApt || data.ofp?.altn || data.altn || data.alternate,
      ...(data.wxAirports || []),
    ].filter(Boolean).map(toICAO);
    preloadMetarForFlight([...new Set(wxApts)]).catch(() => {});
  } catch (e) {
    if (e.message === 'session_expired') {
      _showSearchErr('LIDO session 過期，請重新登入');
      _openModal('lido');
    } else {
      _showSearchErr(e.message);
    }
  } finally {
    loadEl?.classList.add('hidden');
    document.getElementById('btn-search')?.removeAttribute('disabled');
  }
}

function _showSearchErr(msg) {
  const el = document.getElementById('search-err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── PIREPS ────────────────────────────────────────────────────────

function _renderPireps() {
  const section = document.getElementById('pireps-section');
  const list    = document.getElementById('pireps-list');
  if (!section || !list) return;

  if (!store.flight) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

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
    storage.savePireps(pirepsKey, {});
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

    .search-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    }

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

