// notice-board.js — 公告欄元件
// 資料來源：Cloudflare Worker KV（/api/notices）
// AI 分析：Gemini Flash，由 Worker 呼叫

const WORKER_BASE = 'https://jx-briefing.karsten77114.workers.dev';

// 來源（第一排 chip）
const SOURCE_META = {
  fleet_notice: { label: '📋 FN',    color: '#60a5fa' },
  message:      { label: '💬 訊息',  color: '#a78bfa' },
  email:        { label: '📧 Email', color: '#34d399' },
};

// 內容標籤（第二排 chip）
const TAG_META = {
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
let _notices      = [];
let _activeSource = 'all';
let _activeTag    = 'all';
let _searchQuery  = '';
let _expanded     = new Set();
let _read         = new Set();

function _loadRead() {
  try { _read = new Set(JSON.parse(localStorage.getItem('kb_read_notices') || '[]')); }
  catch { _read = new Set(); }
}
function _saveRead() {
  localStorage.setItem('kb_read_notices', JSON.stringify([..._read]));
}

// ── Backward-compat helpers ───────────────────────────────────────
function _getSourceTag(n) {
  if (n.source_tag) return n.source_tag;
  const src = (n.source || '').toLowerCase();
  if (src.includes('teams') || src.includes('line')) return 'message';
  if (src.includes('outlook') || src.includes('email') || src.includes('aviobook')) return 'email';
  return 'fleet_notice';
}

function _getTags(n) {
  if (n.tags?.length) return n.tags;
  const cat = n.category || '';
  if (cat === 'fleet_notice') return ['ops'];
  if (cat) return [cat];
  return ['ops'];
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
    const normDate = d => (d || '').replace(/\//g, '-');
    _notices = raw.sort((a, b) => {
      const da = normDate(a.issue_date), db = normDate(b.issue_date);
      if (da && db) return db.localeCompare(da);
      if (da)       return -1;
      if (db)       return 1;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    _renderList();
    _updateBadge();
  } catch (e) {
    el.innerHTML = `<div class="nb-empty">無法載入公告（${e.message}）</div>`;
  }
}

// ── Render ────────────────────────────────────────────────────────
function _filtered() {
  return _notices.filter(n => {
    if (_activeSource !== 'all' && _getSourceTag(n) !== _activeSource) return false;
    if (_activeTag    !== 'all' && !_getTags(n).includes(_activeTag))  return false;
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
  const srcTag  = _getSourceTag(n);
  const tags    = _getTags(n);
  const src     = SOURCE_META[srcTag] || { label: srcTag, color: '#94a3b8' };
  const tag     = TAG_META[tags[0]]   || null;

  const isNew   = !_read.has(n.id);
  const isExp   = _expanded.has(n.id);
  const date    = n.issue_date || '–';
  const aircraft = (Array.isArray(n.aircraft) ? n.aircraft : ['all'])
    .map(a => `<span class="nb-ac nb-ac-${a.toLowerCase()}">${a.toUpperCase()}</span>`).join('');

  const urgCls = n.urgency === 'urgent'    ? 'nb-urgent'
               : n.urgency === 'important' ? 'nb-important'
               : '';

  const tagBadge = tag
    ? `<span class="nb-tag-badge" style="background:${tag.color}20;color:${tag.color};border-color:${tag.color}40">${tag.label}</span>`
    : '';

  const body = isExp ? `
    <div class="nb-body">
      ${n.summary?.length
        ? `<ul class="nb-bullets">${n.summary.map(s => `<li>${s}</li>`).join('')}</ul>`
        : ''}
      ${n.action_required
        ? `<div class="nb-action">⚡ 需要動作：${n.action_required}</div>`
        : ''}
    </div>` : '';

  return `
    <div class="nb-item ${urgCls} ${isExp ? 'nb-open' : ''}" data-id="${n.id}">
      <div class="nb-item-hdr">
        <div class="nb-hdr-top">
          <span class="nb-src-badge" style="background:${src.color}20;color:${src.color};border-color:${src.color}40">${src.label}</span>
          ${tagBadge}
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

function _renderFilterBtns() {
  // 第一排：來源
  const srcWrap = document.getElementById('nb-sources');
  if (srcWrap) {
    const srcList = [
      { id: 'all', label: '全部' },
      ...Object.entries(SOURCE_META).map(([id, m]) => ({ id, label: m.label })),
    ];
    srcWrap.innerHTML = srcList.map(c =>
      `<button class="nb-filter-btn ${c.id === _activeSource ? 'active' : ''}" data-src="${c.id}">${c.label}</button>`
    ).join('');
    srcWrap.querySelectorAll('.nb-filter-btn').forEach(btn => {
      btn.onclick = () => {
        _activeSource = btn.dataset.src;
        srcWrap.querySelectorAll('.nb-filter-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.src === _activeSource));
        _renderList();
      };
    });
  }

  // 第二排：內容標籤
  const tagWrap = document.getElementById('nb-tags');
  if (tagWrap) {
    const tagList = [
      { id: 'all', label: '全部' },
      ...Object.entries(TAG_META).map(([id, m]) => ({ id, label: m.label })),
    ];
    tagWrap.innerHTML = tagList.map(c =>
      `<button class="nb-filter-btn nb-tag-btn ${c.id === _activeTag ? 'active' : ''}" data-tag="${c.id}">${c.label}</button>`
    ).join('');
    tagWrap.querySelectorAll('.nb-filter-btn[data-tag]').forEach(btn => {
      btn.onclick = () => {
        _activeTag = btn.dataset.tag;
        tagWrap.querySelectorAll('.nb-filter-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.tag === _activeTag));
        _renderList();
      };
    });
  }
}

// ── Public API ────────────────────────────────────────────────────
export function mountNoticeBoard(container) {
  _loadRead();

  container.innerHTML = `
    <div class="nb-wrap">
      <div class="nb-header">
        <span class="section-title" style="margin-bottom:0">📢 公告欄</span>
        <span id="nb-badge" class="nb-badge" style="display:none"></span>
        <button class="btn btn-ghost btn-sm" id="nb-read-all-btn" title="全部已讀">全讀</button>
        <button class="btn btn-ghost btn-sm" id="nb-refresh-btn" title="重新整理">↺</button>
      </div>

      <!-- Search -->
      <div class="nb-search-row">
        <input id="nb-search" class="input nb-search-input" type="search" placeholder="搜尋公告…">
      </div>

      <!-- Source filter (row 1) -->
      <div id="nb-sources" class="nb-filter-row"></div>

      <!-- Tag filter (row 2) -->
      <div id="nb-tags" class="nb-filter-row nb-tags-row"></div>

      <!-- List -->
      <div id="nb-list" class="nb-list"></div>
    </div>`;

  _applyStyles();
  _renderFilterBtns();
  _fetch();

  const searchEl = container.querySelector('#nb-search');
  searchEl.addEventListener('input', () => {
    _searchQuery = searchEl.value.trim().toLowerCase();
    _renderList();
  });

  container.querySelector('#nb-read-all-btn').onclick = () => {
    _notices.forEach(n => _read.add(n.id));
    _saveRead();
    _renderList();
    _updateBadge();
  };

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
    .nb-wrap { margin-bottom: 4px; margin-top: 14px; }

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

    /* Filter rows */
    .nb-filter-row {
      display: flex; gap: 6px; overflow-x: auto;
      padding-bottom: 4px; margin-bottom: 6px;
      scrollbar-width: none;
    }
    .nb-filter-row::-webkit-scrollbar { display: none; }
    .nb-tags-row { margin-bottom: 10px; }
    .nb-filter-btn {
      flex-shrink: 0;
      background: var(--surface, #0f1824); color: var(--text2, #94a3b8);
      border: 1px solid var(--border, #1e3050);
      border-radius: 20px; padding: 4px 11px;
      font-size: 12px; cursor: pointer; white-space: nowrap;
      transition: background 0.15s, color 0.15s;
    }
    .nb-filter-btn.active {
      background: rgba(196,154,60,0.15); color: #c49a3c;
      border-color: rgba(196,154,60,0.4);
    }
    .nb-tag-btn { font-size: 11px; padding: 3px 10px; }

    /* Notice items */
    .nb-list {
      display: flex; flex-direction: column; gap: 6px;
      max-height: 345px; overflow-y: auto;
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
    .nb-src-badge, .nb-tag-badge {
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
  `;
  document.head.appendChild(s);
}
