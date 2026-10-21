// The fact verbs that read git: which lines a fix rewrites, what owes the full net, what changes
// together, and whether the target already holds a fix.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commit, lpk, repoWith, sh, write } from './verbs-env.mjs';

const lines = (n, f = (i) => `line ${i}`) => `${Array.from({ length: n }, (_, i) => f(i + 1)).join('\n')}\n`;

test('lpk fixlines names the lines a fix rewrites that an earlier commit of the same change wrote, and no others', () => {
  const repo = repoWith('fixlines', { 'a.js': lines(8) });
  const first = commit(repo, 'Add the limit', { 'a.js': lines(8, (i) => (i === 3 ? 'limit = 10' : `line ${i}`)) });
  commit(repo, 'Fix the limit', { 'a.js': lines(8, (i) => (i === 3 ? 'limit = 20' : i === 6 ? 'line six' : `line ${i}`)) });
  const r = lpk(repo, 'fixlines', '--base', 'main');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`a\\.js:3 \\(changed\\) written by ${first.slice(0, 12)} "Add the limit"; the fix writes a\\.js:3`));
  assert.doesNotMatch(r.stdout, /a\.js:6/, 'line 6 came from main, not from this change');
  commit(repo, 'Touch line eight', { 'a.js': lines(8, (i) => (i === 3 ? 'limit = 20' : i === 6 ? 'line six' : i === 8 ? 'line eight' : `line ${i}`)) });
  assert.match(lpk(repo, 'fixlines', '--base', 'main').stdout, /none of the lines this fix changes were written by an earlier commit/);
});

test('lpk floor says a one-file change owes nothing more, and names each fact that owes the full net and each lens', () => {
  const repo = repoWith('floor', { 'src/sum.js': 'export const sum = (a, b) => a + b;\n', 'SENSITIVE.md': '# Sensitive\n- `billing/**`\n' });
  write(repo, 'src/sum.js', 'export const sum = (a, b) => a + b + 0;\n');
  const quick = lpk(repo, 'floor', '--base', 'main');
  assert.equal(quick.status, 0, quick.stderr);
  assert.match(quick.stdout, /floor: none of the full-lane facts/);
  assert.match(quick.stdout, /lens regression: export at src\/sum\.js:1/);
  write(repo, 'db/migrations/002_add.sql', 'ALTER TABLE t ADD c int;\n');
  write(repo, 'billing/plan.go', 'package billing\n');
  write(repo, 'src/Cart.tsx', 'export function Cart({ items }) { return items.map((i) => <li>{i}</li>); }\n');
  write(repo, 'test/sum.test.js', 'test("sum", () => {});\n');
  write(repo, 'src/login.js', 'const checkSessionToken = () => true;\n');
  const full = JSON.parse(lpk(repo, 'floor', '--base', 'main', '--json').stdout);
  assert.equal(full.full, true);
  for (const why of ['6 files changed (more than 3)', 'migration db/migrations/002_add.sql', 'billing/plan.go matches SENSITIVE.md `billing/**`', 'auth marker `login` in the path src/login.js', 'auth marker `Session` at src/login.js:1'])
    assert.ok(full.why.includes(why), `${why} in ${JSON.stringify(full.why)}`);
  assert.deepEqual(full.lenses, ['mutant', 'regression', 'designer', 'a11y', 'perf']);
  assert.equal(full.lensWhy.perf, 'render at src/Cart.tsx:1');
});

test('lpk cochange names the files that change with a file but not in this change, fixes on its lines, and moved dependencies', () => {
  const repo = repoWith('cochange', { 'api.js': lines(4), 'client.js': 'c\n', 'package.json': '{ "dependencies": { "x": "1.0.0" } }\n' });
  sh(repo, 'switch', '-q', 'main');
  for (let i = 0; i < 3; i++) commit(repo, `Change both ${i}`, { 'api.js': lines(4, (k) => (k === 4 ? `end ${i}` : `line ${k}`)), 'client.js': `c ${i}\n` });
  commit(repo, 'fix: line two returned the wrong value', { 'api.js': lines(4, (k) => (k === 4 ? 'end 2' : k === 2 ? 'two' : `line ${k}`)) });
  sh(repo, 'switch', '-qC', 'feat');
  write(repo, 'api.js', lines(4, (k) => (k === 4 ? 'end 2' : k === 2 ? 'TWO' : `line ${k}`)));
  write(repo, 'package.json', '{ "dependencies": { "x": "2.0.0" } }\n');
  const r = lpk(repo, 'cochange', 'api.js', '--base', 'main');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /api\.js: in 5 of the last 400 commits/);
  assert.match(r.stdout, /changed together 4x: client\.js {2}\(not in this change\)/);
  assert.match(r.stdout, /fix on these lines: [0-9a-f]+ fix: line two returned the wrong value/);
  assert.match(r.stdout, /package\.json:1 \+ \{ "dependencies": \{ "x": "2\.0\.0" \} \}/);
});

test('lpk facts --about names the commits on the target that HEAD lacks touching the named files, before any change exists', () => {
  const repo = repoWith('fixed', { 'a.js': 'a\n', 'b.js': 'b\n' });
  sh(repo, 'switch', '-q', 'main');
  commit(repo, 'Fix the crash in a', { 'a.js': 'a fixed\n' });
  commit(repo, 'Touch b', { 'b.js': 'b2\n' });
  sh(repo, 'switch', '-q', 'feat');
  const r = lpk(repo, 'facts', '--about', 'a.js', '--base', 'main');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Commits on main that HEAD lacks, touching these files: \n- \w+ \S+ Fix the crash in a\n?$/);
  assert.match(r.stdout, /Open PRs touching these files: unknown \(.+\)/, 'a gh that cannot answer is named, not read as no PRs');
});

test('mutate refuses an unknown argument and a patch that is not a file', () => {
  const repo = repoWith('mutate-args', { 'a.js': 'export const a = 1;\n' });
  write(repo, 'a.diff', '');
  for (const args of [['--patch a.diff --patch b.diff'], ['--patch', 'missing.diff'], ['--patch', 'a.diff', 'b.diff'], ['--patch', '.'], ['--patches', 'a.diff']]) {
    const r = lpk(repo, 'mutate', '--base', 'main', '--test', 'true', ...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /usage: lpk mutate/, args.join(' '));
  }
  assert.match(lpk(repo, 'mutate', '--base', 'main', '--test', 'true', '--patch', 'missing.diff').stderr, /missing\.diff/);
  assert.match(lpk(repo, 'mutate', '--base', 'main', '--test', 'true', '--patch', 'a.diff', 'b.diff').stderr, /b\.diff/);
});
