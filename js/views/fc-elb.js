import store from '../store.js';
import storage from '../services/storage.js';
import { elbQuery, getMELFull, getNTCFull, getFlightDetails, calcExpireDays, preloadElbForFlight } from '../services/api.js';

export function mount(container) {
  _render(container);
  container._unsub = store.subscribe(() => _render(container));
}

export function unmount(container) {
  if (container._unsub) container._unsub();
}

function _render(container) {
  const elbStatus = store.auth.elb.status;

  if (elbStatus !== 'ok') {
    container.innerHTML = `
      <div class="view-content">
        <div class="state-screen">
          <div class="state-icon">🔌</div>
          <div class="state-title">ELB 尚未登入</div>
          <div class="state-sub">請在主畫面連線中心登入 ELB，即可查詢 MEL 暫緩故障與飛行記錄。</div>
        </div>
      </div>`;
    return;
  }

  // Preserve user-typed reg across store re-renders
  const savedInputVal = document.getElementById('elb-reg')?.value?.trim() || null;
  const storeReg = store.flight?.reg || store.briefing?.aircraft?.registration || store.briefing?.ofp?.reg || '';
  const reg = savedInputVal || storeReg;

  container.innerHTML = `
    <div class="view-content">

      <div class="section-title">飛機查詢</div>
      <div class="card">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="input input-upper" id="elb-reg" placeholder="機號 B-XXXXX" style="width:150px"
                 value="${reg}" maxlength="8">
          <button class="btn btn-primary btn-sm" id="btn-elb-query">查詢 MEL</button>
        </div>
      </div>

      <div id="elb-loading" class="hidden" style="display:none;align-items:center;gap:10px;padding:20px 0;color:var(--text2);font-size:13px">
        <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
        <span id="elb-loading-msg">查詢中…</span>
      </div>

      <div id="elb-err-msg" class="err-msg hidden" style="margin-top:12px"></div>

      <div id="elb-result" class="hidden">

        <!-- 飛機資訊 -->
        <div class="card" style="margin-top:0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <div>
              <div style="font-size:22px;font-weight:800;color:var(--blue)" id="elb-ac-reg">—</div>
              <div style="font-size:12px;color:var(--text2);margin-top:2px" id="elb-ac-type">—</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <div id="elb-mel-badge" style="display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700">—</div>
              <div id="elb-inflight" class="hidden" style="font-size:11px;padding:3px 8px;border-radius:12px;background:rgba(34,197,94,.2);color:var(--green);font-weight:700">✈ 飛行中</div>
            </div>
          </div>

          <div class="section-title" style="margin-top:4px">MEL 暫緩故障</div>
          <div id="elb-mel-list">
            <div style="color:var(--text3);font-size:13px;padding:12px 0;text-align:center">載入中…</div>
          </div>
        </div>

        <!-- Notices to Crew -->
        <div class="card">
          <div class="section-title" style="margin-top:0">Notices to Crew</div>
          <div id="elb-ntc-list">
            <div style="color:var(--text3);font-size:13px;padding:8px 0;text-align:center">載入中…</div>
          </div>
        </div>

        <!-- 最近飛行記錄 -->
        <div class="card">
          <div class="section-title" style="margin-top:0">最近飛行記錄</div>
          <div id="elb-history">
            <div style="color:var(--text3);font-size:13px;padding:8px 0;text-align:center">載入中…</div>
          </div>
        </div>

      </div>

    </div>`;

  // If store already has data for this reg, render immediately
  const cached = store.elbData;
  if (cached && cached.reg === _normalizeReg(reg)) {
    if (cached.loading) {
      _setLoading(true, `載入 ${cached.reg} 中…`);
    } else if (cached.error) {
      _showErr(`查詢失敗：${cached.error}`);
    } else {
      _showResult(true);
      document.getElementById('elb-ac-reg').textContent  = cached.reg;
      document.getElementById('elb-ac-type').textContent = `${cached.fleetType || 'STARLUX'} · STARLUX`;
      document.getElementById('elb-inflight').classList.toggle('hidden', !cached.inFlight);
      _renderMEL(cached.mel || []);
      _renderNTC(cached.ntc || []);
      _renderFlights(cached.flights || []);
    }
  } else if (reg) {
    _query(_normalizeReg(reg));
  }

  document.getElementById('btn-elb-query')?.addEventListener('click', () => {
    const r = _normalizeReg(document.getElementById('elb-reg')?.value.trim().toUpperCase());
    if (r) _query(r);
  });

  document.getElementById('elb-reg')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _query(_normalizeReg(e.target.value.trim().toUpperCase()));
  });
}

// ── Query ──────────────────────────────────────────────────────────

async function _query(reg) {
  reg = _normalizeReg(reg);
  const regInput = document.getElementById('elb-reg');
  if (regInput) regInput.value = reg;

  _setLoading(true, `查詢 ${reg}…`);
  _showResult(false);
  _showErr('');

  try {
    await preloadElbForFlight(reg);
    const d = store.elbData;
    if (!d || d.error) throw new Error(d?.error || '查詢失敗');

    _setLoading(false);
    _showResult(true);
    document.getElementById('elb-ac-reg').textContent  = d.reg;
    document.getElementById('elb-ac-type').textContent = `${d.fleetType || 'STARLUX'} · STARLUX`;
    document.getElementById('elb-inflight').classList.toggle('hidden', !d.inFlight);
    _renderMEL(d.mel || []);
    _renderNTC(d.ntc || []);
    _renderFlights(d.flights || []);
  } catch (err) {
    _setLoading(false);
    _showResult(false);
    _showErr(`查詢失敗：${err.message}`);
  }
}

// ── Render ─────────────────────────────────────────────────────────

function _renderMEL(logs) {
  const el    = document.getElementById('elb-mel-list');
  const badge = document.getElementById('elb-mel-badge');
  if (!el) return;

  if (!logs.length) {
    el.innerHTML = '<div style="color:var(--green);font-size:13px;padding:12px 0;text-align:center">✓ 無暫緩故障</div>';
    badge.style.cssText = 'background:rgba(34,197,94,.2);color:var(--green)';
    badge.textContent = '0 MEL';
    return;
  }

  badge.style.cssText = 'background:rgba(245,158,11,.2);color:var(--accent)';
  badge.textContent = `${logs.length} MEL`;

  const sorted = [...logs].sort((a, b) => (a._expireDays ?? Infinity) - (b._expireDays ?? Infinity));

  el.innerHTML = sorted.map(m => {
    const desc   = m.faultDescription || m.defectDescription || '（無描述）';
    const cat    = m._category || '';
    const days   = m._expireDays;
    const expCls = days != null ? (days <= 7 ? 'urgent' : days <= 30 ? 'warn' : 'ok') : '';
    const expHtml = days != null
      ? `<span style="font-size:11px;padding:1px 7px;border-radius:10px;${_expStyle(expCls)}">到期 ${days} 天</span>` : '';
    const catHtml = cat
      ? `<span style="font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;${_catStyle(cat)}">Cat ${cat}</span>` : '';
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        ${m._melCode ? `<div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:3px">MEL ${m._melCode}</div>` : ''}
        <div style="font-size:13px;color:var(--text)">${desc}</div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:4px">
          ${m.deferralRefNum ? `<span style="font-size:11px;color:var(--text3)">REF ${m.deferralRefNum}</span>` : ''}
          ${catHtml}${expHtml}
        </div>
      </div>`;
  }).join('');
}

function _renderNTC(ntcs) {
  const el = document.getElementById('elb-ntc-list');
  if (!el) return;
  if (!ntcs.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;text-align:center">無 Notices to Crew</div>';
    return;
  }
  el.innerHTML = ntcs.map(n => {
    const expHtml = n._expireDays != null
      ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;${_expStyle(n._expireDays <= 3 ? 'urgent' : n._expireDays <= 14 ? 'warn' : 'ok')}">到期 ${n._expireDays} 天</span>` : '';
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:13px;font-weight:700;color:var(--accent)">${n._title}</span>
          ${expHtml}
        </div>
        <div style="font-size:12px;color:var(--text2);white-space:pre-wrap;line-height:1.5">${n._text}</div>
      </div>`;
  }).join('');
}

function _renderFlights(flights) {
  const el = document.getElementById('elb-history');
  if (!el) return;
  if (!flights.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0;text-align:center">無飛行記錄</div>';
    return;
  }
  el.innerHTML = flights.map(f => {
    const route    = `${f.originStationCode || '???'} → ${f.destinationStationCode || '???'}`;
    const dep      = _fmtDate(f.oooiOff?.actual || f.oooiOut?.actual || f.actualDepartureTime);
    const autoland = f._autoland
      ? '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(96,165,250,.2);color:var(--blue)">AUTOLAND</span>' : '';
    const defects  = f._defects?.length
      ? `<div style="margin-top:5px;display:flex;flex-direction:column;gap:3px">${f._defects.map(d => {
          const isCL = d.recordName?.startsWith('CL');
          return `<div style="font-size:11px;padding:4px 8px;border-radius:0 4px 4px 0;background:rgba(255,255,255,.04);border-left:2px solid ${isCL ? 'rgba(96,165,250,.5)' : 'rgba(251,191,36,.5)'}">
            <span style="font-weight:700;color:${isCL ? 'var(--blue)' : 'var(--accent)'}">${d.recordName || ''}</span>
            <span style="color:var(--text);font-weight:600"> ${d.faultDescription}</span>
            ${d._actionDesc ? `<div style="color:var(--text3);font-size:10.5px;margin-top:1px">▶ ${d._actionDesc}</div>` : ''}
          </div>`;
        }).join('')}</div>` : '';
    return `
      <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;font-weight:700;color:var(--accent);width:56px;flex-shrink:0">${f.flightNum || '—'}</div>
        <div style="flex:1">
          <div style="font-size:14px;color:var(--text);display:flex;align-items:center;gap:6px">${route} ${autoland}</div>
          <div style="font-size:11px;color:var(--text2)">${dep}</div>
          ${defects}
        </div>
      </div>`;
  }).join('');
}

// ── Style Helpers ──────────────────────────────────────────────────

function _expStyle(cls) {
  const map = {
    urgent: 'background:rgba(239,68,68,.2);color:var(--red)',
    warn:   'background:rgba(245,158,11,.2);color:var(--accent)',
    ok:     'background:rgba(148,163,184,.15);color:var(--text2)',
  };
  return map[cls] || map.ok;
}

function _catStyle(cat) {
  const map = {
    A: 'background:rgba(239,68,68,.3);color:var(--red)',
    B: 'background:rgba(245,158,11,.3);color:var(--accent)',
    C: 'background:rgba(250,204,21,.3);color:#fbbf24',
    D: 'background:rgba(148,163,184,.2);color:var(--text2)',
  };
  return map[cat] || map.D;
}

function _setLoading(on, msg = '') {
  const el  = document.getElementById('elb-loading');
  const txt = document.getElementById('elb-loading-msg');
  if (!el) return;
  el.style.display = on ? 'flex' : 'none';
  if (txt && msg) txt.textContent = msg;
}

function _showResult(on) {
  document.getElementById('elb-result')?.classList.toggle('hidden', !on);
}

function _showErr(msg) {
  const el = document.getElementById('elb-err-msg');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function _normalizeReg(raw) {
  return raw.replace(/^(B)([0-9]{5})$/, '$1-$2');
}

function _fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
}
