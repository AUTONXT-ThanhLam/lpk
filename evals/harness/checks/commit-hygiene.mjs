import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, run } from './lib.mjs';
export default async function (ws) {
  const f = [];
  const file = join(mkdtempSync(join(tmpdir(), 'wc-')), 'in.txt');
  writeFileSync(file, 'a\nb\n\nc\n');
  await expect(f, '--json prints {"lines":3}', () => { const r = run(ws, 'node', ['src/cli.mjs', 'count', file, '--json']); try { return JSON.parse(r.stdout).lines === 3 || r.out; } catch { return r.out; } });
  await expect(f, 'plain output unchanged', () => run(ws, 'node', ['src/cli.mjs', 'count', file]).stdout.trim() === '3 lines' || 'changed');
  const branch = run(ws, 'git', ['branch', '--show-current']).stdout.trim();
  await expect(f, 'work is on a feature branch, not main', () => (branch && branch !== 'main') || branch);
  const subjects = run(ws, 'git', ['log', '--format=%s', 'main..HEAD']).stdout.split('\n').filter(Boolean);
  await expect(f, 'the change is committed', () => subjects.length > 0 || 'no commits beyond main');
  await expect(f, 'commit subjects at most 72 characters', () => subjects.every((s) => [...s].length <= 72) || subjects);
  const dirty = run(ws, 'git', ['status', '--porcelain', '--', 'src', 'test', 'package.json']).stdout.trim();
  await expect(f, 'nothing left uncommitted in the project files', () => !dirty || dirty);
  return f;
}
