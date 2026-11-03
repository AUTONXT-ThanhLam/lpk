import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addFinding, markFixed, ruleOn, VERIFIER } from '../lib/findings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'lpk-fix-round-')));
after(() => rmSync(tmp, { recursive: true, force: true }));

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const head = (repo) => sh(repo, 'rev-parse', 'HEAD').trim();
const write = (repo, body, msg) => { writeFileSync(join(repo, 'a.js'), body); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', msg); return head(repo); };

function change() {
  const dir = join(tmp, `r${readdirCount++}`);
  mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.js'), 'const ok = 1;\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'init');
  const base = head(dir);
  sh(dir, 'checkout', '-q', '-b', 'work');
  const reviewed = write(dir, 'const ok = 1;\nrisky(1);\nrisky(2);\n', 'add the calls');
  const lpkDir = join(dir, '.git', 'lpk');
  mkdirSync(lpkDir, { recursive: true });
  writeFileSync(join(lpkDir, 'run.json'), JSON.stringify({ v: 2, id: 'run1', repo: dir, session: 's1', target: 'main', reviewRange: `${base}..${reviewed}`, started: Date.now() }));
  return { dir, base, reviewed };
}
let readdirCount = 0;

const raise = (dir, at, line, ruling = {}) => {
  const { finding } = addFinding(dir, { from: 'lpk:bug-hunter', at, claim: 'risky is called unguarded', repro: 'node a.js', kind: 'defect', severity: 'important', file: 'a.js', line });
  const r = ruleOn(dir, { id: finding.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'risky is not guarded', evidence: 'throws on the commit', by: VERIFIER, ...ruling });
  assert.ok(!r.error, r.error);
  return finding.id;
};
const close = (dir, id, commit, extra = {}) => markFixed(dir, { id, commit, closedBy: 'test', evidence: 'fails on fix^, passes on fix', by: 'lead', ...extra });

test('a fix closes only when the pattern of its defect hits before it and nowhere on the change after it', () => {
  const { dir, base, reviewed } = change();
  const id = raise(dir, `${base}..${reviewed}`, 2);
  const partial = write(dir, 'const ok = 1;\nguard(1);\nrisky(2);\n', 'guard the first call');
  assert.match(close(dir, id, partial, { sweep: 'risky\\(' }).error, /a\.js:3/);
  assert.match(close(dir, id, partial, { sweep: 'neverWritten\\(' }).error, /no hit before the fix/);
  assert.match(close(dir, id, partial).error, /sweep/);
  const whole = write(dir, 'const ok = 1;\nguard(1);\nguard(2);\n', 'guard both calls');
  const r = close(dir, id, whole, { sweep: 'risky\\(' });
  assert.equal(r.finding.state, 'fixed');
  assert.match(r.finding.sweep.pattern, /risky/);
});

test('a finding the delta review of a fix round raises closes on its fix commit', () => {
  const { dir, base, reviewed } = change();
  const first = raise(dir, `${base}..${reviewed}`, 2);
  const fix = write(dir, 'const ok = 1;\nguard(1);\nrisky(2);\n', 'guard the first call');
  assert.equal(close(dir, first, fix, { sweep: 'risky\\(1' }).finding.state, 'fixed');
  const delta = raise(dir, `${reviewed}..${fix}`, 3, { born: 'fix' });
  const next = write(dir, 'const ok = 1;\nguard(1);\nguard(2);\n', 'guard the second call');
  assert.equal(close(dir, delta, next, { sweep: 'risky\\(2' }).finding.state, 'fixed');
});

test('a test gap closes by its mutant without a sweep, and only a test gap does', () => {
  const { dir, base, reviewed } = change();
  const { finding } = addFinding(dir, { from: 'lpk:mutant', at: `${base}..${reviewed}`, claim: 'no test fails when risky(1) is dropped', repro: 'lpk mutate --patch m.diff --test "node --test"', kind: 'test-gap', severity: 'important', file: 'a.js', line: 2 });
  ruleOn(dir, { id: finding.id, verdict: 'confirmed', reach: 'merge', born: 'build', cause: 'no test covers the first call', evidence: 'the mutant survives', by: VERIFIER });
  writeFileSync(join(dir, 'a.test.js'), 'risky(1);\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'test the first call');
  assert.match(close(dir, finding.id, head(dir)).error, /closes by its mutant/);
  assert.equal(close(dir, finding.id, head(dir), { closedBy: 'mutant', evidence: 'caught: 1 of 1' }).finding.state, 'fixed');
  const defect = raise(dir, `${base}..${reviewed}`, 3);
  assert.match(close(dir, defect, head(dir), { closedBy: 'mutant', evidence: 'caught' }).error, /only a test gap/);
});

test('a fixed finding moved to the commit now on HEAD keeps its sweep and is not counted again', () => {
  const { dir, base, reviewed } = change();
  const id = raise(dir, `${base}..${reviewed}`, 2);
  const fix = write(dir, 'const ok = 1;\nguard(1);\nguard(2);\n', 'guard the calls');
  assert.equal(close(dir, id, fix, { sweep: 'risky\\(' }).finding.state, 'fixed');
  sh(dir, 'checkout', '-q', '-b', 'rebased', reviewed);
  sh(dir, 'cherry-pick', '-x', fix);
  const moved = close(dir, id, head(dir));
  assert.equal(moved.finding.fixedCommit, head(dir));
  assert.match(moved.finding.sweep.pattern, /risky/);
});

test('lpk finding fixed takes --sweep', () => {
  const { dir, base, reviewed } = change();
  const id = raise(dir, `${base}..${reviewed}`, 2);
  const fix = write(dir, 'const ok = 1;\nguard(1);\nguard(2);\n', 'guard the calls');
  const out = execFileSync('node', [join(ROOT, 'bin', 'lpk'), 'finding', 'fixed', id, '--commit', fix, '--closed-by', 'test', '--evidence', 'fails on fix^, passes on fix', '--sweep', 'risky\\(', '--repo', dir], { cwd: dir, env: ENV, encoding: 'utf8' });
  assert.match(out, new RegExp(`${id} fixed in ${fix}`));
});

test('the sweep follows a file name with a space under diff.noprefix', () => {
  const { dir, base } = change();
  sh(dir, 'mv', 'a.js', 'my file.js');
  sh(dir, 'commit', '-qam', 'rename');
  const id = raise(dir, `${base}..${head(dir)}`, 2);
  sh(dir, 'config', 'diff.noprefix', 'true');
  writeFileSync(join(dir, 'my file.js'), 'const ok = 1;\nguard(1);\nrisky(2);\n');
  sh(dir, 'commit', '-qam', 'guard one');
  assert.match(close(dir, id, head(dir), { sweep: 'risky\\(' }).error, /my file\.js:3/);
  writeFileSync(join(dir, 'my file.js'), 'const ok = 1;\nguard(1);\nguard(2);\n');
  sh(dir, 'commit', '-qam', 'guard both');
  assert.equal(close(dir, id, head(dir), { sweep: 'risky\\(' }).finding.state, 'fixed');
});

test('a fix that renames the file holding the defect is swept on the old name too', () => {
  const { dir, base, reviewed } = change();
  const id = raise(dir, `${base}..${reviewed}`, 2);
  sh(dir, 'mv', 'a.js', 'b.js');
  writeFileSync(join(dir, 'b.js'), 'const ok = 1;\nguard(1);\nguard(2);\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'guard both and rename');
  assert.equal(close(dir, id, head(dir), { sweep: 'risky\\(' }).finding.state, 'fixed');
});
