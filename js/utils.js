// Shared utility functions

// IATA → ICAO mapping (covers Star Lux network + common alternates)
const _IATA2ICAO = {
  // Taiwan
  TPE:'RCTP', TSA:'RCSS', KHH:'RCKH', RMQ:'RCMQ', TNN:'RCNN',
  MZG:'RCQC', HUN:'RCYU', TXG:'RCMQ', KNH:'RCDI', TTT:'RCFN',
  // Japan
  NRT:'RJAA', HND:'RJTT', KIX:'RJBB', ITM:'RJOO', NGO:'RJGG',
  FUK:'RJFF', OKA:'ROAH', CTS:'RJCC', SDJ:'RJSS', KMJ:'RJFT',
  HIJ:'RJOA', OIT:'RJFO', KOJ:'RJFK', MYJ:'RJOM', TAK:'RJOT',
  AOJ:'RJSA', AXT:'RJSK', KKJ:'RJFR', SHM:'RJBD',
  // Korea
  ICN:'RKSI', GMP:'RKSS', PUS:'RKPK', CJU:'RKPC',
  // SE Asia
  BKK:'VTBS', DMK:'VTBD', KUL:'WMKK', SIN:'WSSS', SGN:'VVTS',
  HAN:'VVNB', HKG:'VHHH', MNL:'RPLL', CEB:'RPVM', DPS:'WADD',
  CGK:'WIII', SUB:'WARR', MES:'WIMM',
  // Vietnam
  DAD:'VVDN', CXR:'VVCR', PQC:'VVPQ', VCA:'VVCT', HPH:'VVCI', VDO:'VVVD',
  // Philippines / Indonesia
  ILO:'RPVI', KLO:'RPVK', MNL:'RPLL', BXU:'RPME', GEN:'RPMR',
  // SE Asia additional
  PEN:'WMKP', LGK:'WMKL', BKI:'WBKK', KCH:'WBGG', MYY:'WBGR',
  // China / HK / Macau
  PEK:'ZBAA', PKX:'ZBAD', PVG:'ZSPD', SHA:'ZSSS', CAN:'ZGGG',
  CTU:'ZUUU', HKG:'VHHH', MFM:'VMMC',
  // US / Pacific
  LAX:'KLAX', SFO:'KSFO', JFK:'KJFK', SEA:'KSEA', ORD:'KORD',
  ONT:'KONT', SNA:'KSNA', SAN:'KSAN', LAS:'KLAS', DEN:'KDEN',
  HNL:'PHNL', OGG:'PHOG', KOA:'PHKO', LIH:'PHLI', ITO:'PHTO',
  GUM:'PGUM', SPN:'PGSN',
  // Middle East / Europe (occasional)
  DXB:'OMDB', DOH:'OTHH', AUH:'OMAA',
};

export function toICAO(code) {
  if (!code) return code;
  const u = String(code).trim().toUpperCase().split('/')[0];
  if (/^[A-Z]{4}$/.test(u)) return u;
  return _IATA2ICAO[u] || u;
}

const _ICAO2IATA = Object.fromEntries(Object.entries(_IATA2ICAO).map(([k, v]) => [v, k]));

export function toIATA(code) {
  if (!code) return code;
  const u = String(code).trim().toUpperCase().split('/')[0];
  if (/^[A-Z]{3}$/.test(u)) return u;  // already IATA
  return _ICAO2IATA[u] || u;
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10); // UTC date
}

export function fuelStr(kg) {
  if (kg === null || kg === undefined || kg === '') return '—';
  return Math.round(kg).toLocaleString() + ' kg';
}

export function formatDateDisplay(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length < 8) return yyyymmdd || '';
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const y = yyyymmdd.slice(0,4), m = parseInt(yyyymmdd.slice(4,6))-1, d = yyyymmdd.slice(6,8);
  return `${d}${months[m]}${y}`;
}

export function showToast(msg, isError = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = `toast${isError ? ' error' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

export function weightPct(pln, lim) {
  if (!pln || !lim) return 0;
  return Math.min(100, Math.round(pln / lim * 100));
}

export function weightClass(pct) {
  return pct >= 97 ? 'over' : pct >= 92 ? 'warn' : 'safe';
}

export function weightColor(pct) {
  return pct >= 97 ? 'var(--red)' : pct >= 92 ? 'var(--yellow)' : 'var(--green)';
}

// ── METAR → Weather Widget ────────────────────────────────────────
// Parses a raw METAR string into { temp, condition, emoji }
// No network requests — reads data already in store.wxData[ICAO].metar
export function parseMetarForWidget(metarStr) {
  if (!metarStr || typeof metarStr !== 'string') return null;

  // ── Temperature ─────────────────────────────────────────────────
  // Format: 26/21 or M01/M05 (M = minus)
  const tempM = metarStr.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  if (!tempM) return null;
  const temp = parseInt(tempM[1].replace('M', '-'), 10);

  // ── Weather Phenomena (highest-priority first) ───────────────────
  let condition = null;
  let emoji = null;

  if (/\bTS/.test(metarStr)) {
    condition = 'Thunderstorm'; emoji = '⛈️';
  } else if (/\bFZFG\b/.test(metarStr)) {
    condition = 'Freezing fog'; emoji = '🌫️';
  } else if (/\bFZ(RA|DZ)\b/.test(metarStr)) {
    condition = 'Freezing rain'; emoji = '🌨️';
  } else if (/\+RA\b|\+SHRA\b/.test(metarStr)) {
    condition = 'Heavy rain'; emoji = '🌧️';
  } else if (/\bSHRA\b|\bRA\b/.test(metarStr)) {
    condition = 'Rain'; emoji = '🌧️';
  } else if (/-RA\b|-DZ\b|\bDZ\b/.test(metarStr)) {
    condition = 'Light rain'; emoji = '🌦️';
  } else if (/\+SN\b/.test(metarStr)) {
    condition = 'Heavy snow'; emoji = '❄️';
  } else if (/\bSN\b|\bSHSN\b/.test(metarStr)) {
    condition = 'Snow'; emoji = '🌨️';
  } else if (/-SN\b/.test(metarStr)) {
    condition = 'Light snow'; emoji = '🌨️';
  } else if (/\bFG\b/.test(metarStr)) {
    condition = 'Fog'; emoji = '🌫️';
  } else if (/\bBR\b/.test(metarStr)) {
    condition = 'Mist'; emoji = '🌫️';
  } else if (/\bHZ\b/.test(metarStr)) {
    condition = 'Haze'; emoji = '🌫️';
  } else if (/\bFU\b/.test(metarStr)) {
    condition = 'Smoke'; emoji = '🌫️';
  } else if (/\bSS\b|\bDS\b/.test(metarStr)) {
    condition = 'Dust storm'; emoji = '💨';
  }

  // ── Sky Condition (fallback if no wx phenomena) ──────────────────
  if (!condition) {
    if (/\bCAVOK\b/.test(metarStr) || /\bNSC\b|\bNCD\b|\bSKC\b|\bCLR\b/.test(metarStr)) {
      condition = 'Clear'; emoji = '☀️';
    } else if (/\bOVC/.test(metarStr)) {
      condition = 'Overcast'; emoji = '☁️';
    } else if (/\bBKN/.test(metarStr)) {
      condition = 'Mostly cloudy'; emoji = '🌥️';
    } else if (/\bSCT/.test(metarStr)) {
      condition = 'Partly cloudy'; emoji = '⛅';
    } else if (/\bFEW/.test(metarStr)) {
      condition = 'Mostly clear'; emoji = '🌤️';
    } else {
      condition = 'Clear'; emoji = '☀️';
    }
  }

  return { temp, condition, emoji };
}
