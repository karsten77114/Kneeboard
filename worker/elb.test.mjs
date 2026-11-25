// ELB route 測試：以 worker default.fetch 驅動，fetch 與 Cloudflare WebSocket 皆為 mock，不連真實主機。
// 帳密、bearer、cookie 全為假值；不得放入任何真實憑證。
import test from 'node:test';
import assert from 'node:assert/strict';

import worker from './worker.js';

const ELB_HOST = 'https://sjx.ultramain.systems';
const ELB_PAGE = `${ELB_HOST}/elb/`;
const ELB_AUTH = `${ELB_HOST}/elb/auth`;
const ELB_TOKEN = `${ELB_HOST}/elb/api/users/getBearerToken`;
const ELB_WS_URL = `${ELB_HOST}/elb/session`;

const FAKE_ENV = { ELB_USER: 'fake-user', ELB_PASS: 'fake p@ss&w=rd+%/' };
const INITIAL_COOKIE = 'JSESSIONID=initial-session';
const ROTATED_COOKIE = 'JSESSIONID=rotated-session';
const OTHER_COOKIE = 'ULB=other-value';
const FAKE_BEARER = 'fake.bearer-token_123';
const SESSION_COOKIE = `${ROTATED_COOKIE}; ${OTHER_COOKIE}`;

// Cloudflare 的 101 response 帶 webSocket；Node 的 Response 不能建 101，所以用 plain object。
// events 依序記錄 accept / send，用來驗證 bearer 通知先於 req。
function fakeWsResponse({ onReq = msg => ({ type: 'res', id: msg.id, content: { aircraftIdentifier: 'B-58201' } }), config = true, syncConfig = false, dropAfterAccept = false } = {}) {
  const listeners = {};
  const sent = [];
  const events = [];
  const state = { accepted: false, closed: false, listenersBeforeAccept: false };
  const emit = (type, evt) => (listeners[type] || []).forEach(fn => fn(evt));
  const webSocket = {
    accept() {
      state.accepted = true;
      state.listenersBeforeAccept = ['message', 'error', 'close'].every(t => (listeners[t] || []).length > 0);
      events.push('accept');
      if (dropAfterAccept) setTimeout(() => emit('close', {}), 0);
      if (config) {
        const notify = () => emit('message', { data: JSON.stringify({ type: 'not', func: 'localApplicationConfiguration' }) });
        if (syncConfig) notify(); else setTimeout(notify, 0);
      }
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    send(data) {
      const msg = JSON.parse(data);
      sent.push(msg);
      events.push(`send:${msg.type}:${msg.func}`);
      if (msg.type === 'req') setTimeout(() => emit('message', { data: JSON.stringify(onReq(msg)) }), 0);
    },
    close() { state.closed = true; },
  };
  return { status: 101, headers: new Headers(), webSocket, sent, events, state, emit };
}

function jsonResponse(obj, extra = {}) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json', ...extra } });
}

function pageResponse(cookie = `${INITIAL_COOKIE}; Path=/elb; HttpOnly`) {
  const headers = new Headers();
  if (cookie) headers.append('set-cookie', cookie);
  return new Response('<html></html>', { status: 200, headers });
}

function authResponse() {
  const headers = new Headers();
  headers.append('set-cookie', `${ROTATED_COOKIE}; Path=/elb; HttpOnly`);
  headers.append('set-cookie', `${OTHER_COOKIE}; Path=/elb; Expires=Wed, 21 Oct 2037 07:28:00 GMT`);
  return new Response('', { status: 200, headers });
}

// 安裝 fetch mock；所有呼叫（含 body / init）記錄於 calls
function mockFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init.headers || {});
    calls.push({ url, headers, init, method: init.method || 'GET', body: init.body });
    return handler(url, headers, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// 正常登入流程的 handler；overrides 可替換個別 URL 的回應
function elbHandler(ws, overrides = {}) {
  return url => {
    if (url in overrides) return overrides[url]();
    if (url === ELB_PAGE) return pageResponse();
    if (url === ELB_AUTH) return authResponse();
    if (url === ELB_TOKEN) return jsonResponse({ token: FAKE_BEARER, expires: 1 });
    if (url === ELB_WS_URL) return ws;
    return new Response('unexpected', { status: 500 });
  };
}

const post = (path, body, env = FAKE_ENV) => worker.fetch(new Request(`https://worker.test${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), env);

const wsCalls = calls => calls.filter(c => c.headers.get('upgrade') === 'websocket');
const encodeSession = (s) => btoa(JSON.stringify({ ...s, ts: Date.now() }));
const goodSession = { sessionCookie: SESSION_COOKIE, bearer: FAKE_BEARER, origin: ELB_HOST };

// 回應與 console 輸出都不得含任何秘密
function assertNoSecrets(text) {
  for (const secret of [FAKE_ENV.ELB_USER, FAKE_ENV.ELB_PASS, FAKE_BEARER, 'initial-session', 'rotated-session', 'other-value']) {
    assert.ok(!String(text).includes(secret), `輸出不可含秘密：${secret.slice(0, 4)}…`);
  }
}

test('/auth/elb 成功：表單編碼、cookie rotation、bearer 通知順序、WS 驗證與 session 內容', async () => {
  const ws = fakeWsResponse();
  const m = mockFetch(elbHandler(ws));
  try {
    const res = await post('/auth/elb');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    const session = JSON.parse(atob(body.sessionToken));
    assert.equal(session.origin, ELB_HOST);
    assert.equal(session.bearer, FAKE_BEARER);
    assert.equal(session.sessionCookie, SESSION_COOKIE, 'rotated JSESSIONID 取代舊值並保留其他 cookie（Expires 逗號不可誤切）');
    assert.ok(Number.isFinite(session.ts));

    // 請求順序與內容
    assert.deepEqual(m.calls.map(c => c.url), [ELB_PAGE, ELB_AUTH, ELB_TOKEN, ELB_WS_URL]);
    assert.ok(m.calls.every(c => new URL(c.url).origin === ELB_HOST), '所有請求都只能打新 host');
    assert.ok(m.calls.every(c => c.init.redirect === 'manual'), '所有請求都不得跟隨 redirect');

    const login = m.calls[1];
    assert.equal(login.method, 'POST');
    assert.equal(login.headers.get('content-type'), 'application/x-www-form-urlencoded');
    assert.equal(login.headers.get('cookie'), INITIAL_COOKIE);
    const form = new URLSearchParams(login.body);
    assert.equal(form.get('j_username'), FAKE_ENV.ELB_USER);
    assert.equal(form.get('j_password'), FAKE_ENV.ELB_PASS, '特殊字元必須正確編碼並可還原');
    assert.ok(!String(login.body).includes(FAKE_ENV.ELB_PASS), '密碼不可未編碼地出現在 body');

    assert.equal(m.calls[2].headers.get('cookie'), SESSION_COOKIE, 'bearer 請求使用 rotated cookie');
    assert.equal(m.calls[3].headers.get('cookie'), SESSION_COOKIE);

    // WS：先註冊 listener 再 accept；bearer 通知先於任何 req；驗證查詢為 getAircraftState
    assert.equal(ws.state.listenersBeforeAccept, true);
    assert.deepEqual(ws.events, ['accept', 'send:not:authorization', 'send:req:getAircraftState']);
    assert.deepEqual(ws.sent[0], { type: 'not', func: 'authorization', content: { bearer: FAKE_BEARER } });
    assert.deepEqual(ws.sent[1].content, { id: 'B-58201' });
    assert.equal(ws.state.closed, true, '驗證後必須關閉 WS');
    assert.equal(m.calls[3].headers.get('authorization'), null, 'bearer 只走 WS 通知，不放 handshake header');
  } finally { m.restore(); }
});

test('/auth/elb 缺帳密 → 失敗且完全不發出 fetch；不使用 LIDO 或其他來源帳密', async () => {
  const m = mockFetch(() => { throw new Error('不應呼叫 fetch'); });
  try {
    for (const env of [{}, { ELB_USER: 'u' }, { ELB_PASS: 'p' }, { ELB_USER: '', ELB_PASS: '' }, { LIDO_USER: 'x', LIDO_PASS: 'y' }]) {
      const res = await post('/auth/elb', { username: 'caller', password: 'caller' }, env);
      const body = await res.json();
      assert.equal(res.status, 500);
      assert.equal(body.sessionToken, undefined);
      assert.notEqual(body.success, true);
    }
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

test('/auth/elb 忽略呼叫端提供的帳密，只用 env 的 ELB_USER / ELB_PASS', async () => {
  const ws = fakeWsResponse();
  const m = mockFetch(elbHandler(ws));
  try {
    await post('/auth/elb', { username: 'caller-user', password: 'caller-pass', j_username: 'x' });
    const form = new URLSearchParams(m.calls[1].body);
    assert.equal(form.get('j_username'), FAKE_ENV.ELB_USER);
    assert.equal(form.get('j_password'), FAKE_ENV.ELB_PASS);
    assert.ok(!String(m.calls[1].body).includes('caller'));
  } finally { m.restore(); }
});

test('/auth/elb 首頁沒有 session cookie → 失敗，不送出帳密', async () => {
  const m = mockFetch(() => pageResponse(''));
  try {
    const res = await post('/auth/elb');
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.sessionToken, undefined);
    assert.equal(m.calls.length, 1);
  } finally { m.restore(); }
});

for (const [label, make] of [
  ['登入 HTTP 401', () => new Response('bad credentials fake-user', { status: 401 })],
  ['登入 HTTP 500', () => new Response('boom', { status: 500 })],
  ['登入 302 redirect（不跟隨）', () => new Response(null, { status: 302, headers: { location: `${ELB_HOST}/elb/login?error` } })],
]) {
  test(`/auth/elb ${label} → 失敗，不取 token、不連 WS、不反射 body`, async () => {
    const ws = fakeWsResponse();
    const m = mockFetch(elbHandler(ws, { [ELB_AUTH]: make }));
    try {
      const res = await post('/auth/elb');
      const text = await res.text();
      assert.equal(res.status, 401);
      assert.equal(JSON.parse(text).sessionToken, undefined);
      assert.ok(!m.calls.some(c => c.url === ELB_TOKEN || c.url === ELB_WS_URL));
      assertNoSecrets(text);
    } finally { m.restore(); }
  });
}

for (const [label, make] of [
  ['HTML 登入頁（200）', () => new Response('<input name="j_username">', { headers: { 'content-type': 'text/html' } })],
  ['JSON 無 token', () => jsonResponse({ expires: 1 })],
  ['token 為空字串', () => jsonResponse({ token: '' })],
  ['token 非字串', () => jsonResponse({ token: { a: 1 } })],
  ['token 含空白 / 換行（格式錯誤）', () => jsonResponse({ token: 'bad token\r\nX-Evil: 1' })],
  ['非 JSON 內容', () => new Response('not json', { headers: { 'content-type': 'application/json' } })],
  ['token 請求 redirect', () => new Response(null, { status: 302, headers: { location: ELB_PAGE } })],
]) {
  test(`/auth/elb bearer token 回應異常：${label} → 失敗，不連 WS`, async () => {
    const ws = fakeWsResponse();
    const m = mockFetch(elbHandler(ws, { [ELB_TOKEN]: make }));
    try {
      const res = await post('/auth/elb');
      const text = await res.text();
      assert.equal(res.status, 401);
      assert.equal(JSON.parse(text).sessionToken, undefined);
      assert.equal(wsCalls(m.calls).length, 0);
      assertNoSecrets(text);
    } finally { m.restore(); }
  });
}

test('/auth/elb WS 握手失敗（非 101）→ 失敗，不回 success / sessionToken', async () => {
  const m = mockFetch(elbHandler(null, { [ELB_WS_URL]: () => new Response('forbidden', { status: 403 }) }));
  try {
    const res = await post('/auth/elb');
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(res.status, 401);
    assert.notEqual(body.success, true);
    assert.equal(body.sessionToken, undefined);
    assert.match(body.error, /session 已失效/);
    assertNoSecrets(text);
  } finally { m.restore(); }
});

test('/auth/elb 101 握手成功但查詢回 null / 非物件 / fail → 不得標示成功', async () => {
  const cases = [
    msg => ({ type: 'res', id: msg.id, content: null }),
    msg => ({ type: 'res', id: msg.id, content: 'ok' }),
    msg => ({ type: 'res', id: msg.id, content: {} }),
    msg => ({ type: 'res', id: msg.id, content: [] }),
    msg => ({ type: 'res', id: msg.id, content: { aircraftIdentifier: 'B-58202' } }),
    msg => ({ type: 'fail', id: msg.id, content: { message: `denied fake-user ${FAKE_BEARER}` } }),
  ];
  for (const onReq of cases) {
    const ws = fakeWsResponse({ onReq });
    const m = mockFetch(elbHandler(ws));
    try {
      const res = await post('/auth/elb');
      const text = await res.text();
      assert.equal(res.status, 401);
      assert.equal(JSON.parse(text).success, undefined);
      assert.equal(JSON.parse(text).sessionToken, undefined);
      assertNoSecrets(text);
    } finally { m.restore(); }
  }
});

test('/auth/elb WS 在查詢前中斷 → 失敗且不 false green', async () => {
  const ws = fakeWsResponse({ config: false, dropAfterAccept: true });
  const m = mockFetch(elbHandler(ws));
  try {
    const res = await post('/auth/elb');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).sessionToken, undefined);
  } finally { m.restore(); }
});

test('/auth/elb 網路例外與 console 輸出不含秘密', async () => {
  const logged = [];
  const origErr = console.error, origLog = console.log, origWarn = console.warn;
  console.error = console.log = console.warn = (...a) => logged.push(a.join(' '));
  const m = mockFetch(url => {
    if (url === ELB_PAGE) return pageResponse();
    throw new Error(`network down fake-user ${FAKE_ENV.ELB_PASS}`);
  });
  try {
    const res = await post('/auth/elb');
    const text = await res.text();
    assert.equal(res.status, 401);
    assertNoSecrets(text);
    assertNoSecrets(logged.join('\n'));
  } finally { m.restore(); Object.assign(console, { error: origErr, log: origLog, warn: origWarn }); }
});

test('/api/elb/query 新 session：先送 bearer 通知再送 req，caller func/content 原樣轉送，回傳實際內容', async () => {
  const ws = fakeWsResponse({ onReq: msg => ({ type: 'res', id: msg.id, content: { echoed: msg.func, args: msg.content } }) });
  const m = mockFetch(url => (url === ELB_WS_URL ? ws : new Response('unexpected', { status: 500 })));
  try {
    const res = await post('/api/elb/query', { sessionToken: encodeSession(goodSession), func: 'getAircraft', content: { reg: 'B-00000' } });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data, { echoed: 'getAircraft', args: { reg: 'B-00000' } });

    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].url, ELB_WS_URL);
    assert.equal(m.calls[0].headers.get('upgrade'), 'websocket');
    assert.equal(m.calls[0].headers.get('cookie'), SESSION_COOKIE);
    assert.equal(ws.state.listenersBeforeAccept, true);
    assert.deepEqual(ws.events, ['accept', 'send:not:authorization', 'send:req:getAircraft']);
    assert.deepEqual(ws.sent[0].content, { bearer: FAKE_BEARER });
    assert.deepEqual(ws.sent[1], { id: 1, type: 'req', func: 'getAircraft', content: { reg: 'B-00000' } });
    assert.equal(ws.state.closed, true);
  } finally { m.restore(); }
});

test('/api/elb/query 舊 session（無 bearer / 無 origin / 舊 host / 空字串 / 非字串）→ 401，不打外部請求', async () => {
  const m = mockFetch(() => { throw new Error('不應呼叫 fetch'); });
  try {
    const bad = [
      { sessionCookie: 'JSESSIONID=old' },
      { sessionCookie: SESSION_COOKIE, bearer: FAKE_BEARER },
      { sessionCookie: SESSION_COOKIE, bearer: FAKE_BEARER, origin: 'https://old.example.com' },
      { sessionCookie: SESSION_COOKIE, bearer: null, origin: ELB_HOST },
      { sessionCookie: '  ', bearer: FAKE_BEARER, origin: ELB_HOST },
      { sessionCookie: 123, bearer: FAKE_BEARER, origin: ELB_HOST },
      { sessionCookie: SESSION_COOKIE, bearer: ['x'], origin: ELB_HOST },
      null,
      'string',
    ];
    for (const s of bad) {
      const res = await post('/api/elb/query', { sessionToken: encodeSession(s), func: 'getAircraft' });
      assert.equal(res.status, 401, JSON.stringify(s));
    }
    assert.equal(m.calls.length, 0);
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

test('/api/elb/query 授權過期 → 401 觸發前端重登，不回 ok、不含秘密', async () => {
  const m = mockFetch(() => new Response(`unauthorized ${FAKE_BEARER}`, { status: 401 }));
  try {
    const res = await post('/api/elb/query', { sessionToken: encodeSession(goodSession), func: 'getAircraft' });
    const text = await res.text();
    assert.equal(res.status, 401);
    assert.notEqual(JSON.parse(text).ok, true);
    assert.match(JSON.parse(text).error, /session 已失效/);
    assertNoSecrets(text);
  } finally { m.restore(); }
});

test('/api/elb/query 上游 fail 訊息不反射給呼叫端', async () => {
  const ws = fakeWsResponse({ onReq: msg => ({ type: 'fail', id: msg.id, content: { message: `secret ${FAKE_BEARER}` } }) });
  const m = mockFetch(() => ws);
  try {
    const res = await post('/api/elb/query', { sessionToken: encodeSession(goodSession), func: 'getAircraft' });
    const text = await res.text();
    assert.equal(res.status, 502);
    assertNoSecrets(text);
    assert.equal(ws.state.closed, true);
  } finally { m.restore(); }
});

test('/api/elb/query 連線中斷 → 502 並清理（close 只結算一次）', async () => {
  const ws = fakeWsResponse({ config: false, dropAfterAccept: true });
  const m = mockFetch(() => ws);
  try {
    const res = await post('/api/elb/query', { sessionToken: encodeSession(goodSession), func: 'getAircraft' });
    assert.equal(res.status, 502);
    assert.equal(ws.state.closed, true);
  } finally { m.restore(); }
});

test('/auth/elb → /api/elb/query 串接：登入產生的 session 可直接用於查詢', async () => {
  const ws = fakeWsResponse();
  const m = mockFetch(elbHandler(ws));
  try {
    const auth = await (await post('/auth/elb')).json();
    const q = await post('/api/elb/query', { sessionToken: auth.sessionToken, func: 'ping' });
    assert.equal(q.status, 200);
    const calls = wsCalls(m.calls);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(c => c.url === ELB_WS_URL && c.headers.get('cookie') === SESSION_COOKIE));
  } finally { m.restore(); }
});


test('/auth/elb 即時 configuration 通知不會搶在 bearer 授權前送查詢', async () => {
  const ws = fakeWsResponse({ syncConfig: true });
  const m = mockFetch(elbHandler(ws));
  try {
    const res = await post('/auth/elb');
    assert.equal(res.status, 200);
    assert.deepEqual(ws.events, ['accept', 'send:not:authorization', 'send:req:getAircraftState']);
    assert.deepEqual(ws.sent[1].content, { id: 'B-58201' });
  } finally { m.restore(); }
});

// 上游 getBearerToken 的 204 是支援 cookie session，不代表登入失敗。
for (const valid of [true, false]) {
  test(`/auth/elb HTTP 204 cookie session：實際查詢${valid ? '成功才登入' : '無效仍拒絕'}`, async () => {
    const ws = fakeWsResponse({ syncConfig: true, onReq: msg => ({ type: 'res', id: msg.id, content: valid ? { aircraftIdentifier: 'B-58201' } : null }) });
    const m = mockFetch(elbHandler(ws, { [ELB_TOKEN]: () => new Response(null, { status: 204 }) }));
    try {
      const res = await post('/auth/elb');
      const result = await res.json();
      assert.equal(res.status, valid ? 200 : 401);
      assert.equal(ws.sent.some(msg => msg.func === 'authorization'), false);
      assert.equal(ws.sent.filter(msg => msg.type === 'req').length, 1);
      if (valid) {
        const session = JSON.parse(atob(result.sessionToken));
        assert.equal(session.bearer, '');
        const query = await post('/api/elb/query', { sessionToken: result.sessionToken, func: 'getAircraftState', content: { id: 'B-58201' } });
        assert.equal(query.status, 200);
        assert.equal((await query.json()).data.aircraftIdentifier, 'B-58201');
      } else assert.equal(result.sessionToken, undefined);
    } finally { m.restore(); }
  });
}
