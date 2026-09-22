import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const env = { LIDO_USER: 'test-user', LIDO_PASS: 'test-password' };
const csrf = btoa(JSON.stringify({ csrf_id: 'test-csrf', uid: 'test-user' }));
const loginOK = () => new Response('dwr.engine.remote.handleCallback("0","0",{errorCode:null});', {
  headers: { 'Set-Cookie': `lido_csrf=${csrf}; Path=/, lido_auth=test-auth; Path=/` },
});
const generateOK = () => new Response('dwr.engine.remote.handleCallback("0","0","test-dwr-session");');
const loginRequest = () => new Request('https://worker.test/auth/login', { method: 'POST' });

function mockRequests(t, handlers) {
  let calls = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.ok(calls < handlers.length, 'unexpected upstream request');
    return handlers[calls++](String(url), options);
  });
  t.after(() => assert.equal(calls, handlers.length));
}

test('cookie-free login page uses DWR bootstrap and authenticated flight lookup', async t => {
  mockRequests(t, [
    () => new Response('<html>Lido Authentication Service</html>'),
    (url, options) => {
      assert.ok(url.endsWith('/__System.generateId.dwr'));
      assert.match(options.body, /c0-methodName=generateId/);
      return generateOK();
    },
    (url, options) => {
      assert.ok(url.endsWith('/LoginBean.login.dwr'));
      assert.match(options.body, /scriptSessionId=test-dwr-session(?:%2F|\/)/);
      assert.match(options.headers.Cookie, /DWRSESSIONID=test-dwr-session/);
      assert.doesNotMatch(options.headers.Cookie, /lido_las=|las_serverid=|null|undefined/);
      assert.match(options.body, /c0-param1=string:test-password/);
      return loginOK();
    },
    (url, options) => {
      assert.ok(url.includes('/flightlist?'));
      assert.match(options.headers.Cookie, /lido_auth=test-auth/);
      assert.doesNotMatch(options.headers.Cookie, /lido_las=|las_serverid=|null|undefined/);
      return Response.json([{ flightNumber: '123', legId: 'test-leg', departureAirport: 'TPE', destinationAirport: 'NRT' }]);
    },
  ]);
  const response = await worker.fetch(loginRequest(), env);
  assert.equal(response.status, 200);
  const { sessionToken } = await response.json();
  const flights = await worker.fetch(new Request(`https://worker.test/flights?date=20260922&sessionToken=${encodeURIComponent(sessionToken)}`), env);
  assert.equal(flights.status, 200);
  assert.equal((await flights.json())[0].flight, '123');
});

test('legacy login retains server-provided session and affinity cookies', async t => {
  mockRequests(t, [
    () => new Response('login', { headers: { 'Set-Cookie': 'lido_las=legacy-session; Path=/, las_serverid=docker2; Path=/' } }),
    (url, options) => {
      assert.ok(url.endsWith('/LoginBean.login.dwr'));
      assert.match(options.headers.Cookie, /lido_las=legacy-session/);
      assert.match(options.headers.Cookie, /las_serverid=docker2/);
      return loginOK();
    },
  ]);
  assert.equal((await worker.fetch(loginRequest(), env)).status, 200);
});

test('login page HTTP errors stop before sending credentials', async t => {
  mockRequests(t, [() => new Response('unavailable', { status: 503 })]);
  const response = await worker.fetch(loginRequest(), env);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /503/);
});

test('malformed DWR bootstrap fails without sending credentials', async t => {
  mockRequests(t, [() => new Response('login'), () => new Response('<html>maintenance</html>')]);
  const response = await worker.fetch(loginRequest(), env);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /DWR/);
});

test('DWR bootstrap HTTP errors stop before sending credentials', async t => {
  mockRequests(t, [() => new Response('login'), () => new Response('unavailable', { status: 503 })]);
  const response = await worker.fetch(loginRequest(), env);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /503/);
});

test('rejected credentials are not reported as a successful login', async t => {
  mockRequests(t, [
    () => new Response('login'), generateOK,
    () => new Response('dwr.engine.remote.handleCallback("0","0",{errorCode:"BAD_LOGIN",errorMessage2:"Invalid credentials"});'),
  ]);
  const response = await worker.fetch(loginRequest(), env);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Invalid credentials');
});

test('missing authentication cookie is not reported as success', async t => {
  mockRequests(t, [() => new Response('login'), generateOK, () => new Response('{errorCode:null}')]);
  const response = await worker.fetch(loginRequest(), env);
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /lido_csrf/);
});
