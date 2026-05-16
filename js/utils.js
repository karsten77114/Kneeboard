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
  // Already ICAO (4 chars starting with letter)
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
