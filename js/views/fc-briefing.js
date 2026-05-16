// Flight Crew > Briefing
import store from '../store.js';
import storage from '../services/storage.js';
import { preloadElbForFlight, preloadMetarForFlight } from '../services/api.js';
import { fuelStr, weightPct, weightClass, weightColor, showToast, toICAO } from '../utils.js';


export function mount(container) {
  _render(container);
  container._unsub = store.subscribe(() => _render(container));
  // Trigger ELB load on mount — same as ELB tab, so MEL shows without needing to visit ELB first
  _ensureElbLoaded();
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
  // Skip if already loaded successfully for this reg
  if (elb && !elb.error && !elb.loading && elb.reg === reg) return;
  preloadElbForFlight(reg);
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
  const pic     = d.pic || '';
  const ofpNo   = d.ofpNumber || d.ofpNo || '';

  container.innerHTML = `
    <div class="view-content">

      ${_arcCard(dep, dest, fltNo, t, cruiseFL, block, remaining, reg, d.date, crew, o, pic, ofpNo)}

      <!-- ATC Route + MEL -->
      <div class="grid2" style="margin-bottom:10px">
        <div class="card">
          <div class="card-title">ATC Clearance Route</div>
          <div class="route-box">${_extractRoute(d.atsRoute || d.flightRoute)}</div>
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
          ${_extraFuelInputHtml(o, crew)}
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
  setTimeout(() => _bindCrew(crewKey, fltNo, dep, dest, t, cruiseFL, block, o), 0);
}

// ── Arc card ─────────────────────────────────────────────────────

function _arcCard(dep, dest, fltNo, t, cruiseFL, block, remaining, reg, date, crew, o, pic, ofpNo) {
  const std  = t.std  || '—';
  const sta  = t.sta  || '—';
  const stdL = t.stdLocal ? t.stdLocal + 'L' : '';
  const staL = t.staLocal ? t.staLocal + 'L' : '';
  const ete  = t.ete  || '—';
  const flChip   = cruiseFL ? `FL${cruiseFL}` : '—';
  const blockStr = block !== null ? _fmtMins(block) : '—';
  const remStr   = (remaining !== null && remaining >= 0) ? _fmtMins(remaining) : '—';

  // Flight data stats strip (formerly "飛行資料" panel)
  const dist     = o?.dist      != null ? `${Math.round(o.dist)} NM`            : null;
  const wcRaw    = o?.wc        != null ? Number(o.wc)                           : null;
  const wcStr    = wcRaw != null ? (wcRaw >= 0 ? `+${wcRaw}` : `${wcRaw}`) + ' kt' : null;
  const ciStr    = o?.ci        != null ? `CI ${o.ci}`                           : null;
  const altnApt  = o?.altnApt   || null;
  const altnFuel = o?.altnFuel  != null ? fuelStr(o.altnFuel)                   : null;
  const statsItems = [
    dist  ? { label:'距離', val: dist }                                          : null,
    wcStr ? { label:'Wind Comp', val: wcStr, cls: wcRaw < 0 ? 'neg' : 'pos' }   : null,
    ciStr ? { label:'Cost Index', val: ciStr }                                   : null,
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

  return `
    <div class="card arc-wrap" style="margin-bottom:10px">

      <!-- Header: ICAO names + flight badge -->
      <div class="arc-hdr">
        <div class="arc-apt">${dep}</div>
        <div class="arc-badge">${fltNo}</div>
        <div class="arc-apt arc-apt-r">${dest}</div>
      </div>

      <!-- SVG arc — max-width constrained so wide screens don't look empty -->
      <div style="position:relative;max-width:420px;margin:0 auto">
        <svg viewBox="0 0 300 68" width="100%"
             style="display:block;overflow:visible">
          <defs>
            <linearGradient id="arcGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stop-color="#c49a3c" stop-opacity="1"/>
              <stop offset="50%"  stop-color="#f0d080" stop-opacity="1"/>
              <stop offset="100%" stop-color="#c49a3c" stop-opacity="0.45"/>
            </linearGradient>
          </defs>
          <path d="M 18,63 C 85,5 215,5 282,63"
            stroke="url(#arcGrad)" stroke-width="2.5" fill="none"
            stroke-linecap="round"/>
          <circle cx="18"  cy="63" r="4" fill="#c49a3c" opacity="0.9"/>
          <circle cx="282" cy="63" r="4" fill="#c49a3c" opacity="0.45"/>
        </svg>
        <div style="position:absolute;top:0;left:50%;transform:translateX(-50%)">
          <span class="arc-fl-chip">${flChip}</span>
        </div>
      </div>

      <!-- Footer: STD | ETE/Block | STA -->
      <div class="arc-footer">
        <div class="arc-tblock">
          <div class="arc-tlbl">STD</div>
          <div class="arc-tutc">${std}</div>
          ${stdL ? `<div class="arc-tloc">${stdL}</div>` : ''}
        </div>
        <div class="arc-center">
          <div class="arc-ete">${ete}</div>
          <div class="arc-sub">Block ${blockStr} · Rem ${remStr}</div>
          ${reg !== '—' ? `<div class="arc-sub" style="color:var(--blue)">${reg}${date ? ' · ' + _dateLabel(date) : ''}${ofpNo ? `  <span style="color:var(--gold);font-weight:700">OFP ${_esc(ofpNo)}</span>` : ''}</div>` : ''}
          ${pic ? `<div class="arc-sub" style="margin-top:2px">PIC <span style="font-weight:700;color:var(--text)">${_esc(pic)}</span></div>` : ''}
        </div>
        <div class="arc-tblock arc-tblock-r">
          <div class="arc-tlbl">STA</div>
          <div class="arc-tutc">${sta}</div>
          ${staL ? `<div class="arc-tloc">${staL}</div>` : ''}
        </div>
      </div>

      ${statsHtml}

      <!-- Weather + Gate inputs row -->
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
        <!-- Weather row (height may vary with content) -->
        <div class="grid2f" style="gap:12px;margin-bottom:8px">
          <div>
            <div class="wx-hdr">${dep} WX</div>
            <div id="wx-${toICAO(dep)}-inline" class="wx-body-sm"><div class="wx-spin-sm"></div></div>
          </div>
          <div>
            <div class="wx-hdr">${dest} WX</div>
            <div id="wx-${toICAO(dest)}-inline" class="wx-body-sm"><div class="wx-spin-sm"></div></div>
          </div>
        </div>
        <!-- Gate row — always parallel, independent of WX height above -->
        <div class="grid2f" style="gap:12px;margin-bottom:10px">
          <div>
            <div class="brief-lbl">Dep Gate</div>
            <input id="c-dep" class="input" type="text" style="height:36px;padding:6px 10px"
              value="${_esc(crew.dep_gate||'')}" placeholder="B3"/>
          </div>
          <div>
            <div class="brief-lbl">Arr Gate</div>
            <input id="c-arr" class="input" type="text" style="height:36px;padding:6px 10px"
              value="${_esc(crew.arr_gate||'')}" placeholder="A8"/>
          </div>
        </div>
        <!-- Water + Wx Note + Copy -->
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
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
      </div>
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
  return `<div style="${mono};font-size:11px;color:var(--text);line-height:1.6">${items.map(_esc).join('  ')}</div>`;
}

// ── Extra fuel input + total ──────────────────────────────────────

function _extraFuelInputHtml(o, crew) {
  if (o.toFuel == null) return '';
  const extra = crew.extra_fuel != null ? crew.extra_fuel : '';
  const total = (extra !== '') ? o.toFuel + Number(extra) : o.toFuel;
  return `
    <div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;color:var(--text2);flex:1">+ 機長追加油量</span>
        <input id="c-extra-fuel" class="input" type="number" min="0" step="50"
          value="${_esc(String(extra))}" placeholder="0"
          style="width:90px;height:32px;padding:4px 8px;text-align:right;font-size:13px"/>
        <span style="font-size:12px;color:var(--text2)">kg</span>
      </div>
      <div style="background:var(--surface);border-radius:8px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:13px">Total Fuel
          <span style="font-size:10px;color:var(--text3);font-weight:400">（報告油量）</span>
        </span>
        <span id="c-total-fuel" style="color:var(--gold);font-size:17px;font-weight:800;font-family:'JetBrains Mono','SF Mono',monospace">${fuelStr(total)}</span>
      </div>
    </div>`;
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
    { label: 'Taxi',          val: o.taxiFuel },
  ].filter(x => has(x.val));

  if (!items.length) return '<div style="color:var(--text3);font-size:13px">暫無燃油資料</div>';

  return items.map(f => {
    const dim = f.val === 0 ? 'opacity:.35;' : '';
    return `<div class="data-row" style="${dim}">
      <span class="data-label">${f.label}</span>
      <span class="data-val">${fuelStr(f.val)}</span>
    </div>`;
  }).join('') + (has(o.toFuel) ? `
    <div style="background:var(--surface);border-radius:8px;padding:8px 12px;margin-top:10px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700">Takeoff Fuel</span>
      <span style="color:var(--gold);font-size:17px;font-weight:800;font-family:'JetBrains Mono','SF Mono',monospace">${fuelStr(o.toFuel)}</span>
    </div>` : '');
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
  const gates = [
    crew.dep_gate ? `DEP Gate ${crew.dep_gate}` : '',
    crew.arr_gate ? `ARR Gate ${crew.arr_gate}` : '',
  ].filter(Boolean).join('  ·  ');

  // Fuel total
  const toFuel   = store.briefing?.ofp?.toFuel;
  const extraFuel = crew.extra_fuel || 0;
  const fuelLine = toFuel != null
    ? `Fuel Order: ${fuelStr(toFuel + extraFuel)}${extraFuel ? ` (OFP ${fuelStr(toFuel)} + Capt add ${fuelStr(extraFuel)})` : ''}`
    : '';

  // MEL / CDL summary from ELB
  let melLine = '';
  const elb = store.elbData;
  if (elb && !elb.loading && !elb.error) {
    const logs = elb.mel || [];
    if (!logs.length) {
      melLine = 'MEL/CDL: ✓ Clear';
    } else {
      const sortedC = [...logs].sort((a,b) => {
        const typeOrder = { MEL: 0, CDL: 1, OTH: 2 };
        const ta = typeOrder[a._refType] ?? 2, tb = typeOrder[b._refType] ?? 2;
        if (ta !== tb) return ta - tb;
        return (a._expireDays ?? Infinity) - (b._expireDays ?? Infinity);
      });
      const items  = sortedC.map(m => {
        const type  = m._refType || 'MEL';
        const code  = (m._refType !== 'OTH' && m._melCode) ? ` ${m._melCode}` : '';
        const cat   = m._category ? ` Cat ${m._category}` : '';
        const expir = m._expireDays != null ? ` (${m._expireDays}d)`
                    : m._expireLimit        ? ` (${m._expireLimit})` : '';
        return `${type}${code}${cat}${expir}`;
      }).join(' | ');
      melLine = `MEL/CDL/OTH (${logs.length}): ${items}`;
    }
  }

  return [
    `${fltNo}  ${dep} → ${dest}`,
    `STD ${t.std||'—'}  STA ${t.sta||'—'}`,
    `ETE ${ete}  Block ${blk}`,
    gates,
    `Cruise FL${fl}  Water ${water}`,
    fuelLine,
    `Wx: ${wx}`,
    melLine,
  ].filter(Boolean).join('\n');
}

function _bindCrew(crewKey, fltNo, dep, dest, t, cruiseFL, block, o) {
  const copyBtn = document.getElementById('c-copy');
  if (!copyBtn) return;

  function _save() {
    const crew = storage.get(crewKey, {});
    crew.dep_gate   = document.getElementById('c-dep')?.value   || '';
    crew.arr_gate   = document.getElementById('c-arr')?.value   || '';
    crew.water_pct  = parseInt(document.getElementById('c-water')?.value || '100', 10);
    crew.wx_note    = document.getElementById('c-wx')?.value    || '';
    const extraRaw  = document.getElementById('c-extra-fuel')?.value;
    crew.extra_fuel = (extraRaw !== '' && extraRaw != null) ? parseInt(extraRaw, 10) || 0 : null;
    storage.set(crewKey, crew);
  }

  ['c-dep','c-arr','c-water','c-wx'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _save);
  });

  // Extra fuel: save + live-update total display
  const extraFuelEl = document.getElementById('c-extra-fuel');
  if (extraFuelEl) {
    extraFuelEl.addEventListener('input', () => {
      _save();
      const extra   = parseInt(extraFuelEl.value || '0', 10) || 0;
      const toFuel  = o?.toFuel ?? store.briefing?.ofp?.toFuel ?? 0;
      const totalEl = document.getElementById('c-total-fuel');
      if (totalEl) totalEl.textContent = fuelStr(toFuel + extra);
    });
  }

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
  if (badge) {
    badge.style.display = 'inline-block';
    if (!logs.length) {
      badge.style.cssText = 'display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:12px;background:rgba(34,197,94,.2);color:var(--green)';
      badge.textContent = '✓ Clear';
    } else {
      const melCnt = logs.filter(m => m._refType === 'MEL').length;
      const cdlCnt = logs.filter(m => m._refType === 'CDL').length;
      const othCnt = logs.filter(m => m._refType === 'OTH' || (!m._refType)).length;
      const parts  = [
        melCnt ? `${melCnt} MEL` : '',
        cdlCnt ? `${cdlCnt} CDL` : '',
        othCnt ? `${othCnt} OTH` : '',
      ].filter(Boolean);
      badge.style.cssText = 'display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:12px;background:rgba(245,158,11,.2);color:var(--gold)';
      badge.textContent = parts.join(' · ');
    }
  }

  if (!logs.length) {
    body.innerHTML = '<div style="color:var(--green);font-size:13px;padding:8px 0">✓ 無暫緩故障</div>';
    return;
  }

  const sorted = [...logs].sort((a,b) => {
    // Sort: MEL first, then CDL, then OTH; within each group sort by expiry
    const typeOrder = { MEL: 0, CDL: 1, OTH: 2 };
    const ta = typeOrder[a._refType] ?? 2, tb = typeOrder[b._refType] ?? 2;
    if (ta !== tb) return ta - tb;
    return (a._expireDays ?? Infinity) - (b._expireDays ?? Infinity);
  });
  body.innerHTML = sorted.map(m => {
    const desc = m.faultDescription || m.defectDescription || '（無描述）';
    const cat  = m._category || '';
    const days = m._expireDays;
    const expCls  = days != null ? (days <= 7 ? 'urgent' : days <= 30 ? 'warn' : 'ok') : '';
    const expHtml = days != null
      ? `<span style="font-size:11px;padding:1px 7px;border-radius:10px;${_expStyle(expCls)}">到期 ${days} 天</span>`
      : m._expireLimit
      ? `<span style="font-size:11px;padding:1px 7px;border-radius:10px;background:rgba(96,165,250,.15);color:var(--blue)">限制 ${m._expireLimit}</span>`
      : '';
    const catMap = {
      A: 'rgba(239,68,68,.3);color:var(--red)',
      B: 'rgba(245,158,11,.3);color:var(--gold)',
      C: 'rgba(250,204,21,.3);color:#fbbf24',
      D: 'rgba(148,163,184,.2);color:var(--text2)',
      O: 'rgba(96,165,250,.2);color:var(--blue)',
    };
    const catHtml = cat
      ? `<span style="font-size:11px;font-weight:700;padding:1px 7px;border-radius:10px;background:${catMap[cat]||catMap.D}">Cat ${cat}</span>` : '';
    // Type chip: colour-coded by refType
    const typeStyle = {
      MEL: 'background:rgba(245,158,11,.2);color:var(--gold)',
      CDL: 'background:rgba(250,204,21,.15);color:#fbbf24',
      OTH: 'background:rgba(96,165,250,.15);color:var(--blue)',
    }[m._refType] || 'background:rgba(245,158,11,.2);color:var(--gold)';
    const typeChip = `<span style="font-size:11px;font-weight:800;padding:1px 7px;border-radius:10px;${typeStyle}">${m._refType || 'MEL'}</span>`;
    const codeStr  = (m._refType !== 'OTH' && m._melCode)
      ? `<span style="font-size:12px;font-weight:700;color:var(--text)">${m._melCode}</span>` : '';
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        ${typeChip}${codeStr}
      </div>
      <div style="font-size:13px;color:var(--text)">${desc}</div>
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:4px">
        ${m.deferralRefNum ? `<span style="font-size:11px;color:var(--text3)">REF ${m.deferralRefNum}</span>` : ''}
        ${catHtml}${expHtml}
      </div>
    </div>`;
  }).join('');
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

    /* ── Arc ── */
    .arc-hdr    { display:flex; justify-content:space-between; align-items:center; margin-bottom:2px; }
    .arc-apt    { font-size:24px; font-weight:800; letter-spacing:-.5px; }
    .arc-apt-r  { text-align:right; }
    .arc-badge  { font-size:13px; font-weight:700; color:var(--gold);
                  background:rgba(196,154,60,.10); border:1px solid rgba(196,154,60,.25);
                  padding:3px 14px; border-radius:20px; }
    .arc-fl-chip { font-family:'JetBrains Mono','SF Mono',monospace;
                   font-size:12px; font-weight:700; color:var(--gold);
                   background:rgba(196,154,60,.12); border:1px solid rgba(196,154,60,.28);
                   border-radius:20px; padding:2px 12px; white-space:nowrap; }
    .arc-footer { display:flex; justify-content:space-between; align-items:flex-start; margin-top:6px; }
    .arc-tblock  { min-width:72px; }
    .arc-tblock-r { text-align:right; }
    .arc-tlbl   { font-size:10px; color:var(--text3); text-transform:uppercase; letter-spacing:.05em; }
    .arc-tutc   { font-family:'JetBrains Mono','SF Mono',monospace;
                  font-size:19px; font-weight:800; line-height:1.15; }
    .arc-tloc   { font-size:11px; color:var(--text3); }
    .arc-center { text-align:center; flex:1; }
    .arc-ete    { font-family:'JetBrains Mono','SF Mono',monospace;
                  font-size:26px; font-weight:800; line-height:1.1; }
    .arc-sub    { font-size:11px; color:var(--text3); margin-top:1px; }

    /* ── Flight data stats strip ── */
    .arc-stats     { display:grid; grid-template-columns:repeat(auto-fit,minmax(80px,1fr));
                     gap:0; border-top:1px solid var(--border); margin-top:10px; padding-top:10px; }
    .arc-stat      { text-align:center; padding:4px 6px; }
    .arc-stat-lbl  { font-size:10px; color:var(--text3); text-transform:uppercase;
                     letter-spacing:.05em; margin-bottom:2px; }
    .arc-stat-val  { font-family:'JetBrains Mono','SF Mono',monospace;
                     font-size:13px; font-weight:700; color:var(--text); }
    .arc-stat-neg  { color:var(--red) !important; }
    .arc-stat-pos  { color:var(--green) !important; }

    /* ── Weather inline ── */
    .wx-hdr     { font-size:11px; font-weight:700; color:var(--gold);
                  text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
    .wx-body-sm { min-height:16px; }
    .wx-spin-sm { display:inline-block; width:12px; height:12px;
                  border:2px solid var(--border); border-top-color:var(--gold);
                  border-radius:50%; animation:spin .8s linear infinite; }

    /* ── Crew form ── */
    .brief-lbl  { font-size:11px; color:var(--text3); text-transform:uppercase;
                  letter-spacing:.04em; margin-bottom:4px; }
    .btn-copy-sm { background:rgba(196,154,60,.12); border:1px solid rgba(196,154,60,.25);
                   color:var(--gold); border-radius:8px; cursor:pointer;
                   font-size:13px; font-weight:700; padding:6px 14px;
                   white-space:nowrap; flex-shrink:0; }
    .btn-copy-sm:active { opacity:.7; }
  `;
  document.head.appendChild(s);
}
