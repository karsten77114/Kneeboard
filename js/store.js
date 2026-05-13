// Global app state — single source of truth
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
    this._emit();
  },

  setBriefing(data) {
    this.briefing = data;
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
    this._emit();
  },

  clearFlight() {
    this.flight = null;
    this.briefing = null;
    this.elbData = null;
    this.wxData = {};
    this._emit();
  },
};

export default store;
