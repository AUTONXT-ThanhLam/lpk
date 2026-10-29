import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, hook, lpk, reason, repoWith, sh, write } from './hooks-env.mjs';
import { timeoutFor } from '../lib/verify.mjs';

const commitHook = (repo, session) => hook('PreToolUse', 'commit', { tool_name: 'Bash', cwd: repo, session_id: session, tool_input: { command: 'git commit -am x' } });
const begin = (repo, session, ...args) => lpk(repo, session, 'run', 'start', '--target', 'main', ...args);
const verifyRow = (repo, session) => lpk(repo, session, 'gates').stdout.match(/^verify .*(?:\n {13}.*)*/m)?.[0] ?? '';
const verifyRecords = (repo) => readFileSync(join(repo, '.git', 'lpk', ['records', 'jsonl'].join('.')), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.kind === 'verify');
const gateRow = (repo, session, gate) => JSON.parse(lpk(repo, session, 'gates', '--json').stdout).find((r) => r.gate === gate);
const status = (repo, session) => JSON.parse(lpk(repo, session, 'run', 'status').stdout);

test('R1: a check named in both tiers, or --final without a final tier, is refused with a usage error', () => {
  const repo = repoWith('tiers-refuse', { 'src/a.mjs': 'export const a = 1;\n' });
  const both = begin(repo, 'r1', '--verify', 'npm test', '--verify-final', 'npm test');
  assert.equal(both.status, 2);
  assert.match(both.stderr, /`npm test` named in both --verify and --verify-final/);
  assert.equal(lpk(repo, 'r1', 'run', 'status').stdout.trim(), 'no lpk run in this repo');

  const ok = begin(repo, 'r1', '--verify', 'true', '--verify-final', 'slow');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Final checks[^\n]*`slow`/);
  assert.deepEqual(status(repo, 'r1').verifyFinal, ['slow']);
  const same = begin(repo, 'r1', '--verify', 'slow', '--verify-final', 'slow');
  assert.equal(same.status, 2);
  assert.deepEqual(status(repo, 'r1').verify, ['true']);

  const plain = repoWith('tiers-none', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(plain, 'r1b', '--verify', 'true').status, 0);
  const none = lpk(plain, 'r1b', 'verify', '--final');
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no final checks/);
  assert.deepEqual(status(plain, 'r1b').verifyFinal, []);
});

test('R1: naming a kept check in the other tier moves it, and the run keeps at least one fast check', () => {
  const repo = repoWith('tiers-move', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 'mv', '--verify', 'true', '--verify', 'quick', '--verify-final', 'slow').status, 0);
  assert.deepEqual(status(repo, 'mv').verify, ['true', 'quick']);

  const toFast = begin(repo, 'mv', '--verify', 'true', '--verify', 'slow');
  assert.equal(toFast.status, 0, toFast.stderr);
  assert.deepEqual(status(repo, 'mv').verify, ['true', 'slow']);
  assert.deepEqual(status(repo, 'mv').verifyFinal, []);

  const toFinal = begin(repo, 'mv', '--verify-final', 'slow');
  assert.equal(toFinal.status, 0, toFinal.stderr);
  assert.deepEqual(status(repo, 'mv').verify, ['true']);
  assert.deepEqual(status(repo, 'mv').verifyFinal, ['slow']);

  const last = begin(repo, 'mv', '--verify-final', 'true');
  assert.equal(last.status, 2);
  assert.deepEqual(status(repo, 'mv').verify, ['true']);
  assert.deepEqual(status(repo, 'mv').verifyFinal, ['slow']);
});

test('R2 R3 R4: the fast tier lets a commit through, the final tier runs once on the committed tree, and the verify gate holds only then', () => {
  const repo = repoWith('tiers-flow', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 'f', '--verify', 'true', '--verify-final', 'touch final.stamp').status, 0);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');

  const fast = lpk(repo, 'f', 'verify');
  assert.equal(fast.status, 0, fast.stderr + fast.stdout);
  assert.match(fast.stdout, /final checks are still owed/);
  assert.equal(existsSync(join(repo, 'final.stamp')), false, 'the fast tier ran a final check');
  assert.equal(reason(commitHook(repo, 'f')), '', 'a green fast tier lets the commit through');
  sh(repo, 'commit', '-qam', 'change');
  assert.match(verifyRow(repo, 'f'), /^verify +DENY[\s\S]*no green `lpk verify --final`/);

  const final = lpk(repo, 'f', 'verify', '--final');
  assert.equal(final.status, 0, final.stderr + final.stdout);
  assert.equal(existsSync(join(repo, 'final.stamp')), true);
  assert.match(verifyRow(repo, 'f'), /^verify +holds/);

  assert.equal(begin(repo, 'f', '--verify-final', 'touch other.stamp').status, 0);
  assert.match(verifyRow(repo, 'f'), /^verify +DENY[\s\S]*no green `lpk verify --final`/, 'a record of the old final list counts for nothing');
});

test('R3: the final tier never rewrites run.json, so what another command wrote while it ran stays', () => {
  const repo = repoWith('tiers-lost', { 'src/a.mjs': 'export const a = 1;\n' });
  const cli = JSON.stringify(join(ENV.CLAUDE_PLUGIN_ROOT, 'bin', 'lpk'));
  assert.equal(begin(repo, 'l', '--lane', 'quick', '--why', 'small', '--verify', 'true', '--verify-final', `node ${cli} run lane full --why grew; sleep 1`).status, 0);
  assert.equal(status(repo, 'l').lane, 'quick');
  const final = lpk(repo, 'l', 'verify', '--final');
  assert.equal(final.status, 0, final.stderr + final.stdout);
  const after = status(repo, 'l');
  assert.equal(after.lane, 'full');
  assert.equal(after.laneWhy, 'grew');
  assert.equal(after.verified, null, 'the final tier wrote the fast verify result');
});

test('R3: code that changes while the final tier runs makes it not green', () => {
  const repo = repoWith('tiers-moving', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 'm', '--verify', 'true', '--verify-final', "echo '// edit' >> src/a.mjs").status, 0);
  const final = lpk(repo, 'm', 'verify', '--final');
  assert.equal(final.status, 1);
  assert.match(final.stdout, /Files changed while the checks ran/);
  sh(repo, 'checkout', '--', 'src/a.mjs');
  assert.match(verifyRow(repo, 'm'), /^verify +DENY/);
});

test('R2: the final tier orders its checks by its own last green durations, so a cheap red check stops it before the slow one', () => {
  const repo = repoWith('tiers-order', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 'o', '--verify', 'true', '--verify-final', 'sleep 2; echo run >> slow.log', '--verify-final', 'test ! -e red.flag').status, 0);
  const first = lpk(repo, 'o', 'verify', '--final');
  assert.equal(first.status, 0, first.stderr + first.stdout);
  write(repo, 'red.flag', '');
  const second = lpk(repo, 'o', 'verify', '--final');
  assert.equal(second.status, 1);
  assert.equal(readFileSync(join(repo, 'slow.log'), 'utf8'), 'run\n', 'the slow final check ran again before the cheap red one');
});

test('R5: a check\'s timeout is the larger of its floor and 1.5 times its last green duration in any run', () => {
  const rec = (run, cmd, exit, ms, extra = {}) => ({ kind: 'verify', run, results: [{ cmd, exit, ms }], ...extra });
  const records = [rec('a', 'slow', 0, 1_800_000), rec('b', 'slow', 0, 2_400_000, { final: true }), rec('c', 'slow', 1, 9_000_000), rec('c', 'quick', 0, 5000), { kind: 'prove', results: [{ cmd: 'ignored', exit: 0, ms: 99_000_000 }] }];
  assert.equal(timeoutFor(records, 'slow', {}), 3600, '1.5 x the latest green run of the exact command, a red run does not count');
  assert.equal(timeoutFor(records, 'quick', {}), 1200, 'the fast floor');
  assert.equal(timeoutFor(records, 'quick', { final: true }), 7200, 'the final floor');
  assert.equal(timeoutFor(records, 'never ran', {}), 1200);
  assert.equal(timeoutFor(records, 'slow', { explicit: 30 }), 30, '--timeout wins');
  assert.equal(timeoutFor(records, 'ignored', {}), 1200);
});

test('R5: the CLI gives a fast check 1200 s, a final check 7200 s, and --timeout the seconds it names', () => {
  const repo = repoWith('tiers-limit', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 't', '--verify', 'true', '--verify-final', 'true; :').status, 0);
  assert.equal(lpk(repo, 't', 'verify').status, 0);
  assert.equal(lpk(repo, 't', 'verify', '--final').status, 0);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  assert.equal(lpk(repo, 't', 'verify', '--timeout', '30').status, 0);
  assert.deepEqual(verifyRecords(repo).map((r) => [Boolean(r.final), r.results[0].limit]), [[false, 1200], [true, 7200], [false, 30]]);
});

test('R5: --timeout stops a check that runs longer, red and within seconds; zero or text is a usage error', () => {
  const repo = repoWith('tiers-kill', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 'k', '--verify', 'sleep 5').status, 0);
  const t0 = Date.now();
  const slow = lpk(repo, 'k', 'verify', '--timeout', '1');
  assert.equal(slow.status, 1, slow.stderr + slow.stdout);
  assert.ok(Date.now() - t0 < 4500, `the check ran ${Date.now() - t0} ms`);
  assert.equal(verifyRecords(repo).at(-1).results[0].limit, 1);
  for (const bad of ['0', 'abc']) assert.equal(lpk(repo, 'k', 'verify', '--timeout', bad).status, 2, bad);
});

test('R4: the requirements gate holds a test-proved requirement only once the final tier is green on HEAD', () => {
  const repo = repoWith('tiers-req', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 'q', '--lane', 'quick', '--why', 'small', '--req', 'a is 2', '--verify', 'true', '--verify-final', 'true; :').status, 0);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  write(repo, 'tests/a.test.mjs', "test('R1: a is 2', () => {});\n");
  assert.equal(lpk(repo, 'q', 'verify').status, 0);
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'change');
  assert.equal(gateRow(repo, 'q', 'requirements').holds, false);
  assert.equal(lpk(repo, 'q', 'verify', '--final').status, 0);
  assert.equal(gateRow(repo, 'q', 'requirements').holds, true);
});

test('R4: the plan row names a final list that changed after go', () => {
  const repo = repoWith('tiers-go', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(begin(repo, 'g', '--verify', 'true', '--verify-final', 'echo one').status, 0);
  assert.equal(lpk(repo, 'g', 'go').status, 0);
  assert.equal(gateRow(repo, 'g', 'plan').why, '');
  assert.equal(begin(repo, 'g', '--verify-final', 'echo two').status, 0);
  assert.notEqual(gateRow(repo, 'g', 'plan').why, '');
});
