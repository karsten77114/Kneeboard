// notice-board.js — 公告欄元件
// 資料來源：Cloudflare Worker KV（/api/notices）
// AI 分析：Gemini Flash，由 Worker 呼叫

const WORKER_BASE = 'https://jx-briefing.karsten77114.workers.dev';

const CAT_META = {
  fleet_notice:  { label: '📋 FN',    color: '#60a5fa' },
  ops:           { label: '✈️ Ops',   color: '#22d3ee' },
  safety:        { label: '🔴 Safety',color: '#ff4757' },
  manual_update: { label: '📖 手冊',  color: '#c49a3c' },
  admin:         { label: '📌 行政',  color: '#a78bfa' },
  app_notice:    { label: '📱 App',   color: '#34d399' },
};

const AIRCRAFT_COLOR = {
  a321: '#c49a3c',
  a330: '#eebbc3',
  a350: '#60a5fa',
  all:  '#94a3b8',
};

// ── State ─────────────────────────────────────────────────────────
let _notices     = [];
let _activeCat   = 'all';
let _searchQuery = '';
let _expanded    = new Set();
let _read        = new Set();

function _loadRead() {
  try { _read = new Set(JSON.parse(localStorage.getItem('kb_read_notices') || '[]')); }
  catch { _read = new Set(); }
}
function _saveRead() {
  localStorage.setItem('kb_read_notices', JSON.stringify([..._read]));
}

// ── Fetch ─────────────────────────────────────────────────────────
async function _fetch() {
  const el = document.getElementById('nb-list');
  if (!el) return;
  el.innerHTML = '<div class="nb-loading">載入中…</div>';
  try {
    const res = await fetch(`${WORKER_BASE}/api/notices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    // 依上傳時間（created_at）由新到舊排序
    _notices = raw.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    _renderList();
    _updateBadge();
  } catch (e) {
    el.innerHTML = `<div class="nb-empty">無法載入公告（${e.message}）</div>`;
  }
}

// ── Render ────────────────────────────────────────────────────────
function _filtered() {
  return _notices.filter(n => {
    if (_activeCat !== 'all' && n.category !== _activeCat) return false;
    if (_searchQuery) {
      const hay = `${n.title} ${n.source} ${(n.summary || []).join(' ')}`.toLowerCase();
      if (!hay.includes(_searchQuery)) return false;
    }
    return true;
  });
}

function _renderList() {
  const el = document.getElementById('nb-list');
  if (!el) return;
  const list = _filtered();
  if (!list.length) {
    el.innerHTML = '<div class="nb-empty">沒有符合的公告</div>';
    return;
  }
  el.innerHTML = list.map(_noticeHtml).join('');

  el.querySelectorAll('.nb-item-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const id = hdr.closest('.nb-item').dataset.id;
      if (_expanded.has(id)) _expanded.delete(id);
      else                   _expanded.add(id);
      _read.add(id);
      _saveRead();
      _renderList();
      _updateBadge();
    });
  });
}

function _noticeHtml(n) {
  const cat      = CAT_META[n.category] || { label: n.category || '?', color: '#94a3b8' };
  const isNew    = !_read.has(n.id);
  const isExp    = _expanded.has(n.id);
  const date     = (n.created_at || '').slice(0, 10).replace(/-/g, '/');
  const aircraft = (Array.isArray(n.aircraft) ? n.aircraft : ['all'])
    .map(a => `<span class="nb-ac nb-ac-${a.toLowerCase()}">${a.toUpperCase()}</span>`).join('');

  const urgCls = n.urgency === 'urgent'    ? 'nb-urgent'
               : n.urgency === 'important' ? 'nb-important'
               : '';

  const body = isExp ? `
    <div class="nb-body">
      ${n.summary?.length
        ? `<ul class="nb-bullets">${n.summary.map(s => `<li>${s}</li>`).join('')}</ul>`
        : ''}
      ${n.action_required
        ? `<div class="nb-action">⚡ 需要動作：${n.action_required}</div>`
        : ''}
      <div class="nb-meta-row">
        <span class="nb-ts">${(n.created_at || '').replace('T', ' ').slice(0, 16)} UTC</span>
      </div>
    </div>` : '';

  return `
    <div class="nb-item ${urgCls} ${isExp ? 'nb-open' : ''}" data-id="${n.id}">
      <div class="nb-item-hdr">
        <div class="nb-hdr-top">
          <span class="nb-cat-badge" style="background:${cat.color}20;color:${cat.color};border-color:${cat.color}40">${cat.label}</span>
          ${isNew ? '<span class="nb-new-dot">NEW</span>' : ''}
          <span class="nb-date">${date}</span>
          ${n.source ? `<span class="nb-source">${n.source}</span>` : ''}
          <span class="nb-ac-wrap">${aircraft}</span>
        </div>
        <div class="nb-hdr-bot">
          <span class="nb-title">${n.title || n.source || '（無標題）'}</span>
          <span class="nb-chevron">${isExp ? '▲' : '▼'}</span>
        </div>
      </div>
      ${body}
    </div>`;
}

function _updateBadge() {
  const badge = document.getElementById('nb-badge');
  if (!badge) return;
  const unread = _notices.filter(n => !_read.has(n.id)).length;
  badge.textContent = unread || '';
  badge.style.display = unread ? 'inline-flex' : 'none';
}

function _renderCatBtns() {
  const wrap = document.getElementById('nb-cats');
  if (!wrap) return;
  const cats = [
    { id: 'all', label: '全部' },
    ...Object.entries(CAT_META).map(([id, m]) => ({ id, label: m.label })),
  ];
  wrap.innerHTML = cats.map(c =>
    `<button class="nb-cat-btn ${c.id === _activeCat ? 'active' : ''}" data-cat="${c.id}">${c.label}</button>`
  ).join('');
  wrap.querySelectorAll('.nb-cat-btn').forEach(btn => {
    btn.onclick = () => {
      _activeCat = btn.dataset.cat;
      wrap.querySelectorAll('.nb-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === _activeCat));
      _renderList();
    };
  });
}

// ── Public API ────────────────────────────────────────────────────
export function mountNoticeBoard(container) {
  _loadRead();

  container.innerHTML = `
    <div class="nb-wrap">
      <div class="nb-header">
        <span class="section-title" style="margin-bottom:0">📢 公告欄</span>
        <span id="nb-badge" class="nb-badge" style="display:none"></span>
        <button class="btn btn-ghost btn-sm" id="nb-refresh-btn" title="重新整理">↺</button>
      </div>

      <!-- Search -->
      <div class="nb-search-row">
        <input id="nb-search" class="input nb-search-input" type="search" placeholder="搜尋公告…">
      </div>

      <!-- Category filter -->
      <div id="nb-cats" class="nb-cats"></div>

      <!-- List -->
      <div id="nb-list" class="nb-list"></div>
    </div>`;

  _applyStyles();
  _renderCatBtns();
  _fetch();

  // Search
  const searchEl = container.querySelector('#nb-search');
  searchEl.addEventListener('input', () => {
    _searchQuery = searchEl.value.trim().toLowerCase();
    _renderList();
  });

  // Refresh
  container.querySelector('#nb-refresh-btn').onclick = _fetch;
}

export function unmountNoticeBoard() {
  // no cleanup needed
}

// ── Styles ────────────────────────────────────────────────────────
function _applyStyles() {
  if (document.getElementById('nb-style')) return;
  const s = document.createElement('style');
  s.id = 'nb-style';
  s.textContent = `
    /* Wrapper */
    .nb-wrap { margin-bottom: 4px; }

    .nb-header {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 10px;
    }
    .nb-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 20px; height: 20px; padding: 0 5px;
      border-radius: 10px;
      background: #ff4757; color: #fff;
      font-size: 11px; font-weight: 700;
    }
    #nb-refresh-btn { margin-left: auto; font-size: 16px; }

    /* Search */
    .nb-search-row { margin-bottom: 8px; }
    .nb-search-input {
      width: 100%; box-sizing: border-box;
      background: var(--card, #1e2a3a);
      border: 1px solid var(--border, #1e3050);
      color: var(--text, #e2e8f0);
      border-radius: 8px; padding: 8px 12px;
      font-size: 13px;
    }
    .nb-search-input:focus { outline: none; border-color: var(--accent, #c49a3c); }

    /* Category chips */
    .nb-cats {
      display: flex; gap: 6px; overflow-x: auto;
      padding-bottom: 4px; margin-bottom: 10px;
      scrollbar-width: none;
    }
    .nb-cats::-webkit-scrollbar { display: none; }
    .nb-cat-btn {
      flex-shrink: 0;
      background: var(--surface, #0f1824); color: var(--text2, #94a3b8);
      border: 1px solid var(--border, #1e3050);
      border-radius: 20px; padding: 5px 12px;
      font-size: 12px; cursor: pointer; white-space: nowrap;
      transition: background 0.15s, color 0.15s;
    }
    .nb-cat-btn.active {
      background: rgba(196,154,60,0.15); color: #c49a3c;
      border-color: rgba(196,154,60,0.4);
    }

    /* Notice items */
    .nb-list {
      display: flex; flex-direction: column; gap: 6px;
      max-height: 420px; overflow-y: auto;
      padding-right: 2px;
      scrollbar-width: thin;
      scrollbar-color: var(--border, #1e3050) transparent;
    }
    .nb-list::-webkit-scrollbar { width: 4px; }
    .nb-list::-webkit-scrollbar-thumb { background: var(--border, #1e3050); border-radius: 2px; }
    .nb-loading, .nb-empty {
      text-align: center; color: var(--text2, #94a3b8);
      padding: 20px 0; font-size: 13px;
    }

    .nb-item {
      background: var(--card, #162030);
      border: 1px solid var(--border, #1e3050);
      border-radius: 10px; overflow: hidden;
      transition: border-color 0.15s;
      flex-shrink: 0;
    }
    .nb-item.nb-urgent    { border-left: 3px solid #ff4757; }
    .nb-item.nb-important { border-left: 3px solid #ffb703; }

    .nb-item-hdr {
      padding: 10px 12px; cursor: pointer;
      user-select: none;
    }
    .nb-item.nb-open .nb-item-hdr { padding-bottom: 8px; }

    .nb-hdr-top {
      display: flex; align-items: center; gap: 6px;
      flex-wrap: wrap; margin-bottom: 5px;
    }
    .nb-cat-badge {
      font-size: 11px; font-weight: 700; padding: 2px 7px;
      border-radius: 5px; border: 1px solid; white-space: nowrap;
    }
    .nb-new-dot {
      font-size: 10px; font-weight: 800; color: #ff4757;
      background: rgba(255,71,87,0.12); border-radius: 4px;
      padding: 1px 5px;
    }
    .nb-date {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      font-size: 11px; color: var(--text2, #94a3b8);
    }
    .nb-source {
      font-size: 11px; font-weight: 600;
      color: var(--accent, #c49a3c);
      background: rgba(196,154,60,0.1);
      border-radius: 4px; padding: 1px 6px;
      white-space: nowrap; max-width: 110px;
      overflow: hidden; text-overflow: ellipsis;
    }
    .nb-ac-wrap { display: flex; gap: 4px; margin-left: auto; }
    .nb-ac {
      font-size: 10px; font-weight: 700; padding: 1px 5px;
      border-radius: 4px;
    }
    .nb-ac-a321 { background: rgba(196,154,60,0.15); color: #c49a3c; }
    .nb-ac-a330 { background: rgba(238,187,195,0.15); color: #eebbc3; }
    .nb-ac-a350 { background: rgba(96,165,250,0.15); color: #60a5fa; }
    .nb-ac-all  { background: rgba(148,163,184,0.1); color: #94a3b8; }

    .nb-hdr-bot {
      display: flex; align-items: center; gap: 8px;
    }
    .nb-title {
      flex: 1; font-size: 13px; font-weight: 600;
      color: var(--text, #e2e8f0); line-height: 1.4;
    }
    .nb-chevron {
      font-size: 10px; color: var(--text2, #94a3b8);
      flex-shrink: 0;
    }

    /* Expanded body */
    .nb-body {
      padding: 0 12px 12px;
      border-top: 1px solid var(--border, #1e3050);
      padding-top: 10px;
    }
    .nb-bullets {
      margin: 0 0 8px 0; padding-left: 18px;
      color: var(--text, #e2e8f0); font-size: 13px; line-height: 1.7;
    }
    .nb-bullets li { margin-bottom: 3px; }
    .nb-action {
      background: rgba(255,183,3,0.08);
      border: 1px solid rgba(255,183,3,0.25);
      border-radius: 7px; padding: 8px 10px;
      font-size: 12px; color: #ffb703;
      margin-top: 8px;
    }
    .nb-meta-row {
      display: flex; justify-content: space-between;
      margin-top: 10px; font-size: 11px; color: var(--text3, #475569);
    }
  `;
  document.head.appendChild(s);
}
