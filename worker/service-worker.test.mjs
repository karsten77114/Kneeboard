// Service worker 回歸測試：以 vm 載入真實 sw.js
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const UTILS = readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8');

function loadSw({ fetchImpl, cached } = {}) {
  const handlers = {};
  const self = {
    location: { hostname: 'kneeboard.example.com' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
  };
  const ctx = {
    self,
    console: { log() {} },
    URL,
    Response,
    fetch: fetchImpl || (async () => { throw new TypeError('Failed to fetch'); }),
    caches: { match: async () => cached },
  };
  vm.runInNewContext(SRC, ctx);
  return handlers;
}

async function dispatchFetch(handlers, url) {
  let promise;
  handlers.fetch({ request: { url, method: 'GET' }, respondWith: p => { promise = p; } });
  return promise;
}

test('workers.dev network rejection 回 503 offline JSON', async () => {
  const res = await dispatchFetch(loadSw(), 'https://jx-briefing.karsten77114.workers.dev/api/notices');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.deepEqual(await res.json(), { error: 'offline' });
});

test('workers.dev network rejection 有快取時回快取', async () => {
  const cached = new Response('[]', { status: 200 });
  const res = await dispatchFetch(loadSw({ cached }), 'https://jx-briefing.karsten77114.workers.dev/api/notices');
  assert.equal(res, cached);
});

test('SW CACHE 版本與 utils APP_VERSION 同步為 v75', () => {
  const cache = SRC.match(/const CACHE = 'kneeboard-(v\d+)'/)[1];
  const app = UTILS.match(/APP_VERSION = '(v\d+)'/)[1];
  assert.equal(cache, 'v75');
  assert.equal(app, cache);
});

test('update.html 目標版本與 SW CACHE 同步', () => {
  const html = readFileSync(new URL('../update.html', import.meta.url), 'utf8');
  const cache = SRC.match(/const CACHE = '(kneeboard-v\d+)'/)[1];
  assert.equal(html.match(/TARGET = '(kneeboard-v\d+)'/)[1], cache);
  assert.match(html, /updateViaCache: 'none'/);
  assert.doesNotMatch(html, /unregister|localStorage|indexedDB/);
});

// 完整 SW 環境：記錄 install / activate / message 行為
function loadFullSw({ keys = [] } = {}) {
  const handlers = {};
  const requests = [];
  const deleted = [];
  const state = { skipped: false, claimed: false };
  const self = {
    location: { hostname: 'kneeboard.example.com' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { state.skipped = true; },
    clients: { claim: async () => { state.claimed = true; }, matchAll: async () => [] },
  };
  class FakeRequest {
    constructor(url, init = {}) { this.url = url; this.cache = init.cache; }
  }
  const ctx = {
    self, console: { log() {} }, URL, Response, Request: FakeRequest,
    fetch: async () => { throw new TypeError('x'); },
    caches: {
      open: async () => ({ addAll: async reqs => { requests.push(...reqs); } }),
      keys: async () => keys,
      delete: async k => { deleted.push(k); return true; },
    },
  };
  vm.runInNewContext(SRC, ctx);
  return { handlers, requests, deleted, state };
}

async function runExtendable(handler) {
  let p;
  handler({ waitUntil: x => { p = x; } });
  await p;
}

test('install 用 cache:reload 的 Request 預快取', async () => {
  const { handlers, requests, state } = loadFullSw();
  await runExtendable(handlers.install);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(r => r.cache === 'reload'));
  assert.ok(requests.some(r => r.url === './update.html'));
  assert.equal(state.skipped, true);
});

test('activate 只清 kneeboard- 前綴的舊 cache，不動其他 app', async () => {
  const { handlers, deleted, state } = loadFullSw({
    keys: ['kneeboard-v73', 'kneeboard-v74', 'kneeboard-v75', 'other-app-v1', 'logbook-cache'],
  });
  await runExtendable(handlers.activate);
  assert.deepEqual(deleted.sort(), ['kneeboard-v73', 'kneeboard-v74']);
  assert.equal(state.claimed, true);
});

test('GET_VERSION message 經 MessageChannel port 回 cache 版本', () => {
  const { handlers } = loadFullSw();
  const sent = [];
  handlers.message({ data: { type: 'GET_VERSION' }, ports: [{ postMessage: m => sent.push(m) }] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'VERSION');
  assert.equal(sent[0].version, 'kneeboard-v75');
  // 無 port 或其他訊息不回覆、不丟錯
  handlers.message({ data: { type: 'GET_VERSION' }, ports: [] });
  handlers.message({ data: { type: 'OTHER' }, ports: [{ postMessage: m => sent.push(m) }] });
  assert.equal(sent.length, 1);
});
