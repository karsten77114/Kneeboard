// Flight Crew > Briefing
import store from '../store.js';
import storage from '../services/storage.js';
import { preloadElbForFlight, preloadMetarForFlight, fetchGate } from '../services/api.js';
import { fuelStr, weightPct, weightClass, weightColor, showToast, toICAO } from '../utils.js';


export function mount(container) {
  _render(container);
  container._unsub = store.subscribe(() => _render(container));
  // Trigger ELB load on mount — same as ELB tab, so MEL shows without needing to visit ELB first
  _ensureElbLoaded();
  // Auto-fill gate from TDX if dep/dest is a TW airport
  _autoFillGate();
}

export function unmount(container) {
  if (container._unsub) container._unsub();
}

function _normalizeReg(raw) {
  if (!raw) return '';
  return String(raw).replace(/^(B)([0-9]{5})$/, '$1-$2');
}

function _ensureElbLoaded() {
  const d   = store.briefing;
  if (!d) return;
  const reg = _normalizeReg(d.aircraft?.registration || d.ofp?.reg || '');
  if (!reg) return;
  const elb = store.elbData;
  // Skip if already loaded (or loading) for this reg
  if (elb && elb.reg === reg && (elb.loading || !elb.error)) return;
  preloadElbForFlight(reg);
}

// ── Auto Gate Fill ───────────────────────────────────────────────
let _gateFillKey = null; // 防止同一航班重複觸發

async function _autoFillGate() {
  const d = store.briefing;
  if (!d) return;
  const fno = d.flightNumber || '';
  if (!fno) return;

  // 同一航班只 fetch 一次
  const fillKey = `${fno}_${d.date || ''}`;
  if (_gateFillKey === fillKey) return;
  _gateFillKey = fillKey;

  try {
    // 將 YYYYMMDD 轉為 YYYY-MM-DD
    const dateApi = d.date?.length >= 8
      ? `${d.date.slice(0,4)}-${d.date.slice(4,6)}-${d.date.slice(6,8)}`
      : '';
    const gateData = await fetchGate(fno, dateApi);
    if (gateData.error) return;

    const crewKey = `crew_${fno}_${d.date || ''}`;
    const crew    = storage.get(crewKey, {});
    let changed   = false;

    const depInput = document.getElementById('c-dep');
    const arrInput = document.getElementById('c-arr');
    const depAuto  = document.getElementById('c-dep-auto');
    const arrAuto  = document.getElementById('c-arr-auto');
    const depTerm  = document.getElementById('c-dep-term');
    const arrTerm  = document.getElementById('c-arr-term');

    // DEP gate + terminal
    if (gateData.departure?.gate && depInput && !depInput.value) {
      depInput.value = gateData.departure.gate;
      crew.dep_gate  = gateData.departure.gate;
      changed = true;
    }
    if (gateData.departure?.terminal) {
      crew.dep_term = gateData.departure.terminal;
      if (depTerm) { depTerm.textContent = 'T' + gateData.departure.terminal; depTerm.style.display = 'inline'; }
      changed = true;
    }

    // ARR gate + terminal
    if (gateData.arrival?.gate && arrInput && !arrInput.value) {
      arrInput.value = gateData.arrival.gate;
      crew.arr_gate  = gateData.arrival.gate;
      changed = true;
    }
    if (gateData.arrival?.terminal) {
      crew.arr_term = gateData.arrival.terminal;
      if (arrTerm) { arrTerm.textContent = 'T' + gateData.arrival.terminal; arrTerm.style.display = 'inline'; }
      changed = true;
    }

    if (changed) {
      storage.set(crewKey, crew);
      const depSrc = gateData.departure?.source || '';
      const arrSrc = gateData.arrival?.source   || '';
      if (depAuto && gateData.departure?.gate) depAuto.textContent = depSrc === 'TDX' ? '✓ TDX' : '✓ ADB';
      if (arrAuto && gateData.arrival?.gate)   arrAuto.textContent = arrSrc === 'TDX' ? '✓ TDX' : '✓ ADB';
    }
  } catch {
    // 靜默失敗，不影響簡報頁其他功能
  }
}

// ── Main render ──────────────────────────────────────────────────

function _render(container) {
  const d = store.briefing;
  if (!d) {
    container.innerHTML = `
      <div class="state-screen">
        <div class="state-icon">📋</div>
        <div class="state-title">尚未載入簡報</div>
        <div class="state-sub">請先在主畫面查詢航班。</div>
      </div>`;
    return;
  }
  _ensureElbLoaded();
  _autoFillGate();

  const o      = d.ofp      || {};
  const t      = d.times    || {};
  const ac     = d.aircraft || {};
  const reg    = ac.registration || o.reg || '—';
  const dep    = d.dep  || '—';
  const dest   = d.dest || '—';
  const fltNo  = d.flightNumber || '—';

  const { block, remaining } = _computeBlock(t.std, t.sta, t.ete);
  const rawFL    = o.cruiseFl || o.flightLevel || _extractFL(d.atsRoute || d.flightRoute || '');
  const cruiseFL = rawFL ? String(rawFL).replace(/^FL/i, '') : null;

  const crewKey = `crew_${fltNo}_${d.date || ''}`;
  const crew    = storage.get(crewKey, {});

  container.innerHTML = `
    <div class="view-content">

      ${_arcCard(dep, dest, fltNo, t, cruiseFL, block, remaining, reg, d.date, crew, o)}

      <!-- ATC Route + MEL -->
      <div class="grid2" style="margin-bottom:10px">
        <div class="card">
          <div class="card-title">ATC Clearance Route</div>
          <div class="route-box" id="atc-route-box" data-raw="${(d.atsRoute || d.flightRoute || '').replace(/"/g,'&quot;')}">${_extractRoute(d.atsRoute || d.flightRoute)}</div>
        </div>
        <div class="card" id="mel-card">
          <div class="card-title"
               style="display:flex;align-items:center;justify-content:space-between">
            <span>MEL Deferred Defects</span>
            <span id="mel-badge"
                  style="display:none;font-size:12px;font-weight:700;padding:2px 10px;border-radius:12px"></span>
          </div>
          <div id="mel-body"></div>
        </div>
      </div>

      <!-- Fuel + Weight -->
      <div class="grid2" style="margin-bottom:10px">
        <div class="card">
          <div class="card-title">Fuel Plan</div>
          ${_fuelRows(o)}
        </div>
        <div class="card">
          <div class="card-title">Weight</div>
          ${_weightBars(d.weight, o)}
        </div>
      </div>

    </div>`;

  _applyStyles();
  _renderMEL();
  _loadWeather(dep, dest);
  _bindFuel(o);
  setTimeout(() => _bindCrew(crewKey, fltNo, dep, dest, t, cruiseFL, block), 0);
}

// ── Arc card ─────────────────────────────────────────────────────

function _arcCard(dep, dest, fltNo, t, cruiseFL, block, remaining, reg, date, crew, o) {
  const std  = t.std  || '—';
  const sta  = t.sta  || '—';
  const stdL = t.stdLocal ? t.stdLocal + 'L' : '';
  const staL = t.staLocal ? t.staLocal + 'L' : '';
  const ete  = t.ete  || '—';
  const blockStr = block !== null ? _fmtMins(block) : '—';
  const remStr   = (remaining !== null && remaining >= 0) ? _fmtMins(remaining) : '—';

  // Stats strip
  const dist     = o?.dist     != null ? `${Math.round(o.dist)} NM`            : null;
  const wcRaw    = o?.wc       != null ? Number(o.wc)                           : null;
  const wcStr    = wcRaw != null ? (wcRaw >= 0 ? `+${wcRaw}` : `${wcRaw}`) + ' kt' : null;
  const ciStr    = o?.ci       != null ? `CI ${o.ci}`                           : null;
  const altnApt  = o?.altnApt  || null;
  const altnFuel = o?.altnFuel != null ? fuelStr(o.altnFuel)                   : null;
  const statsItems = [
    dist    ? { label:'距離',      val: dist }                                         : null,
    wcStr   ? { label:'Wind Comp', val: wcStr, cls: wcRaw < 0 ? 'neg' : 'pos' }        : null,
    ciStr   ? { label:'Cost Index',val: ciStr }                                        : null,
    altnApt ? { label:'備降 ALTN', val: altnApt + (altnFuel ? ' · ' + altnFuel : '') } : null,
  ].filter(Boolean);
  const statsHtml = statsItems.length ? `
    <div class="arc-stats">
      ${statsItems.map(s => `
        <div class="arc-stat">
          <div class="arc-stat-lbl">${s.label}</div>
          <div class="arc-stat-val${s.cls ? ' arc-stat-' + s.cls : ''}">${s.val}</div>
        </div>`).join('')}
    </div>` : '';

  const statusChip = _elbStatusChip();

  return `
    <div class="card arc-wrap" style="margin-bottom:10px">

      <!-- Single 3-col: [DEP + WX + Gate] | [Profile SVG] | [ARR + WX + Gate] -->
      <div class="arc-body-grid">

        <!-- Left: DEP ICAO + STD + WX + Gate -->
        <div class="arc-side">
          <div class="arc-apt">${toICAO(dep)}</div>
          <div class="arc-tutc">${std}</div>
          ${stdL ? `<div class="arc-tloc">${stdL}</div>` : ''}
          <div style="margin-top:10px">
            <div class="wx-hdr">${toICAO(dep)} WX</div>
            <div id="wx-${toICAO(dep)}-inline" class="wx-body-sm"><div class="wx-spin-sm"></div></div>
            <div class="arc-gate-row">
              <span id="c-dep-term" class="arc-term-chip"
                style="display:${crew.dep_term ? 'inline' : 'none'}">T${_esc(crew.dep_term||'')}</span>
              <span class="brief-lbl" style="margin:0">Gate</span>
              <input id="c-dep" class="input arc-gate-input"
                type="text" value="${_esc(crew.dep_gate||'')}" placeholder="B3"/>
              <span id="c-dep-auto" style="font-size:11px;color:var(--green)"></span>
            </div>
          </div>
        </div>

        <!-- Center: flt label + trapezoidal flight profile + ETE overlay -->
        <div>
          <div style="text-align:center;margin-bottom:2px">
            <span class="arc-flt-label">${fltNo}</span>
          </div>
          <div style="position:relative">
            <svg viewBox="0 0 300 90" width="100%"
                 style="display:block;overflow:visible">
              <defs>
                <!-- Left-to-right gradient spanning full userSpace width -->
                <linearGradient id="fpGrad" x1="0" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%"   stop-color="#c49a3c" stop-opacity="0.85"/>
                  <stop offset="50%"  stop-color="#f0d080" stop-opacity="1"/>
                  <stop offset="100%" stop-color="#c49a3c" stop-opacity="0.35"/>
                </linearGradient>
                <!-- Vertical fill gradient: gold at cruise level, transparent at ground -->
                <linearGradient id="fpFill" x1="0" y1="0" x2="0" y2="90" gradientUnits="userSpaceOnUse">
                  <stop offset="0%"   stop-color="#c49a3c" stop-opacity="0.10"/>
                  <stop offset="100%" stop-color="#c49a3c" stop-opacity="0"/>
                </linearGradient>
                <filter id="fpGlow" x="-5%" y="-80%" width="110%" height="260%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="3"/>
                </filter>
              </defs>

              <!-- Area fill inside profile -->
              <path d="M 0,78 L 30,78 L 80,12 L 220,12 L 270,78 L 300,78 Z"
                fill="url(#fpFill)"/>

              <!-- Glow on climb+cruise+descent -->
              <polyline points="30,78 80,12 220,12 270,78"
                stroke="#f0d080" stroke-width="3" fill="none"
                stroke-linecap="round" stroke-linejoin="round"
                opacity="0.20" filter="url(#fpGlow)"/>

              <!-- Ground segments — dashed -->
              <line x1="0"   y1="78" x2="30"  y2="78"
                stroke="url(#fpGrad)" stroke-width="2"
                stroke-dasharray="5 3" stroke-linecap="round" opacity="0.55"/>
              <line x1="270" y1="78" x2="300" y2="78"
                stroke="url(#fpGrad)" stroke-width="2"
                stroke-dasharray="5 3" stroke-linecap="round" opacity="0.55"/>

              <!-- Main profile: climb + cruise + descent (solid) -->
              <polyline points="30,78 80,12 220,12 270,78"
                stroke="url(#fpGrad)" stroke-width="2.5" fill="none"
                stroke-linecap="round" stroke-linejoin="round"/>

              <!-- Endpoint dots -->
              <circle cx="30"  cy="78" r="4" fill="#c49a3c" opacity="0.9"/>
              <circle cx="270" cy="78" r="4" fill="#c49a3c" opacity="0.38"/>
            </svg>

            <!-- FL label — above cruise line, will not overlap polyline -->
            ${cruiseFL ? `<div style="position:absolute;top:4%;left:50%;transform:translateX(-50%);z-index:2">
              <span class="arc-fl-label">FL${cruiseFL}</span>
            </div>` : ''}

            <!-- ETE + Block/Rem — inside cruise zone, clearly below the cruise line -->
            <div style="position:absolute;top:52%;left:50%;transform:translate(-50%,-50%);
                        text-align:center;z-index:1;pointer-events:none;width:100%">
              <div class="arc-ete">${ete}</div>
              <div style="font-size:13px;color:var(--text2);font-weight:600;margin-top:3px">
                Block ${blockStr} · Rem ${remStr}</div>
              ${statusChip ? `<div style="display:flex;align-items:center;justify-content:center;
                  flex-wrap:wrap;margin-top:4px">${statusChip}</div>` : ''}
            </div>
          </div>
        </div>

        <!-- Right: ARR ICAO + STA + WX + Gate -->
        <div class="arc-side arc-side-r">
          <div class="arc-apt">${toICAO(dest)}</div>
          <div class="arc-tutc">${sta}</div>
          ${staL ? `<div class="arc-tloc">${staL}</div>` : ''}
          <div style="margin-top:10px">
            <div class="wx-hdr arc-hdr-r">${toICAO(dest)} WX</div>
            <div id="wx-${toICAO(dest)}-inline" class="wx-body-sm arc-wx-r"><div class="wx-spin-sm" style="float:right"></div></div>
            <div class="arc-gate-row arc-gate-row-r">
              <span id="c-arr-auto" style="font-size:11px;color:var(--green)"></span>
              <span class="brief-lbl" style="margin:0">Gate</span>
              <input id="c-arr" class="input arc-gate-input"
                type="text" value="${_esc(crew.arr_gate||'')}" placeholder="A8"/>
              <span id="c-arr-term" class="arc-term-chip"
                style="display:${crew.arr_term ? 'inline' : 'none'}">T${_esc(crew.arr_term||'')}</span>
            </div>
          </div>
        </div>

      </div><!-- end arc-body-grid -->

      <!-- Water + Wx Note + Copy -->
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
        <span class="brief-lbl" style="margin:0;white-space:nowrap">Water</span>
        <input id="c-water" class="input" type="number" min="0" max="100"
          value="${crew.water_pct ?? 100}"
          style="width:64px;height:36px;padding:6px 8px;text-align:center"/>
        <span class="brief-lbl" style="margin:0">%</span>
        <input id="c-wx" class="input" type="text" placeholder="wx note…"
          value="${_esc(crew.wx_note||'')}"
          style="flex:1;min-width:100px;height:36px;padding:6px 10px"/>
        <button id="c-copy" class="btn-copy-sm" title="Copy crew brief">📋 Copy</button>
      </div>

      <!-- Stats strip: at bottom -->
      ${statsHtml}

    </div>`;
}

// ── Block time helpers ───────────────────────────────────────────

function _computeBlock(std, sta, ete) {
  const toMins = s => {
    if (!s) return null;
    const str = String(s).replace(/[^0-9]/g, '');
    if (str.length < 3) return null;
    const h = parseInt(str.slice(0, -2), 10);
    const m = parseInt(str.slice(-2),    10);
    if (isNaN(h) || isNaN(m) || m > 59) return null;
    return h * 60 + m;
  };
  const stdM = toMins(std);
  const staM = toMins(sta);
  if (stdM === null || staM === null) return { block: null, remaining: null };
  let block = staM - stdM;
  if (block <= 0) block += 1440;
  if (block <= 0 || block > 1440) return { block: null, remaining: null };
  const eteM = toMins(ete);
  return { block, remaining: eteM !== null ? block - eteM : null };
}

function _fmtMins(mins) {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${mins < 0 ? '-' : ''}${h}:${String(m).padStart(2, '0')}`;
}

function _extractFL(route) {
  if (!route) return null;
  const m = route.match(/[NMK]\d{3,4}[FA](\d{3,5})/);
  return m ? m[1] : null;
}

// ── Inline weather (reads from shared store.wxData) ──────────────

function _loadWeather(dep, dest) {
  const icaos = [dep, dest].filter(c => c && c !== '—').map(toICAO);
  const missing = icaos.filter(ic => !store.wxData[ic]);
  if (missing.length) preloadMetarForFlight(missing).catch(() => {});
  icaos.forEach(ic => {
    const el = document.getElementById(`wx-${ic}-inline`);
    if (el) el.innerHTML = _wxInlineHtml(store.wxData[ic]);
  });
}

function _wxInlineHtml(c) {
  if (!c || c.loading) return '<div class="wx-spin-sm"></div>';
  if (c.error) return `<div style="color:var(--text3);font-size:10px">—</div>`;
  const metar = c.metar || '';

  const windM = metar.match(/\b(VRB|\d{3})(\d{2,3})(G\d{2,3})?KT\b/);
  const wind = windM ? `${windM[1]}/${windM[2]}${windM[3] || ''}kt` : null;

  const tempM = metar.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  const temp = tempM ? `${tempM[1].replace('M', '-')}°C` : null;

  let cloud = null;
  if (/\bCAVOK\b/.test(metar)) {
    cloud = 'CAVOK';
  } else {
    const cloudM = metar.match(/\b(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?\b/);
    if (cloudM) cloud = cloudM[0];
  }

  const items = [wind, temp, cloud].filter(Boolean);
  if (!items.length) return `<div style="color:var(--text3);font-size:10px">—</div>`;

  const mono = "font-family:'JetBrains Mono','SF Mono',monospace";
  return `<div style="${mono};font-size:12px;color:var(--text);line-height:1.6;white-space:nowrap">${items.map(_esc).join(' ')}</div>`;
}

// ── Fuel ─────────────────────────────────────────────────────────

function _fuelRows(o) {
  const has = v => v !== undefined && v !== null;
  const items = [
    { label: 'Trip Fuel',     val: o.tripFuel },
    { label: 'Dest Hold',     val: o.destHoldFuel },
    { label: 'Alternate',     val: o.altnFuel },
    { label: 'Final Reserve', val: o.finalFuel },
    { label: 'ADD WXX',       val: o.wxxFuel },
    { label: 'ADD OPN',       val: o.opnFuel },
    { label: 'ADD ATC',       val: o.atcFuel },
    { label: 'ADD DEV',       val: o.devFuel },
    { label: 'Contingency',   val: o.contFuel },
    { label: 'Crit Fuel',     val: o.critFuel },
    { label: 'Extra',         val: o.extraFuel },
    { label: 'Tankering',     val: o.tankerFuel },
  ].filter(x => has(x.val));

  if (!items.length && !has(o.toFuel)) return '<div style="color:var(--text3);font-size:13px">暫無燃油資料</div>';

  const toFuel  = o.toFuel  ?? 0;
  const taxiFuel = o.taxiFuel ?? 0;
  const blockFuel = toFuel + taxiFuel;

  const rowHtml = items.map(f => {
    const dim = f.val === 0 ? 'opacity:.35;' : '';
    return `<div class="data-row" style="${dim}">
      <span class="data-label">${f.label}</span>
      <span class="data-val">${fuelStr(f.val)}</span>
    </div>`;
  }).join('');

  const toFuelHtml = has(o.toFuel) ? `
    <div style="background:var(--surface);border-radius:8px;padding:8px 12px;margin-top:10px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700">Takeoff Fuel</span>
      <span style="color:var(--gold);font-size:17px;font-weight:800;font-family:'JetBrains Mono','SF Mono',monospace">${fuelStr(toFuel)}</span>
    </div>` : '';

  const taxiHtml = has(o.taxiFuel) ? `
    <div class="data-row">
      <span class="data-label">Taxi</span>
      <span class="data-val">${fuelStr(taxiFuel)}</span>
    </div>` : '';

  const captainHtml = `
    <div class="data-row" style="margin-top:4px">
      <span class="data-label" style="color:var(--text2)">+ 機長追加油量</span>
      <div style="display:flex;align-items:center;gap:6px">
        <input id="fuel-captain-extra" type="number" min="0" step="100" value="0"
          class="input" style="width:90px;height:32px;text-align:right;padding:4px 8px;font-size:13px">
        <span style="color:var(--text3);font-size:13px">kg</span>
      </div>
    </div>`;

  const blockFuelHtml = `
    <div id="fuel-block-row" style="background:var(--surface);border-radius:8px;padding:8px 12px;margin-top:10px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700">Block Fuel</span>
      <span id="fuel-block-val" style="color:var(--gold);font-size:17px;font-weight:800;font-family:'JetBrains Mono','SF Mono',monospace">${fuelStr(blockFuel)}</span>
    </div>`;

  return rowHtml + toFuelHtml + taxiHtml + captainHtml + blockFuelHtml;
}

function _bindFuel(o) {
  const input = document.getElementById('fuel-captain-extra');
  const display = document.getElementById('fuel-block-val');
  if (!input || !display) return;
  const base = (o.toFuel ?? 0) + (o.taxiFuel ?? 0);
  input.addEventListener('input', () => {
    const extra = parseInt(input.value) || 0;
    display.textContent = fuelStr(base + extra);
  });
}

// ── Weight ───────────────────────────────────────────────────────

function _weightBars(weight, o) {
  const rows = [
    { label: 'ZFW', pln: weight?.zfw?.planned,    lim: weight?.zfw?.limit },
    { label: 'TOW', pln: weight?.takeoff?.planned, lim: weight?.takeoff?.limit },
    { label: 'LDW', pln: weight?.landing?.planned, lim: weight?.landing?.limit },
  ];
  const ofp = [
    { label: 'ZFW', pln: o.zfwPln, lim: o.zfwLim },
    { label: 'TOW', pln: o.towPln, lim: o.towLim },
    { label: 'LDW', pln: o.ldwPln, lim: o.ldwLim },
  ];
  const eff   = rows.some(r => r.pln && r.lim) ? rows : ofp;
  const valid = eff.filter(w => w.pln && w.lim);
  if (!valid.length) return '<div style="color:var(--text3);font-size:13px">暫無重量資料</div>';
  return valid.map(w => {
    const pct = weightPct(w.pln, w.lim);
    const cls = weightClass(pct);
    return `<div class="w-bar-wrap">
      <div class="w-bar-labels">
        <span style="color:var(--text2)">${w.label}</span>
        <span style="font-weight:700;color:${weightColor(pct)}">${pct}%</span>
      </div>
      <div class="w-bar-track"><div class="w-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <div class="w-bar-nums">
        <span>${w.pln.toFixed(1)}</span>
        <span>MAX ${w.lim.toFixed(1)} MT</span>
      </div>
    </div>`;
  }).join('');
}

// ── Crew brief copy ───────────────────────────────────────────────

function _crewText(fltNo, dep, dest, t, cruiseFL, crew, block) {
  const fl    = crew.cruise_fl || cruiseFL || '—';
  const ete   = t.ete || '—';
  const blk   = block !== null ? _fmtMins(block) : '—';
  const water = (crew.water_pct != null) ? crew.water_pct + '%' : '100%';
  const wx    = crew.wx_note || 'smooth flight expected';
  const depGateStr = crew.dep_gate
    ? `DEP Gate ${crew.dep_term ? crew.dep_term + '/' : ''}${crew.dep_gate}` : '';
  const arrGateStr = crew.arr_gate
    ? `ARR Gate ${crew.arr_term ? crew.arr_term + '/' : ''}${crew.arr_gate}` : '';
  const gates = [depGateStr, arrGateStr].filter(Boolean).join('  ·  ');

  return [
    `${fltNo}  ${dep} → ${dest}`,
    `STD ${t.std||'—'}  STA ${t.sta||'—'}`,
    `ETE ${ete}  Block ${blk}`,
    gates,
    `Cruise FL${fl}  Water ${water}`,
    `Wx: ${wx}`,
  ].filter(Boolean).join('\n');
}

function _bindCrew(crewKey, fltNo, dep, dest, t, cruiseFL, block) {
  const copyBtn = document.getElementById('c-copy');
  if (!copyBtn) return;

  function _save() {
    const crew = storage.get(crewKey, {});
    crew.dep_gate  = document.getElementById('c-dep')?.value   || '';
    crew.arr_gate  = document.getElementById('c-arr')?.value   || '';
    crew.water_pct = parseInt(document.getElementById('c-water')?.value || '100', 10);
    crew.wx_note   = document.getElementById('c-wx')?.value    || '';
    storage.set(crewKey, crew);
  }

  ['c-dep','c-arr','c-water','c-wx'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _save);
  });

  copyBtn.addEventListener('click', async () => {
    _save();
    const crew = storage.get(crewKey, {});
    const text = _crewText(fltNo, dep, dest, t, cruiseFL, crew, block);
    try {
      await navigator.clipboard.writeText(text);
      showToast('已複製客艙簡報');
    } catch {
      showToast('複製失敗', true);
    }
  });
}

// ── ELB Aircraft Status Chip ─────────────────────────────────────

function _elbStatusChip() {
  const elb = store.elbData;
  if (!elb || elb.loading) return '';
  if (elb.inFlight) {
    // Aircraft is currently airborne on a previous sector
    const prev = elb.flights?.[0];
    const offT = prev?.oooiOff?.actual || prev?.oooiOut?.actual;
    const callHint = offT
      ? ` · OFF ${new Date(offT).toLocaleTimeString('zh-TW',{ hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Taipei' })}L`
      : '';
    return `<span style="font-size:10px;font-weight:700;color:var(--gold);
      background:rgba(196,154,60,.15);border:1px solid rgba(196,154,60,.3);
      border-radius:10px;padding:1px 8px;white-space:nowrap">
      ✈ 在空中${callHint}
    </span>`;
  }
  // On ground — show last landing time if available
  const prev = elb.flights?.[0];
  const inT  = prev?.oooiIn?.actual || prev?.oooiOn?.actual;
  const inHint = inT
    ? ` · IN ${new Date(inT).toLocaleTimeString('zh-TW',{ hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Taipei' })}L`
    : '';
  return `<span style="font-size:10px;font-weight:700;color:var(--green);
    background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);
    border-radius:10px;padding:1px 8px;white-space:nowrap">
    🛬 在地面${inHint}
  </span>`;
}

// ── MEL ──────────────────────────────────────────────────────────

function _renderMEL() {
  const body  = document.getElementById('mel-body');
  const badge = document.getElementById('mel-badge');
  if (!body) return;
  const elb       = store.elbData;
  const elbStatus = store.auth.elb.status;

  if (elbStatus !== 'ok') {
    body.innerHTML = '<div style="color:var(--text3);font-size:13px">ELB 尚未連線，無法自動載入</div>';
    return;
  }
  if (!elb) {
    body.innerHTML = '<div style="color:var(--text3);font-size:13px">等待 ELB 資料…</div>';
    return;
  }
  if (elb.loading) {
    body.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--text2);font-size:13px;padding:8px 0"><div class="spinner" style="width:16px;height:16px;border-width:2px"></div>載入中…</div>';
    return;
  }
  if (elb.error) {
    body.innerHTML = `
      <div style="color:var(--red);font-size:13px;margin-bottom:8px">查詢失敗：${elb.error}</div>
      <button id="mel-retry" style="font-size:12px;font-weight:700;padding:5px 14px;border-radius:8px;
        background:rgba(196,154,60,.12);border:1px solid rgba(196,154,60,.25);color:var(--gold);cursor:pointer">
        重試 Retry
      </button>`;
    setTimeout(() => {
      document.getElementById('mel-retry')?.addEventListener('click', () => {
      const raw = store.briefing?.aircraft?.registration || store.briefing?.ofp?.reg;
      if (raw) preloadElbForFlight(_normalizeReg(raw));
    });
    }, 0);
    return;
  }

  const logs = elb.mel || [];

  // Separate true MEL/CDL items from OTH (MP tasks / inspections / no MEL ref)
  const melItems = logs.filter(m => m._refType !== 'OTH');
  const othItems = logs.filter(m => m._refType === 'OTH');

  if (badge) {
    badge.style.display = 'inline-block';
    if (!melItems.length) {
      badge.style.cssText = 'display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:12px;background:rgba(34,197,94,.2);color:var(--green)';
      badge.textContent = othItems.length ? `0 MEL · ${othItems.length} OTH` : '0 MEL';
    } else {
      badge.style.cssText = 'display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:12px;background:rgba(245,158,11,.2);color:var(--gold)';
      badge.textContent = othItems.length ? `${melItems.length} MEL · ${othItems.length} OTH` : `${melItems.length} MEL`;
    }
  }

  if (!logs.length) {
    body.innerHTML = '<div style="color:var(--green);font-size:13px;padding:8px 0">✓ 無暫緩故障</div>';
    return;
  }

  const catMap = {
    A:   'rgba(239,68,68,.3);color:var(--red)',
    B:   'rgba(245,158,11,.3);color:var(--gold)',
    C:   'rgba(250,204,21,.3);color:#fbbf24',
    D:   'rgba(148,163,184,.2);color:var(--text2)',
  };

  function _melRow(m, prefix) {
    const desc    = m.faultDescription || m.defectDescription || '（無描述）';
    const cat     = m._category || '';
    const days    = m._expireDays;
    const limit   = m._expireLimit;
    const expCls  = days != null ? (days <= 7 ? 'urgent' : days <= 30 ? 'warn' : 'ok') : '';
    const expHtml = days != null
      ? `<span style="font-size:11px;padding:1px 7px;border-radius:10px;${_expStyle(expCls)}">到期 ${days} 天</span>`
      : limit
        ? `<span style="font-size:11px;padding:1px 7px;border-radius:10px;background:rgba(148,163,184,.15);color:var(--text3)">到期 ${limit}</span>`
        : '';
    const catHtml = cat
      ? `<span style="font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;background:${catMap[cat]||'rgba(148,163,184,.2);color:var(--text2)'}">Cat ${cat}</span>` : '';
    const headerHtml = m._melCode
      ? `<div style="font-size:12px;font-weight:700;color:var(--gold);margin-bottom:3px">${prefix} ${m._melCode}</div>`
      : '';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      ${headerHtml}
      <div style="font-size:13px;color:var(--text)">${_esc(desc)}</div>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:4px">
        ${m.deferralRefNum ? `<span style="font-size:11px;color:var(--text3)">REF ${m.deferralRefNum}</span>` : ''}
        ${catHtml}${expHtml}
      </div>
    </div>`;
  }

  const sortedMel = [...melItems].sort((a,b) => (a._expireDays ?? Infinity) - (b._expireDays ?? Infinity));
  const sortedOth = [...othItems].sort((a,b) => (a._expireDays ?? Infinity) - (b._expireDays ?? Infinity));

  let html = sortedMel.map(m => _melRow(m, 'MEL')).join('');

  if (sortedOth.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:0.6px;
      text-transform:uppercase;margin-top:14px;margin-bottom:4px;padding-top:10px;
      border-top:1px solid var(--border)">OTH — Non-MEL Deferred Tasks</div>`;
    html += sortedOth.map(m => _melRow(m, 'OTH')).join('');
  }

  body.innerHTML = html;
}

// ── ATC route ────────────────────────────────────────────────────

function _extractRoute(raw) {
  if (!raw) return '<span style="color:var(--text3)">暫無 ATS 資料</span>';
  // Extract route field from ICAO FPL block: keeps speed/FL prefix (e.g. M078F330)
  const m = raw.match(/-[A-Z]{4}\d{4}\s+-([NMK]\d{3,4}[FA]\d{3,5}[\s\S]+?)\s+-[A-Z]{4}\d/);
  return (m ? m[1] : raw).trim();
}

// ── Shared helpers ───────────────────────────────────────────────

function _expStyle(cls) {
  const map = {
    urgent: 'background:rgba(239,68,68,.2);color:var(--red)',
    warn:   'background:rgba(245,158,11,.2);color:var(--gold)',
    ok:     'background:rgba(148,163,184,.15);color:var(--text2)',
  };
  return map[cls] || map.ok;
}

function _dateLabel(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length < 8) return '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${yyyymmdd.slice(6,8)}${months[parseInt(yyyymmdd.slice(4,6),10)-1]}${yyyymmdd.slice(0,4)}`;
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

// ── Styles ───────────────────────────────────────────────────────

function _applyStyles() {
  if (document.getElementById('briefing-style')) return;
  const s = document.createElement('style');
  s.id = 'briefing-style';
  s.textContent = `
    :root { --gold:#c49a3c; --gold-lt:#f0d080; --gold-glow:rgba(196,154,60,.25); }

    /* Force 2-col grid regardless of screen width */
    .grid2f { display:grid; grid-template-columns:1fr 1fr; gap:10px; }

    /* ── Arc body: 3-col grid ── */
    .arc-body-grid { display:grid;
                     grid-template-columns:minmax(85px,115px) 1fr minmax(85px,115px);
                     gap:10px; align-items:start; }
    .arc-side   { display:flex; flex-direction:column; }
    .arc-side-r { align-items:flex-end; }
    .arc-hdr-r  { text-align:right; }
    .arc-wx-r   { text-align:right; }

    /* Flight number label */
    .arc-flt-label { font-size:14px; font-weight:900; color:var(--gold);
                     letter-spacing:2px; text-transform:uppercase;
                     text-shadow:0 0 16px rgba(196,154,60,.4); }

    /* Airport ICAO */
    .arc-apt    { font-size:22px; font-weight:800; letter-spacing:-.5px; line-height:1.1; }

    /* FL label at cruise level */
    .arc-fl-label { font-family:'JetBrains Mono','SF Mono',monospace;
                    font-size:12px; font-weight:700; color:rgba(240,208,128,.7);
                    letter-spacing:.5px; }

    /* STD/STA */
    .arc-tutc   { font-family:'JetBrains Mono','SF Mono',monospace;
                  font-size:20px; font-weight:800; line-height:1.15; }
    .arc-tloc   { font-size:12px; color:var(--text3); }

    /* ETE in cruise zone */
    .arc-ete    { font-family:'JetBrains Mono','SF Mono',monospace;
                  font-size:28px; font-weight:800; line-height:1.1; }
    .arc-sub    { font-size:12px; color:var(--text3); margin-top:1px; }

    /* Gate row */
    .arc-gate-row   { display:flex; align-items:center; gap:5px; margin-top:8px;
                      flex-wrap:wrap; }
    .arc-gate-row-r { justify-content:flex-end; }
    .arc-gate-input { width:58px !important; height:30px; padding:3px 6px !important;
                      text-align:center; font-weight:700; font-size:14px !important; }
    .arc-term-chip  { font-family:'JetBrains Mono','SF Mono',monospace;
                      font-size:12px; color:var(--text3); font-weight:700;
                      background:rgba(148,163,184,.12); border-radius:4px;
                      padding:1px 5px; }

    /* ── Flight data stats strip ── */
    .arc-stats    { display:grid; grid-template-columns:repeat(auto-fit,minmax(80px,1fr));
                    gap:0; border-top:1px solid var(--border); margin-top:10px; padding-top:8px; }
    .arc-stat     { text-align:center; padding:4px 6px; }
    .arc-stat-lbl { font-size:11px; color:var(--text3); text-transform:uppercase;
                    letter-spacing:.05em; margin-bottom:2px; }
    .arc-stat-val { font-family:'JetBrains Mono','SF Mono',monospace;
                    font-size:14px; font-weight:700; color:var(--text); }
    .arc-stat-neg { color:var(--red) !important; }
    .arc-stat-pos { color:var(--green) !important; }

    /* ── Weather inline ── */
    .wx-hdr     { font-size:12px; font-weight:700; color:var(--gold);
                  text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
    .wx-body-sm { min-height:16px; }
    .wx-spin-sm { display:inline-block; width:12px; height:12px;
                  border:2px solid var(--border); border-top-color:var(--gold);
                  border-radius:50%; animation:spin .8s linear infinite; }

    /* ── Crew form ── */
    .brief-lbl   { font-size:12px; color:var(--text3); text-transform:uppercase;
                   letter-spacing:.04em; margin-bottom:4px; }
    .btn-copy-sm { background:rgba(196,154,60,.12); border:1px solid rgba(196,154,60,.25);
                   color:var(--gold); border-radius:8px; cursor:pointer;
                   font-size:14px; font-weight:700; padding:6px 14px;
                   white-space:nowrap; flex-shrink:0; font-family:inherit; }
    .btn-copy-sm:active { opacity:.7; }
  `;
  document.head.appendChild(s);
}
