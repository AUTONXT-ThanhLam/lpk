import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, load, run } from './lib.mjs';
const ORIGINAL = "export function slugify(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n}\n";
export default async function (ws) {
  const f = [];
  const { slugify } = await load(ws, 'src/slug.mjs');
  await expect(f, 'accents kept', () => slugify('Crème brûlée') === 'creme-brulee' || slugify('Crème brûlée'));
  await expect(f, 'ascii unchanged', () => slugify('Hello World') === 'hello-world' || slugify('Hello World'));
  await expect(f, "the project's tests pass on the fix", () => run(ws, 'node', ['--test']).code === 0 || 'tests fail');
  const tmp = mkdtempSync(join(tmpdir(), 'mut-'));
  try {
    cpSync(ws, tmp, { recursive: true, filter: (p) => !p.includes('/.git') });
    writeFileSync(join(tmp, 'src/slug.mjs'), ORIGINAL);
    await expect(f, 'the tests fail when the bug is put back', () => run(tmp, 'node', ['--test']).code !== 0 || 'tests still pass on the buggy code');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return f;
}
