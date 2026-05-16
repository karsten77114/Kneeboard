import store from '../store.js';

let map = null;
let layerGroup = null;

export function mount(container) {
  _render(container);
  // Delay map init so CSS layout is fully computed before Leaflet measures the container
  requestAnimationFrame(() => {
    setTimeout(() => {
      _initMap();
    }, 80);
  });
}

export function unmount(container) {
  if (map) {
    map.remove();
    map = null;
  }
}

function _render(container) {
  container.innerHTML = `
    <div class="view-content fc-notam-radar">
      <div class="radar-layout">
        <div class="radar-panel">
          <div class="section-title">NOTAM COOR. VISUALIZER</div>
          <div class="card">
            <div class="label" style="margin-bottom:8px">Paste raw NOTAM / AIP text</div>
            <textarea id="radar-input" class="input mono" placeholder="e.g.:\nA1234/24 NOTAMN\nQ) RJJJ/QWLW/IV/M/W/000/040/351234N1394567E005\nAREA: 351234N 1394567E ..." style="height: 300px; font-size: 12px; resize: none;"></textarea>
            <div class="grid2" style="margin-top:12px">
              <button class="btn btn-primary" id="btn-radar-scan">⚡ Scan</button>
              <button class="btn btn-ghost" id="btn-radar-clear">Clear</button>
            </div>
          </div>
        </div>

        <div class="radar-map-wrap">
          <div id="radar-map"></div>
          <div class="map-legend">
            <div class="legend-item"><span class="leg-dot poly"></span> Polygon</div>
            <div class="legend-item"><span class="leg-dot circle"></span> Circle</div>
          </div>
        </div>
      </div>
    </div>

    <style>
      .fc-notam-radar { height: calc(100vh - var(--topbar-h) - env(safe-area-inset-top, 0px) - var(--tabbar-h)); padding: 10px; overflow: hidden; }
      .radar-layout { display: grid; grid-template-columns: 320px 1fr; gap: 10px; height: 100%; }
      .radar-panel { overflow-y: auto; padding-right: 4px; }
      .radar-map-wrap { position: relative; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border); background: var(--bg-base); }
      #radar-map { width: 100%; height: 100%; z-index: 1; }

      .map-legend {
        position: absolute; top: 12px; right: 12px; z-index: 1000;
        background: rgba(28, 38, 56, 0.85); backdrop-filter: blur(8px);
        padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border);
        font-size: 11px; color: var(--text2); display: flex; flex-direction: column; gap: 6px;
      }
      .legend-item { display: flex; align-items: center; gap: 8px; }
      .leg-dot { width: 10px; height: 10px; border-radius: 50%; }
      .leg-dot.poly { background: var(--blue); border: 1px solid #fff; }
      .leg-dot.circle { background: var(--green); border: 1px solid #fff; }

      @media (max-width: 900px) {
        .fc-notam-radar { height: auto; overflow: visible; padding-bottom: 20px; }
        .radar-layout { grid-template-columns: 1fr; height: auto; }
        .radar-map-wrap { height: 350px; }
      }

      /* Leaflet grayscale map */
      .leaflet-container { background: #f0f0f0; }
      .leaflet-tile-container { filter: grayscale(100%); }
      .leaflet-bar a { background-color: var(--card) !important; color: var(--gold) !important; border-bottom: 1px solid var(--border) !important; }
      .leaflet-control-attribution { background: rgba(0,0,0,0.5) !important; color: var(--text3) !important; }
    </style>
  `;

  document.getElementById('btn-radar-scan').onclick = _scanCoordinates;
  document.getElementById('btn-radar-clear').onclick = _clearMap;
}


function _initMap() {
  const mapEl = document.getElementById('radar-map');
  if (!mapEl || map) return;

  map = L.map('radar-map', {
    center: [23.8, 121.0], // Taiwan center
    zoom: 7,
    zoomControl: true
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CartoDB',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  layerGroup = L.layerGroup().addTo(map);

  // Force size recalculation so tiles load correctly (critical on mobile)
  map.invalidateSize();
  setTimeout(() => map.invalidateSize(), 300);
}

function _clearMap() {
  document.getElementById('radar-input').value = '';
  if (layerGroup) layerGroup.clearLayers();
  map.setView([23.8, 121.0], 7);
}

function _scanCoordinates() {
  const text = document.getElementById('radar-input').value;
  if (!text) return;

  if (layerGroup) layerGroup.clearLayers();
  const points = [];

  // 1. Scan for Q-line center and radius
  // Format: Q) .../3512N13945E005
  const qLineRegex = /Q\).+?\/(\d{4,6})([NS])(\d{5,7})([EW])(\d{3})/g;
  let match;
  while ((match = qLineRegex.exec(text)) !== null) {
    const lat = _parseCoord(match[1], match[2]);
    const lon = _parseCoord(match[3], match[4]);
    const radiusNM = parseInt(match[5]);
    if (lat != null && lon != null) {
      L.circle([lat, lon], {
        radius: radiusNM * 1852,
        color: '#00f5a0',
        fillColor: '#00f5a0',
        fillOpacity: 0.2,
        weight: 2
      }).addTo(layerGroup);
      points.push([lat, lon]);
    }
  }

  // 2. Scan for coordinate pairs — supports:
  //    DDMMSS.ssN DDDMMSS.ssE  (decimal seconds)
  //    DDMMSSNsssEDDDMMSSE     (compact)
  //    DDMMSS.ssN/DDDMMSS.ssE  (slash-separated)
  //    DDMMN DDDMME            (DDMM / DDDMM)
  const coordPairRegex = /(\d{4,9}(?:\.\d+)?)([NS])\s*[\/]?\s*(\d{5,10}(?:\.\d+)?)([EW])/g;
  const polyPoints = [];
  while ((match = coordPairRegex.exec(text)) !== null) {
    const lat = _parseCoord(match[1], match[2]);
    const lon = _parseCoord(match[3], match[4]);
    if (lat != null && lon != null) {
      polyPoints.push([lat, lon]);
      points.push([lat, lon]);
    }
  }

  if (polyPoints.length > 2) {
    L.polygon(polyPoints, {
      color: '#60a5fa',
      fillColor: '#60a5fa',
      fillOpacity: 0.2,
      weight: 2
    }).addTo(layerGroup);
  } else if (polyPoints.length === 2) {
    L.polyline(polyPoints, {
      color: '#60a5fa',
      weight: 3
    }).addTo(layerGroup);
  } else if (polyPoints.length === 1 && points.length === 1) {
    L.marker(polyPoints[0]).addTo(layerGroup);
  }

  if (points.length > 0) {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40] });
  }
}

function _parseCoord(val, dir) {
  // val may contain decimal point, e.g. "250536.10"
  const dotIdx = val.indexOf('.');
  const intPart = dotIdx >= 0 ? val.substring(0, dotIdx) : val;
  const fracStr = dotIdx >= 0 ? val.substring(dotIdx) : '';

  let deg, min, sec;
  const len = intPart.length;

  if (len === 4 || len === 5) {
    // DDMM or DDDMM
    const degLen = len === 4 ? 2 : 3;
    deg = parseInt(intPart.substring(0, degLen));
    min = parseFloat(intPart.substring(degLen) + fracStr);
    sec = 0;
  } else if (len === 6 || len === 7) {
    // DDMMSS or DDDMMSS (decimal may apply to seconds)
    const degLen = len === 6 ? 2 : 3;
    deg = parseInt(intPart.substring(0, degLen));
    min = parseInt(intPart.substring(degLen, degLen + 2));
    sec = parseFloat(intPart.substring(degLen + 2) + fracStr);
  } else {
    return null;
  }

  let res = deg + (min / 60) + (sec / 3600);
  if (dir === 'S' || dir === 'W') res = -res;
  return res;
}
