// The run's hooks as Claude Code runs them: each command from hooks.json, fed the event JSON, in a
// real git repo with a real run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { context, ENV, hook, reason, repoWith, ROOT, sh, startRun, tmp, write } from './hooks-env.mjs';

const records = (dir) => (existsSync(join(dir, 'records.jsonl')) ? readFileSync(join(dir, 'records.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('inside a run a gate that cannot read the run denies, naming the error and the waiver; another repo is left alone', () => {
  const repo = repoWith('broken', { 'src/a.mjs': 'export const a = 1;\n' });
  const other = repoWith('elsewhere', { 'src/a.mjs': 'export const a = 1;\n' });
  const dir = startRun(repo, 'broken');
  writeFileSync(join(dir, 'run.json'), '{ half a file');
  const commit = (cwd) => hook('PreToolUse', 'commit', { tool_name: 'Bash', session_id: 'broken', cwd, tool_input: { command: 'git commit -am x' } });
  const out = reason(commit(repo));
  assert.match(out, /the commit gate failed \(.*run\.json cannot be read/);
  assert.match(out, /labelled exactly `gate:commit`/);
  assert.equal(commit(other), null);
  // Input the gate cannot even parse still denies inside the run, and a hint hook stays quiet.
  const raw = (name) => spawnSync('node', [join(ROOT, 'lib', 'cmd', 'hook.mjs'), name], { cwd: repo, env: ENV, input: 'not json', encoding: 'utf8' });
  assert.match(JSON.parse(raw('commit').stdout).hookSpecificOutput.permissionDecisionReason, /commit gate failed/);
  const quiet = raw('trim');
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');
});

test('the owner\'s picks on the waiver question are recorded and release what they name; an unanswered question records nothing', () => {
  const repo = repoWith('waive', { 'a.txt': 'a\n' });
  const dir = startRun(repo, 'waive');
  const questions = [{ question: 'Which of these do you release?', header: 'Waive', multiSelect: true, options: [
    { label: 'connector:editJiraIssue', description: 'post the status to KD-1' }, { label: 'gate:commit', description: '' }, { label: 'F3, F4', description: 'same cause' }] }];
  const ask = (response, source = 'lpk:waive') => hook('PostToolUse', 'waive', { tool_name: 'AskUserQuestion', session_id: 'waive', cwd: repo, tool_input: { questions, metadata: { source } }, tool_response: { questions, ...response } });
  const jira = () => hook('PreToolUse', 'pre', { tool_name: 'mcp__atlassian__editJiraIssue', session_id: 'waive', cwd: repo, tool_input: {} });
  assert.match(reason(jira()), /connector writes wait/);
  assert.equal(ask({ answers: { [questions[0].question]: 'connector:editJiraIssue' }, afkTimeoutMs: 60000 }), null, 'closed while the owner was away');
  assert.equal(ask({ answers: { [questions[0].question]: 'connector:editJiraIssue' } }, 'something-else'), null, 'another question');
  assert.equal(ask({ answers: {} }), null, 'nothing picked');
  assert.deepEqual(records(dir).filter((r) => r.kind === 'waiver'), []);
  assert.match(context(ask({ answers: { [questions[0].question]: 'connector:editJiraIssue, F3, F4' } })), /`connector:editJiraIssue`, `F3, F4`/);
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).id;
  assert.deepEqual(records(dir).filter((r) => r.kind === 'waiver').map((r) => [r.what, r.run]), [['connector:editJiraIssue', run], ['F3, F4', run]]);
  assert.equal(jira(), null, 'released for this run');
});

test('a long Bash result of an lpk agent comes back as head, tail, failure lines and the path of the whole log', () => {
  const repo = repoWith('trim', { 'a.txt': 'a\n' });
  const log = Array.from({ length: 30000 }, (_, i) => (i === 15000 ? 'FAIL src/a.test.ts > keeps the lock' : i === 20000 ? 'Error: expected 423, got 200' : `ok ${i}`)).join('\n');
  const bash = (agent_type, stdout) => hook('PostToolUse', 'trim', { tool_name: 'Bash', agent_id: 'b1', agent_type, session_id: 'trim', cwd: repo, tool_use_id: 'toolu_01', tool_input: { command: 'npm test' }, tool_response: { stdout, stderr: 'warn', interrupted: false } });
  const out = bash('lpk:builder', log).hookSpecificOutput.updatedToolOutput;
  assert.equal(out.interrupted, false);
  assert.ok(out.stdout.length < 8000, `${out.stdout.length} characters`);
  const file = join(sh(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk', 'out', 'toolu_01.log');
  assert.ok(out.stdout.includes(file));
  for (const line of ['ok 0', '15001: FAIL src/a.test.ts > keeps the lock', '20001: Error: expected 423, got 200', 'ok 29999']) assert.ok(out.stdout.includes(line), line);
  assert.equal(readFileSync(file, 'utf8'), `${log}\n--- stderr ---\nwarn`);
  assert.equal(bash('general-purpose', log), null, 'only lpk agents');
  assert.equal(bash('lpk:builder', 'short'), null);
});

test('an lpk agent starts with the run card: base, brief, rules, what it may not touch and how to load the ledger tools', () => {
  const repo = repoWith('card', { 'src/a.mjs': 'export const a = 1;\n' });
  const start = (agent_type, session_id = 'card') => hook('SubagentStart', 'card', { session_id, cwd: repo, agent_id: 'a1', agent_type });
  assert.equal(start('lpk:builder'), null, 'no run, no card');
  const dir = startRun(repo, 'card');
  writeFileSync(join(dir, 'brief.md'), '# Brief\n');
  const base = sh(repo, 'merge-base', 'main', 'HEAD').trim();
  const card = context(start('lpk:builder'));
  assert.match(card, new RegExp(`Base: ${base.slice(0, 12)}`));
  assert.ok(card.includes(`Design Brief: ${join(dir, 'brief.md')}`));
  assert.match(card, /rule applies to the change so far|Rules that apply to the change so far/);
  assert.match(card, /Edit only the files of your slice/);
  assert.ok(card.includes('select:mcp__plugin_lpk_lpk__finding_add,mcp__plugin_lpk_lpk__finding_list,mcp__plugin_lpk_lpk__finding_get,mcp__plugin_lpk_lpk__finding_verdict,mcp__plugin_lpk_lpk__finding_fixed'));
  assert.match(context(start('lpk:techlead')), /You never edit a checkout/);
});

test('after a resume the session learns the last workflow run, the open findings and the apps still running', () => {
  const repo = repoWith('resume', { 'src/a.mjs': 'export const a = 1;\n' });
  const dir = startRun(repo, 'resume');
  const transcript = join(tmp, 'projects', 'resume.jsonl');
  mkdirSync(join(tmp, 'projects', 'resume', 'workflows'), { recursive: true });
  writeFileSync(join(tmp, 'projects', 'resume', 'workflows', 'wf_1234abcd-001.json'), JSON.stringify({ runId: 'wf_1234abcd-001', workflowName: 'lpk-review', status: 'running', workflowProgress: [
    { type: 'workflow_phase', title: 'Review' }, { type: 'workflow_agent', label: 'techlead', state: 'done' }, { type: 'workflow_agent', label: 'claims', state: 'running' }] }));
  const add = `const { addFinding } = await import(${JSON.stringify(join(ROOT, 'lib', 'findings.mjs'))}); const r = addFinding(process.cwd(), { from: 'lpk:techlead', at: 'abc..def', claim: 'the lock leaks', repro: 'npm test', kind: 'defect', severity: 'important', file: 'src/a.mjs', line: 1 }); if (r.error) { console.error(r.error); process.exit(1); }`;
  const p = spawnSync('node', ['--input-type=module', '-e', add], { cwd: repo, env: ENV, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  const card = context(hook('SessionStart', 'start', { source: 'resume', session_id: 'resume', cwd: repo, transcript_path: transcript }));
  assert.match(card, /inside an lpk run in .*\/resume/);
  assert.match(card, /Last workflow run: wf_1234abcd-001 \(lpk-review, running\); finished: techlead; not finished: claims \(running\)/);
  assert.match(card, /Open findings \(1\): F1 open src\/a\.mjs:1/);
  assert.match(card, /No app from `lpk spawn` is running/);
  rmSync(dir, { recursive: true, force: true });
});

test('ending a turn on unverified source is told and never held', () => {
  const repo = repoWith('stop', { 'src/a.mjs': 'export const a = 1;\n' });
  startRun(repo, 'stop');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  const out = hook('Stop', 'stop', { session_id: 'stop', cwd: repo, stop_hook_active: false });
  assert.equal(out.decision, undefined);
  assert.match(context(out), /not verified on the current tree \(no `lpk verify` has run/);
});

test('a deleted test file, removed test lines and an added skip marker come back as hints after the edit', () => {
  const repo = repoWith('tests', { 'src/a.mjs': 'export const a = 1;\n', 'tests/a.test.mjs': 'test(1);\ntest(2);\n', 'tests/b.test.mjs': 'test(3);\n' });
  startRun(repo, 'tests');
  rmSync(join(repo, 'tests', 'b.test.mjs'));
  write(repo, 'tests/a.test.mjs', 'test.only(1);\n');
  const out = context(hook('PostToolUse', 'post', { tool_name: 'Bash', session_id: 'tests', cwd: repo, tool_input: { command: 'git rm tests/b.test.mjs' } }));
  assert.match(out, /test-deleted {2}tests\/b\.test\.mjs is deleted/);
  assert.match(out, /test-lines-removed {2}tests\/a\.test\.mjs: 2 line\(s\) removed/);
  assert.match(out, /test-skipped {2}tests\/a\.test\.mjs:1 {2}test\.only\(1\);/);
  assert.equal(hook('PostToolUse', 'post', { tool_name: 'Bash', session_id: 'tests', cwd: repo, tool_input: { command: 'ls' } }), null, 'told once');
});
