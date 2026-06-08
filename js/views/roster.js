// Roster tab — shows imported PegaSys pairings
import storage from '../services/storage.js';
import { showToast } from '../utils.js';

const MY_STAFF_ID = '2317073';
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// ── Helpers ──────────────────────────────────────────────────────

function _formatDate(d) {
  // "20260608" → "08 JUN 2026"
  const m = parseInt(d.slice(4,6), 10);
  return `${d.slice(6,8)} ${MONTHS[m-1]} ${d.slice(0,4)}`;
}

function _isToday(d) {
  const n = new Date();
  const t = `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
  return d === t;
}

function _isFuture(d) {
  const n = new Date();
  const t = `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
  return d >= t;
}

function _blockStr(min) {
  return `${Math.floor(min/60)}h${String(min%60).padStart(2,'0')}m`;
}

// ── Storage ──────────────────────────────────────────────────────

export function getRoster() {
  return (storage.get('roster', []) || [])
    .filter(p => _isFuture(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function savePairing(pairing) {
  const list = (storage.get('roster', []) || []).filter(p => p.date !== pairing.date);
  list.push(pairing);
  storage.set('roster', list);
}

// ── Crew renderer ─────────────────────────────────────────────────

function _crewHtml(crew) {
  if (!crew?.length) {
    return `<div style="font-size:12px;color:var(--text-faint);padding:6px 0;font-style:italic">
      Crew not imported — re-run shortcut on CREW tab
    </div>`;
  }
  const show = crew.filter(c =>
    ['CAP','FO','TFO','SO','SFO','PFO'].includes(c.rank) || c.position === 'CIC'
  );
  return show.map(c => {
    const isMe    = c.staffId === MY_STAFF_ID;
    const isCIC   = c.position === 'CIC';
    const label   = isCIC ? 'Purser' : c.rank;
    const name    = `${c.firstName} ${c.lastName}`;
    return `<div style="display:flex;gap:10px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-subtle)">
      <span style="width:52px;font-size:11px;color:${isCIC ? '#f59e0b' : 'var(--text-dim)'};font-weight:600;flex-shrink:0">${label}</span>
      <span style="font-size:13px;${isMe ? 'color:var(--accent);font-weight:700' : ''}">${name}${isMe ? ' ★' : ''}</span>
    </div>`;
  }).join('');
}

// ── Pairing card ──────────────────────────────────────────────────

function _pairingCard(p, idx) {
  const dateLabel = _formatDate(p.date) + (_isToday(p.date) ? ' — Today' : '');

  const legs = (p.legs || []).map(lg => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:15px;letter-spacing:.5px">${lg.flightNumber}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px">
          ${lg.dep} → ${lg.dest} &nbsp;·&nbsp; ${lg.std_local}→${lg.sta_local}L &nbsp;·&nbsp; ${_blockStr(lg.blockTime)}
        </div>
        <div style="font-size:11px;color:var(--text-faint);margin-top:1px">STD ${lg.std_utc}Z · STA ${lg.sta_utc}Z</div>
      </div>
      <button class="btn btn-primary btn-sm"
              data-load-fn="${lg.flightNumber.replace(/^JX/i,'')}"
              data-load-date="${p.date}"
              style="font-size:12px;padding:5px 12px;white-space:nowrap;flex-shrink:0">
        Load ✈
      </button>
    </div>`).join('');

  return `<div class="card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
      <div>
        <div style="font-weight:700;font-size:15px">${dateLabel}</div>
        ${p.reportTime ? `<div style="font-size:12px;color:var(--text-dim);margin-top:2px">Report ${p.reportAirport} ${p.reportTime}L</div>` : ''}
      </div>
      <button class="roster-del-btn" data-del-date="${p.date}"
              style="background:none;border:none;color:var(--text-faint);cursor:pointer;font-size:20px;padding:0 2px;line-height:1">
        ×
      </button>
    </div>
    ${legs}
    <div style="margin-top:10px;border-top:1px solid var(--border-subtle);padding-top:10px">
      ${_crewHtml(p.crew)}
    </div>
  </div>`;
}

// ── Main render ───────────────────────────────────────────────────

function _render(container) {
  const pairings = getRoster();

  container.innerHTML = `<div class="view-content">
    <div class="section-title" style="margin-bottom:14px">Roster</div>
    ${pairings.length === 0
      ? `<div class="card" style="text-align:center;padding:40px 20px">
          <div style="font-size:40px;margin-bottom:14px">📅</div>
          <div style="font-weight:600;font-size:15px;margin-bottom:10px">No roster imported yet</div>
          <div style="font-size:13px;color:var(--text-dim);line-height:1.7">
            In Safari, open a PegaSys pairing detail page,<br>
            then tap <b>Share ⬆️ → KneeBoard Import</b>.
          </div>
        </div>`
      : pairings.map(_pairingCard).join('')
    }
  </div>`;

  // Event delegation for Load & Delete buttons
  container.querySelectorAll('[data-load-fn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fn   = btn.dataset.loadFn;
      const date = btn.dataset.loadDate;
      window.dispatchEvent(new CustomEvent('kb-load-flight', { detail: { fn, date } }));
    });
  });
  container.querySelectorAll('.roster-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const date = btn.dataset.delDate;
      const list = (storage.get('roster', []) || []).filter(p => p.date !== date);
      storage.set('roster', list);
      showToast('Removed');
      _render(container);
    });
  });
}

// ── Public API ────────────────────────────────────────────────────

export function mount(container) {
  _render(container);
}

export function unmount(_container) {}
