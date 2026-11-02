import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { lpk, repoWith, sh, write } from './hooks-env.mjs';

const runFile = (repo) => join(sh(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk', 'run.json');
const readRun = (repo) => JSON.parse(readFileSync(runFile(repo), 'utf8'));
const start = (repo, S, ...a) => lpk(repo, S, 'run', 'start', '--target', 'main', '--verify', 'true', ...a);
const CLI = ['--scenario', 'true', '--surface', 'cli', '--entry', 'true'];
const UI = ['--judged', 'the owner sees the total', '--surface', 'ui', '--entry', '/ after login', '--leaves', 'screenshot of the total'];

test('S1 R1 a scenario without --surface or --entry is refused and names the flag', () => {
  const repo = repoWith('rec-missing', { 'a.txt': 'a\n' });
  const none = start(repo, 'm1', '--scenario', 'true');
  assert.equal(none.status, 2);
  assert.match(none.stderr, /--surface/);
  const noEntry = start(repo, 'm1', '--scenario', 'true', '--surface', 'cli');
  assert.equal(noEntry.status, 2);
  assert.match(noEntry.stderr, /--entry/);
  assert.equal(lpk(repo, 'm1', 'run', 'status').stdout.trim(), 'no lpk run in this repo');
});

test('S1 R1 a surface flag before any scenario is refused', () => {
  const repo = repoWith('rec-orphan', { 'a.txt': 'a\n' });
  const r = start(repo, 'o1', '--surface', 'ui');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--surface follows/);
});

test('S1 R2 a --scenario command on surface ui is refused; a judged ui scenario starts and is recorded', () => {
  const repo = repoWith('rec-ui', { 'a.txt': 'a\n' });
  assert.equal(start(repo, 'u1', '--scenario', 'true', '--surface', 'ui', '--entry', '/').status, 2);
  const ok = start(repo, 'u1', ...UI);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /ui/);
  assert.match(ok.stdout, /\/ after login/);
  const [s] = readRun(repo).scenarios;
  assert.deepEqual([s.surface, s.entry, s.leaves], ['ui', '/ after login', 'screenshot of the total']);
});

test('FM4 R1 restating keeps the fields and refuses a restated scenario that drops them', () => {
  const repo = repoWith('rec-restate', { 'a.txt': 'a\n' });
  assert.equal(start(repo, 'r1', ...UI).status, 0);
  assert.equal(start(repo, 'r1', ...UI).status, 0);
  assert.equal(start(repo, 'r1').status, 0, 'a start that restates no scenario keeps them');
  assert.equal(readRun(repo).scenarios[0].surface, 'ui');
  const dropped = start(repo, 'r1', '--judged', 'the owner sees the total');
  assert.equal(dropped.status, 2);
  assert.match(dropped.stderr, /--surface/);
  assert.equal(readRun(repo).scenarios[0].entry, '/ after login');
});

test('R9 scenariosAt moves when a recorded field changes and not when a missing one is filled in', () => {
  const repo = repoWith('rec-at', { 'a.txt': 'a\n' });
  assert.equal(start(repo, 'a1', ...UI).status, 0);
  assert.equal(start(repo, 'a1', ...UI).status, 0);
  assert.equal(readRun(repo).scenariosAt, undefined, 'the same scenarios restated');
  const changed = ['--judged', 'the owner sees the total', '--surface', 'ui', '--entry', '/ after login', '--leaves', 'a recording'];
  assert.equal(start(repo, 'a1', ...changed).status, 0);
  assert.ok(readRun(repo).scenariosAt, 'a recorded leaves changed');
  const run = readRun(repo);
  delete run.scenariosAt;
  run.scenarios = [{ id: 'S1', agentJudged: 'the owner sees the total' }];
  writeFileSync(runFile(repo), JSON.stringify(run));
  assert.equal(start(repo, 'a1', ...UI).status, 0);
  assert.equal(readRun(repo).scenariosAt, undefined, 'filling the missing fields in leaves earlier Prover results');
  assert.equal(readRun(repo).scenarios[0].surface, 'ui');
});

test('S6 R7 the scenario log keeps the first list and each change whole, in a quick lane run with no go', () => {
  const repo = repoWith('rec-log', { 'a.txt': 'a\n' });
  assert.equal(start(repo, 'l1', '--lane', 'quick', '--why', 'one file', ...CLI).status, 0);
  assert.equal(start(repo, 'l1', ...CLI).status, 0);
  assert.equal(readRun(repo).scenarioLog.length, 1, 'a restated list is no change');
  assert.equal(start(repo, 'l1', '--req', 'one', '--scenario', 'echo hi', '--surface', 'cli', '--entry', 'echo hi', '--expect', 'hi', '--proves', 'R1').status, 0);
  assert.equal(scenarioLog.length, 2);
  assert.equal(scenarioLog[0].scenarios[0].cmd, 'true');
  assert.deepEqual(scenarioLog[1].scenarios[0], { id: 'S1', cmd: 'echo hi', expect: 'hi', proves: ['R1'], surface: 'cli', entry: 'echo hi' });
  assert.ok(scenarioLog[1].at);
});

test('S7 R8 the report prints surface, entry and evidence per scenario and the surfaces per requirement', () => {
  const repo = repoWith('rec-report', { 'a.txt': 'a\n' });
  assert.equal(start(repo, 'p1', '--lane', 'quick', '--why', 'one file', '--req', 'the total shows', ...UI, '--proves', 'R1').status, 0);
  const r = lpk(repo, 'p1', 'report');
  const out = r.stdout + r.stderr;
  assert.match(out, /\| S \| Scenario \| Surface \| Entry \| Evidence \| Status on HEAD \|/);
  assert.match(out, /\| S1 \| .*\| ui \| \/ after login \|/);
  assert.match(out, /\| R1 \| the total shows \|.*\| ui \|/);
});

test('R9 adding fields to brief.json after a design round passed does not put the brief check back', () => {
  const repo = repoWith('rec-brief', { 'src/a.mjs': 'export const a = 1;\n' });
  const dir = join(repo, '.git', 'lpk');
  const scenario = { id: 'S1', text: 'call a twice', cmd: 'true', proves: ['R1'], surface: 'library', entry: 'import a' };
  const brief = (s) => JSON.stringify({ requirements: [{ id: 'R1', text: 'a is doubled' }], scenarios: [s] });
  write(dir, 'brief.md', '# Brief\n');
  write(dir, 'brief.json', brief({ ...scenario, surface: undefined, entry: undefined }));
  const refused = lpk(repo, 'b1', 'run', 'start', '--verify', 'false', '--lane', 'full');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /brief\.json/);
  write(dir, 'brief.json', brief(scenario));
  assert.equal(lpk(repo, 'b1', 'run', 'start', '--verify', 'false', '--lane', 'full').status, 0);
  assert.equal(lpk(repo, 'b1', 'decide', 'design review round 1: pass, 0/1/0', '--why', 'the critic answered').status, 0);
  write(dir, 'brief.json', brief({ ...scenario, entry: 'import { a } from "x"', leaves: 'the output' }));
  const go = lpk(repo, 'b1', 'go');
  assert.equal(go.status, 0, go.stderr);
});
