// The requirements gate as the session meets it: every numbered requirement proved on HEAD by a
// scenario, a failure row or a test that names it, or the owner's waiver; the Quick lane numbers
// them at `lpk run start`, the Full lane in brief.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lens, lpk, repoWith, sh, write } from './gates-env.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const row = (repo, session) => JSON.parse(lpk(repo, session, 'gates', '--json').stdout).find((r) => r.gate === 'requirements');
const range = (repo) => `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;

test('lpk run start numbers each --req and refuses a --proves that names no requirement or no scenario', () => {
  const repo = repoWith('req-flags', { 'src/a.mjs': 'export const a = 1;\n' });
  const bad = lpk(repo, 'f', 'run', 'start', '--lane', 'quick', '--why', 'x', '--verify', 'true', '--req', 'a is 2', '--scenario', 'true', '--proves', 'R1,R2');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--proves names R2, and the run's requirements are R1/);
  assert.match(lpk(repo, 'f', 'run', 'start', '--verify', 'true', '--req', 'a is 2', '--proves', 'R1').stderr, /--proves follows the --scenario or --judged/);
  const out = ok(lpk(repo, 'f', 'run', 'start', '--lane', 'quick', '--why', 'x', '--verify', 'true', '--req', 'a is 2', '--req', 'b is kept', '--scenario', 'true', '--proves', 'R1,R2', '--judged', 'the page shows 2', '--proves', 'R1'));
  assert.match(out, /S1 `true` proves R1, R2; S2 \(agent-judged\) the page shows 2 proves R1/);
  assert.match(out, /Requirements: R1 a is 2; R2 b is kept\./);
  assert.deepEqual(JSON.parse(ok(lpk(repo, 'f', 'run', 'status'))).requirements.map((q) => q.id), ['R1', 'R2']);
});

test('a quick run denies each unproved requirement by id, holds once a scenario and a new test prove them, and a quick run with none only prints', () => {
  const S = 'req-quick';
  const repo = repoWith('req-quick', { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--verify', 'true', '--req', 'a is 2', '--req', 'a stays a number',
    '--scenario', 'grep -q "a = 2" src/a.mjs', '--proves', 'R1'));
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  let r = row(repo, S);
  assert.equal(r.holds, false);
  assert.match(r.why, /R1 unproved \(S1 not green on HEAD's tree\); R2 unproved \(no scenario, failure row or added test names it\)/);
  assert.match(r.wayOut, /prove R1, R2: .*or the owner waives it \(option `gate:requirements`\)/);
  assert.match(lpk(repo, S, 'gates').stdout, /requirements +DENY/);

  ok(lpk(repo, S, 'prove', '--all'));
  write(repo, 'tests/a.test.mjs', "// R2\nimport { a } from '../src/a.mjs';\nif (typeof a !== 'number') process.exit(1);\n");
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'Test that a stays a number');
  r = row(repo, S);
  assert.match(r.why, /R1 unproved \(S1 not green on HEAD's tree\)/, 'a new commit is a new tree; the scenario runs again');
  assert.doesNotMatch(r.why, /R2/);
  ok(lpk(repo, S, 'prove', '--all'));
  assert.equal(row(repo, S).holds, true);
  assert.match(lpk(repo, S, 'report').stdout, /\| R1 \| a is 2 \| lpk run start --req \| S1 green on tree \w{12} \|\n\| R2 \| a stays a number \| lpk run start --req \| test in tests\/a\.test\.mjs, verify green \|/);

  const none = repoWith('req-none', { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(none, 'n', 'run', 'start', '--lane', 'quick', '--why', 'x', '--verify', 'true', '--scenario', 'true'));
  r = row(none, 'n');
  assert.equal(r.holds, true);
  assert.equal(r.print, true);
  assert.match(lpk(none, 'n', 'gates').stdout, /requirements +print +run\.json requirements\n +none were recorded/);
});

test('a full run is denied without numbered requirements, reads them from brief.json, counts a Prover PASS on HEAD\'s code, and the owner\'s waiver releases it', () => {
  const S = 'req-full';
  const repo = repoWith('req-full', { 'src/a.mjs': 'export const a = 1;\n' });
  const dir = join(repo, '.git', 'lpk');
  write(dir, 'brief.json', JSON.stringify({ scenarios: [{ id: 'S1', text: 'the page shows 2' }] }));
  assert.match(ok(lpk(repo, S, 'run', 'start', '--verify', 'true')), /Scenarios: S1 \(agent-judged\) the page shows 2\./, 'run start records the brief\'s scenarios');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  let r = row(repo, S);
  assert.equal(r.holds, false);
  assert.equal(r.why, 'the brief has no numbered requirements');

  write(dir, 'brief.json', JSON.stringify({
    requirements: [{ id: 'R1', text: 'the page shows 2', source: 'request: "show 2"' }, { id: 'R2', text: 'a dead store is reported', source: 'inferred' }],
    scenarios: [{ id: 'S1', text: 'the page shows 2', proves: ['R1'] }],
    failures: [{ id: 'FM1', row: 'store unreachable: reported', proves: ['R2'] }],
  }));
  r = row(repo, S);
  assert.match(r.why, /R1 unproved \(S1 has no Prover PASS on HEAD's code\); R2 unproved \(failure row FM1 has no Prover PASS on HEAD's code\)/);

  lens(S, 'pv1', 'lpk:prover', range(repo), { findings: [], results: [
    { scenario: 'S1: the page shows 2', status: 'PASS', evidence: 'shot.png', proves: ['R1'] }] });
  assert.match(row(repo, S).why, /^R2 unproved \(failure row FM1 has no Prover PASS on HEAD's code\)$/);
  lens(S, 'pv2', 'lpk:prover', range(repo), { findings: [], results: [
    { scenario: 'FM1: store unreachable', status: 'PASS', evidence: 'log', proves: ['R2'] }] });
  r = row(repo, S);
  assert.equal(r.holds, true, r.why);
  assert.equal(r.read, '2 requirements in brief.json; scenarios, failure rows and tests that name them');

  write(dir, 'brief.json', JSON.stringify({ ...JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8')), requirements: [
    { id: 'R1', text: 'the page shows 2', source: 'x' }, { id: 'R2', text: 'reported', source: 'x' }, { id: 'R3', text: 'the old total stays', source: 'x' }] }));
  assert.match(row(repo, S).why, /^R3 unproved/);
  ok(lpk(repo, S, 'waive', 'requirements', '--why', 'the owner proves R3 by hand', '--via', 'ask'));
  r = row(repo, S);
  assert.equal(r.holds, true);
  assert.match(r.why, /^waived by the owner \(R3 unproved/);
});
