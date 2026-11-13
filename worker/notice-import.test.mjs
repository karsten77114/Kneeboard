import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const TOKEN = 'test-upload-token';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

let fetchCalls;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = async (...args) => {
    fetchCalls.push(args);
    throw new Error('unexpected external fetch');
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

function makeKV(initial = {}, { failPut = false, failGet = false } = {}) {
  const store = new Map(Object.entries(initial));
  const kv = {
    store, gets: 0, puts: 0,
    async get(key) { kv.gets++; if (failGet) throw new Error('kv get down'); return store.has(key) ? store.get(key) : null; },
    async put(key, value) { kv.puts++; if (failPut) throw new Error('kv put down'); store.set(key, value); },
  };
  return kv;
}

const list = kv => JSON.parse(kv.store.get('notices_list') || '[]');

function notice(over = {}) {
  return {
    title: '測試公告',
    issue_date: '2026-11-14',
    effective_date: null,
    source: 'FN-26-0000',
    source_tag: 'fleet_notice',
    tags: ['ops'],
    aircraft: ['A321', 'all'],
    urgency: 'normal',
    summary: ['重點一', '重點二'],
    action_required: '知悉即可',
    raw_text: '原文節錄',
    ...over,
  };
}
function prov(over = {}) {
  return {
    kind: 'apple_notes',
    note_id: '981A7BC4-CE8E-45C6-8067-B542AD4911F2',
    item_id: 'text:abc',
    sha256: SHA_A,
    filename: 'note.txt',
    ...over,
  };
}
const payload = (n = {}, p = {}) => ({ notice: notice(n), provenance: prov(p) });

async function post(body, { kv, token = TOKEN, query = '', raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const req = new Request(`https://w.test/api/notices/import${query}`, {
    method: 'POST', headers, body: raw ?? JSON.stringify(body),
  });
  const env = { UPLOAD_TOKEN: TOKEN, GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' };
  if (kv) env.NOTICES_KV = kv;
  const res = await worker.fetch(req, env);
  return { status: res.status, json: await res.json() };
}

test('created: writes validated notice, no AI/external fetch', async () => {
  const kv = makeKV();
  const { status, json } = await post(payload(), { kv });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.saved, true);
  assert.equal(json.action, 'created');
  assert.equal(json.notice_issue_date, '2026-11-14');
  assert.equal(json.total, 1);
  const [stored] = list(kv);
  assert.equal(stored.id, json.notice_id);
  assert.equal(stored._source.sha256, SHA_A);
  assert.deepEqual(stored.aircraft, ['a321', 'all']);
  assert.equal(fetchCalls.length, 0);
});

test('unauthenticated import is rejected without touching KV', async () => {
  const kv = makeKV();
  for (const token of ['', 'wrong']) {
    const { status } = await post(payload(), { kv, token });
    assert.equal(status, 401);
  }
  assert.equal(kv.gets + kv.puts, 0);
  assert.equal(fetchCalls.length, 0);
});

test('dry_run validates only: no KV read or write, saved=false', async () => {
  const kv = makeKV();
  const { status, json } = await post(payload(), { kv, query: '?dry_run=true' });
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.saved, false);
  assert.equal(json.dry_run, true);
  assert.equal(json.preview.title, '測試公告');
  assert.equal(kv.gets, 0);
  assert.equal(kv.puts, 0);
  assert.equal(fetchCalls.length, 0);
});

test('dry_run still rejects invalid input', async () => {
  const kv = makeKV();
  const { status } = await post(payload({ issue_date: '2026-02-30' }), { kv, query: '?dry_run=true' });
  assert.equal(status, 400);
  assert.equal(kv.gets + kv.puts, 0);
});

test('same sha256 retry does not add or modify', async () => {
  const kv = makeKV();
  const first = await post(payload(), { kv });
  const before = kv.store.get('notices_list');
  const putsBefore = kv.puts;
  const retry = await post(payload({ title: '不同標題', summary: ['完全不同'] }), { kv });
  assert.equal(retry.status, 200);
  assert.equal(retry.json.action, 'duplicate');
  assert.equal(retry.json.notice_id, first.json.notice_id);
  assert.equal(retry.json.total, 1);
  assert.equal(kv.puts, putsBefore);
  assert.equal(kv.store.get('notices_list'), before);
});

test('fingerprint match updates in place and keeps id/created_at', async () => {
  const kv = makeKV();
  const first = await post(payload(), { kv });
  const created = list(kv)[0];
  const second = await post(payload({ summary: ['更新後重點'] }, { sha256: SHA_B }), { kv });
  assert.equal(second.json.action, 'updated');
  assert.equal(second.json.notice_id, first.json.notice_id);
  assert.equal(second.json.total, 1);
  const [stored] = list(kv);
  assert.equal(stored.id, created.id);
  assert.equal(stored.created_at, created.created_at);
  assert.ok(stored.updated_at);
  assert.deepEqual(stored.summary, ['更新後重點']);
  assert.equal(stored._source.sha256, SHA_B);
});

test('different notice is prepended as a new entry', async () => {
  const kv = makeKV();
  await post(payload(), { kv });
  const r = await post(payload({ source: 'FN-26-0001' }, { sha256: SHA_B }), { kv });
  assert.equal(r.json.action, 'created');
  assert.equal(r.json.total, 2);
  assert.equal(list(kv)[0].id, r.json.notice_id);
});

test('list is capped at 200 entries', async () => {
  const existing = Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}`, source: `X-${i}`, title: `t${i}`, issue_date: '2026-01-01' }));
  const kv = makeKV({ notices_list: JSON.stringify(existing) });
  const r = await post(payload(), { kv });
  assert.equal(r.json.total, 200);
  assert.equal(list(kv).length, 200);
  assert.equal(list(kv)[0].id, r.json.notice_id);
});

test('invalid calendar dates are rejected', async () => {
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-4-5', '2026-11-31', 'not-a-date']) {
    const kv = makeKV();
    const a = await post(payload({ issue_date: bad }), { kv });
    assert.equal(a.status, 400, `issue_date ${bad}`);
    const b = await post(payload({ effective_date: bad }), { kv });
    assert.equal(b.status, 400, `effective_date ${bad}`);
    assert.equal(kv.puts, 0);
  }
  const ok = await post(payload({ issue_date: '2028-02-29' }), { kv: makeKV() });
  assert.equal(ok.status, 200);
});

test('forged managed fields and unknown fields are rejected', async () => {
  for (const extra of [{ id: 'forged' }, { created_at: '2020-01-01T00:00:00Z' }, { updated_at: 'x' },
    { source_type: 'pdf' }, { _source: {} }, { category: 'ops' }]) {
    const kv = makeKV();
    const r = await post(payload(extra), { kv });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(kv.puts, 0);
  }
  const kv = makeKV();
  const r = await post({ ...payload(), id: 'forged' }, { kv });
  assert.equal(r.status, 400);
  const r2 = await post(payload({}, { extra: 1 }), { kv });
  assert.equal(r2.status, 400);
});

test('schema violations return 400 with readable message', async () => {
  const cases = [
    payload({ title: '  ' }),
    payload({ source: '' }),
    payload({ source_tag: 'app_notice' }),
    payload({ tags: [] }),
    payload({ tags: ['bogus'] }),
    payload({ aircraft: ['b747'] }),
    payload({ urgency: 'critical' }),
    payload({ summary: [] }),
    payload({ summary: Array.from({ length: 8 }, (_, i) => `item ${i}`) }),
    payload({ summary: ['same', 'same'] }),
    payload({ summary: ['ok', ''] }),
    payload({}, { kind: 'other' }),
    payload({}, { note_id: '' }),
    payload({}, { sha256: 'A'.repeat(64) }),
    payload({}, { sha256: 'abc' }),
    payload({}, { filename: 'a/b.txt' }),
    payload({}, { filename: 'a\\b.txt' }),
    payload({}, { filename: 'a\0b.txt' }),
    { notice: notice() },
  ];
  for (const body of cases) {
    const kv = makeKV();
    const r = await post(body, { kv });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.saved, false);
    assert.match(r.json.message, /匯入失敗/);
    assert.equal(kv.puts, 0);
  }
});

test('malformed JSON returns 400', async () => {
  const kv = makeKV();
  const r = await post(null, { kv, raw: '{not json' });
  assert.equal(r.status, 400);
  assert.equal(r.json.saved, false);
  assert.equal(kv.puts, 0);
});

test('missing NOTICES_KV fails with 503 (not saved)', async () => {
  const r = await post(payload());
  assert.equal(r.status, 503);
  assert.equal(r.json.saved, false);
  assert.equal(r.json.ok, false);
});

test('KV put failure returns 500 and is not reported as saved', async () => {
  const kv = makeKV({}, { failPut: true });
  const r = await post(payload(), { kv });
  assert.equal(r.status, 500);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.saved, false);
  assert.match(r.json.message, /儲存失敗/);
  assert.equal(list(kv).length, 0);
});

test('KV get failure returns 500 and is not reported as saved', async () => {
  const kv = makeKV({}, { failGet: true });
  const r = await post(payload(), { kv });
  assert.equal(r.status, 500);
  assert.equal(r.json.saved, false);
  assert.equal(kv.puts, 0);
});

test('imported notice is readable via GET /api/notices with _source.sha256', async () => {
  const kv = makeKV();
  const r = await post(payload(), { kv });
  const res = await worker.fetch(new Request('https://w.test/api/notices'), { NOTICES_KV: kv });
  const got = await res.json();
  const found = got.find(n => n.id === r.json.notice_id);
  assert.equal(found._source.sha256, SHA_A);
  assert.equal(fetchCalls.length, 0);
});
