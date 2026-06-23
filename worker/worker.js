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

// 將使用者在捷徑選單選的來源（Teams/Outlook/Line/FN 公告/其他…）映射成合法 source_tag。
// 用關鍵字「包含」比對而非精確比對，容忍中文變體標籤；
// 「其他/分享」或無法判斷時回傳 null，讓 Gemini 自行判斷。
function _mapSourceHint(hint) {
  const h = (hint || '').toLowerCase().trim();
  if (!h || h === '其他' || h === 'other' || h === '分享') return null;
  if (/outlook|e-?mail|\bmail\b|aviobook/.test(h))          return 'email';
  if (/teams|line|訊息|message|\bmsg\b|chat/.test(h))        return 'message';
  if (/\bfn\b|fleet|fts|gtsm|公告|notice/.test(h))           return 'fleet_notice';
  return null;
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
  "source": "來源編號或管道，如 FN-26-0053、Teams、Outlook、FCTM 修訂等。【重要】FN 公告只填編號本身（如 FN-26-0053），不加「Fleet Notice」前綴",
  "source_tag": "【必填，只能是以下三個值之一】fleet_notice 或 message 或 email。來源類型：FN-XX-XXXX 正式文件、FTS/GTSM 等內部官方通知 → fleet_notice；Teams/Line 訊息 → message；Outlook/Email/Aviobook → email。注意：不可填入 app_notice，那是 tags 的值",
  "tags": ["ops/safety/manual_update/admin/app_notice 中一或多個內容標籤（ops：飛行操作/計畫/地面作業；safety：安全警示；manual_update：手冊程序修訂；admin：行政/人事；app_notice：App 版本更新）"],
  "aircraft": ["A321","A330","A350","all"] 中適用的機型陣列，全機隊填 ["all"],
  "urgency": "urgent 或 important 或 normal",
  "summary": ["每條重點須包含技術關鍵詞與數值（80-100字）；manual_update 類別每條修訂獨立列項，有幾條列幾條，不限數量；同一章節有複數關鍵變更時拆分為多條"],
  "action_required": "飛行員需執行的具體動作，若無填 null"
}
注意：
- 【輸出語言：繁體中文】title、summary、action_required 一律以繁體中文書寫。即使來源文件全為英文（如 PAM/FOM 英文修訂通知），也必須翻譯成繁體中文，不得直接照抄原文英文句子；僅保留下方「術語保留原文」清單中的縮寫與專有名詞為英文
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
  機組職稱：PIC、SIC、FO、SFO、PF、PM、Cabin Crew、FA、OCC、Dispatch
- 【條文邏輯保真】法規、處分、休假、資格、限制等條文：必須忠實保留原文的條件邏輯，嚴禁把「觸發條件」改寫成「強制規定」。例如原文「於起飛前 12 小時內申請的休假需檢附證明」是『條件→要求』，不可翻成「休假必須於起飛前 12 小時內提出」（那是相反的強制規定）。原文用「若/當…則…」「any of the following circumstances」「shall」等條件句時，輸出也要維持「若…則需…」結構；多個條件分開列，不要壓縮成單句而失真
- 【用詞對照，勿譯錯】supporting documents/documentation → 證明文件（不可譯為「支援文件」）；departure → 起飛（非「執勤時間」）；scheduled duty → 排定勤務；standby duty → 待命勤務；assigned duty → 指派勤務；sick leave → 病假；personal leave → 事假；annual leave → 特休；medical certificate → 醫療/診斷證明；disciplinary action → 懲處/紀律處分
- 【寧長勿失真】重要條文逐項完整陳述，寧可摘要長一點，也不要為了精簡而漏掉條件、數值或對象
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
【輸出語言：繁體中文】title、summary、action_required 一律以繁體中文書寫；即使來源全為英文也須翻譯，不得照抄英文句子，僅保留下方清單中的術語為英文。
【術語保留原文】以下縮寫一律保留英文：RNP AR、RVSM、ETOPS、CAT I/II/III、SID、STAR、ILS、LOC、DA、MDA、RWYCC、MEL、CDL、FOM、FCOM、QRH、EFB、OFP、LIDO、RWY、NOTAM、ATIS、TCAS、RA、TA、GPWS、EGPWS、APU、GPU、FMS、MCDU、METAR、TAF、SIGMET、AIRMET、PIREP、PIC、SIC、FO、SFO、PF、PM、OCC、Dispatch。
只輸出 JSON 陣列。`;

async function _geminiAnalyzeBatch(apiKey, contentParts) {
  if (!apiKey) throw new Error('GEMINI_API_KEY 尚未設定');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [...contentParts, { text: _NOTICE_PROMPT }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
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

// ── Claude（Anthropic 官方 API）：多模態公告分析 ──────────────────────
// Gemini parts（text / inline_data 圖片/PDF）→ Claude content blocks
function _partsToClaudeContent(parts) {
  return parts.map(p => {
    if (p.text != null) return { type: 'text', text: p.text };
    if (p.inline_data) {
      const { mime_type, data } = p.inline_data;
      if (mime_type === 'application/pdf') {
        return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
      }
      return { type: 'image', source: { type: 'base64', media_type: mime_type, data } };
    }
    return null;
  }).filter(Boolean);
}

async function _claudeAnalyze(apiKey, parts, systemPrompt, maxTokens, expectArray) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: _partsToClaudeContent(parts) }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Claude ${resp.status}: ${err.substring(0, 200)}`);
  }
  const data = await resp.json();
  if (data.stop_reason === 'refusal') throw new Error('Claude 安全分類器拒絕回應');
  const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || (expectArray ? '[]' : '{}');
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
  const result = JSON.parse(clean);
  return expectArray ? (Array.isArray(result) ? result : [result]) : result;
}

// 統一入口：有 ANTHROPIC_API_KEY 用 Claude（失敗退回 Gemini）；否則 Gemini
async function _aiAnalyzeBatch(env, parts) {
  if (env.ANTHROPIC_API_KEY) {
    try { return await _claudeAnalyze(env.ANTHROPIC_API_KEY, parts, _BATCH_NOTICE_PROMPT, 8192, true); }
    catch (e) { if (env.GEMINI_API_KEY) { console.error('Claude 失敗退回 Gemini：', e.message); return await _geminiAnalyzeBatch(env.GEMINI_API_KEY, parts); } throw e; }
  }
  return _geminiAnalyzeBatch(env.GEMINI_API_KEY, parts);
}

async function _aiAnalyze(env, parts) {
  if (env.ANTHROPIC_API_KEY) {
    try { return await _claudeAnalyze(env.ANTHROPIC_API_KEY, parts, _NOTICE_PROMPT, 2048, false); }
    catch (e) { if (env.GEMINI_API_KEY) { console.error('Claude 失敗退回 Gemini：', e.message); return await _geminiAnalyze(env.GEMINI_API_KEY, parts); } throw e; }
  }
  return _geminiAnalyze(env.GEMINI_API_KEY, parts);
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

async function elbHttpLogin() {
  // ELB 的 SPA 首頁 cookie（JSESSIONID）本身即可通過 WebSocket 驗證，
  // 無需帳號密碼。直接取首頁 cookie → 驗證 WebSocket。
  const pageResp = await fetch(`${ELB_BASE}/elb/`, {
    headers: { 'User-Agent': ELB_UA, 'Accept': 'text/html,*/*' },
    redirect: 'follow',
  });
  const sessionCookie = collectSetCookies(pageResp);
  if (!sessionCookie) throw new Error('ELB 無法取得 session cookie');

  const wsResp = await fetch(ELB_WS, {
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      Cookie: sessionCookie,
      'User-Agent': ELB_UA,
    },
  });
  if (wsResp.status !== 101) throw new Error(`ELB WebSocket 驗證失敗 (HTTP ${wsResp.status})`);
  wsResp.webSocket?.accept();
  wsResp.webSocket?.close(1000, 'auth validation');
  return sessionCookie;
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

  // MAX SHEAR — format: "MXSH XX/WAYPTNAME" in fuel summary block
  // ATGO for that waypoint is the 4-digit time at end of line 2 of its waypoint block
  m = txt.match(/MXSH\s+(\d+)\/([A-Z][A-Z0-9]{1,4})/);
  if (m) {
    r.maxShearCode = m[1];  // e.g. "06"
    r.maxShearWpt  = m[2];  // e.g. "NANNO"
    // Find the waypoint block and extract ATGO (4-digit time at end of line 2)
    // Waypoint block structure:
    //   LINE1: WAYPTNAME  FL  WIND/SPD  [MACH]  TAS  GS  FUEL  .....  DIST
    //   LINE2: AIRWAY     NM  M_TEMP    ...               ATGO (4 digits at end)
    const atgoRe = new RegExp('^' + m[2] + '[ \\t][^\\n]+\\n[^\\n]*(\\d{4})[ \\t]*(?:\\n|$)', 'm');
    const atgoM = txt.match(atgoRe);
    if (atgoM) {
      const raw = atgoM[1]; // e.g. "0925"
      r.maxShearTime = raw.slice(0, 2) + ':' + raw.slice(2, 4); // "09:25"
    }
  }

  // T_O_C Cruise Temperature — temperature of the first waypoint AFTER T_O_C
  // Each waypoint block line 2 has: AIRWAY  NM  M{temp}[/NN]  ...  ATGO
  // M47 = -47°C, M43 = -43°C, etc.
  // Structure: T_O_C block (3 lines) + optional blank + next waypoint (line1 + line2)
  const tocIdx = txt.search(/^T_O_C[ \t]/m);
  if (tocIdx >= 0) {
    const sub = txt.slice(tocIdx);
    // Skip T_O_C: line1 + line2 + coord line, then optional blank lines, then next waypoint line1 + line2
    const tocTempM = sub.match(
      /^T_O_C[^\n]+\n[^\n]+\n[^\n]+\n[\s\S]*?^([A-Z]{2,5})[ \t][^\n]+\n[^\n]*(M\d{2,3})/m
    );
    if (tocTempM) {
      r.tocNextWpt  = tocTempM[1]; // "ALCOA"
      r.cruiseTempRaw = tocTempM[2]; // "M47"
      r.cruiseTemp  = `-${tocTempM[2].slice(1)}°C`; // "-47°C"
    }
  }

  return r;
}

// ── OFP 航路點座標解析 ────────────────────────────────────────────────
// LIDO OFP 每個航路點區塊的第二行為座標行，格式：N250639E1213154 或 N2506E12123
// 掃描 OFP 文字中所有「行首以 N/S 開頭＋數字＋E/W＋數字」的行，依序回傳 [lat, lon]
function parseOFPWaypoints(txt) {
  if (!txt) return [];
  const pts = [];
  // LIDO NAVIGATION LOG 座標行格式：N3355.9 W11827.5（中間有空格，DDMM.M / DDDMM.M）
  const re = /^([NS])(\d{4,6}(?:\.\d+)?)\s*([EW])(\d{5,7}(?:\.\d+)?)\b/mg;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const lat = _ofpCoord(m[2], m[1]);
    const lon = _ofpCoord(m[4], m[3]);
    if (lat != null && lon != null) pts.push([+lat.toFixed(4), +lon.toFixed(4)]);
  }
  return pts;
}

function _ofpCoord(val, dir) {
  const dot = val.indexOf('.');
  const int = dot >= 0 ? val.slice(0, dot) : val;
  const frac = dot >= 0 ? val.slice(dot) : '';
  const len = int.length;
  let deg, min, sec = 0;
  if (len === 4 || len === 5) {         // DDMM or DDDMM
    deg = +int.slice(0, len - 2);
    min = parseFloat(int.slice(len - 2) + frac);
  } else if (len === 6 || len === 7) {  // DDMMSS or DDDMMSS
    deg = +int.slice(0, len - 4);
    min = +int.slice(len - 4, len - 2);
    sec = parseFloat(int.slice(len - 2) + frac);
  } else return null;
  let r = deg + min / 60 + sec / 3600;
  if (dir === 'S' || dir === 'W') r = -r;
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

// ── PegaSys proxy helpers ─────────────────────────────────────────

const PEGASYS_BASE      = 'https://jxcrew.starlux-airlines.com';
const PEGASYS_LOGIN_URL = `${PEGASYS_BASE}/jxcrew/auth/crew/login`;
// CF Workers fetch() 需要 https:// 而非 wss://，平台會自動處理 WS upgrade
const PEGASYS_WS_URL    = 'https://jxcrew.starlux-airlines.com/jxcrew/api';
const PEGASYS_WS_PROTO  = 'pghz_v1';

function _uuid4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function _jwtExpiry(token) {
  try {
    const seg = token.split('.')[1];
    const pad = '='.repeat((4 - seg.length % 4) % 4);
    return JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/') + pad)).exp || 0;
  } catch { return 0; }
}

async function _pegasysLogin(employeeId, password) {
  const resp = await fetch(PEGASYS_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: employeeId, password, nonce: _uuid4() }),
  });
  if (resp.status === 401) { const e = new Error('invalid_credentials'); e.httpStatus = 401; throw e; }
  if (resp.status === 400) { const e = new Error('bad_request');          e.httpStatus = 400; throw e; }
  if (!resp.ok)            { const e = new Error(`login_error_${resp.status}`); e.httpStatus = 502; throw e; }

  const body = (await resp.text()).trim();

  // Case 1: plain JWT string
  if (body.startsWith('eyJ')) return body;

  // Case 2: JSON object containing the token
  try {
    const json = JSON.parse(body);
    const token = json.token || json.access_token || json.accessToken
                || json.jwt  || json.id_token     || json.idToken;
    if (token && typeof token === 'string' && token.startsWith('eyJ')) return token;
  } catch (_) {}

  // Neither — surface the actual body for debugging
  const preview = body.slice(0, 120).replace(/[\r\n]/g, ' ');
  const e = new Error(`login_no_token: ${preview}`);
  e.httpStatus = 502;
  throw e;
}

// ─── PegaSys WebSocket roster fetch ──────────────────────────────
// 連線流程（逆向工程確認）：
//   URL:      wss://jxcrew.starlux-airlines.com/jxcrew/api
//   Protocol: pghz_v1  (Sec-WebSocket-Protocol)
//   1. WS 建立後發送 ReqLogin（Name=員工編號, Password=JWT）
//   2. 收到 RpyLogin → 取得 ClientGuid + StaffId（在 Attrs.IntAttributes）
//   3. 發送 ReqStaffMemberRosterSummaryById（StaffId, 起訖日期）
//   4. 收到 RpyStaffMemberRosterSummary → 班表資料
//
// Cloudflare Workers 使用 fetch Upgrade:websocket 作為 WebSocket client。

// JWT payload 解碼（不驗證簽章，只取 claims）
function _jwtPayload(token) {
  try {
    const seg = token.split('.')[1];
    const pad = '='.repeat((4 - seg.length % 4) % 4);
    return JSON.parse(atob(seg.replace(/-/g, '+').replace(/_/g, '/') + pad));
  } catch { return {}; }
}

async function _pegasysWsRoster(jwt, employeeId, crewOpts = {}) {
  // crewOpts: { field: 'ActivityId', idType: 'activityId'|'recordNo' }
  // 實測（逆向 PegaSys SPA 真實 frame）：{ ClientGuid, ActivityId:<string> }
  const crewField  = crewOpts.field  || 'ActivityId';
  const crewIdType = crewOpts.idType || 'activityId';

  // ── JWT 中取 StaffId（避免依賴 RpyLogin Attrs）───────────────
  const jwtClaims = _jwtPayload(jwt);
  // Sabre Horizon 常見欄位：EmployeeRecNo, StaffRecNo, staffId, userId, sub...
  const jwtStaffId = jwtClaims.EmployeeRecNo ?? jwtClaims.StaffRecNo
                  ?? jwtClaims.staffId       ?? jwtClaims.staff_id
                  ?? jwtClaims.userId        ?? jwtClaims.user_id
                  ?? null;

  // ── 建立 WS 連線 ──────────────────────────────────────────────
  const wsResp = await fetch(PEGASYS_WS_URL, {
    headers: {
      'Upgrade':                  'websocket',
      'Connection':               'Upgrade',
      'Sec-WebSocket-Protocol':   PEGASYS_WS_PROTO,
      'Origin':                   PEGASYS_BASE,
      'User-Agent':               'Mozilla/5.0 (compatible; JXCF-Worker/1.0)',
    },
  });

  if (wsResp.status !== 101) {
    const body = await wsResp.text().catch(() => '');
    throw new Error(`ws_upgrade_failed: HTTP ${wsResp.status} — ${body.slice(0, 120)}`);
  }

  const ws = wsResp.webSocket;
  if (!ws) throw new Error('ws_upgrade_no_websocket');
  ws.accept();

  // ── 訊息與資料收集 ────────────────────────────────────────────
  // 逆向工程確認：login 後伺服器自動推送完整資料，不需額外請求
  // 包含：RpyRosterAllocationList / RpyActivityList / RpyStaffMemberList 等
  let   reqNo      = 1;
  let   clientGuid = _uuid4();
  const allMsgs    = [];           // 收到的全部訊息（含完整資料）
  let   loginError = null;

  const _mkBase = (name, extras) => JSON.stringify({
    SkyNet_MsgName: name,
    SenderId:  0,
    RequestNo: reqNo++,
    ...extras,
  });

  // ── 送出 ReqLogin ─────────────────────────────────────────────
  ws.send(_mkBase('ReqLogin', {
    ClientGuid: clientGuid,
    Name:       String(employeeId),
    Password:   jwt,
    Attrs: {
      BoolAttributes:      [{ Key: 'JWT_TOKEN',   SequenceNumber: null, Value: true }],
      StringAttributes:    [{ Key: 'LOGIN_TYPE',  SequenceNumber: null, Value: 'Crew' }],
      DateAttributes:      [], DateRangeAttributes: [], DatetimeAttributes:  [],
      DurationAttributes:  [], IntAttributes:       [], IntRangeAttributes:  [],
      FloatAttributes:     [],
    },
  }));

  // ── 等待訊息（settle-timer 策略）─────────────────────────────
  // 最後一條訊息到達後等 SETTLE_MS，確認初始推送結束
  // 或 HARD_MS 硬超時
  return new Promise((resolve, reject) => {
    const HARD_MS   = 45000;   // 序列化 crew 抓取（最多 ~19 班 × ack）需較長上限
    const SETTLE_MS = 2000;
    let hardTimer   = null;
    let settleTimer = null;
    let resolved    = false;

    // ── Crew 階段狀態 ───────────────────────────────────────────
    // 初始推送 settle 後，「逐一」對每個 Pairing 送 ReqCrewListForActivity。
    // crew 名單其實以 RpyStaffMemberList(N) 形式回推（RpyCrewListForActivity 僅是 ack，無資料）。
    // 因為回推訊息不帶 ActivityId，必須序列化（一次一個）才能把 staff burst 正確對應到航班。
    let   crewPhaseStarted = false;
    let   expectedCrew     = 0;
    const crewPhaseTrace   = [];   // 除錯用
    let   crewPhaseActive  = false;
    let   rosterSeen       = false;
    let   notifSeen        = false;
    let   crewStartTimer   = null;

    let   crewTargets      = [];   // [{ activityId, recordNo }]
    let   crewIdx          = 0;
    let   crewCurStaff     = [];   // 當前請求湧入的 staff（累積到收到 ack）
    let   crewReqTimer     = null; // 單一請求逾時
    const crewByActivity   = {};   // activityId → [staff...]

    const _sendCrewReq = () => {
      if (crewIdx >= crewTargets.length) { finalize('crew_done'); return; }
      crewCurStaff = [];
      const t = crewTargets[crewIdx];
      const idVal = crewIdType === 'recordNo' ? t.recordNo : t.activityId;
      ws.send(_mkBase('ReqCrewListForActivity', { ClientGuid: clientGuid, [crewField]: idVal }));
      // 單一請求逾時（沒收到 ack 也前進，避免卡死）
      clearTimeout(crewReqTimer);
      crewReqTimer = setTimeout(() => _advanceCrew(), 2500);
    };

    const _advanceCrew = () => {
      clearTimeout(crewReqTimer);
      const t = crewTargets[crewIdx];
      if (t) crewByActivity[t.activityId] = crewCurStaff.slice();
      crewIdx++;
      _sendCrewReq();
    };

    const startCrewPhase = () => {
      if (crewPhaseStarted) return;
      crewPhaseStarted = true;
      crewPhaseActive  = true;

      const rAllocs = allMsgs
        .filter(m => m.SkyNet_MsgName === 'RpyRosterAllocationList')
        .flatMap(m => m.DataList || []);
      const activities = allMsgs
        .filter(m => m.SkyNet_MsgName === 'RpyActivityList')
        .flatMap(m => m.DataList || []);
      const recNoByActId = {};
      for (const a of activities) if (a.ActivityId) recNoByActId[a.ActivityId] = a.RecordNo;

      const seen = new Set();
      for (const a of rAllocs) {
        if (_getStrAttr(a.Attrs, 'ACTIVITY_TYPE') !== 'Pairing') continue;
        if (!a.ActivityId || seen.has(a.ActivityId)) continue;
        seen.add(a.ActivityId);
        crewTargets.push({ activityId: a.ActivityId, recordNo: recNoByActId[a.ActivityId] });
      }

      if (!crewTargets.length) { finalize('no_pairings_for_crew'); return; }

      expectedCrew = crewTargets.length;
      _sendCrewReq();  // 序列化：發第一個，收到 ack 再發下一個
    };

    const finalize = (reason) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(hardTimer);
      clearTimeout(settleTimer);
      clearTimeout(crewStartTimer);
      clearTimeout(crewReqTimer);
      try { ws.close(1000, 'done'); } catch (_) {}

      // 從收到的訊息中提取關鍵資料
      const find = (name) => allMsgs.filter(m => m.SkyNet_MsgName === name);

      const rosterAllocMsgs = find('RpyRosterAllocationList');
      const activityMsgs    = find('RpyActivityList');
      const staffMemberMsgs = find('RpyStaffMemberList');

      const rosterAllocs = rosterAllocMsgs.flatMap(m => m.DataList || []);
      const activities   = activityMsgs.flatMap(m => m.DataList || []);
      const staffInfo    = staffMemberMsgs.flatMap(m => m.DataList || [])[0] || null;

      // 任何可能含 crew 的訊息（名稱含 Crew/Trip/Pairing/Duty）
      const KNOWN = new Set(['RpyRosterAllocationList','RpyActivityList','RpyStaffMemberList',
                             'RpyLogin','RpyHeartbeat','RpyNotificationCountList']);
      const crewCandidates = {};
      for (const m of allMsgs) {
        const n = m.SkyNet_MsgName;
        if (!KNOWN.has(n)) {
          if (!crewCandidates[n]) crewCandidates[n] = {
            keys: Object.keys(m),
            sample: m.DataList ? JSON.stringify((m.DataList || []).slice(0,1)).slice(0,400) : JSON.stringify(m).slice(0,400),
          };
        }
      }

      // 暴露第一個 Activity 的第一個 Duty 的 DutyActivities[0] 完整 key 清單
      const firstAct = activities[0];
      const firstDuty = firstAct?.Duties?.[0];
      const firstDA = firstDuty?.DutyActivities?.find(d => d.DutyActivityType === 'F');

      // crewByActivity: activityId → 解析後的 crew 成員清單
      const crewParsed = {};
      let crewTotal = 0;
      for (const [actId, staffArr] of Object.entries(crewByActivity)) {
        crewParsed[actId] = (staffArr || []).map(_parseCrewStaff);
        crewTotal += crewParsed[actId].length;
      }

      resolve({
        loginError,
        reason,
        msgNames:        allMsgs.map(m => m.SkyNet_MsgName),
        rosterAllocs,
        activities,
        staffInfo,
        staffRecordNo:   staffInfo?.RecordNo ?? null,
        crewByActivity:  crewParsed,
        _crewCandidates: crewCandidates,
        _firstDAKeys:    firstDA ? Object.keys(firstDA) : [],
        _firstDutyKeys:  firstDuty ? Object.keys(firstDuty) : [],
        _crewPhase:      { expected: expectedCrew, done: crewIdx, field: crewField, idType: crewIdType, totalCrew: crewTotal },
        _crewTrace:      crewPhaseTrace.slice(0, 40),
      });
    };

    hardTimer = setTimeout(() => finalize('hard_timeout'), HARD_MS);

    ws.addEventListener('message', (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }

      const name = msg.SkyNet_MsgName;
      allMsgs.push(msg);

      // crew 階段：記錄收到的訊息名（含 ErrorMsg）供除錯
      if (crewPhaseActive) {
        crewPhaseTrace.push(name + (msg.ErrorMsg ? `!${String(msg.ErrorMsg).slice(0, 80)}` : ''));
      }

      // 每條訊息重置 settle timer（僅在 crew 階段「之前」）
      // 注意：初始推送可能持續串流 RpyAlertList（永不安靜），所以 settle
      // 只是「沒收到班表時」的後備收尾，crew 階段改由 data-ready 訊號觸發
      if (!crewPhaseActive && !crewPhaseStarted) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (crewPhaseStarted) return;
          if (allMsgs.some(m => m.SkyNet_MsgName === 'RpyRosterAllocationList')) {
            startCrewPhase();
          } else {
            finalize('settled_no_roster');
          }
        }, SETTLE_MS);
      }

      // RpyLogin — 檢查登入是否成功
      if (name === 'RpyLogin') {
        if (msg.Error) {
          loginError = msg.Error;
          finalize('login_error');
          return;
        }
        if (msg.ClientGuid) clientGuid = msg.ClientGuid;
      }

      // data-ready 觸發：收到班表 + 系統初始化完成 → 立即進 crew 階段
      // 用專屬 crewStartTimer（不被 generic settle 的 clearTimeout 清掉）
      if (name === 'RpyRosterAllocationList') rosterSeen = true;
      if (name === 'RpyNotificationCountList') notifSeen = true;
      if (rosterSeen && notifSeen && !crewPhaseStarted && !crewStartTimer) {
        crewStartTimer = setTimeout(() => startCrewPhase(), 400);
      }

      // crew 階段：crew 名單以 RpyStaffMemberList(N) 形式回推，累積到當前請求
      if (crewPhaseActive && name === 'RpyStaffMemberList') {
        for (const s of (msg.DataList || [])) crewCurStaff.push(s);
      }

      // RpyCrewListForActivity — 該請求的 ack（資料已先到）→ 收尾並發下一個
      if (crewPhaseActive && name === 'RpyCrewListForActivity') {
        _advanceCrew();
      }

      // RpyHeartbeat — 保持連線
      if (name === 'RpyHeartbeat') {
        ws.send(_mkBase('ReqHeartbeat', {
          ClientGuid: clientGuid,
          RequestNo:  msg.RequestNo,
        }));
      }
    });

    ws.addEventListener('error', () => {
      if (!resolved) { resolved = true; reject(new Error('ws_error')); }
    });

    ws.addEventListener('close', (evt) => {
      if (!resolved) {
        // 若連線在初始化期間關閉，直接 finalize 用已收到的資料
        finalize(`ws_closed_${evt.code}`);
      }
    });
  });
}

// ─── 解析 RpyRosterAllocationList + RpyActivityList → pairings ───
// 逆向工程確認的資料結構（2026-06）：
//
// RpyRosterAllocationList.DataList[]:
//   { ActivityId, StaffId, StartDatetime, EndDatetime,
//     Attrs.StringAttributes[{Key:"ACTIVITY_TYPE", Value:"Pairing"|"Day Off"|...}] }
//
// RpyActivityList.DataList[]:
//   { ActivityId, ActivityType, LocnId, StartDatetime, EndDatetime,
//     Duties[]: { DutyType:"TOUR_OF_DUTY", StartLocnId, EndLocnId, StartDatetime,
//       DutyActivities[]: { DutyActivityType:"F", TripId:"JX761", TripDate:"2026-05-23",
//                           StartLocnId, EndLocnId, StartDatetime, EndDatetime } } }
//
// 飛行腿：DutyActivityType === "F"，TripId = 航班號（如 "JX761"）

function _getStrAttr(attrs, key) {
  return (attrs?.StringAttributes || []).find(a => a.Key === key)?.Value || null;
}

// RpyStaffMemberList 的 staff 記錄 → 精簡 crew 成員
// CREW_GROUP skill：'1'=Cockpit, '2'=Cabin
function _parseCrewStaff(s) {
  const skills  = (s.Skills || []).map(x => x.Skill).filter(Boolean);
  const crewGrp = skills.find(x => x.SkillType === 'CREW_GROUP')?.SkillName || null;
  return {
    staffId:       s.StaffId || '',
    firstName:     s.FirstName || '',
    lastName:      s.LastName || '',
    preferredName: s.PreferredName || '',
    crewGroup:     crewGrp,            // '1'=cockpit, '2'=cabin
    isCockpit:     crewGrp === '1',
  };
}

function _blockMinutes(depIso, arrIso) {
  try {
    const diff = new Date(arrIso) - new Date(depIso);
    return diff > 0 ? Math.round(diff / 60000) : 0;
  } catch { return 0; }
}

function _isoToHHMM(iso) {
  // "2026-05-24T06:55:00+08:00" → "06:55"
  return iso ? iso.slice(11, 16) : '';
}

function _isoToDateStr(iso) {
  // "2026-05-24T06:55:00+08:00" → "20260524"
  return iso ? iso.slice(0, 10).replace(/-/g, '') : '';
}

function _parseRosterData({ rosterAllocs, activities, staffInfo, crewByActivity = {} }) {
  if (!rosterAllocs || rosterAllocs.length === 0) {
    return {
      _debug: true, _reason: 'no_roster_allocs',
      alloc_count: 0, activity_count: activities?.length ?? 0,
    };
  }

  // ActivityId → Activity 對照表
  const actMap = {};
  for (const a of (activities || [])) {
    if (a.ActivityId) actMap[a.ActivityId] = a;
  }

  const pairings = [];

  for (const alloc of rosterAllocs) {
    // 只處理 Pairing 類型（ACTIVITY_TYPE = "Pairing"）
    const actType = _getStrAttr(alloc.Attrs, 'ACTIVITY_TYPE');
    if (actType !== 'Pairing') continue;

    // 取對應的 Activity
    const activity = actMap[alloc.ActivityId];
    if (!activity || !activity.Duties) continue;

    // 逐個 Duty（每個出勤日）
    for (const duty of activity.Duties) {
      if (duty.DutyType !== 'TOUR_OF_DUTY') continue;

      // 報到時間 = duty.StartDatetime（含 TZ，local time）
      const reportTime    = _isoToHHMM(duty.StartDatetime);   // "05:05"
      const reportAirport = duty.StartLocnId || '';
      const dutyDate      = _isoToDateStr(duty.StartDatetime); // "20260524"

      // 個別航班腿
      const legs = [];
      for (const da of (duty.DutyActivities || [])) {
        if (da.DutyActivityType !== 'F') continue;  // F = Flight

        const fn = da.TripId || '';
        if (!fn) continue;

        const block = _blockMinutes(da.StartDatetime, da.EndDatetime);
        legs.push({
          flightNumber: fn,                           // "JX761"
          dep:          da.StartLocnId || '',          // "TPE"
          dest:         da.EndLocnId   || '',          // "CGK"
          std_local:    _isoToHHMM(da.StartDatetime), // "06:55"
          sta_local:    _isoToHHMM(da.EndDatetime),   // "11:15"
          std_utc:      _isoToHHMM(new Date(da.StartDatetime).toISOString()), // UTC
          sta_utc:      _isoToHHMM(new Date(da.EndDatetime).toISOString()),
          blockTime:    block,
          tripDate:     _isoToDateStr(da.StartDatetime),  // actual departure date (TZ-aware, fixes cross-midnight trips)
        });
      }

      if (legs.length === 0) continue;

      // 日期：第一腿的 TripDate（排班日）或 duty 開始日
      const date = legs[0].tripDate || dutyDate;

      pairings.push({
        date,
        reportTime,
        reportAirport,
        legs,
        crew: crewByActivity[alloc.ActivityId] || [],
        rawCodes: [_getStrAttr(alloc.Attrs, 'ACTIVITY_CODE') || alloc.ActivityId],
      });
    }
  }

  if (pairings.length === 0) {
    return {
      _debug: true, _reason: 'no_pairings_parsed',
      alloc_count:     rosterAllocs.length,
      activity_count:  activities.length,
      pairing_allocs:  rosterAllocs.filter(a => _getStrAttr(a.Attrs, 'ACTIVITY_TYPE') === 'Pairing').length,
      sample_alloc:    JSON.stringify(rosterAllocs.slice(0, 2)).slice(0, 600),
      sample_activity: JSON.stringify(activities.slice(0, 2)).slice(0, 600),
    };
  }

  return pairings;
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
    // POST /auth/login — 自動登入（帳密由 Worker secrets 提供）
    if (url.pathname === '/auth/login' && request.method === 'POST') {
      const userId = env.LIDO_USER;
      const password = env.LIDO_PASS;

      if (!userId || !password) {
        return new Response(JSON.stringify({ error: 'LIDO_USER / LIDO_PASS 尚未設定於 Worker secrets' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
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

      // 取 OFP / ATS / APLI / NOTAM 文字
      // APLI = Airport List — 包含所有天氣所需機場（格式：ICAO4+IATA3+空格+[Y/N]+日期）
      // 例：WMKKKUL     Y13MAY2026... / RCKHKHH     N13MAY2026...
      const ofpFileId   = parsed.fileIds?.OFP;
      const atsFileId   = parsed.fileIds?.ATS;
      const apliFileId  = parsed.fileIds?.APLI;
      const notamFileId = parsed.fileIds?.NOTAM;

      const [ofpText, atsText, apliText, notamText] = await Promise.all([
        ofpFileId   ? fetchDocument(legId, ofpFileId,   buildLidoHeaders(session, 'GetDocOFP'),    true) : Promise.resolve(null),
        atsFileId   ? fetchDocument(legId, atsFileId,   buildLidoHeaders(session, 'GetDocATS'),    true) : Promise.resolve(null),
        apliFileId  ? fetchDocument(legId, apliFileId,  buildLidoHeaders(session, 'GetDocAPLI'),   true) : Promise.resolve(null),
        notamFileId ? fetchDocument(legId, notamFileId, buildLidoHeaders(session, 'GetDocNOTAM'),  true) : Promise.resolve(null),
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
        notamText: notamText || null,
        routePoints: parseOFPWaypoints(ofpText),  // 從 OFP 文字解析的航路點座標
        raw: {
          ofpPreview:   ofpText   ? ofpText.substring(0, 800)  : null,
          apliPreview:  apliText  ? apliText.substring(0, 800) : null,
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
      // VAA/TCA: try multiple possible LIDO category names (actual name depends on LIDO server config)
      const CHART_GROUPS = [
        { group: 'UAD MAPS',          cats: ['UAD'] },
        { group: 'SIGWX WITH ROUTE',  cats: ['SIGWXROUTE'] },
        { group: 'OFFICIAL VAA/TCA',  cats: ['VAATCA','VATCA','WXVAA','VAA','TCA','VAAXML','TCAXML'] },
        { group: 'SIGNIFICANT WX',    cats: ['WXSIGWX','SIGWX'] },
        { group: 'CDA',               cats: ['CDA','CDAXML'] },
        { group: 'DISPATCHER MAPS',   cats: ['DISP','DISPMAP','DISPATCHER'] },
        { group: 'VERTICAL PROFILE',  cats: ['VERTPROF','VERTICALPROFILE'] },
      ];

      // Collect all available category names for debug (returned alongside charts)
      const availableCategories = Object.keys(parsed.allDocs || {});

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

      // Any category not matched by CHART_GROUPS → append as "Other" group (debug catch-all)
      const mappedCats = new Set(CHART_GROUPS.flatMap(g => g.cats));
      const unmappedFiles = [];
      for (const catName of availableCategories) {
        if (mappedCats.has(catName)) continue;
        // Skip text-only / XML data-feed categories (not viewable charts)
        if (['OFP','ATS','APLI','NOTAM','CREWINFO','RAIM'].includes(catName)) continue;
        if (catName.endsWith('XML')) continue;   // APTDXML / ASPDXML / ATSXML / NOTAMXML / OFPXML / RAIMXML / UADXML 等
        const docs = parsed.allDocs[catName] || [];
        for (const doc of docs) {
          const label = (doc.label || doc.fileName || '').trim() || `${catName} ${doc.index + 1}`;
          unmappedFiles.push({ cat: catName, fileId: doc.fileId, label: `[${catName}] ${label}`, index: doc.index });
        }
      }
      if (unmappedFiles.length) result.push({ group: '⚠ Unmatched', files: unmappedFiles });

      return new Response(JSON.stringify({ legId: parsed.legId, charts: result, availableCategories }), {
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

    // GET /turbli?dep=TPE&dest=CEB&date=2026-06-09&flight=783
    // 代理 turbli 航班頁，抽出亂流圖資料（繞過 X-Frame-Options + CORS），自繪用
    if (url.pathname === '/turbli' && request.method === 'GET') {
      const dep  = (url.searchParams.get('dep')  || '').toUpperCase();
      const dest = (url.searchParams.get('dest') || '').toUpperCase();
      const date = url.searchParams.get('date') || new Date().toISOString().slice(0,10);
      const flt  = (url.searchParams.get('flight') || '').replace(/[^0-9]/g,'');
      if (!dep || !dest || !flt) {
        return new Response(JSON.stringify({ ok:false, error:'missing dep/dest/flight' }), { status:400, headers:{...headers,'Content-Type':'application/json'} });
      }
      const turbliUrl = `https://turbli.com/${dep}/${dest}/${date}/JX-${flt}/`;
      try {
        const r = await fetch(turbliUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (!r.ok) {
          return new Response(JSON.stringify({ ok:false, status:r.status, url:turbliUrl }), { status:200, headers:{...headers,'Content-Type':'application/json'} });
        }
        const html = await r.text();
        const numArr = name => {
          const m = html.match(new RegExp('var\\s+'+name+'\\s*=\\s*(\\[[^\\]]*\\])'));
          if (!m) return null;
          try { return JSON.parse(m[1]); } catch(e){ return null; }
        };
        // 主線 CAT 為字串包陣列：var CAT = ("[16.4, 16.5, ...]")...
        const strWrapArr = name => {
          const m = html.match(new RegExp('var\\s+'+name+'\\s*=\\s*\\("(\\[[^"]*\\])"\\)'));
          if (!m) return null;
          try { return JSON.parse(m[1]).map(Number); } catch(e){ return null; }
        };
        const line  = strWrapArr('CAT');
        const time  = strWrapArr('time');   // 每個點的 UNIX epoch 秒（字串包陣列）
        const upper = numArr('CAT_upper');
        const lower = numArr('CAT_lower');
        const alt   = numArr('alt');  // 高度（FL）序列，對應每個點
        // warning + flight number 為 ("...") 形式
        const wm = html.match(/var\s+warning_turb\s*=\s*\("([^"]*)"\)/);
        const fm = html.match(/var\s+flight_number\s*=\s*\("([^"]*)"\)/);
        return new Response(JSON.stringify({
          ok: true, url: turbliUrl,
          flight: fm ? fm[1] : `JX ${flt}`,
          warning: wm ? wm[1] : null,
          line, upper, lower, alt, time,
          dep, dest,
        }), { headers: { ...headers, 'Content-Type':'application/json', 'Cache-Control':'private, max-age=1800' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok:false, error:String(e), url:turbliUrl }), { status:200, headers:{...headers,'Content-Type':'application/json'} });
      }
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

    // POST /auth/elb — 無需帳密，直接取 ELB 首頁 session cookie
    if (url.pathname === '/auth/elb' && request.method === 'POST') {
      try {
        const sessionCookie = await elbHttpLogin();
        const token = btoa(JSON.stringify({ sessionCookie, ts: Date.now() }));
        return new Response(JSON.stringify({ success: true, sessionToken: token }), {
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
        const analyzedList = await _aiAnalyzeBatch(env, parts);
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

      const analyzed = await _aiAnalyze(env, parts);
      const rawTextForStorage = parts.find(p => p.text && p.text.includes('公告內容:'))?.text?.split('公告內容:\n')[1] || '';

      // 使用者在 Shortcut 傳入的 source 映射成合法 source_tag
      // 優先順序：使用者明確選擇 > Gemini 判斷（避免 Gemini 自行覆蓋）
      // 用「關鍵字包含」比對，容忍捷徑選單的變體標籤（如「FN 公告」「其他」）
      const _mappedSourceTag = _mapSourceHint(sourceHint);

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
        // 使用者選擇的來源優先（強制覆蓋 Gemini 的判斷）
        ...(_mappedSourceTag ? { source_tag: _mappedSourceTag } : {}),
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

    // ── GET /api/track?icao24=8991d5&time=1748000000 ──────────────────
    // OpenSky Network proxy — OAuth2 Client Credentials
    if (url.pathname === '/api/track' && request.method === 'GET') {
      const icao24 = (url.searchParams.get('icao24') || '').toLowerCase().trim();
      const time   = url.searchParams.get('time');
      if (!icao24 || !time) {
        return new Response(JSON.stringify({ error: 'icao24 and time are required' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      // 取得 OAuth2 Bearer Token（使用 KV 快取，30 分鐘內不重新取得）
      let bearerToken = null;
      if (env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) {
        try {
          const cached = await env.NOTICES_KV.get('opensky_token_v1', 'json');
          if (cached && cached.expires > Date.now() / 1000 + 60) {
            bearerToken = cached.token;
          } else {
            const tokenResp = await fetch(
              'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `grant_type=client_credentials&client_id=${encodeURIComponent(env.OPENSKY_CLIENT_ID)}&client_secret=${encodeURIComponent(env.OPENSKY_CLIENT_SECRET)}`,
              }
            );
            if (tokenResp.ok) {
              const tokenData = await tokenResp.json();
              bearerToken = tokenData.access_token;
              await env.NOTICES_KV.put('opensky_token_v1',
                JSON.stringify({ token: bearerToken, expires: Date.now() / 1000 + tokenData.expires_in }),
                { expirationTtl: tokenData.expires_in }
              );
            }
          }
        } catch (e) {
          console.warn('OpenSky token fetch failed:', e.message);
        }
      }

      const osUrl = `https://opensky-network.org/api/tracks/all?icao24=${icao24}&time=${time}`;
      const osHeaders = { 'Accept': 'application/json' };
      if (bearerToken) osHeaders['Authorization'] = `Bearer ${bearerToken}`;

      const osResp = await fetch(osUrl, { headers: osHeaders });
      const body = await osResp.text();
      return new Response(body, {
        status: osResp.status,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // ── GET /api/track/fr24?reg=B-58207&date=2026-05-26&from=TPE&to=CGK ─
    // Proxy to FR24 flight-playback API; returns {track:[{la,lo,a,t,s},...]} or {error}
    if (url.pathname === '/api/track/fr24' && request.method === 'GET') {
      const reg  = url.searchParams.get('reg')  || '';
      const date = url.searchParams.get('date') || '';  // YYYY-MM-DD
      const from = url.searchParams.get('from') || '';
      const to   = url.searchParams.get('to')   || '';
      const fn   = (url.searchParams.get('fn')  || '').toUpperCase().replace(/\s/g, ''); // e.g. JX835

      if (!reg || !date) {
        return new Response(JSON.stringify({ error: 'missing reg or date' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      // KV cache key — v2: include from/to so different legs of same aircraft same day get own cache
      const cacheKey = `fr24_track_v2:${reg.toUpperCase()}:${date}:${from.toUpperCase()}-${to.toUpperCase()}`;
      if (env.NOTICES_KV) {
        const cached = await env.NOTICES_KV.get(cacheKey, 'text');
        if (cached) {
          return new Response(cached, { headers: { ...headers, 'Content-Type': 'application/json' } });
        }
      }

      const fr24Headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.flightradar24.com',
        'Referer': 'https://www.flightradar24.com/',
      };

      try {
        // Step 1: get flight list for this registration (limit=50 to cover aircraft flying 3-4 legs/day for 2 weeks)
        const listUrl = `https://api.flightradar24.com/common/v1/flight/list.json?query=${encodeURIComponent(reg)}&fetchBy=reg&page=1&limit=50`;
        const listResp = await fetch(listUrl, {
          headers: fr24Headers,
          signal: AbortSignal.timeout(12000),
        });

        if (!listResp.ok) {
          return new Response(JSON.stringify({ error: 'fr24_blocked', status: listResp.status }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        const listData  = await listResp.json();
        const flightMap = listData?.result?.response?.data || {};
        const flights   = Object.values(flightMap);

        // Find flight matching date (UTC-based, allow ±6h per side for timezone tolerance)
        const [y, m, d] = date.split('-').map(Number);
        const dayStart  = Date.UTC(y, m - 1, d, 0, 0, 0) / 1000 - 21600;   // -6h
        const dayEnd    = Date.UTC(y, m - 1, d, 23, 59, 59) / 1000 + 21600; // +6h

        const candidates = flights.filter(fl => {
          const dep = fl.time?.real?.departure || fl.time?.scheduled?.departure || 0;
          return dep >= dayStart && dep <= dayEnd;
        });

        // Priority 1: match by flight number / callsign (most reliable)
        let flight = null;
        if (fn && candidates.length > 0) {
          const byCallsign = candidates.find(fl => {
            const cs = (fl.identification?.callsign || '').toUpperCase().replace(/\s/g, '');
            const num = (fl.identification?.number?.default || '').toUpperCase().replace(/\s/g, '');
            return cs === fn || num === fn;
          });
          if (byCallsign) flight = byCallsign;
        }

        // Priority 2: match by from/to IATA airport codes
        if (!flight && from && to && candidates.length > 0) {
          const byAirport = candidates.find(fl =>
            fl.airport?.origin?.code?.iata      === from.toUpperCase() &&
            fl.airport?.destination?.code?.iata === to.toUpperCase()
          );
          if (byAirport) flight = byAirport;
        }

        // Priority 3: only fallback to first candidate if there's exactly one match
        if (!flight && candidates.length === 1) flight = candidates[0];

        if (!flight?.identification?.id) {
          return new Response(JSON.stringify({ error: 'no_flight', date, reg }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        const flightId = flight.identification.id;
        const depTime  = flight.time?.real?.departure || flight.time?.scheduled?.departure || (dayStart + 43200);

        // Step 2: get playback track
        const pbUrl = `https://api.flightradar24.com/common/v1/flight-playback.json?flightId=${flightId}&timestamp=${depTime}`;
        const pbResp = await fetch(pbUrl, {
          headers: fr24Headers,
          signal: AbortSignal.timeout(15000),
        });

        if (!pbResp.ok) {
          return new Response(JSON.stringify({ error: 'fr24_playback_blocked', status: pbResp.status }), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }

        const pbData   = await pbResp.json();
        const rawTrack = pbData?.result?.response?.data?.flight?.track || [];

        // Convert to logbook track format
        const track = rawTrack.map(p => ({
          t:  p.timestamp,
          la: parseFloat((p.latitude  || 0).toFixed(4)),
          lo: parseFloat((p.longitude || 0).toFixed(4)),
          a:  p.altitude?.feet    || 0,
          s:  p.speed?.kts        || 0,
        })).filter(p => p.la !== 0 || p.lo !== 0);

        const result = JSON.stringify({ track, flightId, reg, date });

        // Cache for 7 days (completed flights don't change)
        if (env.NOTICES_KV && track.length > 0) {
          await env.NOTICES_KV.put(cacheKey, result, { expirationTtl: 7 * 86400 });
        }

        return new Response(result, { headers: { ...headers, 'Content-Type': 'application/json' } });

      } catch (e) {
        return new Response(JSON.stringify({ error: 'fr24_exception', message: e.message }), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── GET /api/airport?iata=TPE ─────────────────────────────────────
    // Airport info lookup: name, city, country, lat/lon
    // KV-cached indefinitely (airport data is stable)
    if (url.pathname === '/api/airport' && request.method === 'GET') {
      const iata = (url.searchParams.get('iata') || '').toUpperCase().trim();
      if (!iata || iata.length !== 3) {
        return new Response(JSON.stringify({ error: 'valid 3-letter IATA code required' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      // 1. KV cache hit
      const cacheKey = `airport_iata_v1:${iata}`;
      if (env.NOTICES_KV) {
        const cached = await env.NOTICES_KV.get(cacheKey, 'json');
        if (cached) {
          return new Response(JSON.stringify(cached), {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
      }

      // 2. AeroDataBox lookup
      if (!env.RAPIDAPI_KEY) {
        return new Response(JSON.stringify({ error: 'no API key configured' }), {
          status: 503, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
      try {
        const adbxUrl  = `https://aerodatabox.p.rapidapi.com/airports/iata/${iata}`;
        const adbxResp = await fetch(adbxUrl, {
          headers: {
            'x-rapidapi-key':  env.RAPIDAPI_KEY,
            'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
          },
          signal: AbortSignal.timeout(10000),
        });

        if (adbxResp.status === 404) {
          return new Response(JSON.stringify({ error: 'airport not found' }), {
            status: 404, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        if (adbxResp.status === 429) {
          return new Response(JSON.stringify({ error: 'AeroDataBox rate limit exceeded' }), {
            status: 429, headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }
        if (!adbxResp.ok) throw new Error(`AeroDataBox error ${adbxResp.status}`);

        const data = await adbxResp.json();
        // AeroDataBox shape: { icao, iata, fullName, municipalityName, location:{lat,lon}, countryCode }
        const result = {
          iata:    data.iata    || iata,
          icao:    data.icao    || '',
          name:    data.fullName || data.name || iata,
          city:    data.municipalityName || '',
          country: data.countryCode || '',
          lat:     data.location?.lat ?? null,
          lon:     data.location?.lon ?? null,
        };

        // Cache permanently in KV (airport coords don't change)
        if (env.NOTICES_KV && result.lat != null) {
          await env.NOTICES_KV.put(cacheKey, JSON.stringify(result));
        }

        return new Response(JSON.stringify(result), {
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── POST /pegasys/auth — 驗證帳密，快速回應 ─────────────────────
    if (url.pathname === '/pegasys/auth' && request.method === 'POST') {
      let employeeId, password;
      try {
        const body = await request.json();
        employeeId = String(body.employeeId || '').trim();
        password   = String(body.password   || '').trim();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid_json' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      if (!employeeId || !password) {
        return new Response(JSON.stringify({ error: 'employeeId and password required' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      try {
        const jwt = await _pegasysLogin(employeeId, password);
        if (env.NOTICES_KV) await env.NOTICES_KV.put(`pegasys_jwt_${employeeId}`, jwt, { expirationTtl: 480 });
        return new Response(JSON.stringify({ ok: true, employeeId }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.httpStatus || 502, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── POST /pegasys/roster — 取得班表（login + WS fetch）──────────
    if (url.pathname === '/pegasys/roster' && request.method === 'POST') {
      let employeeId, password;
      try {
        const body = await request.json();
        employeeId = String(body.employeeId || '').trim();
        password   = String(body.password   || '').trim();
      } catch {
        return new Response(JSON.stringify({ error: 'invalid_json' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      if (!employeeId || !password) {
        return new Response(JSON.stringify({ error: 'employeeId and password required' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // Get or refresh JWT (use KV cache to avoid logging in on every request)
      const jwtKey = `pegasys_jwt_${employeeId}`;
      let jwt = env.NOTICES_KV ? await env.NOTICES_KV.get(jwtKey) : null;
      const nowSec = Math.floor(Date.now() / 1000);
      if (!jwt || _jwtExpiry(jwt) < nowSec + 60) {
        try {
          jwt = await _pegasysLogin(employeeId, password);
          if (env.NOTICES_KV) await env.NOTICES_KV.put(jwtKey, jwt, { expirationTtl: 480 });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: e.httpStatus || 502, headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
      }

      // Fetch roster via WebSocket (pghz_v1 protocol)
      // crew 請求欄位可由 query 覆寫，方便逆向測試（?crewField=ActivityRecordNo&crewIdType=recordNo）
      const crewOpts = {
        field:  url.searchParams.get('crewField')  || 'ActivityId',
        idType: url.searchParams.get('crewIdType') || 'activityId',
      };
      const rosterKey = `pegasys_roster_${employeeId}`;
      let wsResult = null, wsError = null;
      try {
        wsResult = await _pegasysWsRoster(jwt, employeeId, crewOpts);
      } catch (e) {
        wsError = e.message;
      }

      // ── WebSocket 呼叫失敗 ────────────────────────────────────
      if (wsError) {
        const cached = env.NOTICES_KV ? await env.NOTICES_KV.get(rosterKey, 'json') : null;
        if (cached) {
          return new Response(JSON.stringify({
            ok: true, stale: true, cached_at: cached.ts,
            ws_error: wsError, pairings: cached.pairings || [],
          }), { headers: { ...headers, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: wsError }), {
          status: 502, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // ── Login 失敗 ────────────────────────────────────────────
      if (wsResult.loginError) {
        return new Response(JSON.stringify({ error: 'pegasys_login_rejected', detail: wsResult.loginError }), {
          status: 401, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // ── 解析班表（附帶 crew）──────────────────────────────────
      const pairings = _parseRosterData({
        rosterAllocs:   wsResult.rosterAllocs || [],
        activities:     wsResult.activities   || [],
        staffInfo:      wsResult.staffInfo,
        crewByActivity: wsResult.crewByActivity || {},
      });

      const result = {
        ok: true,
        reason:       wsResult.reason,
        msgNames:     wsResult.msgNames || [],
        staffInfo:    wsResult.staffInfo ? {
          RecordNo: wsResult.staffInfo.RecordNo,
          StaffId:  wsResult.staffInfo.StaffId,
          Name:     `${wsResult.staffInfo.FirstName || ''} ${wsResult.staffInfo.LastName || ''}`.trim(),
        } : null,
        pairings,
        _debug_alloc_count:    (wsResult.rosterAllocs || []).length,
        _debug_activity_count: (wsResult.activities  || []).length,
        _debug_crewPhase:      wsResult._crewPhase       || null,
        _debug_crewTrace:      wsResult._crewTrace       || [],
      };

      // 快取 6 小時（只在有真實 pairings 時）
      if (env.NOTICES_KV && Array.isArray(pairings) && pairings.length > 0) {
        await env.NOTICES_KV.put(rosterKey,
          JSON.stringify({ ts: new Date().toISOString(), pairings }),
          { expirationTtl: 21600 }
        );
      }

      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
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
