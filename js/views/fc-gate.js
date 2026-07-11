// fc-gate.js — Gate Info (Ops Snapshot Card)
// 台灣機場：TDX 運輸資料流通服務（即時）
// 全球機場：AeroDataBox via RapidAPI
import { fetchGate } from '../services/api.js';
import store from '../store.js';

// 台灣時間今天 YYYY-MM-DD
function _twToday(offset = 0) {
  const d = new Date(Date.now() + 8 * 3600000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

export function mount(container) {
  const f          = store.flight;
  const defaultFno = f?.flightNumber || '';

  container.innerHTML = `
    <div class="view-content" style="max-width:640px;margin:0 auto;padding:12px 16px">

      <!-- Search Bar -->
      <div class="card" style="margin-bottom:14px">

        <!-- Row 1: Flight Number -->
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
          <input id="gate-fno"
            class="input"
            style="flex:1;font-family:var(--font-mono);font-size:17px;font-weight:700;
                   letter-spacing:.06em;text-transform:uppercase;height:44px;text-align:center"
            placeholder="JX725"
            value="${defaultFno}"
            maxlength="8"
            autocomplete="off" autocorrect="off" spellcheck="false"/>

          <button id="gate-search-btn"
            style="height:44px;padding:0 16px;background:var(--accent);color:#000;
                   border:none;border-radius:10px;font-size:14px;font-weight:700;
                   cursor:pointer;flex-shrink:0">
            查詢
          </button>
        </div>

        <!-- Row 2: Date selector (起飛日) -->
        <div style="display:flex;gap:6px;align-items:center">
          <span style="color:var(--text3);font-size:11px;white-space:nowrap">起飛日</span>
          ${['昨天','今天','明天'].map((label, i) => `
            <button class="gate-date-btn" data-offset="${i - 1}"
              style="flex:1;height:44px;border-radius:8px;border:1px solid var(--border);
                     background:${i === 1 ? 'var(--accent)' : 'var(--card)'};
                     color:${i === 1 ? '#000' : 'var(--text2)'};
                     font-size:12px;font-weight:600;cursor:pointer">
              ${label}
              <div style="font-size:9px;opacity:.7;font-family:var(--font-mono)">${_twToday(i - 1).slice(5)}</div>
            </button>`).join('')}
          <span id="gate-date-display"
            style="font-family:var(--font-mono);font-size:11px;color:var(--text3);
                   white-space:nowrap;min-width:60px;text-align:right">
            ${_twToday(0)}
          </span>
        </div>

        <div style="margin-top:8px;color:var(--text3);font-size:11px;line-height:1.5">
          輸入班號 · 自動查起訖點 · 台灣 TDX 即時 · 全球 AeroDataBox
        </div>
      </div>

      <!-- Result area -->
      <div id="gate-result"></div>
    </div>`;

  container._dateOffset = 0;

  // Date buttons
  container.querySelectorAll('.gate-date-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const offset = parseInt(btn.dataset.offset);
      container._dateOffset = offset;
      container.querySelectorAll('.gate-date-btn').forEach(b => {
        const active = parseInt(b.dataset.offset) === offset;
        b.style.background = active ? 'var(--accent)' : 'var(--card)';
        b.style.color       = active ? '#000'          : 'var(--text2)';
      });
      document.getElementById('gate-date-display').textContent = _twToday(offset);
    });
  });

  // Search on Enter
  document.getElementById('gate-fno').addEventListener('keydown', e => {
    if (e.key === 'Enter') _search(container);
  });
  document.getElementById('gate-search-btn').addEventListener('click', () => _search(container));

  // Auto-search if flight already loaded
  if (defaultFno) _search(container);
}

export function unmount() {}

// ── Search ──────────────────────────────────────────────────────────

async function _search(container) {
  const fnoEl  = document.getElementById('gate-fno');
  const result = document.getElementById('gate-result');
  if (!fnoEl || !result) return;

  const fno = fnoEl.value.trim().toUpperCase();
  if (!fno) return;

  const offset    = container._dateOffset ?? 0;
  const dateStr   = _twToday(offset);
  const dateLabel = ['昨天','今天','明天'][offset + 1];

  result.innerHTML = `
    <div style="text-align:center;padding:40px 0;color:var(--text3);font-size:13px">
      <div style="font-size:22px;margin-bottom:8px">⏳</div>
      查詢 ${fno} · 起飛日 ${dateLabel}（${dateStr}）
    </div>`;

  try {
    const data = await fetchGate(fno, dateStr);
    result.innerHTML = _renderCard(data);
    // Async ADS-B lookup — don't await, fills in after render
    if (data.aircraftHex || data.aircraft || data.acType) _fetchAircraftLive(data, fno);
  } catch (e) {
    result.innerHTML = `
      <div style="padding:14px;background:var(--surface);border:1px solid var(--red)33;
                  border-radius:10px;color:var(--red);font-size:13px">
        ⚠️ ${e.message}
      </div>`;
  }
}

// ── Render ──────────────────────────────────────────────────────────

function _renderCard(data) {
  if (data.error === 'not_found') {
    return `
      <div style="padding:16px;background:var(--surface);border:1px solid var(--border);
                  border-radius:12px;text-align:center">
        <div style="font-size:22px;margin-bottom:8px">🔍</div>
        <div style="color:var(--text);font-size:14px;font-weight:700">查無 ${data.fno}</div>
        <div style="color:var(--text3);font-size:12px;margin-top:4px">
          ${data.flightDate || ''} 查無此班號<br>
          請確認班號與起飛日是否正確
        </div>
      </div>`;
  }

  const dep = data.departure;
  const arr = data.arrival;

  return `
    <div>
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:0 2px">
        <span style="font-family:var(--font-mono);font-size:24px;font-weight:700;
                     color:var(--text);letter-spacing:.04em">${data.fno}</span>
        ${dep?.airport && arr?.airport ? `
          <span style="color:var(--text3);font-size:13px">${dep.airport} → ${arr.airport}</span>` : ''}
        <span style="margin-left:auto;color:var(--text3);font-size:10px">
          ${new Date(data.fetchedAt).toLocaleTimeString('zh-TW', {hour:'2-digit',minute:'2-digit'})}
        </span>
      </div>

      ${data.aircraft ? `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:0 2px">
        <span style="color:var(--text3);font-size:12px">✈️</span>
        <span style="font-family:var(--font-mono);font-size:13px;color:var(--text2);font-weight:600">${data.aircraft}</span>
        ${data.acType ? `<span style="color:var(--text3);font-size:11px">${data.acType}</span>` : ''}
      </div>` : ''}

      <!-- Aircraft live status (filled async by _fetchAircraftLive) -->
      ${(data.aircraft || data.aircraftHex || data.acType) ? `
      <div id="gate-ac-status" style="margin-bottom:10px">
        <div class="card" style="padding:10px 14px;display:flex;align-items:center;gap:8px">
          <span style="font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--text2)">${data.aircraft || '—'}</span>
          ${data.acType ? `<span style="color:var(--text3);font-size:11px">${data.acType}</span>` : ''}
          <div class="wx-spin-sm" style="margin-left:auto"></div>
        </div>
      </div>` : ''}

      <!-- DEP + ARR side by side -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${dep ? _depCard(dep) : '<div></div>'}
        ${arr ? _arrCard(arr) : '<div></div>'}
      </div>
    </div>`;
}

function _depCard(dep) {
  const srcColor = dep.source === 'TDX' ? 'var(--green)' : 'var(--blue)';
  return `
    <div class="card" style="border-left:3px solid var(--accent)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.1em">↑ DEP</span>
        <span style="font-size:10px;color:${srcColor};font-weight:700;
                     border:1px solid ${srcColor}33;border-radius:4px;padding:1px 5px">${dep.source}</span>
      </div>
      ${_opRow('Terminal',  dep.terminal)}
      ${_opRow('Check-in',  dep.checkIn)}
      ${_opRow('Gate',      dep.gate)}
      ${_opRow('STD',       _fmtTime(dep.scheduledTime))}
      ${dep.actualTime    ? _opRow('ATD', _fmtTime(dep.actualTime))    : ''}
      ${dep.estimatedTime ? _opRow('ETD', _fmtTime(dep.estimatedTime)) : ''}
      ${dep.status ? `<div style="margin-top:8px;text-align:right">${_statusBadge(dep.status)}</div>` : ''}
    </div>`;
}

function _arrCard(arr) {
  const srcColor = arr.source === 'TDX' ? 'var(--green)' : 'var(--blue)';
  // gateVia: gate inferred from return flight (e.g. "JX871")
  const gateLabel = arr.gate
    ? (arr.gateVia ? `${arr.gate} <span style="font-size:10px;color:var(--text3);font-weight:400">↩ ${arr.gateVia}</span>` : arr.gate)
    : null;
  return `
    <div class="card" style="border-left:3px solid var(--blue)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="color:var(--blue);font-size:11px;font-weight:700;letter-spacing:.1em">↓ ARR</span>
        <span style="font-size:10px;color:${srcColor};font-weight:700;
                     border:1px solid ${srcColor}33;border-radius:4px;padding:1px 5px">${arr.source}</span>
      </div>
      ${_opRow('Terminal', arr.terminal)}
      ${gateLabel ? _opRowHtml('Gate', gateLabel) : ''}
      ${_opRow('Belt',     arr.belt)}
      ${_opRow('STA',      _fmtTime(arr.scheduledTime))}
      ${arr.actualTime    ? _opRow('ATA', _fmtTime(arr.actualTime))    : ''}
      ${arr.estimatedTime ? _opRow('ETA', _fmtTime(arr.estimatedTime)) : ''}
      ${arr.status ? `<div style="margin-top:8px;text-align:right">${_statusBadge(arr.status)}</div>` : ''}
    </div>`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function _opRow(label, val) {
  if (!val) return '';
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text3);font-size:11px;font-weight:500">${label}</span>
      <span style="color:var(--text);font-family:var(--font-mono);font-size:15px;font-weight:700">${val}</span>
    </div>`;
}

// _opRowHtml: same as _opRow but val is pre-built HTML (not escaped)
function _opRowHtml(label, valHtml) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="color:var(--text3);font-size:11px;font-weight:500">${label}</span>
      <span style="color:var(--text);font-family:var(--font-mono);font-size:15px;font-weight:700">${valHtml}</span>
    </div>`;
}

function _statusBadge(status) {
  if (!status) return '';
  const s = status.trim().toUpperCase();
  let label, color;
  if      (/DEPART|出發/.test(s))        { label = 'DEPARTED'; color = 'var(--text3)'; }
  else if (/ARRIV|已到|落地/.test(s))    { label = 'ARRIVED';  color = 'var(--text3)'; }
  else if (/BOARD|登機/.test(s))         { label = 'BOARDING'; color = 'var(--green)'; }
  else if (/ON.?TIME|準時/.test(s))      { label = 'ON TIME';  color = 'var(--green)'; }
  else if (/EN.?ROUTE|途中/.test(s))     { label = 'EN ROUTE'; color = 'var(--blue)';  }
  else if (/DELAY|延誤/.test(s))         { label = 'DELAYED';  color = 'var(--red)';   }
  else if (/CANCEL|取消/.test(s))        { label = 'CANCEL';   color = 'var(--red)';   }
  else if (/SCHED|預計/.test(s))         { label = 'SCHED';    color = 'var(--blue)';  }
  else { label = s.replace(/[一-鿿]/g, '').trim() || s; color = 'var(--blue)'; }
  return `<span style="color:${color};font-size:11px;font-weight:700;letter-spacing:.06em">${label}</span>`;
}

function _fmtTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString('zh-TW', {
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: 'Asia/Taipei',
    });
  } catch {
    return iso.substring(11, 16);
  }
}

// ── Aircraft Live Status (OpenSky ADS-B) ────────────────────────────

async function _fetchAircraftLive(data, fno) {
  const el = document.getElementById('gate-ac-status');
  if (!el) return;

  const hex    = data.aircraftHex?.toLowerCase();
  const reg    = data.aircraft || '—';
  const acType = data.acType   || '';

  // Build OpenSky query: prefer hex, fallback to STARLUX AXB callsign
  let osUrl = null;
  if (hex) {
    osUrl = `https://opensky-network.org/api/states/all?icao24=${hex}`;
  } else if (fno) {
    // STARLUX ICAO callsign = AXB + numeric part, padded to 8 chars
    const numPart = fno.replace(/^[A-Z]+/, '');
    const callsign = `AXB${numPart}`.padEnd(8, ' ');
    osUrl = `https://opensky-network.org/api/states/all?callsign=${encodeURIComponent(callsign)}`;
  }

  if (!osUrl) {
    el.innerHTML = _acStatusCard(reg, acType, null);
    return;
  }

  try {
    const resp = await fetch(osUrl, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error('OpenSky error');
    const json = await resp.json();
    const s = json.states?.[0];

    if (!s) {
      // Not found in ADS-B — aircraft likely on ground / signal lost
      el.innerHTML = _acStatusCard(reg, acType, { onGround: true, noSignal: true });
      return;
    }

    const callsign    = (s[1] || '').trim();
    const onGround    = s[8];
    const altM        = s[7];   // baro altitude in metres
    const velMs       = s[9];   // ground speed in m/s
    const heading     = s[10];  // true track in degrees
    const lastContact = s[4];   // unix timestamp

    const fl  = (!onGround && altM != null) ? Math.round(altM / 30.48) : null;
    const kt  = (!onGround && velMs != null) ? Math.round(velMs * 1.944) : null;
    const age = lastContact ? Math.round((Date.now() / 1000 - lastContact) / 60) : null;

    el.innerHTML = _acStatusCard(reg, acType, { callsign, onGround, fl, kt, heading, age });
  } catch {
    el.innerHTML = _acStatusCard(reg, acType, null);
  }
}

function _acStatusCard(reg, acType, live) {
  const typeChip = acType
    ? `<span style="color:var(--text3);font-size:11px">${acType}</span>` : '';

  if (!live) {
    // Loading failed or no hex — show just registration
    return `
      <div class="card" style="padding:10px 14px;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">🛩</span>
        <span style="font-family:var(--font-mono);font-size:13px;font-weight:700">${reg}</span>
        ${typeChip}
      </div>`;
  }

  if (live.onGround) {
    const note = live.noSignal ? '（訊號中斷，可能在地面）' : '在地面';
    return `
      <div class="card" style="padding:10px 14px;display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">🛬</span>
        <span style="font-family:var(--font-mono);font-size:13px;font-weight:700">${reg}</span>
        ${typeChip}
        <span style="margin-left:auto;color:var(--green);font-size:12px;font-weight:700">${note}</span>
      </div>`;
  }

  // Airborne
  const { callsign, fl, kt, heading, age } = live;
  const hdg = heading != null ? _hdgArrow(heading) : '';
  const flStr = fl != null ? `FL${fl}` : '';
  const ktStr = kt != null ? `${kt}kt` : '';
  const ageStr = age != null && age > 2 ? `（${age}分鐘前）` : '';

  // STARLUX ICAO callsign = AXB → display as JX
  const displayCall = callsign ? callsign.replace(/^AXB(\d+)/, 'JX$1') : '';
  const callChip = displayCall
    ? `<span style="font-family:var(--font-mono);font-size:12px;color:var(--gold);font-weight:700;
                    border:1px solid rgba(196,154,60,.35);border-radius:4px;padding:1px 7px">${displayCall}</span>` : '';

  return `
    <div class="card" style="padding:10px 14px;border-left:3px solid var(--gold)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:14px">✈️</span>
        <span style="font-family:var(--font-mono);font-size:13px;font-weight:700">${reg}</span>
        ${typeChip}
        ${callChip}
        <span style="margin-left:auto;color:var(--gold);font-size:11px;font-weight:700">AIRBORNE</span>
      </div>
      ${(flStr || ktStr) ? `
      <div style="font-family:var(--font-mono);font-size:12px;color:var(--text2);margin-top:6px">
        ${[flStr, ktStr, hdg].filter(Boolean).join(' · ')}${ageStr}
      </div>` : ''}
      ${displayCall ? `
      <div style="margin-top:6px;color:var(--gold);font-size:12px">
        ⚠️ 前序 ${displayCall} 仍在空中，本航班可能延誤
      </div>` : ''}
    </div>`;
}

function _hdgArrow(deg) {
  // 8-direction arrow based on heading
  const dirs = ['↑','↗','→','↘','↓','↙','←','↖'];
  return dirs[Math.round(deg / 45) % 8];
}
