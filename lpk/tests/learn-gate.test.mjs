import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lpk, repoWith, ROOT, sh, tmp, write } from './gates-env.mjs';
import { addFinding, archiveLedger, ruleOn, VERIFIER } from '../lib/findings.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const confirm = (repo, id) => ruleOn(repo, { id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the code does it', evidence: 'ran it', by: VERIFIER });

function startRun(name, session) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, session, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
  return repo;
}
const raise = (repo, claim = 'a is wrong') => addFinding(repo, { from: 'lpk:bug-hunter', at: `${sh(repo, 'rev-parse', 'main').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`, claim, repro: 'node a.mjs', kind: 'defect', severity: 'important', file: 'src/a.mjs', line: 1 }).finding.id;

test('the builder runs on Sonnet and is told to consult the advisor', () => {
  const text = readFileSync(join(ROOT, 'agents', 'builder.md'), 'utf8');
  assert.match(text, /^model: sonnet$/m);
  assert.match(text, /Consult the advisor/);
});

test('lpk handoff shows the builder what earlier runs confirmed on its files and the rules lpk learned', () => {
  const S = 'past-session';
  const repo = startRun('past', S);
  const old = raise(repo, 'a() returns a string for 0');
  confirm(repo, old);
  assert.equal(archiveLedger(repo, 'old-run').error, undefined);
  write(join(repo, '.git', 'lpk'), 'brief.json', JSON.stringify({ requirements: [], slices: [{ id: 'api', files: ['src/a.mjs'] }] }));
  write(process.env.XDG_DATA_HOME, 'lpk/rules/all.md', '### zero-is-a-value: 0 is a value, not a missing one\n- when: always\n- rule: test with 0\n');
  const out = ok(lpk(repo, S, 'handoff', 'api'));
  assert.match(out, /past findings on these files \(1\):\n {2}old-run F1 confirmed src\/a\.mjs:1 a\(\) returns a string for 0/);
  assert.match(out, /learned rules \(1;[^\n]*\n {2}zero-is-a-value: 0 is a value, not a missing one/);
});

test('the learn gate holds only after lpk learn has recorded every confirmed finding of the run', () => {
  const S = 'learn-session';
  const repo = startRun('learn', S);
  assert.match(lpk(repo, S, 'gates').stdout, /^learn +holds/m, 'a run with nothing confirmed has nothing to learn from');
  const id = raise(repo);
  confirm(repo, id);
  const denied = lpk(repo, S, 'gates').stdout;
  assert.match(denied, new RegExp(`^learn +DENY .*\\n +.*${id}`, 'm'));
  assert.match(denied, /option `gate:learn`/);
  assert.equal(lpk(repo, S, 'learn', '--rule', 'no-such-rule').status, 2);
  ok(lpk(repo, S, 'learn'));
  assert.match(lpk(repo, S, 'gates').stdout, /^learn +holds/m);
  const later = raise(repo, 'b is wrong');
  confirm(repo, later);
  assert.match(lpk(repo, S, 'gates').stdout, new RegExp(`^learn +DENY .*\\n +.*${later}`, 'm'));
  ok(lpk(repo, S, 'learn'));
  assert.match(lpk(repo, S, 'gates').stdout, /^learn +holds/m);
});

test('the tests-first gate denies a change whose first test arrives after its first code', () => {
  const S = 'first-session';
  const repo = startRun('first', S);
  write(repo, 'src/b.mjs', 'export const b = 1;\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'Add b');
  write(repo, 'tests/b.test.mjs', 'import "../src/b.mjs";\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'Test b');
  const late = lpk(repo, S, 'gates').stdout;
  assert.match(late, /^tests-first +DENY .*\n +.*tests\/b\.test\.mjs/m);
  assert.match(late, /option `gate:tests-first`/);

  const fresh = startRun('first-ok', 'first-ok-session');
  write(fresh, 'tests/c.test.mjs', 'import "../src/c.mjs";\n');
  sh(fresh, 'add', '.'); sh(fresh, 'commit', '-qm', 'Test c');
  write(fresh, 'src/c.mjs', 'export const c = 1;\n');
  sh(fresh, 'add', '.'); sh(fresh, 'commit', '-qm', 'Add c');
  assert.match(lpk(fresh, 'first-ok-session', 'gates').stdout, /^tests-first +holds/m);
});

test('the tests-first gate counts the lines a commit writes, not the files a rename moves', () => {
  const S = 'rename-session';
  const repo = repoWith('rename', { 'src/a.mjs': 'export const a = 1;\n', 'tests/old.test.mjs': 'import "../src/a.mjs";\n' });
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
  sh(repo, 'mv', 'src/a.mjs', 'src/z.mjs'); sh(repo, 'commit', '-qm', 'Move a');
  write(repo, 'tests/z.test.mjs', 'import "../src/z.mjs";\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'Test z');
  assert.match(lpk(repo, S, 'gates').stdout, /^tests-first +holds/m, 'moving a code file writes no code');

  const other = repoWith('rename-test', { 'tests/old.test.mjs': 'x\n' });
  ok(lpk(other, 'rename-test-session', 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
  sh(other, 'mv', 'tests/old.test.mjs', 'tests/new.test.mjs'); sh(other, 'commit', '-qm', 'Move test');
  write(other, 'src/b.mjs', 'export const b = 1;\n');
  sh(other, 'add', '.'); sh(other, 'commit', '-qm', 'Add b');
  write(other, 'tests/b.test.mjs', 'import "../src/b.mjs";\n');
  sh(other, 'add', '.'); sh(other, 'commit', '-qm', 'Test b');
  assert.match(lpk(other, 'rename-test-session', 'gates').stdout, /^tests-first +DENY/m, 'moving a test file writes no test');
});

test('lpk handoff lists only archived ledgers as past, wherever the repo sits', () => {
  mkdirSync(join(tmp, 'runs'), { recursive: true });
  const S = 'runs-session';
  const repo = repoWith('runs/proj', { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
  confirm(repo, raise(repo));
  write(join(repo, '.git', 'lpk'), 'brief.json', JSON.stringify({ requirements: [], slices: [{ id: 'api', files: ['src/a.mjs'] }] }));
  assert.doesNotMatch(ok(lpk(repo, S, 'handoff', 'api')), /past findings/);
});
