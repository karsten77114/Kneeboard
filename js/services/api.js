import storage from './storage.js';
import store from '../store.js';

const WORKER = 'https://jx-briefing.karsten77114.workers.dev';

// ── LIDO ─────────────────────────────────────────────────────────

export async function lidoLogin(userId, password) {
  const resp = await fetch(`${WORKER}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || '登入失敗');
  return data.sessionToken;
}

// Auto re-login if we have stored credentials, returns true if auth is ready
export async function ensureLido() {
  const { token, userId, password } = storage.getLidoCredentials();
  if (token) return true;
  if (!userId || !password) return false;

  store.setAuth('lido', { status: 'connecting' });
  try {
    const newToken = await lidoLogin(userId, password);
    storage.saveLidoSession(userId, password, newToken);
    store.setAuth('lido', { token: newToken, userId, status: 'ok' });
    return true;
  } catch {
    store.setAuth('lido', { status: 'expired' });
    return false;
  }
}

export async function fetchBriefing(flight, dateStr, dep = '', dest = '') {
  const { token } = storage.getLidoCredentials();
  if (!token) throw new Error('auth_required');

  const date = dateStr.replace(/-/g, '');
  let url = `${WORKER}/api/briefing?flight=${flight}&date=${date}&sessionToken=${token}`;
  if (dep)  url += `&dep=${dep}`;
  if (dest) url += `&dest=${dest}`;

  const resp = await fetch(url);
  if (resp.status === 401) {
    storage.clearLidoSession();
    store.setAuth('lido', { token: null, status: 'expired' });
    throw new Error('session_expired');
  }
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || `伺服器錯誤 ${resp.status}`);
  return data;
}

export async function fetchFlightList(dateStr) {
  const { token } = storage.getLidoCredentials();
  if (!token) return [];

  const date = dateStr.replace(/-/g, '');
  const resp = await fetch(`${WORKER}/flights?sessionToken=${token}&date=${date}`);
  if (resp.status === 401) {
    storage.clearLidoSession();
    store.setAuth('lido', { token: null, status: 'expired' });
    throw new Error('session_expired');
  }
  if (!resp.ok) return [];
  return resp.json();
}

// Check session validity for all systems
export async function verifySessions() {
  // LIDO
  const lido = storage.getLidoCredentials();
  if (lido.token) {
    try {
      // A small request to verify token
      await fetchFlightList(new Date().toISOString().split('T')[0]);
      store.setAuth('lido', { userId: lido.userId, status: 'ok' });
    } catch (e) {
      if (e.message === 'session_expired') {
        store.setAuth('lido', { token: null, status: 'expired' });
      }
    }
  }

  // ELB
  const elb = storage.getELBCredentials();
  if (elb.token) {
    try {
      // Minimal query to check ELB session
      await elbQuery('getAircraftState', { id: 'B-58201' }, elb.token);
      store.setAuth('elb', { userId: elb.userId, status: 'ok' });
    } catch (e) {
      if (/session|auth|401/i.test(e.message)) {
        store.setAuth('elb', { token: null, status: 'expired' });
      }
    }
  }
}

// ── D-ATIS ────────────────────────────────────────────────────────

export async function fetchAtis(icao) {
  const resp = await fetch(`${WORKER}/atis?icao=${icao}`);
  if (!resp.ok) throw new Error(`ATIS fetch failed ${resp.status}`);
  return resp.json();
}

// ── METAR/TAF ────────────────────────────────────────────────────

export async function fetchMetar(icao) {
  const resp = await fetch(`${WORKER}/api/weather/metar?icao=${icao}`);
  if (!resp.ok) return null;
  return resp.json();
}

// 預載所有相關機場 METAR，存入 store.wxData（在航班查詢後背景執行）
export async function preloadMetarForFlight(airports) {
  if (!airports?.length) return;
  for (const icao of airports) {
    if (!icao || icao === '—') continue;
    const existing = store.wxData[icao];
    if (existing && !existing.error && existing.fetchedAt && (Date.now() - existing.fetchedAt) < 600000) continue;
    store.setWxData(icao, { loading: true });
    try {
      const data = await fetchMetar(icao);
      if (!data || data.error) throw new Error(data?.error || `${icao} 查無資料`);
      store.setWxData(icao, {
        metar:     data.metar || null,
        taf:       data.taf   || null,
        fetchedAt: Date.now(),
        loading:   false,
        error:     null,
      });
    } catch (e) {
      store.setWxData(icao, { loading: false, error: e.message });
    }
  }
}

// ── Gate Info (TDX) ──────────────────────────────────────────────

export async function fetchGate(fno, date = '') {
  let url = `${WORKER}/api/gate?fno=${encodeURIComponent(fno)}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Gate 查詢失敗 ${resp.status}`);
  return resp.json();
}

// ── ELB ──────────────────────────────────────────────────────────

export async function elbLogin(userId, password) {
  const resp = await fetch(`${WORKER}/auth/elb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, password }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'ELB 登入失敗');
  return data.sessionToken;
}

// Auto re-login if session expired, returns fresh token or throws
async function _ensureElb() {
  const { token, userId, password } = storage.getELBCredentials();
  if (token) return token;
  if (!userId || !password) throw new Error('ELB 未登入');
  store.setAuth('elb', { status: 'connecting' });
  const newToken = await elbLogin(userId, password);
  storage.saveELBSession(userId, password, newToken);
  store.setAuth('elb', { token: newToken, userId, status: 'ok' });
  return newToken;
}

const _ELB_SKIP = new Set([
  'NIL TECHNICAL DEFECT', 'AUTOLAND SATISFACTORY', 'AUTOLAND NOT PERFORMED',
  'AUTOLAND NOT ATTEMPTED', 'APU IN-FLIGHT START NOT PERFORMED', 'APU IN-FLIGHT START PERFORMED',
]);

export function calcExpireDays(baseIso, expArr) {
  const days = expArr?.[0]?.relativeTime?.days;
  if (!days || !baseIso) return null;
  const expire = new Date(new Date(baseIso).getTime() + days * 86400000);
  return Math.round((expire - new Date()) / 86400000);
}

// 向 Worker 代理一次 ELB WebSocket 查詢，session 過期時自動重新登入
export async function elbQuery(funcName, content, token) {
  const _query = async (t) => {
    const resp = await fetch(`${WORKER}/api/elb/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: t, func: funcName, content }),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw new Error(data.error || 'ELB 查詢失敗');
    return data.data;
  };

  try {
    return await _query(token);
  } catch (e) {
    // On timeout or session error, clear stored token and retry once with fresh login
    if (/逾時|session|Session|connect|401/i.test(e.message)) {
      storage.clearELBSession();
      store.setAuth('elb', { token: null });
      const freshToken = await _ensureElb();
      return await _query(freshToken);
    }
    throw e;
  }
}

// ── ELB High-level helpers ────────────────────────────────────────

export async function getMELFull(id, token) {
  const ml = await elbQuery('getMaintLog', { id }, token).catch(() => null);
  if (!ml) return null;
  const maId = ml.latestDeferringMaintActionId;
  if (maId) {
    const ma = await elbQuery('getMaintAction', { id: maId }, token).catch(() => null);
    const d  = ma?.maintActionDeferral;
    if (d) {
      ml._category   = d.deferralCategoryOther || d.deferralCategory || '?';
      ml._expireDays = calcExpireDays(ml.originDateTime, d.expiration);
    }
    const refs     = ma?.actionAuthorityRef || [];
    const primary  = refs.filter(r => r.typeOfReference !== 'ACTION');
    const melRef   = primary.find(r => r.typeOfReference === 'MEL' || r.typeOfDocumentOther === 'MEL')?.documentNumber;
    const cdlRef   = primary.find(r => r.typeOfReference === 'CDL' || r.typeOfDocumentOther === 'CDL')?.documentNumber;
    if (melRef)      { ml._melCode = melRef; ml._refType = 'MEL'; }
    else if (cdlRef) { ml._melCode = cdlRef; ml._refType = 'CDL'; }
    else             { ml._refType = 'OTH'; }           // MP task / inspection / other

    // FC-based expiry (OTH maintenance tasks use flight-cycle limits, not days)
    const exp0 = d?.expiration?.[0];
    if (!ml._expireDays && exp0?.quantity && exp0?.unitName) {
      ml._expireLimit = `${exp0.quantity} ${exp0.unitName}`;
    }
  }
  return ml;
}

export async function getNTCFull(id, token) {
  const ntc = await elbQuery('getNoteToCrew', { id }, token).catch(() => null);
  if (!ntc) return null;
  const act  = ntc.ntcActions?.[0];
  ntc._title = ntc.recordName || id;
  ntc._text  = act?.comments?.trim() || '';
  const expDate = act?.expiration?.[0]?.date;
  if (expDate) ntc._expireDays = Math.round((new Date(expDate) - new Date()) / 86400000);
  return ntc;
}

export async function getFlightDetails(flight, token) {
  const ids = flight.maintLogIds || [];
  if (!ids.length) return { autoland: false, defects: [] };
  const logs = await Promise.all(ids.map(id => elbQuery('getMaintLog', { id }, token).catch(() => null)));
  const autoland = logs.some(ml => ml?.faultDescription === 'AUTOLAND SATISFACTORY');
  const defectLogs = logs.filter(ml =>
    ml && ml.faultDescription && !_ELB_SKIP.has(ml.faultDescription) &&
    (ml.recordName?.startsWith('FL') || ml.recordName?.startsWith('CL'))
  );
  const defects = await Promise.all(defectLogs.map(async ml => {
    const maId = ml.latestMaintActionId;
    if (maId) {
      const ma = await elbQuery('getMaintAction', { id: maId }, token).catch(() => null);
      if (ma) ml._actionDesc = ma.maintActionDescription?.trim() || '';
    }
    return ml;
  }));
  return { autoland, defects };
}

// 預載 ELB 所有資料並存入 store（在航班查詢後背景執行）
export async function preloadElbForFlight(reg) {
  if (!reg) return;
  let token;
  try {
    token = await _ensureElb();
  } catch {
    return; // ELB 未登入，跳過
  }

  store.setElbData({ reg, loading: true, mel: [], ntc: [], flights: [] });

  try {
    const raw   = await elbQuery('getAircraftState', { id: reg }, token);
    const state = (raw && typeof raw === 'object')
      ? (raw.aircraftIdentifier ? raw : raw.data ?? raw.aircraft ?? raw)
      : null;
    if (!state?.aircraftIdentifier) throw new Error('找不到飛機 ' + reg);

    const maintIds  = Array.isArray(state.deferredDefects) ? state.deferredDefects : [];
    const ntcIds    = Array.isArray(state.notesToCrew)    ? state.notesToCrew    : [];
    const flightIds = (Array.isArray(state.closedFlights)  ? state.closedFlights  : []).slice(0, 8);

    const [melResults, ntcResults, flightResults] = await Promise.all([
      Promise.all(maintIds.map(id => getMELFull(id, token))),
      Promise.all(ntcIds.map(id => getNTCFull(id, token))),
      Promise.all(flightIds.map(id => elbQuery('getFlightLog', { id }, token).catch(() => null))),
    ]);

    const sortedFlights = flightResults.filter(Boolean).sort((a, b) => {
      const ta = a.oooiOff?.actual || a.oooiOut?.actual || '';
      const tb = b.oooiOff?.actual || b.oooiOut?.actual || '';
      return tb > ta ? 1 : -1;
    });
    const details = await Promise.all(sortedFlights.map(f => getFlightDetails(f, token)));
    sortedFlights.forEach((f, i) => { f._autoland = details[i].autoland; f._defects = details[i].defects; });

    store.setElbData({
      reg,
      fleetType: (Array.isArray(state.facets) && state.facets.find(f => !/[_]/.test(f))) || 'STARLUX',
      inFlight:  Array.isArray(state.activeFlights) && state.activeFlights.length > 0,
      mel:     melResults.filter(Boolean),
      ntc:     ntcResults.filter(Boolean),
      flights: sortedFlights,
      loading: false,
      error:   null,
    });
  } catch (e) {
    store.setElbData({ reg, loading: false, error: e.message, mel: [], ntc: [], flights: [] });
  }
}
