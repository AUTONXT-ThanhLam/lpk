import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { lpk, repoWith, write } from './gates-env.mjs';

const BRIEF = JSON.stringify({ requirements: [{ id: 'R1', text: 'a is doubled' }], scenarios: [{ id: 'S1', text: 'call a twice', cmd: 'true', proves: ['R1'] }] });
const dir = (repo) => join(repo, '.git', 'lpk');

function fullRun(name, S) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  write(dir(repo), 'brief.md', '# Brief\nA is doubled.\n');
  write(dir(repo), 'brief.json', BRIEF);
  const started = lpk(repo, S, 'run', 'start', '--verify', 'false', '--lane', 'full');
  assert.equal(started.status, 0, started.stderr + started.stdout);
  return repo;
}
const decide = (repo, S, what) => assert.equal(lpk(repo, S, 'decide', what, '--why', 'the critic answered').status, 0);
const go = (repo, S) => lpk(repo, S, 'go');

test('lpk go refuses a brief no design review round passed on as it stands, and takes it once one did', () => {
  const S = 'brief-check-go';
  const repo = fullRun('brief-go', S);

  const none = go(repo, S);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /design review round/);
  assert.match(none.stderr, /gate:brief-check/);

  decide(repo, S, 'design review round 1: revise, 2/1/0');
  assert.equal(go(repo, S).status, 1, 'a round that asked for a revision is not a pass');

  decide(repo, S, 'design review round 2: pass, 0/1/0');
  const passed = go(repo, S);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /go recorded/);
});

test('editing the brief after the round that passed puts the check back', () => {
  const S = 'brief-check-edit';
  const repo = fullRun('brief-edit', S);
  decide(repo, S, 'design review round 1: pass, 0/0/0');
  assert.equal(go(repo, S).status, 0);

  write(dir(repo), 'brief.md', '# Brief\nA is doubled, and B is tripled.\n');
  const after = go(repo, S);
  assert.equal(after.status, 1);
  assert.match(after.stderr, /changed after/);

  write(dir(repo), 'brief.json', BRIEF.replace('twice', 'three times'));
  decide(repo, S, 'design review round 1: last, 1/0/0');
  assert.equal(go(repo, S).status, 0, 'the last round is final whatever it left open');
});

test('the owner can waive the brief check, an agent cannot, and a run with no brief is unaffected', () => {
  const S = 'brief-check-waive';
  const repo = fullRun('brief-waive', S);
  assert.equal(lpk(repo, S, 'waive', 'gate:brief-check', '--why', 'agent says skip').status, 0);
  assert.equal(go(repo, S).status, 1, 'a waiver recorded by an agent counts for nothing');
  assert.equal(lpk(repo, S, 'waive', 'gate:brief-check', '--why', 'the owner reviewed it', '--via', 'ask').status, 0);
  assert.equal(go(repo, S).status, 0);

  const T = 'brief-check-none';
  const quick = repoWith('brief-none', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(lpk(quick, T, 'run', 'start', '--verify', 'false', '--lane', 'quick', '--req', 'a', '--scenario', 'true', '--proves', 'R1').status, 0);
  assert.equal(go(quick, T).status, 0);
});
