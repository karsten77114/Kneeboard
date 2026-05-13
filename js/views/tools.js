// Tools tab — FDP, Overtime, Pacific HF, Calc tools, External links

const TOOL_LIST = [
  { id: 'fdp',      label: '⏱ FDP 工時計算',       done: false },
  { id: 'overtime', label: '💰 加班費 Overtime',    done: false },
  { id: 'hf',       label: '📻 Pacific HF',         done: true  },
  { id: 'calc',     label: '🔢 計算工具',            done: true  },
  { id: 'links',    label: '🔗 外部連結',            done: true  },
];

let activeTool = 'calc';

export function mount(container) {
  _render(container);
}

export function unmount(container) {}

function _render(container) {
  container.innerHTML = `
    <div style="display:flex;height:100%">
      <div style="width:160px;flex-shrink:0;border-right:1px solid var(--border);padding:12px 8px;overflow-y:auto">
        ${TOOL_LIST.map(t => `
          <button class="tool-nav-btn ${t.id === activeTool ? 'active' : ''}" data-id="${t.id}">
            ${t.label}
            ${!t.done ? '<span style="display:block;font-size:10px;color:var(--text3);font-weight:400">建置中</span>' : ''}
          </button>`).join('')}
      </div>
      <div id="tool-panel" style="flex:1;overflow-y:auto;padding:16px"></div>
    </div>`;

  _applyStyles();

  container.querySelectorAll('.tool-nav-btn').forEach(btn => {
    btn.onclick = () => {
      activeTool = btn.dataset.id;
      container.querySelectorAll('.tool-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.id === activeTool));
      _renderTool(container.querySelector('#tool-panel'));
    };
  });

  _renderTool(container.querySelector('#tool-panel'));
}

function _renderTool(panel) {
  switch (activeTool) {
    case 'fdp':      _renderFdpWip(panel);    break;
    case 'overtime': _renderOtWip(panel);     break;
    case 'hf':       _renderHF(panel);        break;
    case 'calc':     _renderCalc(panel);      break;
    case 'links':    _renderLinks(panel);     break;
  }
}

// ── FDP (WIP) ─────────────────────────────────────────────────────

function _renderFdpWip(panel) {
  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">⏱ FDP / Rest Calculation</h3>
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">CAR 07-02A 上限速查</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="color:var(--text3)">
          <th style="padding:6px;text-align:left;border-bottom:1px solid var(--border)">配置</th>
          <th style="padding:6px;text-align:center;border-bottom:1px solid var(--border)">Max FDP</th>
          <th style="padding:6px;text-align:center;border-bottom:1px solid var(--border)">Max FT</th>
        </tr></thead>
        <tbody>
          ${[['2P（單組）','14h','10h'],['3P（加強）','18h','12h'],['4P（雙組）','24h','12h']].map(r => `
          <tr>
            <td style="padding:8px 6px;color:var(--text)">${r[0]}</td>
            <td style="padding:8px 6px;text-align:center;font-weight:700;color:var(--accent)">${r[1]}</td>
            <td style="padding:8px 6px;text-align:center;font-weight:700;color:var(--blue)">${r[2]}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);color:var(--text3);font-size:12px">
        7天最低休息：30h｜連續 WOCL 2天→34h，3天→54h
      </div>
    </div>
    <div style="padding:14px;background:var(--surface);border-radius:10px;border:1px solid var(--border);color:var(--text3);font-size:13px">
      🚧 完整 FDP 計算器（WOCL 時間線、機艙組員分段休息）建置中。
    </div>`;
}

// ── Overtime (WIP) ────────────────────────────────────────────────

function _renderOtWip(panel) {
  panel.innerHTML = `
    <div class="state-screen">
      <div class="state-icon">💰</div>
      <div class="state-title">加班費計算</div>
      <div class="state-sub">加班費計算器建置中，列入待辦清單。</div>
    </div>`;
}

// ── Pacific HF ────────────────────────────────────────────────────

function _renderHF(panel) {
  const HF = [
    { region: 'NAT (North Atlantic)', freqs: ['2899','5616','8864','11279','13306'] },
    { region: 'PACOT (North Pacific)', freqs: ['2932','5628','8951','11384','13276','17904'] },
    { region: 'CENPAC (Central Pacific)', freqs: ['3016','5583','8843','11387','13330','17904'] },
    { region: 'NOPAC (North Pacific MNPS)', freqs: ['2932','5628','8951','11384','13276'] },
    { region: 'SEA (Southeast Asia)', freqs: ['3458','5655','8942','11396','13309','17907'] },
    { region: 'MID (Middle East)', freqs: ['2992','5544','8942','10018','11387','13272'] },
  ];

  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">📻 Pacific HF Frequencies</h3>
    ${HF.map(r => `
      <div class="card" style="margin-bottom:10px">
        <div class="card-title">${r.region}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${r.freqs.map(f => `
            <span style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:5px 10px;font-family:'SF Mono',monospace;font-size:13px;font-weight:700;color:var(--blue)">${f} kHz</span>
          `).join('')}
        </div>
      </div>`).join('')}
    <div style="color:var(--text3);font-size:12px;margin-top:8px">SELCAL 頻率請參閱 OFP 或公司 SOP。</div>`;
}

// ── Calc Tools ────────────────────────────────────────────────────

function _renderCalc(panel) {
  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">🔢 計算工具</h3>

    <!-- Fuel Converter -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">燃油換算 Fuel Conversion</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <label class="form-label">數值</label>
          <input class="input" id="fuel-val" type="number" placeholder="例：10000" style="width:120px">
        </div>
        <div>
          <label class="form-label">單位</label>
          <select class="input" id="fuel-unit" style="width:100px">
            <option value="kg">kg</option>
            <option value="lbs">lbs</option>
            <option value="L">Liters (A321)</option>
          </select>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-fuel-conv">換算</button>
      </div>
      <div id="fuel-result" style="margin-top:10px"></div>
    </div>

    <!-- Unit Converter -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">單位換算 Unit Conversion</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${_unitRow('壓力 Pressure', 'press', 'hPa', 'inHg', 1013.25, 29.92, v => (v/33.8639).toFixed(2), v => (v*33.8639).toFixed(1))}
        ${_unitRow('溫度 Temperature', 'temp', '°C', '°F', 15, 59, v => (v*9/5+32).toFixed(1), v => ((v-32)*5/9).toFixed(1))}
      </div>
    </div>

    <!-- Curfew -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">Curfew 倒數</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <label class="form-label">機場</label>
          <select class="input" id="curfew-apt" style="width:110px">
            <option value="23:00">OKA 23:00L</option>
            <option value="23:00">CTS 23:00L</option>
            <option value="00:00">NGO 00:00L</option>
          </select>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-curfew">計算</button>
      </div>
      <div id="curfew-result" style="margin-top:10px"></div>
    </div>

    <!-- Crosswind -->
    <div class="card">
      <div class="card-title">橫風分量 Crosswind Component</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div>
          <label class="form-label">風向 Wind Dir</label>
          <input class="input" id="xw-dir" type="number" placeholder="270" style="width:80px">
        </div>
        <div>
          <label class="form-label">風速 Wind Spd (kt)</label>
          <input class="input" id="xw-spd" type="number" placeholder="15" style="width:90px">
        </div>
        <div>
          <label class="form-label">跑道 RWY</label>
          <input class="input" id="xw-rwy" type="number" placeholder="05" style="width:70px">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-xw">計算</button>
      </div>
      <div id="xw-result" style="margin-top:10px"></div>
    </div>`;

  _bindCalc(panel);
}

function _unitRow(title, prefix, unitA, unitB, defA, defB, aToB, bToA) {
  return `<div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:6px">${title}</div>
    <div style="display:flex;gap:6px;align-items:center">
      <input class="input" id="${prefix}-a" type="number" value="${defA}" style="width:80px">
      <span style="color:var(--text3);font-size:12px">${unitA}</span>
      <span style="color:var(--text3)">↔</span>
      <input class="input" id="${prefix}-b" type="number" value="${defB}" style="width:80px">
      <span style="color:var(--text3);font-size:12px">${unitB}</span>
    </div>
  </div>`;
}

function _bindCalc(panel) {
  // Fuel converter
  panel.querySelector('#btn-fuel-conv').onclick = () => {
    const val  = parseFloat(panel.querySelector('#fuel-val').value);
    const unit = panel.querySelector('#fuel-unit').value;
    const res  = panel.querySelector('#fuel-result');
    if (!val) { res.innerHTML = ''; return; }
    let rows = [];
    if (unit === 'kg')  rows = [`${(val*2.20462).toFixed(0)} lbs`, `${(val/0.8).toFixed(0)} L (A321, density 0.800)`];
    if (unit === 'lbs') rows = [`${(val/2.20462).toFixed(0)} kg`, `${(val/2.20462/0.8).toFixed(0)} L`];
    if (unit === 'L')   rows = [`${(val*0.8).toFixed(0)} kg`, `${(val*0.8*2.20462).toFixed(0)} lbs`];
    res.innerHTML = rows.map(r => `<div style="font-size:14px;font-weight:700;color:var(--accent)">${r}</div>`).join('');
  };

  // Pressure
  ['press-a','press-b'].forEach(id => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => {
      const v = parseFloat(panel.querySelector(`#${id}`).value);
      if (!v) return;
      if (id === 'press-a') panel.querySelector('#press-b').value = (v/33.8639).toFixed(2);
      else                  panel.querySelector('#press-a').value = (v*33.8639).toFixed(1);
    });
  });

  // Temperature
  ['temp-a','temp-b'].forEach(id => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => {
      const v = parseFloat(panel.querySelector(`#${id}`).value);
      if (isNaN(v)) return;
      if (id === 'temp-a') panel.querySelector('#temp-b').value = (v*9/5+32).toFixed(1);
      else                 panel.querySelector('#temp-a').value = ((v-32)*5/9).toFixed(1);
    });
  });

  // Curfew
  panel.querySelector('#btn-curfew').onclick = () => {
    const curfew = panel.querySelector('#curfew-apt').value;
    const now    = new Date();
    const [ch, cm] = curfew.split(':').map(Number);
    let diff = ch*60+cm - (now.getHours()*60+now.getMinutes());
    if (diff < 0) diff += 1440;
    const h = Math.floor(diff/60), m = diff%60;
    panel.querySelector('#curfew-result').innerHTML =
      `<div style="font-size:18px;font-weight:800;color:${diff < 60 ? 'var(--red)' : diff < 180 ? 'var(--yellow)' : 'var(--green)'}">${h}h ${m}m 後宵禁</div>`;
  };

  // Crosswind
  panel.querySelector('#btn-xw').onclick = () => {
    const dir = parseFloat(panel.querySelector('#xw-dir').value);
    const spd = parseFloat(panel.querySelector('#xw-spd').value);
    const rwy = parseFloat(panel.querySelector('#xw-rwy').value) * 10;
    const res = panel.querySelector('#xw-result');
    if (!dir || !spd || !rwy) { res.innerHTML = ''; return; }
    const angle = Math.abs(dir - rwy) % 360;
    const eff   = angle > 180 ? 360 - angle : angle;
    const xw    = Math.abs(Math.sin(eff * Math.PI/180) * spd).toFixed(1);
    const hw    = (Math.cos(eff * Math.PI/180) * spd).toFixed(1);
    res.innerHTML = `
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:4px">
        <div><div style="color:var(--text2);font-size:12px">Crosswind</div><div style="font-size:20px;font-weight:800;color:var(--accent)">${xw} kt</div></div>
        <div><div style="color:var(--text2);font-size:12px">Headwind</div><div style="font-size:20px;font-weight:800;color:${Number(hw)>=0?'var(--green)':'var(--red)'}">${hw} kt</div></div>
      </div>`;
  };
}

// ── External Links ────────────────────────────────────────────────

function _renderLinks(panel) {
  const LINKS = [
    { group: '公司系統', items: [
      { label: 'SJX Pilot Space',        url: 'https://pilot.starlux-airlines.com' },
      { label: 'LIDO Flight',            url: 'https://sjx.lido.aero' },
      { label: 'SJX ELB Fleet',          url: 'https://sjx.elb.aero' },
      { label: 'WNI Flight Plan Editor', url: 'https://fpleditor.wni.com' },
    ]},
    { group: '天氣', items: [
      { label: 'Tono2 日本航空天氣',    url: 'https://tono2.com' },
      { label: 'Windy',                  url: 'https://www.windy.com' },
      { label: 'Turbli 亂流查詢',        url: 'https://turbli.com' },
      { label: '中央氣象署颱風',         url: 'https://www.cwa.gov.tw' },
    ]},
    { group: 'NOTAM & Routing', items: [
      { label: 'Skyinfo NOTAM 地圖',     url: 'https://www.skyinfo.jp/notam/' },
      { label: 'GPS 干擾查詢',           url: 'https://pilotweb.nas.faa.gov/PilotWeb/notamRetrievalByICAOAction.do?method=displayByICAO' },
    ]},
    { group: '即時航班', items: [
      { label: 'FlightRadar24',          url: 'https://www.flightradar24.com' },
      { label: '桃機航班查詢',           url: 'https://www.taoyuan-airport.com' },
    ]},
    { group: '行政', items: [
      { label: '換班單',                  url: 'https://pilot.starlux-airlines.com' },
    ]},
  ];

  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">🔗 外部連結入口</h3>
    ${LINKS.map(g => `
      <div class="section-title">${g.group}</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
        ${g.items.map(item => `
          <a href="${item.url}" target="_blank" rel="noopener"
            style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text);text-decoration:none;font-size:14px;font-weight:600">
            ${item.label}
            <span style="color:var(--text3);font-size:12px">↗</span>
          </a>`).join('')}
      </div>`).join('')}`;
}

// ── Styles ────────────────────────────────────────────────────────

function _applyStyles() {
  if (document.getElementById('tools-style')) return;
  const s = document.createElement('style');
  s.id = 'tools-style';
  s.textContent = `
    .tool-nav-btn {
      display: block; width: 100%;
      padding: 9px 10px; margin-bottom: 4px;
      border: none; background: transparent;
      color: var(--text2); font-size: 12px; font-weight: 600;
      text-align: left; border-radius: 8px; cursor: pointer;
      transition: all 0.15s;
    }
    .tool-nav-btn.active { background: var(--card); color: var(--accent); }
  `;
  document.head.appendChild(s);
}
