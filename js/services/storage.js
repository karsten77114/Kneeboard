// localStorage wrapper with 'kb_' prefix
const PREFIX = 'kb_';

export const storage = {
  get(key, fallback = null) {
    try {
      const val = localStorage.getItem(PREFIX + key);
      return val === null ? fallback : JSON.parse(val);
    } catch { return fallback; }
  },

  set(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch {}
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  // Auth helpers — 帳密存於 Worker secrets，前端只快取 token
  getLidoToken()        { return this.get('lido_token'); },
  saveLidoToken(token)  { this.set('lido_token', token); },
  clearLidoToken()      { this.remove('lido_token'); },

  getELBToken()         { return this.get('elb_token'); },
  saveELBToken(token)   { this.set('elb_token', token); },
  clearELBToken()       { this.remove('elb_token'); },

  // Last search inputs
  getLastSearch() {
    return this.get('last_search', {});
  },

  saveLastSearch(data) {
    this.set('last_search', data);
  },

  // PIREPS state per flight+date key
  getPireps(key) {
    return this.get(`pireps_${key}`, {});
  },

  savePireps(key, state) {
    this.set(`pireps_${key}`, state);
  },
};

export default storage;
