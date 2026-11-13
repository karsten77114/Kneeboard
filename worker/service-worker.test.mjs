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

test('SW CACHE 版本與 utils APP_VERSION 同步為 v74', () => {
  const cache = SRC.match(/const CACHE = 'kneeboard-(v\d+)'/)[1];
  const app = UTILS.match(/APP_VERSION = '(v\d+)'/)[1];
  assert.equal(cache, 'v74');
  assert.equal(app, cache);
});
