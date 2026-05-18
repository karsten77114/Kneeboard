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
  panel.innerHTML = '<div style="max-width:640px;margin:0 auto"></div>';
  const inner = panel.firstElementChild;
  switch (activeTool) {
    case 'fdp':      _renderDutyTime(inner); break;
    case 'overtime': _renderOtWip(inner);    break;
    case 'hf':       _renderHF(inner);       break;
    case 'fpl':      _renderFpl(inner);      break;
    case 'calc':     _renderCalc(inner);     break;
    case 'links':    _renderLinks(inner);    break;
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
        <div>
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:8px">
            <input type="checkbox" id="dt-dhd" style="width:16px;height:16px;margin-top:2px;flex-shrink:0">
            <span style="font-size:13px">DHD after OPS
              <span style="display:block;font-size:11px;color:var(--text3)">DHD 時間計入 Duty Period，影響休息起算點</span>
            </span>
          </label>
          <div id="dt-dhd-dur" style="display:none;padding-left:26px;margin-bottom:4px">
            <label class="form-label" style="margin-bottom:4px">DHD End Time <span style="font-weight:400;color:var(--text3)">(Rest Start)</span></label>
            <div style="display:flex;gap:8px;align-items:center">
              <input class="input" id="dt-dhd-date" type="date" value="${today}"
                style="width:160px;height:44px;font-size:13px;padding:6px 8px">
              <input class="input" id="dt-dhd-time" type="text" placeholder="HHMM" maxlength="4" inputmode="numeric"
                style="width:90px;height:44px;text-align:center;font-size:20px;font-family:'JetBrains Mono','SF Mono',monospace;font-weight:700;letter-spacing:2px;padding:0">
            </div>
          </div>
        </div>
        <label id="dt-pic-disc-label" style="display:none;flex-direction:row;align-items:flex-start;gap:10px;cursor:pointer">
          <input type="checkbox" id="dt-pic-disc" style="width:16px;height:16px;margin-top:2px;flex-shrink:0">
          <span style="font-size:13px">PIC Discretion (+2h FDP)
            <span style="display:block;font-size:11px;color:var(--text3)">不可抗力/天災，機長裁量 3P FDP +2h → 最大 20h（Max FT 不變）</span>
          </span>
        </label>
        <div>
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;margin-bottom:8px">
            <input type="checkbox" id="dt-acc" style="width:16px;height:16px;flex-shrink:0">
            <span style="font-size:13px">Rest at Appropriate Accommodation (&gt;3h)</span>
          </label>
          <div id="dt-acc-dur" style="display:none;flex-direction:column;gap:8px;padding-left:26px">
            <div style="display:flex;align-items:center;gap:8px">
              <input class="input" id="dt-acc-hh" type="number" min="0" max="24" placeholder="HH" style="width:64px;height:36px;text-align:center">
              <span style="color:var(--text3)">h</span>
              <input class="input" id="dt-acc-mm" type="number" min="0" max="59" placeholder="MM" style="width:64px;height:36px;text-align:center">
              <span style="color:var(--text3)">m</span>
            </div>
            <div style="display:flex;gap:6px">
              <button type="button" id="dt-acc-before" style="flex:1;padding:5px 8px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;background:rgba(96,165,250,.2);color:var(--blue)">✓ 首段前 Not Started</button>
              <button type="button" id="dt-acc-after"  style="flex:1;padding:5px 8px;border-radius:6px;border:none;font-size:11px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.06);color:var(--text3)">首段後 Started</button>
            </div>
            <div style="font-size:10px;color:var(--text3);line-height:1.5">首段前：FDP 上限不變，休息時間加在截止時間後不計入 FDP<br>首段後：FDP 上限延長 休息×50%，上限 24h</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 時間 -->
    <div class="card" style="margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="card-title" id="dt-time-card-title" style="margin:0">時間 (UTC)</div>
        <div style="display:flex;gap:6px">
          <button id="dt-mode-utc"   class="btn btn-primary" style="font-size:11px;font-weight:800;padding:5px 14px;height:30px">UTC</button>
          <button id="dt-mode-local" class="btn btn-ghost"   style="font-size:11px;font-weight:800;padding:5px 14px;height:30px">Local</button>
        </div>
      </div>

      <!-- 時區 -->
      <div style="margin-bottom:14px">
        <label class="form-label" id="dt-tz-label">時區 — WOCL 計算</label>
        <select class="input" id="dt-tz" style="height:42px;width:160px">
          ${[[-720,'UTC−12'],[-660,'UTC−11'],[-600,'UTC−10'],[-570,'UTC−9:30'],[-540,'UTC−9'],[-480,'UTC−8'],[-420,'UTC−7'],[-360,'UTC−6'],[-300,'UTC−5'],[-240,'UTC−4'],[-210,'UTC−3:30'],[-180,'UTC−3'],[-120,'UTC−2'],[-60,'UTC−1'],[0,'UTC±0'],[60,'UTC+1'],[120,'UTC+2'],[180,'UTC+3'],[210,'UTC+3:30'],[240,'UTC+4'],[270,'UTC+4:30'],[300,'UTC+5'],[330,'UTC+5:30'],[345,'UTC+5:45'],[360,'UTC+6'],[390,'UTC+6:30'],[420,'UTC+7'],[480,'UTC+8'],[525,'UTC+8:45'],[540,'UTC+9'],[570,'UTC+9:30'],[600,'UTC+10'],[630,'UTC+10:30'],[660,'UTC+11'],[720,'UTC+12'],[765,'UTC+12:45'],[780,'UTC+13'],[840,'UTC+14']].map(([v,l])=>`<option value="${v}"${v===480?' selected':''}>${l}</option>`).join('')}
        </select>
      </div>

      <!-- FDP Start -->
      <div style="margin-bottom:12px">
        <label class="form-label" id="dt-s-label">FDP Start — Report Time</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="input" id="dt-s-date" type="date" value="${today}"
            style="width:160px;height:44px;font-size:13px;padding:6px 8px">
          <input class="input" id="dt-s-time" type="text" placeholder="HHMM" maxlength="4" inputmode="numeric"
            style="width:90px;height:44px;text-align:center;font-size:20px;font-family:'JetBrains Mono','SF Mono',monospace;font-weight:700;letter-spacing:2px;padding:0">
        </div>
      </div>

      <!-- FDP End -->
      <div style="margin-bottom:12px">
        <label class="form-label" id="dt-e-label">FDP End — Block In <span style="font-weight:400;color:var(--text3)">(選填)</span></label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="input" id="dt-e-date" type="date" value="${today}"
            style="width:160px;height:44px;font-size:13px;padding:6px 8px">
          <input class="input" id="dt-e-time" type="text" placeholder="HHMM" maxlength="4" inputmode="numeric"
            style="width:90px;height:44px;text-align:center;font-size:20px;font-family:'JetBrains Mono','SF Mono',monospace;font-weight:700;letter-spacing:2px;padding:0">
        </div>
      </div>

      <!-- Flight Time + Next Duty on same row -->
      <div style="display:flex;gap:32px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <label class="form-label">Flight Time Block <span style="font-weight:400;color:var(--text3)">(選填)</span></label>
          <input class="input" id="dt-ft" type="text" placeholder="HHMM" maxlength="4" inputmode="numeric"
            style="width:90px;height:44px;text-align:center;font-size:20px;font-family:'JetBrains Mono','SF Mono',monospace;font-weight:700;letter-spacing:2px;padding:0">
        </div>
      </div>

      <!-- Next Duty Report -->
      <div>
        <label class="form-label" id="dt-n-label">Next Duty Report <span style="font-weight:400;color:var(--text3)">(選填)</span></label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="input" id="dt-n-date" type="date" value="${today}"
            style="width:160px;height:44px;font-size:13px;padding:6px 8px">
          <input class="input" id="dt-n-time" type="text" placeholder="HHMM" maxlength="4" inputmode="numeric"
            style="width:90px;height:44px;text-align:center;font-size:20px;font-family:'JetBrains Mono','SF Mono',monospace;font-weight:700;letter-spacing:2px;padding:0">
        </div>
      </div>
    </div>

    <div id="dt-result" style="margin-bottom:14px"></div>

    <!-- CAR 07-02A 規定 -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" id="dt-ref-hdr">
        <div style="font-size:13px;font-weight:700;color:var(--text2)">📋 CAR 07-02A 規定說明</div>
        <span id="dt-ref-arrow" style="color:var(--text3);font-size:12px">▼</span>
      </div>
      <div id="dt-ref-body" style="display:none;margin-top:12px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:8px">REF.: CAR 07-02A ART. 37/37-2/38/38-3/38-4/39/41/42/43/43-1</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px;line-height:1.9">
          Flight time of any pilot shall not exceed <b>120h / 30 days</b>, <b>300h / 90 days</b>, <b>1000h / 12 months</b>.
        </div>
        <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:340px">
          <thead><tr>
            <th style="padding:7px 6px;text-align:left;border-bottom:2px solid var(--border);color:var(--text3);font-size:11px"></th>
            <th style="padding:7px 6px;text-align:center;border-bottom:2px solid var(--border);color:var(--blue);white-space:nowrap">Single<br><span style="font-size:14px;font-weight:900">2P</span></th>
            <th style="padding:7px 6px;text-align:center;border-bottom:2px solid var(--border);color:var(--gold);white-space:nowrap">Multiple<br><span style="font-size:14px;font-weight:900">3P</span></th>
            <th style="padding:7px 6px;text-align:center;border-bottom:2px solid var(--border);color:var(--green);white-space:nowrap">Double<br><span style="font-size:14px;font-weight:900">4P</span></th>
          </tr></thead>
          <tbody>
            <tr style="background:rgba(255,255,255,0.02)">
              <td style="padding:7px 6px;color:var(--text2);font-size:11px;border-bottom:1px solid var(--border)">Min Rest Before Duty</td>
              <td style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--blue);border-bottom:1px solid var(--border)">10h</td>
              <td style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--gold);border-bottom:1px solid var(--border)">10h</td>
              <td style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--green);border-bottom:1px solid var(--border)">10h</td>
            </tr>
            <tr>
              <td style="padding:7px 6px;color:var(--text2);font-size:11px;border-bottom:1px solid var(--border);vertical-align:top">Min Rest After Duty ①</td>
              <td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;line-height:1.9">
                <div style="color:var(--text3)">FT≤8h</div><div style="font-size:14px;font-weight:900;color:var(--blue)">10h</div>
                <div style="color:var(--text3);margin-top:4px">8h&lt;FT≤10h</div><div style="font-size:14px;font-weight:900;color:var(--blue)">18h</div>
              </td>
              <td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;line-height:1.9">
                <div style="color:var(--text3)">FT≤8h</div><div style="font-size:14px;font-weight:900;color:var(--gold)">10h</div>
                <div style="color:var(--text3);margin-top:4px">8h&lt;FT≤12h</div><div style="font-size:14px;font-weight:900;color:var(--gold)">18h</div>
                <div style="color:var(--text3);margin-top:4px">12h&lt;FT≤16h</div><div style="font-size:14px;font-weight:900;color:var(--gold)">24h</div>
              </td>
              <td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;line-height:1.9">
                <div style="color:var(--text3)">FT≤8h</div><div style="font-size:14px;font-weight:900;color:var(--green)">10h</div>
                <div style="color:var(--text3);margin-top:4px">8h&lt;FT≤16h</div><div style="font-size:14px;font-weight:900;color:var(--green)">18h</div>
                <div style="color:var(--text3);margin-top:4px">16h&lt;FT≤18h</div><div style="font-size:14px;font-weight:900;color:var(--green)">22h</div>
              </td>
            </tr>
            <tr style="background:rgba(255,255,255,0.02)">
              <td style="padding:7px 6px;color:var(--text2);font-size:11px;border-bottom:1px solid var(--border)">Max FDP</td>
              <td style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--blue);border-bottom:1px solid var(--border)">14h</td>
              <td style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--gold);border-bottom:1px solid var(--border)">18h<span style="font-size:10px;font-weight:400;color:var(--text3)"> ★</span></td>
              <td style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--green);border-bottom:1px solid var(--border)">24h</td>
            </tr>
            <tr>
              <td style="padding:7px 6px;color:var(--text2);font-size:11px;border-bottom:1px solid var(--border);vertical-align:top">Max FT in 24h</td>
              <td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;line-height:1.9">
                <div style="font-size:14px;font-weight:900;color:var(--blue)">10h</div>
              </td>
              <td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;line-height:1.9">
                <div style="color:var(--text3)">No C1</div><div style="font-size:14px;font-weight:900;color:var(--gold)">12h</div>
                <div style="color:var(--text3);margin-top:4px">With C1</div><div style="font-size:14px;font-weight:900;color:var(--gold)">16h</div>
              </td>
              <td style="padding:7px 6px;text-align:center;border-bottom:1px solid var(--border);font-size:11px;line-height:1.9">
                <div style="color:var(--text3)">No C1</div><div style="font-size:14px;font-weight:900;color:var(--green)">12h</div>
                <div style="color:var(--text3);margin-top:4px">With C1</div><div style="font-size:14px;font-weight:900;color:var(--green)">18h</div>
              </td>
            </tr>
            <tr style="background:rgba(255,255,255,0.02)">
              <td style="padding:7px 6px;color:var(--text2);font-size:11px;border-bottom:1px solid var(--border)">Min Rest in 7 Days ⑥</td>
              <td colspan="3" style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--text);border-bottom:1px solid var(--border)">30h</td>
            </tr>
            <tr>
              <td style="padding:7px 6px;color:var(--text2);font-size:11px;border-bottom:1px solid var(--border)">Max FT in 7 Days</td>
              <td style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--blue);border-bottom:1px solid var(--border)">32h</td>
              <td style="padding:7px 6px;text-align:center;font-weight:700;color:var(--text3);border-bottom:1px solid var(--border)">N/A</td>
              <td style="padding:7px 6px;text-align:center;font-weight:700;color:var(--text3);border-bottom:1px solid var(--border)">N/A</td>
            </tr>
            <tr style="background:rgba(255,255,255,0.02)">
              <td style="padding:7px 6px;color:var(--text2);font-size:11px">Max DP in 30 Days ②</td>
              <td colspan="3" style="padding:7px 6px;text-align:center;font-size:15px;font-weight:900;color:var(--text)">230h</td>
            </tr>
          </tbody>
        </table>
        </div>
        <div style="margin-top:12px;font-size:12px;color:var(--text2);line-height:1.9">
          <div>① Flight time within 24 hours.</div>
          <div>② Duty period may be extended to 260h; standby &amp; deadhead up to 30h may be counted.</div>
          <div>③ Before standby duty, pilot shall have 10 consecutive hours rest.</div>
          <div>④ Domestic: FT ≤ 8h/24h, FDP ≤ 12h.</div>
          <div style="color:var(--gold);font-weight:700">★ PIC Discretion: +2h to Max FDP (3P only).</div>
          <div>⑤ Min rest before duty: at least 10 consecutive hours before any flight duty or standby.</div>
          <div>⑥ 7-day rest: at least 30 consecutive hours within any 7 consecutive days.</div>
          <div>⑦ Sector limits: max 4 sectors per FDP; up to 6 sectors in case of force majeure diversion.</div>
          <div>⑧ Time zone adaptation: if stay &gt; 48h and time diff ≥ 6h, no flight duty within 48h after returning to base (DHD with min rest requirement permitted).</div>
          <div style="margin-top:4px">⑨ WOCL (Window of Circadian Low, local 02:00–05:00):</div>
          <div style="padding-left:12px">· No more than 3 consecutive days of WOCL-infringing duty.</div>
          <div style="padding-left:12px">· 2 consecutive WOCL days → min <b>34h</b> rest after duty.</div>
          <div style="padding-left:12px">· 3 consecutive WOCL days → min <b>54h</b> rest after duty.</div>
          <div style="padding-left:12px;color:var(--text3)">· Exception: if ≥ 14h rest given after each WOCL duty, the 34/54h requirement is waived.</div>
          <div style="margin-top:4px">⑩ Accommodation (Not Start): Actual FDP deducted by rest duration (no upper limit on extension).</div>
          <div>⑪ Accommodation (Started): Max FDP increased by 50% of rest duration (capped at 24h).</div>
        </div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);font-size:12px;color:var(--text2);line-height:1.9">
          <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">中文說明</div>
          <div>① 飛行時間以任意 24 小時內計算。</div>
          <div>② 值勤時段上限可延長至 260h；備勤及 Deadhead 時間合計最多 30h 可計入。</div>
          <div>③ 備勤前，飛行員須有連續 10 小時之休息。</div>
          <div>④ 國內線：飛行時間 ≤ 8h／24h，FDP ≤ 12h。</div>
          <div style="color:var(--gold);font-weight:700">★ 機長酌情：僅限 3P，Max FDP 可延長 +2h。</div>
          <div>⑤ 值勤前最低休息：任何飛行值勤或備勤前，須有至少連續 10 小時之休息。</div>
          <div>⑥ 7 日休息：任意連續 7 日內，須有至少連續 30 小時之休息。</div>
          <div>⑦ 航段限制：每次 FDP 最多 4 個航段；不可抗力備降情況下最多 6 個航段。</div>
          <div>⑧ 時區適應：外站停留 &gt; 48h 且時差 ≥ 6h，返回基地後 48h 內不得執行飛行任務（符合最低休息規定之 DHD 任務除外）。</div>
          <div style="margin-top:4px">⑨ WOCL（生理低潮期，本地時間 02:00–05:00）：</div>
          <div style="padding-left:12px">· 連續觸及 WOCL 之值勤不得超過 3 天。</div>
          <div style="padding-left:12px">· 連續 2 天 WOCL → 任務後最低休息 <b>34h</b>。</div>
          <div style="padding-left:12px">· 連續 3 天 WOCL → 任務後最低休息 <b>54h</b>。</div>
          <div style="padding-left:12px;color:var(--text3)">· 例外：若每次 WOCL 值勤後均給予 ≥ 14h 休息，則免除 34/54h 規定。</div>
          <div style="margin-top:4px">⑩ 過夜（尚未執行）：實際 FDP 扣除休息時間（延長無上限）。</div>
          <div>⑪ 過夜（已開始執行）：Max FDP 增加休息時間之 50%（上限至 24h）。</div>
        </div>
        <div style="margin-top:10px;font-size:10px;color:var(--text3);text-align:center">Non-operational reference only · Refer to company manuals</div>
      </div>
    </div>`;

  // Config button selection
  let selCfg = '2P';
  const _updateCfgUI = () => {
    panel.querySelectorAll('[data-cfg]').forEach(b => {
      b.className = `btn ${b.dataset.cfg === selCfg ? 'btn-primary' : 'btn-ghost'}`;
      b.style.flex = '1';
    });
    const picLabel = panel.querySelector('#dt-pic-disc-label');
    if (picLabel) {
      picLabel.style.display = selCfg === '3P' ? 'flex' : 'none';
      if (selCfg !== '3P') {
        const picCb = panel.querySelector('#dt-pic-disc');
        if (picCb) picCb.checked = false;
      }
    }
  };
  panel.querySelectorAll('[data-cfg]').forEach(btn => {
    btn.onclick = () => { selCfg = btn.dataset.cfg; _updateCfgUI(); };
  });

  // DHD toggle
  panel.querySelector('#dt-dhd').onchange = e => {
    panel.querySelector('#dt-dhd-dur').style.display = e.target.checked ? 'flex' : 'none';
  };

  // Accommodation toggle
  let accMode = 'before'; // 'before' | 'after'
  panel.querySelector('#dt-acc').onchange = e => {
    panel.querySelector('#dt-acc-dur').style.display = e.target.checked ? 'flex' : 'none';
  };
  const _setAccMode = mode => {
    accMode = mode;
    const bBefore = panel.querySelector('#dt-acc-before');
    const bAfter  = panel.querySelector('#dt-acc-after');
    if (!bBefore || !bAfter) return;
    bBefore.style.background = mode === 'before' ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.06)';
    bBefore.style.color      = mode === 'before' ? 'var(--blue)' : 'var(--text3)';
    bBefore.textContent      = (mode === 'before' ? '✓ ' : '') + '首段前 Not Started';
    bAfter.style.background  = mode === 'after'  ? 'rgba(96,165,250,.2)' : 'rgba(255,255,255,.06)';
    bAfter.style.color       = mode === 'after'  ? 'var(--blue)' : 'var(--text3)';
    bAfter.textContent       = (mode === 'after'  ? '✓ ' : '') + '首段後 Started';
  };
  panel.querySelector('#dt-acc-before')?.addEventListener('click', () => _setAccMode('before'));
  panel.querySelector('#dt-acc-after')?.addEventListener('click',  () => _setAccMode('after'));

  // Time mode toggle (UTC / Local)
  let timeMode = 'utc';
  const _setTimeMode = mode => {
    timeMode = mode;
    const bUtc   = panel.querySelector('#dt-mode-utc');
    const bLocal = panel.querySelector('#dt-mode-local');
    if (!bUtc || !bLocal) return;
    bUtc.className   = `btn ${mode === 'utc'   ? 'btn-primary' : 'btn-ghost'}`;
    bLocal.className = `btn ${mode === 'local' ? 'btn-primary' : 'btn-ghost'}`;
    bUtc.style.cssText   = 'font-size:11px;font-weight:800;padding:5px 14px;height:30px';
    bLocal.style.cssText = 'font-size:11px;font-weight:800;padding:5px 14px;height:30px';
    const tzLabel    = panel.querySelector('#dt-tz-label');
    const cardTitle  = panel.querySelector('#dt-time-card-title');
    const sLabel     = panel.querySelector('#dt-s-label');
    const eLabel     = panel.querySelector('#dt-e-label');
    const nLabel     = panel.querySelector('#dt-n-label');
    const tzVal      = panel.querySelector('#dt-tz')?.selectedOptions[0]?.text || '';
    if (mode === 'local') {
      if (tzLabel)   tzLabel.textContent   = '時區 — Local Time 換算 + WOCL';
      if (cardTitle) cardTitle.textContent = `時間 (Local — ${tzVal || 'UTC+?'})`;
      if (sLabel)    sLabel.firstChild.textContent = 'FDP Start — Report Time (Local)';
      if (eLabel)    eLabel.firstChild.textContent = 'FDP End — Block In (Local)';
      if (nLabel)    nLabel.firstChild.textContent = 'Next Duty Report (Local)';
    } else {
      if (tzLabel)   tzLabel.textContent   = '時區 — WOCL 計算';
      if (cardTitle) cardTitle.textContent = '時間 (UTC)';
      if (sLabel)    sLabel.firstChild.textContent = 'FDP Start — Report Time';
      if (eLabel)    eLabel.firstChild.textContent = 'FDP End — Block In';
      if (nLabel)    nLabel.firstChild.textContent = 'Next Duty Report';
    }
  };
  panel.querySelector('#dt-mode-utc')?.addEventListener('click',   () => _setTimeMode('utc'));
  panel.querySelector('#dt-mode-local')?.addEventListener('click', () => _setTimeMode('local'));
  // Re-run label update when timezone changes (for Local mode title)
  panel.querySelector('#dt-tz')?.addEventListener('change', () => { if (timeMode === 'local') _setTimeMode('local'); });

  // Reference table toggle
  panel.querySelector('#dt-ref-hdr').onclick = () => {
    const body  = panel.querySelector('#dt-ref-body');
    const arrow = panel.querySelector('#dt-ref-arrow');
    const open  = body.style.display !== 'none';
    body.style.display  = open ? 'none' : 'block';
    arrow.textContent   = open ? '▼' : '▲';
  };

  // Auto-calculate on any input change
  let _calcTimer = null;
  const _autoCalc = () => {
    clearTimeout(_calcTimer);
    _calcTimer = setTimeout(() => _calcDutyTime(panel, selCfg, accMode, timeMode), 300);
  };

  // Text/number inputs — debounced
  ['dt-s-date','dt-s-time','dt-e-date','dt-e-time','dt-n-date','dt-n-time',
   'dt-ft','dt-dhd-date','dt-dhd-time','dt-acc-hh','dt-acc-mm']
    .forEach(id => panel.querySelector(`#${id}`)?.addEventListener('input', _autoCalc));

  // Select + checkboxes — immediate
  ['dt-tz','dt-bunk','dt-tzadapt','dt-dhd','dt-acc','dt-pic-disc']
    .forEach(id => panel.querySelector(`#${id}`)?.addEventListener('change', _autoCalc));

  // Cfg / mode / acc-mode buttons — trigger after their own handler runs
  panel.querySelectorAll('[data-cfg]').forEach(btn => {
    const orig = btn.onclick;
    btn.onclick = e => { orig?.call(btn, e); _autoCalc(); };
  });
  ['dt-acc-before','dt-acc-after','dt-mode-utc','dt-mode-local']
    .forEach(id => panel.querySelector(`#${id}`)?.addEventListener('click', _autoCalc));
}

function _buildTimeline({ startMin, endMin, cutoffMin, restStartMin, earliestReportMin, nextMin, dhdMin, fdpOk, restOk, maxFdpEff, fdpMin, minRest, woclHit, tzOff }) {
  const rangeEnd = nextMin
    ? Math.max(nextMin, earliestReportMin || cutoffMin) + 60
    : (earliestReportMin ? earliestReportMin + 90 : cutoffMin + 90);
  const span = rangeEnd - startMin;

  const pct  = m => Math.max(0, Math.min(100, (m - startMin) / span * 100)).toFixed(2);
  const wid  = (a, b) => Math.max(0, Math.min(100 - +pct(a), (b - a) / span * 100)).toFixed(2);
  const fmt  = m => { const d = new Date(m * 60000); return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}z`; };
  const fmtd = m => { const d = new Date(m * 60000); return `${d.getUTCMonth()+1}/${d.getUTCDate()}`; };
  const dur  = m => { const h = Math.floor(m/60), mn = m%60; return mn ? `${h}h ${String(mn).padStart(2,'0')}m` : `${h}h`; };

  const fdpColor = fdpOk === false ? 'rgba(239,68,68,0.75)' : 'rgba(34,197,94,0.75)';
  const rstColor = restOk === false ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)';

  // WOCL bands: 02:00–05:00 local → UTC positions across the timeline
  const woclBands = [];
  if (tzOff != null) {
    const d0 = Math.floor((startMin + tzOff) / 1440) - 1;
    const d1 = Math.ceil((rangeEnd  + tzOff) / 1440) + 1;
    for (let d = d0; d <= d1; d++) {
      const ws = d * 1440 + 120 - tzOff;
      const we = d * 1440 + 300 - tzOff;
      const s  = Math.max(ws, startMin);
      const e  = Math.min(we, rangeEnd);
      if (e > s) woclBands.push({ s, e });
    }
  }

  // Label helper — tick connects label to adjacent bar
  // pin='above': label text on top, tick at bottom pointing down into bar below
  // pin='below': tick at top pointing up into bar above, label text below
  const lbl = (rawPos, top, bot, col, pin = 'above', dim = false) => {
    const pos   = +rawPos;
    const c     = dim ? 'var(--text4,rgba(255,255,255,0.25))' : col;
    const align = pos < 5 ? 'left' : pos > 88 ? 'right' : 'center';
    const tx    = align === 'left' ? '0' : align === 'right' ? '-100%' : '-50%';
    const tick  = `<div style="width:1px;height:5px;background:${c};margin:0 auto"></div>`;
    const text  = `<div style="font-size:9px;font-weight:800;color:${c};white-space:nowrap;text-align:${align}">${top}</div>
      <div style="font-size:9px;color:${dim?c:'var(--text3)'};white-space:nowrap;line-height:1.2;text-align:${align}">${bot}</div>`;
    const inner = pin === 'above' ? text + tick : tick + text;
    return `<div style="position:absolute;left:${pos}%;transform:translateX(${tx});${pin==='above'?'bottom:0':'top:0'}">${inner}</div>`;
  };

  // FDP labels — always show RPT / END / MAX; DHD END when active
  const endPos = endMin ? +pct(endMin) : null;
  const dhdEndPos = (dhdMin > 0 && endMin) ? +pct(endMin + dhdMin) : null;
  const fdpLbls = [
    lbl(0,               'RPT',     fmt(startMin),            'var(--text2)', 'above'),
    endPos != null
      ? lbl(endPos,      'END',     fmt(endMin),              'var(--text2)', 'above')
      : lbl(+pct(cutoffMin) * 0.6, 'END', '—',               'var(--text2)', 'above', true),
    dhdEndPos != null
      ? lbl(dhdEndPos,   'DHD END', fmt(endMin + dhdMin),     'rgba(251,191,36,0.9)', 'above')
      : '',
    lbl(+pct(cutoffMin), 'MAX',     fmt(cutoffMin),           'var(--accent)', 'above'),
  ].join('');

  // Rest labels — always show START / EARLIEST; NEXT when provided
  const startPos     = restStartMin ? +pct(restStartMin) : null;
  const earliestPos  = earliestReportMin ? +pct(earliestReportMin) : null;
  const restLbls = [
    startPos != null
      ? lbl(startPos,    'START',   fmt(restStartMin),        'var(--text3)', 'below')
      : lbl(endPos != null ? endPos : 70, 'START', '—',       'var(--text3)', 'below', true),
    earliestPos != null
      ? lbl(earliestPos, 'EARLIEST',`${fmt(earliestReportMin)} ${fmtd(earliestReportMin)}`, 'var(--green)', 'below')
      : lbl(Math.min((endPos ?? 60) + 15, 95), 'EARLIEST', '—', 'var(--green)', 'below', true),
    ...(nextMin ? [lbl(+pct(nextMin), 'NEXT', `${fmt(nextMin)} ${fmtd(nextMin)}`, 'var(--blue)', 'below')] : []),
  ].join('');

  // WOCL colour tokens (purple — distinct from amber DHD and orange Req Rest)
  const woclC   = woclHit ? 'rgba(167,139,250,0.28)' : 'rgba(167,139,250,0.07)';
  const woclBdr = woclHit ? 'rgba(167,139,250,0.75)' : 'rgba(167,139,250,0.20)';

  // WOCL vertical bands — span across both bar rows (FDP + Rest)
  // Rendered inside a shared wrapper; height = FDP(28) + gap(6) + Rest(28) = 62px
  const woclOverlay = woclBands.map(b => `
    <div style="position:absolute;left:${pct(b.s)}%;top:0;height:100%;width:${wid(b.s,b.e)}%;
      background:${woclC};
      border-left:2px solid ${woclBdr};
      border-right:2px solid ${woclBdr};
      z-index:3;pointer-events:none">
    </div>`).join('');

  return `
    <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.7px;margin-bottom:6px">
      Duty &amp; Rest Visualization (UTC)
    </div>

    <!-- FDP label row (above FDP bar) -->
    <div style="position:relative;height:30px">${fdpLbls}</div>

    <!-- Chart wrapper: FDP bar + Rest bar share one relative container so WOCL spans both -->
    <div style="position:relative;height:62px">

      <!-- WOCL vertical bands (z-index:3, above both bars) -->
      ${woclOverlay}

      <!-- FDP bar (z-index:1) -->
      <div style="position:absolute;top:0;left:0;right:0;height:28px;
        background:rgba(255,255,255,0.05);border-radius:5px;overflow:hidden;z-index:1">
        <div style="position:absolute;left:0;top:0;width:${wid(startMin,cutoffMin)}%;height:100%;
          background:repeating-linear-gradient(-45deg,rgba(96,165,250,0.18),rgba(96,165,250,0.18) 3px,transparent 3px,transparent 6px);
          border-right:2px dashed rgba(96,165,250,0.55)">
          ${!endMin ? `<span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:10px;font-weight:700;color:rgba(96,165,250,0.9);white-space:nowrap">Max ${dur(maxFdpEff)}</span>` : ''}
        </div>
        ${endMin ? `<div style="position:absolute;left:0;top:0;width:${wid(startMin,endMin)}%;height:100%;background:${fdpColor};display:flex;align-items:center;justify-content:space-between;padding:0 7px;overflow:hidden">
          <span style="font-size:10px;font-weight:800;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.6)">${fdpOk===false?'✗':'✓'} ${dur(fdpMin ?? (endMin-startMin))}</span>
          <span style="font-size:9px;color:rgba(255,255,255,0.7);white-space:nowrap">/ ${dur(maxFdpEff)}</span>
        </div>` : ''}
        ${dhdMin > 0 && endMin ? `<div style="position:absolute;left:${pct(endMin)}%;top:0;width:${wid(endMin,endMin+dhdMin)}%;height:100%;
          background:rgba(251,191,36,0.55);border-left:1px solid rgba(251,191,36,0.7);display:flex;align-items:center;justify-content:center">
          <span style="font-size:9px;font-weight:800;color:#fff">DHD</span>
        </div>` : ''}
      </div>

      <!-- Rest bar (z-index:1) -->
      <div style="position:absolute;bottom:0;left:0;right:0;height:28px;
        background:rgba(255,255,255,0.05);border-radius:5px;overflow:hidden;z-index:1">
        ${restStartMin && earliestReportMin ? `<div style="position:absolute;left:${pct(restStartMin)}%;top:0;width:${wid(restStartMin,earliestReportMin)}%;height:100%;
          background:repeating-linear-gradient(-45deg,rgba(234,88,12,0.30),rgba(234,88,12,0.30) 3px,transparent 3px,transparent 6px);
          border-right:2px dashed rgba(234,88,12,0.70);display:flex;align-items:center;padding-left:8px">
          <span style="font-size:10px;font-weight:700;color:rgba(251,146,60,1.0);white-space:nowrap">Req ${dur(minRest)}</span>
        </div>` : ''}
        ${restStartMin && nextMin ? `<div style="position:absolute;left:${pct(restStartMin)}%;top:0;width:${wid(restStartMin,nextMin)}%;height:100%;background:${rstColor};display:flex;align-items:center;justify-content:space-between;padding:0 7px;overflow:hidden">
          <span style="font-size:10px;font-weight:800;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.6)">${restOk===false?'✗':'✓'} ${dur(nextMin-restStartMin)}</span>
          <span style="font-size:9px;color:rgba(255,255,255,0.7);white-space:nowrap">/ ${dur(minRest)}</span>
        </div>` : ''}
      </div>

    </div><!-- end chart wrapper -->

    <!-- Rest label row (below Rest bar) -->
    <div style="position:relative;height:36px;margin-top:1px">${restLbls}</div>

    <!-- Legend — always full set, dimmed when inactive -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;font-size:10px;color:var(--text3);padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
      <span style="display:flex;align-items:center;gap:4px;${!endMin?'opacity:0.35':''}"><span style="display:inline-block;width:12px;height:9px;background:rgba(34,197,94,0.75);border-radius:2px"></span>Actual FDP</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:9px;background:repeating-linear-gradient(-45deg,rgba(96,165,250,0.4),rgba(96,165,250,0.4) 2px,transparent 2px,transparent 4px);border-radius:2px"></span>Max FDP</span>
      <span style="display:flex;align-items:center;gap:4px;${!dhdMin?'opacity:0.35':''}"><span style="display:inline-block;width:12px;height:9px;background:rgba(251,191,36,0.55);border-radius:2px"></span>DHD</span>
      <span style="display:flex;align-items:center;gap:4px;${!woclHit?'opacity:0.35':''}"><span style="display:inline-block;width:12px;height:9px;background:rgba(167,139,250,0.6);border-radius:2px"></span>WOCL</span>
      <span style="display:flex;align-items:center;gap:4px;${!restStartMin?'opacity:0.35':''}"><span style="display:inline-block;width:12px;height:9px;background:repeating-linear-gradient(-45deg,rgba(234,88,12,0.5),rgba(234,88,12,0.5) 2px,transparent 2px,transparent 4px);border-radius:2px"></span>Req Rest</span>
      <span style="display:flex;align-items:center;gap:4px;${(!nextMin||!restStartMin)?'opacity:0.35':''}"><span style="display:inline-block;width:12px;height:9px;background:rgba(34,197,94,0.5);border-radius:2px"></span>Actual Rest</span>
    </div>`;
}

function _calcDutyTime(panel, cfg, accMode = 'before', timeMode = 'utc') {
  const res = panel.querySelector('#dt-result');

  const hasBunk    = panel.querySelector('#dt-bunk')?.checked;
  const hasTzAdapt = panel.querySelector('#dt-tzadapt')?.checked;
  const hasAcc     = panel.querySelector('#dt-acc')?.checked;
  const hasDhd     = panel.querySelector('#dt-dhd')?.checked;
  const hasPicDisc = panel.querySelector('#dt-pic-disc')?.checked;
  const tzOff      = parseInt(panel.querySelector('#dt-tz')?.value || '480'); // minutes east of UTC

  // Parse HHMM text → minutes of day (null if invalid)
  const parseHHMM = raw => {
    const s = String(raw || '').replace(/\D/g, '');
    if (s.length < 3) return null;
    const h = parseInt(s.slice(0, -2)), m = parseInt(s.slice(-2));
    if (isNaN(h) || isNaN(m) || m > 59 || h > 23) return null;
    return h * 60 + m;
  };

  // Parse date + HHMM text → absolute minutes (Unix epoch / 60)
  // If timeMode === 'local', subtract tzOff to convert local → UTC
  const parseDT = (dateId, timeId) => {
    const d = panel.querySelector(`#${dateId}`)?.value;
    const tod = parseHHMM(panel.querySelector(`#${timeId}`)?.value);
    if (!d || tod === null) return null;
    const h = Math.floor(tod / 60), m = tod % 60;
    const ms = new Date(`${d}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`).getTime();
    if (isNaN(ms)) return null;
    return Math.floor((ms - (timeMode === 'local' ? tzOff * 60000 : 0)) / 60000);
  };

  const startMin = parseDT('dt-s-date', 'dt-s-time');
  if (startMin === null) {
    res.innerHTML = '<div style="color:var(--red);font-size:13px;padding:8px 0">請填入 FDP 開始時間</div>';
    return;
  }
  const endMin  = parseDT('dt-e-date', 'dt-e-time');
  const nextMin = parseDT('dt-n-date', 'dt-n-time');

  // Flight time in minutes (HHMM text, no date component)
  const ftMin = parseHHMM(panel.querySelector('#dt-ft')?.value);

  // Accommodation rest duration
  let accMin = 0;
  if (hasAcc) {
    const ah = parseInt(panel.querySelector('#dt-acc-hh')?.value || '0') || 0;
    const am = parseInt(panel.querySelector('#dt-acc-mm')?.value || '0') || 0;
    accMin = ah * 60 + am;
  }

  // DHD End Time (Rest Start) — compute duration from FDP End to DHD End
  let dhdMin = 0;
  if (hasDhd && endMin != null) {
    const dhdEndMin = parseDT('dt-dhd-date', 'dt-dhd-time');
    if (dhdEndMin != null && dhdEndMin > endMin) dhdMin = dhdEndMin - endMin;
  }

  // Max FDP — FOM 4.7.5; 3P PIC Discretion adds 2h (FOM 4.7.5.B.c)
  const maxFdpBase = (cfg === '2P' ? 840 : cfg === '3P' ? 1080 : 1440)
    + (hasPicDisc && cfg === '3P' ? 120 : 0);
  const accActive  = hasAcc && accMin > 0;
  // "首段後 Started": FDP extended by 50% of rest, cap 24h
  // "首段前 Not Started": FDP limit unchanged; rest time added to cutoff (rest ≠ part of FDP)
  const maxFdpEff = (accActive && accMode === 'after')
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

  // Min rest after duty — FOM 4.7.5 table
  // Single 2P:   FT≤8h→10h,  FT>8h→18h
  // Multiple 3P: FT≤8h→10h,  8h<FT≤12h→18h,  FT>12h→24h
  // Double 4P:   FT≤8h→10h,  8h<FT≤16h→18h,  FT>16h→22h
  const _minRest = (cfg, ft) => {
    const h = ft != null ? ft / 60 : 0;
    if (h <= 8) return 600;
    if (cfg === '2P') return 1080;
    if (cfg === '3P') return h <= 12 ? 1080 : 1440;
    if (cfg === '4P') return h <= 16 ? 1080 : 1320;
    return 600;
  };
  const minRest = hasTzAdapt
    ? Math.max(_minRest(cfg, ftMin), 48 * 60)
    : _minRest(cfg, ftMin);

  // Actual FDP
  // Actual FDP = elapsed time excluding before-sector accommodation rest
  const fdpMin  = (endMin !== null && endMin > startMin)
    ? (endMin - startMin) - (accActive && accMode === 'before' ? accMin : 0)
    : null;
  const fdpOk   = fdpMin !== null ? fdpMin <= maxFdpEff : null;
  const ftOk    = ftMin  !== null ? ftMin  <= maxFt     : null;
  // Cutoff: for "before" accommodation, add rest to calendar end time
  const cutoffMin = startMin + maxFdpEff + (accActive && accMode === 'before' ? accMin : 0);

  // Without DHD: rest starts at Block-In directly (FOM 4.7.5)
  // With DHD: rest starts at Block-In + max(DHD, 30min) — 30min is a minimum floor
  const restStartMin = endMin !== null
    ? endMin + (dhdMin > 0 ? Math.max(dhdMin, 30) : 0)
    : null;
  const earliestReportMin = restStartMin !== null ? restStartMin + minRest : null;

  // Compute restOk for timeline
  const restActualMin = (restStartMin !== null && nextMin !== null) ? nextMin - restStartMin : null;
  const restOk = restActualMin !== null ? restActualMin >= minRest : null;

  // Build result HTML
  let html = `<div style="background:var(--surface);border-radius:10px;padding:14px 16px;margin-bottom:10px">${
    _buildTimeline({ startMin, endMin, cutoffMin, restStartMin, earliestReportMin, nextMin, dhdMin, fdpOk, restOk, maxFdpEff, fdpMin, minRest, woclHit, tzOff })
  }</div>`;

  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">`;

  // Max Duty cutoff
  html += `<div style="background:var(--surface);border-radius:8px;padding:10px 12px">
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">⏱ Max Duty 截止</div>
    <div style="font-size:18px;font-weight:800;color:var(--gold);font-family:monospace">${fmtUtc(cutoffMin)}</div>
    <div style="font-size:11px;color:var(--text3);margin-top:2px">${fmtDate(cutoffMin)} · FDP ${fmtDur(maxFdpEff)}${accActive && accMode === 'before' ? ` +Acc ${fmtDur(accMin)}` : accActive && accMode === 'after' ? ` (延長 +${fmtDur(Math.floor(accMin*0.5))})` : ''}</div>
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
        ${fdpOk ? '✓ FDP 在限制內' : `✗ FDP 超限 ${fmtDur(fdpMin - maxFdpEff)}`}${accActive && accMode === 'before' ? '<span style="font-size:10px;font-weight:400;color:var(--text3)"> (已扣除 Acc 休息)</span>' : ''}
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
      <span style="font-size:12px;color:var(--text2)">${cfg}${ftMin !== null ? ` · FT ${fmtDur(ftMin)}` : ' · FT 未輸入 (以≤8h計)'}${hasPicDisc && cfg==='3P' ? ' · PIC Disc.' : ''}</span>
      <span style="font-size:17px;font-weight:800;color:var(--text)">${fmtDur(minRest)}</span>
    </div>
    ${earliestReportMin !== null ? `<div style="font-size:11px;color:var(--text3);margin-top:5px">
      ${dhdMin > 0 ? `<span>DHD ${fmtDur(dhdMin)} → 休息起算 ${fmtUtc(restStartMin)} (Block-In +${fmtDur(Math.max(dhdMin, 30))})</span><br>` : `<span>休息起算：Block-In → ${fmtUtc(restStartMin)}</span><br>`}
      最早可報到：<b style="color:var(--text2)">${fmtUtc(earliestReportMin)}</b> (${fmtDate(earliestReportMin)})
    </div>` : ''}
  </div>`;

  // Next duty rest check (rest measured from restStartMin, i.e. Block-In + DHD + 30min)
  if (restStartMin !== null && nextMin !== null) {
    html += `<div style="background:${restOk?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)'};border:1px solid ${restOk?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)'};border-radius:8px;padding:10px 14px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:13px;font-weight:700;color:${restOk?'var(--green)':'var(--red)'}">${restOk ? '✓ 休息充足' : '✗ 休息不足'}</span>
        <span style="font-size:12px;color:var(--text2)">實際 ${fmtDur(restActualMin)} / 最低 ${fmtDur(minRest)}</span>
      </div>
      ${!restOk ? `<div style="font-size:11px;color:var(--red);margin-top:4px">不足 ${fmtDur(minRest - restActualMin)}</div>` : ''}
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

// All possible codes — shown as full grid, active ones highlighted
const _ALL_NAV = [
  ['N','無通訊導航設備 (No Equipment)'],
  ['S','標準設備 (VHF RTF / VOR / ILS)'],
  ['A','LORAN-A'],
  ['B','低頻/中頻 ADF (LF/MF ADF)'],
  ['C','甚高頻無線電 AM (VHF AM RTF)'],
  ['D','特高頻無線電 (UHF RTF)'],
  ['E','甚高頻無線電 FM (VHF FM RTF)'],
  ['F','無線電測向儀 (ADF)'],
  ['G','全球衛星導航 (GNSS)'],
  ['H','高頻無線電 (HF RTF)'],
  ['I','慣性導航系統 (INS/IRS)'],
  ['J','資料鏈路 (Data Link, see DAT/)'],
  ['K','微波降落系統 (MLS)'],
  ['L','儀器降落系統 (ILS)'],
  ['M','Omega 導航'],
  ['O','特高頻全向台 (VOR)'],
  ['R','PBN 核准 (see PBN/ in Item 18)'],
  ['T','戰術空中導航 (TACAN)'],
  ['U','特高頻無線電 (UHF RTF)'],
  ['V','甚高頻無線電 (VHF RTF)'],
  ['W','具備 RVSM 核准 (RVSM Approved)'],
  ['X','具備 MNPS 核准 (MNPS Approved)'],
  ['Y','具備 8.33 kHz VHF (8.33 kHz VHF)'],
  ['Z','其他設備 (Other, see Item 18)'],
];

const _ALL_SSR = [
  ['N','無監視設備 (No Surveillance)'],
  ['A','詢答機 Mode A (Mode A)'],
  ['C','詢答機 Mode A/C (Mode A/C)'],
  ['E','Mode S (ID/ALT/ADS–B)'],
  ['H','Mode S (ID/ALT/Enhanced)'],
  ['I','Mode S (ID/no ALT)'],
  ['L','Mode S (ID/ALT/ADS–B/Enhanced)'],
  ['P','Mode S (ALT/no ID)'],
  ['S','Mode S (ID/ALT)'],
  ['X','Mode S (no ID/no ALT)'],
  ['B1','ADS–B 1090 MHz 發送 (Out)'],
  ['B2','ADS–B 1090 MHz 收發 (Out/In)'],
  ['U1','ADS–B UAT 發送 (Out)'],
  ['U2','ADS–B UAT 收發 (Out/In)'],
  ['V1','ADS–B VDL Mode 4 發送 (Out)'],
  ['V2','ADS–B VDL Mode 4 收發 (Out/In)'],
  ['D1','ADS–C (FANS 1/A)'],
  ['G1','ADS–C (ATN)'],
];

const _ALL_PBN = [
  ['A1','RNAV 10 (RNP 10)'],
  ['B1','RNAV 5 全許可感測器 (All Permitted)'],
  ['B2','RNAV 5 (GNSS)'],
  ['B3','RNAV 5 (DME/DME)'],
  ['B4','RNAV 5 (VOR/DME)'],
  ['B5','RNAV 5 (INS/IRS)'],
  ['B6','RNAV 5 (LORANC)'],
  ['C1','RNAV 2 全許可感測器 (All Permitted)'],
  ['C2','RNAV 2 (GNSS)'],
  ['C3','RNAV 2 (DME/DME)'],
  ['C4','RNAV 2 (DME/DME/IRU)'],
  ['D1','RNAV 1 全許可感測器 (All Permitted)'],
  ['D2','RNAV 1 (GNSS)'],
  ['D3','RNAV 1 (DME/DME)'],
  ['D4','RNAV 1 (DME/DME/IRU)'],
  ['L1','RNP 4'],
  ['O1','Basic RNP 1 全許可感測器'],
  ['O2','Basic RNP 1 (GNSS)'],
  ['O3','Basic RNP 1 (DME/DME)'],
  ['O4','Basic RNP 1 (DME/DME/IRU)'],
  ['S1','RNP APCH'],
  ['S2','RNP APCH + BARO–VNAV'],
  ['T1','RNP AR APCH with RF (特殊授權)'],
  ['T2','RNP AR APCH without RF (特殊授權)'],
];

const _RULES = { I:'IFR', V:'VFR', Y:'IFR then VFR', Z:'VFR then IFR' };
const _FTYPE = { S:'定期 Scheduled', N:'非定期 Non-scheduled', G:'通用 General Aviation', M:'軍用 Military', X:'其他 Other' };
const _WAKE  = { J:'Super (A380+)', H:'重型 Heavy (≥136t)', M:'中型 Medium', L:'輕型 Light' };

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

// Parse SSR codes (handles B1, B2, U1, U2, V1, V2, D1, G1)
function _parseSsr(raw) {
  const codes = []; let i = 0;
  while (i < raw.length) {
    const two = raw.slice(i, i+2);
    if (/^[BUVDG]\d$/.test(two)) { codes.push(two); i += 2; }
    else { if (raw[i]) codes.push(raw[i]); i++; }
  }
  return codes;
}

function _fplHtml(r) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');

  // Active code sets
  const navSet = new Set((r.equipment||'').split('').filter(c => /[A-Z]/.test(c)));
  const ssrSet = new Set(_parseSsr(r.surveillance||''));
  const pbnRaw = r.item18?.PBN || '';
  const pbnSet = new Set(pbnRaw.match(/[A-Z]\d/g) || []);

  // Code chip: active = highlighted, inactive = dimmed
  const chip = (code, desc, active, color='var(--blue)') => {
    const bg  = active ? `rgba(96,165,250,0.14)` : 'rgba(255,255,255,0.03)';
    const bc  = active ? `rgba(96,165,250,0.35)` : 'var(--border-dim)';
    const clr = active ? color                    : 'var(--text3)';
    const badgeBg = active ? `rgba(96,165,250,0.25)` : 'rgba(255,255,255,0.06)';
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;
        border-radius:8px;background:${bg};border:1px solid ${bc};
        opacity:${active ? 1 : 0.45};transition:opacity .15s">
      <span style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;font-weight:800;
        color:${active ? color : 'var(--text3)'};background:${badgeBg};
        border-radius:4px;padding:2px 6px;min-width:28px;text-align:center;flex-shrink:0;
        white-space:nowrap">${esc(code)}</span>
      <span style="font-size:12px;color:${active ? 'var(--text)' : 'var(--text3)'};
        line-height:1.35;word-break:keep-all">${esc(desc)}</span>
    </div>`;
  };

  const sectionHdr = (icon, title, sub='') =>
    `<div style="display:flex;align-items:center;gap:8px;margin:0 0 12px">
      <span style="font-size:16px">${icon}</span>
      <div>
        <div style="font-size:14px;font-weight:800;color:var(--text)">${title}</div>
        ${sub ? `<div style="font-size:11px;color:var(--text3);margin-top:1px">${sub}</div>` : ''}
      </div>
    </div>`;

  const imetaRow = (label, val) =>
    `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--border-dim);align-items:baseline;flex-wrap:wrap">
      <span style="font-size:11px;color:var(--text3);min-width:90px;flex-shrink:0">${label}</span>
      <span style="font-size:13px;color:var(--text)">${val}</span>
    </div>`;

  const speedStr = r.speed
    ? `${r.speedUnit==='N'?'N':r.speedUnit==='K'?'K':'M'}${r.speed} ${r.speedUnit==='N'?'kt':r.speedUnit==='K'?'km/h':'Mach'}`
    : '—';
  const levelStr = r.level
    ? `${r.levelUnit==='F'?'FL':r.levelUnit==='A'?'ALT':''}${r.level}`
    : '—';
  const mono = (t) => `<span style="font-family:monospace;font-weight:700;color:var(--blue)">${esc(t)}</span>`;

  let html = '';

  // ── Header card ──────────────────────────────────────────────
  html += `<div class="card" style="margin-bottom:12px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
        <div style="font-size:10px;color:var(--text3);letter-spacing:.8px;margin-bottom:4px">CALLSIGN</div>
        <div style="font-size:22px;font-weight:900;color:var(--gold);font-family:monospace">${esc(r.callsign)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:3px">${esc(r.acType)} · Wake: ${_WAKE[r.wake]||r.wake||'—'}</div>
      </div>
      <div style="background:var(--surface);border-radius:8px;padding:10px 12px">
        <div style="font-size:10px;color:var(--text3);letter-spacing:.8px;margin-bottom:4px">ROUTE</div>
        <div style="font-size:20px;font-weight:900;color:var(--blue);font-family:monospace">${esc(r.dep||'????')} → ${esc(r.dest||'????')}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:3px">DEP ${r.depTime||'—'}Z &nbsp;·&nbsp; EET ${r.eet||'—'} &nbsp;·&nbsp; ALTN ${esc(r.altns)||'—'}</div>
      </div>
    </div>
    ${imetaRow('Flight Rules', `${mono(r.rules||'—')} &nbsp;${_RULES[r.rules]||''}`)}
    ${imetaRow('Flight Type',  `${mono(r.flightType||'—')} &nbsp;${_FTYPE[r.flightType]||''}`)}
    ${imetaRow('CRZ Speed / Level', `${mono(speedStr)} &nbsp;/ &nbsp;${mono(levelStr)}`)}
    ${imetaRow('Registration', mono(r.item18?.REG||'—'))}
    ${imetaRow('SELCAL', `<span style="font-family:monospace;font-weight:700;color:var(--green)">${esc(r.item18?.SEL||'—')}</span>`)}
    ${r.item18?.CODE ? imetaRow('Mode S Code', mono(r.item18.CODE)) : ''}
  </div>`;

  // ── COM/NAV (Item 10a) ────────────────────────────────────────
  html += `<div class="card" style="margin-bottom:12px">
    ${sectionHdr('📡', '通訊與導航設備 (COM/NAV — 10A)')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      ${_ALL_NAV.map(([c,d]) => chip(c, d, navSet.has(c))).join('')}
    </div>
  </div>`;

  // ── Surveillance (Item 10b) ───────────────────────────────────
  html += `<div class="card" style="margin-bottom:12px">
    ${sectionHdr('🎯', '監視設備 (SURVEILLANCE — 10B)')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      ${_ALL_SSR.map(([c,d]) => chip(c, d, ssrSet.has(c), 'var(--gold)')).join('')}
    </div>
  </div>`;

  // ── PBN (Item 18) ─────────────────────────────────────────────
  html += `<div class="card" style="margin-bottom:12px">
    ${sectionHdr('ℹ️', '其他資訊與導航性能 (ITEM 18 & PBN)')}
    <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;display:flex;align-items:center;gap:6px">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block"></span>
      性能基礎導航 (PBN — PERFORMANCE BASED NAVIGATION)
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:14px">
      ${_ALL_PBN.map(([c,d]) => chip(c, d, pbnSet.has(c), 'var(--green)')).join('')}
    </div>`;

  // Other Item 18 fields
  const skip18 = new Set(['PBN','REG','SEL','CODE']);
  const other18 = Object.entries(r.item18||{}).filter(([k]) => !skip18.has(k));
  if (other18.length) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;display:flex;align-items:center;gap:6px">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--blue);display:inline-block"></span>
      附加裝備與代碼 (Other Information)
    </div>
    <div style="display:flex;flex-direction:column;gap:0">
      ${other18.map(([k,v]) => imetaRow(k + '/', `<span style="font-family:monospace;font-size:12px;color:var(--text2)">${esc(v)}</span>`)).join('')}
    </div>`;
  }
  html += `</div>`;

  // ── Route ─────────────────────────────────────────────────────
  if (r.route) {
    html += `<div class="card">
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:8px">Item 15 — Route</div>
      <div style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:12px;color:var(--text2);line-height:1.9;word-break:break-all">${esc(r.route)}</div>
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
        ${autoFpl ? `<span style="font-size:11px;color:var(--green);font-weight:600">✓ 已從 LIDO 自動帶入</span>` : ''}
      </div>
      <textarea id="fpl-input" class="input mono" rows="5"
        placeholder="(FPL-JX726-IS&#10;-A321/M&#10;-SDE3FGHIJ4J5M1RWXYZ/LB1V1&#10;-WMKK0920&#10;-N0450F370 DCT MAYAN ...&#10;-RCTP0255 RCSS&#10;-PBN/A1B1C1D1L1O1S2 NAV/... REG/B58212 SEL/HKJP)"
        style="width:100%;font-size:12px;resize:vertical;min-height:100px;font-family:'JetBrains Mono','SF Mono',monospace">${autoFpl}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" id="btn-fpl-decode" style="flex:1">⚡ 解析 Decode</button>
        <button class="btn btn-ghost"   id="btn-fpl-reset"  style="flex:0 0 auto">重置</button>
      </div>
    </div>
    <div id="fpl-result"></div>`;

  panel.querySelector('#btn-fpl-decode').onclick = () => {
    const raw = panel.querySelector('#fpl-input').value.trim();
    const res = panel.querySelector('#fpl-result');
    if (!raw) { res.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:8px 0">請貼入 ICAO FPL 內容</div>'; return; }
    try {
      const parsed = _parseFpl(raw);
      if (!parsed.callsign) throw new Error('無法辨識格式，請確認格式為 (FPL-...)');
      res.innerHTML = _fplHtml(parsed);
    } catch(e) {
      res.innerHTML = `<div style="color:var(--red);font-size:13px;padding:8px 0">解析失敗：${e.message}</div>`;
    }
  };

  panel.querySelector('#btn-fpl-reset').onclick = () => {
    panel.querySelector('#fpl-input').value = '';
    panel.querySelector('#fpl-result').innerHTML = '';
  };

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
