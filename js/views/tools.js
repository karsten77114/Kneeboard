// Tools tab — FDP, Overtime, Pacific HF, FPL Decoder, Calc tools, External links
import store from '../store.js';

const TOOL_LIST = [
  { id: 'fdp',      label: '⏱ Duty Time',    done: true },
  { id: 'overtime', label: '💰 Overtime',     done: true },
  { id: 'hf',       label: '📻 Pacific HF',  done: true },
  { id: 'fpl',      label: '📡 FPL Decoder', done: true },
  { id: 'calc',     label: '🔢 計算工具',     done: true },
  { id: 'links',    label: '🔗 外部連結',     done: true },
];

let activeTool = 'calc';

export function mount(container) {
  _render(container);
}

export function unmount(container) {}

function _render(container) {
  container.innerHTML = `
    <div class="tools-wrap">
      <nav class="tools-sidebar">
        ${TOOL_LIST.map(t => `
          <button class="tool-nav-btn ${t.id === activeTool ? 'active' : ''}" data-id="${t.id}">${t.label}</button>`).join('')}
      </nav>
      <div id="tool-panel" class="tools-panel"></div>
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
    case 'fdp':      _renderDutyTime(panel); break;
    case 'overtime': _renderOtWip(panel);    break;
    case 'hf':       _renderHF(panel);       break;
    case 'fpl':      _renderFpl(panel);      break;
    case 'calc':     _renderCalc(panel);     break;
    case 'links':    _renderLinks(panel);    break;
  }
}

// ── Duty Time Calculator ──────────────────────────────────────────

function _renderDutyTime(panel) {
  const today = new Date().toISOString().slice(0, 10);
  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">⏱ Duty Time</h3>

    <!-- 機組配置 -->
    <div class="card" style="margin-bottom:10px">
      <div class="card-title">機組配置</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" data-cfg="2P" style="flex:1">Single 2P</button>
        <button class="btn btn-ghost"   data-cfg="3P" style="flex:1">Multiple 3P</button>
        <button class="btn btn-ghost"   data-cfg="4P" style="flex:1">Double 4P</button>
      </div>
    </div>

    <!-- 選項 -->
    <div class="card" style="margin-bottom:10px">
      <div class="card-title">選項</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
          <input type="checkbox" id="dt-bunk" style="width:16px;height:16px;margin-top:2px;flex-shrink:0">
          <span style="font-size:13px;line-height:1.5">Class 1 Bunk PIC Discretion
            <span style="display:block;font-size:11px;color:var(--text3)">3P: Max FT +4h (→16h)　4P: Max FT +6h (→18h)</span>
          </span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
          <input type="checkbox" id="dt-tzadapt" style="width:16px;height:16px;margin-top:2px;flex-shrink:0">
          <span style="font-size:13px;line-height:1.5">Time Diff ≥ 6h & Stay > 48h
            <span style="display:block;font-size:11px;color:var(--text3)">返回基地後 48h 內不得安排飛航任務</span>
          </span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
          <input type="checkbox" id="dt-dhd" style="width:16px;height:16px;margin-top:2px;flex-shrink:0">
          <span style="font-size:13px">DHD after OPS</span>
        </label>
        <div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:8px">
            <input type="checkbox" id="dt-acc" style="width:16px;height:16px;flex-shrink:0">
            <span style="font-size:13px">Rest at Appropriate Accommodation</span>
          </label>
          <div id="dt-acc-dur" style="display:none;align-items:center;gap:8px;padding-left:26px">
            <input class="input" id="dt-acc-hh" type="number" min="0" max="24" placeholder="HH" style="width:64px;height:36px;text-align:center">
            <span style="color:var(--text3)">h</span>
            <input class="input" id="dt-acc-mm" type="number" min="0" max="59" placeholder="MM" style="width:64px;height:36px;text-align:center">
            <span style="color:var(--text3)">m</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 時間 -->
    <div class="card" style="margin-bottom:10px">
      <div class="card-title">時間 (UTC)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label class="form-label">FDP Start — Report Time</label>
          <div style="display:flex;gap:5px">
            <input class="input" id="dt-s-date" type="date" value="${today}" style="flex:1;height:38px;font-size:12px;padding:4px 6px">
            <input class="input" id="dt-s-time" type="time" style="width:88px;height:38px;font-family:monospace;padding:4px 6px">
          </div>
        </div>
        <div>
          <label class="form-label">FDP End — Block In <span style="color:var(--text3);font-weight:400">(選填)</span></label>
          <div style="display:flex;gap:5px">
            <input class="input" id="dt-e-date" type="date" value="${today}" style="flex:1;height:38px;font-size:12px;padding:4px 6px">
            <input class="input" id="dt-e-time" type="time" style="width:88px;height:38px;font-family:monospace;padding:4px 6px">
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label class="form-label">Flight Time Block <span style="color:var(--text3);font-weight:400">(選填)</span></label>
          <input class="input" id="dt-ft" type="time" style="width:100%;height:38px;font-family:monospace;padding:4px 8px">
        </div>
        <div>
          <label class="form-label">時區 Timezone</label>
          <select class="input" id="dt-tz" style="height:38px">
            <option value="480">台北 UTC+8</option>
            <option value="540">東京 UTC+9</option>
            <option value="420">曼谷 UTC+7</option>
            <option value="60">布拉格 UTC+1</option>
            <option value="-480">洛杉磯 UTC−8</option>
            <option value="-420">鳳凰城 UTC−7</option>
          </select>
        </div>
      </div>
      <div>
        <label class="form-label">Next Duty Report (UTC) <span style="color:var(--text3);font-weight:400">(選填)</span></label>
        <div style="display:flex;gap:5px">
          <input class="input" id="dt-n-date" type="date" value="${today}" style="flex:1;height:38px;font-size:12px;padding:4px 6px">
          <input class="input" id="dt-n-time" type="time" style="width:88px;height:38px;font-family:monospace;padding:4px 6px">
        </div>
      </div>
    </div>

    <button class="btn btn-primary" id="btn-dt-calc" style="width:100%;margin-bottom:14px">⚡ Calculate</button>
    <div id="dt-result" style="margin-bottom:14px"></div>

    <!-- CAR 07-02A 規定 -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" id="dt-ref-hdr">
        <div style="font-size:13px;font-weight:700;color:var(--text2)">📋 CAR 07-02A 規定說明</div>
        <span id="dt-ref-arrow" style="color:var(--text3);font-size:12px">▼</span>
      </div>
      <div id="dt-ref-body" style="display:none;margin-top:12px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:8px">REF.: CAR 07-02A ART. 37/37-2/38/38-3/38-4/39/41/42/43/43-1</div>
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:320px">
          <thead><tr>
            <th style="padding:6px 4px;text-align:left;border-bottom:1px solid var(--border);color:var(--text3)"></th>
            <th style="padding:6px 4px;text-align:center;border-bottom:1px solid var(--border);color:var(--blue)">Single<br>2P</th>
            <th style="padding:6px 4px;text-align:center;border-bottom:1px solid var(--border);color:var(--gold)">Multiple<br>3P</th>
            <th style="padding:6px 4px;text-align:center;border-bottom:1px solid var(--border);color:var(--green)">Double<br>4P</th>
          </tr></thead>
          <tbody>
            ${[
              ['Min Rest Before Duty',       '10h','10h','10h'],
              ['Min Rest After (FT≤8h)',      '10h','10h','10h'],
              ['Min Rest After (8h<FT≤10h)', '18h','—',  '—'],
              ['Min Rest After (8h<FT≤12h)', '—',  '18h','—'],
              ['Min Rest After (12h<FT≤16h)','—',  '18h','—'],
              ['Min Rest After (8h<FT≤16h)', '—',  '—',  '18h'],
              ['Min Rest After (16h<FT≤18h)','—',  '—',  '22h'],
              ['Max FDP',                    '14h','18h','24h'],
              ['Max FT (無 Class 1 Bunk)',   '10h','12h','12h'],
              ['Max FT (有 Class 1 Bunk)',   '—',  '16h','18h'],
              ['Min Rest in 7 Days',         '30h','30h','30h'],
              ['Max FT in 7 Days',           '32h','—',  '—'],
            ].map((r,i) => `
            <tr style="${i%2===0?'background:rgba(255,255,255,0.02)':''}">
              <td style="padding:5px 4px;color:var(--text2);font-size:11px">${r[0]}</td>
              <td style="padding:5px 4px;text-align:center;font-weight:700;color:${r[1]==='—'?'var(--text3)':'var(--blue)'}">${r[1]}</td>
              <td style="padding:5px 4px;text-align:center;font-weight:700;color:${r[2]==='—'?'var(--text3)':'var(--gold)'}">${r[2]}</td>
              <td style="padding:5px 4px;text-align:center;font-weight:700;color:${r[3]==='—'?'var(--text3)':'var(--green)'}">${r[3]}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>
        <div style="margin-top:12px;font-size:12px;color:var(--text2);line-height:1.8">
          <div style="font-weight:700;color:var(--yellow);margin-bottom:4px">⚠ WOCL (02:00–05:00 LT)</div>
          <div>· 不得連續超過 3 天指派觸及 WOCL 之任務</div>
          <div>· 連續 2 天 WOCL → 任務後最低 <b>34h</b> 休息</div>
          <div>· 連續 3 天 WOCL → 任務後最低 <b>54h</b> 休息</div>
          <div style="color:var(--text3)">· 例外：每次 WOCL 後皆有 ≥14h 休息，則免除 34/54h 限制</div>
          <div style="font-weight:700;color:var(--text);margin-top:8px;margin-bottom:4px">🏨 Accommodation FDP 延長 (Art. 41)</div>
          <div>· Not Started：Max FDP 不變，實際 FDP = 原始 FDP − 休息時間</div>
          <div>· Started：Max FDP + 休息時間 × 50%（上限 24h）</div>
          <div style="font-weight:700;color:var(--text);margin-top:8px;margin-bottom:4px">🌍 時區適應 (Art. 43)</div>
          <div>· 時差 ≥ 6h & 停留 > 48h：返基地後 48h 內不得安排飛航任務</div>
        </div>
        <div style="margin-top:10px;font-size:10px;color:var(--text3);text-align:center">Non-operational reference only · Refer to company manuals</div>
      </div>
    </div>`;

  // Config button selection
  let selCfg = '2P';
  panel.querySelectorAll('[data-cfg]').forEach(btn => {
    btn.onclick = () => {
      selCfg = btn.dataset.cfg;
      panel.querySelectorAll('[data-cfg]').forEach(b => {
        b.className = `btn ${b.dataset.cfg === selCfg ? 'btn-primary' : 'btn-ghost'}`;
        b.style.flex = '1';
      });
    };
  });

  // Accommodation toggle
  panel.querySelector('#dt-acc').onchange = e => {
    panel.querySelector('#dt-acc-dur').style.display = e.target.checked ? 'flex' : 'none';
  };

  // Reference table toggle
  panel.querySelector('#dt-ref-hdr').onclick = () => {
    const body  = panel.querySelector('#dt-ref-body');
    const arrow = panel.querySelector('#dt-ref-arrow');
    const open  = body.style.display !== 'none';
    body.style.display  = open ? 'none' : 'block';
    arrow.textContent   = open ? '▼' : '▲';
  };

  panel.querySelector('#btn-dt-calc').onclick = () => _calcDutyTime(panel, selCfg);
}

function _calcDutyTime(panel, cfg) {
  const res = panel.querySelector('#dt-result');

  const hasBunk    = panel.querySelector('#dt-bunk')?.checked;
  const hasTzAdapt = panel.querySelector('#dt-tzadapt')?.checked;
  const hasAcc     = panel.querySelector('#dt-acc')?.checked;
  const tzOff      = parseInt(panel.querySelector('#dt-tz')?.value || '480'); // minutes east of UTC

  // Parse date + time → absolute minutes (Unix epoch / 60)
  const parseDT = (dateId, timeId) => {
    const d = panel.querySelector(`#${dateId}`)?.value;
    const t = panel.querySelector(`#${timeId}`)?.value;
    if (!d || !t) return null;
    const ms = new Date(`${d}T${t}:00Z`).getTime();
    return isNaN(ms) ? null : Math.floor(ms / 60000);
  };

  const startMin = parseDT('dt-s-date', 'dt-s-time');
  if (startMin === null) {
    res.innerHTML = '<div style="color:var(--red);font-size:13px;padding:8px 0">請填入 FDP 開始時間</div>';
    return;
  }
  const endMin  = parseDT('dt-e-date', 'dt-e-time');
  const nextMin = parseDT('dt-n-date', 'dt-n-time');

  // Flight time in minutes
  const ftRaw = panel.querySelector('#dt-ft')?.value;
  const ftMin = (() => {
    if (!ftRaw) return null;
    const [h, m] = ftRaw.split(':').map(Number);
    return (!isNaN(h) && !isNaN(m)) ? h * 60 + m : null;
  })();

  // Accommodation rest duration
  let accMin = 0;
  if (hasAcc) {
    const ah = parseInt(panel.querySelector('#dt-acc-hh')?.value || '0') || 0;
    const am = parseInt(panel.querySelector('#dt-acc-mm')?.value || '0') || 0;
    accMin = ah * 60 + am;
  }

  // Max FDP
  const maxFdpBase = cfg === '2P' ? 840 : cfg === '3P' ? 1080 : 1440;
  // Accommodation "Started" mode: extend by 50% of rest, cap at 24h
  const maxFdpEff = hasAcc && accMin > 0
    ? Math.min(maxFdpBase + Math.floor(accMin * 0.5), 1440)
    : maxFdpBase;

  // Max FT
  const maxFtMap = { '2P':{base:600,bunk:600}, '3P':{base:720,bunk:960}, '4P':{base:720,bunk:1080} };
  const maxFt = hasBunk ? maxFtMap[cfg].bunk : maxFtMap[cfg].base;

  // Format helpers
  const fmtUtc = m => {
    const d = new Date(m * 60000);
    return d.toUTCString().slice(17, 22) + 'Z';
  };
  const fmtDate = m => {
    const d = new Date(m * 60000);
    return (d.getUTCMonth()+1) + '/' + String(d.getUTCDate()).padStart(2,'0');
  };
  const fmtDur = m => {
    const abs = Math.abs(m);
    return `${Math.floor(abs/60)}h ${String(abs%60).padStart(2,'0')}m`;
  };

  // WOCL overlap check (02:00–05:00 LT)
  const fdpLen   = endMin !== null ? endMin - startMin : maxFdpEff;
  const fdpEndAbs = startMin + (fdpLen > 0 ? fdpLen : maxFdpEff);
  const _overlapsWocl = (s, e, tz) => {
    const sl = s + tz; const el = e + tz;
    const sd = Math.floor(sl / 1440); const ed = Math.floor(el / 1440);
    for (let d = sd; d <= ed; d++) {
      if (sl < d * 1440 + 300 && el > d * 1440 + 120) return true;
    }
    return false;
  };
  const woclHit = _overlapsWocl(startMin, fdpEndAbs, tzOff);

  // Min rest after duty
  const _minRest = (cfg, ft) => {
    if (ft === null || ft / 60 <= 8) return 600;
    if (cfg === '2P') return 1080;
    if (cfg === '3P') return 1080;
    if (cfg === '4P') return (ft / 60 <= 16) ? 1080 : 1320;
    return 600;
  };
  const minRest = _minRest(cfg, ftMin);

  // Actual FDP
  const fdpMin  = (endMin !== null && endMin > startMin) ? endMin - startMin : null;
  const fdpOk   = fdpMin !== null ? fdpMin <= maxFdpEff : null;
  const ftOk    = ftMin  !== null ? ftMin  <= maxFt     : null;
  const cutoffMin = startMin + maxFdpEff;

  // Build result HTML
  let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">`;

  // Max Duty cutoff
  html += `<div style="background:var(--surface);border-radius:8px;padding:10px 12px">
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">⏱ Max Duty 截止</div>
    <div style="font-size:18px;font-weight:800;color:var(--gold);font-family:monospace">${fmtUtc(cutoffMin)}</div>
    <div style="font-size:11px;color:var(--text3);margin-top:2px">${fmtDate(cutoffMin)} · 上限 ${fmtDur(maxFdpEff)}${hasAcc && accMin > 0 ? ' (+Acc)' : ''}</div>
  </div>`;

  // Max FT
  html += `<div style="background:var(--surface);border-radius:8px;padding:10px 12px">
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">✈ Max Flight Time</div>
    <div style="font-size:18px;font-weight:800;color:var(--blue);font-family:monospace">${fmtDur(maxFt)}</div>
    <div style="font-size:11px;margin-top:2px;${ftMin !== null ? `font-weight:700;color:${ftOk?'var(--green)':'var(--red)'}` : 'color:var(--text3)'}">
      ${ftMin !== null ? `實際 ${fmtDur(ftMin)} ${ftOk ? '✓' : '✗ 超限'}` : `${hasBunk && cfg !== '2P' ? 'With Bunk' : 'Standard'}`}
    </div>
  </div>`;

  html += `</div>`;

  // Actual FDP status
  if (fdpMin !== null) {
    html += `<div style="background:${fdpOk?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)'};border:1px solid ${fdpOk?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)'};border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <span style="font-size:13px;font-weight:700;color:${fdpOk?'var(--green)':'var(--red)'}">
        ${fdpOk ? '✓ FDP 在限制內' : `✗ FDP 超限 ${fmtDur(fdpMin - maxFdpEff)}`}
      </span>
      <span style="font-size:16px;font-weight:800;font-family:monospace;color:${fdpOk?'var(--green)':'var(--red)'}">${fmtDur(fdpMin)}</span>
    </div>`;
  }

  // WOCL warning
  if (woclHit) {
    html += `<div style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:8px;padding:10px 14px;display:flex;gap:10px;align-items:flex-start;margin-bottom:8px">
      <span style="font-size:18px;line-height:1">⚠</span>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--yellow)">觸及 WOCL (02:00–05:00 LT)</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">連續 2 天 → 34h 休息　連續 3 天 → 54h 休息<br>（各有 ≥14h 休息則免除）</div>
      </div>
    </div>`;
  }

  // Min rest after duty
  html += `<div style="background:var(--surface);border-radius:8px;padding:10px 14px;margin-bottom:8px">
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;margin-bottom:6px">任務後最低休息</div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;color:var(--text2)">${cfg}${ftMin !== null ? ` · FT ${fmtDur(ftMin)}` : ' · FT 未輸入 (以≤8h計)'}</span>
      <span style="font-size:17px;font-weight:800;color:var(--text)">${fmtDur(minRest)}</span>
    </div>
    ${endMin !== null ? `<div style="font-size:11px;color:var(--text3);margin-top:5px">最早可報到：<b style="color:var(--text2)">${fmtUtc(endMin + minRest)}</b> (${fmtDate(endMin + minRest)})</div>` : ''}
  </div>`;

  // Next duty rest check
  if (endMin !== null && nextMin !== null) {
    const restActual  = nextMin - endMin;
    const restOk      = restActual >= minRest;
    html += `<div style="background:${restOk?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)'};border:1px solid ${restOk?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)'};border-radius:8px;padding:10px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:13px;font-weight:700;color:${restOk?'var(--green)':'var(--red)'}">${restOk ? '✓ 休息充足' : '✗ 休息不足'}</span>
        <span style="font-size:12px;color:var(--text2)">實際 ${fmtDur(restActual)} / 最低 ${fmtDur(minRest)}</span>
      </div>
      ${!restOk ? `<div style="font-size:11px;color:var(--red);margin-top:4px">不足 ${fmtDur(minRest - restActual)}</div>` : ''}
    </div>`;
  }

  // Time zone adaptation note
  if (hasTzAdapt) {
    html += `<div style="background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.3);border-radius:8px;padding:10px 14px">
      <div style="font-size:13px;font-weight:700;color:var(--blue)">🌍 時區適應規定</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px;line-height:1.6">時差 ≥ 6h & 停留 > 48h：返回基地後 48h 內不得安排飛航任務<br>（DHD 含最低休息則可）</div>
    </div>`;
  }

  res.innerHTML = html;
}

// ── Overtime Calculator ───────────────────────────────────────────

function _renderOtWip(panel) {
  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">💰 Overtime 計算</h3>
    <div class="card">
      <div class="card-title">Block Time 計算</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.6">
        實際 Block-Out + 計畫飛行時間 + 30 分鐘 = 臨界點<br>
        Block-In 晚於臨界點即產生 Overtime
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label class="form-label">計畫 Block-Out (UTC)</label>
          <input class="input" id="ot-sched-out" type="text" placeholder="0530" style="height:40px">
        </div>
        <div>
          <label class="form-label">計畫 Block-In (UTC)</label>
          <input class="input" id="ot-sched-in" type="text" placeholder="1345" style="height:40px">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div>
          <label class="form-label">實際 Block-Out (UTC)</label>
          <input class="input" id="ot-act-out" type="text" placeholder="0545" style="height:40px">
        </div>
        <div>
          <label class="form-label">實際 Block-In (UTC)</label>
          <input class="input" id="ot-act-in" type="text" placeholder="1400" style="height:40px">
        </div>
      </div>
      <button class="btn btn-primary" id="btn-ot-calc" style="width:100%">⚡ 計算</button>
      <div id="ot-result" style="margin-top:12px"></div>
    </div>`;

  panel.querySelector('#btn-ot-calc').onclick = _calcOt;
}

function _calcOt() {
  const toMins = s => {
    const n = String(s).replace(':','').trim();
    if (n.length < 3) return null;
    const h = parseInt(n.slice(0,-2)), m = parseInt(n.slice(-2));
    if (isNaN(h)||isNaN(m)||m>59) return null;
    return h*60 + m;
  };
  const fmt  = m => `${String(Math.floor(((m%1440)+1440)%1440/60)).padStart(2,'0')}${String(((m%1440)+1440)%1440%60).padStart(2,'0')}Z`;
  const fmtD = m => { const a=Math.abs(m); return `${Math.floor(a/60)}h${String(a%60).padStart(2,'0')}m`; };

  const schedOut = toMins(document.getElementById('ot-sched-out').value);
  const schedIn  = toMins(document.getElementById('ot-sched-in').value);
  const actOut   = toMins(document.getElementById('ot-act-out').value);
  const actIn    = toMins(document.getElementById('ot-act-in').value);
  const res      = document.getElementById('ot-result');

  if ([schedOut,schedIn,actOut,actIn].some(v=>v===null)) {
    res.innerHTML = '<div style="color:var(--red);font-size:13px">請填入全部四個時間</div>'; return;
  }

  let schedFt = schedIn - schedOut; if (schedFt<=0) schedFt+=1440;
  let actFt   = actIn  - actOut;   if (actFt<=0)   actFt+=1440;
  const threshold = actOut + schedFt + 30;
  const thresholdStr = fmt(threshold);

  let actualInAdj = actIn; if (actualInAdj < actOut) actualInAdj += 1440;
  const otMins = actualInAdj - threshold;
  const hasOt  = otMins > 0;

  res.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">計畫飛行時間</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${fmtD(schedFt)}</div>
      </div>
      <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">實際飛行時間</div>
        <div style="font-size:18px;font-weight:800;color:var(--text)">${fmtD(actFt)}</div>
      </div>
    </div>
    <div style="background:var(--surface);border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:12px;color:var(--text2)">Overtime 臨界點（晚於此時 Block-In）</span>
      <span style="font-size:16px;font-weight:800;color:var(--gold)">${thresholdStr}</span>
    </div>
    <div style="background:${hasOt?'rgba(239,68,68,.1)':'rgba(34,197,94,.1)'};border:1px solid ${hasOt?'rgba(239,68,68,.3)':'rgba(34,197,94,.3)'};border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:13px;font-weight:700;color:${hasOt?'var(--red)':'var(--green)'}">${hasOt?`✗ 超時 ${fmtD(otMins)}`:'✓ 無 Overtime'}</span>
      <span style="font-size:11px;color:var(--text3)">實際 Block-In ${fmt(actIn)}</span>
    </div>`;
}

// ── Pacific HF ────────────────────────────────────────────────────

function _renderHF(panel) {
  // Source: radio.arinc.net/pacific/ — updated May 2026
  const HF_GROUPS = [
    {
      title: '🇺🇸 Mainland Departures (CONUS)',
      rows: [
        { route: 'California / Pacific NW → Hawaii', pri: '5574', sec: '8843' },
        { route: 'North America → South Pacific',    pri: '5574', sec: '8843' },
        { route: 'North America → Asia',             pri: '5574', sec: '8843' },
        { route: 'All SWA / General Aviation CONUS', pri: '5574', sec: '8843' },
      ]
    },
    {
      title: '🌺 Hawaii Departures',
      rows: [
        { route: 'Hawaii → California / Pacific NW / Alaska', pri: '5574',  sec: '8843'  },
        { route: 'Hawaii → Southbound',                       pri: '5643',  sec: '8867'  },
        { route: 'Hawaii → Westbound',                        pri: '8870',  sec: '11384' },
      ]
    },
    {
      title: '🌏 Other Pacific Regions',
      rows: [
        { route: 'Guam Area',                             pri: '11384', sec: '8870'  },
        { route: 'Alaska / North Pacific (West of 150°W)', pri: '6673',  sec: '5667'  },
        { route: 'Polar Route',                           pri: '11342', sec: '8933',  ter: '6640' },
        { route: 'Mazatlan Airspace',                     pri: '5574',  sec: '8843',  ter: '6640' },
      ]
    },
  ];

  const freqBadge = (f, color = 'var(--blue)') =>
    `<span style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;font-weight:700;color:${color};white-space:nowrap">${f} kHz</span>`;

  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:4px">📻 Pacific HF Frequencies</h3>
    <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Source: radio.arinc.net/pacific · Valid May 2026</div>

    ${HF_GROUPS.map(g => `
      <div class="card" style="margin-bottom:10px">
        <div class="card-title">${g.title}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="color:var(--text3);font-size:10px;text-transform:uppercase">
            <th style="text-align:left;padding:4px 0;border-bottom:1px solid var(--border)">Route</th>
            <th style="text-align:center;padding:4px 6px;border-bottom:1px solid var(--border)">Primary</th>
            <th style="text-align:center;padding:4px 6px;border-bottom:1px solid var(--border)">Secondary</th>
            <th style="text-align:center;padding:4px 6px;border-bottom:1px solid var(--border)">Tertiary</th>
          </tr></thead>
          <tbody>
            ${g.rows.map(r => `<tr>
              <td style="padding:7px 0;color:var(--text2);font-size:12px;line-height:1.4">${r.route}</td>
              <td style="padding:7px 6px;text-align:center">${freqBadge(r.pri, 'var(--gold)')}</td>
              <td style="padding:7px 6px;text-align:center">${freqBadge(r.sec)}</td>
              <td style="padding:7px 6px;text-align:center">${r.ter ? freqBadge(r.ter, 'var(--text2)') : '<span style="color:var(--text3)">—</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('')}

    <div style="font-size:11px;color:var(--text3);margin-top:4px;line-height:1.6">
      SELCAL 頻率請參閱 OFP 或公司 SOP。<br>
      以上頻率適用於 ARINC/SITA 太平洋地區空地通訊，非 ACARS 使用。
    </div>`;
}

// ── Calc Tools ────────────────────────────────────────────────────

function _renderCalc(panel) {
  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">🔢 計算工具</h3>

    <!-- Fuel Converter -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">燃油換算 Fuel Conversion</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div>
            <label class="form-label">數值</label>
            <input class="input" id="fuel-val" type="number" placeholder="例：10000" style="width:100%;height:40px">
          </div>
          <div>
            <label class="form-label">單位</label>
            <select class="input" id="fuel-unit" style="width:100%;height:40px">
              <option value="kg">kg</option>
              <option value="lbs">lbs</option>
              <option value="L">Liters (A321)</option>
            </select>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-fuel-conv" style="width:100%">換算</button>
        <div id="fuel-result"></div>
      </div>
    </div>

    <!-- Unit Converter -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">單位換算 Unit Conversion</div>
      <div style="display:flex;flex-direction:column;gap:14px">
        ${_unitRow('壓力 Pressure', 'press', 'hPa', 'inHg', 1013.25, 29.92)}
        ${_unitRow('溫度 Temperature', 'temp', '°C', '°F', 15, 59)}
      </div>
    </div>

    <!-- Crosswind -->
    <div class="card">
      <div class="card-title">橫風分量 Crosswind Component</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <label class="form-label">Wind Dir</label>
          <input class="input" id="xw-dir" type="number" placeholder="270" style="width:100%;height:40px">
        </div>
        <div>
          <label class="form-label">Wind Spd (kt)</label>
          <input class="input" id="xw-spd" type="number" placeholder="15" style="width:100%;height:40px">
        </div>
        <div>
          <label class="form-label">RWY Hdg</label>
          <input class="input" id="xw-rwy" type="number" placeholder="05" style="width:100%;height:40px">
        </div>
      </div>
      <button class="btn btn-primary" id="btn-xw" style="width:100%">計算</button>
      <div id="xw-result" style="margin-top:10px"></div>
    </div>`;

  _bindCalc(panel);
}

function _unitRow(title, prefix, unitA, unitB, defA, defB) {
  return `<div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:8px;font-weight:600">${title}</div>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center">
      <div style="display:flex;align-items:center;gap:6px">
        <input class="input" id="${prefix}-a" type="number" value="${defA}" style="flex:1;height:40px;min-width:0">
        <span style="color:var(--text3);font-size:12px;white-space:nowrap">${unitA}</span>
      </div>
      <span style="color:var(--text3);font-size:16px;padding:0 4px">↔</span>
      <div style="display:flex;align-items:center;gap:6px">
        <input class="input" id="${prefix}-b" type="number" value="${defB}" style="flex:1;height:40px;min-width:0">
        <span style="color:var(--text3);font-size:12px;white-space:nowrap">${unitB}</span>
      </div>
    </div>
  </div>`;
}

function _bindCalc(panel) {
  panel.querySelector('#btn-fuel-conv').onclick = () => {
    const val  = parseFloat(panel.querySelector('#fuel-val').value);
    const unit = panel.querySelector('#fuel-unit').value;
    const res  = panel.querySelector('#fuel-result');
    if (!val) { res.innerHTML = ''; return; }
    let rows = [];
    if (unit === 'kg')  rows = [`${(val*2.20462).toFixed(0)} lbs`, `${(val/0.8).toFixed(0)} L (A321, density 0.800)`];
    if (unit === 'lbs') rows = [`${(val/2.20462).toFixed(0)} kg`,  `${(val/2.20462/0.8).toFixed(0)} L`];
    if (unit === 'L')   rows = [`${(val*0.8).toFixed(0)} kg`,      `${(val*0.8*2.20462).toFixed(0)} lbs`];
    res.innerHTML = rows.map(r => `<div style="font-size:15px;font-weight:700;color:var(--accent)">${r}</div>`).join('');
  };

  ['press-a','press-b'].forEach(id => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => {
      const v = parseFloat(panel.querySelector(`#${id}`).value);
      if (!v) return;
      if (id === 'press-a') panel.querySelector('#press-b').value = (v/33.8639).toFixed(2);
      else                  panel.querySelector('#press-a').value = (v*33.8639).toFixed(1);
    });
  });

  ['temp-a','temp-b'].forEach(id => {
    panel.querySelector(`#${id}`)?.addEventListener('input', () => {
      const v = parseFloat(panel.querySelector(`#${id}`).value);
      if (isNaN(v)) return;
      if (id === 'temp-a') panel.querySelector('#temp-b').value = (v*9/5+32).toFixed(1);
      else                 panel.querySelector('#temp-a').value = ((v-32)*5/9).toFixed(1);
    });
  });

  panel.querySelector('#btn-xw').onclick = () => {
    const dir = parseFloat(panel.querySelector('#xw-dir').value);
    const spd = parseFloat(panel.querySelector('#xw-spd').value);
    const rwyHdg = parseFloat(panel.querySelector('#xw-rwy').value) * 10;
    const res = panel.querySelector('#xw-result');
    if (isNaN(dir) || isNaN(spd) || isNaN(rwyHdg)) { res.innerHTML = ''; return; }
    const angle = Math.abs(dir - rwyHdg) % 360;
    const eff   = angle > 180 ? 360 - angle : angle;
    const xw    = Math.abs(Math.sin(eff * Math.PI/180) * spd).toFixed(1);
    const hw    = (Math.cos(eff * Math.PI/180) * spd).toFixed(1);
    res.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
        <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:4px">橫風 Crosswind</div>
          <div style="font-size:22px;font-weight:800;color:var(--accent)">${xw} kt</div>
        </div>
        <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
          <div style="font-size:11px;color:var(--text3);margin-bottom:4px">順/逆風 Head/Tail</div>
          <div style="font-size:22px;font-weight:800;color:${Number(hw)>=0?'var(--green)':'var(--red)'}">${hw} kt</div>
        </div>
      </div>`;
  };
}

// ── FPL Decoder ───────────────────────────────────────────────────

const _NAV_CODES = {
  S:'Standard (VHF RTF / VOR / ILS)', N:'No COM/NAV equipment',
  G:'GNSS (GPS/GLONASS)', H:'HF RTF', I:'INS / IRS',
  J:'Data Link (see Item 18 DAT/)', L:'ILS', O:'VOR',
  R:'PBN Approved (see Item 18 PBN/)', U:'UHF RTF', V:'VHF RTF',
  W:'RVSM Approved', X:'MNPS Approved',
  Y:'VHF 8.33 kHz channel spacing', Z:'Other (see Item 18 COM/ NAV/)',
  F:'ADF', B:'LF/MF ADF', C:'VHF AM RTF', D:'UHF RTF',
  E:'VHF FM RTF', M:'Omega', T:'TACAN', K:'MLS', A:'LORAN',
};
const _SSR_CODES = {
  N:'No transponder', A:'Mode A (4096 codes)', C:'Mode A + Mode C',
  E:'Mode S — elementary surveillance',
  H:'Mode S — enhanced surveillance',
  I:'Mode S — aircraft ident (no pressure alt)',
  L:'Mode S — ADS-B 1090MHz out + in',
  P:'Mode S — pressure alt (no ident)',
  S:'Mode S — ident + pressure alt',
  X:'Mode S — no ident, no pressure alt',
  B1:'ADS-B out · 1090MHz ES', B2:'ADS-B out+in · 1090MHz ES',
  U1:'ADS-C · ATN', U2:'ADS-C · non-ATN',
  V1:'ADS-C · FANS 1/A', D1:'ADS-C · FANS 1/A + HF data link',
};
const _PBN_CODES = {
  A1:'RNAV 10 (RNP 10)',
  B1:'RNAV 5 — all sensors', B2:'RNAV 5 — GNSS', B3:'RNAV 5 — DME/DME',
  B4:'RNAV 5 — VOR/DME',    B5:'RNAV 5 — INS/IRS',
  C1:'RNAV 2 — all sensors', C2:'RNAV 2 — GNSS', C3:'RNAV 2 — DME/DME', C4:'RNAV 2 — DME/DME/IRU',
  D1:'RNAV 1 — all sensors', D2:'RNAV 1 — GNSS', D3:'RNAV 1 — DME/DME', D4:'RNAV 1 — DME/DME/IRU',
  L1:'RNP 4',
  O1:'Basic RNP 1 — all sensors', O2:'Basic RNP 1 — GNSS',
  O3:'Basic RNP 1 — DME/DME',    O4:'Basic RNP 1 — DME/DME/IRU',
  S1:'RNP APCH', S2:'RNP APCH + BARO-VNAV',
  T1:'RNP AR APCH with RF (Special Auth)', T2:'RNP AR APCH without RF (Special Auth)',
};
const _RULES = { I:'IFR', V:'VFR', Y:'IFR/VFR', Z:'VFR/IFR' };
const _FTYPE = { S:'Scheduled', N:'Non-scheduled', G:'General Aviation', M:'Military', X:'Other' };
const _WAKE  = { J:'Super (A380+)', H:'Heavy (≥136t)', M:'Medium', L:'Light' };

function _parseFpl(raw) {
  const text = raw.replace(/^\s*\(FPL\s*/i,'').replace(/\)\s*$/,'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
  const p    = text.split('-').map(s => s.trim()).filter(Boolean);

  const r = { raw };
  r.callsign = p[0] || '';

  const i8 = (p[1] || '').split('/');
  r.rules = i8[0]; r.flightType = i8[1];

  const i9m = (p[2] || '').match(/^(\d+)?([A-Z][A-Z0-9]+)\/([JLMH])/);
  if (i9m) { r.acCount = i9m[1]||'1'; r.acType = i9m[2]; r.wake = i9m[3]; }
  else { r.acType = p[2] || ''; }

  const i10 = p[3] || ''; const sl = i10.indexOf('/');
  r.equipment    = sl >= 0 ? i10.slice(0, sl) : i10;
  r.surveillance = sl >= 0 ? i10.slice(sl+1)  : '';

  const i13m = (p[4] || '').match(/([A-Z]{4})(\d{4})/);
  if (i13m) { r.dep = i13m[1]; r.depTime = i13m[2]; }

  const i15m = (p[5] || '').match(/^([NKMT])(\d{3,4})(F|A|S|M)(\d{3,5})\s*(.*)/);
  if (i15m) { r.speedUnit=i15m[1]; r.speed=i15m[2]; r.levelUnit=i15m[3]; r.level=i15m[4]; r.route=i15m[5].trim(); }
  else { r.route = p[5] || ''; }

  const i16m = (p[6] || '').match(/([A-Z]{4})(\d{4})\s*(.*)/);
  if (i16m) { r.dest = i16m[1]; r.eet = i16m[2]; r.altns = i16m[3].trim(); }

  r.item18Raw = p[7] || '';
  r.item18 = {};
  const re18 = /([A-Z]{2,5})\/(.*?)(?=\s+[A-Z]{2,5}\/|$)/g;
  let m;
  while ((m = re18.exec(r.item18Raw)) !== null) r.item18[m[1]] = m[2].trim();

  return r;
}

function _fplHtml(r) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const tag = (t, color='var(--blue)') =>
    `<span style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:2px 7px;font-size:12px;font-weight:700;color:${color};font-family:monospace;white-space:nowrap">${esc(t)}</span>`;
  const row = (label, val) =>
    `<div style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid var(--border-dim);align-items:baseline;flex-wrap:wrap">
       <span style="font-size:11px;color:var(--text3);min-width:110px;flex-shrink:0">${label}</span>
       <span style="font-size:13px;color:var(--text)">${val}</span>
     </div>`;

  // Parse equipment codes
  const navCodes = (r.equipment || '').split('').filter(c => /[A-Z]/.test(c));
  // Parse SSR: handle multi-char codes (B1, B2, U1, U2, V1, D1)
  const ssrRaw   = r.surveillance || '';
  const ssrCodes = [];
  for (let i = 0; i < ssrRaw.length; ) {
    const two = ssrRaw.slice(i, i+2);
    if (_SSR_CODES[two]) { ssrCodes.push(two); i += 2; }
    else                  { ssrCodes.push(ssrRaw[i]); i++; }
  }

  // PBN codes
  const pbnRaw = r.item18?.PBN || '';
  const pbnCodes = pbnRaw.match(/[A-Z]\d/g) || [];

  // Speed label
  const speedLabel = r.speed ? `${r.speedUnit === 'N' ? 'N' : r.speedUnit === 'K' ? 'K' : 'M'}${r.speed} ${r.speedUnit === 'N' ? 'kt' : r.speedUnit === 'K' ? 'km/h' : 'Mach'}` : '';
  const levelLabel = r.level ? `${r.levelUnit === 'F' ? 'FL' : r.levelUnit === 'A' ? 'ALT' : 'STD'}${r.level}` : '';

  let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
    <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
      <div style="font-size:10px;color:var(--text3);margin-bottom:4px">CALLSIGN / ACFT</div>
      <div style="font-size:20px;font-weight:800;color:var(--gold);font-family:monospace">${esc(r.callsign)}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:2px">${esc(r.acType)} · ${_WAKE[r.wake]||r.wake||'—'}</div>
    </div>
    <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
      <div style="font-size:10px;color:var(--text3);margin-bottom:4px">ROUTE</div>
      <div style="font-size:18px;font-weight:800;color:var(--blue);font-family:monospace">${esc(r.dep||'????')} → ${esc(r.dest||'????')}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:2px">DEP ${r.depTime||'—'}Z · EET ${r.eet||'—'} · ALTN ${esc(r.altns)||'—'}</div>
    </div>
  </div>`;

  html += `<div class="card" style="margin-bottom:10px">
    <div class="card-title">基本資訊 General</div>`;
  html += row('Flight Rules', `${tag(r.rules)} ${_RULES[r.rules]||''}`);
  html += row('Flight Type',  `${tag(r.flightType||'—')} ${_FTYPE[r.flightType]||''}`);
  if (speedLabel) html += row('CRZ Speed', `${tag(speedLabel)} (Item 15)`);
  if (levelLabel) html += row('CRZ Level', `${tag(levelLabel)} (Item 15)`);
  const regVal  = r.item18?.REG  || '—';
  const selVal  = r.item18?.SEL  || '—';
  const codeVal = r.item18?.CODE || '—';
  html += row('Registration', tag(regVal, 'var(--text)'));
  html += row('SELCAL',       tag(selVal, 'var(--green)'));
  if (codeVal !== '—') html += row('Mode S Code', tag(codeVal, 'var(--text2)'));
  html += `</div>`;

  // NAV/COM equipment
  html += `<div class="card" style="margin-bottom:10px">
    <div class="card-title">Item 10a — COM/NAV Equipment</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
      ${navCodes.map(c => tag(c, _NAV_CODES[c] ? 'var(--blue)' : 'var(--text3)')).join('')}
    </div>
    <div style="font-size:12px;color:var(--text2);line-height:2">
      ${navCodes.filter(c => _NAV_CODES[c]).map(c => `<b style="color:var(--text);font-family:monospace">${c}</b> — ${_NAV_CODES[c]}`).join('<br>')}
    </div>
  </div>`;

  // Surveillance
  html += `<div class="card" style="margin-bottom:10px">
    <div class="card-title">Item 10b — Surveillance (SSR/ADS)</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
      ${ssrCodes.map(c => tag(c, _SSR_CODES[c] ? 'var(--gold)' : 'var(--text3)')).join('')}
    </div>
    <div style="font-size:12px;color:var(--text2);line-height:2">
      ${ssrCodes.filter(c => _SSR_CODES[c]).map(c => `<b style="color:var(--text);font-family:monospace">${c}</b> — ${_SSR_CODES[c]}`).join('<br>')}
    </div>
  </div>`;

  // PBN
  if (pbnCodes.length) {
    html += `<div class="card" style="margin-bottom:10px">
      <div class="card-title">Item 18 PBN/ — Performance Based Navigation</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        ${pbnCodes.map(c => tag(c, _PBN_CODES[c] ? 'var(--green)' : 'var(--text3)')).join('')}
      </div>
      <div style="font-size:12px;color:var(--text2);line-height:2">
        ${pbnCodes.filter(c => _PBN_CODES[c]).map(c => `<b style="color:var(--text);font-family:monospace">${c}</b> — ${_PBN_CODES[c]}`).join('<br>')}
      </div>
    </div>`;
  }

  // Other Item 18 fields
  const skip18 = new Set(['PBN','REG','SEL','CODE']);
  const other18 = Object.entries(r.item18||{}).filter(([k]) => !skip18.has(k));
  if (other18.length) {
    html += `<div class="card" style="margin-bottom:10px">
      <div class="card-title">Item 18 — Other Information</div>
      ${other18.map(([k,v]) => row(k + '/', `<span style="font-family:monospace;color:var(--text2)">${esc(v)}</span>`)).join('')}
    </div>`;
  }

  // Route
  if (r.route) {
    html += `<div class="card">
      <div class="card-title">Item 15 — Route</div>
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:var(--text2);line-height:1.8;word-break:break-all">${esc(r.route)}</div>
    </div>`;
  }

  return html;
}

function _renderFpl(panel) {
  const autoFpl = store.briefing?.icaoFpl || '';
  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">📡 ICAO FPL Decoder</h3>
    <div class="card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="card-title" style="margin:0">飛行計畫輸入</div>
        ${autoFpl ? `<span style="font-size:11px;color:var(--green);font-weight:600">✓ 已從 LIDO 帶入</span>` : ''}
      </div>
      <textarea id="fpl-input" class="input mono" rows="5"
        placeholder="(FPL-JX726-IS&#10;-A321/M&#10;-SDE3FGHIJ4J5M1RWXYZ/LB1V1&#10;-WMKK0920&#10;-N0450F370 DCT ... &#10;-RCTP0255 RCSS&#10;-PBN/A1B1...)"
        style="width:100%;font-size:12px;resize:vertical;min-height:100px">${autoFpl}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="btn-fpl-decode" style="flex:1">⚡ 解析 Decode</button>
        <button class="btn btn-ghost"   id="btn-fpl-reset"  style="flex:0 0 auto">重置</button>
      </div>
    </div>
    <div id="fpl-result"></div>`;

  panel.querySelector('#btn-fpl-decode').onclick = () => {
    const raw = panel.querySelector('#fpl-input').value.trim();
    const res = panel.querySelector('#fpl-result');
    if (!raw) { res.innerHTML = '<div style="color:var(--text3);font-size:13px">請貼入 FPL 內容</div>'; return; }
    try {
      const parsed = _parseFpl(raw);
      if (!parsed.callsign) throw new Error('無法辨識格式');
      res.innerHTML = _fplHtml(parsed);
    } catch(e) {
      res.innerHTML = `<div style="color:var(--red);font-size:13px">解析失敗：${e.message}</div>`;
    }
  };

  panel.querySelector('#btn-fpl-reset').onclick = () => {
    panel.querySelector('#fpl-input').value = '';
    panel.querySelector('#fpl-result').innerHTML = '';
  };

  // Auto-decode if LIDO FPL is present
  if (autoFpl) panel.querySelector('#btn-fpl-decode').click();
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
  const existing = document.getElementById('tools-style');
  if (existing) existing.remove();
  const s = document.createElement('style');
  s.id = 'tools-style';
  s.textContent = `
    /* Desktop: side-by-side */
    .tools-wrap {
      display: flex; height: 100%;
    }
    .tools-sidebar {
      width: 150px; flex-shrink: 0;
      border-right: 1px solid var(--border);
      padding: 10px 6px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 2px;
    }
    .tools-panel {
      flex: 1; overflow-y: auto; padding: 16px; min-width: 0;
    }
    .tool-nav-btn {
      display: block; width: 100%;
      padding: 9px 10px; margin: 0;
      border: none; background: transparent;
      color: var(--text2); font-size: 12px; font-weight: 600;
      text-align: left; border-radius: 8px; cursor: pointer;
      transition: all 0.15s; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis;
    }
    .tool-nav-btn.active { background: var(--card); color: var(--accent); }

    /* Mobile: horizontal tab strip on top */
    @media (max-width: 640px) {
      .tools-wrap   { flex-direction: column; }
      .tools-sidebar {
        width: 100%; flex-direction: row; gap: 0;
        border-right: none; border-bottom: 1px solid var(--border);
        padding: 0; overflow-x: auto; overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
      }
      .tools-sidebar::-webkit-scrollbar { display: none; }
      .tools-panel  { padding: 12px; }
      .tool-nav-btn {
        flex-shrink: 0; width: auto; border-radius: 0;
        padding: 10px 12px; font-size: 12px;
        border-bottom: 2px solid transparent;
        text-align: center;
      }
      .tool-nav-btn.active {
        background: transparent; color: var(--accent);
        border-bottom-color: var(--accent);
      }
    }
  `;
  document.head.appendChild(s);
}
