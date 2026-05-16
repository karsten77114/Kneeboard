import store from '../store.js';

// ── Data Tables (ported from PlanFlight tools.html) ───────────────

const IATA_TO_ICAO = {
  TPE:'RCTP', KHH:'RCKH', RMQ:'RCMQ', TNN:'RCSQ', HUN:'RCBS',
  NRT:'RJAA', HND:'RJTT', KIX:'RJBB', FUK:'RJFF', OKA:'ROAH',
  CTS:'RJCC', NGO:'RJGG', SDJ:'RJSS', KOJ:'RJFK', OIT:'RJFO',
  KMQ:'RJNK', TOY:'RJNT', TYO:'RJTT', MMY:'ROMY', ISG:'ROIG',
  HKD:'RJCH',
  UKB:'RJBE', TAK:'RJOT',
  ICN:'RKSI', GMP:'RKSS', PUS:'RKPK',
  KUL:'WMKK', BKI:'WBKK', PEN:'WMKP', JHB:'WMKJ', LGK:'WMKL', BWN:'WBSB',
  SGN:'VVTS', HAN:'VVNB', DAD:'VVDN', PQC:'VVPQ',
  BKK:'VTBS', DMK:'VTBD', HKT:'VTSP', USM:'VTSM', CNX:'VTCC', HDY:'VTSS',
  MNL:'RPLL', CEB:'RPVM', ILO:'RPVI', DVO:'RPMD', KLO:'RPVK',
  SIN:'WSSS',
  DPS:'WADD', CGK:'WIII', SUB:'WARR',
  HKG:'VHHH', MFM:'VMMC',
  PVG:'ZSPD', SHA:'ZSSS', CAN:'ZGGG', PEK:'ZBAA',
  CTU:'ZUUU', SZX:'ZGSZ', HGH:'ZSHC', NKG:'ZSNJ', WUH:'ZHWH', KMG:'ZPPP',
  DEL:'VIDP', BOM:'VABB',
  PNH:'VDPP', REP:'VSRR', VTE:'VLVT',
  RGN:'VYYY',
  KTM:'VNKT',
  DXB:'OMDB', AUH:'OMAA', DOH:'OTHH', JED:'OEJN', RUH:'OERK',
  LHR:'EGLL', LGW:'EGKK', CDG:'LFPG', FRA:'EDDF', MUC:'EDDM', AMS:'EHAM',
  MAD:'LEMD', BCN:'LEBL', FCO:'LIRF', MXP:'LIMC', ZRH:'LSZH',
  SYD:'YSSY', MEL:'YMML', BNE:'YBBN', PER:'YPER',
  AKL:'NZAA',
  GUM:'PGUM',
  SEA:'KSEA', LAX:'KLAX', SFO:'KSFO', ONT:'KONT',
  JFK:'KJFK', EWR:'KEWR', ORD:'KORD', DFW:'KDFW', ATL:'KATL',
  DEN:'KDEN', LAS:'KLAS', HNL:'PHNL', ANC:'PANC',
  YVR:'CYVR', YYZ:'CYYZ',
};

const IANA_TZ = {
  RCTP:'Asia/Taipei', RCSS:'Asia/Taipei', RCKH:'Asia/Taipei', RCFG:'Asia/Taipei', RCBS:'Asia/Taipei',
  RJAA:'Asia/Tokyo', RJTT:'Asia/Tokyo', RJBB:'Asia/Tokyo', RJFF:'Asia/Tokyo', ROAH:'Asia/Tokyo',
  RJCC:'Asia/Tokyo', RJOO:'Asia/Tokyo', RJGG:'Asia/Tokyo', RJCB:'Asia/Tokyo', RJCH:'Asia/Tokyo',
  RJBE:'Asia/Tokyo', RJOT:'Asia/Tokyo', RJFK:'Asia/Tokyo', RJFO:'Asia/Tokyo', RJNK:'Asia/Tokyo',
  RJNT:'Asia/Tokyo', ROMY:'Asia/Tokyo', ROIG:'Asia/Tokyo',
  RKSI:'Asia/Seoul', RKSS:'Asia/Seoul', RKPK:'Asia/Seoul',
  WMKK:'Asia/Kuala_Lumpur', WBKK:'Asia/Kuala_Lumpur', WMKP:'Asia/Kuala_Lumpur', WBSB:'Asia/Brunei',
  VVTS:'Asia/Ho_Chi_Minh', VVNB:'Asia/Bangkok', VVDN:'Asia/Ho_Chi_Minh', VVPQ:'Asia/Ho_Chi_Minh',
  VTBS:'Asia/Bangkok', VTBD:'Asia/Bangkok', VTSP:'Asia/Bangkok', VTSM:'Asia/Bangkok', VTCC:'Asia/Bangkok',
  RPLL:'Asia/Manila', RPVM:'Asia/Manila', RPVI:'Asia/Manila',
  WSSS:'Asia/Singapore',
  WADD:'Asia/Makassar', WIII:'Asia/Jakarta', WARR:'Asia/Jakarta',
  VHHH:'Asia/Hong_Kong', VMMC:'Asia/Macau',
  ZSPD:'Asia/Shanghai', ZSSS:'Asia/Shanghai', ZGGG:'Asia/Shanghai', ZBAA:'Asia/Shanghai',
  ZUUU:'Asia/Shanghai', ZGSZ:'Asia/Shanghai', ZSHC:'Asia/Shanghai', ZSNJ:'Asia/Shanghai',
  ZHWH:'Asia/Shanghai', ZPPP:'Asia/Shanghai',
  VIDP:'Asia/Kolkata', VABB:'Asia/Kolkata',
  VDPP:'Asia/Phnom_Penh', VLVT:'Asia/Vientiane',
  VYYY:'Asia/Rangoon',
  VNKT:'Asia/Kathmandu',
  OMDB:'Asia/Dubai', OMAA:'Asia/Dubai', OTHH:'Asia/Qatar',
  OEJN:'Asia/Riyadh', OERK:'Asia/Riyadh',
  EGLL:'Europe/London', EGKK:'Europe/London',
  LFPG:'Europe/Paris',
  EDDF:'Europe/Berlin', EDDM:'Europe/Berlin',
  EHAM:'Europe/Amsterdam',
  LEMD:'Europe/Madrid', LEBL:'Europe/Madrid',
  LIRF:'Europe/Rome', LIMC:'Europe/Rome',
  LSZH:'Europe/Zurich',
  YSSY:'Australia/Sydney', YMML:'Australia/Melbourne', YBBN:'Australia/Brisbane', YPER:'Australia/Perth',
  NZAA:'Pacific/Auckland',
  PGUM:'Pacific/Guam',
  KSEA:'America/Los_Angeles', KLAX:'America/Los_Angeles', KSFO:'America/Los_Angeles', KONT:'America/Los_Angeles',
  KJFK:'America/New_York', KEWR:'America/New_York', KATL:'America/New_York',
  KORD:'America/Chicago', KDFW:'America/Chicago',
  KDEN:'America/Denver',
  PHNL:'Pacific/Honolulu',
  PANC:'America/Anchorage',
  CYVR:'America/Vancouver', CYYZ:'America/Toronto',
};

const TZ_OFFSET = {
  RCTP:8, RJAA:9, RJTT:9, RJBB:9, RJFF:9, ROAH:9, RJCC:9,
  RKSI:9, RKSS:9, WMKK:8, WBKK:8, VVTS:7, VTBS:7, RPLL:8,
  WSSS:8, WADD:8, WIII:7, VHHH:8, VMMC:8, ZSPD:8, ZBAA:8,
};

const AIRPORT_FULL = {
  TPE: ['Taipei/Taoyuan International Airport',             '桃園國際機場'],
  KHH: ['Kaohsiung International Airport',                  '高雄國際機場'],
  RMQ: ['Taichung International Airport',                   '臺中國際機場'],
  NRT: ['Tokyo/Narita International Airport',               '東京成田國際機場'],
  HND: ['Tokyo/Haneda International Airport',               '東京羽田國際機場'],
  KIX: ['Osaka/Kansai International Airport',               '大阪關西國際機場'],
  FUK: ['Fukuoka Airport',                                   '福岡機場'],
  OKA: ['Naha Airport',                                      '那霸機場'],
  CTS: ['Sapporo/New Chitose Airport',                      '札幌新千歲機場'],
  NGO: ['Nagoya/Chubu Centrair International Airport',      '名古屋中部國際機場'],
  SDJ: ['Sendai Airport',                                    '仙台機場'],
  KOJ: ['Kagoshima Airport',                                 '鹿兒島機場'],
  OIT: ['Oita Airport',                                      '大分機場'],
  MMY: ['Miyako Airport',                                    '宮古機場'],
  ISG: ['Ishigaki Airport',                                  '石垣機場'],
  HKD: ['Hakodate Airport',                                  '函館機場'],
  UKB: ['Kobe Airport',                                      '神戶機場'],
  TAK: ['Takamatsu Airport',                                 '高松機場'],
  ICN: ['Seoul/Incheon International Airport',              '首爾仁川國際機場'],
  GMP: ['Seoul/Gimpo International Airport',                '首爾金浦國際機場'],
  PUS: ['Busan/Gimhae International Airport',               '釜山金海國際機場'],
  KUL: ['Kuala Lumpur International Airport',               '吉隆坡國際機場'],
  BKI: ['Kota Kinabalu International Airport',              '哥打基納巴魯機場'],
  PEN: ['Penang International Airport',                      '檳城國際機場'],
  JHB: ['Johor Bahru/Senai International Airport',          '柔佛巴魯士乃機場'],
  LGK: ['Langkawi International Airport',                   '蘭卡威國際機場'],
  BWN: ['Brunei International Airport',                      '汶萊國際機場'],
  SGN: ['Ho Chi Minh City/Tan Son Nhat International Airport', '胡志明市新山一國際機場'],
  HAN: ['Hanoi/Noi Bai International Airport',              '河內內排國際機場'],
  DAD: ['Da Nang International Airport',                     '峴港國際機場'],
  PQC: ['Phu Quoc International Airport',                   '富國島國際機場'],
  BKK: ['Bangkok/Suvarnabhumi International Airport',       '曼谷素萬那普國際機場'],
  DMK: ['Bangkok/Don Mueang International Airport',         '曼谷廊曼國際機場'],
  HKT: ['Phuket International Airport',                      '普吉島國際機場'],
  CNX: ['Chiang Mai International Airport',                  '清邁國際機場'],
  USM: ['Koh Samui Airport',                                 '蘇美島機場'],
  HDY: ['Hat Yai International Airport',                     '合艾國際機場'],
  MNL: ['Manila/Ninoy Aquino International Airport',        '馬尼拉尼諾依・艾奎諾國際機場'],
  CEB: ['Cebu/Mactan-Cebu International Airport',           '宿霧麥克坦國際機場'],
  ILO: ['Iloilo International Airport',                      '怡朗國際機場'],
  DVO: ['Davao/Francisco Bangoy International Airport',     '達沃機場'],
  SIN: ['Singapore/Changi Airport',                          '新加坡樟宜機場'],
  DPS: ['Bali/Ngurah Rai International Airport',            '峇里島努拉萊國際機場'],
  CGK: ['Jakarta/Soekarno-Hatta International Airport',     '雅加達蘇加諾-哈達國際機場'],
  HKG: ['Hong Kong International Airport',                   '香港國際機場'],
  MFM: ['Macau International Airport',                       '澳門國際機場'],
  PVG: ['Shanghai/Pudong International Airport',            '上海浦東國際機場'],
  CAN: ['Guangzhou/Baiyun International Airport',           '廣州白雲國際機場'],
  PEK: ['Beijing/Capital International Airport',            '北京首都國際機場'],
  CTU: ['Chengdu/Tianfu International Airport',             '成都天府國際機場'],
  SZX: ["Shenzhen/Bao'an International Airport",            '深圳寶安國際機場'],
  HGH: ['Hangzhou/Xiaoshan International Airport',          '杭州蕭山國際機場'],
  KMG: ['Kunming/Changshui International Airport',          '昆明長水國際機場'],
  DEL: ['New Delhi/Indira Gandhi International Airport',    '新德里英迪拉・甘地國際機場'],
  BOM: ['Mumbai/Chhatrapati Shivaji Maharaj International Airport', '孟買賈特拉帕蒂・希瓦吉機場'],
  PNH: ['Phnom Penh International Airport',                  '金邊國際機場'],
  REP: ['Siem Reap-Angkor International Airport',           '暹粒吳哥國際機場'],
  VTE: ['Vientiane/Wattay International Airport',           '永珍瓦岱國際機場'],
  RGN: ['Yangon International Airport',                      '仰光國際機場'],
  KTM: ['Kathmandu/Tribhuvan International Airport',        '加德滿都特里布萬國際機場'],
  DXB: ['Dubai International Airport',                       '杜拜國際機場'],
  AUH: ['Abu Dhabi International Airport',                   '阿布達比國際機場'],
  DOH: ['Hamad International Airport',                       '哈馬德國際機場'],
  JED: ['Jeddah/King Abdulaziz International Airport',      '吉達阿卜杜勒阿齊茲國王機場'],
  LHR: ['London/Heathrow Airport',                           '倫敦希斯洛機場'],
  LGW: ['London/Gatwick Airport',                            '倫敦蓋威克機場'],
  CDG: ['Paris/Charles de Gaulle Airport',                   '巴黎戴高樂機場'],
  FRA: ['Frankfurt Airport',                                  '法蘭克福機場'],
  MUC: ['Munich Airport',                                    '慕尼黑機場'],
  AMS: ['Amsterdam/Schiphol Airport',                        '阿姆斯特丹史基浦機場'],
  MAD: ["Madrid/Adolfo Suárez Barajas Airport",             '馬德里巴拉哈斯機場'],
  BCN: ['Barcelona/El Prat Airport',                         '巴塞隆納普拉特機場'],
  FCO: ['Rome/Fiumicino Airport',                            '羅馬菲烏米奇諾機場'],
  MXP: ['Milan/Malpensa Airport',                            '米蘭馬爾彭薩機場'],
  ZRH: ['Zurich Airport',                                    '蘇黎世機場'],
  SYD: ['Sydney/Kingsford Smith Airport',                   '雪梨金斯福德史密斯機場'],
  MEL: ['Melbourne Airport',                                  '墨爾本機場'],
  BNE: ['Brisbane Airport',                                   '布里斯本機場'],
  PER: ['Perth Airport',                                      '伯斯機場'],
  AKL: ['Auckland Airport',                                   '奧克蘭機場'],
  GUM: ['Guam/A.B. Won Pat International Airport',          '關島機場'],
  SEA: ['Seattle/Tacoma International Airport',              '西雅圖塔科馬國際機場'],
  LAX: ['Los Angeles International Airport',                 '洛杉磯國際機場'],
  SFO: ['San Francisco International Airport',               '舊金山國際機場'],
  ONT: ['Ontario International Airport',                     '安大略機場'],
  JFK: ['New York/John F. Kennedy International Airport',   '紐約甘迺迪國際機場'],
  EWR: ['New York/Newark Liberty International Airport',    '紐華克自由國際機場'],
  ORD: ["Chicago/O'Hare International Airport",             '芝加哥奧黑爾國際機場'],
  DFW: ['Dallas/Fort Worth International Airport',          '達拉斯沃斯堡國際機場'],
  ATL: ['Atlanta/Hartsfield-Jackson International Airport', '亞特蘭大哈茨菲爾德-傑克遜機場'],
  DEN: ['Denver International Airport',                      '丹佛國際機場'],
  LAS: ['Las Vegas/Harry Reid International Airport',       '拉斯維加斯哈里・里德機場'],
  HNL: ['Honolulu International Airport',                    '檀香山國際機場'],
  ANC: ['Anchorage/Ted Stevens International Airport',      '安克拉治機場'],
  YVR: ['Vancouver International Airport',                   '溫哥華國際機場'],
  YYZ: ['Toronto/Pearson International Airport',            '多倫多皮爾遜國際機場'],
};

const WX_OPTIONS = [
  ['clear skies',   '晴天',   '☀️'],
  ['partly cloudy', '多雲時晴','⛅'],
  ['overcast',      '陰天',   '☁️'],
  ['light rain',    '小雨',   '🌦'],
  ['moderate rain', '中雨',   '🌧'],
  ['heavy rain',    '大雨',   '⛈'],
  ['thunderstorm',  '雷陣雨', '⛈'],
  ['shower',        '陣雨',   '🌦'],
  ['light snow',    '小雪',   '🌨'],
  ['snow',          '下雪',   '❄️'],
  ['heavy snow',    '大雪',   '❄️'],
  ['fog',           '濃霧',   '🌫'],
  ['mist',          '薄霧',   '🌫'],
  ['haze',          '煙霾',   '🌬'],
  ['windy',         '強風',   '💨'],
];

// ── Module state ──────────────────────────────────────────────────
let _paType = 'welcome';
let _paLang = 'en';          // active EN/ZH tab
let _paV    = {};
let _descentTimer = null;

// ── ES Module interface ───────────────────────────────────────────
export function mount(container) {
  _applyStyles();
  _render(container);
}

export function unmount() {
  if (_descentTimer) { clearInterval(_descentTimer); _descentTimer = null; }
}

// ── Timezone / time helpers ───────────────────────────────────────
function _utcToLocal(utcHHMM, dest) {
  if (!utcHHMM || utcHHMM === '--:--') return '--:--';
  const icao = IATA_TO_ICAO[dest] || dest;
  const tz   = IANA_TZ[icao];
  if (tz) {
    try {
      const today = new Date();
      const [h, m] = utcHHMM.split(':').map(Number);
      const utcDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h, m));
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(utcDate);
      const hh = parts.find(p => p.type === 'hour')?.value  || '00';
      const mm = parts.find(p => p.type === 'minute')?.value || '00';
      return `${hh === '24' ? '00' : hh}:${mm}`;
    } catch(e) {}
  }
  const offset = TZ_OFFSET[icao] ?? 8;
  const [h, m] = utcHHMM.split(':').map(Number);
  const total  = ((h * 60 + m + offset * 60) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}

function _getDestLocal(dest) {
  const icao = IATA_TO_ICAO[dest] || dest;
  const tz   = IANA_TZ[icao];
  const now  = new Date();
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(now);
      const get = t => parts.find(p => p.type === t)?.value || '00';
      const hh  = get('hour') === '24' ? '00' : get('hour');
      return { time: `${hh}:${get('minute')}`, date: `${get('year')}-${get('month')}-${get('day')}` };
    } catch(e) {}
  }
  const offset = TZ_OFFSET[icao] ?? 8;
  const ms = Date.now() + offset * 3600000;
  const ld = new Date(ms);
  return {
    time: String(ld.getUTCHours()).padStart(2,'0') + ':' + String(ld.getUTCMinutes()).padStart(2,'0'),
    date: ld.toISOString().slice(0,10),
  };
}

function _pa_eteEN(e) {
  if (!e) return '';
  const m = e.match(/(\d+):(\d+)/); if (!m) return e;
  const h = +m[1], mm = +m[2], p = [];
  if (h)  p.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (mm) p.push(`${String(mm).padStart(2,'0')} minutes`);
  return p.join(' and ');
}
function _pa_eteZH(e) {
  if (!e) return '';
  const m = e.match(/(\d+):(\d+)/); if (!m) return e;
  const h = +m[1], mm = +m[2], p = [];
  if (h)  p.push(`${h} 小時`);
  if (mm) p.push(`${String(mm).padStart(2,'0')} 分`);
  return p.join('');
}
function _pa_flFeet(fl) {
  if (!fl) return '';
  const m = fl.match(/FL?(\d+)/i);
  return m ? (parseInt(m[1]) * 100).toLocaleString() : fl;
}
function _pa_to24hm(raw) {
  if (!raw) return '';
  const s = String(raw).replace(/[LZ]$/, '').replace(':', '');
  if (/^\d{4}$/.test(s)) return s.slice(0,2) + ':' + s.slice(2);
  if (/^\d{3}$/.test(s)) return '0' + s[0]  + ':' + s.slice(1);
  return '';
}
function _extractFL(route) {
  if (!route) return null;
  const m = route.match(/[NMK]\d{3,4}[FA](\d{3})/);
  return m ? 'FL' + m[1] : null;
}

// ── Init PA vars from store ───────────────────────────────────────
function _initPAVars() {
  const f = store.flight;
  const b = store.briefing;
  if (!f) { _paV = {}; return; }

  const o      = b?.ofp   || {};
  const t      = b?.times || {};
  const rawFL  = o.cruiseFl || o.flightLevel || _extractFL(b?.atsRoute || b?.flightRoute || '') || '';
  const altStr = rawFL ? (/^FL/i.test(String(rawFL)) ? String(rawFL) : `FL${rawFL}`) : '';

  const dest = f.dest || '';
  const ICAO_TO_IATA = Object.fromEntries(Object.entries(IATA_TO_ICAO).map(([ia, ic]) => [ic, ia]));
  const destIATA = dest.length === 4 ? (ICAO_TO_IATA[dest] || dest) : dest;
  const destNames = AIRPORT_FULL[destIATA] || AIRPORT_FULL[dest] || [];

  // Alternate airport names for diversion PA
  const altnRaw   = b?.ofp?.altnApt || b?.altn || b?.alternate || '';
  const altnIATA  = altnRaw.length === 4 ? (ICAO_TO_IATA[altnRaw] || altnRaw) : altnRaw;
  const altnNames = AIRPORT_FULL[altnIATA] || [];

  _paV = {
    flt:     f.flightNumber || '',
    dest,
    destEN:  destNames[0] || dest,
    destZH:  destNames[1] || dest,
    eteEN:   _pa_eteEN(f.ete || t.ete || ''),
    eteZH:   _pa_eteZH(f.ete || t.ete || ''),
    alt:     _pa_flFeet(altStr),
    staRaw:  f.sta || t.sta || '',  // UTC — descent form uses this directly
    altnApt: altnIATA,              // IATA code shown in input
    altnEN:  _paV.altnEN || altnNames[0] || altnIATA,  // English name for PA
    altnZH:  _paV.altnZH || altnNames[1] || altnIATA,  // Chinese name for PA
    seatNo:  _paV.seatNo  || '',    // persist seat number across re-renders
  };
}

// ── Span factories ────────────────────────────────────────────────
function _pA(key, fallback) {
  const v = _paV[key] || fallback || '___';
  return `<span class="pa-auto" contenteditable="true" spellcheck="false">${v}</span>`;
}
function _pF(ph, syncKey) {
  const ds = syncKey ? ` data-sync="${syncKey}"` : '';
  return `<span class="pa-fill" contenteditable="true" spellcheck="false"${ds}>${ph}</span>`;
}
function _pSub(label) {
  return `<div class="pa-sub-label">${label}</div>`;
}

// ── PA notes & templates ──────────────────────────────────────────
const _PA_NOTES = {
  welcome: '所有旅客登機完畢後，CIC 通知機長進行廣播。',
  delay:   '出發前延誤超過 15 分鐘時廣播。',
  descent: 'TOD 前約 10 分鐘廣播。請提前告知 CIC：TOD 時間、ETA 及目的地天氣。',
  turb:    '接近或遭遇亂流時使用（視工作負荷而定）。',
  ga:      '平飛至重飛高度、完成起飛後檢查表後，於下次進場前廣播。',
  cat:     '遭遇預料外中度／嚴重亂流後廣播。',
};

function _getPAContent(id) {
  const capVal  = document.getElementById('pa-cap')?.value.trim() || '';
  const capSpan = capVal
    ? `<span class="pa-auto" contenteditable="true">${capVal}</span>`
    : `<span class="pa-fill" contenteditable="true">（機長姓名）</span>`;

  if (id === 'descent') return { note: _PA_NOTES.descent, special: 'descent' };

  const T = {
    welcome: {
      en: `"Hello everyone, this is Captain ${capSpan} speaking. On behalf of [${_pF('the cockpit crew')} / all the crew], welcome onboard STARLUX flight number ${_pA('flt')} to ${_pA('destEN')}. We should be ready for departure in [${_pF('XX','wmin')} minutes / just a few minutes]. Our flight time is ${_pA('eteEN','__ hrs __ min')}, with an initial cruising altitude of ${_pA('alt')} feet. Once again, please make yourself comfortable and enjoy the flight with us. Thank you."`,
      zh: `「各位旅客您好，我是機長 ${capSpan}。謹代表【${_pF('駕艙組員')}／全體空勤組員】，歡迎您搭乘星宇航空 ${_pA('flt')} 班機前往 ${_pA('destZH')}。我們預計 ${_pF('XX','wmin')} 分鐘後出發。本次飛行時間約 ${_pA('eteZH','__小時__分')}，初始巡航高度 ${_pA('alt')} 英呎。再次誠摯歡迎您搭乘，祝您旅途愉快，謝謝。」`,
    },
    delay: {
      en: `"Hello everyone, this is your captain speaking. Due to ${_pF('（延誤原因）')}, we might be delayed up to ${_pF('XX','dmin')} minutes before takeoff. I will keep you updated if longer delay happens. Thank you for your patient."`,
      zh: `「各位旅客您好，我是您的機長。由於 ${_pF('（延誤原因）')}，本班機可能在起飛前延誤約 ${_pF('XX','dmin')} 分鐘。若延誤情況有所變動，我將隨時更新相關資訊。感謝您的耐心等候。」`,
    },
    turb: {
      en: _pSub('i. 接近已知／預報亂流區') +
        `"Hello everyone, this is your Captain speaking. We will soon be flying through an area with light to moderate turbulence. We have already made [${_pF('changes to our route and altitude')} / deviations] to provide you with the smoothest flight possible. To ensure your safety, please stay in your seats and fasten your seat belt."` +
        _pSub('ii. 請客艙組員就座') +
        `"For the safety of the cabin crew, I have asked them to stop the inflight service, take their seats, and remain seated, until we have passed through this area. We apologize for any inconvenience. The inflight service will resume as soon as flight conditions permit.<br><br>We expect that these conditions to last for approximately ${_pF('OO','tmin')} minutes.<br><br>Your cooperation and understanding are always appreciated. Thank you."`,
      zh: _pSub('i. 接近已知／預報亂流區') +
        `「各位旅客您好，我是您的機長。我們即將飛越一片輕度至中度亂流區。我們已採取【${_pF('航路及高度調整')}／偏航】措施，盡力提供最平穩的飛行體驗。為確保您的安全，請回到座位並繫好安全帶。」` +
        _pSub('ii. 請客艙組員就座') +
        `「為確保空服員安全，我已請他們暫停客艙服務，回到座位並保持就座，直到通過此亂流區。造成不便，敬請見諒。一旦飛行條件許可，客艙服務將立即恢復。<br><br>我們預計此狀況將持續約 ${_pF('OO','tmin')} 分鐘（若可預估）。<br><br>感謝您的配合與理解，謝謝。」`,
    },
    ice: {
      en: `"Hello everyone, welcome on board. This is your Captain speaking. Today we must complete a procedure to protect the aircraft against the build-up of ice.<br><br>And we will be on ground for ${_pF('OO','imin')} minutes.<br><br>This will involve the spraying of a fluid on the aircraft; there may be some noise during this process and, possibly, a slightly unusual smell inside of the cabin. The procedure is routine and should be completed in a few minutes. Thank you for your attention."`,
      zh: `「各位旅客您好，歡迎登機。我是您的機長。今天我們需要完成一項飛機防除冰程序。<br><br>我們將在地面停留約 ${_pF('OO','imin')} 分鐘。<br><br>過程中將對飛機噴灑防除冰液，期間可能會有些聲音，客艙內也可能有些許特殊氣味。此程序為例行作業，應在幾分鐘內完成。感謝您的注意。」`,
    },
    ga: {
      en: `"May we have your attention. This is your Captain speaking. We were unable to complete our approach to landing at ${_pA('destEN')}. We have just completed a routine go-around procedure and, shortly, we shall be starting another approach to land. We will be landing in ${_pF('OO','gamin')} minutes. Thank you for your attention."`,
      zh: `「請注意，我是您的機長。我們未能完成在 ${_pA('destZH')} 的降落進場。我們剛完成一次例行重飛程序，即將重新進行進場降落。預計 ${_pF('OO','gamin')} 分鐘後降落。感謝您的注意。」`,
    },
    divert: {
      en: `"May we have your attention. This is your Captain speaking. The weather at ${_pA('destEN')} is below landing minimum, we are unable to land at this moment. We shall divert to ${_pF(_paV.altnEN || '（備降機場）', 'divert_apt_en')} airport, and we can wait for the weather at ${_pA('destEN')} to improve."`,
      zh: `「請注意，我是您的機長。目的地 ${_pA('destZH')} 天氣低於降落最低標準，我們目前無法降落。我們將轉降至 ${_pF(_paV.altnZH || '（備降機場）', 'divert_apt_zh')} 機場，並等待 ${_pA('destZH')} 天氣改善。」`,
    },
    cat: {
      en: _pSub('i. 正常情況（無傷亡）') +
        `"Hello everyone, this is your Captain speaking. We have just encountered an area of [${_pF('moderate')} / severe] Clear Air Turbulence. The aircraft condition is safe, with all systems operating normally. This type of turbulence cannot be detected with our system and was unexpected. We appreciate your cooperation to stay in your seats with seatbelt fasten until the seatbelt sign is turned off."` +
        _pSub('ii. 如有客艙損壞或傷亡') +
        `"The cabin crew are now making every effort to safeguard the condition of everyone onboard. If you need assistance, the crew will help you as soon as possible. We appreciate your cooperation to stay in your seats until the seatbelt sign is turned off. After an assessment of conditions onboard are completed, I will provide you with more information regarding the status of the flight. Your cooperation and understanding are appreciated to ensure the safety of all onboard. Thank you."` +
        _pSub('iii. 後續仍預計有輕度亂流（可選接續）') +
        `"However, it is possible that we may experience some light turbulence [later / during descent]. I will provide you with an update before we start our descent. We invite you to relax and enjoy the remainder of the flight to ${_pA('destEN')}. Thank you."`,
      zh: _pSub('i. 正常情況（無傷亡）') +
        `「各位旅客您好，我是您的機長。我們剛遭遇一片【${_pF('中度')}／嚴重】晴空亂流。飛機狀況安全，所有系統運作正常。此類亂流無法被我們的儀器事先偵測，屬突發狀況。感謝您配合留在座位並繫好安全帶，直到安全帶指示燈熄滅。」` +
        _pSub('ii. 如有客艙損壞或傷亡') +
        `「客艙組員正全力確保機上所有人員安全。若您需要協助，組員將盡快前往協助。感謝您配合留在座位，直到安全帶指示燈熄滅。完成機上狀況評估後，我將提供更多關於本次航班的最新資訊。感謝您的配合與理解，謝謝。」` +
        _pSub('iii. 後續仍預計有輕度亂流') +
        `「然而，在【之後的飛行途中／下降過程中】仍可能出現些許輕度亂流。我將在開始下降前再次更新資訊。感謝您放鬆享受前往 ${_pA('destZH')} 的剩餘旅程，謝謝。」`,
    },
    unruly: {
      en: `"This is your captain speaking. The passenger at ${_pF(_paV.seatNo || '（Seat No.）', 'seat_no')}, we have already warned you about your unacceptable behavior and requested you to moderate it.<br><br>This is the FINAL WARNING that your unruly behavior has violated the above laws and regulations. If the unruly behavior remains, it may be committed a criminal offence, and you may be restrained and handed over to the aviation security authorities. Punishment may be imposed against you, including but not limited to imprisonment, detention or monetary fine.<br><br>If there is any diversion, stop over or delay caused by your unruly behavior, STARLUX Airlines shall be entitled to request you for any and all losses, expenses and damages incurred from such circumstances. PLEASE NOW COOPERATE WITH OUR CREW MEMBERS IN AN AMICABLE WAY."`,
      zh: `各位女士、各位先生，這裡是機長廣播，我現在鄭重的對座位在 ${_pF(_paV.seatNo || 'XX', 'seat_no')}（及其附近）的乘客提出警告，您現在的行為已經嚴重的違反了中華民國民用航空法。<br><br>現在請您立即停止滋擾他人及破壞客艙安寧的行為，並依照空服人員的指示配合執行！<br><br>若因您的行為而造成飛機的延誤、轉降或公司任何損失，公司將依法向您個人提出求償！<br><br>感謝您們的理解與配合，謝謝！`,
    },
  };

  return { note: _PA_NOTES[id] || '', en: (T[id] || {}).en || '—', zh: (T[id] || {}).zh || '—' };
}

// ── Layout ────────────────────────────────────────────────────────
const _PA9_BTNS = [
  { id: 'welcome', icon: '✈️', name: 'Welcome',    sub: '歡迎',    req: true  },
  { id: 'delay',   icon: '⏱',  name: 'Gnd Delay',  sub: '地面延誤', req: false },
  { id: 'descent', icon: '🛬',  name: 'Descent',    sub: '下降前',  req: true  },
  { id: 'turb',    icon: '🌊',  name: 'Turbulence', sub: '亂流',    req: false },
  { id: 'ice',     icon: '❄️',  name: 'De/Anti-Ice',sub: '除防冰',  req: false },
  { id: 'ga',      icon: '🔄',  name: 'Missed App', sub: '重飛',    req: false },
  { id: 'divert',  icon: '🛑',  name: 'Diversion',  sub: '備降',    req: false },
  { id: 'cat',     icon: '⚡',  name: 'Unexp. CAT', sub: '突發亂流', req: false },
  { id: 'unruly',  icon: '⚠️',  name: 'Final Warn', sub: '最終警告', req: false },
];

function _render(container) {
  _paType = localStorage.getItem('kb_pa_type') || 'welcome';

  container.innerHTML = `
    <div class="pa-wrap">
      <div class="cred-info" style="margin-bottom:8px">
        <span class="tag">RAB Rev.10</span>§ 8.1 廣播詞 · 離線可用 ·
        <span style="color:#93c5fd;font-weight:700">■</span> OFP自動帶入
        <span style="color:var(--amber);font-weight:700">■</span> 手動填入（點擊修改）
      </div>

      <!-- Captain name -->
      <div class="pa-cap-bar">
        <span class="pa-cap-label">機長姓名</span>
        <input id="pa-cap" class="pa-cap-input" placeholder="Full Name（選填，點此輸入）">
      </div>

      <!-- 9-button PA type grid -->
      <div class="pa9-grid">
        ${_PA9_BTNS.map(b => `
          <button class="pa9-btn${b.id === _paType ? ' active' : ''}" data-id="${b.id}">
            <div class="pa9-icon">${b.icon}</div>
            <div class="pa9-name">${b.name}</div>
            <div class="pa9-sub">${b.sub}${b.req ? '<span class="pa9-req">必要</span>' : ''}</div>
          </button>`).join('')}
      </div>

      <!-- Note -->
      <div id="pa-note" class="pa-note" style="display:none"></div>

      <!-- Content card -->
      <div class="pa-card">
        <div id="pa-inputs" style="display:none;padding:14px;background:rgba(96,165,250,.04);border-bottom:1px solid var(--border)"></div>
        <!-- EN / ZH tab bar -->
        <div class="pa-lang-tabs">
          <button class="pa-lang-tab${_paLang === 'en' ? ' active' : ''}" data-lang="en">🇬🇧 EN</button>
          <button class="pa-lang-tab${_paLang === 'zh' ? ' active' : ''}" data-lang="zh">🇹🇼 中文</button>
        </div>
        <div id="pa-en" class="pa-body" style="${_paLang === 'zh' ? 'display:none' : ''}"></div>
        <div id="pa-zh" class="pa-body" style="${_paLang === 'en' ? 'display:none' : ''}"></div>
      </div>
    </div>`;

  // Captain name — restore + persist
  const capEl = container.querySelector('#pa-cap');
  const savedCap = localStorage.getItem('kb_captain') || '';
  if (savedCap) capEl.value = savedCap;
  capEl.addEventListener('input', e => {
    localStorage.setItem('kb_captain', e.target.value);
    _renderPAContent(container);
  });

  // PA type buttons
  container.querySelectorAll('.pa9-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _paType = btn.dataset.id;
      localStorage.setItem('kb_pa_type', _paType);
      container.querySelectorAll('.pa9-btn').forEach(b => b.classList.toggle('active', b.dataset.id === _paType));
      if (_paType !== 'descent' && _descentTimer) { clearInterval(_descentTimer); _descentTimer = null; }
      _renderPAContent(container);
    });
  });

  // EN / ZH tab switching
  container.querySelectorAll('.pa-lang-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _paLang = tab.dataset.lang;
      container.querySelectorAll('.pa-lang-tab').forEach(t => t.classList.toggle('active', t.dataset.lang === _paLang));
      const enEl = container.querySelector('#pa-en');
      const zhEl = container.querySelector('#pa-zh');
      if (enEl) enEl.style.display = _paLang === 'en' ? '' : 'none';
      if (zhEl) zhEl.style.display = _paLang === 'zh' ? '' : 'none';
    });
  });

  // Sync listener: data-sync spans mirror across EN/ZH AND quick-input fields
  ['pa-en','pa-zh'].forEach(divId => {
    const div = container.querySelector('#' + divId);
    if (!div) return;
    div.addEventListener('input', e => {
      const key = e.target.dataset?.sync;
      if (!key) return;
      const val = e.target.innerText;
      container.querySelectorAll(`[data-sync="${key}"]`).forEach(el => {
        if (el !== e.target) el.innerText = val;
      });
    });
  });

  _renderPAContent(container);
}

// ── Render PA content ─────────────────────────────────────────────
function _renderPAContent(container) {
  _initPAVars();
  const content = _getPAContent(_paType);

  const noteEl = container.querySelector('#pa-note');
  noteEl.style.display = content.note ? 'block' : 'none';
  if (content.note) noteEl.textContent = content.note;

  if (content.special === 'descent') {
    _renderDescentForm(container);
    return;
  }

  // Quick-input panel for divert (alternate airport) and unruly (seat number)
  _renderQuickInputs(container);

  container.querySelector('#pa-en').innerHTML = content.en;
  container.querySelector('#pa-zh').innerHTML = content.zh;
}

// ── Quick-input panels (divert / unruly) ──────────────────────────
function _renderQuickInputs(container) {
  const inpDiv = container.querySelector('#pa-inputs');
  if (!inpDiv) return;

  if (_paType === 'divert') {
    inpDiv.style.display = 'block';
    inpDiv.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:8px;letter-spacing:.5px;text-transform:uppercase">🛑 備降資訊</div>
      <div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:5px">備降機場 Alternate Airport <span style="font-size:9px;color:#93c5fd">← OFP ALTN</span></div>
        <input id="qi-altn" class="input input-upper" placeholder="e.g. KHH" maxlength="6"
          style="height:44px;font-size:18px;font-weight:800;letter-spacing:2px"
          value="${_paV.altnApt || ''}">
      </div>`;
    setTimeout(() => {
      const el = inpDiv.querySelector('#qi-altn');
      if (!el) return;
      el.addEventListener('input', () => {
        const code = el.value.trim().toUpperCase();
        _paV.altnApt = code;
        const names = AIRPORT_FULL[code] || [];
        _paV.altnEN  = names[0] || code;
        _paV.altnZH  = names[1] || code;
        // sync to separate EN / ZH spans in the two PA panels
        container.querySelectorAll('[data-sync="divert_apt_en"]').forEach(s => s.innerText = _paV.altnEN || '（備降機場）');
        container.querySelectorAll('[data-sync="divert_apt_zh"]').forEach(s => s.innerText = _paV.altnZH || '（備降機場）');
      });
    }, 0);

  } else if (_paType === 'unruly') {
    inpDiv.style.display = 'block';
    inpDiv.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:8px;letter-spacing:.5px;text-transform:uppercase">⚠️ 違規旅客資訊</div>
      <div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:5px">座位號碼 Seat Number</div>
        <input id="qi-seat" class="input input-upper" placeholder="e.g. 24A" maxlength="4"
          style="height:44px;font-size:18px;font-weight:800;letter-spacing:2px"
          value="${_paV.seatNo || ''}">
      </div>`;
    setTimeout(() => {
      const el = inpDiv.querySelector('#qi-seat');
      if (!el) return;
      el.addEventListener('input', () => {
        _paV.seatNo = el.value.trim().toUpperCase();
        container.querySelectorAll('[data-sync="seat_no"]').forEach(s => s.innerText = _paV.seatNo || '（Seat No.）');
      });
    }, 0);

  } else {
    inpDiv.style.display = 'none';
    inpDiv.innerHTML = '';
  }
}

// ── Descent special form ──────────────────────────────────────────
const _INP = 'width:100%;height:44px;font-size:16px;font-weight:700;background:var(--card);border:1.5px solid var(--border);border-radius:8px;color:var(--text);padding:0 12px;-webkit-appearance:none;appearance:none;box-sizing:border-box';
const _SEL = _INP + ';background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\'%3E%3Cpath fill=\'%2394a3b8\' d=\'M6 8L0 0h12z\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px';

function _renderDescentForm(container) {
  const inpDiv = container.querySelector('#pa-inputs');
  inpDiv.style.display = 'block';

  const dest   = _paV.dest || 'RCTP';
  const icao   = IATA_TO_ICAO[dest] || dest;
  const tz     = IANA_TZ[icao];
  let tzOffset = TZ_OFFSET[icao] ?? 8;
  if (tz) {
    try {
      const now = new Date();
      const lms = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
      tzOffset  = Math.round((lms - now.getTime()) / 3600000);
    } catch(e) {}
  }

  // staRaw is already UTC (f.sta from OFP) — use directly
  const etaUTC = _pa_to24hm(_paV.staRaw) || '';

  const loc    = _getDestLocal(dest);
  const wxOpts = WX_OPTIONS.map(([en, zh, ic]) =>
    `<option value="${en}|${zh}">${ic} ${zh} (${en})</option>`
  ).join('');

  inpDiv.innerHTML = `
    <div style="font-size:10px;font-weight:700;color:var(--text3);margin-bottom:12px;letter-spacing:.5px;text-transform:uppercase">🛬 Descent PA 填寫區（廣播稿即時更新）</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:5px">✈️ ETA <span style="font-size:9px;font-weight:800;color:var(--amber)">UTC</span> <span style="font-size:9px;color:#93c5fd">← OFP</span></div>
        <input type="text" id="pd-eta" inputmode="numeric" placeholder="HH:MM"
          style="${_INP}" value="${etaUTC}" maxlength="5"
          autocomplete="off" spellcheck="false">
        <div id="pd-eta-local" style="font-size:10px;color:var(--text3);margin-top:3px;padding-left:2px"></div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:5px">🕐 目前當地時間 <span style="font-size:9px;color:var(--green)">← 即時自動</span></div>
        <div id="pd-now-display" style="height:44px;font-size:22px;font-weight:800;display:flex;align-items:center;padding:0 14px;background:var(--surface);border-radius:8px;color:var(--green);font-family:'SF Mono',monospace;letter-spacing:1px">${loc.time}</div>
      </div>
    </div>
    <div style="margin-bottom:10px">
      <div style="font-size:11px;color:var(--text2);margin-bottom:5px">📅 當地日期 <span style="font-size:9px;color:var(--green)">← 自動</span></div>
      <input type="date" id="pd-date" style="${_INP};font-size:15px" value="${loc.date}">
    </div>
    <div style="margin-bottom:10px">
      <div style="font-size:11px;color:var(--text2);margin-bottom:5px">🌤 天氣狀況</div>
      <select id="pd-wx" style="${_SEL}">${wxOpts}</select>
    </div>
    <div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:5px">🌡 地面氣溫</div>
      <div style="display:flex;align-items:center;gap:10px">
        <input type="number" id="pd-tc" placeholder="—" style="width:90px;height:44px;font-size:20px;font-weight:800;text-align:center;background:var(--card);border:1.5px solid var(--border);border-radius:8px;color:var(--text)">
        <span style="font-size:15px;color:var(--text2);font-weight:600">°C</span>
        <span style="font-size:13px;color:var(--text3)">→</span>
        <span id="pd-tf" style="font-size:22px;font-weight:800;color:#60a5fa">—</span>
        <span style="font-size:15px;color:var(--text2);font-weight:600">°F</span>
      </div>
    </div>`;

  // Auto-format ETA text input as HH:MM
  const etaEl = inpDiv.querySelector('#pd-eta');
  if (etaEl) {
    etaEl.addEventListener('input', () => {
      let v = etaEl.value.replace(/[^0-9]/g, '').slice(0, 4);
      if (v.length >= 3) v = v.slice(0, 2) + ':' + v.slice(2);
      etaEl.value = v;
      _updateDescentPA(container);
    });
  }

  ['pd-date','pd-wx','pd-tc'].forEach(id => {
    const el = inpDiv.querySelector('#' + id);
    if (el) {
      el.addEventListener('change', () => _updateDescentPA(container));
      el.addEventListener('input',  () => _updateDescentPA(container));
    }
  });

  _updateDescentPA(container);

  if (_descentTimer) clearInterval(_descentTimer);
  _descentTimer = setInterval(() => _updateDescentPA(container), 30000);
}

function _updateDescentPA(container) {
  const inpDiv = container.querySelector('#pa-inputs');
  const dest   = _paV.dest   || 'RCTP';
  const destEN = _paV.destEN || dest;
  const destZH = _paV.destZH || dest;

  const loc   = _getDestLocal(dest);
  const now24 = loc.time;
  const nowEl = inpDiv.querySelector('#pd-now-display');
  if (nowEl) nowEl.textContent = now24;

  const etaUTC     = inpDiv.querySelector('#pd-eta')?.value || '--:--';
  const etaLocal   = _utcToLocal(etaUTC, dest);
  const etaLocalEl = inpDiv.querySelector('#pd-eta-local');
  if (etaLocalEl && etaUTC !== '--:--' && etaLocal !== '--:--') {
    const icao = IATA_TO_ICAO[dest] || dest;
    const tz   = IANA_TZ[icao];
    let offsetStr = '';
    if (tz) {
      try {
        const now = new Date();
        const lms = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
        const dh  = Math.round((lms - now.getTime()) / 3600000);
        offsetStr = `UTC${dh >= 0 ? '+' : ''}${dh}`;
      } catch(e) {}
    }
    if (!offsetStr) {
      const off = TZ_OFFSET[icao] ?? 8;
      offsetStr = `UTC${off >= 0 ? '+' : ''}${off}`;
    }
    etaLocalEl.textContent = `→ 當地時間 ${etaLocal} (${offsetStr})`;
  }

  const dateSt = inpDiv.querySelector('#pd-date')?.value || loc.date;
  const wxVal  = inpDiv.querySelector('#pd-wx')?.value   || 'clear skies|晴天';
  const tcRaw  = inpDiv.querySelector('#pd-tc')?.value;
  const tfEl   = inpDiv.querySelector('#pd-tf');
  const tc = (tcRaw !== '' && tcRaw != null) ? parseFloat(tcRaw) : null;
  const tf = (tc !== null && !isNaN(tc)) ? Math.round(tc * 9/5 + 32) : null;
  if (tfEl) tfEl.textContent = tf !== null ? tf : '—';

  const [wxEN, wxZH] = wxVal.split('|');

  const DAYS_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS_ZH = ['日','一','二','三','四','五','六'];
  let dateEN = '—', dateZH = '—';
  if (dateSt) {
    const d = new Date(dateSt + 'T12:00:00Z');
    dateEN = `${DAYS_EN[d.getUTCDay()]}, ${d.getUTCDate()} ${MONS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    dateZH = `${d.getUTCMonth()+1}月${d.getUTCDate()}日（星期${DAYS_ZH[d.getUTCDay()]}）`;
  }

  const tempEN = tc !== null ? `${tc} degree${tc!==1?'s':''} Celsius, which is ${tf} degree${tf!==1?'s':''} Fahrenheit` : '[temperature]';
  const tempZH = tc !== null ? `攝氏 ${tc} 度（華氏 ${tf} 度）` : '[溫度]';

  container.querySelector('#pa-en').innerHTML =
    `"Hello everyone, this is your captain speaking.<br><br>` +
    `We are approaching <strong>${destEN}</strong> and expect to start our descent in 10 minutes. ` +
    `We estimate landing at <strong>${etaLocal}</strong> local time. ` +
    `The current local time in <strong>${destEN}</strong> is <strong>${now24}</strong> on ${dateEN}.<br><br>` +
    `The present weather at the airport is <strong>${wxEN}</strong> with a temperature of <strong>${tempEN}</strong>.<br><br>` +
    `We certainly hope that you have enjoyed the flight with us, and we look forward to having you onboard another STARLUX flight again very soon. ` +
    `Thank you, and we wish you all a very pleasant journey."`;

  container.querySelector('#pa-zh').innerHTML =
    `「各位旅客您好，我是您的機長。我們正接近 <strong>${destZH}</strong>，預計約 10 分鐘後開始下降。` +
    `預計降落時間為當地時間 <strong>${etaLocal}</strong>。` +
    `目前 <strong>${destZH}</strong> 當地時間 <strong>${now24}</strong>，日期 ${dateZH}。<br><br>` +
    `目的地機場目前<strong>${wxZH}</strong>，地面溫度 <strong>${tempZH}</strong>。<br><br>` +
    `感謝您選擇星宇航空，期待再次為您服務。祝您旅途愉快，謝謝。」`;
}

// ── Styles ────────────────────────────────────────────────────────
function _applyStyles() {
  if (document.getElementById('pa-style')) return;
  const s = document.createElement('style');
  s.id = 'pa-style';
  s.textContent = `
    .pa-wrap { display:flex; flex-direction:column; padding:12px; gap:10px; }

    .pa-cap-bar {
      display:flex; align-items:center; gap:10px;
      padding:10px 14px; background:var(--surface);
      border-radius:10px; border:1px solid var(--border);
    }
    .pa-cap-label { font-size:12px; color:var(--text2); flex-shrink:0; font-weight:600; }
    .pa-cap-input {
      flex:1; font-weight:700; font-size:15px; height:40px;
      background:transparent; border:none; padding:0;
      color:var(--text); outline:none;
    }
    .pa-cap-input::placeholder { color:var(--text3); font-weight:400; font-size:13px; }

    .pa9-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
    .pa9-btn {
      background:var(--surface); border:1px solid var(--border);
      border-radius:10px; padding:8px 4px; cursor:pointer;
      text-align:center; transition:all 0.15s; color:var(--text2);
    }
    .pa9-btn.active {
      background:var(--card); border-color:var(--gold);
      color:var(--gold); box-shadow:0 0 12px var(--gold-glow);
    }
    .pa9-btn:hover:not(.active) { border-color:rgba(196,154,60,0.3); }
    .pa9-icon { font-size:20px; margin-bottom:2px; }
    .pa9-name { font-size:11px; font-weight:700; letter-spacing:0.3px; }
    .pa9-sub  { font-size:10px; color:var(--text3); margin-top:2px; }
    .pa9-btn.active .pa9-sub { color:var(--text2); }
    .pa9-req {
      display:inline-block; font-size:9px; font-weight:700;
      background:rgba(255,71,87,0.15); color:var(--red);
      border-radius:4px; padding:0 4px; margin-left:3px;
    }

    .pa-note {
      font-size:12px; color:var(--text3); background:var(--surface);
      border-radius:8px; padding:8px 12px; line-height:1.6;
      border-left:3px solid var(--gold-dim);
    }

    .pa-card { background:var(--card); border:1px solid var(--border); border-radius:12px; overflow:hidden; }

    /* EN / ZH tab bar */
    .pa-lang-tabs {
      display:flex; border-bottom:1px solid var(--border);
    }
    .pa-lang-tab {
      flex:1; padding:10px 0; border:none; background:transparent;
      font-size:13px; font-weight:700; letter-spacing:.4px; cursor:pointer;
      color:var(--text3); transition:all 0.15s;
      border-bottom:2px solid transparent;
    }
    .pa-lang-tab.active[data-lang="en"] { color:#60a5fa; border-bottom-color:#60a5fa; background:rgba(96,165,250,.06); }
    .pa-lang-tab.active[data-lang="zh"] { color:var(--green); border-bottom-color:var(--green); background:rgba(0,245,160,.05); }
    .pa-lang-tab:hover:not(.active) { background:rgba(255,255,255,.03); color:var(--text2); }

    .pa-body { padding:14px; font-size:14px; line-height:2.1; color:var(--text); min-height:60px; }

    .pa-sub-label {
      display:block; font-size:11px; font-weight:700; color:var(--text3);
      margin:12px 0 4px; border-left:3px solid var(--border); padding-left:8px;
    }
    .pa-sub-label:first-child { margin-top:0; }

    .pa-auto {
      color:#93c5fd; border-bottom:1px dashed rgba(147,197,253,0.4);
      cursor:text; outline:none;
    }
    .pa-fill {
      color:var(--amber); border-bottom:1px dashed rgba(255,183,3,0.4);
      cursor:text; outline:none; font-style:italic;
    }
    .pa-auto:focus, .pa-fill:focus { background:rgba(255,255,255,0.04); border-radius:3px; }
  `;
  document.head.appendChild(s);
}
