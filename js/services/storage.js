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

  // Auth helpers
  getLidoCredentials() {
    return {
      userId:   this.get('lido_userId'),
      password: this.get('lido_password'),
      token:    this.get('lido_token'),
    };
  },

  saveLidoSession(userId, password, token) {
    this.set('lido_userId',   userId);
    this.set('lido_password', password);
    this.set('lido_token',    token);
  },

  clearLidoSession() {
    this.remove('lido_token');
  },

  getELBCredentials() {
    return {
      userId:   this.get('elb_userId'),
      password: this.get('elb_password'),
      token:    this.get('elb_token'),
    };
  },

  saveELBSession(userId, password, token) {
    this.set('elb_userId',   userId);
    this.set('elb_password', password);
    this.set('elb_token',    token);
  },

  clearELBSession() {
    this.remove('elb_token');
  },

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
