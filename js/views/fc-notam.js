// fc-notam.js — NOTAM Coordinate Visualizer (v2)
// Auto-loads from store.briefing (notamText + routePoints) and draws the
// actual OFP flight-plan route. Manual paste mode as fallback / supplement.

import store from '../store.js';
import { toICAO } from '../utils.js';

// ── Airport lat/lon for great-circle route drawing ───────────────────
const _APT_LL = {
  // Taiwan
  RCTP:[25.0777,121.2320], RCKH:[22.5771,120.3498], RCSS:[25.0694,121.5522],
  RCQC:[23.5687,119.6277], RCYU:[23.9769,121.6166], RCDI:[24.4327,118.3597],
  RCNN:[22.9501,120.2063], RCFN:[22.7551,121.1017],
  // Japan
  RJAA:[35.7647,140.3864], RJTT:[35.5494,139.7798], RJBB:[34.4273,135.2440],
  RJOO:[34.7855,135.4380], RJGG:[34.8583,136.8052], RJFF:[33.5853,130.4511],
  ROAH:[26.1958,127.6461], RJCC:[42.7752,141.6920], RJSS:[38.1397,140.9172],
  RJFT:[32.8370,130.8553], RJOA:[34.4362,133.2553], RJFO:[33.4822,131.7370],
  RJFK:[31.8034,130.7191], RJOM:[33.8272,132.6992], RJOT:[34.2140,134.0114],
  RJSA:[40.7347,140.6908], RJSK:[39.6156,140.2190], RJFR:[33.8497,130.9775],
  RJBD:[33.6622,135.3638],
  // Korea
  RKSI:[37.4692,126.4505], RKSS:[37.5582,126.7906], RKPK:[35.1795,128.9382],
  RKPC:[33.5113,126.4930],
  // SE Asia
  VTBS:[13.6811,100.7473], VTBD:[13.9126,100.6067], WMKK:[2.7456,101.7099],
  WSSS:[1.3644,103.9915], VVTS:[10.8188,106.6520], VVNB:[21.2212,105.8072],
  VHKK:[22.3089,113.9149], VHHH:[22.3089,113.9149], RPLL:[14.5086,121.0197],
  RPVM:[10.3075,123.9791], WADD:[8.7482,115.1671], WIII:[-6.1256,106.6559],
  WARR:[-7.3798,112.7867], WIMM:[3.6424,98.8855],
  // Vietnam
  VVDN:[16.0440,108.1993], VVCR:[11.9981,109.2197], VVPQ:[10.1700,103.9932],
  VVCT:[10.0854,105.7117], VVCI:[20.8191,106.7246], VVVD:[17.1677,107.0932],
  // Philippines extra
  RPVI:[10.8330,122.4936], RPVK:[11.6793,122.3757],
  // Malaysia extra
  WBKK:[5.9378,116.0508], WBGG:[1.4847,110.3463], WBGR:[4.3322,113.9869],
  WMKP:[5.2973,100.2764], WMKL:[6.1897,99.7286],
  // China / HK / Macau
  ZBAA:[40.0801,116.5846], ZBAD:[39.5093,116.4117], ZSPD:[31.1434,121.8050],
  ZSSS:[31.1980,121.3360], ZGGG:[23.3924,113.2990], ZUUU:[30.5785,103.9474],
  VMMC:[22.1496,113.5921],
  // US West Coast / Hawaii / Pacific
  KLAX:[33.9425,-118.4081], KSFO:[37.6213,-122.3790], KJFK:[40.6413,-73.7781],
  KSEA:[47.4502,-122.3088], KORD:[41.9742,-87.9073], KDEN:[39.8561,-104.6737],
  KLAS:[36.0840,-115.1537], KSNA:[33.6757,-117.8682], KSAN:[32.7336,-117.1897],
  KONT:[34.0560,-117.6009],
  PHNL:[21.3187,-157.9224], PHOG:[20.8986,-156.4305], PHKO:[19.7388,-156.0456],
  PHLI:[21.9760,-159.3386], PHTO:[19.7213,-155.0484],
  PGUM:[13.4834,144.7964], PGSN:[15.1190,145.7291],
  // Middle East
  OMDB:[25.2528,55.3644], OTHH:[25.2731,51.6080], OMAA:[24.4330,54.6511],
};

// ── Category definitions（順序即清單顯示順序）─────────────────────────
const _CAT = {
  volcanic:   { label: 'VAA/火山',   color: '#db2777', fill: '#db277730' },
  restricted: { label: '限航/演習', color: '#ef4444', fill: '#ef444430' },
  uav:        { label: 'UAV/無人機', color: '#f97316', fill: '#f9731630' },
  obstacle:   { label: '障礙物',     color: '#a855f7', fill: '#a855f730' },
  area:       { label: '一般區域',   color: '#3b82f6', fill: '#3b82f630' },
};

// ── Module state ──────────────────────────────────────────────────────
let _map        = null;
let _notamLG    = null;   // notam layer group
let _routeLG    = null;   // route layer group
let _notams     = [];     // parsed notam objects
let _visible    = new Set();
let _layerMap   = {};     // notam.id → leaflet layer
let _refLon     = null;   // 航路中心經度（用於 NOTAM 座標換日線對齊）
let _collapsed  = new Set();  // 已摺疊的分類 key

// 把經度調整到與 _refLon 最接近的等效值（±360），解決太平洋航線換日線問題
function _wrapLon(lon) {
  if (_refLon == null) return lon;
  let l = lon;
  while (l - _refLon >  180) l -= 360;
  while (l - _refLon < -180) l += 360;
  return l;
}

// ─────────────────────────────────────────────────────────────────────
export function mount(container) {
  _render(container);
  _initMap();
  // 完整 briefing 資料在 store.briefing（含 routePoints / notamText），store.flight 只是精簡版
  const b = store.briefing;
  if (b) {
    _drawRoute(b);
  }
  if (b?.notamText) {
    const parsed = _parseNotams(b.notamText);
    _applyNotams(parsed);
  }
  // 畫完後 fit bounds（航路 + NOTAM）
  setTimeout(() => _fitAll(), 300);
}

export function unmount() {
  if (_map) { _map.remove(); _map = null; }
  _notamLG = null; _routeLG = null; _notams = []; _visible.clear(); _layerMap = {};
  _collapsed.clear(); _refLon = null;
}

// ─────────────────────────────────────────────────────────────────────
function _render(container) {
  const hasAuto = !!(store.briefing?.notamText);
  const f = store.briefing || store.flight || {};
  const headerHtml = hasAuto
    ? `<div class="notam-auto-header">
         <span class="notam-auto-badge">AUTO</span>
         <span>${f.flightNumber || ''} ${f.dep || ''}→${f.dest || ''}</span>
       </div>`
    : `<div class="label" style="margin-bottom:8px">貼入 NOTAM / AIP 原始文本</div>
       <textarea id="notam-input" class="input mono" placeholder="A1234/26 NOTAMN&#10;Q) RJJJ/QRDCA/IV/...&#10;B) 2606010000 C) 2606302359&#10;E) AREA ..." style="height:220px;font-size:11px;resize:none;"></textarea>
       <div class="grid2" style="margin-top:10px">
         <button class="btn btn-primary" id="btn-notam-scan">⚡ 座標掃描</button>
         <button class="btn btn-ghost"   id="btn-notam-clear">清空重置</button>
       </div>`;

  container.innerHTML = `
    <div class="notam-page">
      <div class="notam-sidebar">
        <div class="card" style="padding:12px">
          ${headerHtml}
        </div>
        <div id="notam-count" class="notam-count" style="display:none"></div>
        <div id="notam-list"  class="notam-list"></div>
      </div>

      <div class="notam-map-wrap">
        <div id="notam-map"></div>
        <div class="notam-legend" id="notam-legend"></div>
      </div>
    </div>

    <style>
      .notam-page {
        display: grid;
        grid-template-columns: 300px 1fr;
        gap: 10px;
        height: calc(100vh - var(--topbar-h) - var(--tabbar-h));
        padding: 10px;
        overflow: hidden;
      }
      .notam-sidebar { overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
      .notam-map-wrap { position: relative; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border); }
      #notam-map { width: 100%; height: 100%; z-index: 1; }

      .notam-auto-header {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; color: var(--text2); font-weight: 600;
      }
      .notam-auto-badge {
        background: var(--teal); color: #000; font-size: 9px; font-weight: 800;
        padding: 2px 5px; border-radius: 3px; letter-spacing: 0.05em;
      }
      .notam-count {
        font-size: 12px; color: var(--text3);
        padding: 4px 0 0 4px;
      }
      .notam-list { display: flex; flex-direction: column; gap: 6px; }

      /* 分類群組 */
      .notam-group { border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
      .notam-group-head {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 10px; cursor: pointer; user-select: none;
        background: var(--card);
      }
      .notam-group-head:hover { background: rgba(255,255,255,0.04); }
      .notam-grp-cb { flex-shrink: 0; accent-color: var(--gold); width: 14px; height: 14px; }
      .notam-group-label { font-size: 12.5px; font-weight: 700; color: var(--text); flex: 1; }
      .notam-group-count { font-size: 11px; color: var(--text3); font-family: var(--mono); }
      .notam-chev { font-size: 11px; color: var(--text3); transition: transform 0.15s; transform: rotate(0deg); }
      .notam-chev.open { transform: rotate(90deg); }
      .notam-group-body { display: flex; flex-direction: column; gap: 3px; padding: 4px 6px 6px; }

      .notam-item {
        display: flex; align-items: flex-start; gap: 8px;
        background: rgba(255,255,255,0.02); border: 1px solid transparent;
        border-radius: var(--radius-sm); padding: 5px 8px; cursor: pointer;
        transition: border-color 0.15s;
      }
      .notam-item:hover { border-color: var(--gold); }
      .notam-item input[type=checkbox] { margin-top: 2px; flex-shrink: 0; accent-color: var(--gold); }
      .notam-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
      .notam-item-body { min-width: 0; }
      .notam-item-id { font-size: 12px; font-weight: 700; color: var(--text); font-family: var(--mono); }
      .notam-item-sub { font-size: 11px; color: var(--text3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .notam-legend {
        position: absolute; top: 40px; right: 10px; z-index: 1000;
        background: rgba(20,18,16,0.88); backdrop-filter: blur(8px);
        padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);
        font-size: 11px; color: var(--text2); display: flex; flex-direction: column; gap: 5px;
      }
      .notam-leg-item { display: flex; align-items: center; gap: 7px; }
      .notam-leg-dot { width: 9px; height: 9px; border-radius: 50%; }
      .notam-leg-route { width: 18px; height: 2px; background: #2dd4bf; border-radius: 1px; }

      /* Leaflet overrides */
      .leaflet-container { background: #e8e4df; }
      .leaflet-bar a { background: #fff !important; color: #555 !important; border-bottom: 1px solid #ccc !important; }
      .leaflet-control-attribution { background: rgba(255,255,255,0.75) !important; color: #888 !important; font-size: 9px !important; }
      .leaflet-popup-content-wrapper { background: #fff; color: #222; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
      .leaflet-popup-tip { background: #fff; }
      .leaflet-popup-close-button { color: #888 !important; font-size: 18px !important; }
      .notam-popup-id { font-size: 14px; font-weight: 800; font-family: var(--mono); color: #111; margin-bottom: 6px; }
      .notam-popup-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; color: #fff; margin-left: 8px; }
      .notam-popup-row { font-size: 12px; color: #444; margin: 3px 0; }
      .notam-popup-text { font-size: 11px; color: #666; margin-top: 8px; font-family: var(--mono); white-space: pre-wrap; max-height: 120px; overflow-y: auto; border-top: 1px solid #eee; padding-top: 6px; }

      @media (max-width: 860px) {
        .notam-page { grid-template-columns: 1fr; height: auto; overflow: visible; }
        .notam-map-wrap { height: 420px; order: -1; }
      }
    </style>
  `;

  _renderLegend();

  if (!hasAuto) {
    document.getElementById('btn-notam-scan').onclick  = _scanManual;
    document.getElementById('btn-notam-clear').onclick = _clearAll;
  }
}

function _renderLegend() {
  const leg = document.getElementById('notam-legend');
  if (!leg) return;
  const cats = Object.entries(_CAT).map(([k, c]) =>
    k === 'volcanic'
      ? `<div class="notam-leg-item"><span style="font-size:13px;line-height:1">🌋</span> ${c.label}</div>`
      : `<div class="notam-leg-item"><div class="notam-leg-dot" style="background:${c.color}"></div> ${c.label}</div>`
  ).join('');
  leg.innerHTML = cats +
    `<div class="notam-leg-item"><div class="notam-leg-route"></div> 飛行航線</div>`;
}

// ─────────────────────────────────────────────────────────────────────
function _initMap() {
  const el = document.getElementById('notam-map');
  if (!el || _map) return;

  _map = L.map('notam-map', { center: [23.8, 121.0], zoom: 5, zoomControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(_map);

  _routeLG = L.layerGroup().addTo(_map);
  _notamLG = L.layerGroup().addTo(_map);
}

// ─────────────────────────────────────────────────────────────────────
function _scanManual() {
  const text = (document.getElementById('notam-input')?.value || '').trim();
  if (!text) return;
  if (_notamLG) _notamLG.clearLayers();
  _notams = []; _visible.clear(); _layerMap = {};
  const parsed = _parseNotams(text);
  _applyNotams(parsed);
  setTimeout(() => _fitAll(), 200);
}

function _clearAll() {
  const inp = document.getElementById('notam-input');
  if (inp) inp.value = '';
  if (_notamLG) _notamLG.clearLayers();
  if (_routeLG) _routeLG.clearLayers();
  _notams = []; _visible.clear(); _layerMap = {};
  _renderList();
  _map?.setView([23.8, 121.0], 7);
}

// ─────────────────────────────────────────────────────────────────────
// Great circle route drawing
function _drawRoute(f) {
  if (!f || !_routeLG) return;
  _routeLG.clearLayers();

  let pts;

  // ── 優先使用 OFP 真實航路點 ────────────────────────────────────────
  if (f.routePoints?.length > 3) {
    pts = f.routePoints.map(p => [p[0], p[1]]);
  } else {
    // Fallback：dep↔dest 大圓
    const depLL  = _APT_LL[toICAO(f.dep  || '')];
    const destLL = _APT_LL[toICAO(f.dest || '')];
    if (!depLL || !destLL) return;
    pts = _greatCircle(depLL[0], depLL[1], destLL[0], destLL[1], 60);
  }

  // ── 換日線正規化（無論來源都需要）────────────────────────────────
  for (let i = 1; i < pts.length; i++) {
    while (pts[i][1] - pts[i-1][1] >  180) pts[i][1] -= 360;
    while (pts[i][1] - pts[i-1][1] < -180) pts[i][1] += 360;
  }

  // 記錄航路中心經度，供 NOTAM 座標對齊（_wrapLon）
  _refLon = pts.reduce((s, p) => s + p[1], 0) / pts.length;

  L.polyline(pts, { color: '#14b8a6', weight: 2.5, opacity: 0.9 }).addTo(_routeLG);

  // 沿途空心圓點
  const step = Math.max(1, Math.floor(pts.length / 20));
  for (let i = 0; i < pts.length; i += step) {
    L.circleMarker(pts[i], {
      radius: 3, color: '#14b8a6', fillColor: '#fff', fillOpacity: 0.8, weight: 1.5,
    }).addTo(_routeLG);
  }
  // Dep/dest 實心大點
  L.circleMarker(pts[0],              { radius: 6, color: '#fff', fillColor: '#14b8a6', fillOpacity: 1, weight: 2 }).addTo(_routeLG);
  L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#fff', fillColor: '#14b8a6', fillOpacity: 1, weight: 2 }).addTo(_routeLG);
}

// 球面插值大圓路線（返回 [lat, lon] 陣列，lon 尚未正規化）
function _greatCircle(lat1, lon1, lat2, lon2, n) {
  const R = Math.PI / 180;
  const φ1 = lat1*R, λ1 = lon1*R, φ2 = lat2*R, λ2 = lon2*R;
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2-φ1)/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin((λ2-λ1)/2)**2
  ));
  if (!d || isNaN(d)) return [[lat1,lon1],[lat2,lon2]];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1-f)*d) / Math.sin(d);
    const B = Math.sin(f*d) / Math.sin(d);
    const x = A*Math.cos(φ1)*Math.cos(λ1) + B*Math.cos(φ2)*Math.cos(λ2);
    const y = A*Math.cos(φ1)*Math.sin(λ1) + B*Math.cos(φ2)*Math.sin(λ2);
    const z = A*Math.sin(φ1) + B*Math.sin(φ2);
    pts.push([
      Math.atan2(z, Math.sqrt(x*x + y*y)) / R,
      Math.atan2(y, x) / R,
    ]);
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────
// NOTAM parsing
function _parseNotams(text) {
  // LIDO NOTAM bulletin 內含 <b>...</b> 等 HTML 標籤，先清除
  const clean = text.replace(/<\/?[a-z][^>]*>/gi, '');
  const blocks = _splitNotams(clean);
  return blocks.map(b => _parseOneNotam(b.id, b.text)).filter(n => n.points.length || n.circles.length);
}

function _splitNotams(text) {
  // NOTAM IDs: e.g. A1234/26, 1A1278/26, SX0007/26, 1J4898/26
  // Match a short alphanum prefix + digits / 2-digit year
  const re = /(?:^|\n)([A-Z0-9]{1,4}\d{1,5}\/\d{2})\b/g;
  const positions = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    positions.push({ id: m[1].trim(), pos: m.index });
  }

  if (!positions.length) {
    // No IDs found — treat entire text as one anonymous block
    return [{ id: 'NOTAM', text }];
  }

  const blocks = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].pos;
    const end   = i + 1 < positions.length ? positions[i+1].pos : text.length;
    blocks.push({ id: positions[i].id, text: text.substring(start, end).trim() });
  }
  return blocks;
}

function _parseOneNotam(id, text) {
  // 取本則「乾淨內文」：切掉尾端屬於「下一則」的置中段名標題與分隔線
  // （LIDO 公告每則前面都有「段名 + ----」標題，會被吃進前一則尾巴，
  //   尤其 VAA 火山段名會讓軍事 NOTAM 被誤判成火山）
  const body = _notamBody(text);
  const cat  = _classifyNotam(body);
  const alt  = _parseAltitude(body);
  const vld  = _parseValidity(body);
  const { points, circles } = _extractCoords(body);
  text = body;

  // Shape label
  let shapeLabel = '';
  if (circles.length && !points.length) {
    shapeLabel = circles.map(c => `圓 ${c.radiusNM}NM`).join(' + ');
  } else if (points.length === 1 && !circles.length) {
    shapeLabel = `點位 ×1`;
  } else if (points.length > 1) {
    shapeLabel = `多邊形・${points.length} 頂點`;
  }
  if (circles.length && points.length) {
    shapeLabel = `多邊形 ${points.length}・圓 ${circles[0].radiusNM}NM`;
  }

  // Short excerpt of text for popup
  const excerpt = text
    .replace(/[A-Z]\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
    .slice(0, 600);

  return { id, cat, alt, vld, points, circles, shapeLabel, excerpt };
}

// 取本則 NOTAM 的乾淨內文：
// 公告每則前面有「（置中）段名 + 分隔線(----/====)」標題，這標題屬於「下一則」，
// 但區塊切割是「本則編號 → 下一則編號」，導致下一則的標題被吃進本則尾巴。
// 作法：切到本則第一條分隔線為止；若分隔線上一行是（前面隔著空行的）段名標題，一併移除。
function _notamBody(text) {
  const lines = text.split('\n');
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^[ \t]*[-=]{5,}[ \t]*$/.test(lines[i])) { cut = i; break; }
  }
  let end = cut;
  if (end - 1 >= 0 && lines[end - 1].trim() !== '' &&
      (end - 2 < 0 || lines[end - 2].trim() === '')) {
    end = end - 1;  // 丟掉分隔線正上方那行置中段名（屬於下一則）
  }
  return lines.slice(0, end).join('\n').trim();
}

// Classify by Q-code then keywords
function _classifyNotam(text) {
  const t = text.toUpperCase();
  // VAA / 火山 最優先（火山灰諮詢以 VAA / ASH ADVISORY 形式給出）
  // 注意：用 ASH ADVISORY / ASH CLD / VA CLD 而非裸 \bASH\b，避免地名等誤判
  if (/\bVAA\b|VOLCAN|VOLCANO|ASH ADVISORY|ASH CLD|\bVA CLD\b/.test(t)) return 'volcanic';

  const q = text.match(/Q\)[^/\n]*\/Q([A-Z]{2,3})/);
  if (q) {
    const c = q[1];
    if (c.startsWith('UA') || c.startsWith('UU')) return 'uav';
    if (c.startsWith('OB') || c.startsWith('OL') || c.startsWith('OC')) return 'obstacle';
    if (c.startsWith('RD') || c.startsWith('DG') || c.startsWith('WE') || c.startsWith('WL')
        || c.startsWith('RT') || c.startsWith('RP')) return 'restricted';
  }
  if (/\bUAV\b|\bUAS\b|\bUNMANN|\bDRONE\b/.test(t)) return 'uav';
  if (/\bOBSTACLE\b|\bCRANE\b|\bMAST\b|\bTOWER\b|\bCHIMNEY\b/.test(t)) return 'obstacle';
  // 限航/演習：含軍事活動（MIL ACT / MILITARY / TRAINING AREA / EXERCISE）、
  // 禁限航區、不放行非參演航機等
  if (/RESTRICT|PROHIBIT|DANGER AREA|\bMIL\b|MILITARY|MIL\s*(EXERC|TRAIN|ACT)|TRAINING AREA|EXERCISE|WILL NOT CLEAR|NON-PARTICIPATING|ROCKET|FRNG|\bGUN\b|FIRING|ACTIV/.test(t)) return 'restricted';
  return 'area';
}

// Parse altitude from F/G fields or text
function _parseAltitude(text) {
  const f = text.match(/\bF\)\s*([^\n]+)/);
  const g = text.match(/\bG\)\s*([^\n]+)/);
  if (f || g) {
    const lo = (f?.[1] || 'SFC').trim().split(/\s/)[0];
    const hi = (g?.[1] || 'UNL').trim().split(/\s/)[0];
    return `${lo} ~ ${hi}`;
  }
  // From Q-line: /000/040/ → FL000 ~ FL040
  const qAlt = text.match(/\/(\d{3})\/(\d{3})\//);
  if (qAlt) {
    const lo = qAlt[1] === '000' ? 'SFC' : `FL${qAlt[1]}`;
    const hi = qAlt[2] === '999' ? 'UNL' : `FL${qAlt[2]}`;
    return `${lo} ~ ${hi}`;
  }
  // From text: "SFC TO FL230", "300FT AMSL", etc.
  const m = text.match(/(SFC|GND|FL\d{2,3}|\d+FT\s*AMSL)\s*[-~TO ]+\s*(UNL|FL\d{2,3}|\d+FT\s*AMSL)/i);
  if (m) return `${m[1].trim()} ~ ${m[2].trim()}`;
  return null;
}

// Parse B/C validity fields
function _parseValidity(text) {
  const b = text.match(/\bB\)\s*(\d{10})/);
  const c = text.match(/\bC\)\s*(\d{10}|PERM)/i);
  return { from: b?.[1] || null, to: c?.[1] || 'PERM' };
}

// Extract coordinate pairs and Q-line circles
function _extractCoords(text) {
  const points = [];
  const circles = [];

  // Q-line circles: .../NNNNNS EEEEEEE E NNN (radius in NM)
  const qRe = /Q\).+?\/(\d{4,6})([NS])(\d{5,7})([EW])(\d{3})/g;
  let m;
  while ((m = qRe.exec(text)) !== null) {
    const lat = _parseCoord(m[1], m[2]);
    const lon = _parseCoord(m[3], m[4]);
    const nm  = parseInt(m[5]);
    if (lat != null && lon != null && nm > 0) circles.push({ lat, lon, radiusNM: nm });
  }

  // Coordinate pairs: DDMMSS.ssN DDDMMSS.ssE（數字在前，如 241554N 1203715E）
  const cpRe = /(\d{4,9}(?:\.\d+)?)([NS])\s*[\/]?\s*(\d{5,10}(?:\.\d+)?)([EW])/g;
  while ((m = cpRe.exec(text)) !== null) {
    const lat = _parseCoord(m[1], m[2]);
    const lon = _parseCoord(m[3], m[4]);
    if (lat != null && lon != null) points.push([lat, lon]);
  }

  // 字母在前格式（VAAC 火山諮詢常見，如 PSN: N3136 E13039）
  const cpRe2 = /\b([NS])(\d{4,6}(?:\.\d+)?)\s*[\/]?\s*([EW])(\d{5,7}(?:\.\d+)?)\b/g;
  while ((m = cpRe2.exec(text)) !== null) {
    const lat = _parseCoord(m[2], m[1]);
    const lon = _parseCoord(m[4], m[3]);
    if (lat != null && lon != null) points.push([lat, lon]);
  }

  return { points, circles };
}

function _parseCoord(val, dir) {
  const dotIdx = val.indexOf('.');
  const intPart = dotIdx >= 0 ? val.substring(0, dotIdx) : val;
  const fracStr = dotIdx >= 0 ? val.substring(dotIdx) : '';
  const len = intPart.length;
  let deg, min, sec;

  if (len === 4 || len === 5) {
    const dLen = len === 4 ? 2 : 3;
    deg = parseInt(intPart.substring(0, dLen));
    min = parseFloat(intPart.substring(dLen) + fracStr);
    sec = 0;
  } else if (len === 6 || len === 7) {
    const dLen = len === 6 ? 2 : 3;
    deg = parseInt(intPart.substring(0, dLen));
    min = parseInt(intPart.substring(dLen, dLen + 2));
    sec = parseFloat(intPart.substring(dLen + 2) + fracStr);
  } else {
    return null;
  }

  let res = deg + (min / 60) + (sec / 3600);
  if (dir === 'S' || dir === 'W') res = -res;
  return res;
}

// ─────────────────────────────────────────────────────────────────────
// Apply parsed NOTAMs to map and list
function _applyNotams(notams) {
  _notams  = notams;
  _visible = new Set(notams.map(n => n.id));
  _layerMap = {};
  _collapsed = new Set(notams.map(n => n.cat));  // 預設全部摺疊（精簡顯示）

  if (_notamLG) _notamLG.clearLayers();

  for (const n of notams) {
    const layer = _buildLayer(n);
    if (layer) {
      _layerMap[n.id] = layer;
      layer.addTo(_notamLG);
    }
  }

  _renderList();
  _updateCount();
}

function _buildLayer(n) {
  const c = _CAT[n.cat] || _CAT.area;
  const opts = { color: c.color, fillColor: c.fill || c.color, fillOpacity: 0.25, weight: 1.5, opacity: 0.9 };
  const popup = _buildPopup(n);
  const group = L.layerGroup();
  const isVolcano = n.cat === 'volcanic';

  // 經度對齊航路框架（解決太平洋換日線）
  const pts = n.points.map(p => [p[0], _wrapLon(p[1])]);

  if (n.circles.length) {
    for (const circ of n.circles) {
      const center = [circ.lat, _wrapLon(circ.lon)];
      L.circle(center, { ...opts, radius: circ.radiusNM * 1852 })
        .bindPopup(popup, { maxWidth: 340 }).addTo(group);
      if (isVolcano) _volcanoMarker(center, popup).addTo(group);
    }
  }
  if (pts.length > 2) {
    L.polygon(pts, opts).bindPopup(popup, { maxWidth: 340 }).addTo(group);
    if (isVolcano) _volcanoMarker(_centroid(pts), popup).addTo(group);
  } else if (pts.length === 2) {
    L.polyline(pts, { color: c.color, weight: 2.5 })
      .bindPopup(popup, { maxWidth: 340 }).addTo(group);
    if (isVolcano) _volcanoMarker(_centroid(pts), popup).addTo(group);
  } else if (pts.length === 1) {
    if (isVolcano) {
      _volcanoMarker(pts[0], popup).addTo(group);
    } else {
      L.circleMarker(pts[0], { ...opts, radius: 6, fillOpacity: 0.9 })
        .bindPopup(popup, { maxWidth: 340 }).addTo(group);
    }
  }

  if (!n.circles.length && !pts.length) return null;
  return group;
}

// 火山符號標記（🌋），用於 VAA/火山類別 NOTAM 的位置
function _volcanoMarker(latlng, popup) {
  const icon = L.divIcon({
    className: 'notam-volcano-icon',
    html: '<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45))">🌋</div>',
    iconSize: [26, 26],
    iconAnchor: [13, 22],
  });
  return L.marker(latlng, { icon, zIndexOffset: 1000 }).bindPopup(popup, { maxWidth: 340 });
}

// 多邊形/線段的幾何中心（取頂點平均）
function _centroid(pts) {
  const n = pts.length;
  const lat = pts.reduce((s, p) => s + p[0], 0) / n;
  const lon = pts.reduce((s, p) => s + p[1], 0) / n;
  return [lat, lon];
}

function _buildPopup(n) {
  const c = _CAT[n.cat] || _CAT.area;
  const validStr = n.vld.from
    ? `${n.vld.from} - ${n.vld.to}`
    : '';
  return `<div class="notam-popup-id">${n.id}
    <span class="notam-popup-badge" style="background:${c.color}">${c.label}</span>
  </div>
  ${n.shapeLabel ? `<div class="notam-popup-row">${n.shapeLabel}</div>` : ''}
  ${n.alt         ? `<div class="notam-popup-row">高度：${n.alt}</div>` : ''}
  ${validStr      ? `<div class="notam-popup-row" style="color:var(--text3)">生效：${validStr}</div>` : ''}
  <div class="notam-popup-text">${n.excerpt}</div>`;
}

// ─────────────────────────────────────────────────────────────────────
// 單一 NOTAM 顯示/隱藏
function _setNotamVisible(id, show) {
  const layer = _layerMap[id];
  if (show) {
    _visible.add(id);
    if (layer && !_notamLG.hasLayer(layer)) layer.addTo(_notamLG);
  } else {
    _visible.delete(id);
    if (layer) _notamLG.removeLayer(layer);
  }
}

// 分類摺疊列表
function _renderList() {
  const el = document.getElementById('notam-list');
  if (!el) return;

  if (!_notams.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:4px">尚無可繪製 NOTAM</div>';
    return;
  }

  // 依 _CAT 順序分組
  let html = '';
  for (const cat of Object.keys(_CAT)) {
    const items = _notams.filter(n => n.cat === cat);
    if (!items.length) continue;
    const c = _CAT[cat];
    const visCount = items.filter(n => _visible.has(n.id)).length;
    const allOn  = visCount === items.length;
    const someOn = visCount > 0 && !allOn;
    const collapsed = _collapsed.has(cat);

    html += `<div class="notam-group" data-cat="${cat}">
      <div class="notam-group-head">
        <input type="checkbox" class="notam-grp-cb" data-cat="${cat}" ${allOn ? 'checked' : ''}>
        <span class="notam-dot" style="background:${c.color}"></span>
        <span class="notam-group-label">${c.label}</span>
        <span class="notam-group-count">${visCount}/${items.length}</span>
        <span class="notam-chev ${collapsed ? '' : 'open'}" data-cat="${cat}">▸</span>
      </div>
      <div class="notam-group-body" style="${collapsed ? 'display:none' : ''}">
        ${items.map(n => `
          <label class="notam-item" data-id="${n.id}">
            <input type="checkbox" class="notam-item-cb" ${_visible.has(n.id) ? 'checked' : ''} data-id="${n.id}">
            <div class="notam-item-body">
              <div class="notam-item-id">${n.id}</div>
              <div class="notam-item-sub">${n.shapeLabel}${n.alt ? ' · ' + n.alt : ''}</div>
            </div>
          </label>`).join('')}
      </div>
    </div>`;
  }
  el.innerHTML = html;

  // 設定 group master checkbox 的 indeterminate 狀態
  for (const cat of Object.keys(_CAT)) {
    const items = _notams.filter(n => n.cat === cat);
    if (!items.length) continue;
    const visCount = items.filter(n => _visible.has(n.id)).length;
    const cb = el.querySelector(`.notam-grp-cb[data-cat="${cat}"]`);
    if (cb) cb.indeterminate = visCount > 0 && visCount < items.length;
  }

  // 個別 NOTAM checkbox
  el.querySelectorAll('.notam-item-cb').forEach(cb => {
    cb.addEventListener('change', e => {
      _setNotamVisible(e.target.dataset.id, e.target.checked);
      _refreshGroupHead(e.target.closest('.notam-group')?.dataset.cat);
      _updateCount();
    });
  });

  // 群組 master checkbox（一鍵全選/全隱）
  el.querySelectorAll('.notam-grp-cb').forEach(cb => {
    cb.addEventListener('change', e => {
      const cat = e.target.dataset.cat;
      const show = e.target.checked;
      _notams.filter(n => n.cat === cat).forEach(n => _setNotamVisible(n.id, show));
      _renderList();
      _updateCount();
    });
  });

  // 摺疊/展開（點 header 或箭頭）
  el.querySelectorAll('.notam-group-head').forEach(head => {
    head.addEventListener('click', e => {
      if (e.target.classList.contains('notam-grp-cb')) return;  // 勾選不觸發摺疊
      const cat = head.parentElement.dataset.cat;
      if (_collapsed.has(cat)) _collapsed.delete(cat); else _collapsed.add(cat);
      _renderList();
    });
  });
}

// 只更新某分類 header 的勾選/計數狀態（不整個重繪）
function _refreshGroupHead(cat) {
  if (!cat) return;
  const el = document.getElementById('notam-list');
  const items = _notams.filter(n => n.cat === cat);
  const visCount = items.filter(n => _visible.has(n.id)).length;
  const cb = el.querySelector(`.notam-grp-cb[data-cat="${cat}"]`);
  if (cb) { cb.checked = visCount === items.length; cb.indeterminate = visCount > 0 && visCount < items.length; }
  const cnt = el.querySelector(`.notam-group[data-cat="${cat}"] .notam-group-count`);
  if (cnt) cnt.textContent = `${visCount}/${items.length}`;
}

function _updateCount() {
  const el = document.getElementById('notam-count');
  if (!el) return;
  if (!_notams.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.textContent = `已偵測 ${_notams.length} 則可繪製 NOTAM`;
}

// ─────────────────────────────────────────────────────────────────────
// Fit map to all visible layers (route + NOTAMs)
function _fitAll() {
  if (!_map) return;
  const allPts = [];

  // Collect points from route layer
  _routeLG?.eachLayer(l => {
    try {
      if (l.getLatLngs) {
        const lls = l.getLatLngs();
        const flat = Array.isArray(lls[0]) ? lls.flat() : lls;
        flat.forEach(ll => allPts.push([ll.lat, ll.lng]));
      } else if (l.getLatLng) {
        const ll = l.getLatLng();
        allPts.push([ll.lat, ll.lng]);
      }
    } catch (_) {}
  });

  // Collect from NOTAM layers
  _notamLG?.eachLayer(grp => {
    try {
      grp.eachLayer?.(l => {
        if (l.getBounds) {
          const b = l.getBounds();
          allPts.push([b.getNorth(), b.getWest()]);
          allPts.push([b.getSouth(), b.getEast()]);
        } else if (l.getLatLng) {
          const ll = l.getLatLng();
          allPts.push([ll.lat, ll.lng]);
        }
      });
    } catch (_) {}
  });

  if (!allPts.length) return;
  _map.fitBounds(L.latLngBounds(allPts), { padding: [50, 50] });
}
