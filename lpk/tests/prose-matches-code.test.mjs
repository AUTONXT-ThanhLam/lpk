import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lpk, repoWith, sh, write } from './gates-env.mjs';

const LENSES = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'lpk', 'lenses.md'), 'utf8');
const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const lensKey = (name) => name.toLowerCase().replace(/[^a-z]/g, '').replace(/^codereview$/, 'codereviewer');

function owedBy(name, flags, file, text) {
  const S = `lane-${name}`;
  const repo = repoWith(name, { 'src/a.mjs': 'const a = 1;\n', 'README.md': 'docs\n' });
  ok(lpk(repo, S, 'run', 'start', '--verify', 'false', '--scenario', 'true', ...flags));
  write(repo, file, text);
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-qm', 'Change');
  const lenses = JSON.parse(lpk(repo, S, 'reviews', 'owed', '--json').stdout).map((r) => lensKey(r.lens));
  return [...new Set(lenses)].sort();
}

function tableOf() {
  const rows = LENSES.split('\n').filter((l) => /^\|/.test(l)).slice(2).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  return new Map(rows.map(([label, ...cells]) => [label, cells.map((c) => [...new Set(c.split(',').map(lensKey))].sort())]));
}

test('the lenses lenses.md says a lane owes at each bar are the ones `lpk reviews owed` lists', () => {
  const table = tableOf();
  const code = ['src/a.mjs', 'const a = 2;\n'];
  const actual = new Map([
    ['increment bar', [owedBy('quick-inc', ['--lane', 'quick'], ...code), owedBy('full-inc', ['--lane', 'full'], ...code)]],
    ['production bar', [owedBy('quick-prod', ['--lane', 'quick', '--bar', 'production'], ...code), owedBy('full-prod', ['--lane', 'full', '--bar', 'production'], ...code)]],
    ['documentation only', [owedBy('quick-docs', ['--lane', 'quick', '--bar', 'production'], 'README.md', 'docs 2\n'), owedBy('full-docs', ['--lane', 'full', '--bar', 'production'], 'README.md', 'docs 2\n')]],
  ]);
  assert.deepEqual([...table.keys()].sort(), [...actual.keys()].sort());
  for (const [row, cells] of actual) assert.deepEqual(table.get(row), cells, row);
});
