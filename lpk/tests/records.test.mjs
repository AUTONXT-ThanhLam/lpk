import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lpk, repoWith, startRun } from './hooks-env.mjs';
import { appendRecord } from '../lib/records.mjs';

const lines = (r) => r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('lpk records prints the open run\'s records, narrowed by kind, and refuses what it cannot read', () => {
  const repo = repoWith('records', { 'a.txt': 'a\n' });
  assert.equal(lpk(repo, 'rec', 'records').status, 2, 'no run and no --all');
  startRun(repo, 'rec');
  appendRecord(repo, { kind: 'go', checks: ['x'] });
  appendRecord(repo, { kind: 'verify', exit: 0 });
  const run = lines(lpk(repo, 'rec', 'records'));
  assert.deepEqual(run.map((r) => r.kind), ['go', 'verify']);
  assert.deepEqual(lines(lpk(repo, 'rec', 'records', '--kind', 'verify')).map((r) => r.exit), [0]);
  assert.deepEqual(lines(lpk(repo, 'rec', 'records', '--run', run[0].run)).length, 2);
  assert.equal(lines(lpk(repo, 'rec', 'records', '--run', 'no-such-run')).length, 0);
  appendRecord(repo, { kind: 'go', run: 'earlier-run' });
  assert.equal(lines(lpk(repo, 'rec', 'records')).length, 2, 'the open run only');
  assert.equal(lines(lpk(repo, 'rec', 'records', '--all')).length, 3);
  for (const args of [['--kind', 'verfy'], ['--all', '--run', 'x'], ['--run', ''], ['extra'], ['--nope']]) assert.equal(lpk(repo, 'rec', 'records', ...args).status, 2, args.join(' '));
});
