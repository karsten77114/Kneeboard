// Global app state — single source of truth
import storage from './services/storage.js';

// 冷啟動還原：iOS 常在背景殺掉 PWA，重開時記憶體 state 全失。
// 把整包 briefing + 天氣快照寫進 localStorage，開 App 時 hydrate() 還原，免重搜、離線可用。
const SNAPSHOT_KEY = 'session_snapshot';
const SNAPSHOT_TTL = 48 * 3600 * 1000; // 48h：夠涵蓋「前一晚查、隔天早上重開」；更舊就不還原避免誤導

const store = {
  auth: {
    lido: { token: null, userId: null, status: 'idle' }, // idle | connecting | ok | expired | error
    elb:  { token: null, userId: null, status: 'idle' },
  },

  // Currently selected flight (summary for top bar)
  flight: null,
  // {
  //   legId, flightNumber, dep, dest, depName, destName,
  //   std, sta, stdLocal, staLocal, ete, reg, date
  // }

  // Full briefing payload from /api/briefing
  briefing: null,

  // ELB query cache — { reg, mel, ntc, flights, loading, error }
  elbData: null,

  // Shared METAR/TAF cache — { ICAO: { metar, taf, fetchedAt, loading, error } }
  wxData: {},

  // Open-Meteo human-readable weather cache — { ICAO: { temp, condition, emoji, fetchedAt, loading, error } }
  airportWeather: {},

  _subs: [],

  subscribe(fn) {
    this._subs.push(fn);
    return () => { this._subs = this._subs.filter(f => f !== fn); };
  },

  _emit() {
    this._subs.forEach(fn => fn());
  },

  setFlight(data) {
    this.flight = data;
    this._persist();
    this._emit();
  },

  setBriefing(data) {
    this.briefing = data;
    this._persist();
    this._emit();
  },

  setAuth(system, patch) {
    this.auth[system] = { ...this.auth[system], ...patch };
    this._emit();
  },

  setElbData(data) {
    this.elbData = data;
    this._emit();
  },

  setWxData(icao, data) {
    this.wxData[icao] = data;
    this._persist();
    this._emit();
  },

  setAirportWeather(icao, data) {
    this.airportWeather[icao] = { ...(this.airportWeather[icao] || {}), ...data };
    this._persist();
    this._emit();
  },

  clearFlight() {
    this.flight = null;
    this.briefing = null;
    this.elbData = null;
    this.wxData = {};
    this.airportWeather = {};
    storage.remove(SNAPSHOT_KEY);
    this._emit();
  },

  // 寫快照到 localStorage（只在有 briefing 時；weather 的 loading 旗標不必特別處理，
  // hydrate 時會清掉避免還原後卡在轉圈）
  _persist() {
    if (!this.briefing) return;
    try {
      storage.set(SNAPSHOT_KEY, {
        flight: this.flight,
        briefing: this.briefing,
        wxData: this.wxData,
        airportWeather: this.airportWeather,
        savedAt: Date.now(),
      });
    } catch {}
  },

  // 冷啟動時把快照還原進 state；成功回 true。app.js init 用它決定要不要直接開 Flight Crew。
  hydrate() {
    const snap = storage.get(SNAPSHOT_KEY, null);
    if (!snap || !snap.briefing || !snap.flight) return false;
    if (!snap.savedAt || (Date.now() - snap.savedAt) > SNAPSHOT_TTL) return false;
    this.flight = snap.flight;
    this.briefing = snap.briefing;
    this.wxData = snap.wxData || {};
    this.airportWeather = snap.airportWeather || {};
    // 清掉殘留的 loading 旗標，否則還原後天氣卡會卡在轉圈
    for (const m of [this.wxData, this.airportWeather]) {
      for (const k in m) { if (m[k] && m[k].loading) m[k].loading = false; }
    }
    return true;
  },
};

export default store;
