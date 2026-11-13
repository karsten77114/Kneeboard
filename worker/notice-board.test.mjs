// 公告欄 fetch 回歸測試：以 vm 載入真實 js/views/notice-board.js
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../js/views/notice-board.js', import.meta.url), 'utf8')
  .replace(/^export /gm, '')
  + '\n;globalThis.__nb = { fetchNotices: _fetch, getNotices: () => _notices };';

function load(fetchImpl) {
  const list = {
    innerHTML: '',
    querySelector(sel) {
      return sel === '#nb-retry-btn' && this.innerHTML.includes('nb-retry-btn') ? (this.retry ||= {}) : null;
    },
    querySelectorAll: () => [],
  };
  const badge = { textContent: '', style: {} };
  const ctx = {
    document: { getElementById: id => (id === 'nb-list' ? list : id === 'nb-badge' ? badge : null) },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: fetchImpl,
    console,
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(SRC, ctx);
  return { nb: ctx.__nb, list };
}

const json = (body, init) => new Response(JSON.stringify(body), init);
const sample = [
  { id: 'a', issue_date: '2026/01/05', created_at: '2026-01-05T00:00:00Z' },
  { id: 'b', issue_date: '2026-03-01', created_at: '2026-03-01T00:00:00Z' },
  { id: 'c', issue_date: '', created_at: '2026-02-01T00:00:00Z' },
  { id: 'd', issue_date: '2026-02-10', created_at: '2026-02-10T00:00:00Z' },
];

function assertFailureUi(list, pattern) {
  assert.match(list.innerHTML, pattern);
  assert.match(list.innerHTML, /重試/);
  assert.doesNotMatch(list.innerHTML, /sort|is not a function|TypeError|沒有符合的公告/);
}

test('原始 offline HTTP 200 object 顯示離線提示，不拋 raw.sort', async () => {
  const { nb, list } = load(async () => json({ error: 'offline' }, { status: 200 }));
  await nb.fetchNotices();
  assertFailureUi(list, /離線/);
  assert.equal(nb.getNotices().length, 0);
});

test('503 offline 顯示離線提示', async () => {
  const { nb, list } = load(async () => json({ error: 'offline' }, { status: 503 }));
  await nb.fetchNotices();
  assertFailureUi(list, /離線/);
});

test('503 服務維護不誤判為離線', async () => {
  const { nb, list } = load(async () => json({ error: 'maintenance' }, { status: 503 }));
  await nb.fetchNotices();
  assertFailureUi(list, /暫時無法使用/);
  assert.doesNotMatch(list.innerHTML, /離線/);
});

test('non-2xx 顯示服務提示', async () => {
  const { nb, list } = load(async () => json({ error: 'boom' }, { status: 500 }));
  await nb.fetchNotices();
  assertFailureUi(list, /暫時無法使用/);
});

test('非陣列（error object / null / 其他 object）顯示格式異常', async () => {
  for (const body of [{ error: 'x' }, null, { notices: [] }, 'str']) {
    const { nb, list } = load(async () => json(body, { status: 200 }));
    await nb.fetchNotices();
    assertFailureUi(list, /格式異常/);
  }
});

test('fetch reject 顯示網路失敗', async () => {
  const { nb, list } = load(async () => { throw new TypeError('Failed to fetch'); });
  await nb.fetchNotices();
  assertFailureUi(list, /網路連線失敗/);
  assert.doesNotMatch(list.innerHTML, /Failed to fetch/);
});

test('正常陣列保留排序：有日期新到舊，無日期排後', async () => {
  const { nb, list } = load(async () => json(sample, { status: 200 }));
  await nb.fetchNotices();
  assert.deepEqual(Array.from(nb.getNotices(), n => n.id), ['b', 'd', 'a', 'c']);
  assert.doesNotMatch(list.innerHTML, /無法載入|離線/);
});

test('空陣列是「沒有公告」而非錯誤', async () => {
  const { nb, list } = load(async () => json([], { status: 200 }));
  await nb.fetchNotices();
  assert.match(list.innerHTML, /沒有符合的公告/);
});

test('失敗後重試可恢復', async () => {
  let n = 0;
  const { nb, list } = load(async () =>
    ++n === 1 ? json({ error: 'offline' }, { status: 503 }) : json(sample, { status: 200 }));
  await nb.fetchNotices();
  assertFailureUi(list, /離線/);
  assert.equal(typeof list.retry.onclick, 'function');
  await list.retry.onclick();
  assert.deepEqual(Array.from(nb.getNotices(), x => x.id), ['b', 'd', 'a', 'c']);
  assert.doesNotMatch(list.innerHTML, /重試/);
});
