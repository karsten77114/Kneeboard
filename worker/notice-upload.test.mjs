// Behaviour tests for POST /api/notices/upload (run: node --test worker/notice-upload.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const TOKEN = 'test-token';
const realFetch = globalThis.fetch;

function makeKV(initial = [], { failPut = false } = {}) {
  const store = new Map();
  if (initial) store.set('notices_list', JSON.stringify(initial));
  const kv = {
    gets: 0, puts: 0,
    async get(k) { kv.gets++; return store.has(k) ? store.get(k) : null; },
    async put(k, v) { kv.puts++; if (failPut) throw new Error('KV put boom'); store.set(k, v); },
    list: () => JSON.parse(store.get('notices_list') || '[]'),
  };
  return kv;
}

function mockModel(payload) {
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }), { status: 200 });
}

const single = (over = {}) => ({
  title: '測試公告', issue_date: '2026-05-14', effective_date: null, source: 'FN-26-0001',
  source_tag: 'fleet_notice', tags: ['ops'], aircraft: ['all'], urgency: 'normal',
  summary: ['重點一', '重點二'], action_required: null, ...over,
});

function upload(env, { query = '', text = '公告內容' } = {}) {
  return worker.fetch(new Request(`https://w.test/api/notices/upload?${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source: 'FN 公告' }),
  }), env);
}

const mkEnv = (kv) => ({ UPLOAD_TOKEN: TOKEN, GEMINI_API_KEY: 'k', ...(kv ? { NOTICES_KV: kv } : {}) });

test.afterEach(() => { globalThis.fetch = realFetch; });

test('missing NOTICES_KV binding: real upload fails closed (single and batch)', async () => {
  mockModel(single());
  let res = await upload(mkEnv(null));
  let body = await res.json();
  assert.equal(body.ok, false);
  assert.notEqual(res.status, 200);
  assert.match(body.message, /^❌/);

  mockModel([single()]);
  res = await upload(mkEnv(null), { query: 'batch=true' });
  body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /^❌/);
});

test('single dry_run never touches KV and creates nothing', async () => {
  const kv = makeKV([]);
  mockModel(single());
  const res = await upload(mkEnv(kv), { query: 'dry_run=true' });
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.saved, false);
  assert.equal(body.dry_run, true);
  assert.match(body.message, /僅分析預覽，未儲存/);
  assert.equal(kv.gets, 0);
  assert.equal(kv.puts, 0);
  assert.equal(kv.list().length, 0);
  assert.ok(!JSON.stringify(body).includes(TOKEN));
});

test('dry_run works without a KV binding', async () => {
  mockModel(single());
  const body = await (await upload(mkEnv(null), { query: 'dry_run=true' })).json();
  assert.equal(body.ok, true);
  assert.equal(body.saved, false);
});

test('batch dry_run never touches KV and creates nothing', async () => {
  const kv = makeKV([]);
  mockModel([single(), single({ title: '另一則', source: 'FN-26-0002' })]);
  const body = await (await upload(mkEnv(kv), { query: 'batch=true&dry_run=true' })).json();
  assert.equal(body.ok, true);
  assert.equal(body.saved, false);
  assert.equal(body.dry_run, true);
  assert.equal(body.count, 0);
  assert.match(body.message, /僅分析預覽，未儲存/);
  assert.equal(kv.gets, 0);
  assert.equal(kv.puts, 0);
  assert.equal(kv.list().length, 0);
});

test('single create then duplicate update: action, timestamps, total', async () => {
  const kv = makeKV([]);
  mockModel(single());
  let body = await (await upload(mkEnv(kv))).json();
  assert.equal(body.ok, true);
  assert.equal(body.saved, true);
  assert.equal(body.action, 'created');
  assert.equal(body.total, 1);
  assert.equal(body.updated, false);
  assert.match(body.message, /已新增/);
  assert.match(body.message, /2026-05-14/);
  const createdAt = kv.list()[0].created_at;
  const id = body.notice_id;

  await new Promise(r => setTimeout(r, 5));
  mockModel(single({ summary: ['更新一', '更新二'] }));
  body = await (await upload(mkEnv(kv))).json();
  assert.equal(body.ok, true);
  assert.equal(body.saved, true);
  assert.equal(body.action, 'updated');
  assert.equal(body.total, 1);
  assert.equal(body.updated, true);
  assert.equal(body.notice_id, id);
  assert.match(body.message, /已更新既有公告（不新增筆數）/);
  assert.match(body.message, /2026-05-14/);
  const stored = kv.list();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].created_at, createdAt);
  assert.ok(stored[0].updated_at);
  assert.notEqual(stored[0].updated_at, createdAt);
  assert.deepEqual(stored[0].summary, ['更新一', '更新二']);
});

test('all-duplicate batch is not reported as success and writes nothing', async () => {
  const kv = makeKV([]);
  mockModel(single());
  await upload(mkEnv(kv));
  const putsBefore = kv.puts;

  mockModel([single()]);
  const body = await (await upload(mkEnv(kv), { query: 'batch=true' })).json();
  assert.equal(body.ok, true);
  assert.equal(body.saved, false);
  assert.equal(body.count, 0);
  assert.equal(body.skipped, 1);
  assert.equal(body.total, 1);
  assert.ok(!body.message.includes('✅'));
  assert.match(body.message, /未新增/);
  assert.equal(kv.puts, putsBefore);
});

test('KV put rejection yields explicit failure (single and batch)', async () => {
  const kv = makeKV([], { failPut: true });
  mockModel(single());
  let res = await upload(mkEnv(kv));
  let body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.saved, false);
  assert.match(body.message, /^❌/);
  assert.equal(typeof body.message, 'string');
  assert.notEqual(res.status, 200);

  mockModel([single()]);
  res = await upload(mkEnv(kv), { query: 'batch=true' });
  body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /^❌/);
});

test('top-level catch returns ok:false with string message and no headers/secrets', async t => {
  t.mock.method(console, 'error', () => {});
  const env = mkEnv(makeKV([]));
  env.NOTICES_KV.get = async () => { throw new Error('kv read exploded'); };
  const res = await worker.fetch(new Request('https://w.test/api/notices', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }), env);
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.ok, false);
  assert.equal(typeof body.message, 'string');
  assert.match(body.message, /kv read exploded/);
  assert.ok(!JSON.stringify(body).includes(TOKEN));
});

test('dry_run still requires upload authorization', async () => {
  const kv = makeKV([]);
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls++; throw new Error('must not analyze'); };
  const res = await worker.fetch(new Request('https://w.test/api/notices/upload?dry_run=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '公告' }),
  }), mkEnv(kv));
  assert.equal(res.status, 401);
  assert.equal(modelCalls, 0);
  assert.equal(kv.gets, 0);
  assert.equal(kv.puts, 0);
});
