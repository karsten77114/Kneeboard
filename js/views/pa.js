import store from '../store.js';

// PA scripts — currently Departure + Descent fully implemented
// Ground Delay / Turbulence / De-anti-ice / Missed Approach / Diversion / Unruly Pax = TODO

const PA_LIST = [
  { id: 'departure',  label: '🛫 Departure',        done: true  },
  { id: 'descent',    label: '🛬 Descent',           done: true  },
  { id: 'delay',      label: '⏱ Ground Delay',      done: false },
  { id: 'turb',       label: '⚡ Turbulence',        done: false },
  { id: 'deice',      label: '🧊 De/Anti-Ice',       done: false },
  { id: 'ma',         label: '🔄 Missed Approach',   done: false },
  { id: 'diversion',  label: '🔀 Diversion',         done: false },
  { id: 'unruly',     label: '⚠️ Unruly Passenger',  done: false },
];

let activePa = 'departure';

export function mount(container) {
  _render(container);
}

export function unmount(container) {}

function _render(container) {
  container.innerHTML = `
    <div style="display:flex;height:100%">
      <!-- PA list sidebar -->
      <div style="width:160px;flex-shrink:0;border-right:1px solid var(--border);padding:12px 8px;overflow-y:auto">
        ${PA_LIST.map(p => `
          <button class="pa-nav-btn ${p.id === activePa ? 'active' : ''} ${!p.done ? 'wip' : ''}" data-id="${p.id}">
            ${p.label}
            ${!p.done ? '<span class="wip-badge">建置中</span>' : ''}
          </button>`).join('')}
      </div>
      <!-- PA content -->
      <div id="pa-content" style="flex:1;overflow-y:auto;padding:16px"></div>
    </div>`;

  _applyStyles();

  container.querySelectorAll('.pa-nav-btn').forEach(btn => {
    btn.onclick = () => {
      activePa = btn.dataset.id;
      container.querySelectorAll('.pa-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.id === activePa));
      _renderPaContent(container.querySelector('#pa-content'));
    };
  });

  _renderPaContent(container.querySelector('#pa-content'));
}

function _renderPaContent(panel) {
  switch (activePa) {
    case 'departure': _renderDeparture(panel); break;
    case 'descent':   _renderDescent(panel);   break;
    default:          _renderWip(panel);        break;
  }
}

// ── Departure PA ──────────────────────────────────────────────────

function _renderDeparture(panel) {
  const f  = store.flight;
  const br = store.briefing;

  const dest     = f?.dest  || '';
  const destName = _airportName(dest);
  const ete      = f?.ete   || '';
  const staLocal = f?.staLocal || '';
  const reg      = f?.reg   || '';
  const depCity  = _airportCity(f?.dep || '');
  const destCity = _airportCity(dest);

  const localTime   = staLocal ? _formatLocalTime(staLocal) : '___:___';
  const eteMins     = _eteToMins(ete);
  const flightTimeStr = eteMins ? `approximately ${Math.floor(eteMins/60)} hours and ${eteMins%60} minutes` : 'approximately ___ hours and ___ minutes';

  const enScript = `Ladies and gentlemen, welcome aboard STARLUX Airlines flight ${f?.flightNumber || 'JX___'} to ${destCity || dest}${destName ? ` ${destName}` : ''}.

Our flying time will be ${flightTimeStr}. We expect to arrive at ${destCity || dest} at ${localTime} local time.

On behalf of your captain and the entire crew, we wish you a pleasant flight. Thank you.`;

  const zhScript = `各位旅客，歡迎搭乘星宇航空 ${f?.flightNumber || 'JX___'} 班機，飛往${destCity ? `${destCity}` : dest}。

本次預計飛行時間為${ete || '___'}，我們預計在當地時間 ${localTime} 抵達目的地。

謝謝各位旅客的選搭，祝您旅途愉快。`;

  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">🛫 Departure PA</h3>
    ${f ? '' : `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--yellow);margin-bottom:14px">
      請先查詢航班以自動帶入資訊。</div>`}
    <div class="pa-block">
      <div class="pa-lang-tag">English</div>
      <div class="pa-text" id="pa-en-dep" contenteditable="true">${enScript}</div>
    </div>
    <div class="pa-block" style="margin-top:12px">
      <div class="pa-lang-tag">中文</div>
      <div class="pa-text" id="pa-zh-dep" contenteditable="true">${zhScript}</div>
    </div>
    <div style="margin-top:12px;color:var(--text3);font-size:12px">※ 點擊文字可直接編輯</div>`;
}

// ── Descent PA ────────────────────────────────────────────────────

function _renderDescent(panel) {
  const f  = store.flight;
  const dest     = f?.dest || '';
  const destCity = _airportCity(dest);
  const staLocal = f?.staLocal || '';
  const tempC    = '';  // to be filled manually

  const enScript = `Ladies and gentlemen, we will shortly be arriving at ${destCity || dest}. The local time is approximately ${staLocal ? _formatLocalTime(staLocal) : '___:___'}.

Please fasten your seatbelts, fold and stow your tray tables, and return your seat backs to the upright position. All electronic devices should be switched to airplane mode.

We remind you that all STARLUX Airlines flights are smoke-free flights.

We hope you have enjoyed your flight with us today and look forward to welcoming you onboard again. Thank you.`;

  const zhScript = `各位旅客，本班機即將降落${destCity ? `${destCity}` : dest}。當地時間約為 ${staLocal ? _formatLocalTime(staLocal) : '___:___'}。

請回到座位坐好並繫好安全帶，將椅背及前方小桌板回復直立與收好的位置，並確認隨身攜帶之電子設備已切換至飛航模式。

再次提醒您，本班機全程禁止吸菸。

感謝您今日搭乘星宇航空，期待再次為您服務。`;

  panel.innerHTML = `
    <h3 style="font-size:16px;font-weight:800;margin-bottom:14px">🛬 Descent PA</h3>
    <div class="pa-block">
      <div class="pa-lang-tag">English</div>
      <div class="pa-text" contenteditable="true">${enScript}</div>
    </div>
    <div class="pa-block" style="margin-top:12px">
      <div class="pa-lang-tag">中文</div>
      <div class="pa-text" contenteditable="true">${zhScript}</div>
    </div>
    <div style="margin-top:12px;color:var(--text3);font-size:12px">※ 點擊文字可直接編輯</div>`;
}

function _renderWip(panel) {
  const item = PA_LIST.find(p => p.id === activePa);
  panel.innerHTML = `
    <div class="state-screen">
      <div class="state-icon">🚧</div>
      <div class="state-title">${item?.label || ''}</div>
      <div class="state-sub">此廣播詞模板建置中，列入待辦清單。</div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────

let _airports = null;
async function _loadAirports() {
  if (_airports) return _airports;
  try {
    const r = await fetch('./assets/airports.json');
    _airports = await r.json();
  } catch { _airports = []; }
  return _airports;
}

function _airportCity(iata) {
  // Sync lookup from preloaded data (populated on first async call)
  return _airports?.find(a => a.iata === iata)?.chinese || '';
}

function _airportName(iata) {
  return _airports?.find(a => a.iata === iata)?.english || '';
}

function _eteToMins(ete) {
  if (!ete) return null;
  const m = ete.match(/(\d+)[:\.](\d+)/);
  return m ? parseInt(m[1])*60 + parseInt(m[2]) : null;
}

function _formatLocalTime(hhmm) {
  if (!hhmm || hhmm.length < 4) return hhmm;
  return `${hhmm.slice(0,2)}:${hhmm.slice(2,4)}`;
}

// Pre-load airports on module load
_loadAirports();

// ── Styles ────────────────────────────────────────────────────────

function _applyStyles() {
  if (document.getElementById('pa-style')) return;
  const s = document.createElement('style');
  s.id = 'pa-style';
  s.textContent = `
    .pa-nav-btn {
      display: block; width: 100%;
      padding: 9px 10px; margin-bottom: 4px;
      border: none; background: transparent;
      color: var(--text2); font-size: 12px; font-weight: 600;
      text-align: left; border-radius: 8px; cursor: pointer;
      transition: all 0.15s;
    }
    .pa-nav-btn.active { background: var(--card); color: var(--accent); }
    .pa-nav-btn.wip    { opacity: 0.5; }
    .wip-badge {
      display: block; font-size: 10px; color: var(--text3);
      font-weight: 400; margin-top: 2px;
    }
    .pa-block {
      background: var(--card); border: 1px solid var(--border);
      border-radius: 10px; overflow: hidden;
    }
    .pa-lang-tag {
      background: var(--surface); padding: 6px 12px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.6px;
      color: var(--text3); text-transform: uppercase;
      border-bottom: 1px solid var(--border);
    }
    .pa-text {
      padding: 14px; font-size: 14px; line-height: 1.8;
      color: var(--text); outline: none; white-space: pre-wrap;
      min-height: 80px;
    }
    .pa-text:focus { background: rgba(245,158,11,0.04); }
  `;
  document.head.appendChild(s);
}
