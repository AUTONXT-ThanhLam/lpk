// The commands as another agent calls them: candidates it has not been shown yet, one rule by id,
// and a repo's learned rules from a builder's worktree.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const LPK = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lpk');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-callers-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', XDG_CACHE_HOME: join(tmp, 'cache'), XDG_DATA_HOME: join(tmp, 'data') };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
const lpk = (cwd, args) => spawnSync('node', [LPK, ...args], { cwd, env: ENV, encoding: 'utf8' });

function repoWith(name, files) {
  const repo = join(tmp, name);
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  for (const [p, t] of Object.entries(files)) write(repo, p, t);
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'switch', '-qc', 'feat');
  return repo;
}

test('lpk check --fresh shows a candidate once, then only new ones, at most 15 at a time', () => {
  const repo = repoWith('fresh', { 'src/a.mjs': 'export const a = 1;\n' });
  const state = join(tmp, 'state', 'builder-1.json');
  const fresh = () => { const r = lpk(repo, ['check', '--base', 'main', '--fresh', state]); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  write(repo, 'src/a.mjs', 'export const a = 1;\nload().catch(() => undefined);\n');
  assert.match(fresh(), /^- no-silent-failure {2}src\/a\.mjs:2 {2}load\(\)\.catch/m);
  assert.doesNotMatch(fresh(), /no-silent-failure/, 'shown twice');
  write(repo, 'src/poll.mjs', 'setInterval(tick, 1000);\n');
  const next = fresh();
  assert.match(next, /^- bounded-work {2}src\/poll\.mjs:1 /m);
  assert.doesNotMatch(next, /no-silent-failure/);
  write(repo, 'src/many.mjs', Array.from({ length: 17 }, (_, i) => `setInterval(tick${i}, 1000);\n`).join(''));
  const capped = fresh();
  assert.equal(capped.match(/^- /gm).length, 15);
  assert.match(capped, /^2 more: run lpk check$/m);
  assert.equal(fresh().match(/^- /gm).length, 2, 'the rest come next');
});

test('lpk rules --id prints just the rules named, and the change\'s rules lead with their ids', () => {
  const repo = repoWith('ids', { 'src/a.mjs': 'export const a = 1;\n' });
  const one = lpk(repo, ['rules', '--id', 'bounded-work']);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(one.stdout.match(/^### .*/gm), ['### bounded-work: every input, loop, poll and budget has a bound (blocks: high)']);
  assert.match(one.stdout, /^rule: .*\ncheck: .*\nwhen: /m);
  assert.deepEqual(lpk(repo, ['rules', '--id', 'no-silent-failure,bounded-work']).stdout.match(/^### [\w-]+/gm), ['### no-silent-failure', '### bounded-work']);
  const unknown = lpk(repo, ['rules', '--id', 'bounded-work,nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no rule nope/);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  assert.match(lpk(repo, ['rules', '--base', 'main']).stdout, /^\d+ of \d+ rules apply .*\n {2}entry-paths \(high\): /);
});

test('a builder worktree of a repo loads that repo\'s learned rules', () => {
  const repo = repoWith('shop', { 'src/a.mjs': 'export const a = 1;\n' });
  write(join(tmp, 'data'), 'lpk/rules/shop.md', '### shop-money: prices are integer cents\n- when: always\n- find: `parseFloat\\(price`\n- rule: r\n- check: c\n');
  const wt = join(tmp, 'shop-slice-api');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feat-api', wt);
  write(wt, 'src/a.mjs', 'export const cents = parseFloat(price);\n');
  assert.match(lpk(wt, ['check', '--base', 'main']).stdout, /shop-money {2}src\/a\.mjs:1 /);
  assert.match(lpk(wt, ['rules', '--id', 'shop-money']).stdout, /^### shop-money: /);
});
