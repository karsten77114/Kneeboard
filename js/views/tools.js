// Tools tab — FDP, Overtime, Pacific HF, Calc tools, External links

const TOOL_LIST = [
  { id: 'fdp',      label: '⏱ Duty Time',           done: true  },
  { id: 'overtime', label: '💰 Overtime 計算',      done: true  },
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
    case 'fdp':      _renderDutyTime(panel); break;
    case 'overtime': _renderOtWip(panel);    break;
    case 'hf':       _renderHF(panel);        break;
    case 'calc':     _renderCalc(panel);      break;
    case 'links':    _renderLinks(panel);     break;
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
  const HF = [
    { region: 'NAT (North Atlantic)', freqs: ['2899','5616','8864','11279','13306'] },
    { region: 'PACOT (North Pacific)', freqs: ['2932','5628','8951','11384','13276','17904'] },
    { region: 'CENPAC (Central Pacific)', freqs: ['3016','5583','8843','11387','13330','17904'] },
    { region: 'NOPAC (North Pacific MNPS)', freqs: ['2932','5628','8951','11384','13276'] },
    { region: 'SEA (Southeast Asia)', freqs: ['3458','5655','8942','11396','13309','17907'] },
    { region: 'MID (Middle East)', freqs: ['2992','5544','8942','10018','11387','13272'] },
  ];

  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">📻 太平洋 HF 頻率 Pacific HF</h3>
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
        <div><div style="color:var(--text2);font-size:12px">橫風 Crosswind</div><div style="font-size:20px;font-weight:800;color:var(--accent)">${xw} kt</div></div>
        <div><div style="color:var(--text2);font-size:12px">逆風 Headwind</div><div style="font-size:20px;font-weight:800;color:${Number(hw)>=0?'var(--green)':'var(--red)'}">${hw} kt</div></div>
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
