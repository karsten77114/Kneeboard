// Flight Crew > Weather
import store from '../store.js';
import storage from '../services/storage.js';
import { fetchAtis, fetchMetar, preloadMetarForFlight } from '../services/api.js';
import { showToast, toICAO } from '../utils.js';

const WORKER = 'https://jx-briefing.karsten77114.workers.dev';

// ── Module-level state ───────────────────────────────────────────
const SUB_TABS = [
  { id: 'metar',  label: 'METAR/TAF' },
  { id: 'atis',   label: 'D-ATIS' },
  { id: 'chart',  label: 'OFP Charts' },
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

let _activeSubTab = 'metar';

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
        <div class="aw-raw">${_colorizeWX(c.metar || '—')}</div>
        ${tafFormatted ? `<div class="aw-sec">TAF</div><div class="aw-raw aw-taf">${_colorizeWX(tafFormatted)}</div>` : ''}
      </div>
    </div>`;
}

function _renderMetar(panel) {
  const apts = _airports();

  panel.innerHTML = `
    ${apts.length ? apts.map(({ icao, role }) => _awCard(icao, role)).join('') : `
      <div class="state-screen" style="min-height:20vh">
        <div class="state-icon">🌤</div>
        <div class="state-sub">查詢航班後自動帶入起、訖、備降機場</div>
      </div>
    `}

    <!-- Manual search -->
    <div class="card" style="margin-top:${apts.length ? '6' : '0'}px">
      <div class="card-title">手動查詢 Manual Query</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="input input-upper" id="metar-icao"
               placeholder="ICAO (e.g. RJTT)" style="width:140px">
        <button class="btn btn-primary btn-sm" id="btn-metar-go">查詢</button>
      </div>
      <div id="metar-manual-result" style="margin-top:10px"></div>
    </div>`;

  // Bind refresh buttons
  apts.forEach(({ icao }) => {
    panel.querySelector(`#refr-${icao}`)?.addEventListener('click', () => {
      store.setWxData(icao, null);
      preloadMetarForFlight([icao]).catch(() => {});
    });
    if (!store.wxData[icao]) preloadMetarForFlight([icao]).catch(() => {});
  });

  // Manual search
  const _manualSearch = () => {
    const icao = panel.querySelector('#metar-icao').value.trim().toUpperCase();
    if (!icao) return;
    const res = panel.querySelector('#metar-manual-result');
    res.innerHTML = _awCard(icao, '');
    res.querySelector(`#refr-${icao}`)?.addEventListener('click', () => {
      store.setWxData(icao, null);
      preloadMetarForFlight([icao]).catch(() => {});
    });
    if (!store.wxData[icao] || store.wxData[icao].error) {
      preloadMetarForFlight([icao]).catch(() => {});
    }
  };
  panel.querySelector('#btn-metar-go').onclick = _manualSearch;
  panel.querySelector('#metar-icao').addEventListener('keydown', e => { if (e.key === 'Enter') _manualSearch(); });
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

  // Manual search
  const goAtis = () => {
    const icao = panel.querySelector('#atis-icao').value.trim().toUpperCase();
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

  const { token } = storage.getLidoCredentials();
  if (!token) {
    panel.innerHTML = `
      <div class="state-screen" style="min-height:30vh">
        <div class="state-icon">🔐</div>
        <div class="state-title">LIDO 未登入</div>
        <div class="state-sub">請先在首頁登入 LIDO。</div>
      </div>`;
    return;
  }

  // Build infobar
  const infoHtml = `
    <div style="font-size:11px;color:var(--text2);padding:0 0 8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,.1);color:var(--text2)">OFP</span>
      <strong>${b.flightNumber || ''}</strong>
      ${b.dep || ''}→${b.dest || ''}
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
// Turbli
// ══════════════════════════════════════════════════════════════════

function _renderTurbli(panel) {
  const f = store.flight || {};
  const b = store.briefing;
  const dep  = b?.dep  || f?.dep  || '';
  const dest = b?.dest || f?.dest || '';
  const fltNo = (b?.flightNumber || f?.flightNumber || '').replace(/^JX/i, '');

  const turbliUrl = dep && dest
    ? `https://turbli.com/turbulence-forecast?from=${dep}&to=${dest}`
    : 'https://turbli.com';

  const turbliFlightUrl = fltNo
    ? `https://turbli.com/turbulence-forecast?airline=JX&flight=${fltNo}`
    : null;

  panel.innerHTML = `
    <div class="card" style="margin-bottom:10px">
      <div class="card-title">Turbli 亂流預測</div>
      <div style="color:var(--text2);font-size:13px;line-height:1.7;margin-bottom:14px">
        Turbli 以 ECMWF 高空風資料預測航路亂流強度（MOG/SEV），點擊下方按鈕在新視窗開啟。
      </div>

      ${dep && dest ? `
        <div class="card" style="margin-bottom:10px;background:var(--surface)">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-size:16px;font-weight:800;color:#c49a3c">
                ${dep} → ${dest}
              </div>
              <div style="font-size:12px;color:var(--text3)">航路亂流預測</div>
            </div>
            <a href="${turbliUrl}" target="_blank" rel="noopener"
               class="btn btn-primary">查詢航路 ↗</a>
          </div>
        </div>
      ` : ''}

      ${turbliFlightUrl ? `
        <div class="card" style="margin-bottom:10px;background:var(--surface)">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-size:16px;font-weight:800;color:var(--blue)">JX${fltNo}</div>
              <div style="font-size:12px;color:var(--text3)">依班號查詢亂流</div>
            </div>
            <a href="${turbliFlightUrl}" target="_blank" rel="noopener"
               class="btn btn-blue">查詢班號 ↗</a>
          </div>
        </div>
      ` : ''}

      ${!dep && !dest ? `
        <div class="state-screen" style="min-height:15vh">
          <div class="state-sub">查詢航班後自動帶入起訖機場</div>
        </div>
      ` : ''}

      <hr class="divider">
      <div class="card-title">手動查詢</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <div class="form-label">出發 DEP</div>
          <input class="input input-upper" id="trb-dep" placeholder="ICAO"
                 style="width:110px" value="${dep}">
        </div>
        <div>
          <div class="form-label">目的地 DEST</div>
          <input class="input input-upper" id="trb-dest" placeholder="ICAO"
                 style="width:110px" value="${dest}">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-trb-go">開啟 Turbli ↗</button>
      </div>
    </div>

    <div class="card" style="background:var(--surface)">
      <div class="card-title">說明</div>
      <div style="font-size:12px;color:var(--text2);line-height:1.8">
        <div>· 亂流強度：Light / Moderate / Severe / Extreme</div>
        <div>· 資料來源：ECMWF 72小時預報</div>
        <div>· 建議起飛前 2-4 小時查詢最新預報</div>
        <div>· 與 SIGMET / PIREPs 交叉確認</div>
      </div>
    </div>`;

  panel.querySelector('#btn-trb-go')?.addEventListener('click', () => {
    const d = panel.querySelector('#trb-dep').value.trim().toUpperCase();
    const t = panel.querySelector('#trb-dest').value.trim().toUpperCase();
    if (d && t) {
      window.open(`https://turbli.com/turbulence-forecast?from=${d}&to=${t}`, '_blank', 'noopener');
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// Cold Temp
// ══════════════════════════════════════════════════════════════════

function _renderCold(panel) {
  panel.innerHTML = `
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">ICAO 低溫修正 Cold Temperature Correction</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div class="form-group" style="margin:0">
          <label class="form-label">發布高度 Published Alt (ft)</label>
          <input class="input" id="cold-alt" type="number" placeholder="例：3000">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">機場溫度 Airport Temp (°C)</label>
          <input class="input" id="cold-temp" type="number" placeholder="例：-20">
        </div>
      </div>
      <div class="form-group" style="margin-bottom:14px">
        <label class="form-label">機場高程 Airport Elevation (ft)</label>
        <input class="input" id="cold-elev" type="number" placeholder="例：100">
      </div>
      <button class="btn btn-primary btn-full" id="btn-cold-calc">計算 Calculate</button>
      <div id="cold-result" style="margin-top:14px"></div>
    </div>

    <div class="card">
      <div class="card-title">ICAO Doc 8168 修正量表（節錄）</div>
      ${_coldTable()}
    </div>`;

  panel.querySelector('#btn-cold-calc').onclick = () => _calcCold(panel);

  // Enter key support
  panel.querySelectorAll('#cold-alt, #cold-temp, #cold-elev').forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') _calcCold(panel); });
  });
}

function _calcCold(panel) {
  const alt  = parseFloat(panel.querySelector('#cold-alt').value)  || 0;
  const temp = parseFloat(panel.querySelector('#cold-temp').value);
  const elev = parseFloat(panel.querySelector('#cold-elev').value) || 0;
  const res  = panel.querySelector('#cold-result');

  if (!alt || isNaN(temp)) {
    res.innerHTML = `<div class="err-msg">請填寫發布高度與溫度</div>`;
    return;
  }
  if (temp >= 0) {
    res.innerHTML = `<div style="color:var(--text2);font-size:13px">溫度 ≥ 0°C，不需低溫修正。</div>`;
    return;
  }

  const isaDeviation  = 15 - temp;
  const altAboveElev  = alt - elev;
  const correction    = Math.ceil((isaDeviation * altAboveElev) / (273 + temp) * -1 / 10) * 10;
  const correctedAlt  = alt + correction;

  res.innerHTML = `
    <div style="background:var(--surface);border-radius:10px;padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="color:var(--text2)">修正量 Correction</span>
        <span style="font-weight:800;color:#c49a3c;font-size:22px;font-family:'SF Mono',monospace">
          +${correction} ft
        </span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text2)">修正後高度 Corrected Alt</span>
        <span style="font-weight:800;font-size:18px;font-family:'SF Mono',monospace">
          ${correctedAlt} ft
        </span>
      </div>
    </div>
    <div style="color:var(--text3);font-size:11px;margin-top:8px">
      ※ 計算結果僅供參考，請以官方 Jeppesen 表格為準。
    </div>`;
}

function _coldTable() {
  const temps   = [-10, -20, -30, -40, -50];
  const heights = [200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 3000, 4000, 5000];
  const table   = {
    '-10': [20,  30,  40,  50,  60,  70,  80,  90,  100,  150,  200,  290,  390,  490],
    '-20': [30,  50,  70,  90, 110, 120, 140, 160,  180,  270,  360,  530,  710,  890],
    '-30': [50,  80, 110, 140, 170, 200, 230, 260,  290,  440,  590,  870, 1160, 1450],
    '-40': [70, 110, 160, 210, 250, 300, 340, 390,  430,  650,  870, 1280, 1710, 2130],
    '-50': [90, 150, 210, 280, 340, 400, 460, 520,  580,  880, 1170, 1730, 2310, 2890],
  };
  return `
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:11px;text-align:center;font-family:'SF Mono',monospace">
        <thead>
          <tr style="color:var(--text3)">
            <th style="padding:4px 6px;text-align:left;border-bottom:1px solid var(--border);white-space:nowrap">
              Temp °C ↓ / Ht ft →
            </th>
            ${heights.map(h => `<th style="padding:4px 3px;border-bottom:1px solid var(--border)">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${temps.map(t => `
            <tr>
              <td style="padding:4px 6px;color:#c49a3c;font-weight:700;text-align:left">${t}</td>
              ${(table[String(t)] || []).map(v =>
                `<td style="padding:4px 3px;color:var(--text2)">${v}</td>`
              ).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}
