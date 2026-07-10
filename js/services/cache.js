// Minimal dependency-free promise-based IndexedDB cache for offline persistence.
// DB `kneeboard` v1 — object stores: `briefing` (key `${flightNumber}_${date}`),
// `wx` (key ICAO). Every record wraps { data, savedAt }.
// All operations fail silently: if IndexedDB is unavailable the app runs normally.

const DB_NAME  = 'kneeboard';
const DB_VER   = 1;
const STORE_BRIEFING = 'briefing';
const STORE_WX       = 'wx';

let _dbPromise = null;

function _openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        reject(new Error('idb_unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_BRIEFING)) db.createObjectStore(STORE_BRIEFING);
        if (!db.objectStoreNames.contains(STORE_WX))       db.createObjectStore(STORE_WX);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error || new Error('idb_open_failed'));
    } catch (e) {
      reject(e);
    }
  }).catch(err => {
    // Reset so a later attempt can retry (e.g. private-mode quirks).
    _dbPromise = null;
    throw err;
  });
  return _dbPromise;
}

function _put(storeName, key, data) {
  return _openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put({ data, savedAt: Date.now() }, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error || new Error('idb_put_failed'));
      tx.onabort    = () => reject(tx.error || new Error('idb_put_aborted'));
    } catch (e) {
      reject(e);
    }
  })).catch(() => false);
}

function _get(storeName, key) {
  return _openDB().then(db => new Promise((resolve, reject) => {
    try {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null); // { data, savedAt } | null
      req.onerror   = () => reject(req.error || new Error('idb_get_failed'));
    } catch (e) {
      reject(e);
    }
  })).catch(() => null);
}

// ── Public API ────────────────────────────────────────────────────
// All resolve (never reject): put → boolean, get → { data, savedAt } | null.

export function putBriefing(key, data) { return _put(STORE_BRIEFING, key, data); }
export function getBriefing(key)       { return _get(STORE_BRIEFING, key); }
export function putWx(icao, data)      { return _put(STORE_WX, icao, data); }
export function getWx(icao)            { return _get(STORE_WX, icao); }

export default { putBriefing, getBriefing, putWx, getWx };
