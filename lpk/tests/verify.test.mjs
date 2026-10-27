import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, hook, lpk, reason, repoWith, write } from './hooks-env.mjs';

const start = (repo, session, ...checks) => {
  const r = lpk(repo, session, 'run', 'start', '--target', 'main', ...checks.flatMap((c) => ['--verify', c]));
  assert.equal(r.status, 0, r.stderr + r.stdout);
};
const commitHook = (repo, session) => hook('PreToolUse', 'commit', { tool_name: 'Bash', cwd: repo, session_id: session, tool_input: { command: 'git commit -am x' } });

test('a red check stops the run before the next check starts', () => {
  const repo = repoWith('stop', { 'src/a.mjs': 'export const a = 1;\n' });
  start(repo, 's', 'false', 'touch later.txt');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  const r = lpk(repo, 's', 'verify');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL `false`[\s\S]*skip `touch later\.txt` not run[\s\S]*NOT green \(stopped at the first red check/);
  assert.equal(existsSync(join(repo, 'later.txt')), false);
});

test('--parallel stops the checks still running when one goes red', () => {
  const repo = repoWith('par', { 'src/a.mjs': 'export const a = 1;\n' });
  start(repo, 'p', 'sleep 60', 'false');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  const t0 = Date.now();
  const r = lpk(repo, 'p', 'verify', '--parallel');
  assert.equal(r.status, 1);
  assert.ok(Date.now() - t0 < 30000, 'the sleeping check was killed');
  assert.match(r.stdout, /skip `sleep 60` stopped[\s\S]*FAIL `false`/);
});

test('--only runs the named checks and never opens the commit gate', () => {
  const repo = repoWith('only', { 'src/a.mjs': 'export const a = 1;\n' });
  start(repo, 'o', 'true', 'false');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  const r = lpk(repo, 'o', 'verify', '--only', '1');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /ok   `true`[\s\S]*counts for nothing at the commit gate/);
  assert.match(reason(commitHook(repo, 'o')), /commit refused/);
  const bad = lpk(repo, 'o', 'verify', '--only', 'nope');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /names none of the run's checks/);
});

test('killing lpk verify kills the checks it started', () => {
  const repo = repoWith('orphan', { 'src/a.mjs': 'export const a = 1;\n' });
  start(repo, 'k', 'sleep 47.5');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  spawnSync('node', [join(ENV.CLAUDE_PLUGIN_ROOT, 'bin', 'lpk'), 'verify'], { cwd: repo, env: { ...ENV, CLAUDE_CODE_SESSION_ID: 'k' }, timeout: 2500, killSignal: 'SIGTERM' });
  const left = spawnSync('pgrep', ['-fx', 'sleep 47.5']);
  assert.notEqual(left.status, 0, `checks left running: ${left.stdout}`);
});
