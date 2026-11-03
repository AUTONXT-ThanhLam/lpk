import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lpk, repoWith, sh, write } from './gates-env.mjs';
import { addFinding, ruleOn } from '../lib/findings.mjs';
import { endedRuns } from '../lib/run.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const lpkDir = (repo) => join(sh(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk');
const runId = (repo) => JSON.parse(readFileSync(join(lpkDir(repo), 'run.json'), 'utf8')).id;
const start = (repo, S) => ok(lpk(repo, S, 'run', 'start', '--target', 'main', '--verify', 'true'));
const findingsRow = (repo, S) => JSON.parse(lpk(repo, S, 'gates', '--json').stdout).find((r) => r.gate === 'findings');

function changedRepo(name) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  sh(repo, 'commit', '-qam', 'Set a to 2');
  return repo;
}

const raise = (repo, claim) => addFinding(repo, { from: 'lpk:bug-hunter', at: `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`, claim, repro: 'r', kind: 'defect', severity: 'important' }).finding.id;
const confirm = (repo, id) => ruleOn(repo, { id, verdict: 'confirmed', born: 'build', cause: 'c', reach: 'user', evidence: 'seen', by: 'lpk:verifier' });

test('S5 R4: a new run on a branch prints what earlier runs left until the lead logs it, and never lists itself or a later run', async () => {
  const S = 'left-session';
  const repo = changedRepo('left');
  start(repo, S);
  const a = runId(repo);
  raise(repo, 'stays open');
  ruleOn(repo, { id: raise(repo, 'could not be settled'), verdict: 'unsettled', evidence: 'no app', by: 'lpk:verifier' });
  confirm(repo, raise(repo, 'confirmed, never fixed'));
  confirm(repo, raise(repo, 'waits for later'));
  ok(lpk(repo, S, 'finding', 'fixed', 'F4', '--closed-by', 'defer', '--evidence', 'no user reaches the old export path'));
  ok(lpk(repo, S, 'waive', 'gate:reviews', '--why', 'the lens stalled twice'));
  ok(lpk(repo, S, 'run', 'end'));

  const started = start(repo, S);
  const b = runId(repo);
  for (const fact of [a, 'F1 open', 'F2 unsettled', 'F3 confirmed', 'F4 deferred', 'gate:reviews', 'not yet learned from: F3, F4']) assert.ok(started.includes(fact), `run start names ${fact}:\n${started}`);
  const open = findingsRow(repo, S);
  assert.equal(open.holds, true);
  assert.match(open.why, new RegExp(`${a}[^;]*F1 open`));

  ok(lpk(repo, S, 'run', 'end'));
  const ended = findingsRow(repo, S);
  assert.match(ended.read, new RegExp(b), 'the gates read the ended run');
  assert.match(ended.why, new RegExp(a));
  assert.doesNotMatch(ended.why, new RegExp(`run ${b} left`), 'an ended run never reports itself');

  start(repo, S);
  ok(lpk(repo, S, 'decide', `left behind by ${a}: each finding is in the PR body`, '--why', 'read them all'));
  assert.doesNotMatch(start(repo, S), new RegExp(a));
  assert.doesNotMatch(findingsRow(repo, S).why, new RegExp(a));
  assert.match(lpk(repo, S, 'report').stdout, new RegExp(`left behind by ${a}`));
  ok(lpk(repo, S, 'waive', 'gate:reviews', '--why', 'the lens stalled again'));
  const c = runId(repo);
  ok(lpk(repo, S, 'run', 'end'));

  const fourth = start(repo, S);
  assert.ok(fourth.includes(c), `the next run names the run before it:\n${fourth}`);
  assert.ok(!fourth.includes(a), 'a run the lead logged is not listed again on a later run');
  const { leftBehind } = await import('../lib/left.mjs');
  const runB = endedRuns(repo).find((r) => r.id === b);
  assert.deepEqual(leftBehind(repo, 'feat', runB), [], 'a run that ended after this one started is not what this one was left');
});

test('S5 R4: an earlier run whose archive cannot be read is named with the error, and neither run start nor the gate refuses', () => {
  const S = 'garbled-session';
  const repo = changedRepo('garbled');
  start(repo, S);
  const a = runId(repo);
  raise(repo, 'stays open');
  ok(lpk(repo, S, 'run', 'end'));
  start(repo, S);
  appendFileSync(join(lpkDir(repo), 'runs', a, 'findings.jsonl'), '{"ev": "add", "finding\n');
  assert.match(start(repo, S), new RegExp(`could not read run ${a}: .*not a JSON line`));
  const row = findingsRow(repo, S);
  assert.equal(row.holds, true);
  assert.match(row.why, new RegExp(`could not read run ${a}`));
});
