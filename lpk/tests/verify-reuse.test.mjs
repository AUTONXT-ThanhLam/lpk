import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { hook, lpk, reason, repoWith, tmp, write } from './hooks-env.mjs';
import { readRecords } from '../lib/records.mjs';
import { runDir } from '../lib/run.mjs';

const commitHook = (repo, session) => hook('PreToolUse', 'commit', { tool_name: 'Bash', cwd: repo, session_id: session, tool_input: { command: 'git commit -am x' } });
const begin = (repo, session, ...args) => lpk(repo, session, 'run', 'start', '--target', 'main', ...args);
const count = (name) => join(tmp, `${name}.count`);
const inBash = (path) => path.replaceAll('\\', '/');
const bump = (name) => `echo x >> ${inBash(count(name))}`;
const runs = (name) => (existsSync(count(name)) ? readFileSync(count(name), 'utf8').trim().split('\n').length : 0);
const lastVerify = (repo) => readRecords(repo).filter((r) => r.kind === 'verify').at(-1);
const fresh = (name) => repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
const logDir = (repo) => join(runDir(repo), 'verify-logs');

test('R1: a failing check keeps its output in a log whose path is printed and recorded; green and stopped checks leave none', () => {
  const repo = fresh('reuse-log');
  assert.equal(begin(repo, 'lg', '--verify', 'echo fine', '--verify', 'for i in $(seq 1 40); do echo line $i; done; exit 1').status, 0);
  const red = lpk(repo, 'lg', 'verify');
  assert.equal(red.status, 1);
  const path = red.stdout.match(/last 1 MiB of output\): (\S+)/)?.[1];
  assert.ok(path, red.stdout);
  const body = readFileSync(path, 'utf8').split('\n');
  assert.ok(body.includes('line 1') && body.includes('line 40'));
  const [green, failed] = lastVerify(repo).results;
  assert.equal(failed.log, path);
  assert.equal(green.log, undefined);
  assert.deepEqual(readdirSync(logDir(repo)), [basename(path)]);

  const par = fresh('reuse-stopped');
  assert.equal(begin(par, 'st', '--verify', 'sleep 5', '--verify', 'echo boom; exit 1').status, 0);
  const stopped = lpk(par, 'st', 'verify', '--parallel');
  assert.equal(stopped.status, 1);
  const [slow, boom] = lastVerify(par).results;
  assert.equal(slow.exit, 'stopped');
  assert.equal(slow.log, undefined);
  assert.equal(readFileSync(boom.log, 'utf8').trim(), 'boom');

  const slept = fresh('reuse-killed');
  assert.equal(begin(slept, 'kl', '--verify', 'echo started; sleep 5').status, 0);
  assert.equal(lpk(slept, 'kl', 'verify', '--timeout', '1').status, 1);
  assert.match(readFileSync(lastVerify(slept).results[0].log, 'utf8'), /started/);
});

test('R1: a log that cannot be written leaves the result, the FAIL line and the record intact', () => {
  const repo = fresh('reuse-nolog');
  assert.equal(begin(repo, 'nl', '--verify', 'echo boom; exit 1').status, 0);
  mkdirSync(runDir(repo), { recursive: true });
  writeFileSync(logDir(repo), 'not a directory');
  const red = lpk(repo, 'nl', 'verify');
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stdout, /FAIL `echo boom; exit 1` exit 1/);
  assert.match(red.stdout, /boom/);
  const [failed] = lastVerify(repo).results;
  assert.equal(failed.exit, 1);
  assert.equal(failed.log, undefined);
});

test('R2 R4: the next full verify runs only the checks not green on this tree and the record counts at the commit gate', () => {
  const repo = fresh('reuse-flow');
  const a = bump('flow-a');
  const b = `${bump('flow-b')}; test $(wc -l < ${inBash(count('flow-b'))}) -gt 1`;
  assert.equal(begin(repo, 'fl', '--verify', a, '--verify', b).status, 0);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');

  assert.equal(lpk(repo, 'fl', 'verify').status, 1);
  assert.match(reason(commitHook(repo, 'fl')), /./, 'a red verify lets no commit through');
  const original = lastVerify(repo).results[0];
  const again = lpk(repo, 'fl', 'verify');
  assert.equal(again.status, 0, again.stdout);
  assert.ok(again.stdout.includes(`ok   \`${a}\` green earlier on this tree, not run again`), again.stdout);
  assert.match(again.stdout, /verified: green on tree [0-9a-f]{12}/);
  assert.deepEqual([runs('flow-a'), runs('flow-b')], [1, 2]);
  const rec = lastVerify(repo);
  assert.equal(rec.partial, false);
  assert.equal(rec.green, true);
  assert.deepEqual(rec.results[0], { cmd: a, exit: 0, ms: original.ms, limit: original.limit, reused: true });
  assert.equal(reason(commitHook(repo, 'fl')), '');

  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  assert.equal(lpk(repo, 'fl', 'verify').status, 0);
  assert.deepEqual([runs('flow-a'), runs('flow-b')], [2, 3], 'a code edit reruns every check');
});

test('R2 R4: a later red of a check on the same tree cancels its earlier green', () => {
  const repo = fresh('reuse-newest');
  const flag = join(tmp, 'newest.flag');
  const a = `${bump('newest-a')}; test ! -e ${inBash(flag)}`;
  assert.equal(begin(repo, 'nw', '--verify', a, '--verify', 'true').status, 0);
  assert.equal(lpk(repo, 'nw', 'verify').status, 0);
  write(tmp, 'newest.flag', 'x');
  assert.equal(lpk(repo, 'nw', 'verify', '--only', '1').status, 1);
  const full = lpk(repo, 'nw', 'verify');
  assert.equal(full.status, 1, full.stdout);
  assert.ok(!full.stdout.includes(`\`${a}\` green earlier`), full.stdout);
  assert.equal(runs('newest-a'), 3);
  assert.equal(lastVerify(repo).green, false);
});

test('R2: a green that ran while a code file changed is not reused', () => {
  const repo = fresh('reuse-moving');
  const a = bump('moving-a');
  assert.equal(begin(repo, 'mo', '--verify', a, '--verify', "echo '// edit' >> src/a.mjs").status, 0);
  const first = lpk(repo, 'mo', 'verify');
  assert.equal(first.status, 1);
  assert.match(first.stdout, /Files changed while the checks ran/);
  assert.equal(lastVerify(repo).stable, false);
  lpk(repo, 'mo', 'verify');
  assert.equal(runs('moving-a'), 2);
});

test('R3: --only runs the named check again and says the full verify is still owed', () => {
  const repo = fresh('reuse-only');
  const a = bump('only-a');
  assert.equal(begin(repo, 'on', '--verify', a, '--verify', 'true').status, 0);
  assert.equal(lpk(repo, 'on', 'verify').status, 0);
  const only = lpk(repo, 'on', 'verify', '--only', '1');
  assert.equal(only.status, 0, only.stdout);
  assert.equal(runs('only-a'), 2);
  assert.match(only.stdout, /full `lpk verify` is still owed[^\n]*only the checks not green on that tree/);
  assert.equal(lastVerify(repo).partial, true);
});

test('R4 final: --final runs a final check again even when it is green on the same tree', () => {
  const repo = fresh('reuse-final');
  const f = bump('final-f');
  assert.equal(begin(repo, 'fi', '--verify', 'true', '--verify-final', f).status, 0);
  assert.equal(lpk(repo, 'fi', 'verify', '--final').status, 0);
  const second = lpk(repo, 'fi', 'verify', '--final');
  assert.equal(second.status, 0, second.stdout);
  assert.equal(runs('final-f'), 2);
  assert.ok(!second.stdout.includes('green earlier'));
  assert.equal(lastVerify(repo).results[0].reused, undefined);
});

test('R2: a green is not reused when a sibling check rewrote a tracked non-code file during the run', () => {
  const repo = repoWith('reuse-sibling', { 'src/a.mjs': 'export const a = 1;\n', 'data.json': '{"v":0}\n' });
  const a = bump('sibling-a');
  const b = `${bump('sibling-b')}; echo '{"v":1}' > data.json`;
  assert.equal(begin(repo, 'sb', '--verify', a, '--verify', b).status, 0);
  assert.equal(lpk(repo, 'sb', 'verify').status, 0);
  assert.equal(lastVerify(repo).stable, false);
  const second = lpk(repo, 'sb', 'verify');
  assert.equal(second.status, 0, second.stdout);
  assert.ok(!second.stdout.includes('green earlier'), second.stdout);
  assert.deepEqual([runs('sibling-a'), runs('sibling-b')], [2, 2]);
  assert.equal(lastVerify(repo).stable, true);
  assert.equal(lpk(repo, 'sb', 'verify').status, 0);
  assert.deepEqual([runs('sibling-a'), runs('sibling-b')], [2, 2], 'a run that left the tree as it found it is reusable');
});

test('R2: --parallel reuses a green check from an earlier red run on the same tree', () => {
  const repo = fresh('reuse-parallel');
  const flag = join(tmp, 'parallel.flag');
  const a = bump('parallel-a');
  const b = `${bump('parallel-b')}; sleep 1; test -e ${inBash(flag)}`;
  assert.equal(begin(repo, 'pl', '--verify', a, '--verify', b).status, 0);
  assert.equal(lpk(repo, 'pl', 'verify', '--parallel').status, 1);
  write(tmp, 'parallel.flag', 'x');
  const again = lpk(repo, 'pl', 'verify', '--parallel');
  assert.equal(again.status, 0, again.stdout);
  assert.ok(again.stdout.includes(`ok   \`${a}\` green earlier on this tree, not run again`), again.stdout);
  assert.deepEqual([runs('parallel-a'), runs('parallel-b')], [1, 2]);
});
