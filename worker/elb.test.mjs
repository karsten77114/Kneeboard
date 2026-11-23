// ELB route 測試：以 worker default.fetch 驅動，fetch 與 Cloudflare WebSocket 皆為 mock，不連真實主機
import test from 'node:test';
import assert from 'node:assert/strict';

import worker from './worker.js';

const ELB_HOST = 'https://sjx.ultramain.systems';
const ELB_PAGE = `${ELB_HOST}/elb/`;
const ELB_WS_URL = `${ELB_HOST}/elb/session`;
const FAKE_COOKIE = 'JSESSIONID=mock-session-value';

// Cloudflare 的 101 response 帶 webSocket；Node 的 Response 不能建 101，所以用 plain object
function fakeWsResponse(onSend) {
  const listeners = {};
  const sent = [];
  const state = { accepted: false, closed: false };
  const emit = (type, evt) => (listeners[type] || []).forEach(fn => fn(evt));
  const webSocket = {
    accept() {
      state.accepted = true;
      // 與真實 ELB 相同：連線後伺服器先送 localApplicationConfiguration 通知
      setTimeout(() => emit('message', { data: JSON.stringify({ type: 'not', func: 'localApplicationConfiguration' }) }), 0);
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    send(data) {
      const msg = JSON.parse(data);
      sent.push(msg);
      setTimeout(() => emit('message', { data: JSON.stringify(onSend(msg)) }), 0);
    },
    close() { state.closed = true; },
  };
  return { status: 101, headers: new Headers(), webSocket, sent, state };
}

const pageResponse = (cookie = `${FAKE_COOKIE}; Path=/; HttpOnly`) =>
  new Response('<html></html>', { status: 200, headers: cookie ? { 'set-cookie': cookie } : {} });

// 安裝 fetch mock；routes 依 URL 回應，所有呼叫記錄於 calls
function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || {});
    calls.push({ url, headers, init });
    return handler(url, headers);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const post = (path, body) => worker.fetch(new Request(`https://worker.test${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), {});

const wsCalls = calls => calls.filter(c => c.headers.get('upgrade') === 'websocket');

test('/auth/elb 取新 host 首頁 cookie，並對新 HTTPS WS endpoint 握手（帶 cookie）', async () => {
  const ws = fakeWsResponse(() => ({}));
  const m = mockFetch(url => (url === ELB_PAGE ? pageResponse() : url === ELB_WS_URL ? ws : new Response('unexpected', { status: 500 })));
  try {
    const res = await post('/auth/elb');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(JSON.parse(atob(body.sessionToken)).sessionCookie, FAKE_COOKIE);

    assert.equal(m.calls.length, 2);
    assert.equal(m.calls[0].url, ELB_PAGE);
    assert.equal(m.calls[1].url, ELB_WS_URL);
    assert.equal(m.calls[1].headers.get('upgrade'), 'websocket');
    assert.equal(m.calls[1].headers.get('cookie'), FAKE_COOKIE);
    assert.ok(m.calls.every(c => new URL(c.url).origin === ELB_HOST), '所有請求都只能打新 host');
    assert.equal(ws.state.accepted, true);
    assert.equal(ws.state.closed, true, '驗證後必須關閉 WS');
  } finally { m.restore(); }
});

test('/api/elb/query 沿用 token 內 cookie，對同一個新 WS endpoint 查詢並回傳資料', async () => {
  const token = btoa(JSON.stringify({ sessionCookie: FAKE_COOKIE, ts: Date.now() }));
  const ws = fakeWsResponse(msg => ({ type: 'res', id: msg.id, content: { echoed: msg.func, args: msg.content } }));
  const m = mockFetch(url => (url === ELB_WS_URL ? ws : new Response('unexpected', { status: 500 })));
  try {
    const res = await post('/api/elb/query', { sessionToken: token, func: 'getAircraft', content: { reg: 'B-00000' } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, { echoed: 'getAircraft', args: { reg: 'B-00000' } });

    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, ELB_WS_URL);
    assert.equal(m.calls[0].headers.get('upgrade'), 'websocket');
    assert.equal(m.calls[0].headers.get('cookie'), FAKE_COOKIE);
    assert.equal(ws.sent.length, 1);
    assert.equal(ws.sent[0].type, 'req');
  } finally { m.restore(); }
});

test('/auth/elb → /api/elb/query 串接：cookie 由第一步傳到第二步，兩步都打新 WS endpoint', async () => {
  const m = mockFetch(url => {
    if (url === ELB_PAGE) return pageResponse();
    if (url === ELB_WS_URL) return fakeWsResponse(msg => ({ type: 'res', id: msg.id, content: [] }));
    return new Response('unexpected', { status: 500 });
  });
  try {
    const auth = await (await post('/auth/elb')).json();
    const q = await post('/api/elb/query', { sessionToken: auth.sessionToken, func: 'ping' });
    assert.equal(q.status, 200);
    const ws = wsCalls(m.calls);
    assert.equal(ws.length, 2);
    assert.ok(ws.every(c => c.url === ELB_WS_URL));
    assert.ok(ws.every(c => c.headers.get('cookie') === FAKE_COOKIE));
  } finally { m.restore(); }
});

test('/auth/elb WS 握手失敗（非 101）→ 401 失敗，不回 success / sessionToken', async () => {
  const m = mockFetch(url => (url === ELB_PAGE ? pageResponse() : new Response('forbidden', { status: 403 })));
  try {
    const res = await post('/auth/elb');
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.notEqual(body.success, true);
    assert.equal(body.sessionToken, undefined);
    assert.match(body.error, /WebSocket 驗證失敗.*403/);
    assert.equal(wsCalls(m.calls).length, 1, '確實嘗試過握手');
  } finally { m.restore(); }
});

test('/auth/elb 首頁沒有 session cookie → 失敗且不嘗試 WS', async () => {
  const m = mockFetch(() => pageResponse(''));
  try {
    const res = await post('/auth/elb');
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.sessionToken, undefined);
    assert.equal(wsCalls(m.calls).length, 0);
  } finally { m.restore(); }
});

test('/api/elb/query WS 握手失敗 → 502 錯誤，不回 ok', async () => {
  const token = btoa(JSON.stringify({ sessionCookie: FAKE_COOKIE, ts: Date.now() }));
  const m = mockFetch(() => new Response('unauthorized', { status: 401 }));
  try {
    const res = await post('/api/elb/query', { sessionToken: token, func: 'getAircraft' });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.notEqual(body.ok, true);
    assert.match(body.error, /WebSocket 連線失敗.*401/);
    assert.equal(m.calls[0].url, ELB_WS_URL);
  } finally { m.restore(); }
});

test('/api/elb/query 缺 func 或 token 無效時不打任何外部請求', async () => {
  const m = mockFetch(() => { throw new Error('不應呼叫 fetch'); });
  try {
    assert.equal((await post('/api/elb/query', { sessionToken: 'x' })).status, 400);
    assert.equal((await post('/api/elb/query', { sessionToken: '%%%', func: 'f' })).status, 401);
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});


test('/auth/elb 新站回登入頁時明確失敗，不顯示連線成功', async () => {
  const m = mockFetch(url => url === ELB_PAGE ? pageResponse() : new Response('<input name="j_username">', { headers: { 'Content-Type': 'text/html' } }));
  try {
    const res = await post('/auth/elb');
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.match(body.error, /登入授權/);
    assert.equal(body.sessionToken, undefined);
  } finally { m.restore(); }
});
