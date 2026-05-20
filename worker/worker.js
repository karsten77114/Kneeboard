// Kneeboard — Cloudflare Worker
// LIDO 登入、Session、Briefing、D-ATIS proxy
// ELB / METAR endpoints: stub — to be implemented

const LIDO_BASE = 'https://sjx.lido.aero';
const LIDO_LOGIN_URL = `${LIDO_BASE}/lido/las/login.jsp`;
const LIDO_DWR_URL = `${LIDO_BASE}/lido/las/dwr/call/plaincall/LoginBean.login.dwr`;
const LIDO_API_BASE = `${LIDO_BASE}/lido/lcb/ui`;

// 允許的 CORS 來源
const ALLOWED_ORIGINS = [
  'https://karsten77114.github.io',
  'https://karsten77114.github.io/kneeboard',
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:7788',
  'http://127.0.0.1',
];

function corsHeaders(origin) {
  // file:// 頁面送出的 origin 是字串 "null"，直接允許（個人工具，安全無虞）
  if (!origin || origin === 'null') {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
  }
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o));
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// ── Notices helpers ───────────────────────────────────────────────

function _buf2b64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function _detectMimeFromB64(b64) {
  try {
    const header = atob(b64.substring(0, 16));
    if (header.charCodeAt(0) === 0x89 && header.startsWith('\x89PNG')) return 'image/png';
    if (header.charCodeAt(0) === 0xff && header.charCodeAt(1) === 0xd8) return 'image/jpeg';
    if (header.startsWith('%PDF')) return 'application/pdf';
    if (header.startsWith('GIF8')) return 'image/gif';
    if (header.charCodeAt(0) === 0x42 && header.charCodeAt(1) === 0x4d) return 'image/bmp';
  } catch {}
  return 'image/jpeg';
}

async function _noticesGet(env) {
  if (!env.NOTICES_KV) return [];
  const raw = await env.NOTICES_KV.get('notices_list');
  return raw ? JSON.parse(raw) : [];
}

async function _noticesSet(env, list) {
  if (!env.NOTICES_KV) return;
  await env.NOTICES_KV.put('notices_list', JSON.stringify(list));
}

function _noticeFingerprint(n) {
  // source_type 納入 fingerprint，避免 Teams 引用 FN 時覆蓋原始 FN 公告
  const srcType = (n.source_type || '').toLowerCase();
  const src     = (n.source  || '').toLowerCase().replace(/\s/g, '');
  const title   = (n.title   || '').toLowerCase().replace(/\s/g, '').slice(0, 20);
  const date    = n.issue_date || n.effective_date || '';
  return `${srcType}|${src}|${title}|${date}`;
}

function _isDuplicate(newNotice, existing) {
  const fp = _noticeFingerprint(newNotice);
  return existing.some(e => _noticeFingerprint(e) === fp);
}

// Shortcuts 傳來的日期格式不一（locale 字串、ISO 等），統一轉為 YYYY-MM-DD
function _normalizeDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // 已是 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYY/MM/DD
  const slash = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[1]}-${slash[2].padStart(2,'0')}-${slash[3].padStart(2,'0')}`;
  // Shortcuts locale（如 "May 14, 2026 at 12:00 AM" 或 "2026年5月14日"）
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      // 只接受合理年份（2020~2035）
      if (y >= 2020 && y <= 2035) return `${y}-${m}-${day}`;
    }
  } catch {}
  return null;
}

// MEL 代碼格式：nn-nn-nn[A-Z] 或 nn-nn[A-Z]，逗號分隔的清單
const _MEL_CODE_RE = /\b\d{2}-\d{2}(?:-\d{2,4})?[A-Z/]*\b/g;

function _cleanMelCodes(summary) {
  if (!Array.isArray(summary)) return summary;
  return summary.map(item => {
    const codes = item.match(_MEL_CODE_RE) || [];
    if (codes.length < 3) return item; // 代碼少於3個不處理
    // 移除代碼清單（括號包住的或逗號串接的），保留前後語意描述
    let cleaned = item
      .replace(/[（(][^）)]*(\d{2}-\d{2}[^）)]*){2,}[）)]/g, '')  // 移除括號內代碼清單
      .replace(/(?:、|,\s*)\d{2}-\d{2}(?:-\d{2,4})?[A-Z/]*/g, '') // 移除逗號串接代碼
      .replace(/\d{2}-\d{2}(?:-\d{2,4})?[A-Z/]*(?:[、,]\s*\d{2}-\d{2}(?:-\d{2,4})?[A-Z/]*)*/g, '') // 殘餘代碼串
      .replace(/，\s*$|、\s*$|,\s*$/, '')  // 清理尾端符號
      .replace(/\s{2,}/g, ' ')
      .trim();
    // 若清理後仍有意義（>10字），附加代碼數量說明
    if (cleaned.length > 10) {
      cleaned += `（共 ${codes.length} 項）`;
    } else {
      // 語意太短，用通用描述
      cleaned = item.replace(_MEL_CODE_RE, '').replace(/[（()）,、，]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      cleaned += `（共 ${codes.length} 項條款）`;
    }
    return cleaned;
  });
}

const _NOTICE_PROMPT = `你是星宇航空(STARLUX Airlines)飛行員助理。請分析以下公告，以純 JSON 回應（不加任何 markdown 或說明文字）：
{
  "title": "一句話標題（30字內）",
  "issue_date": "公告的發佈/發出日期 YYYY-MM-DD。優先順序：①FN文件上的 'Issue Date' 欄位 ②表格截圖中該筆公告所在列的第一欄日期 ③公告正文中明確標示的發文日期。【重要】Teams/Outlook/Line 的訊息傳送日期（即聊天室標題列或訊息氣泡旁的日期）不算公告發佈日，請忽略。找不到明確公告日期就填 null",
  "effective_date": "生效日 YYYY-MM-DD（Effective Date），找不到填 null",
  "source": "來源，如 FN-26-0053、Teams、Outlook、FCTM 修訂等",
  "category": "fleet_notice 或 ops 或 safety 或 manual_update 或 admin 或 app_notice（分類規則：FN-XX-XXXX 編號的一般機隊公告 → fleet_notice；涉及手冊/程序修訂 → manual_update；安全警示 → safety；飛行計畫/地面作業/特定航班通告 → ops；人事/行政/薪資 → admin；App 版本 → app_notice）",
  "aircraft": ["A321","A330","A350","all"] 中適用的機型陣列，全機隊填 ["all"],
  "urgency": "urgent 或 important 或 normal",
  "summary": ["每條重點須包含技術關鍵詞與數值（80-100字）；manual_update 類別每條修訂獨立列項，有幾條列幾條，不限數量；同一章節有複數關鍵變更時拆分為多條"],
  "action_required": "飛行員需執行的具體動作，若無填 null"
}
注意：
- manual_update 類別【FOM/FCOM/QRH 程序修訂】：① 禁止僅參考修訂對照表（Table of Changes）——必須以目錄章節號為索引，深入讀取後續詳細修訂頁面的內文 ② 提取內容必須包含具體限制、觸發條件與操作數值，格式「章節號 具體變更實質內容」，例如「6.5.1 當 RWYCC ≤ 2 時禁止尾風落地」，嚴禁輸出「6.5.1 修訂尾風落地限制」等籠統描述 ③ 若截圖包含多頁，必須跨頁整合，確保摘要基於詳細頁面內文而非僅第一頁清單
- manual_update 類別【MEL/CDL 修訂】：④ 去代碼化處理——提取資訊時立即過濾所有條目編號（所有「數字+橫槓」組成的字串視為雜訊），最終輸出中不得出現任何編號格式；語意化合併——依「受影響系統/功能（如：導航、自動飛行、通訊）」分類，同系統多項異動合併為一段語意描述；強制格式「機號：[系統/功能] 具體操作限制或變更」，例如「B-58214：[導航與自動飛行] RNP AR 操作規範全面修訂，涉及多項系統限制與進場前程序確認」；⑤ FOM/FCOM 維持逐條列項（精確數值與程序），MEL/CDL 採功能彙總
- app_notice 類別：說明是否可以升級及等待條件
- safety 類別：urgency 必須是 urgent 或 important
- 【術語保留原文】以下縮寫與專有名詞一律保留英文，不得翻譯成中文：
  飛行操作：RNP AR、RVSM、ETOPS、CAT I/II/III、SID、STAR、ILS、LOC、DA、MDA、RWYCC
  文件系統：MEL、CDL、FOM、FCOM、QRH、EFB、OFP、LIDO
  機場ATC：RWY（跑道代號保留英文格式如 RWY 16）、NOTAM、ATIS
  系統設備：TCAS、RA、TA、GPWS、EGPWS、APU、GPU、FMS、MCDU、ACARS
  天氣情報：METAR、TAF、SIGMET、AIRMET、PIREP
  機組職稱：PIC、SIC、PF、PM、Cabin Crew、FA、OCC、Dispatch
- 只輸出 JSON，不要任何其他文字`;

const _BATCH_NOTICE_PROMPT = `你是星宇航空(STARLUX Airlines)飛行員助理。分析截圖中的每一筆公告（表格每列為一筆），以純 JSON 陣列回應（不加任何 markdown 或說明文字）：
[
  {
    "title": "一句話標題（30字內）",
    "issue_date": "YYYY-MM-DD（表格第一欄的日期，即公司發佈日）",
    "effective_date": "生效日 YYYY-MM-DD 或 null",
    "source": "第二欄的來源，如 FN-26-0053、Teams、Outlook、Line 等；若第二欄空白則從內容判斷",
    "category": "fleet_notice 或 ops 或 safety 或 manual_update 或 admin 或 app_notice（FN-XX-XXXX → fleet_notice；手冊修訂 → manual_update；安全警示 → safety；航班/地面作業 → ops；人事/行政 → admin；App → app_notice）",
    "aircraft": ["A321","A330","A350"] 適用機型，全機隊填 ["all"],
    "urgency": "urgent 或 important 或 normal",
    "summary": ["重點（50字內）"],
    "action_required": "需執行的動作，若無填 null"
  }
]
每列都要提取，不要遺漏。若只有一筆也輸出含一個元素的陣列。
【術語保留原文】以下縮寫一律保留英文：RNP AR、RVSM、ETOPS、CAT I/II/III、SID、STAR、ILS、LOC、DA、MDA、RWYCC、MEL、CDL、FOM、FCOM、QRH、EFB、OFP、LIDO、RWY、NOTAM、ATIS、TCAS、RA、TA、GPWS、EGPWS、APU、GPU、FMS、MCDU、METAR、TAF、SIGMET、AIRMET、PIREP、PIC、SIC、PF、PM、OCC、Dispatch。
只輸出 JSON 陣列。`;

async function _geminiAnalyzeBatch(apiKey, contentParts) {
  if (!apiKey) throw new Error('GEMINI_API_KEY 尚未設定');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [...contentParts, { text: _BATCH_NOTICE_PROMPT }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status}: ${err.substring(0, 200)}`);
  }
  const data = await resp.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/,'').trim();
  try {
    const result = JSON.parse(clean);
    return Array.isArray(result) ? result : [result];
  } catch {
    throw new Error(`Gemini 回傳非 JSON：${raw.substring(0, 100)}`);
  }
}

async function _geminiAnalyze(apiKey, contentParts) {
  if (!apiKey) throw new Error('GEMINI_API_KEY 尚未設定（wrangler secret put GEMINI_API_KEY）');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [...contentParts, { text: _NOTICE_PROMPT }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status}: ${err.substring(0, 200)}`);
  }
  const data = await resp.json();
  const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/,'').trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Gemini 回傳非 JSON：${raw.substring(0, 100)}`);
  }
}

// ── UUID ──────────────────────────────────────────────────────────

function generateUUID() {
  let t, n;
  for (n = t = ''; t++ < 36; n += 51*t&52 ? (15^t ? 8^Math.random()*(20^t ? 16 : 4) : 4).toString(16) : '-');
  return n;
}

// ── TDX Helpers ────────────────────────────────────────────────────
// Token 在 Worker instance 內快取（同一 isolate 共用，跨 request 節省呼叫次數）
let _tdxTokenCache = null;
let _tdxTokenExp   = 0;

async function _tdxGetToken(env) {
  if (_tdxTokenCache && Date.now() < _tdxTokenExp) return _tdxTokenCache;
  const resp = await fetch(
    'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(env.TDX_CLIENT_ID)}&client_secret=${encodeURIComponent(env.TDX_CLIENT_SECRET)}`,
    }
  );
  if (!resp.ok) throw new Error(`TDX token error ${resp.status}`);
  const { access_token, expires_in } = await resp.json();
  _tdxTokenCache = access_token;
  _tdxTokenExp   = Date.now() + (expires_in - 60) * 1000; // 提前 60s 過期
  return _tdxTokenCache;
}

// 拆解航班號：'JX786' → { airline: 'JX', num: '786' }
function _parseFno(fno) {
  const m = fno.match(/^([A-Z]{2,3})(\d{1,4})$/);
  if (!m) return null;
  return { airline: m[1], num: String(parseInt(m[2], 10)) }; // 去掉前導零
}

async function _tdxFIDS(token, airportIATA, direction, parsed, dateStr) {
  // direction: 'Departure' | 'Arrival'
  // parsed=null → 不加 filter，回傳全部（debug 用）
  // dateStr: 'YYYY-MM-DD'，必填，防止抓到昨天的班次
  let filterPart = '';
  if (parsed && dateStr) {
    // TDX FlightDate 是 Edm.Date 型別，OData 不加引號
    filterPart = `$filter=AirlineID eq '${parsed.airline}' and FlightNumber eq '${parsed.num}' and FlightDate eq ${dateStr}&`;
  } else if (dateStr) {
    filterPart = `$filter=FlightDate eq ${dateStr}&`;
  }
  const qs  = `${filterPart}$format=JSON&$top=5`;
  const url = `https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport/${direction}/${airportIATA}?${qs}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`TDX FIDS ${resp.status}: ${errText.substring(0, 100)}`);
  }
  const data = await resp.json();
  // Trim 空白（TDX Gate 欄位有時有前置空格）
  if (Array.isArray(data)) {
    data.forEach(f => {
      if (f.Gate)         f.Gate         = f.Gate.trim();
      if (f.BaggageClaim) f.BaggageClaim = f.BaggageClaim.trim();
      if (f.CheckCounter) f.CheckCounter = f.CheckCounter.trim();
    });
  }
  return Array.isArray(data) ? data : [];
}

// ── AeroDataBox Helpers ────────────────────────────────────────────
// 全球機場來源（非台灣）via RapidAPI，免費 50 次/月

async function _adbxFlight(apiKey, fno, dateLocal) {
  // dateLocal: 'YYYY-MM-DD'（當地出發日期）；不傳則查最近一班
  const path = dateLocal ? `${fno}/${dateLocal}` : fno;
  const url  = `https://aerodatabox.p.rapidapi.com/flights/number/${path}`;
  const resp = await fetch(url, {
    headers: {
      'x-rapidapi-key':  apiKey,
      'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
    },
  });
  if (resp.status === 404) return null;          // 查無此班
  if (resp.status === 429) throw new Error('AeroDataBox 免費額度已用盡（50次/月），請明日再試');
  if (!resp.ok) throw new Error(`AeroDataBox error ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || !data.length) return null;

  // 優先選 IsOperator（實際執飛），過濾 codeshare 掛名班次
  return data.find(f => f.codeshareStatus === 'IsOperator') || data[0];
}

// 把 AeroDataBox 回傳正規化成跟 TDX 同樣結構
function _normalizeAdbx(flight, requestedAirport) {
  if (!flight) return { departure: null, arrival: null };

  const dep = flight.departure || {};
  const arr = flight.arrival   || {};

  const _time = (t) => t?.utc ? t.utc.replace('Z','').replace(' ','T') + 'Z' : null;
  const _status = (s) => {
    const map = { Arrived:'已到ARRIVED', Departed:'出發DEPARTED', 'En Route':'途中EN ROUTE',
                  Scheduled:'預計SCHEDULED', Cancelled:'取消CANCELLED', Delayed:'延誤DELAYED',
                  Unknown:'—' };
    return map[s] || s || null;
  };

  return {
    departure: dep.airport ? {
      airport:       dep.airport.iata || '?',
      terminal:      dep.terminal    || null,
      gate:          dep.gate        || null,
      checkIn:       dep.checkInDesk || null,
      scheduledTime: _time(dep.scheduledTime),
      actualTime:    _time(dep.revisedTime || dep.runwayTime),
      estimatedTime: null,
      status:        _status(flight.status),
    } : null,
    arrival: arr.airport ? {
      airport:       arr.airport.iata || '?',
      terminal:      arr.terminal    || null,
      gate:          arr.gate        || null,
      belt:          arr.baggageBelt || null,
      scheduledTime: _time(arr.scheduledTime),
      actualTime:    _time(arr.revisedTime || arr.runwayTime),
      estimatedTime: null,
      status:        _status(flight.status),
    } : null,
    aircraft:     flight.aircraft?.reg   || null,
    acType:       flight.aircraft?.model || null,
    aircraftHex:  flight.aircraft?.modeS || null,  // ICAO24 for ADS-B lookup
    lastUpdated:  flight.lastUpdatedUtc  || null,
  };
}

// ── ELB Functions ──────────────────────────────────────────────────

const ELB_BASE  = 'https://elb.starlux-airlines.com';
const ELB_WS    = 'https://elb.starlux-airlines.com/logbook-api/session';  // https:// for CF Workers WS upgrade
const ELB_UA    = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

function collectSetCookies(resp) {
  // Cloudflare Workers expose repeated headers via getAll() or via the raw Headers
  const raw = resp.headers.get('set-cookie') || '';
  // Extract all cookie name=value pairs (before first semicolon) joined into one Cookie string
  const pieces = raw.split(/,(?=[^ ].*?=)/);   // rough split on comma-separated Set-Cookie
  return pieces.map(p => p.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function elbHttpLogin(userId, password) {
  // Step 1: load the login SPA page to get initial cookies (JSESSIONID etc.)
  const pageResp = await fetch(`${ELB_BASE}/elb/`, {
    headers: { 'User-Agent': ELB_UA, 'Accept': 'text/html,*/*' },
    redirect: 'follow',
  });
  const initCookie = collectSetCookies(pageResp);

  // Step 2: try the REST login endpoint (common Runway / Nexus ELB pattern)
  const endpoints = [
    { url: `${ELB_BASE}/logbook-api/login`,     body: { username: userId, password } },
    { url: `${ELB_BASE}/logbook-api/auth/login`, body: { username: userId, password } },
    { url: `${ELB_BASE}/elb/api/login`,          body: { username: userId, password } },
    { url: `${ELB_BASE}/logbook-api/session`,    body: { username: userId, password }, method: 'POST' },
  ];

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep.url, {
        method: ep.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': ELB_UA,
          Cookie: initCookie,
        },
        body: JSON.stringify(ep.body),
        redirect: 'follow',
      });
      if (r.ok || r.status === 302) {
        const extra = collectSetCookies(r);
        const combined = [initCookie, extra].filter(Boolean).join('; ');
        if (combined) return combined;
      }
    } catch { /* try next */ }
  }

  throw new Error('ELB 登入失敗：無法取得 session。請確認帳號密碼正確，或稍後再試。');
}

async function elbWSQuery(sessionCookie, funcName, content) {
  const resp = await fetch(ELB_WS, {
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      Cookie: sessionCookie,
      'User-Agent': ELB_UA,
    },
  });
  if (resp.status !== 101) {
    throw new Error(`ELB WebSocket 連線失敗 (HTTP ${resp.status})，請重新登入 ELB`);
  }
  const ws = resp.webSocket;
  ws.accept();

  return new Promise((resolve, reject) => {
    const reqId = 1;
    const timer = setTimeout(() => { ws.close(); reject(new Error('ELB 請求逾時')); }, 12000);

    ws.addEventListener('message', evt => {
      let json;
      try { json = JSON.parse(evt.data); } catch { return; }
      if (json.type === 'not' && json.func === 'localApplicationConfiguration') {
        ws.send(JSON.stringify({ id: reqId, type: 'req', func: funcName, content }));
      } else if (json.type === 'res' && json.id === reqId) {
        clearTimeout(timer); ws.close();
        resolve(json.content !== undefined ? json.content : json);
      } else if (json.type === 'fail' && json.id === reqId) {
        clearTimeout(timer); ws.close();
        reject(new Error(json.content?.message || '查詢失敗'));
      }
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket 錯誤')); });
    ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('連線中斷')); });
  });
}

// ── 從 Set-Cookie header 解析特定 cookie 值 ───────────────────────
function parseCookieValue(setCookieHeaders, cookieName) {
  if (!setCookieHeaders) return null;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const h of headers) {
    const match = h.match(new RegExp(`${cookieName}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

// Step 1: 取得初始 LIDO session cookie
async function getLidoSession() {
  const resp = await fetch(
    `${LIDO_LOGIN_URL}?DESMON_RESULT_PAGE=https%3A%2F%2Fsjx.lido.aero%2Flido%2Fshell%2F%23lcb&DESMON_LANG=en`,
    { redirect: 'follow' }
  );

  // 從 Set-Cookie 取 lido_las
  const setCookie = resp.headers.get('set-cookie') || '';
  const lidoLas = parseCookieValue([setCookie], 'lido_las');
  const serverid = parseCookieValue([setCookie], 'las_serverid') || 'docker1';

  if (!lidoLas) throw new Error('Failed to get lido_las session cookie');
  return { lidoLas, serverid };
}

// 解碼 lido_csrf cookie（base64 JSON），取出 csrf_id 和 uid
function decodeLidoCsrf(lidoCsrf) {
  try {
    const decoded = JSON.parse(atob(lidoCsrf));
    return { csrfId: decoded.csrf_id || lidoCsrf, uid: decoded.uid || null, env: decoded.env || null };
  } catch(e) {
    return { csrfId: lidoCsrf, uid: null, env: null };
  }
}

// 解碼 JWT payload（base64url → JSON）
function decodeJwtPayload(jwt) {
  if (!jwt) return null;
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch(e) {
    return null;
  }
}

// Step 2: DWR 登入
async function dwrLogin(userId, password, lidoLas, serverid) {
  const scriptSessionId = generateUUID().replace(/-/g, '').toUpperCase().substring(0, 16) +
    '/' + generateUUID().replace(/-/g, '').toUpperCase().substring(0, 16);

  const dwrBody = [
    'callCount=1',
    'page=%2Flido%2Flas%2Flogin.jsp%3FDESMON_RESULT_PAGE%3Dhttps%253A%252F%252Fsjx.lido.aero%252Flido%252Fshell%252F%2523lcb%26DESMON_LANG%3Den',
    `httpSessionId=${lidoLas}`,
    `scriptSessionId=${encodeURIComponent(scriptSessionId)}`,
    'instanceId=0',
    'batchId=0',
    'c0-scriptName=LoginBean',
    'c0-methodName=login',
    'c0-id=0',
    `c0-param0=string:${userId}`,
    `c0-param1=string:${password}`,
    'c0-param2=string:',
    'c0-param3=string:LIDO',
    'c0-param4=string:en',
  ].join('\n');

  const resp = await fetch(LIDO_DWR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Cookie': `lido_las=${lidoLas}; las_serverid=${serverid}`,
    },
    body: dwrBody,
  });

  const text = await resp.text();

  // 檢查登入失敗：只有 errorCode 不是 null 才算失敗
  const errorCodeMatch = text.match(/errorCode:([^,}\s]+)/);
  const errorCode = errorCodeMatch ? errorCodeMatch[1].trim() : null;
  if (errorCode && errorCode !== 'null') {
    const errMatch = text.match(/errorMessage2:"([^"]+)"/) ||
                     text.match(/errorMessage1:"([^"]+)"/) ||
                     text.match(/warningMessage:"([^"]+)"/);
    throw new Error(errMatch ? errMatch[1] : `LIDO error: ${errorCode}`);
  }

  // 從 response 取 cookies（login 成功時設 lido_auth + lido_csrf）
  const setCookie = resp.headers.get('set-cookie') || '';
  const lidoCsrf  = parseCookieValue([setCookie], 'lido_csrf');
  const lidoAuth  = parseCookieValue([setCookie], 'lido_auth');
  const newLidoLas = parseCookieValue([setCookie], 'lido_las') || lidoLas;

  if (!lidoCsrf) throw new Error('Login succeeded but no lido_csrf cookie returned');

  // 解碼 csrf cookie 取 csrfId + uid
  const { csrfId, uid, env } = decodeLidoCsrf(lidoCsrf);

  // 解碼 JWT 取 businessId
  const jwtPayload = decodeJwtPayload(lidoAuth);
  const businessId = jwtPayload?.businessId || jwtPayload?.business_id ||
    jwtPayload?.customerId || jwtPayload?.customer_id ||
    jwtPayload?.organizationId || jwtPayload?.org ||
    uid || userId;

  return { lidoCsrf, csrfId, uid: uid || userId, businessId, env, lidoAuth, lidoLas: newLidoLas, serverid, jwtPayload };
}

// 建立 LIDO API request headers
// businessId 依呼叫類型傳入：主 briefing = "GetBriefing"，文件 = "GetDoc{TYPE}"
function buildLidoHeaders(session, businessId) {
  const { lidoCsrf, lidoLas, serverid, lidoAuth } = session;
  const cookieParts = [`lido_las=${lidoLas}`, `lido_csrf=${lidoCsrf}`, `las_serverid=${serverid}`];
  if (lidoAuth) cookieParts.push(`lido_auth=${lidoAuth}`);
  return {
    'Cookie': cookieParts.join('; '),
    'X-lido-csrf': lidoCsrf,          // 完整 base64 cookie（Angular 確認）
    'X-lido-auth': 'LAS',             // 固定 LAS
    'X-lido-businessId': businessId || 'GetBriefing',
    'X-lido-clientId': 'lido-lcb-ui',
    'X-lido-applicationId': 'lido-lcb',
    'X-lido-customerId': 'LSY',
    'X-lido-authkey': '',             // 空字串（Angular 確認）
    'X-lido-operatingAirline': '',    // 空字串（Angular 確認）
    'X-lido-traceId': generateUUID(),
    'X-lido-timeStamp': new Date().toISOString(),
    'Accept': 'application/vnd.lsy.lido.lcb.v1.hal+json',
    'Accept-Language': 'en',
  };
}

// 組合 leg ID：JX.850.28Apr2026.TPE.CTS.
function buildLegId(flightNum, dateStr, dep, dest) {
  // dateStr 格式: YYYYMMDD → DDMmmYYYY
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(dateStr.substring(0,4), parseInt(dateStr.substring(4,6))-1, parseInt(dateStr.substring(6,8)));
  const dd = String(d.getDate()).padStart(2,'0');
  const mmm = months[d.getMonth()];
  const yyyy = d.getFullYear();
  return `JX.${flightNum}.${dd}${mmm}${yyyy}.${dep}.${dest}.`;
}

// 取得飛行清單（用 /flightlist 端點 + flightNumber 搜尋 legId）
// 回傳：{ legId, dep, dest } 或 null
async function fetchFlightList(flightNum, dateStr, session) {
  // YYYYMMDD → YYYY-MM-DD
  const datePart = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`;
  const startDT = `${datePart}T00:00:00.000Z`;
  const endDT   = `${datePart}T23:59:59.000Z`;
  const url = `${LIDO_API_BASE}/flightlist?startDateTime=${startDT}&endDateTime=${endDT}`;

  const headers = buildLidoHeaders(session, 'GetFlightList');
  const resp = await fetch(url, { headers });
  if (!resp.ok) return null;

  const data = await resp.json();
  // 回傳值是陣列（或類陣列物件）
  const flights = Array.isArray(data) ? data : Object.values(data);

  // 完全匹配班號
  const matches = flights.filter(f => f.flightNumber === String(flightNum));
  if (matches.length === 0) return null;

  // 若有多個（同班號不同航段），回傳全部讓呼叫者選擇
  return matches.map(f => ({
    legId: f.legId,
    dep: f.departureAirport,
    dest: f.destinationAirport,
    std: f.std,
    flightNumber: f.flightNumber,
    // PIC name — try several possible field names from LIDO API
    pic: (typeof f.pilotInCommand === 'object' ? f.pilotInCommand?.name || f.pilotInCommand?.fullName : f.pilotInCommand)
      || (typeof f.pic === 'object' ? f.pic?.name : f.pic)
      || f.crewMember || f.captainName || null,
  }));
}

// 取得 Briefing 資料
async function fetchBriefingData(legId, headers) {
  const resp = await fetch(`${LIDO_API_BASE}/${legId}/briefing`, { headers });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Briefing fetch failed: ${resp.status} - ${errText.substring(0, 200)}`);
  }
  return resp.json();
}

// 從 LIDO briefing JSON 解析結構化資料
// 回傳: { leg, files: {OFP, ATS, NOTAM, ...}, times, fuel, weight, aircraft, route }
function parseBriefingJson(data) {
  const pkg = data?.briefingPackages?.[0];
  if (!pkg) return null;
  const leg = pkg.leg?.[0] || {};

  // 時刻（Unix ms → UTC 字串）
  const toUTC = ms => ms ? new Date(ms).toISOString().replace('T',' ').replace('.000Z','Z') : null;
  const toHHMM = ms => ms ? new Date(ms).toISOString().slice(11,16) + 'Z' : null;

  // 從 categories 找各類文件的 fileId（透過 _links.self.href 解析）
  // fileIds: { OFP: "uuid", UAD: "uuid-of-first-doc", ... }  (first doc per category, for text docs)
  // allDocs: { UAD: [{fileId, label, index}, ...], ... }  (ALL docs per category, for charts)
  const fileIds = {};
  const allDocs = {};
  for (const cat of pkg.categories || []) {
    const docs = cat.documents || [];
    if (!docs.length) continue;
    allDocs[cat.name] = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const href = doc._links?.self?.href || '';
      const m = href.match(/briefing\/([^/]+)\/docs/);
      if (!m) continue;
      const fileId = m[1];
      const label = doc.label || doc.name || doc.title || doc.description || String(i);
      const flightLevel = doc.metadata?.find(m => m.key === 'flightLevel')?.value || null;
      const fileName = doc.fileName || '';
      allDocs[cat.name].push({ fileId, label, flightLevel, fileName, index: i });
      if (i === 0) fileIds[cat.name] = fileId;  // keep first for text doc lookups
    }
  }

  // Extract structured alternate airports from leg object (LIDO may provide these directly)
  const legAirports = [];
  for (const key of ['alternateAirports','enrouteAlternates','weatherAirports','alternates','airports']) {
    const arr = leg[key];
    if (Array.isArray(arr)) {
      for (const a of arr) {
        const icao = typeof a === 'string' ? a : (a?.icao || a?.airportCode || a?.airport);
        if (icao && /^[A-Z]{3,4}$/.test(icao)) legAirports.push(icao);
      }
    }
  }

  return {
    legId: leg.legidentifier || leg.legId,
    flightNumber: leg.flightNumber,
    dep: leg.departureAirport,
    dest: leg.destinationAirport,
    ofpNumber: leg.ofpNumber,
    aircraft: leg.aircraftDetails,
    // PIC name from leg object
    pic: (typeof leg.pilotInCommand === 'object' ? leg.pilotInCommand?.name || leg.pilotInCommand?.fullName : leg.pilotInCommand)
      || (typeof leg.pic === 'object' ? leg.pic?.name : leg.pic)
      || leg.crewMember || leg.captainName || null,
    std: toHHMM(leg.scheduledDepartureTime),
    sta: toHHMM(leg.scheduledTimeOfArrival),
    etd: toHHMM(leg.estimatedDepartureTime),
    eta: toHHMM(leg.estimatedTimeOfArrival),
    dateOfOperation: leg.dateOfOperation,
    flightRoute: leg.flightRoute,
    fuel: leg.fuel,
    weight: leg.weight,
    fileIds,  // { OFP: "uuid", ATS: "uuid", ... }  first doc per category
    allDocs,  // { UAD: [{fileId, label, index}, ...], ... }  ALL docs per category
    legAirports,
    legKeys: Object.keys(leg),
  };
}

// 取得特定文件（OFP、ATS 等）
async function fetchDocument(legId, fileId, headers, asText = false) {
  const acceptHdr = asText ? 'text/plain, */*' : 'application/vnd.lsy.lido.lcb.v1.hal+json';
  const resp = await fetch(`${LIDO_API_BASE}/${legId}/briefing/${fileId}/docs`, {
    headers: { ...headers, Accept: acceptHdr }
  });
  if (!resp.ok) return null;
  return asText ? resp.text() : resp.json();
}

// 解析 OFP 文字
function parseOFP(txt) {
  if (!txt) return {};
  const r = {};
  let m;

  m = txt.match(/(?:SJX|JX)\s*(\d{3,4})/); if (m) r.flightNum = m[1];
  m = txt.match(/\b(\d{2}(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{4})\b/i); if (m) r.date = m[1].toUpperCase();
  m = txt.match(/\b(B-?\d{5}|HL\d{4}|JA\d{4})\b/); if (m) r.reg = m[1];

  // 起降機場
  m = txt.match(/FROM\s+(\w{3,4})\s+TO\s+(\w{3,4})/i);
  if (m) { r.dep = m[1]; r.dest = m[2]; }

  // 時間
  m = txt.match(/STD\s+(\d{4})L\s+(\d{4})Z/); if (m) { r.stdLocal = m[1]; r.stdUtc = m[2]+'Z'; }
  m = txt.match(/STA\s+(\d{4})L\s+(\d{4})Z/); if (m) { r.staLocal = m[1]; r.staUtc = m[2]+'Z'; }
  m = txt.match(/ETE\s+(\d+)\.(\d+)/); if (m) r.ete = m[1]+':'+m[2];

  // 飛行距離、Wind、Cost Index
  m = txt.match(/BOF\s+\w+\s+(\d+)\s+[\d.]+\s+(\d+)NM.*?W\/C\s+([PM])(\d+)/s);
  if (m) { r.tripFuel = +m[1]; r.dist = +m[2]; r.wc = (m[3]==='P'?'+':'-')+m[4]; }
  m = txt.match(/CRZ\s+CI(\d+)/i); if (m) r.ci = +m[1];

  // 備降（主 ALTN + 燃油）
  m = txt.match(/ALTN\s+(\w+)\s+(\d+)/); if (m) { r.altnApt = m[1]; r.altnFuel = +m[2]; }

  // 所有天氣機場：ALTN（多個）+ EDTO/ETP 備降場 + ERA（Enroute Alternates）
  // NOTE: Do NOT parse ICAO/IATA pairs from OFP — too many false positives (OPR/SJX, TEMP/ISA, WIND/xxx)
  //       ICAO/IATA pairs are parsed from the LIDO Weather Service text document instead.
  const wxSet = new Set();
  // Standard alternates
  for (const [, a] of txt.matchAll(/\bALTN\d*\s+([A-Z]{3,4})\b/g)) wxSet.add(a);
  // EDTO / ETP alternates
  for (const [, a] of txt.matchAll(/\bEDTO\s+(?:ALT|ALTN)\s+([A-Z]{3,4})\b/g)) wxSet.add(a);
  for (const [, a] of txt.matchAll(/\bETP\s+\d+.*?\bALT\s+([A-Z]{3,4})\b/g)) wxSet.add(a);
  // Takeoff alternates
  for (const [, a] of txt.matchAll(/\bTKOFF\s+ALTN\s+([A-Z]{3,4})\b/g)) wxSet.add(a);
  // ERA (Enroute Alternates) — LIDO formats: "ERA RJFF", "ERA1 RJFF", "ERA1-RJFF"
  for (const [, a] of txt.matchAll(/\bERA\d*[-\s]+([A-Z]{3,4})\b/g)) wxSet.add(a);
  // "ENRTE ALT RJFF" / "ENROUTE ALT RJFF" / "ENROUTE ALTERNATE RJFF"
  for (const [, a] of txt.matchAll(/\bENR(?:OUE?TE?)?\s+ALT(?:ERN(?:ATE)?)?\s+([A-Z]{3,4})\b/gi)) wxSet.add(a.toUpperCase());
  // Remove generic tokens that aren't airport codes
  ['DEST','ALTN','HOLD','FUEL','TIME','FROM','CONT','TAXI','TKOF','TKOFF','EDTO'].forEach(x => wxSet.delete(x));
  r.wxAirports = [...wxSet].filter(a => /^[A-Z]{3,4}$/.test(a));

  // 燃油明細（LIDO OFP 標準格式，含 0 值）
  const fuelLine = label => { const x = txt.match(new RegExp(label + '\\s+(\\d+)')); return x ? +x[1] : undefined; };
  r.destHoldFuel = fuelLine('DEST\\s+HOLD');
  r.finalFuel    = fuelLine('FINAL\\s+RES');
  r.wxxFuel      = fuelLine('ADD\\s+WXX');
  r.opnFuel      = fuelLine('ADD\\s+OPN');
  r.atcFuel      = fuelLine('ADD\\s+ATC');
  r.devFuel      = fuelLine('ADD\\s+DEV');
  r.critFuel     = fuelLine('CRIT\\s+FUEL');
  r.extraFuel    = fuelLine('EXTRA');
  r.tankerFuel   = fuelLine('TANKER(?:ING)?');
  m = txt.match(/^CONT\s+(\d+)/m);    if (m) r.contFuel  = +m[1];
  m = txt.match(/^TAKEOFF\s+(\d+)/m); if (m) r.toFuel    = +m[1];
  m = txt.match(/^TAXI\s+(\d+)/m);    if (m) r.taxiFuel  = +m[1];

  // 重量
  m = txt.match(/ZFW\s+([\d.]+)\s*\/\s*([\d.]+)/); if (m) { r.zfwLim = +m[1]; r.zfwPln = +m[2]; }
  m = txt.match(/TOW\s+([\d.]+)\s*\/\s*([\d.]+)/); if (m) { r.towLim = +m[1]; r.towPln = +m[2]; }
  m = txt.match(/LDW\s+([\d.]+)\s*\/\s*([\d.]+)/); if (m) { r.ldwLim = +m[1]; r.ldwPln = +m[2]; }

  return r;
}

// 提取完整 ICAO FPL 區塊（含括號），供 WNI 等工具使用
function extractIcaoFpl(txt) {
  if (!txt) return null;
  const m = txt.match(/\(FPL[\s\S]+?\)/);
  return m ? m[0].trim() : null;
}

// 解析 ATS clearance route
function parseATSRoute(txt) {
  if (!txt) return null;
  // ATS 格式通常是：DEP/SID ROUTE DEST/STAR
  const lines = txt.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  return lines.join(' ');
}

// 主 Handler
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const headers = corsHeaders(origin);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    // POST /auth/login — 使用者登入
    if (url.pathname === '/auth/login' && request.method === 'POST') {
      const body = await request.json();
      const userId = body.userId || env.LIDO_USER_ID;
      const password = body.password || env.LIDO_PASSWORD;

      if (!userId || !password) {
        return new Response(JSON.stringify({ error: 'Missing credentials' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const { lidoLas, serverid } = await getLidoSession();
      const session = await dwrLogin(userId, password, lidoLas, serverid);

      // Stateless: encode session as base64 token (no KV needed)
      const sessionToken = btoa(JSON.stringify({ ...session, ts: Date.now() }));

      return new Response(JSON.stringify({
        success: true,
        sessionToken,
        userId,
        debug: {
          csrfId: session.csrfId,
          uid: session.uid,
          businessId: session.businessId,
          jwtPayload: session.jwtPayload,
        }
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/briefing?flight=850&date=20260428&sessionToken=...
    if (url.pathname === '/api/briefing') {
      const flightNum = url.searchParams.get('flight');
      const dateStr = url.searchParams.get('date');
      const sessionToken = url.searchParams.get('sessionToken');
      const dep = url.searchParams.get('dep') || 'TPE';
      const dest = url.searchParams.get('dest') || '';
      const directLegId = url.searchParams.get('legId') || '';   // pre-resolved legId from flight table

      if (!flightNum || !dateStr) {
        return new Response(JSON.stringify({ error: 'Missing flight or date' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // Stateless: decode session from base64 token
      let session;
      if (sessionToken) {
        try {
          session = JSON.parse(atob(sessionToken));
        } catch(e) {
          session = null;
        }
      }

      if (!session) {
        return new Response(JSON.stringify({ error: 'Not authenticated. Please login first.' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // 統一日期格式：YYYYMMDD 或 YYYY-MM-DD → YYYYMMDD
      const normDate = dateStr.replace(/-/g, '');

      const briefingHeaders = buildLidoHeaders(session, 'GetBriefing');

      // 組合 legId
      let legId = null;
      let resolvedDep = dep, resolvedDest = dest;
      let resolvedPic = null;

      if (directLegId) {
        // 直接使用前端傳來的 legId（來自班表，避免 ICAO/IATA 混淆）
        legId = directLegId;
      } else if (dep && dest) {
        // dep/dest 都有 → 直接組合
        legId = buildLegId(flightNum, normDate, dep, dest);
      } else {
        // 用飛行清單搜尋
        const matches = await fetchFlightList(flightNum, normDate, session);
        if (!matches || matches.length === 0) {
          return new Response(JSON.stringify({ error: `JX${flightNum} 在 ${normDate} 查無班表，請確認班號與日期` }), {
            status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        // 若有多個航段且有提示的 dep/dest，嘗試匹配
        let chosen = matches[0];
        if (dep) chosen = matches.find(m => m.dep?.startsWith(dep) || m.dep === dep) || chosen;
        if (dest) chosen = matches.find(m => m.dest?.startsWith(dest) || m.dest === dest) || chosen;
        legId = chosen.legId;
        resolvedDep = chosen.dep;
        resolvedDest = chosen.dest;
        resolvedPic = chosen.pic || null;
      }

      if (!legId) {
        return new Response(JSON.stringify({ error: `JX${flightNum} 在 ${normDate} 查無班表` }), {
          status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // 取得 briefing JSON（包含所有結構化資料）
      const briefingData = await fetchBriefingData(legId, briefingHeaders);
      const parsed = parseBriefingJson(briefingData);

      if (!parsed) {
        return new Response(JSON.stringify({ error: 'Failed to parse briefing response', legId }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // 取 OFP / ATS / APLI 文字
      // APLI = Airport List — 包含所有天氣所需機場（格式：ICAO4+IATA3+空格+[Y/N]+日期）
      // 例：WMKKKUL     Y13MAY2026... / RCKHKHH     N13MAY2026...
      const ofpFileId  = parsed.fileIds?.OFP;
      const atsFileId  = parsed.fileIds?.ATS;
      const apliFileId = parsed.fileIds?.APLI;

      const [ofpText, atsText, apliText] = await Promise.all([
        ofpFileId  ? fetchDocument(legId, ofpFileId,  buildLidoHeaders(session, 'GetDocOFP'),  true) : Promise.resolve(null),
        atsFileId  ? fetchDocument(legId, atsFileId,  buildLidoHeaders(session, 'GetDocATS'),  true) : Promise.resolve(null),
        apliFileId ? fetchDocument(legId, apliFileId, buildLidoHeaders(session, 'GetDocAPLI'), true) : Promise.resolve(null),
      ]);

      // 只做補充解析（STD local time 等 OFP 文字獨有的資訊）
      const ofpExtra = parseOFP(ofpText);

      // Parse APLI airport list.
      // APLI format: ...ICAO(4)IATA(3)     [Y/N]13MAY2026...<info></info>...
      // Y = has SA/FT data in this briefing; N = forecast only (enroute/suitable)
      // Only extract entries with the 4+3+space+[YN] pattern — avoids FIR/SIGMET codes after
      function parseApliAirports(txt) {
        if (!txt) return [];
        const set = new Set();
        // Match: 4-letter ICAO + 3-letter IATA + whitespace + Y or N
        for (const [, icao] of txt.matchAll(/([A-Z]{4})[A-Z]{3}\s+[YN]/g)) {
          set.add(icao);
        }
        return [...set];
      }

      const apliAirports = parseApliAirports(apliText);

      // Merge all airport sources
      const allWxAirports = [...new Set([
        ...(ofpExtra.wxAirports || []),
        ...apliAirports,
      ])];

      // 組合回傳資料
      const result = {
        legId,
        flightNumber: `JX${parsed.flightNumber || flightNum}`,
        date: normDate,
        dep: parsed.dep,
        dest: parsed.dest,
        ofpNumber: parsed.ofpNumber,
        pic: parsed.pic || resolvedPic || null,   // PIC name from LIDO
        legKeys: parsed.legKeys || [],             // ← debug: available leg fields
        icaoFpl: atsText ? extractIcaoFpl(atsText) : null,  // 完整 (FPL-...) 區塊
        aircraft: parsed.aircraft,
        times: {
          std: parsed.std,
          sta: parsed.sta,
          etd: parsed.etd,
          eta: parsed.eta,
          stdLocal: ofpExtra.stdLocal,
          staLocal: ofpExtra.staLocal,
          ete: ofpExtra.ete,
        },
        fuel: parsed.fuel,
        weight: parsed.weight,
        flightRoute: parsed.flightRoute,
        atsRoute: atsText ? parseATSRoute(atsText) : parsed.flightRoute,
        availableDocs: Object.keys(parsed.fileIds),
        // OFP 文字解析補充
        ofp: { ...ofpExtra, flight: flightNum, dep: parsed.dep, dest: parsed.dest },
        wxAirports: allWxAirports,
        raw: {
          ofpPreview:  ofpText  ? ofpText.substring(0, 800)  : null,
          apliPreview: apliText ? apliText.substring(0, 800) : null,
        }
      };

      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /flights?sessionToken=...&date=YYYYMMDD — 返回當日所有航班清單（供前端班表顯示）
    if (url.pathname === '/flights' && request.method === 'GET') {
      const sessionToken = url.searchParams.get('sessionToken');
      const dateStr = url.searchParams.get('date') || new Date().toISOString().slice(0,10).replace(/-/g,'');
      if (!sessionToken) return new Response(JSON.stringify({ error: 'missing sessionToken' }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } });
      let session;
      try { session = JSON.parse(atob(sessionToken)); } catch(e) {
        return new Response(JSON.stringify({ error: 'bad token' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      const normDate = dateStr.replace(/-/g, '');
      const datePart = `${normDate.slice(0,4)}-${normDate.slice(4,6)}-${normDate.slice(6,8)}`;
      const listUrl = `${LIDO_API_BASE}/flightlist?startDateTime=${datePart}T00:00:00.000Z&endDateTime=${datePart}T23:59:59.000Z`;
      try {
        const listResp = await fetch(listUrl, { headers: buildLidoHeaders(session, 'GetFlightList') });
        if (listResp.status === 401) {
          return new Response(JSON.stringify({ error: 'session_expired' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        if (!listResp.ok) {
          return new Response(JSON.stringify({ error: `LIDO ${listResp.status}` }), { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        const listData = await listResp.json();
        const raw = Array.isArray(listData) ? listData : Object.values(listData);
        const flights = raw
          .filter(f => f.flightNumber || f.legId)   // skip empty/error rows
          .map(f => ({
            legId:  f.legId,
            flight: f.flightNumber,
            dep:    f.departureAirport,
            dest:   f.destinationAirport,
            std:    f.std,
            sta:    f.sta,
            status: f.briefingStatus,
          }))
          .sort((a, b) => (a.std || '').localeCompare(b.std || ''));
        return new Response(JSON.stringify(flights), { headers: { ...headers, 'Content-Type': 'application/json' } });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
    }

    // GET /debug/flightlist?sessionToken=...&flight=...&date=... — 查看飛行清單
    if (url.pathname === '/debug/flightlist') {
      const sessionToken = url.searchParams.get('sessionToken');
      const flightNum = url.searchParams.get('flight');
      const dateStr = url.searchParams.get('date') || new Date().toISOString().slice(0,10).replace(/-/g,'');
      if (!sessionToken) return new Response('missing sessionToken', { status: 400, headers });
      let session;
      try { session = JSON.parse(atob(sessionToken)); } catch(e) { return new Response('bad token', { status: 400, headers }); }

      const normDate = dateStr.replace(/-/g, '');
      const datePart = `${normDate.slice(0,4)}-${normDate.slice(4,6)}-${normDate.slice(6,8)}`;
      const listUrl = `${LIDO_API_BASE}/flightlist?startDateTime=${datePart}T00:00:00.000Z&endDateTime=${datePart}T23:59:59.000Z`;
      const listHdrs = buildLidoHeaders(session, 'GetFlightList');
      const listResp = await fetch(listUrl, { headers: listHdrs });
      const listData = await listResp.json();
      const flights = Array.isArray(listData) ? listData : Object.values(listData);
      const matching = flightNum ? flights.filter(f => f.flightNumber === String(flightNum)) : flights.slice(0, 5);
      return new Response(JSON.stringify({
        status: listResp.status,
        total: flights.length,
        matching: matching.map(f => ({ legId: f.legId, flightNumber: f.flightNumber, dep: f.departureAirport, dest: f.destinationAirport, std: f.std, briefingStatus: f.briefingStatus })),
      }), { headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    // GET /debug/login?userId=...&password=... — 回傳原始 DWR 回應供除錯
    if (url.pathname === '/debug/login') {
      const userId = url.searchParams.get('userId');
      const password = url.searchParams.get('password');
      if (!userId || !password) {
        return new Response('missing userId or password', { status: 400, headers });
      }
      const { lidoLas, serverid } = await getLidoSession();
      const scriptSessionId = generateUUID().replace(/-/g,'').toUpperCase().substring(0,16) +
        '/' + generateUUID().replace(/-/g,'').toUpperCase().substring(0,16);
      const dwrBody = [
        'callCount=1',
        'page=%2Flido%2Flas%2Flogin.jsp%3FDESMON_RESULT_PAGE%3Dhttps%253A%252F%252Fsjx.lido.aero%252Flido%252Fshell%252F%2523lcb%26DESMON_LANG%3Den',
        `httpSessionId=${lidoLas}`,
        `scriptSessionId=${encodeURIComponent(scriptSessionId)}`,
        'instanceId=0','batchId=0','c0-scriptName=LoginBean','c0-methodName=login','c0-id=0',
        `c0-param0=string:${userId}`,`c0-param1=string:${password}`,
        'c0-param2=string:','c0-param3=string:LIDO','c0-param4=string:en',
      ].join('\n');
      const dwrResp = await fetch('https://sjx.lido.aero/lido/las/dwr/call/plaincall/LoginBean.login.dwr', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Cookie': `lido_las=${lidoLas}; las_serverid=${serverid}` },
        body: dwrBody,
      });
      const rawText = await dwrResp.text();
      const setCookie = dwrResp.headers.get('set-cookie') || '';
      return new Response(JSON.stringify({
        httpStatus: dwrResp.status,
        setCookie,
        rawDwr: rawText,
        lidoLas, serverid,
      }), { headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    // GET /debug/briefing?sessionToken=...&legId=...
    if (url.pathname === '/debug/briefing') {
      const sessionToken = url.searchParams.get('sessionToken');
      const legId = url.searchParams.get('legId');
      if (!sessionToken || !legId) return new Response('missing params', { status: 400, headers });
      let session;
      try { session = JSON.parse(atob(sessionToken)); } catch(e) { return new Response('bad token', { status: 400, headers }); }

      // 若舊 session 沒有 csrfId/uid，重新解碼
      if (!session.csrfId && session.lidoCsrf) {
        const decoded = decodeLidoCsrf(session.lidoCsrf);
        session.csrfId = decoded.csrfId;
        session.uid = session.uid || decoded.uid;
      }
      if (!session.jwtPayload && session.lidoAuth) {
        session.jwtPayload = decodeJwtPayload(session.lidoAuth);
        session.businessId = session.businessId ||
          session.jwtPayload?.businessId || session.jwtPayload?.business_id ||
          session.jwtPayload?.customerId || session.uid;
      }

      const apiHeaders = buildLidoHeaders(session, 'GetBriefing');
      const testUrl = `https://sjx.lido.aero/lido/lcb/ui/${legId}/briefing`;

      const result = await fetch(testUrl, { headers: apiHeaders })
        .then(async r => ({ status: r.status, body: (await r.text()).substring(0, 500) }));

      return new Response(JSON.stringify({
        sessionDebug: {
          csrfId: session.csrfId,
          uid: session.uid,
          businessId: session.businessId,
          jwtPayload: session.jwtPayload,
          csrfRaw: session.lidoCsrf ? session.lidoCsrf.substring(0, 30) + '...' : null,
          authPrefix: session.lidoAuth ? session.lidoAuth.substring(0, 20) + '...' : null,
        },
        headersSent: {
          'X-lido-csrf': apiHeaders['X-lido-csrf'],
          'X-lido-auth': apiHeaders['X-lido-auth'],
          'X-lido-userId': apiHeaders['X-lido-userId'],
          'X-lido-businessId': apiHeaders['X-lido-businessId'],
          'X-lido-customerId': apiHeaders['X-lido-customerId'],
        },
        result,
      }), { headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    // GET /charts?sessionToken=...&flight=XXX&date=YYYYMMDD
    // 回傳所有圖表 metadata（category → [{fileId, label}]）
    if (url.pathname === '/charts' && request.method === 'GET') {
      const sessionToken = url.searchParams.get('sessionToken');
      const flightNum    = url.searchParams.get('flight');
      const dateStr      = url.searchParams.get('date');
      if (!sessionToken || !flightNum || !dateStr) {
        return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      let session;
      try { session = JSON.parse(atob(sessionToken)); } catch(e) {
        return new Response(JSON.stringify({ error: 'bad token' }), { status: 401, headers: { ...headers, 'Content-Type': 'application/json' } });
      }
      if (!session.csrfId && session.lidoCsrf) {
        const d2 = decodeLidoCsrf(session.lidoCsrf);
        session.csrfId = d2.csrfId; session.uid = session.uid || d2.uid;
      }
      if (!session.jwtPayload && session.lidoAuth) {
        session.jwtPayload = decodeJwtPayload(session.lidoAuth);
        session.businessId = session.businessId || session.jwtPayload?.businessId || session.jwtPayload?.business_id || session.uid;
      }

      const normDate = dateStr.replace(/-/g,'');
      const dep = url.searchParams.get('dep') || '';
      const dest = url.searchParams.get('dest') || '';
      const legId = url.searchParams.get('legId') ||
        `JX.${flightNum}.${normDate.slice(0,4)}${['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+normDate.slice(4,6)]}${normDate.slice(6,8)}.${dep}.${dest}.`;

      const briefingData = await fetchBriefingData(legId, buildLidoHeaders(session, 'GetBriefing'));
      const parsed = parseBriefingJson(briefingData);
      if (!parsed) return new Response(JSON.stringify({ error: 'no briefing' }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });

      // FL labels are now read directly from doc.fileName/doc.flightLevel in allDocs (no UADXML needed)

      // Chart categories and their display groups (CREWINFO/DISP/RAIM excluded — handled elsewhere)
      const CHART_GROUPS = [
        { group: 'UAD MAPS',          cats: ['UAD'] },
        { group: 'SIGWX WITH ROUTE',  cats: ['SIGWXROUTE'] },
        { group: 'OFFICIAL VAA/TCA',  cats: ['APTDXML','ASPDXML'] },
        { group: 'SIGNIFICANT WX',    cats: ['WXSIGWX'] },
        { group: 'VERTICAL PROFILE',  cats: ['VERTPROF'] },
      ];

      const uadDocs = parsed.allDocs?.UAD || [];
      const result = [];
      for (const { group, cats } of CHART_GROUPS) {
        const files = [];
        for (const cat of cats) {
          const docs = parsed.allDocs?.[cat] || [];
          for (const doc of docs) {
            let label;
            if (cat === 'UAD') {
              // Use fileName as primary source (most reliable)
              if (/MERGE/i.test(doc.fileName)) {
                label = 'MERGE';
              } else if (doc.flightLevel) {
                label = `FL${doc.flightLevel}`;
              } else {
                const fnMatch = doc.fileName.match(/FL(\d+)/i);
                label = fnMatch ? `FL${fnMatch[1]}` : `Chart ${doc.index + 1}`;
              }
            } else {
              label = (doc.label || '').trim();
              if (!label || label === String(doc.index)) {
                label = docs.length > 1 ? `${cat} ${doc.index + 1}` : cat;
              }
            }
            files.push({ cat, fileId: doc.fileId, label, index: doc.index });
          }
          // Sort UAD by FL ascending, MERGE last
          if (cat === 'UAD') {
            files.sort((a, b) => {
              if (a.label === 'MERGE') return 1;
              if (b.label === 'MERGE') return -1;
              return parseInt(a.label.replace('FL','')) - parseInt(b.label.replace('FL',''));
            });
          }
        }
        if (files.length) result.push({ group, files });
      }

      return new Response(JSON.stringify({ legId: parsed.legId, charts: result }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /chart?sessionToken=...&legId=...&cat=UAD&fileId=...
    // 代理 LIDO 圖片，回傳原始 binary（PNG / PDF）
    if (url.pathname === '/chart' && request.method === 'GET') {
      const sessionToken = url.searchParams.get('sessionToken');
      const legId        = url.searchParams.get('legId');
      const fileId       = url.searchParams.get('fileId');
      const cat          = url.searchParams.get('cat') || 'UAD';
      if (!sessionToken || !legId || !fileId) {
        return new Response('missing params', { status: 400, headers });
      }
      let session;
      try { session = JSON.parse(atob(sessionToken)); } catch(e) {
        return new Response('bad token', { status: 401, headers });
      }
      if (!session.csrfId && session.lidoCsrf) {
        const d2 = decodeLidoCsrf(session.lidoCsrf);
        session.csrfId = d2.csrfId; session.uid = session.uid || d2.uid;
      }
      if (!session.jwtPayload && session.lidoAuth) {
        session.jwtPayload = decodeJwtPayload(session.lidoAuth);
        session.businessId = session.businessId || session.jwtPayload?.businessId || session.jwtPayload?.business_id || session.uid;
      }

      const imgHeaders = buildLidoHeaders(session, `GetDoc${cat}`);
      const resp = await fetch(`${LIDO_API_BASE}/${legId}/briefing/${fileId}/docs`, {
        headers: { ...imgHeaders, Accept: 'image/*, application/pdf, text/plain, */*' }
      });
      if (!resp.ok) return new Response(`LIDO error ${resp.status}`, { status: resp.status, headers });

      const buf = await resp.arrayBuffer();
      const contentType = resp.headers.get('content-type') || 'application/octet-stream';
      return new Response(buf, {
        headers: {
          ...headers,
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
        }
      });
    }

    // GET /atis?icao=RCTP — 抓取 atis.guru D-ATIS 並解析回傳 JSON
    if (url.pathname === '/atis' && request.method === 'GET') {
      const icao = (url.searchParams.get('icao') || '').trim().toUpperCase();
      if (!icao || !/^[A-Z]{3,4}$/.test(icao)) {
        return new Response(JSON.stringify({ error: 'invalid ICAO' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      try {
        const resp = await fetch(`https://atis.guru/atis/${icao}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'text/html,*/*' }
        });
        if (!resp.ok) throw new Error(`atis.guru HTTP ${resp.status}`);
        const html = await resp.text();

        const titlePattern = /<h5[^>]*class="card-title"[^>]*>([\s\S]*?)<\/h5>/gi;
        const atisPattern  = /<div[^>]*class="atis"[^>]*>([\s\S]*?)<\/div>/gi;
        const titles = [], texts = [];
        let m;
        while ((m = titlePattern.exec(html)) !== null)
          titles.push(m[1].trim().replace(/<[^>]*>/g, '').trim());
        while ((m = atisPattern.exec(html)) !== null) {
          texts.push(m[1]
            .replace(/&#xA;/g, '\n').replace(/&#xD;/g, '').replace(/&#x9;/g, '  ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/<[^>]*>/g, '').trim());
        }

        const sections = texts.map((text, i) => ({
          title: titles[i] || (i === 0 ? 'ATIS' : `Info ${i + 1}`),
          text,
        }));

        return new Response(JSON.stringify({ icao, sections, fetchedAt: new Date().toISOString() }), {
          headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ icao, sections: [], error: e.message }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── ELB ──────────────────────────────────────────────────────────

    // POST /auth/elb — 代理 ELB HTTP 登入，回傳 session cookie 作為 token
    if (url.pathname === '/auth/elb' && request.method === 'POST') {
      const { userId, password } = await request.json();
      if (!userId || !password) {
        return new Response(JSON.stringify({ error: 'Missing credentials' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      try {
        const sessionCookie = await elbHttpLogin(userId, password);
        const token = btoa(JSON.stringify({ sessionCookie, userId, ts: Date.now() }));
        return new Response(JSON.stringify({ success: true, sessionToken: token, userId }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST /api/elb/query — 用 session token 向 ELB WS 查詢
    if (url.pathname === '/api/elb/query' && request.method === 'POST') {
      const { sessionToken, func: funcName, content } = await request.json();
      if (!sessionToken || !funcName) {
        return new Response(JSON.stringify({ error: 'Missing sessionToken or func' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      let session;
      try { session = JSON.parse(atob(sessionToken)); } catch {
        return new Response(JSON.stringify({ error: 'Invalid token' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      try {
        const result = await elbWSQuery(session.sessionCookie, funcName, content || {});
        return new Response(JSON.stringify({ ok: true, data: result }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/weather/metar?icao=RCTP — NOAA METAR+TAF proxy（免費，無需 API key）
    if (url.pathname === '/api/weather/metar' && request.method === 'GET') {
      const icao = (url.searchParams.get('icao') || '').trim().toUpperCase();
      if (!icao || !/^[A-Z]{3,4}$/.test(icao)) {
        return new Response(JSON.stringify({ error: 'invalid ICAO' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      try {
        const [mRes, tRes] = await Promise.all([
          fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=3`),
          fetch(`https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`),
        ]);
        const mData = mRes.ok ? await mRes.json() : [];
        const tData = tRes.ok ? await tRes.json() : [];
        const metar = Array.isArray(mData) && mData.length ? (mData[0]?.rawOb || null) : null;
        const taf   = Array.isArray(tData) && tData.length ? (tData[0]?.rawTAF || null) : null;
        return new Response(JSON.stringify({ icao, metar, taf, fetchedAt: new Date().toISOString() }), {
          headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── GET /api/gate?fno=JX725&date=2026-05-19 ─────────────────────
    // 不需要 airport 參數：自動查出航班起訖，TW 機場用 TDX，其他用 AeroDataBox
    // date = 起飛地本地出發日期（昨天/今天/明天），預設今天台灣時間
    if (url.pathname === '/api/gate' && request.method === 'GET') {
      const fno = (url.searchParams.get('fno') || '').trim().toUpperCase();
      if (!fno || !/^[A-Z]{2,3}\d{1,4}$/.test(fno)) {
        return new Response(JSON.stringify({ error: 'invalid_fno', message: '格式如 JX725' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      const dateParam  = url.searchParams.get('date');
      const todayTW    = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      const flightDate = dateParam || todayTW;
      const parsed     = _parseFno(fno);
      const TDX_TW     = ['TPE','KHH','RMQ','TSA','MZG','KNH','TNN','HUN','TTT','GNI','MFK','LZN','WOT','CMJ'];

      try {
        // Step 1：先用 AeroDataBox 取得完整航班（起訖機場 + 目的地 gate）
        const adbxRaw    = await _adbxFlight(env.RAPIDAPI_KEY, fno, flightDate);
        if (!adbxRaw) {
          return new Response(JSON.stringify({ error: 'not_found', fno, flightDate }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        const adbx       = _normalizeAdbx(adbxRaw);
        const depIata    = adbxRaw.departure?.airport?.iata || '';
        const arrIata    = adbxRaw.arrival?.airport?.iata   || '';

        // Step 2：若起訖機場有台灣機場，用 TDX 覆蓋（更即時、有 checkIn/belt）
        const needTdxDep = parsed && TDX_TW.includes(depIata);
        const needTdxArr = parsed && TDX_TW.includes(arrIata);

        let tdxDepData = null, tdxArrData = null;
        if (needTdxDep || needTdxArr) {
          const tdxToken = await _tdxGetToken(env);
          const [tdxDepList, tdxArrList] = await Promise.all([
            needTdxDep ? _tdxFIDS(tdxToken, depIata, 'Departure', parsed, flightDate) : [],
            needTdxArr ? _tdxFIDS(tdxToken, arrIata, 'Arrival',   parsed, flightDate) : [],
          ]);
          tdxDepData = tdxDepList[0] || null;
          tdxArrData = tdxArrList[0] || null;
        }

        // Step 3：合併，TDX 優先（TW 機場），AeroDataBox 補全球資料
        const finalDep = tdxDepData ? {
          airport:       depIata,
          terminal:      tdxDepData.Terminal     || null,
          gate:          tdxDepData.Gate         || null,
          checkIn:       tdxDepData.CheckCounter || null,
          scheduledTime: tdxDepData.ScheduleDepartureTime  || null,
          actualTime:    tdxDepData.ActualDepartureTime    || null,
          estimatedTime: tdxDepData.EstimatedDepartureTime || null,
          status:        tdxDepData.DepartureRemark        || null,
          source:        'TDX',
        } : adbx.departure ? { ...adbx.departure, source: 'AeroDataBox' } : null;

        let finalArr = tdxArrData ? {
          airport:       arrIata,
          terminal:      tdxArrData.Terminal     || null,
          gate:          tdxArrData.Gate         || null,
          belt:          tdxArrData.BaggageClaim || null,
          scheduledTime: tdxArrData.ScheduleArrivalTime  || null,
          actualTime:    tdxArrData.ActualArrivalTime    || null,
          estimatedTime: tdxArrData.EstimatedArrivalTime || null,
          status:        tdxArrData.ArrivalRemark        || null,
          source:        'TDX',
        } : adbx.arrival ? { ...adbx.arrival, source: 'AeroDataBox' } : null;

        // ── 如果 ARR gate 是 null，自動查回程航班的出發 gate（停機位）──────
        // 原理：JX870 → OKA (gate null) → 查 JX871 從 OKA 出發的 gate
        if (finalArr && !finalArr.gate && arrIata && parsed) {
          const fnoNum = parseInt(parsed.num, 10);
          const candidates = fnoNum % 2 === 0 ? [fnoNum + 1, fnoNum - 1] : [fnoNum - 1, fnoNum + 1];
          for (const delta of candidates) {
            if (delta <= 0) continue;
            const returnFno = `${parsed.airline}${delta}`;
            try {
              const returnRaw = await _adbxFlight(env.RAPIDAPI_KEY, returnFno, flightDate);
              if (returnRaw?.departure?.airport?.iata === arrIata && returnRaw?.departure?.gate) {
                finalArr = { ...finalArr, gate: returnRaw.departure.gate, gateVia: returnFno };
                break;
              }
              // 若同日查不到，試隔天（回程可能隔天）
              const nextDay = new Date(new Date(flightDate).getTime() + 86400000).toISOString().slice(0, 10);
              const returnRaw2 = await _adbxFlight(env.RAPIDAPI_KEY, returnFno, nextDay);
              if (returnRaw2?.departure?.airport?.iata === arrIata && returnRaw2?.departure?.gate) {
                finalArr = { ...finalArr, gate: returnRaw2.departure.gate, gateVia: returnFno };
                break;
              }
            } catch { /* 回程查詢失敗不影響主流程 */ }
          }
        }

        return new Response(JSON.stringify({
          fno, flightDate,
          departure:   finalDep,
          arrival:     finalArr,
          aircraft:    adbx.aircraft,
          acType:      adbx.acType,
          aircraftHex: adbx.aircraftHex,
          lastUpdated: adbx.lastUpdated,
          fetchedAt:   new Date().toISOString(),
        }), {
          headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, fno }), {
          status: 502, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Notices: GET /api/notices ─────────────────────────────────────
    if (url.pathname === '/api/notices' && request.method === 'GET') {
      const notices = await _noticesGet(env);
      return new Response(JSON.stringify(notices), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // ── Notices: /api/notices/debug — 接力診斷端點 ─────────────────────
    if (url.pathname === '/api/notices/debug') {
      const authVal = (request.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '').trim() || (url.searchParams.get('token') || '');
      if (!env.UPLOAD_TOKEN || authVal !== env.UPLOAD_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      // GET：查詢最近一次 debug 紀錄（Mac 端輪詢用）
      if (request.method === 'GET') {
        const stored = env.NOTICES_KV ? await env.NOTICES_KV.get('debug_last') : null;
        return new Response(stored || JSON.stringify({ error: 'no debug record yet' }), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      // POST：收到 iOS 捷徑的請求，記錄並回傳
      if (request.method === 'POST') {
        const hdrs = {};
        for (const [k, v] of request.headers.entries()) hdrs[k] = v;
        let body = null;
        try { body = await request.text(); } catch(e) { body = `[read error: ${e.message}]`; }
        const tag = url.searchParams.get('tag') || 'unknown';
        const queryParams = {};
        for (const [k, v] of url.searchParams.entries()) queryParams[k] = v;
        const record = {
          tag,
          ts: new Date().toISOString(),
          contentType: request.headers.get('content-type'),
          bodyLength: body ? body.length : 0,
          bodyPreview: body ? body.substring(0, 800) : null,
          queryParams,
          headers: hdrs,
        };
        if (env.NOTICES_KV) await env.NOTICES_KV.put('debug_last', JSON.stringify(record));
        return new Response(JSON.stringify(record, null, 2), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Notices: POST /api/notices/upload ─────────────────────────────
    if (url.pathname === '/api/notices/upload' && request.method === 'POST') {
      // Token guard
      const authVal = (request.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '').trim() || (url.searchParams.get('token') || '');
      if (!env.UPLOAD_TOKEN || authVal !== env.UPLOAD_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      const ct = request.headers.get('Content-Type') || '';
      const parts = [];   // Gemini content parts
      let   sourceHint = '';
      let   dateOverride = null;  // 可選：覆蓋 Gemini 提取的 effective_date

      // ── iOS Shortcuts 最可靠的傳送方式：X-Notice-Text header ──────────
      // magic variable 在 iOS Shortcuts header 值裡可正確解析
      // source / date 從 URL query params 取得
      const noticeHeader = request.headers.get('x-notice-text');
      if (noticeHeader && noticeHeader.trim()) {
        sourceHint   = url.searchParams.get('source') || '分享';
        dateOverride = url.searchParams.get('date')   || null;
        parts.push({ text: `來源提示: ${sourceHint}\n\n公告內容:\n${noticeHeader}` });
        // 有 header 就直接跳過 body 解析
      } else if (ct.includes('multipart/form-data')) {
        const fd   = await request.formData();
        const file = fd.get('file');
        const txt  = fd.get('text');
        sourceHint  = fd.get('source') || '';
        dateOverride = fd.get('date') || null;
        if (file && file instanceof File) {
          // text/plain → Gemini 用文字模式；其他（PDF/image）→ inline_data
          if (file.type === 'text/plain' || file.type === '') {
            const textContent = await file.text();
            if (textContent.trim()) parts.push({ text: `來源提示: ${sourceHint}\n\n公告內容:\n${textContent}` });
          } else {
            const buf  = await file.arrayBuffer();
            const b64  = _buf2b64(buf);
            const mime = file.type || 'application/octet-stream';
            parts.push({ inline_data: { mime_type: mime, data: b64 } });
          }
        } else if (file && typeof file === 'string' && file.trim()) {
          // Shortcuts 傳文字時 file 欄位可能是純字串
          parts.push({ text: `來源提示: ${sourceHint}\n\n公告內容:\n${file}` });
        }
        if (txt) parts.push({ text: `來源提示: ${sourceHint}\n\n公告內容:\n${txt}` });
      } else if (ct.includes('application/json') || !ct) {
        let body = {};
        try {
          const raw = await request.text();
          if (raw && raw.trim()) body = JSON.parse(raw);
        } catch (parseErr) {
          return new Response(JSON.stringify({
            error: 'JSON 解析失敗：Body 可能為空。\n請改用截圖或複製文字後以「上傳公告（剪貼簿）」捷徑上傳。'
          }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        sourceHint  = body.source || body.src || '';
        dateOverride = _normalizeDate(url.searchParams.get('date') || body.date);
        // 過濾靜態前綴後取得實際內容
        const rawText = (body.text || '').replace(/^__KBUPLOAD__\n?/, '').trim();
        if (rawText)           parts.push({ text: `來源提示: ${sourceHint}\n\n公告內容:\n${rawText}` });
        if (body.image_base64) parts.push({ inline_data: { mime_type: body.mime_type || 'image/jpeg', data: body.image_base64 } });
        if (body.pdf_base64)   parts.push({ inline_data: { mime_type: 'application/pdf', data: body.pdf_base64 } });
        // Mac Shortcuts 捷徑傳入：body.b64 = base64 of any file（自動偵測 MIME）
        if (body.b64) {
          const b64clean = body.b64.replace(/\s/g, '');
          const mime = _detectMimeFromB64(b64clean);
          if (mime.startsWith('text/')) {
            const decoded = atob(b64clean);
            if (decoded.trim()) parts.push({ text: `來源提示: ${sourceHint}\n\n公告內容:\n${decoded}` });
          } else {
            parts.push({ inline_data: { mime_type: mime, data: b64clean } });
          }
        }
      } else {
        // iOS Shortcuts 'Form' body type 傳原始檔案時，Content-Type 為檔案本身的 MIME type
        // 例如：application/pdf、image/jpeg、text/plain
        // source / date 從 URL query params 取得
        sourceHint  = url.searchParams.get('source') || '分享';
        dateOverride = url.searchParams.get('date')  || null;

        if (ct.startsWith('text/')) {
          // 純文字 / HTML（剪貼簿文字、Teams 複製分享）
          const text = await request.text();
          if (text.trim()) parts.push({ text: `來源提示: ${sourceHint}\n\n公告內容:\n${text}` });
        } else {
          // 二進位：PDF、圖片、通用檔案
          const buf  = await request.arrayBuffer();
          if (buf.byteLength > 0) {
            const b64  = _buf2b64(buf);
            const mime = ct.split(';')[0].trim() || 'application/octet-stream';
            parts.push({ inline_data: { mime_type: mime, data: b64 } });
          }
        }
      }

      if (!parts.length) {
        return new Response(JSON.stringify({ error: 'No content provided' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      const isBatch = url.searchParams.get('batch') === 'true';
      const srcType = parts.some(p => p.inline_data?.mime_type?.includes('pdf'))   ? 'pdf'
                    : parts.some(p => p.inline_data?.mime_type?.includes('image')) ? 'image'
                    : 'text';

      if (isBatch) {
        const analyzedList = await _geminiAnalyzeBatch(env.GEMINI_API_KEY, parts);
        const now = new Date().toISOString();
        const list = await _noticesGet(env);
        const newNotices = analyzedList
          .map(a => ({ id: generateUUID(), created_at: now, source_type: srcType, ...a }))
          .filter(n => !_isDuplicate(n, list));
        const merged = [...newNotices, ...list].slice(0, 200);
        await _noticesSet(env, merged);
        return new Response(JSON.stringify({ ok: true, count: newNotices.length, skipped: analyzedList.length - newNotices.length }), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      const analyzed = await _geminiAnalyze(env.GEMINI_API_KEY, parts);
      const rawTextForStorage = parts.find(p => p.text && p.text.includes('公告內容:'))?.text?.split('公告內容:\n')[1] || '';

      const notice = {
        id:          generateUUID(),
        created_at:  new Date().toISOString(),
        source_type: srcType,
        raw_text:    rawTextForStorage.slice(0, 3000),
        ...analyzed,
        issue_date:     _normalizeDate(analyzed.issue_date)     || null,
        effective_date: _normalizeDate(analyzed.effective_date) || null,
        summary:        _cleanMelCodes(analyzed.summary),
        ...(dateOverride ? { issue_date: dateOverride, effective_date: dateOverride } : {}),
      };

      const list = await _noticesGet(env);
      const dupFp = _noticeFingerprint(notice);
      const dupIdx = list.findIndex(e => _noticeFingerprint(e) === dupFp);
      if (dupIdx !== -1) {
        // 重複時用新分析結果覆蓋（保留原 id 與 created_at）
        notice.id         = list[dupIdx].id;
        notice.created_at = list[dupIdx].created_at;
        list[dupIdx] = notice;
      } else {
        list.unshift(notice);
      }
      await _noticesSet(env, list.slice(0, 200));

      return new Response(JSON.stringify({ ok: true, updated: dupIdx !== -1, notice_id: notice.id, notice_issue_date: notice.issue_date || null, notice }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // ── Notices: POST /api/notices/dedup (去重現有公告) ─────────────
    if (url.pathname === '/api/notices/dedup' && request.method === 'POST') {
      const authVal = (request.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '').trim() || (url.searchParams.get('token') || '');
      if (!env.UPLOAD_TOKEN || authVal !== env.UPLOAD_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      const list = await _noticesGet(env);
      const seen = new Set();
      const deduped = list.filter(n => {
        const fp = _noticeFingerprint(n);
        if (seen.has(fp)) return false;
        seen.add(fp);
        return true;
      });
      await _noticesSet(env, deduped);
      return new Response(JSON.stringify({ ok: true, before: list.length, after: deduped.length, removed: list.length - deduped.length }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // ── Notices: DELETE /api/notices (清空全部) ──────────────────────
    if (url.pathname === '/api/notices' && request.method === 'DELETE') {
      const authVal = (request.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '').trim() || (url.searchParams.get('token') || '');
      if (!env.UPLOAD_TOKEN || authVal !== env.UPLOAD_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      await _noticesSet(env, []);
      return new Response(JSON.stringify({ ok: true, message: '已清空所有公告' }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // ── Notices: PATCH /api/notices/:id ──────────────────────────────
    if (url.pathname.startsWith('/api/notices/') && request.method === 'PATCH') {
      const authVal = (request.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '').trim() || (url.searchParams.get('token') || '');
      if (!env.UPLOAD_TOKEN || authVal !== env.UPLOAD_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      const targetId = url.pathname.split('/').pop();
      const patch    = await request.json();
      // 忽略空字串，避免覆蓋 Gemini 已判讀的值
      if (patch.issue_date === '' || patch.issue_date === null) delete patch.issue_date;
      if (patch.effective_date === '' || patch.effective_date === null) delete patch.effective_date;
      const list     = await _noticesGet(env);
      const idx      = list.findIndex(n => n.id === targetId);
      if (idx === -1) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      list[idx] = { ...list[idx], ...patch };
      await _noticesSet(env, list);
      return new Response(JSON.stringify({ ok: true, notice: list[idx] }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // ── Notices: DELETE /api/notices/:id ──────────────────────────────
    if (url.pathname.startsWith('/api/notices/') && request.method === 'DELETE') {
      const authVal = (request.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '').trim() || (url.searchParams.get('token') || '');
      if (!env.UPLOAD_TOKEN || authVal !== env.UPLOAD_TOKEN) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      const targetId = url.pathname.split('/').pop();
      const list     = await _noticesGet(env);
      await _noticesSet(env, list.filter(n => n.id !== targetId));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found', routes: ['/auth/login', '/api/briefing'] }), {
      status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Worker error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

export default {
  fetch: handleRequest,
};
