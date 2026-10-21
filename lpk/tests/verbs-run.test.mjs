// The verbs that run things: repeat, slot, spawn and reap; and the ones that read a run's state for
// the lead: watch and handoff.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { commit, ENV, lpk, lpkAsync, repoWith, sh, tmp, write } from './verbs-env.mjs';
import { listening } from '../lib/spawn.mjs';

test('lpk repeat runs a command for as long as the budget allows and counts the runs that failed', () => {
  const dir = join(tmp, 'repeat');
  write(dir, 'n', '0');
  // Every third run fails.
  const r = lpk(dir, 'repeat', '--for', '2', '--', 'n=$(( $(cat n) + 1 )); echo $n > n; echo run $n; [ $((n % 3)) -ne 0 ]');
  assert.equal(r.status, 0, r.stderr);
  const n = Number(readFileSync(join(dir, 'n'), 'utf8'));
  assert.ok(n >= 6, `ran ${n} times in 2 s`);
  assert.match(r.stdout, new RegExp(`: ${n} run\\(s\\) in \\d+s, ${Math.floor(n / 3)} failed \\(${Math.floor(n / 3)}x exit 1\\)`));
  assert.match(r.stdout, /first failure, run 3 \(exit 1\)[^\n]*\n {2}\| run 3/);
});

test('lpk slot runs two heavy commands one after the other when memory allows one slot', async () => {
  const dir = join(tmp, 'slot');
  write(dir, 'log', '');
  const job = (name) => lpkAsync(dir, 'slot', '--mb', '100000000', '--', `echo "${name} start $(date +%s%N)" >> log; sleep 1; echo "${name} end $(date +%s%N)" >> log`);
  const [a, b] = await Promise.all([job('a'), job('b')]);
  assert.equal(a.status, 0, a.out);
  assert.equal(b.status, 0, b.out);
  const ev = readFileSync(join(dir, 'log'), 'utf8').trim().split('\n').map((l) => l.split(' ')[1]);
  assert.deepEqual(ev, ['start', 'end', 'start', 'end'], 'the second started only after the first ended');
  assert.match(lpk(dir, 'slot', '--count', '--mb', '100000000').stdout, /^1 slot\(s\)/);
  assert.equal(lpk(dir, 'slot', '--', 'exit 7').status, 7, 'the command\'s own exit code comes back');
});

test('a command given as words after -- reaches the program word for word, and one string runs as a command line', () => {
  const dir = join(tmp, 'slot-argv');
  write(dir, 'log', '');
  const r = lpk(dir, 'slot', '--', 'printf', '[%s]\\n', 'a b', "it's", '$HOME;x');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "[a b]\n[it's]\n[$HOME;x]\n");
  assert.equal(lpk(dir, 'slot', '--', 'echo one && echo two').stdout, 'one\ntwo\n');
});

test('lpk spawn reuses the app it started for the same commit and port, and lpk reap stops exactly it', async () => {
  const repo = repoWith('spawn', { 'server.js': "require('http').createServer((q, s) => s.end('ok')).listen(process.env.PORT);\n" });
  const port = 20000 + (process.pid % 20000);
  const first = lpk(repo, 'spawn', '--port', String(port), '--', 'node server.js');
  assert.equal(first.status, 0, first.stderr);
  const pid = first.stdout.match(/started pid (\d+)/)?.[1];
  assert.ok(pid, first.stdout);
  const again = lpk(repo, 'spawn', '--port', String(port), '--', 'node server.js');
  assert.match(again.stdout, new RegExp(`reusing pid ${pid} on port ${port}`));
  const other = lpk(repo, 'spawn', '--port', String(port), '--data-dir', join(tmp, 'other-data'), '--', 'node server.js');
  assert.equal(other.status, 1, 'another data dir is another app, and the port is taken');
  assert.match(other.stderr, /in use by a process lpk did not start/);
  const reap = lpk(repo, 'reap');
  assert.equal(reap.status, 0, reap.stdout);
  assert.match(reap.stdout, new RegExp(`stopped: pid ${pid} port ${port}`));
  assert.equal(await listening(port), false);
  assert.match(lpk(repo, 'reap').stdout, /nothing lpk spawn started/);
});

// A transcript line as Claude Code writes it.
const entry = (type, at, content, extra = {}) => JSON.stringify({ type, timestamp: at, message: { role: type, content, ...extra } });

test('lpk watch prints one line for an agent with no tool call for the threshold, and none for a finished one', () => {
  const session = 'watch-session';
  const dir = join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-x', session, 'subagents');
  const old = new Date(Date.now() - 30 * 60000).toISOString();
  write(dir, 'agent-stuck.jsonl', [entry('user', old, 'review abc1234'), entry('assistant', old, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], { id: 'm1' })].join('\n'));
  write(dir, 'agent-stuck.meta.json', JSON.stringify({ agentType: 'lpk:verifier', description: 'verify F1' }));
  write(dir, 'agent-done.jsonl', [entry('user', old, 'x'), entry('assistant', old, [{ type: 'text', text: 'done' }], { id: 'm2', stop_reason: 'end_turn' })].join('\n'));
  write(dir, 'agent-done.meta.json', JSON.stringify({ agentType: 'lpk:techlead' }));
  const r = lpk(tmp, 'watch', '--session', session, '--minutes', '10', '--once');
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout.trim().split('\n');
  assert.equal(out.length, 1, r.stdout);
  assert.match(out[0], /^stalled: lpk:verifier "verify F1" has made no tool call for 30 min \(last: Bash at \d\d:\d\d UTC, still waiting for its result\)/);
});

test('lpk handoff prints a stuck slice\'s files, worktree, commits, uncommitted edits and last verify', () => {
  const repo = repoWith('handoff', { 'a.js': 'a\n', 'b.js': 'b\n' });
  sh(repo, 'switch', '-q', 'main');
  const wt = join(tmp, 'handoff-api');
  sh(repo, 'worktree', 'add', '-q', '-b', 'slice-api', wt);
  commit(wt, 'Start the api slice', { 'a.js': 'a2\n' });
  write(wt, 'b.js', 'b2\n');
  write(join(repo, '.git', 'lpk'), 'brief.json', JSON.stringify({ slices: [{ id: 'api', files: ['a.js'] }] }));
  const r = lpk(repo, 'handoff', 'api', '--base', 'main');
  assert.equal(r.status, 2, 'handoff takes no --base');
  const h = lpk(repo, 'handoff', 'api');
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /slice api: owns a\.js/);
  assert.match(h.stdout, new RegExp(`worktree: ${wt} on slice-api`));
  assert.match(h.stdout, /commits since base: 1\n {2}[0-9a-f]+ Start the api slice/);
  assert.match(h.stdout, /uncommitted: 1 path\(s\)\n {2} M b\.js/);
  assert.match(h.stdout, /changed beyond the slice's files: b\.js/);
  assert.match(h.stdout, /last lpk verify: none in this run/);
});
