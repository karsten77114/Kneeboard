// Flight Crew > Weather
import store from '../store.js';
import storage from '../services/storage.js';
import { fetchAtis, fetchMetar, preloadMetarForFlight } from '../services/api.js';
import { showToast, toICAO, toIATA } from '../utils.js';

const WORKER = 'https://jx-briefing.karsten77114.workers.dev';

// ── Module-level state ───────────────────────────────────────────
const SUB_TABS = [
  { id: 'metar',  label: 'METAR/TAF' },
  { id: 'atis',   label: 'D-ATIS' },
  { id: 'chart',  label: 'OFP Charts' },
  { id: 'wni',    label: 'WNI' },
  { id: 'sigwx',  label: 'SIGWX/TC' },
  { id: 'turbli', label: 'Turbli' },
  { id: 'cold',   label: 'Cold Temp' },
];

// ── Chart state ──────────────────────────────────────────────────
let _chartsData  = null;
let _activeGroup = 0;
let _activeSub   = 0;
let _chartZoom   = 1.0;

// ── ATIS state ───────────────────────────────────────────────────
let _atisCache   = {};
const _atisPending = new Set();
let _atisShown   = null;

let _activeSubTab    = 'metar';
let _metarActiveIcao = null;   // active airport in METAR sub-tab

// ── Helpers ──────────────────────────────────────────────────────

function _airports() {
  const b = store.briefing;
  const f = store.flight;
  const seen = new Set();
  const list = [];
  const add = (raw, role) => {
    if (!raw || raw === '—') return;
    const ic = toICAO(raw);
    if (!ic || seen.has(ic)) return;
    seen.add(ic);
    list.push({ icao: ic, role });
  };
  if (b) {
    add(b.dep,  'DEP');
    add(b.dest, 'DEST');
    const altn = b.ofp?.altnApt || b.ofp?.altn || b.altn || b.alternate || null;
    add(altn, 'ALTN');
    for (const a of (b.wxAirports || [])) add(a, 'WX');
  } else if (f) {
    add(f.dep,  'DEP');
    add(f.dest, 'DEST');
  }
  return list;
}

// ── NATO Military colour coding ───────────────────────────────────
// VIS thresholds (metres): BLU≥8000 / WHT≥5000 / GRN≥3700 / YLO≥1600 / AMB≥800 / RED<800
// CEL thresholds (feet):   BLU≥2500 / WHT≥1500 / GRN≥700  / YLO≥300  / AMB≥200 / RED<200
function _natoVis(m)  {
  if (m >= 8000) return 'nato-blu';
  if (m >= 5000) return 'nato-wht';
  if (m >= 3700) return 'nato-grn';
  if (m >= 1600) return 'nato-ylo';
  if (m >= 800)  return 'nato-amb';
  return 'nato-red';
}
function _natoCeil(ft) {
  if (ft >= 2500) return 'nato-blu';
  if (ft >= 1500) return 'nato-wht';
  if (ft >= 700)  return 'nato-grn';
  if (ft >= 300)  return 'nato-ylo';
  if (ft >= 200)  return 'nato-amb';
  return 'nato-red';
}
function _colorizeWX(raw) {
  if (!raw) return '';
  let t = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // CAVOK / NSC / SKC / CLR → BLU
  t = t.replace(/\bCAVOK\b/g, '<span class="nato-blu">CAVOK</span>');
  t = t.replace(/\b(NSC|NCD|SKC|CLR)\b/g, m => `<span class="nato-blu">${m}</span>`);
  // SCT | BKN | OVC | VV → colored by ceiling height
  t = t.replace(/\b(SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?\b/g, (m, cov, hund, type) => {
    const cls = _natoCeil(parseInt(hund) * 100);
    return `<span class="${cls}">${m}</span>`;
  });
  // Metric visibility 4-digit ≤9999
  t = t.replace(/(?<!\/)(\b\d{4}\b)(?!\/)/g, m => {
    const v = parseInt(m);
    if (v > 9999) return m;
    return `<span class="${_natoVis(v === 9999 ? 10000 : v)}">${m}</span>`;
  });
  return t;
}
function _formatTAF(raw) {
  if (!raw) return raw;
  return raw
    .replace(/\s+(TEMPO|BECMG|PROB\d{2}\s+TEMPO|PROB\d{2}|INTER|FM\d{6})\b/g, '\n  $1')
    .trim();
}
function _stripWxType(raw) {
  if (!raw) return raw;
  return raw.replace(/^(METAR|SPECI|TAF(?:\s+AMD)?)\s+/, '');
}
function _getCeiling(raw) {
  let ceil = 99999;
  const re = /(BKN|OVC|VV)(\d{3})/g; let m;
  while ((m = re.exec(raw)) !== null) { const ft = parseInt(m[2]) * 100; if (ft < ceil) ceil = ft; }
  return ceil;
}
function _flightCat(metar) {
  const raw = typeof metar === 'string' ? metar : '';
  if (!raw) return 'UNKN';
  if (/\bCAVOK\b/.test(raw) || /\b(NSC|NCD|SKC|CLR)\b/.test(raw)) return 'VFR';
  let visSM = 99;
  const m4 = raw.match(/(?:^|\s)(\d{4})(?:\s|$)/);
  if (m4) visSM = parseInt(m4[1]) / 1852;
  const mixedSm = raw.match(/\b(\d+)\s+(\d+)\/(\d+)SM\b/);
  if (mixedSm) visSM = parseInt(mixedSm[1]) + parseInt(mixedSm[2]) / parseInt(mixedSm[3]);
  else { const sm = raw.match(/\bM?(\d+)(?:\/(\d+))?SM\b/); if (sm) visSM = sm[2] ? parseInt(sm[1]) / parseInt(sm[2]) : parseInt(sm[1]); }
  const ceil = _getCeiling(raw);
  if (ceil < 500  || visSM < 1) return 'LIFR';
  if (ceil < 1000 || visSM < 3) return 'IFR';
  if (ceil < 3000 || visSM < 5) return 'MVFR';
  return 'VFR';
}
function _catClass(cat) {
  const map = { VFR:'aw-vfr', MVFR:'aw-mvfr', IFR:'aw-ifr', LIFR:'aw-lifr' };
  return map[cat] || 'aw-unkn';
}

// ── Styles ───────────────────────────────────────────────────────

function _applyStyles() {
  if (document.getElementById('wx-style')) return;
  const s = document.createElement('style');
  s.id = 'wx-style';
  s.textContent = `
    /* ── AeroWeather-style card ── */
    .aw-card { background:var(--surface); border-radius:12px; border:1px solid var(--border);
               margin-bottom:10px; overflow:hidden; display:flex; }
    .aw-stripe { width:5px; flex-shrink:0; }
    .aw-body   { flex:1; min-width:0; }
    .aw-vfr  .aw-stripe { background:#4ade80; }
    .aw-mvfr .aw-stripe { background:#60a5fa; }
    .aw-ifr  .aw-stripe { background:#f87171; }
    .aw-lifr .aw-stripe { background:#e879f9; }
    .aw-unkn .aw-stripe { background:var(--border); }
    .aw-header { display:flex; align-items:center; gap:8px; padding:10px 12px 6px; flex-wrap:wrap; }
    .aw-icao   { font-size:17px; font-weight:800; font-family:'SF Mono',ui-monospace,monospace; letter-spacing:.5px; }
    .aw-role   { font-size:10px; font-weight:700; letter-spacing:.6px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,.08); color:var(--text2); }
    .aw-fc-badge { font-size:11px; font-weight:700; letter-spacing:.5px; padding:2px 7px; border-radius:4px; margin-left:auto; }
    .aw-vfr  .aw-fc-badge { background:rgba(74,222,128,.18); color:#4ade80; }
    .aw-mvfr .aw-fc-badge { background:rgba(96,165,250,.18); color:#60a5fa; }
    .aw-ifr  .aw-fc-badge { background:rgba(248,113,113,.18); color:#f87171; }
    .aw-lifr .aw-fc-badge { background:rgba(232,121,249,.18); color:#e879f9; }
    .aw-unkn .aw-fc-badge { background:rgba(255,255,255,.08); color:var(--text3); }
    .aw-times { padding:0 12px 8px; font-size:11px; color:var(--text3); font-family:'SF Mono',ui-monospace,monospace; }
    .aw-sec   { padding:4px 12px 2px; font-size:10px; color:var(--text3); letter-spacing:.5px; text-transform:uppercase; border-top:1px solid var(--border); }
    .aw-raw   { padding:6px 12px 10px; font-family:'SF Mono',ui-monospace,monospace; font-size:12px; line-height:1.6; color:var(--text); white-space:pre-wrap; word-break:break-word; }
    .aw-taf   { font-size:11px; color:var(--text2); }
    .aw-refr  { margin-left:auto; background:none; border:1px solid var(--border); color:var(--text2); border-radius:6px; padding:2px 8px; font-size:12px; cursor:pointer; }
    .aw-loading-dot { display:inline-block; width:10px; height:10px; border:2px solid var(--border); border-top-color:var(--text3); border-radius:50%; animation:spin .8s linear infinite; }

    /* ── NATO colours ── */
    .nato-blu { color:#60a5fa; }
    .nato-wht { color:#e2e8f0; }
    .nato-grn { color:#4ade80; }
    .nato-ylo { color:#fbbf24; }
    .nato-amb { color:#fb923c; }
    .nato-red { color:#f87171; font-weight:600; }

    /* ── OFP Chart tab ── */
    .chart-group-btn { flex-shrink:0; font-size:11px; font-weight:600; letter-spacing:.3px;
                       padding:5px 12px; border-radius:20px; background:var(--surface);
                       border:1px solid var(--border); color:var(--text2); cursor:pointer; }
    .chart-group-btn.active { background:var(--accent); border-color:var(--accent); color:#fff; }
    .chart-sub-btn  { flex-shrink:0; font-size:11px; font-weight:600; padding:4px 10px; border-radius:16px;
                      background:rgba(255,255,255,.06); border:1px solid var(--border); color:var(--text2); cursor:pointer; }
    .chart-sub-btn.active { background:rgba(99,102,241,.2); border-color:var(--accent); color:var(--accent); }
  `;
  document.head.appendChild(s);
}

// ── Mount / Unmount ──────────────────────────────────────────────

export function mount(container) {
  _applyStyles();
  _render(container);
  container._unsub = store.subscribe(() => _render(container));
  // Trigger pre-fetch for any airport not yet in wxData
  const missing = _airports().filter(({ icao }) => !store.wxData[icao]).map(a => a.icao);
  if (missing.length) preloadMetarForFlight(missing).catch(() => {});
}

export function unmount(container) {
  if (container._unsub) container._unsub();
}

// ── Top-level render ─────────────────────────────────────────────

function _render(container) {
  container.innerHTML = `
    <div class="sub-tabbar" id="wx-subtabs">
      ${SUB_TABS.map(t => `
        <button class="sub-tab-btn ${t.id === _activeSubTab ? 'active' : ''}"
                data-tab="${t.id}">${t.label}</button>
      `).join('')}
    </div>
    <div id="wx-panel" class="view-content"></div>`;

  container.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.onclick = () => {
      _activeSubTab = btn.dataset.tab;
      container.querySelectorAll('.sub-tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === _activeSubTab));
      _renderPanel(container.querySelector('#wx-panel'));
      if (_activeSubTab === 'atis' && !_atisShown) {
        const apts = _airports();
        if (apts.length) _loadAtis(container.querySelector('#wx-panel'), apts[0].icao);
      }
    };
  });

  const panel = container.querySelector('#wx-panel');
  _renderPanel(panel);

  // Auto-load ATIS for first airport if ATIS tab is active
  if (_activeSubTab === 'atis' && !_atisShown) {
    const apts = _airports();
    if (apts.length) _loadAtis(panel, apts[0].icao);
  }
}

function _renderPanel(panel) {
  switch (_activeSubTab) {
    case 'metar':  _renderMetar(panel);  break;
    case 'atis':   _renderAtis(panel);   break;
    case 'chart':  _renderChart(panel);  break;
    case 'wni':    _renderWni(panel);    break;
    case 'sigwx':  _renderSigwx(panel);  break;
    case 'turbli': _renderTurbli(panel); break;
    case 'cold':   _renderCold(panel);   break;
  }
}

// ══════════════════════════════════════════════════════════════════
// METAR / TAF
// ══════════════════════════════════════════════════════════════════

function _awCard(icao, role) {
  const c   = store.wxData[icao];
  const cat = c?.metar ? _flightCat(c.metar) : 'UNKN';
  const cls = _catClass(cat);

  if (!c || c.loading) {
    return `
      <div class="aw-card aw-unkn" style="margin-bottom:10px">
        <div class="aw-stripe"></div>
        <div class="aw-body">
          <div class="aw-header">
            <span class="aw-icao">${icao}</span>
            ${role ? `<span class="aw-role">${role}</span>` : ''}
            <button class="aw-refr" id="refr-${icao}">↻</button>
          </div>
          <div class="aw-raw" style="color:var(--text3);font-size:12px">
            <span class="aw-loading-dot"></span> 查詢中…
          </div>
        </div>
      </div>`;
  }

  if (c.error) {
    return `
      <div class="aw-card aw-unkn" style="margin-bottom:10px">
        <div class="aw-stripe"></div>
        <div class="aw-body">
          <div class="aw-header">
            <span class="aw-icao">${icao}</span>
            ${role ? `<span class="aw-role">${role}</span>` : ''}
            <button class="aw-refr" id="refr-${icao}">↻</button>
          </div>
          <div class="aw-raw" style="color:var(--text3);font-size:12px">${c.error}</div>
        </div>
      </div>`;
  }

  const ageMin = c.fetchedAt ? Math.round((Date.now() - c.fetchedAt) / 60000) : null;
  const tafFormatted = c.taf ? _formatTAF(c.taf) : null;

  return `
    <div class="aw-card ${cls}" style="margin-bottom:10px">
      <div class="aw-stripe"></div>
      <div class="aw-body">
        <div class="aw-header">
          <span class="aw-icao">${icao}</span>
          ${role ? `<span class="aw-role">${role}</span>` : ''}
          <span class="aw-fc-badge">${cat}</span>
          <button class="aw-refr" id="refr-${icao}">↻</button>
        </div>
        ${ageMin !== null ? `<div class="aw-times"><span>${ageMin} min ago</span></div>` : ''}
        <div class="aw-sec">METAR</div>
        <div class="aw-raw">${_colorizeWX(_stripWxType(c.metar) || '—')}</div>
        ${tafFormatted ? `<div class="aw-sec">TAF</div><div class="aw-raw aw-taf">${_colorizeWX(_stripWxType(tafFormatted))}</div>` : ''}
      </div>
    </div>`;
}

// colour hex for flight cat sub-tabs
const _catColor  = { VFR:'#4ade80', MVFR:'#60a5fa', IFR:'#f87171', LIFR:'#e879f9', UNKN:'' };
// colour for airport role badge (independent of wx condition)
const _roleColor = { DEP:'#c49a3c', DEST:'#60a5fa', ALTN:'#fb923c', WX:'rgba(184,193,236,0.25)' };
const _roleText  = { DEP:'#0c1118', DEST:'#0c1118', ALTN:'#0c1118', WX:'#b8c1ec' };

function _renderMetar(panel) {
  const apts = _airports();

  // Auto-select first airport only when nothing is active yet
  if (apts.length && !_metarActiveIcao) {
    _metarActiveIcao = apts[0].icao;
  }

  // Active airport may be from tab or manual search (not necessarily in apts)
  const activeApt  = apts.find(a => a.icao === _metarActiveIcao);
  const activeRole = activeApt?.role || '';

  panel.innerHTML = `
    <!-- Tab bar + inline search in one row -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;margin-bottom:12px">
      ${apts.map(({ icao, role }) => {
        const c   = store.wxData[icao];
        const cat = c?.metar ? _flightCat(c.metar) : 'UNKN';
        const col = _catColor[cat] || 'var(--text3)';
        const rbg = _roleColor[role] || _roleColor.WX;
        const rtx = _roleText[role]  || _roleText.WX;
        const isActive = icao === _metarActiveIcao;
        return `
          <button class="metar-apt-btn" data-icao="${icao}"
            style="display:flex;flex-direction:column;align-items:center;gap:3px;
                   padding:5px 12px 6px;border-radius:8px;
                   border:1.5px solid ${isActive ? col : 'var(--border)'};
                   border-top:3px solid ${rbg};
                   background:${isActive ? `rgba(${_catRgb(cat)},0.12)` : 'var(--surface)'};
                   cursor:pointer;transition:all .15s;min-width:64px">
            <span style="font-size:9px;font-weight:800;letter-spacing:.7px;
                         background:${rbg};color:${rtx};
                         padding:1px 6px;border-radius:3px;line-height:1.6">${role}</span>
            <span style="font-size:13px;font-weight:800;font-family:'JetBrains Mono','SF Mono',monospace;
                         color:${isActive ? col : 'var(--text)'}">${icao}</span>
            <span style="font-size:9px;font-weight:700;letter-spacing:.4px;
                         color:${col || 'var(--text3)'}">● ${cat}</span>
          </button>`;
      }).join('')}

      <!-- Inline search — aligned to the end of the tab row -->
      <div style="display:flex;gap:6px;align-items:center;padding:4px 0;margin-left:auto;flex-shrink:0">
        <input class="input input-upper" id="metar-icao"
               placeholder="ICAO / IATA" style="width:110px;height:36px;font-size:13px">
        <button class="btn btn-ghost btn-sm" id="btn-metar-go"
                style="height:36px;white-space:nowrap">查詢</button>
      </div>
    </div>

    <!-- Active card (tab selection or manual search result) -->
    <div id="metar-card-wrap">
      ${_metarActiveIcao ? _awCard(_metarActiveIcao, activeRole) : `
        <div class="state-screen" style="min-height:20vh">
          <div class="state-icon">🌤</div>
          <div class="state-sub">查詢航班後自動帶入起、訖、備降機場</div>
        </div>`}
    </div>`;

  // Tab click → switch active airport
  panel.querySelectorAll('.metar-apt-btn').forEach(btn => {
    btn.onclick = () => {
      _metarActiveIcao = btn.dataset.icao;
      _renderMetar(panel);
    };
  });

  // Preload all flight airports
  apts.forEach(({ icao }) => {
    if (!store.wxData[icao]) preloadMetarForFlight([icao]).catch(() => {});
  });

  // Bind refresh on current card
  if (_metarActiveIcao) {
    panel.querySelector(`#refr-${_metarActiveIcao}`)?.addEventListener('click', () => {
      store.setWxData(_metarActiveIcao, null);
      preloadMetarForFlight([_metarActiveIcao]).catch(() => {});
    });
  }

  // Inline manual search
  const _manualSearch = () => {
    const icao = toICAO(panel.querySelector('#metar-icao').value.trim().toUpperCase());
    if (!icao) return;
    _metarActiveIcao = icao;
    _renderMetar(panel);
    if (!store.wxData[icao] || store.wxData[icao].error) {
      preloadMetarForFlight([icao]).catch(() => {});
    }
  };
  panel.querySelector('#btn-metar-go').onclick = _manualSearch;
  panel.querySelector('#metar-icao').addEventListener('keydown', e => { if (e.key === 'Enter') _manualSearch(); });
}

// helper: cat → RGB string for rgba()
function _catRgb(cat) {
  const map = { VFR:'74,222,128', MVFR:'96,165,250', IFR:'248,113,113', LIFR:'232,121,249' };
  return map[cat] || '255,255,255';
}

// ══════════════════════════════════════════════════════════════════
// D-ATIS
// ══════════════════════════════════════════════════════════════════

async function _loadAtis(panel, icao) {
  if (_atisPending.has(icao)) return;
  _atisShown = icao;
  _atisPending.add(icao);
  _atisCache[icao] = { loading: true };
  _updateAtisResult(panel, icao);

  try {
    const data = await fetchAtis(icao);
    _atisCache[icao] = {
      sections:  data.sections || [],
      fetchedAt: Date.now(),
      loading:   false,
      error:     null,
    };
  } catch (e) {
    _atisCache[icao] = { loading: false, error: e.message };
  }

  _atisPending.delete(icao);
  _updateAtisResult(panel, icao);
}

function _updateAtisResult(panel, icao) {
  const res = panel.querySelector('#atis-result');
  if (!res) return;
  const c = _atisCache[icao];

  if (!c || c.loading) {
    res.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;color:var(--text2);font-size:13px">
        <div class="spinner" style="width:18px;height:18px;border-width:2px"></div>
        查詢 ${icao} ATIS…
      </div>`;
    return;
  }

  if (c.error) {
    res.innerHTML = `<div class="err-msg">${icao} — ${c.error}</div>`;
    return;
  }

  // Filter out METAR/TAF — those are shown in the METAR/TAF tab
  const atisOnly = (c.sections || []).filter(s => !/^(metar|taf|speci)$/i.test(s.title.trim()));

  if (!atisOnly.length) {
    res.innerHTML = `
      <div class="card">
        <div style="color:var(--text3);font-size:13px">${icao} 目前無 D-ATIS 資料<br>
          <span style="font-size:11px">請使用 ACARS 或無線電確認</span>
        </div>
      </div>`;
    return;
  }

  const timeStr = c.fetchedAt ? new Date(c.fetchedAt).toISOString().slice(11,16) + 'Z' : '';
  const iconFor = t => {
    const tl = t.toLowerCase();
    if (tl.includes('arr')) return '🛬';
    if (tl.includes('dep')) return '🛫';
    return '📻';
  };

  const ageMin = c.fetchedAt ? Math.round((Date.now() - c.fetchedAt) / 60000) : null;
  res.innerHTML = atisOnly.map(s => `
    <div class="card" style="margin-bottom:10px">
      <div class="card-title" style="display:flex;align-items:center;gap:6px">
        <span>${iconFor(s.title)} ${s.title}</span>
        <span style="font-size:10px;color:var(--text3);font-weight:400;margin-left:auto">${timeStr}</span>
      </div>
      <div class="route-box" style="color:var(--text);font-size:12px;line-height:1.8;white-space:pre-wrap">${s.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    </div>`).join('') +
    `<div style="color:var(--text3);font-size:11px;margin-top:4px;text-align:right">
      ${ageMin !== null ? ageMin + ' 分鐘前更新' : ''}
    </div>`;
}

function _renderAtis(panel) {
  const apts = _airports();

  panel.innerHTML = `
    <!-- Quick airport buttons -->
    ${apts.length ? `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${apts.map(({ icao, role }) => `
          <button class="btn btn-ghost btn-sm atis-quick"
                  data-icao="${icao}"
                  style="${_atisShown === icao ? 'border-color:#c49a3c;color:#c49a3c' : ''}">
            ${icao} <span style="font-size:10px;opacity:0.7">${role}</span>
          </button>
        `).join('')}
      </div>
    ` : ''}

    <!-- Manual input -->
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <input class="input input-upper" id="atis-icao"
             placeholder="ICAO (e.g. RCTP)" style="width:140px"
             value="${_atisShown || (apts[0]?.icao || '')}">
      <button class="btn btn-primary btn-sm" id="btn-atis-go">查詢</button>
      ${_atisShown ? `<button class="btn btn-ghost btn-sm" id="btn-atis-refr">↻ 重新整理</button>` : ''}
    </div>

    <div id="atis-result"></div>`;

  // Quick buttons
  panel.querySelectorAll('.atis-quick').forEach(btn => {
    btn.onclick = () => {
      panel.querySelector('#atis-icao').value = btn.dataset.icao;
      _loadAtis(panel, btn.dataset.icao);
    };
  });

  // Manual search (accept both IATA and ICAO)
  const goAtis = () => {
    const icao = toICAO(panel.querySelector('#atis-icao').value.trim().toUpperCase());
    if (icao) _loadAtis(panel, icao);
  };
  panel.querySelector('#btn-atis-go').onclick = goAtis;
  panel.querySelector('#atis-icao').addEventListener('keydown', e => { if (e.key === 'Enter') goAtis(); });

  // Refresh
  panel.querySelector('#btn-atis-refr')?.addEventListener('click', () => {
    if (_atisShown) {
      delete _atisCache[_atisShown];
      _loadAtis(panel, _atisShown);
    }
  });

  // Show cached or auto-load
  if (_atisShown && _atisCache[_atisShown]) {
    _updateAtisResult(panel, _atisShown);
  } else if (apts.length) {
    _loadAtis(panel, apts[0].icao);
  }
}

// ══════════════════════════════════════════════════════════════════
// OFP Charts (ported from PlanFlight charts.html)
// TODO: 未來可加入 Windy 嵌入式地圖作為補充天氣視覺化
// ══════════════════════════════════════════════════════════════════

function _renderChart(panel) {
  const b = store.briefing;

  if (!b?.legId) {
    panel.innerHTML = `
      <div class="state-screen" style="min-height:30vh">
        <div class="state-icon">🗺</div>
        <div class="state-title">尚未載入 OFP</div>
        <div class="state-sub">請先在主畫面查詢航班以載入圖表。</div>
      </div>`;
    return;
  }

  const token = storage.getLidoToken();
  if (!token) {
    panel.innerHTML = `
      <div class="state-screen" style="min-height:30vh">
        <div class="state-icon">🔐</div>
        <div class="state-title">LIDO 未連線</div>
        <div class="state-sub">請等待首頁自動連線後再試，或點「重新連線」。</div>
      </div>`;
    return;
  }

  // Build infobar
  const infoHtml = `
    <div style="font-size:11px;color:var(--text2);padding:0 0 8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.1);color:var(--text2)">OFP</span>
      <strong>${b.flightNumber || ''}</strong>
      ${toICAO(b.dep) || ''}→${toICAO(b.dest) || ''}
      <span style="color:var(--text3)">${b.date || ''}</span>
    </div>`;

  panel.innerHTML = infoHtml + `
    <div id="chart-group-tabs" style="display:flex;overflow-x:auto;gap:6px;padding-bottom:6px;scrollbar-width:none;margin-bottom:6px"></div>
    <div id="chart-sub-tabs"   style="display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:10px;display:none"></div>
    <div id="chart-wrap" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;min-height:200px">
      <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:60px 20px;color:var(--text2);font-size:12px">
        <div class="spinner"></div>
        <span>載入圖表清單…</span>
      </div>
    </div>
    <div style="display:flex;justify-content:center;gap:12px;padding:8px 0 4px">
      <button class="btn btn-ghost btn-sm" id="chart-zoom-out">－</button>
      <button class="btn btn-ghost btn-sm" id="chart-zoom-reset">⤢</button>
      <button class="btn btn-ghost btn-sm" id="chart-zoom-in">＋</button>
    </div>`;

  // Zoom controls
  const _doZoom = dir => {
    const img = panel.querySelector('#chart-img');
    if (!img) return;
    if (dir === 0) { _chartZoom = 1.0; img.style.width = '100%'; img.style.cursor = 'zoom-in'; }
    else {
      _chartZoom = dir > 0 ? Math.min(_chartZoom * 1.5, 5) : Math.max(_chartZoom / 1.5, 0.5);
      if (_chartZoom <= 1.0) { _chartZoom = 1.0; img.style.width = '100%'; img.style.cursor = 'zoom-in'; }
      else { img.style.width = (img.naturalWidth * _chartZoom) + 'px'; img.style.cursor = 'zoom-out'; }
    }
  };
  panel.querySelector('#chart-zoom-out').onclick   = () => _doZoom(-1);
  panel.querySelector('#chart-zoom-reset').onclick = () => _doZoom(0);
  panel.querySelector('#chart-zoom-in').onclick    = () => _doZoom(1);

  // Parse flight number + date from legId: JX.725.13May2026.TPE.KUL.
  const m = b.legId.match(/JX\.(\d+)\.(\d+)([A-Za-z]+)(\d+)\./);
  const flight = (b.flightNumber || '').replace(/[^0-9]/g, '');
  const monthMap = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const date = m ? m[4] + (monthMap[m[3].toLowerCase()] || '00') + m[2].padStart(2,'0') : (b.date || '');

  // Fetch chart list
  fetch(`${WORKER}/charts?sessionToken=${encodeURIComponent(token)}&flight=${flight}&date=${date}&legId=${encodeURIComponent(b.legId)}`)
    .then(async r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _chartsData  = await r.json();
      _activeGroup = 0;
      _activeSub   = 0;
      _chartZoom   = 1.0;
      // Log available categories for debugging VAA/TCA mismatches
      if (_chartsData.availableCategories?.length) {
        console.log('[Charts] LIDO categories:', _chartsData.availableCategories.join(', '));
      }
      _renderChartGroups(panel, token);
      _selectChartGroup(panel, token, 0);
    })
    .catch(e => {
      panel.querySelector('#chart-wrap').innerHTML =
        `<div style="color:var(--text3);font-size:13px;padding:40px;text-align:center">圖表載入失敗：${e.message}</div>`;
    });
}

function _renderChartGroups(panel, token) {
  const tabs = panel.querySelector('#chart-group-tabs');
  tabs.innerHTML = '';
  (_chartsData?.charts || []).forEach((g, i) => {
    const btn = document.createElement('button');
    btn.className = `chart-group-btn${i === 0 ? ' active' : ''}`;
    btn.textContent = g.group;
    btn.onclick = () => _selectChartGroup(panel, token, i);
    tabs.appendChild(btn);
  });
}

function _selectChartGroup(panel, token, idx) {
  _activeGroup = idx;
  _activeSub   = 0;
  _chartZoom   = 1.0;
  panel.querySelectorAll('.chart-group-btn').forEach((b, i) => b.classList.toggle('active', i === idx));

  const group = _chartsData?.charts?.[idx];
  if (!group) return;

  // Sub-tabs
  const subEl = panel.querySelector('#chart-sub-tabs');
  subEl.innerHTML = '';
  if (group.files.length > 1) {
    subEl.style.display = 'flex';
    group.files.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.className = `chart-sub-btn${i === 0 ? ' active' : ''}`;
      btn.textContent = f.label || `圖${i + 1}`;
      btn.onclick = () => {
        _activeSub = i;
        _chartZoom = 1.0;
        panel.querySelectorAll('.chart-sub-btn').forEach((b, j) => b.classList.toggle('active', j === i));
        _renderChartImage(panel, token, idx, i);
      };
      subEl.appendChild(btn);
    });
  } else {
    subEl.style.display = 'none';
  }

  _renderChartImage(panel, token, idx, 0);
}

function _renderChartImage(panel, token, groupIdx, subIdx) {
  const group = _chartsData?.charts?.[groupIdx];
  const file  = group?.files?.[subIdx];
  const wrap  = panel.querySelector('#chart-wrap');
  if (!file) { wrap.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">無圖表資料</div>'; return; }

  wrap.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:60px 20px;color:var(--text2);font-size:12px">
      <div class="spinner"></div><span>載入圖表…</span>
    </div>`;

  const src = `${WORKER}/chart?sessionToken=${encodeURIComponent(token)}&legId=${encodeURIComponent(_chartsData.legId)}&cat=${encodeURIComponent(file.cat)}&fileId=${encodeURIComponent(file.fileId)}`;
  fetch(src)
    .then(async r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct   = r.headers.get('content-type') || '';
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      if (ct.includes('pdf')) {
        wrap.innerHTML = `<div style="height:calc(100vh - 260px);overflow:hidden">
          <object data="${url}" type="application/pdf" width="100%" height="100%" style="border:none;display:block">
            <div style="padding:40px;text-align:center;color:var(--text3)">PDF 無法顯示</div>
          </object></div>`;
      } else {
        wrap.innerHTML = `<div style="overflow:auto;-webkit-overflow-scrolling:touch;background:#1a1f2e">
          <img id="chart-img" src="${url}" alt="${file.label || ''}"
            style="display:block;width:100%;cursor:zoom-in"
            onclick="this.style.width=this.style.width==='100%'?this.naturalWidth*2+'px':'100%'">
        </div>`;
      }
    })
    .catch(e => {
      wrap.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">載入失敗：${e.message}</div>`;
    });
}

// ══════════════════════════════════════════════════════════════════
// SIGWX / Typhoon Charts
// ══════════════════════════════════════════════════════════════════

const JMA_LIST_URL  = 'https://www.jma.go.jp/bosai/weather_map/data/list.json';
const JMA_PNG_BASE  = 'https://www.jma.go.jp/bosai/weather_map/data/png/';
const JMA_MAP_URL   = 'https://www.jma.go.jp/bosai/weather_map/#lang=en';
// CWA typhoon: correct path (V8/C/P, not V8/C/W)
const CWA_TYPHOON   = 'https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_NEWS.html';
const CWA_GIS_URL   = 'https://app.cwa.gov.tw/web/obsmap/typhoon.html';

// Fetch JMA list.json and return {near:{now,ft24,ft48}, asia:{...}}
async function _fetchJmaList() {
  const r = await fetch(JMA_LIST_URL);
  if (!r.ok) throw new Error(`list.json HTTP ${r.status}`);
  return r.json();
}

function _jmaLatestUrl(list, category, timeKey) {
  const files = list?.[category]?.[timeKey] || [];
  if (!files.length) return null;
  return JMA_PNG_BASE + files[files.length - 1];
}

function _jmaImgWrap(id, label) {
  return `
    <div id="${id}-wrap" style="border-radius:8px;overflow:hidden;background:#0a0f18;margin-top:8px;min-height:80px;display:flex;align-items:center;justify-content:center">
      <div class="spinner" style="width:24px;height:24px"></div>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-top:4px">${label}</div>`;
}

function _setJmaImg(panel, wrapId, url, altText) {
  const wrap = panel.querySelector(`#${wrapId}-wrap`);
  if (!wrap) return;
  if (!url) {
    wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">無資料</div>`;
    return;
  }
  const img = document.createElement('img');
  img.src   = url;
  img.alt   = altText;
  img.style.cssText = 'width:100%;display:block;cursor:zoom-in';
  img.onclick = () => { img.style.width = img.style.width === '100%' ? '200%' : '100%'; };
  img.onerror = () => {
    wrap.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">圖片載入失敗 — <a href="${JMA_MAP_URL}" target="_blank" style="color:#c49a3c">JMA ↗</a></div>`;
  };
  wrap.innerHTML = '';
  wrap.appendChild(img);
}

// SIGWX inner sub-tab state
let _activeSigwxChart = 'asia'; // 'asia' | 'near' | 'tc'
let _jmaActiveNear    = 'now';
let _jmaActiveAsia    = 'now';
let _jmaListCache     = null;   // shared across tab switches

const SIGWX_CHARTS = [
  { id: 'asia', label: '亞洲 Asia' },
  { id: 'near', label: '日本 Japan' },
  { id: 'tc',   label: '颱風 TC' },
];

function _sigwxTabBar() {
  return `
    <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap" id="sigwx-chartbar">
      ${SIGWX_CHARTS.map(c => `
        <button class="sigwx-ctab btn btn-ghost btn-sm" data-chart="${c.id}"
          style="font-size:12px;padding:3px 12px;${c.id === _activeSigwxChart ? 'border-color:#c49a3c;color:#c49a3c;' : ''}">
          ${c.label}
        </button>`).join('')}
    </div>`;
}

function _timeToggleBar(cls, activeKey) {
  return ['now', 'ft24', 'ft48'].map(k => `
    <button class="btn btn-ghost btn-sm ${cls}" data-key="${k}"
      style="font-size:11px;padding:2px 7px;${k === activeKey ? 'border-color:#c49a3c;color:#c49a3c;' : ''}">
      ${k === 'now' ? 'Current' : k === 'ft24' ? '+24h' : '+48h'}
    </button>`).join('');
}

// ══════════════════════════════════════════════════════════════════
// WNI Flight Plan Editor
// ══════════════════════════════════════════════════════════════════

function _renderWni(panel) {
  const b = store.briefing;
  const fpl = b?.icaoFpl || null;

  panel.innerHTML = `
    <div class="view-content" style="padding-top:8px">
      <div class="card">
        <div class="card-title" style="margin-bottom:8px">WNI Flight Plan Editor</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:12px;line-height:1.6">
          按下按鈕後，ICAO FPL 已自動複製完畢，同時開啟 WNI 頁面。<br>
          登入後直接貼上，即可查看航路天氣、SIGMET、垂直剖面圖等資料。
        </div>
        <button id="wni-copy-btn" style="width:100%;padding:12px;font-size:15px;font-weight:700;border-radius:10px;border:1px solid var(--gold);color:var(--gold);background:rgba(196,154,60,.12);cursor:pointer;${!fpl ? 'opacity:.4;pointer-events:none' : ''}">
          ${fpl ? '一鍵複製 FPL ＆ 開啟 WNI ↗' : '尚無 FPL 資料（請先載入航班簡報）'}
        </button>
      </div>
    </div>`;

  document.getElementById('wni-copy-btn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fpl);
      showToast('ICAO FPL 已複製 — 在 WNI 貼上後按 Apply');
    } catch {
      showToast('複製失敗，請長按文字手動複製', true);
    }
    window.open('https://flight-plan-editor.weathernews.com/flight_plan_editor/', '_blank');
  });
}

function _renderSigwx(panel) {
  panel.innerHTML = `
    ${_sigwxTabBar()}

    <!-- Asia Surface -->
    <div id="sc-asia" style="display:${_activeSigwxChart === 'asia' ? 'block' : 'none'}">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          <span style="font-size:13px;font-weight:700;color:var(--text)">JMA 亞洲地面天氣圖</span>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${_timeToggleBar('jma-asia-btn', _jmaActiveAsia)}
            <a href="${JMA_MAP_URL}" target="_blank" rel="noopener"
               class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px">JMA ↗</a>
          </div>
        </div>
        ${_jmaImgWrap('jma-asia', '日本氣象廳 · 每 6 小時更新 · 點擊放大')}
      </div>
    </div>

    <!-- Japan Near Surface -->
    <div id="sc-near" style="display:${_activeSigwxChart === 'near' ? 'block' : 'none'}">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-bottom:6px">
          <span style="font-size:13px;font-weight:700;color:var(--text)">JMA 日本天氣圖</span>
          <div style="display:flex;gap:5px;flex-wrap:wrap">
            ${_timeToggleBar('jma-near-btn', _jmaActiveNear)}
            <a href="${JMA_MAP_URL}" target="_blank" rel="noopener"
               class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px">JMA ↗</a>
          </div>
        </div>
        ${_jmaImgWrap('jma-near', '日本近海分析圖 · 點擊放大')}
      </div>
    </div>

    <!-- CWA Typhoon GIS -->
    <div id="sc-tc" style="display:${_activeSigwxChart === 'tc' ? 'block' : 'none'}">
      <div class="card" style="padding:0;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px 8px">
          <span style="font-size:13px;font-weight:700;color:var(--text)">颱風路徑圖 CWA</span>
          <div style="display:flex;gap:5px">
            <a href="${CWA_GIS_URL}" target="_blank" rel="noopener"
               class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px">GIS ↗</a>
            <a href="${CWA_TYPHOON}" target="_blank" rel="noopener"
               class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 7px">CWA ↗</a>
          </div>
        </div>
        <div style="background:#0a0f18">
          <iframe id="typhoon-iframe"
            src="${CWA_GIS_URL}?_t=${Date.now()}"
            style="width:100%;height:calc(100vh - 260px);min-height:400px;border:none;display:block"
            title="CWA Typhoon GIS" loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups">
          </iframe>
          <div id="typhoon-fallback" style="display:none;padding:32px;text-align:center">
            <div style="font-size:13px;color:var(--text2);margin-bottom:14px">iframe 受限，請外部開啟</div>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
              <a href="${CWA_GIS_URL}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">GIS 颱風圖 ↗</a>
              <a href="${CWA_TYPHOON}" target="_blank" rel="noopener" class="btn btn-ghost  btn-sm">CWA 颱風消息 ↗</a>
            </div>
          </div>
        </div>
        <div style="padding:5px 14px 8px;font-size:11px;color:var(--text3)">中央氣象署 CWA 即時資料（與航班日期無關）· 顯示最新颱風；颱風結束後 CWA 仍會保留最後一次路徑直到新颱風生成</div>
      </div>
    </div>`;

  // ── JMA list fetch (shared cache) ───────────────────────────────
  const _loadJma = (category, timeKey) => {
    const wrapId = `jma-${category}`;
    const wrap = panel.querySelector(`#${wrapId}-wrap`);
    if (wrap) wrap.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:80px"><div class="spinner" style="width:24px;height:24px"></div></div>`;
    const _apply = (list) => {
      _jmaListCache = list;
      _setJmaImg(panel, wrapId, _jmaLatestUrl(list, category, timeKey), `JMA ${category} ${timeKey}`);
    };
    if (_jmaListCache) { _apply(_jmaListCache); return; }
    _fetchJmaList().then(_apply).catch(e => {
      if (wrap) wrap.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">載入失敗：${e.message}</div>`;
    });
  };

  // ── Chart sub-tab switching ──────────────────────────────────────
  const _showPanel = (id) => {
    ['asia','near','tc'].forEach(c => {
      const p = panel.querySelector(`#sc-${c}`);
      if (p) p.style.display = c === id ? 'block' : 'none';
    });
  };
  panel.querySelectorAll('.sigwx-ctab').forEach(btn => {
    btn.onclick = () => {
      _activeSigwxChart = btn.dataset.chart;
      panel.querySelectorAll('.sigwx-ctab').forEach(b => { b.style.borderColor = ''; b.style.color = ''; });
      btn.style.borderColor = '#c49a3c'; btn.style.color = '#c49a3c';
      _showPanel(_activeSigwxChart);
      // Lazy-load chart on first switch
      if (_activeSigwxChart === 'asia') _loadJma('asia', _jmaActiveAsia);
      if (_activeSigwxChart === 'near') _loadJma('near', _jmaActiveNear);
      if (_activeSigwxChart === 'tc')   _initTyphoonFallback();
    };
  });

  // ── Time toggles ─────────────────────────────────────────────────
  const _bindTimeToggle = (cls, getKey, setKey, category) => {
    panel.querySelectorAll(`.${cls}`).forEach(btn => {
      btn.onclick = () => {
        setKey(btn.dataset.key);
        panel.querySelectorAll(`.${cls}`).forEach(b => { b.style.borderColor = ''; b.style.color = ''; });
        btn.style.borderColor = '#c49a3c'; btn.style.color = '#c49a3c';
        _loadJma(category, getKey());
      };
    });
  };
  _bindTimeToggle('jma-asia-btn', () => _jmaActiveAsia, k => { _jmaActiveAsia = k; }, 'asia');
  _bindTimeToggle('jma-near-btn', () => _jmaActiveNear, k => { _jmaActiveNear = k; }, 'near');

  // ── Typhoon iframe fallback ──────────────────────────────────────
  const _initTyphoonFallback = () => {
    const iframe   = panel.querySelector('#typhoon-iframe');
    const fallback = panel.querySelector('#typhoon-fallback');
    if (!iframe || !fallback || iframe.dataset.watched) return;
    iframe.dataset.watched = '1';
    let loaded = false;
    iframe.onload = () => { loaded = true; };
    setTimeout(() => {
      if (!loaded) { iframe.style.display = 'none'; fallback.style.display = 'block'; }
    }, 8000);
  };

  // ── Initial load for active panel ────────────────────────────────
  if (_activeSigwxChart === 'asia') _loadJma('asia', _jmaActiveAsia);
  if (_activeSigwxChart === 'near') _loadJma('near', _jmaActiveNear);
  if (_activeSigwxChart === 'tc')   _initTyphoonFallback();
}

// ══════════════════════════════════════════════════════════════════
// Turbli
// ══════════════════════════════════════════════════════════════════

function _buildTurbliUrl(dep, dest, flt, date) {
  if (!dep || !dest) return 'https://turbli.com';
  const day = date || new Date().toISOString().slice(0, 10);
  // 帶上 JX-航班號，外部連結才會直接落在該航班頁（與 worker 抓的網址一致）
  const fltSeg = flt ? `JX-${flt}/` : '';
  return `https://turbli.com/${dep}/${dest}/${day}/${fltSeg}`;
}

async function _renderTurbli(panel) {
  const f = store.flight || {};
  const b = store.briefing;
  const depRaw  = b?.dep  || f?.dep  || '';
  const destRaw = b?.dest || f?.dest || '';
  const depIata  = toIATA(depRaw)  || depRaw;
  const destIata = toIATA(destRaw) || destRaw;
  const fltNo   = (b?.flightNumber || f?.flightNumber || '').replace(/^JX/i, '');
  const date    = new Date().toISOString().slice(0, 10);
  const extUrl  = depIata && destIata ? _buildTurbliUrl(depIata, destIata, fltNo, date) : 'https://turbli.com';

  if (!depIata || !destIata) {
    panel.innerHTML = `<div class="card"><div style="font-size:13px;color:var(--text3)">查詢航班後自動帶入亂流圖</div></div>`;
    return;
  }

  // Header + loading state
  panel.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px 10px">
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--gold);font-family:'JetBrains Mono',monospace">${depIata} → ${destIata}</div>
          <div style="font-size:11px;color:var(--text3)">亂流預測 · ECMWF · turbli.com${fltNo ? ` · JX-${fltNo}` : ''}</div>
        </div>
        <a href="${extUrl}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 9px">turbli ↗</a>
      </div>
      <div id="turbli-body" style="padding:0 8px 10px">
        <div class="state-screen" style="min-height:30vh"><div class="state-icon">🌀</div><div class="state-title">載入亂流資料…</div></div>
      </div>
    </div>`;

  const body = panel.querySelector('#turbli-body');
  try {
    const r = await fetch(`${WORKER}/turbli?dep=${depIata}&dest=${destIata}&date=${date}&flight=${fltNo || ''}`);
    const d = await r.json();
    if (!d.ok || !d.line || !d.line.length) {
      body.innerHTML = `
        <div class="state-screen" style="min-height:25vh">
          <div class="state-icon">🌀</div>
          <div class="state-title">此航班暫無亂流資料</div>
          <div class="state-sub">turbli 僅提供未來約 72 小時內的航班預報</div>
          <a href="${extUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="margin-top:12px">在 turbli 查看 ↗</a>
        </div>`;
      return;
    }
    body.innerHTML = _turbliChartSvg(d) + `
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text3);padding:8px 10px 2px">
        <span><span style="display:inline-block;width:14px;height:2px;background:#2c3e6b;vertical-align:middle;margin-right:4px"></span>沿預期航路亂流</span>
        <span><span style="display:inline-block;width:12px;height:8px;background:rgba(150,160,180,0.4);vertical-align:middle;margin-right:4px"></span>±2000ft / ±40nm 偏航範圍</span>
      </div>
      <div style="font-size:10.5px;color:var(--text3);line-height:1.5;padding:2px 10px 8px">
        縱軸為亂流強度 EDR（&lt;20 輕度、20–40 中度、&gt;40 中–強）；橫軸為起飛後經過的飛行時數。
        預報沿「相同航線與機型最近一班」的航跡計算，來源 ECMWF · turbli.com。
      </div>`;
  } catch (e) {
    body.innerHTML = `
      <div class="state-screen" style="min-height:25vh">
        <div class="state-icon">⚠️</div>
        <div class="state-title">載入失敗</div>
        <div class="state-sub">${String(e).slice(0,80)}</div>
        <a href="${extUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="margin-top:12px">在 turbli 查看 ↗</a>
      </div>`;
  }
}

// 自繪 turbli 亂流圖（EDR）SVG
function _turbliChartSvg(d) {
  const line = d.line, up = d.upper || [], lo = d.lower || [];
  const n = line.length;
  const W = 900, H = 470;
  const mL = 64, mR = 18, mT = 46, mB = 56;
  const pw = W - mL - mR, ph = H - mT - mB;
  const yMax = 60;
  const X = i => mL + (i / (n - 1)) * pw;
  const Y = v => mT + ph - (Math.min(Math.max(v, 0), yMax) / yMax) * ph;

  // 亂流強度區帶（左側色條 + 全寬淡色背景）
  const zones = [
    { lo: 0,  hi: 20, label: 'light',   col: '#f7e8d2', bar: '#e9c8a0' },
    { lo: 20, hi: 40, label: 'moderate',col: '#f5d6ad', bar: '#e8a85a' },
    { lo: 40, hi: 60, label: 'mod-sev', col: '#f0c08a', bar: '#e08a3c' },
  ];
  let zoneRects = '', zoneBar = '', zoneLabels = '';
  for (const z of zones) {
    const y0 = Y(z.hi), y1 = Y(z.lo);
    zoneRects  += `<rect x="${mL}" y="${y0}" width="${pw}" height="${y1-y0}" fill="${z.col}" opacity="0.35"/>`;
    zoneBar    += `<rect x="${mL-14}" y="${y0}" width="14" height="${y1-y0}" fill="${z.bar}"/>`;
    zoneLabels += `<text x="${mL-7}" y="${(y0+y1)/2}" font-size="10" fill="#5a4a36" text-anchor="middle" transform="rotate(-90 ${mL-7} ${(y0+y1)/2})" font-weight="600">${z.label}</text>`;
  }

  // Y 軸刻度
  let yTicks = '';
  for (let v = 0; v <= 60; v += 10) {
    yTicks += `<line x1="${mL}" y1="${Y(v)}" x2="${W-mR}" y2="${Y(v)}" stroke="#d8dee8" stroke-width="0.7"/>
      <text x="${mL-18}" y="${Y(v)+3}" font-size="10" fill="#888" text-anchor="end">${v}</text>`;
  }

  // 偏航範圍 band（upper→lower 多邊形）
  let band = '';
  if (up.length === n && lo.length === n) {
    let pts = '';
    for (let i = 0; i < n; i++) pts += `${X(i).toFixed(1)},${Y(up[i]).toFixed(1)} `;
    for (let i = n - 1; i >= 0; i--) pts += `${X(i).toFixed(1)},${Y(lo[i]).toFixed(1)} `;
    band = `<polygon points="${pts.trim()}" fill="rgba(150,160,180,0.38)" stroke="none"/>`;
  }

  // 主線
  let linePts = '';
  for (let i = 0; i < n; i++) linePts += `${X(i).toFixed(1)},${Y(line[i]).toFixed(1)} `;
  const mainLine = `<polyline points="${linePts.trim()}" fill="none" stroke="#2c3e6b" stroke-width="2.2"/>`;

  // X 軸：以 time（UNIX 秒）算「經過飛行時數」，每 30 分鐘一刻度、整點加垂直格線與小飛機
  const axisY = mT + ph;
  let xTicks = '';
  const time = d.time;
  if (time && time.length === n && time[n-1] > time[0]) {
    const totalH = (time[n-1] - time[0]) / 3600;
    for (let h = 0; h <= totalH + 1e-6; h += 0.5) {
      const frac = h / totalH;
      if (frac > 1.0001) break;
      const x = mL + frac * pw;
      const isHour = Math.abs(h - Math.round(h)) < 1e-6;
      if (isHour) {
        xTicks += `<line x1="${x.toFixed(1)}" y1="${mT}" x2="${x.toFixed(1)}" y2="${axisY}" stroke="#c8d0dc" stroke-width="0.8" stroke-dasharray="3 3"/>`;
        xTicks += `<text x="${x.toFixed(1)}" y="${axisY-3}" font-size="13" fill="#aeb6c4" text-anchor="middle">✈</text>`;
        xTicks += `<text x="${x.toFixed(1)}" y="${axisY+17}" font-size="12" fill="#555" text-anchor="middle" font-weight="700">${Math.round(h)}</text>`;
      } else {
        xTicks += `<text x="${x.toFixed(1)}" y="${axisY+16}" font-size="9.5" fill="#9aa3b2" text-anchor="middle">:30</text>`;
      }
    }
  }
  // dep / dest 端點 + 軸標題
  const xLabels = `
    <text x="${mL}" y="${axisY+36}" font-size="12.5" fill="#333" text-anchor="start" font-weight="800">${d.dep}</text>
    <text x="${W-mR}" y="${axisY+36}" font-size="12.5" fill="#333" text-anchor="end" font-weight="800">${d.dest}</text>
    <text x="${mL+pw/2}" y="${axisY+36}" font-size="11" fill="#888" text-anchor="middle">Flight hours（飛行經過時數）</text>`;

  // 說明文字（警示）：彩色圓點 + 句子，對齊原圖
  const warn = (d.warning || '').replace(/[<>&]/g, '');
  const warnColor = /smooth|light/i.test(warn) ? '#16a34a' : /moderate/i.test(warn) ? '#e0902c' : /severe|strong/i.test(warn) ? '#dc2626' : '#6b7280';
  const header = warn
    ? `<circle cx="${W/2 - warn.length*3.4 - 14}" cy="22" r="7" fill="${warnColor}"/>
       <text x="${W/2 + 8}" y="27" font-size="15" fill="#333" text-anchor="middle" font-weight="700">${warn}</text>`
    : '';

  return `<div style="background:#fff;border-radius:8px;overflow:hidden">
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>
      ${zoneRects}${yTicks}${xTicks}${band}${mainLine}${zoneBar}${zoneLabels}${xLabels}${header}
    </svg>
  </div>`;
}

// ══════════════════════════════════════════════════════════════════
// Cold Temp
// ══════════════════════════════════════════════════════════════════

// ICAO Doc 8168 — OAT columns
const _COLD_OAT = [0, -10, -20, -30, -40, -50];
// HAA rows
const _COLD_HAA = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 3000, 4000, 5000];
// Table values indexed as [haa_row_index][oat_col_index]
const _COLD_TBL = [
  [ 20,  20,  30,  40,  50,   60],  // 200
  [ 20,  30,  40,  50,  70,   80],  // 300
  [ 30,  40,  50,  70,  90,  100],  // 400
  [ 30,  50,  70,  90, 110,  130],  // 500
  [ 40,  60,  80, 100, 130,  150],  // 600
  [ 40,  70,  90, 120, 150,  180],  // 700
  [ 50,  80, 100, 140, 170,  210],  // 800
  [ 50,  90, 120, 150, 190,  230],  // 900
  [ 60, 100, 130, 170, 210,  260],  // 1000
  [ 90, 140, 190, 250, 310,  380],  // 1500
  [120, 180, 250, 320, 400,  490],  // 2000
  [170, 260, 360, 470, 580,  710],  // 3000
  [220, 340, 470, 610, 760,  920],  // 4000
  [270, 420, 570, 740, 920, 1120],  // 5000
];

// Snap HAA to nearest table row, interpolate OAT, round to nearest 10
// Returns { corr, haaIdx, cLoIdx, cHiIdx } for per-cell table highlighting
function _coldLookup(haa, oat) {
  if (oat >= 0) return { corr: 0, haaIdx: -1, cLoIdx: -1, cHiIdx: -1 };
  const oatC = Math.max(-50, Math.min(0, oat));
  const haaC = Math.max(_COLD_HAA[0], Math.min(_COLD_HAA[_COLD_HAA.length - 1], haa));

  // Snap to nearest HAA row
  let nearestIdx = 0, minDist = Infinity;
  _COLD_HAA.forEach((r, i) => { const d = Math.abs(r - haaC); if (d < minDist) { minDist = d; nearestIdx = i; } });

  // Interpolate between bounding OAT columns (descending: 0, -10, …)
  let cHi = _COLD_OAT.findIndex(c => c <= oatC);
  if (cHi < 0) cHi = _COLD_OAT.length - 1;
  const cLo = (cHi > 0 && _COLD_OAT[cHi] !== oatC) ? cHi - 1 : cHi;

  let corr;
  if (cLo === cHi) {
    corr = _COLD_TBL[nearestIdx][cLo];
  } else {
    const t = (oatC - _COLD_OAT[cLo]) / (_COLD_OAT[cHi] - _COLD_OAT[cLo]);
    corr = _COLD_TBL[nearestIdx][cLo] + t * (_COLD_TBL[nearestIdx][cHi] - _COLD_TBL[nearestIdx][cLo]);
  }
  return { corr: Math.round(corr / 10) * 10, haaIdx: nearestIdx, cLoIdx: cLo, cHiIdx: cHi };
}

// ── RAB 6.10.2 requirements per approach type ──────────────────────
const _RAB_REQ = {
  npa: {
    'MSA':     { txt: '',                            stl: '' },
    'IAF':     { txt: 'Required',                    stl: 'red' },
    'IF':      { txt: 'Required',                    stl: 'red' },
    'FAF/FAP': { txt: 'Required',                    stl: 'red' },
    'DA/MDA':  { txt: 'Required',                    stl: 'red' },
    'MAA':     { txt: '',                            stl: '' },
    'EO ACC':  { txt: '',                            stl: '' },
  },
  apv: {
    'MSA':     { txt: '',                            stl: '' },
    'IAF':     { txt: 'Not Recommended\n(see note)', stl: 'orange' },
    'IF':      { txt: 'Not Recommended\n(see note)', stl: 'orange' },
    'FAF/FAP': { txt: 'Not Required',                stl: 'gray' },
    'DA/MDA':  { txt: 'Not Required',                stl: 'gray' },
    'MAA':     { txt: '',                            stl: '' },
    'EO ACC':  { txt: '',                            stl: '' },
  },
  pa: {
    'MSA':     { txt: '',                            stl: '' },
    'IAF':     { txt: 'Required\n(see note)',         stl: 'red' },
    'IF':      { txt: 'Required\n(see note)',         stl: 'red' },
    'FAF/FAP': { txt: 'Required\n(see note)',         stl: 'red' },
    'DA/MDA':  { txt: 'Required',                    stl: 'red' },
    'MAA':     { txt: '',                            stl: '' },
    'EO ACC':  { txt: '',                            stl: '' },
  },
};

const _RAB_NOTE_TEXT = {
  apv: { cls: 'orange', label: 'Not Recommended', body: 'Not recommended for IF and IAF when FMC coded with "above" to generate a stable CDFA path to FAP.' },
  pa:  { cls: 'red',    label: 'Required',         body: 'Required: If overflying IF/IAF/FAF/FAP, and not being Radar Vectored, unless already descending on G/S.' },
};

const _COLD_FIXES = ['MSA', 'IAF', 'IF', 'FAF/FAP', 'DA/MDA', 'MAA', 'EO ACC'];

function _renderCold(panel) {
  panel._cold = { apType: 'npa', fpaMode: 'direct', customCount: 0, customRows: [] };

  panel.innerHTML = `
    <!-- Combined Card: Settings + Table -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
      <div style="padding:16px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <div class="form-label">Aerodrome Elevation (ft)</div>
          <input class="input" id="cold-elev" type="number" placeholder="e.g. 70" style="width:100%">
        </div>
        <div>
          <div class="form-label" style="color:#60a5fa">Aerodrome Temp (°C)</div>
          <input class="input" id="cold-oat" type="number" placeholder="e.g. −15" style="width:100%;color:#60a5fa">
        </div>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <!-- Approach Type segmented control -->
        <div style="flex:1;min-width:220px">
          <div class="form-label">Approach Type</div>
          <div id="cold-aptype" style="display:flex;background:var(--surface);border-radius:10px;padding:3px;gap:2px">
            <button class="cold-apt-btn" data-apt="npa"
              style="flex:1;padding:7px 4px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                     transition:all .2s;background:var(--card);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.15)">
              NPA(2D)
            </button>
            <button class="cold-apt-btn" data-apt="apv"
              style="flex:1;padding:7px 4px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                     transition:all .2s;background:transparent;color:var(--text3);box-shadow:none">
              APV-Baro(3D)
            </button>
            <button class="cold-apt-btn" data-apt="pa"
              style="flex:1;padding:7px 4px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;
                     transition:all .2s;background:transparent;color:var(--text3);box-shadow:none">
              PA (ILS)
            </button>
          </div>
        </div>

        <!-- FPA / Glide Path section -->
        <div style="min-width:210px">
          <div class="form-label">FPA / Glide Path (°)</div>
          <div style="display:flex;background:var(--surface);border-radius:8px;padding:2px;gap:1px;margin-bottom:8px">
            <button class="cold-fpamode-btn" data-fpamode="direct"
              style="flex:1;padding:4px 6px;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;
                     transition:all .2s;background:var(--card);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.1)">
              Direct FPA
            </button>
            <button class="cold-fpamode-btn" data-fpamode="fafdist"
              style="flex:1;padding:4px 6px;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;
                     transition:all .2s;background:transparent;color:var(--text3);box-shadow:none">
              FAF + Dist
            </button>
          </div>
          <!-- Direct FPA mode -->
          <div id="cold-fpa-direct-wrap" style="display:flex;align-items:center;gap:8px">
            <input class="input" id="cold-fpa" type="number" step="0.1" placeholder="3.0"
                   style="width:68px;text-align:center;font-size:14px">
            <span style="color:var(--text3);font-size:14px">→</span>
            <span id="cold-fpa-result" style="font-size:16px;font-weight:700;color:#a78bfa;min-width:55px">—</span>
          </div>
          <!-- FAF + Dist mode -->
          <div id="cold-fpa-fafdist-wrap" style="display:none">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
              <div>
                <div style="font-size:10px;color:var(--text3);margin-bottom:2px">FAF (ft MSL)</div>
                <input class="input" id="cold-faf-vda" type="number" placeholder="3000" style="width:100%;font-size:13px">
              </div>
              <div>
                <div style="font-size:10px;color:var(--text3);margin-bottom:2px">Dist to THR (NM)</div>
                <input class="input" id="cold-dist-vda" type="number" step="0.1" placeholder="5.0" style="width:100%;font-size:13px">
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:var(--text3)">VDA →</span>
              <span id="cold-vda-result" style="font-size:16px;font-weight:700;color:#a78bfa">—</span>
            </div>
          </div>
        </div>
      </div>
      </div><!-- end settings padding -->

      <!-- Altitude Correction Table (same card) -->
      <div style="border-top:1px solid var(--border);overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;min-width:360px">
          <thead>
            <tr style="background:var(--surface)">
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);
                         border-bottom:1px solid var(--border);white-space:nowrap">FIX</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:700;color:var(--text3);
                         border-bottom:1px solid var(--border);white-space:nowrap">ALTITUDE (FT)</th>
              <th style="padding:8px 14px;text-align:center;font-size:11px;font-weight:700;color:#60a5fa;
                         border-bottom:1px solid var(--border);white-space:nowrap;min-width:100px">CORRECTION</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:700;color:var(--text3);
                         border-bottom:1px solid var(--border);white-space:nowrap;min-width:110px">CORRECTED (FT)</th>
            </tr>
          </thead>
          <tbody id="cold-rows"></tbody>
        </table>
      </div>
      <div style="padding:8px 14px;border-top:1px solid var(--border)">
        <button class="btn btn-ghost btn-sm" id="cold-add-row">+ Add Custom Row</button>
      </div>
    </div>

    <!-- RAB Notes -->
    <div id="cold-rab-notes"></div>

    <!-- Reference tables (collapsible) -->
    <details style="margin-top:12px">
      <summary style="cursor:pointer;font-size:12px;color:var(--text3);padding:4px 0;user-select:none">
        📋 ICAO Doc 8168 Reference Table
      </summary>
      <div class="card" style="padding:0;overflow:hidden;margin-top:8px">
        <div style="padding:8px 14px 6px;font-size:12px;font-weight:700;color:var(--text)">
          ICAO Doc 8168 Cold Temperature Error Table（修正量 ft）
        </div>
        <div id="cold-table-wrap">${_coldTable()}</div>
      </div>
    </details>

    <details id="cold-vda-ref-detail" style="margin-top:8px">
      <summary style="cursor:pointer;font-size:12px;color:var(--text3);padding:4px 0;user-select:none">
        📋 FAF AGL / Dist to THR → VDA 對應表格
      </summary>
      <div class="card" style="padding:0;overflow:hidden;margin-top:8px">
        <div style="padding:8px 14px 6px;font-size:12px;font-weight:700;color:var(--text)">
          VDA 對應表格
          <span style="font-size:10px;font-weight:400;color:var(--text3);margin-left:6px">FAF AGL (ft) × Dist to THR (NM) → 名義進場角 (°) · TCH=50ft</span>
        </div>
        <div id="cold-vda-wrap">${_vdaTable()}</div>
      </div>
    </details>`;

  _wireupCold(panel);
  _refreshColdRows(panel);
  _refreshColdNotes(panel);
}

function _wireupCold(panel) {
  const c = panel._cold;

  // Approach type tabs
  panel.querySelectorAll('.cold-apt-btn').forEach(btn => {
    btn.onclick = () => {
      c.apType = btn.dataset.apt;
      panel.querySelectorAll('.cold-apt-btn').forEach(b => {
        const on = b === btn;
        b.style.background = on ? 'var(--card)' : 'transparent';
        b.style.color      = on ? 'var(--text)'  : 'var(--text3)';
        b.style.boxShadow  = on ? '0 1px 3px rgba(0,0,0,.15)' : 'none';
      });
      _refreshColdRows(panel);
      _refreshColdNotes(panel);
    };
  });

  // FPA mode tabs
  panel.querySelectorAll('.cold-fpamode-btn').forEach(btn => {
    btn.onclick = () => {
      c.fpaMode = btn.dataset.fpamode;
      panel.querySelectorAll('.cold-fpamode-btn').forEach(b => {
        const on = b === btn;
        b.style.background = on ? 'var(--card)' : 'transparent';
        b.style.color      = on ? 'var(--text)'  : 'var(--text3)';
        b.style.boxShadow  = on ? '0 1px 2px rgba(0,0,0,.1)' : 'none';
      });
      panel.querySelector('#cold-fpa-direct-wrap').style.display  = c.fpaMode === 'direct'  ? 'flex'  : 'none';
      panel.querySelector('#cold-fpa-fafdist-wrap').style.display = c.fpaMode === 'fafdist' ? 'block' : 'none';
      _refreshFPAResult(panel);
    };
  });

  // Elevation / OAT → recalc all rows + FPA result
  ['cold-elev', 'cold-oat'].forEach(id => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => {
      _recalcAllColdRows(panel);
      _refreshFPAResult(panel);
    });
  });

  // Direct FPA input
  panel.querySelector('#cold-fpa')?.addEventListener('input', () => _refreshFPAResult(panel));

  // FAF + Dist inputs
  ['cold-faf-vda', 'cold-dist-vda'].forEach(id => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => _refreshFPAResult(panel));
  });

  // Add custom row
  panel.querySelector('#cold-add-row').onclick = () => {
    const n = ++c.customCount;
    c.customRows.push({ id: `cr${n}`, name: 'Custom', custom: true });
    _refreshColdRows(panel);
  };
}

function _refreshColdRows(panel) {
  const c = panel._cold;
  const tbody = panel.querySelector('#cold-rows');
  if (!tbody) return;

  // Save current altitude values before re-render
  const saved = {};
  tbody.querySelectorAll('tr[data-rowid]').forEach(tr => {
    const rid = tr.dataset.rowid;
    const altInp = tr.querySelector('.cold-alt-input');
    if (altInp) saved[rid] = altInp.value;
    const nameInp = tr.querySelector('.cold-fix-name');
    if (nameInp) saved[rid + '_n'] = nameInp.value;
  });

  const rows = [
    ..._COLD_FIXES.map(f => ({ id: f, name: f, custom: false })),
    ...c.customRows,
  ];

  tbody.innerHTML = rows.map(row => {
    const safeId   = row.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const req      = _RAB_REQ[c.apType]?.[row.name] || { txt: '', stl: '' };
    const reqColor = req.stl === 'red' ? '#f87171' : req.stl === 'orange' ? '#fb923c' : 'var(--text3)';
    const reqHtml  = req.txt ? req.txt.replace('\n', '<br>') : '';
    const savedAlt  = saved[row.id] || '';
    const savedName = saved[row.id + '_n'] || row.name;

    return `
      <tr data-rowid="${row.id}" style="border-top:1px solid var(--border)">
        <td style="padding:10px 12px;vertical-align:middle">
          ${row.custom
            ? `<input type="text" class="input cold-fix-name" value="${savedName}" placeholder="Name"
                      style="width:76px;font-size:13px;font-weight:700;padding:4px 6px">`
            : `<div style="font-size:13px;font-weight:700;color:var(--text)">${row.name}</div>`}
          ${reqHtml ? `<div style="font-size:10px;font-weight:600;line-height:1.3;margin-top:2px;color:${reqColor}">${reqHtml}</div>` : ''}
        </td>
        <td style="padding:10px 12px;vertical-align:middle">
          <div style="display:flex;align-items:center;gap:4px">
            <input type="number" class="input cold-alt-input" value="${savedAlt}"
                   placeholder="Value" data-rowid="${row.id}" data-safeid="${safeId}"
                   style="width:96px;font-size:13px">
            <span style="font-size:11px;color:var(--text3)">ft</span>
          </div>
        </td>
        <td style="padding:10px 14px;vertical-align:middle;text-align:center">
          <span id="cold-corr-${safeId}"><span style="color:var(--text3)">–</span></span>
        </td>
        <td style="padding:10px 12px;vertical-align:middle;text-align:right">
          <div id="cold-result-${safeId}"
               style="display:inline-block;min-width:70px;border-radius:8px;
                      padding:6px 12px;text-align:center;background:var(--surface)">
            <span style="font-size:13px;color:var(--text3)">—</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  // Attach listeners + immediate calc for rows with saved values
  tbody.querySelectorAll('.cold-alt-input').forEach(inp => {
    inp.addEventListener('input', () => _calcOneRow(panel, inp.dataset.rowid, inp.dataset.safeid));
    if (inp.value) _calcOneRow(panel, inp.dataset.rowid, inp.dataset.safeid);
  });
}

function _calcOneRow(panel, rowId, safeId) {
  const elev = parseFloat(panel.querySelector('#cold-elev')?.value) || 0;
  const oat  = parseFloat(panel.querySelector('#cold-oat')?.value);
  const tr   = panel.querySelector(`[data-rowid="${rowId}"]`);
  if (!tr) return;
  const inp  = tr.querySelector('.cold-alt-input');
  const alt  = parseFloat(inp?.value);

  const corrEl   = panel.querySelector(`#cold-corr-${safeId}`);
  const resultEl = panel.querySelector(`#cold-result-${safeId}`);
  if (!corrEl || !resultEl) return;

  if (isNaN(alt) || alt <= 0) {
    corrEl.innerHTML   = '<span style="color:var(--text3)">–</span>';
    resultEl.style.background = 'var(--surface)';
    resultEl.innerHTML = '<span style="font-size:13px;color:var(--text3)">—</span>';
    return;
  }

  if (isNaN(oat) || oat >= 0) {
    corrEl.innerHTML   = '<span style="color:var(--text3)">–</span>';
    resultEl.style.background = 'rgba(30,41,59,0.85)';
    resultEl.innerHTML = `<span style="font-family:monospace;font-size:14px;font-weight:700;color:#f1f5f9">${Math.round(alt).toLocaleString()}</span>`;
    return;
  }

  const haa = Math.max(0, alt - elev);
  const { corr } = _coldLookup(haa, oat);
  const corrected = alt + corr;

  corrEl.innerHTML = `
    <span style="display:inline-block;background:rgba(96,165,250,0.15);
                 border:1px solid rgba(96,165,250,0.4);color:#60a5fa;
                 border-radius:12px;padding:2px 10px;
                 font-size:12px;font-weight:700;font-family:monospace;white-space:nowrap">
      +${corr}
    </span>`;
  resultEl.style.background = 'rgba(30,41,59,0.85)';
  resultEl.innerHTML = `<span style="font-family:monospace;font-size:15px;font-weight:700;color:#f1f5f9">${Math.round(corrected).toLocaleString()}</span>`;
  _refreshIcaoTable(panel);
}

function _recalcAllColdRows(panel) {
  const tbody = panel.querySelector('#cold-rows');
  if (!tbody) return;
  tbody.querySelectorAll('.cold-alt-input').forEach(inp => {
    _calcOneRow(panel, inp.dataset.rowid, inp.dataset.safeid);
  });
  _refreshIcaoTable(panel);
}

function _getAllActiveCells(panel) {
  const activeCells = new Map();
  const elev = parseFloat(panel.querySelector('#cold-elev')?.value) || 0;
  const oat  = parseFloat(panel.querySelector('#cold-oat')?.value);
  if (isNaN(oat) || oat >= 0) return activeCells;
  const style = { bg: 'rgba(96,165,250,0.15)', border: '#60a5fa' };
  panel.querySelectorAll('.cold-alt-input').forEach(inp => {
    const alt = parseFloat(inp.value);
    if (isNaN(alt) || alt <= 0) return;
    const haa = Math.max(0, alt - elev);
    const { haaIdx, cLoIdx, cHiIdx } = _coldLookup(haa, oat);
    if (haaIdx >= 0) {
      activeCells.set(`${haaIdx},${cLoIdx}`, style);
      if (cHiIdx !== cLoIdx) activeCells.set(`${haaIdx},${cHiIdx}`, style);
    }
  });
  return activeCells;
}

function _refreshIcaoTable(panel) {
  const wrap = panel.querySelector('#cold-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = _coldTable(_getAllActiveCells(panel));
}

function _refreshColdNotes(panel) {
  const c = panel._cold;
  const notesEl = panel.querySelector('#cold-rab-notes');
  if (!notesEl) return;
  const note = _RAB_NOTE_TEXT[c.apType];
  if (!note) { notesEl.innerHTML = ''; return; }
  const labelColor = note.cls === 'red' ? '#f87171' : '#fb923c';
  notesEl.innerHTML = `
    <div style="background:rgba(96,165,250,0.06);border:1px solid rgba(96,165,250,0.2);
                border-radius:10px;padding:10px 14px;font-size:12px;margin-top:4px">
      <div style="font-weight:700;margin-bottom:4px;color:var(--text)">ℹ️ RAB 6.10.2 Notes:</div>
      <span style="color:${labelColor};font-weight:600">${note.label}:</span>
      <span style="color:var(--text2);margin-left:4px">${note.body}</span>
    </div>`;
}

function _refreshFPAResult(panel) {
  const c    = panel._cold;
  const oat  = parseFloat(panel.querySelector('#cold-oat')?.value);
  const elev = parseFloat(panel.querySelector('#cold-elev')?.value) || 0;

  if (c.fpaMode === 'direct') {
    const fpa   = parseFloat(panel.querySelector('#cold-fpa')?.value);
    const resEl = panel.querySelector('#cold-fpa-result');

    if (isNaN(fpa) || fpa <= 0 || isNaN(oat)) {
      if (resEl) resEl.textContent = '—';
      return;
    }
    if (oat >= 0) {
      if (resEl) resEl.textContent = fpa.toFixed(2) + '°';
      return;
    }
    const corrFPA = _coldCorrectedFPA(fpa, oat);
    if (resEl) resEl.textContent = corrFPA.toFixed(2) + '°';

  } else {
    const fafAlt = parseFloat(panel.querySelector('#cold-faf-vda')?.value);
    const dist   = parseFloat(panel.querySelector('#cold-dist-vda')?.value);
    const resEl  = panel.querySelector('#cold-vda-result');

    const vdaWrap = panel.querySelector('#cold-vda-wrap');
    if (isNaN(fafAlt) || isNaN(dist) || dist <= 0 || isNaN(oat) || oat >= 0) {
      if (resEl) resEl.textContent = '—';
      if (vdaWrap) vdaWrap.innerHTML = _vdaTable();
      return;
    }
    const fafHAA = Math.max(0, fafAlt - elev);
    const { corr } = _coldLookup(fafHAA, oat);
    const fafAGL = fafAlt + corr - elev;
    const vda = Math.atan(Math.max(0, fafAGL - 50) / (dist * 6076.115)) * (180 / Math.PI);
    if (resEl) resEl.textContent = vda > 0 ? vda.toFixed(2) + '°' : '—';
    if (vdaWrap) vdaWrap.innerHTML = _vdaTable(fafAGL, dist);
  }
}

// activeCells: Map<"ri,ci", {bg: rgba, border: hex}> for per-cell color highlight
function _coldTable(activeCells = new Map()) {
  // Build column highlight info
  const colStyles = new Map(); // ci → first style found
  activeCells.forEach((style, key) => {
    const ci = parseInt(key.split(',')[1]);
    if (!colStyles.has(ci)) colStyles.set(ci, style);
  });

  return `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:center">
        <thead>
          <tr style="background:var(--surface)">
            <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);
                       font-size:10px;color:var(--text3);white-space:nowrap;font-weight:600">
              HAA (ft) ↓ / OAT (°C) →
            </th>
            ${_COLD_OAT.map((c, ci) => {
              const cs = colStyles.get(ci);
              return `
              <th style="padding:5px 4px;border-bottom:1px solid var(--border);
                         font-weight:700;font-size:11px;
                         color:${cs ? cs.border : c < 0 ? 'var(--text2)' : 'var(--text3)'};
                         ${cs ? `background:${cs.bg};` : ''}">
                ${c}°
              </th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${_COLD_HAA.map((haa, ri) => {
            const rowHasHl = activeCells.size > 0 && [...activeCells.keys()].some(k => k.startsWith(`${ri},`));
            return `
            <tr style="${ri % 2 !== 0 ? 'background:var(--surface)' : ''}">
              <td style="padding:4px 8px;text-align:left;font-weight:700;
                         color:${rowHasHl ? 'var(--text)' : '#c49a3c'};
                         font-family:'JetBrains Mono','SF Mono',monospace;
                         border-right:1px solid var(--border);white-space:nowrap">
                ${haa.toLocaleString()}
              </td>
              ${_COLD_TBL[ri].map((v, ci) => {
                const cs = activeCells.get(`${ri},${ci}`);
                return `
                <td style="padding:4px 3px;
                           font-family:'JetBrains Mono','SF Mono',monospace;
                           font-weight:${cs ? '700' : '400'};
                           color:${cs ? cs.border : ci === 0 ? 'var(--text3)' : 'var(--text2)'};
                           background:${cs ? cs.bg : 'transparent'};
                           outline:${cs ? `1px solid ${cs.border}` : 'none'};
                           border-radius:4px">
                  ${v}
                </td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding:4px 10px 8px;font-size:10px;color:var(--text3)">
      資料來源：ICAO Doc 8168 PANS-OPS · 僅供參考，以官方 Jeppesen 表格為準
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// FPA Cold Correction Reference Table
// Nominal FPA × OAT → corrected FPA to set on aircraft
// ══════════════════════════════════════════════════════════════════

const _FPA_NOM = [2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8];
const _FPA_OAT = [-5, -10, -15, -20, -25, -30, -35, -40, -45, -50];

function _fpaTable(hlFPA = null, hlOAT = null) {
  let hlRow = -1, hlCol = -1;
  if (hlFPA !== null) {
    let minD = Infinity;
    _FPA_NOM.forEach((r, i) => { const d = Math.abs(r - hlFPA); if (d < minD) { minD = d; hlRow = i; } });
  }
  if (hlOAT !== null && hlOAT < 0) {
    let minD = Infinity;
    _FPA_OAT.forEach((c, i) => { const d = Math.abs(c - hlOAT); if (d < minD) { minD = d; hlCol = i; } });
  }

  return `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px;text-align:center">
        <thead>
          <tr style="background:var(--surface)">
            <th style="padding:5px 8px;text-align:left;border-bottom:1px solid var(--border);
                       font-size:10px;color:var(--text3);white-space:nowrap;font-weight:600">
              FPA↓ / OAT→
            </th>
            ${_FPA_OAT.map((oat, ci) => {
              const hl = ci === hlCol;
              return `<th style="padding:5px 4px;border-bottom:1px solid var(--border);
                                 font-weight:700;font-size:11px;
                                 color:${hl ? '#a78bfa' : 'var(--text2)'};
                                 ${hl ? 'background:rgba(167,139,250,0.15);' : ''}">
                ${oat}°
              </th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${_FPA_NOM.map((fpa, ri) => {
            const rowHl = ri === hlRow;
            return `
            <tr style="${ri % 2 !== 0 ? 'background:var(--surface)' : ''}">
              <td style="padding:4px 8px;text-align:left;font-weight:700;
                         color:${rowHl ? '#a78bfa' : '#c49a3c'};
                         font-family:'JetBrains Mono','SF Mono',monospace;
                         border-right:1px solid var(--border);white-space:nowrap;
                         ${rowHl ? 'background:rgba(167,139,250,0.08);' : ''}">
                ${fpa.toFixed(1)}°
              </td>
              ${_FPA_OAT.map((oat, ci) => {
                const corr  = _coldCorrectedFPA(fpa, oat);
                const isHl  = ri === hlRow && ci === hlCol;
                const diff  = corr - fpa;
                return `<td style="padding:4px 3px;
                                   font-family:'JetBrains Mono','SF Mono',monospace;
                                   font-weight:${isHl ? '700' : '400'};
                                   color:${isHl ? '#a78bfa' : 'var(--text2)'};
                                   background:${isHl ? 'rgba(167,139,250,0.35)' : 'transparent'};
                                   outline:${isHl ? '1px solid #a78bfa' : 'none'};
                                   border-radius:${isHl ? '4px' : '0'}">
                  ${corr.toFixed(2)}
                </td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding:4px 10px 8px;font-size:10px;color:var(--text3)">
      corrected = atan(tan(FPA) × ISA_K / OAT_K) · 紫色 = 當前選取值 · 僅供參考
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
// VDA Reference Table — FAF AGL × Dist to THR → VDA (°), TCH=50ft
// ══════════════════════════════════════════════════════════════════

// Jeppesen-style VDA table: 0.2 NM columns, 50 ft AGL rows, show 2.5°–3.8° only
const _VDA_DIST    = (() => { const a = []; for (let d = 2.8; d <= 6.01; d += 0.2) a.push(Math.round(d * 10) / 10); return a; })();
const _VDA_FAF_AGL = (() => { const a = []; for (let h = 900; h <= 2000; h += 50) a.push(h); return a; })();

function _vdaTable(hlFAF_AGL = null, hlDist = null) {
  let hlRow = -1, hlCol = -1;
  if (hlFAF_AGL !== null && hlFAF_AGL > 0) {
    let minD = Infinity;
    _VDA_FAF_AGL.forEach((r, i) => { const d = Math.abs(r - hlFAF_AGL); if (d < minD) { minD = d; hlRow = i; } });
  }
  if (hlDist !== null && hlDist > 0) {
    let minD = Infinity;
    _VDA_DIST.forEach((c, i) => { const d = Math.abs(c - hlDist); if (d < minD) { minD = d; hlCol = i; } });
  }

  return `
    <div style="overflow-x:auto">
      <table style="width:max-content;border-collapse:collapse;font-size:11px;text-align:center">
        <thead>
          <tr style="background:var(--surface)">
            <th style="padding:5px 8px;text-align:center;border-bottom:1px solid var(--border);
                       border-right:1px solid var(--border);font-size:10px;color:var(--text3);
                       font-weight:600;white-space:nowrap;min-width:54px">
              FAF<br>Height<br>(AGL)
            </th>
            ${_VDA_DIST.map((d, ci) => {
              const hl = ci === hlCol;
              return `<th style="padding:4px 2px;border-bottom:1px solid var(--border);
                                 font-weight:700;font-size:10px;min-width:26px;
                                 color:${hl ? '#a78bfa' : 'var(--text2)'};
                                 ${hl ? 'background:rgba(167,139,250,0.15);' : ''}">
                ${d.toFixed(1)}
              </th>`;
            }).join('')}
          </tr>
        </thead>
        <tbody>
          ${_VDA_FAF_AGL.map((agl, ri) => {
            const rowHl = ri === hlRow;
            return `
            <tr style="${ri % 2 !== 0 ? 'background:var(--surface)' : ''}">
              <td style="padding:3px 8px;text-align:center;font-weight:700;
                         color:${rowHl ? '#a78bfa' : '#c49a3c'};
                         font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;
                         border-right:1px solid var(--border);
                         ${rowHl ? 'background:rgba(167,139,250,0.08);' : ''}">
                ${agl.toLocaleString()}
              </td>
              ${_VDA_DIST.map((dist, ci) => {
                const vda  = Math.atan(Math.max(0, agl - 50) / (dist * 6076.115)) * (180 / Math.PI);
                const show = vda >= 2.45 && vda < 3.85;
                const isHl = ri === hlRow && ci === hlCol;
                return `<td style="padding:3px 2px;
                                   font-family:'JetBrains Mono','SF Mono',monospace;font-size:11px;
                                   font-weight:${isHl ? '700' : '400'};
                                   color:${isHl ? '#a78bfa' : 'var(--text2)'};
                                   background:${isHl && show ? 'rgba(167,139,250,0.35)' : 'transparent'};
                                   outline:${isHl && show ? '1px solid #a78bfa' : 'none'};
                                   border-radius:${isHl && show ? '3px' : '0'}">
                  ${show ? vda.toFixed(1) : ''}
                </td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div style="padding:4px 10px 8px;font-size:10px;color:var(--text3)">
      DISTANCE FAF TO RUNWAY THRESHOLD (NM) · VDA = atan((FAF AGL − 50ft) ÷ (Dist × 6076ft)) · TCH=50ft · 僅顯示 2.5°–3.8° · 紫色 = 選取值（名義角，不含低溫修正）
    </div>`;
}

// Cold temperature correction to FPA (Jeppesen method)
// corrected = atan(tan(fpa_nom) × ISA_K / OAT_K)
function _coldCorrectedFPA(fpa_nom, oat_c) {
  if (oat_c >= 0) return fpa_nom;
  const ISA_K = 288.15;
  const oat_K = oat_c + 273.15;
  return Math.atan(Math.tan(fpa_nom * Math.PI / 180) * (ISA_K / oat_K)) * (180 / Math.PI);
}

function _updateFPACorr(panel) {
  const fpa = parseFloat(panel.querySelector('#cold-fpa')?.value);
  const oat = parseFloat(panel.querySelector('#cold-oat')?.value);
  const resEl = panel.querySelector('#cold-res-fpa');

  if (isNaN(fpa) || fpa <= 0 || isNaN(oat) || oat >= 0) {
    if (resEl) resEl.innerHTML = '';
    return;
  }

  const corrFPA = _coldCorrectedFPA(fpa, oat);
  if (resEl) resEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;
                padding:5px 10px;background:var(--surface);border-radius:6px">
      <span style="font-size:11px;color:#a78bfa;font-weight:700;min-width:72px">FPA corrected</span>
      <span style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:var(--text2)">
        ${fpa.toFixed(1)}° →
      </span>
      <span style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:16px;font-weight:700;color:#a78bfa">
        ${corrFPA.toFixed(2)}°
      </span>
    </div>`;
}
