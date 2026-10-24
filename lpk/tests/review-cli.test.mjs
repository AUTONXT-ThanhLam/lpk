// `lpk review start` as a session runs it, in a real git repo, and the range grammar every lens
// prompt is matched against.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveRange } from '../lib/range.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-review-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const ENV = { ...process.env, CLAUDE_CODE_SESSION_ID: '', XDG_CACHE_HOME: join(tmp, 'cache'), XDG_STATE_HOME: join(tmp, 'state'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lpk = (cwd, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: ENV, encoding: 'utf8' });
const jsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const records = (repo) => jsonl(join(repo, '.git', 'lpk', 'records.jsonl'));

// A repo whose base has a REVIEW.md, one commit of change on top, and an lpk run reviewing it.
function repo(name, { run = true } = {}) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'REVIEW.md'), 'Every query names its limit.\n');
  writeFileSync(join(dir, 'a.js'), 'export const take = (xs, n) => xs.slice(0, n);\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'base');
  const base = sh(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'a.js'), 'export const take = (xs, n) => xs.slice(0, n);\nexport const page = (xs, n) => xs.slice(0, n + 1);\n');
  sh(dir, 'commit', '-qam', 'add page');
  const head = sh(dir, 'rev-parse', 'HEAD');
  if (run) {
    mkdirSync(join(dir, '.git', 'lpk'), { recursive: true });
    writeFileSync(join(dir, '.git', 'lpk', 'run.json'), JSON.stringify({ v: 2, id: 'run1', repo: dir, session: 's1', target: 'main', lane: 'full', reviewRange: `${base}..${head}`, started: Date.now() }));
  }
  return { dir, base, head };
}

test('a review range takes refs whose names hold dots, and a...b reviews from their merge base', () => {
  const { dir, base, head } = repo('dotted', { run: false });
  sh(dir, 'tag', 'v1.2', base);
  sh(dir, 'branch', 'release-1.2', base);
  for (const range of ['v1.2..HEAD', 'release-1.2..main', 'v1.2..', 'release-1.2...main']) assert.deepEqual(resolveRange(dir, range), { a: base, b: head, range: `${base}..${head}` }, range);
  assert.match(resolveRange(dir, 'v1.3..HEAD').error, /^v1\.3 is not a commit/);
});

// Each bad range must fail for its own reason: a range that resolves to nothing would let a lens
// report on a diff that does not exist.
test('a range that holds no change, names no commit, or is not a range is refused with a reason', () => {
  const { dir } = repo('bad', { run: false });
  for (const bad of ['HEAD..HEAD', 'nope..HEAD', 'HEAD', 'HEAD .. HEAD']) {
    const r = resolveRange(dir, bad);
    assert.ok(r.error, `${bad} answered with no error: ${JSON.stringify(r)}`);
    assert.equal(r.a, undefined, bad);
    assert.equal(r.b, undefined, bad);
  }
});

test('review start records the range under review in the run, with whole commit ids', () => {
  const { dir, head } = repo('start');
  const p = lpk(dir, 'review', 'start', 'HEAD~1..HEAD');
  assert.equal(p.status, 0, p.stderr);
  const base = sh(dir, 'rev-parse', 'HEAD~1');
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'lpk', 'run.json'), 'utf8')).reviewRange, `${base}..${head}`);
  assert.match(p.stdout, new RegExp(`^reviewing ${base}\\.\\.${head} \\(1 commit\\(s\\)\\)`));
  assert.deepEqual(records(dir).map((r) => [r.kind, r.range]), [['review-start', `${base}..${head}`]]);
  assert.equal(lpk(dir, 'review', 'start', 'HEAD..HEAD').status, 2);
  const none = repo('start-norun', { run: false });
  const q = lpk(none.dir, 'review', 'start', 'HEAD~1..HEAD');
  assert.equal(q.status, 1);
  assert.match(q.stderr, /no lpk run/);
});
