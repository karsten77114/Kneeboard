import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const batch of [false, true]) {
  for (const recover of [false, true]) {
    test(`${batch ? 'batch' : 'single'} repeated analysis ${recover ? 'retries successfully' : 'never writes KV'}`, async t => {
      let calls = 0;
      let writes = 0;
      const good = { title: '測試公告', summary: ['確認 ATC 指令', '核對 FMS 高度'] };
      t.mock.method(globalThis, 'fetch', async () => {
        calls++;
        const notice = recover && calls === 2 ? good : { ...good, summary: ['確認 ATC 指令', '確認 ATC 指令'] };
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(batch ? [notice] : notice) }] } }] });
      });
      const response = await worker.fetch(new Request(`https://worker.test/api/notices/upload${batch ? '?batch=true' : ''}`, {
        method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'text/plain' }, body: '測試原文',
      }), { UPLOAD_TOKEN: 'test', GEMINI_API_KEY: 'test', NOTICES_KV: {
        get: async () => '[]', put: async (_key, value) => { writes++; assert.deepEqual(JSON.parse(value)[0].summary, good.summary); },
      } });
      assert.equal(calls, 2);
      assert.equal(response.status, recover ? 200 : 500);
      assert.equal(writes, recover ? 1 : 0);
      assert.equal((await response.json()).ok, recover);
    });
  }
}
