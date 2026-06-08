// Roster tab — PegaSys 班表整合（Worker proxy）
import storage from '../services/storage.js';
import { showToast } from '../utils.js';

const MY_STAFF_ID = '2317073';
const WORKER_URL  = 'https://jx-briefing.karsten77114.workers.dev';
const CREDS_KEY   = 'pegasys_creds';
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ── Credential helpers ────────────────────────────────────────────

function getCreds() { return storage.get(CREDS_KEY, null); }
function saveCreds(employeeId, password) { storage.set(CREDS_KEY, { employeeId, password }); }
function clearCreds() { storage.set(CREDS_KEY, null); }

// ── Roster storage ────────────────────────────────────────────────

export function getRoster() {
  return (storage.get('roster', []) || [])
    .filter(p => _isFuture(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function savePairing(pairing) {
  const list = (storage.get('roster', []) || []).filter(p => p.date !== pairing.date);
  list.push(pairing);
  storage.set('roster', list);
}

// ── Date helpers ──────────────────────────────────────────────────

function _formatDate(d) {
  const m = parseInt(d.slice(4, 6), 10);
  return `${d.slice(6, 8)} ${MONTHS[m - 1]} ${d.slice(0, 4)}`;
}

function _isToday(d) {
  const n = new Date();
  const t = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
  return d === t;
}

function _isFuture(d) {
  const n = new Date();
  const t = `${n.getFullYear()}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}`;
  return d >= t;
}

function _blockStr(min) {
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m`;
}

// ── Crew renderer ─────────────────────────────────────────────────

function _crewHtml(crew) {
  if (!crew?.length) return '';
  const show = crew.filter(c =>
    ['CAP', 'FO', 'TFO', 'SO', 'SFO', 'PFO'].includes(c.rank) || c.position === 'CIC'
  );
  if (!show.length) return '';
  return `<div style="margin-top:10px;border-top:1px solid var(--border-subtle);padding-top:10px">
    ${show.map(c => {
      const isMe  = c.staffId === MY_STAFF_ID;
      const isCIC = c.position === 'CIC';
      const label = isCIC ? 'Purser' : c.rank;
      const name  = `${c.firstName} ${c.lastName}`;
      return `<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-subtle)">
        <span style="width:52px;font-size:11px;color:${isCIC ? '#f59e0b' : 'var(--text-dim)'};font-weight:600;flex-shrink:0">${label}</span>
        <span style="font-size:13px;${isMe ? 'color:var(--accent);font-weight:700' : ''}">${name}${isMe ? ' ★' : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Pairing card ──────────────────────────────────────────────────

function _pairingCard(p) {
  const dateLabel = _formatDate(p.date) + (_isToday(p.date) ? ' — Today' : '');

  const legs = (p.legs || []).map(lg => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:15px;letter-spacing:.5px">${lg.flightNumber}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px">
          ${lg.dep} → ${lg.dest} &nbsp;·&nbsp; ${lg.std_local}→${lg.sta_local}L &nbsp;·&nbsp; ${_blockStr(lg.blockTime)}
        </div>
        <div style="font-size:11px;color:var(--text-faint);margin-top:1px">STD ${lg.std_utc}Z · STA ${lg.sta_utc}Z</div>
      </div>
      <button class="btn btn-primary btn-sm"
              data-load-fn="${lg.flightNumber.replace(/^JX/i, '')}"
              data-load-date="${p.date}"
              style="font-size:12px;padding:5px 12px;white-space:nowrap;flex-shrink:0">
        Load ✈
      </button>
    </div>`).join('');

  return `<div class="card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div>
        <div style="font-weight:700;font-size:15px">${dateLabel}</div>
        ${p.reportTime ? `<div style="font-size:12px;color:var(--text-dim);margin-top:2px">Report ${p.reportAirport} ${p.reportTime}L</div>` : ''}
      </div>
      <button class="roster-del-btn" data-del-date="${p.date}"
              style="background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:20px;padding:0 2px;line-height:1">×</button>
    </div>
    ${legs}
    ${_crewHtml(p.crew)}
  </div>`;
}

// ── Raw WS event debug card ───────────────────────────────────────

function _debugCard(wsEvents) {
  if (!wsEvents?.length) return '';
  const summary = wsEvents.map(e => `<b>${e.event}</b>: ${JSON.stringify(e.data).slice(0, 120)}...`).join('<br>');
  return `<div class="card" style="margin-bottom:14px;border:1px solid #f59e0b">
    <div style="font-weight:700;font-size:13px;color:#f59e0b;margin-bottom:8px">🔍 WS Debug — ${wsEvents.length} events received</div>
    <div style="font-size:11px;color:var(--text-dim);line-height:1.8;word-break:break-all">${summary}</div>
    <div style="font-size:11px;color:var(--text-faint);margin-top:8px">
      Event names visible above — update <code>_parseRosterEvents()</code> in worker.js once structure is known.
    </div>
  </div>`;
}

// ── Login form ────────────────────────────────────────────────────

function _renderLogin(container, onSuccess) {
  container.innerHTML = `<div class="view-content">
    <div class="section-title" style="margin-bottom:14px">Roster</div>
    <div class="card" style="max-width:360px">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px">PegaSys 登入</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:16px;line-height:1.5">
        帳密僅存於此裝置，由 Cloudflare Worker 代理存取班表。
      </div>
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px">員工編號</label>
        <input id="pg-uid" type="text" inputmode="numeric" autocomplete="username"
               placeholder="2317073" maxlength="10"
               style="width:160px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;
                      background:var(--bg-card);color:var(--text);font-size:14px">
      </div>
      <div style="margin-bottom:20px">
        <label style="display:block;font-size:12px;color:var(--text-dim);margin-bottom:4px">密碼</label>
        <input id="pg-pw" type="password" autocomplete="current-password"
               placeholder="••••••••" maxlength="64"
               style="width:200px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;
                      background:var(--bg-card);color:var(--text);font-size:14px">
      </div>
      <div id="pg-err" style="display:none;font-size:12px;color:#ef4444;margin-bottom:12px"></div>
      <button id="pg-login-btn" class="btn btn-primary"
              style="padding:10px 24px;font-size:14px;font-weight:700">登入</button>
    </div>
  </div>`;

  const uidInput = container.querySelector('#pg-uid');
  const pwInput  = container.querySelector('#pg-pw');
  const errEl    = container.querySelector('#pg-err');
  const loginBtn = container.querySelector('#pg-login-btn');

  const doLogin = async () => {
    const employeeId = uidInput.value.trim();
    const password   = pwInput.value;
    if (!employeeId) { uidInput.focus(); return; }
    if (!password)   { pwInput.focus();  return; }

    loginBtn.disabled = true;
    loginBtn.textContent = '驗證中…';
    errEl.style.display = 'none';

    try {
      const resp = await fetch(`${WORKER_URL}/pegasys/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, password }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        errEl.textContent = data.error === 'invalid_credentials' ? '帳號或密碼錯誤' : `錯誤：${data.error}`;
        errEl.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.textContent = '登入';
        return;
      }
      saveCreds(employeeId, password);
      showToast('✅ 登入成功，正在取得班表…');
      onSuccess(employeeId, password);
    } catch (e) {
      errEl.textContent = `連線失敗：${e.message}`;
      errEl.style.display = 'block';
      loginBtn.disabled = false;
      loginBtn.textContent = '登入';
    }
  };

  loginBtn.addEventListener('click', doLogin);
  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  uidInput.addEventListener('keydown', e => { if (e.key === 'Enter') pwInput.focus(); });
}

// ── Roster fetch from Worker ──────────────────────────────────────

async function _fetchRoster(employeeId, password) {
  const resp = await fetch(`${WORKER_URL}/pegasys/roster`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, password }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ── Main render ───────────────────────────────────────────────────

let _fetchingRoster = false;

function _render(container, opts = {}) {
  const { loading = false, wsResult = null, error = null } = opts;
  const pairings = getRoster();
  const creds    = getCreds();

  const headerHtml = creds ? `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div class="section-title" style="margin-bottom:0">Roster</div>
      <div style="display:flex;gap:8px;align-items:center">
        ${loading
          ? `<span style="font-size:12px;color:var(--text-dim)">取得中…</span>
             <div class="spinner" style="width:16px;height:16px;border-width:2px"></div>`
          : `<button id="roster-refresh-btn" class="btn btn-ghost btn-sm" style="font-size:12px">↻ 更新</button>`}
        <button id="roster-logout-btn" class="btn btn-ghost btn-sm"
                style="font-size:11px;color:var(--text-faint)">登出</button>
      </div>
    </div>` : '';

  const debugHtml = wsResult?.debug ? _debugCard(wsResult.ws_events) : '';

  const staleHtml = wsResult?.stale ? `
    <div style="font-size:11px;color:#f59e0b;margin-bottom:10px;padding:6px 10px;background:rgba(245,158,11,.1);border-radius:6px">
      ⚠ 離線快取 (${wsResult.cached_at?.slice(0, 16)?.replace('T', ' ')} UTC) — ${wsResult.ws_error || ''}
    </div>` : '';

  const errorHtml = error ? `
    <div style="font-size:12px;color:#ef4444;margin-bottom:12px;padding:8px 10px;background:rgba(239,68,68,.1);border-radius:6px">
      ❌ ${error}
    </div>` : '';

  let bodyHtml;
  if (!creds) {
    // Will be replaced by login form
    bodyHtml = '';
  } else if (pairings.length === 0 && !loading && !debugHtml) {
    bodyHtml = `<div class="card" style="text-align:center;padding:40px 20px">
      <div style="font-size:40px;margin-bottom:14px">📅</div>
      <div style="font-weight:600;font-size:15px;margin-bottom:8px">尚無班表資料</div>
      <div style="font-size:13px;color:var(--text-dim)">點擊右上角「↻ 更新」取得最新班表</div>
    </div>`;
  } else {
    bodyHtml = pairings.map(_pairingCard).join('');
  }

  container.innerHTML = `<div class="view-content">
    ${headerHtml}
    ${errorHtml}
    ${staleHtml}
    ${debugHtml}
    ${bodyHtml}
  </div>`;

  if (!creds) {
    _renderLogin(container, (employeeId, password) => {
      _doFetch(container, employeeId, password);
    });
    return;
  }

  // Event delegation
  container.querySelectorAll('[data-load-fn]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('kb-load-flight', {
        detail: { fn: btn.dataset.loadFn, date: btn.dataset.loadDate }
      }));
    });
  });
  container.querySelectorAll('.roster-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const list = (storage.get('roster', []) || []).filter(p => p.date !== btn.dataset.delDate);
      storage.set('roster', list);
      showToast('已移除');
      _render(container);
    });
  });

  container.querySelector('#roster-refresh-btn')?.addEventListener('click', () => {
    const c = getCreds();
    if (c) _doFetch(container, c.employeeId, c.password);
  });
  container.querySelector('#roster-logout-btn')?.addEventListener('click', () => {
    clearCreds();
    showToast('已登出 PegaSys');
    _render(container);
  });
}

async function _doFetch(container, employeeId, password) {
  if (_fetchingRoster) return;
  _fetchingRoster = true;
  _render(container, { loading: true });

  try {
    const result = await _fetchRoster(employeeId, password);

    // If we got properly parsed pairings (no _raw_event), save them
    if (result.pairings?.length > 0 && !result.pairings[0]._raw_event) {
      result.pairings.forEach(p => { if (p.date && p.legs) savePairing(p); });
      showToast(`✅ 班表已更新（${result.pairings.length} 筆）`);
    } else if (result.ws_events?.length > 0) {
      showToast(`📡 收到 ${result.ws_events.length} 個 WS 事件（debug 模式）`);
    } else {
      showToast('⚠ 未收到班表資料');
    }

    _render(container, { wsResult: result });
  } catch (e) {
    if (e.message === 'invalid_credentials') {
      clearCreds();
      showToast('❌ 帳號或密碼已失效，請重新登入');
      _render(container);
    } else {
      showToast(`❌ ${e.message}`);
      _render(container, { error: e.message });
    }
  } finally {
    _fetchingRoster = false;
  }
}

// ── Public API ────────────────────────────────────────────────────

export function mount(container) {
  const creds = getCreds();
  _render(container);
  // Auto-fetch if credentials are saved
  if (creds) {
    _doFetch(container, creds.employeeId, creds.password);
  }
}

export function unmount(_container) {
  _fetchingRoster = false;
}
