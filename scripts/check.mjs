// 靜態檢查：JS/mjs 語法（node --check）與本地相對 import 路徑。
// 不連網、不讀 secrets、不碰資料庫。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.secrets', '.wrangler']);
const SKIP_PREFIXES = ['assets/vendor/']; // 第三方檔案不檢查
const EXT = /\.(?:m?js)$/;

// 只抓靜態 import / export ... from 與 side-effect import；動態 import() 與非相對路徑忽略。
const FROM_RE = /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const BARE_RE = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(ROOT, full).split('\\').join('/');
    if (SKIP_PREFIXES.some((p) => (rel + '/').startsWith(p))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

const errors = [];
const files = walk(ROOT).sort();

for (const file of files) {
  const rel = relative(ROOT, file);

  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    errors.push(`語法錯誤 ${rel}\n${(r.stderr || r.stdout || '').trim()}`);
    continue;
  }

  const src = readFileSync(file, 'utf8');
  const specs = new Set();
  for (const re of [FROM_RE, BARE_RE]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) specs.add(m[1]);
  }
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue; // CDN / bare / node: 一律忽略
    const target = resolve(dirname(file), spec.split(/[?#]/)[0]);
    if (!existsSync(target) || !statSync(target).isFile()) {
      errors.push(`import 路徑不存在 ${rel} -> ${spec}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n\n'));
  console.error(`\ncheck 失敗：${errors.length} 個問題（共檢查 ${files.length} 檔）`);
  process.exit(1);
}
console.log(`check 通過：${files.length} 個 JS/mjs 檔`);
