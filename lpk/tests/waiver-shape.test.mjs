import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { HOOKS } from '../lib/cmd/hook.mjs';
import { waiverOf } from '../lib/records.mjs';
import { readRun } from '../lib/run.mjs';
import { GATES } from '../lib/waiver.mjs';
import { context, hook, lpk, reason, repoWith, startRun } from './hooks-env.mjs';

const lines = (dir, file) => (existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const waivers = (dir) => lines(dir, 'records.jsonl').filter((r) => r.kind === 'waiver').map((r) => r.what);

function runIn(name, session, extra) {
  const repo = repoWith(name, { 'a.txt': 'a\n' });
  return { repo, dir: startRun(repo, session, extra) };
}

test('R2 the lead weighs a gate no agent can fix and waives it, and the gate row shows its reason', () => {
  const { repo } = runIn('lead-waive', 'lead', { scenarios: [{ id: 'S1', cmd: 'false', surface: 'cli', entry: 'false' }] });
  const before = lpk(repo, 'lead', 'gates').stdout;
  assert.match(before, /^scenarios +DENY /m, before);
  assert.match(before, /lpk waive gate:scenarios --why/);
  const r = lpk(repo, 'lead', 'waive', 'gate:scenarios', '--why', 'the service it calls is down for the day');
  assert.equal(r.status, 0, r.stderr);
  const after = lpk(repo, 'lead', 'gates').stdout;
  const row = after.slice(after.search(/^scenarios /m)).split(/\n(?=\S)/)[0];
  assert.match(row, /^scenarios +holds /, after);
  assert.ok(row.includes('lead') && row.includes('the service it calls is down for the day'), row);
});

test('R3 what leaves the machine or cannot be undone stays the owner\'s to waive', () => {
  const { repo, dir } = runIn('lead-owner', 'owner');
  for (const id of ['connector:editJiraIssue', 'git:reset --hard', 'pr:https://github.com/o/r/pull/1']) {
    const r = lpk(repo, 'owner', 'waive', id, '--why', 'x');
    assert.equal(r.status, 2, `${id}: ${r.stdout}`);
    assert.match(r.stderr, /waiver question/);
  }
  assert.deepEqual(waivers(dir), []);
  assert.equal(lpk(repo, 'owner', 'waive', 'connector:editJiraIssue', '--why', 'the owner said post it', '--via', '/lpk-waive').status, 0);
  assert.deepEqual(waivers(dir), ['connector:editJiraIssue']);
});

test('R3 gate:pre stays the owner\'s, and a git or connector id the tripwires do not know is refused', () => {
  const { repo, dir } = runIn('lead-pre', 'pre');
  const pre = lpk(repo, 'pre', 'waive', 'gate:pre', '--why', 'x');
  assert.equal(pre.status, 2, pre.stdout);
  assert.match(pre.stderr, /waiver question/);
  for (const id of ['git:reset --soft', 'connector:getJiraIssue']) {
    const r = lpk(repo, 'pre', 'waive', id, '--why', 'x', '--via', '/lpk-waive');
    assert.equal(r.status, 2, `${id}: ${r.stdout}`);
    assert.ok(r.stderr.includes(id) && r.stderr.includes('git:reset --hard'), r.stderr);
  }
  assert.deepEqual(waivers(dir), []);
});

test('R5 a picked label that is not a waiver id records nothing, and the hook says so with the forms', () => {
  const { repo, dir } = runIn('lead-drop', 'drop');
  for (const label of ['Waive, merge (Recommended)', 'git:reset --hard (Recommended)']) {
    const question = 'Release it?';
    const out = hook('PostToolUse', 'waive', { tool_name: 'AskUserQuestion', session_id: 'drop', cwd: repo,
      tool_input: { metadata: { source: 'lpk:waive' }, questions: [{ question, options: [{ label }] }] },
      tool_response: { answers: { [question]: label } } });
    assert.ok(context(out).includes(label) && context(out).includes('gate:<name>'), context(out));
  }
  assert.deepEqual(waivers(dir), []);
});

test('R4 only the lead session runs the waiver command; a subagent is refused, and nobody names the records file', () => {
  const repo = repoWith('lead-hook', { 'a.txt': 'a\n' });
  const bash = (command, extra = {}) => reason(hook('PreToolUse', 'pre', { tool_name: 'Bash', session_id: 'h', cwd: repo, tool_input: { command }, ...extra }));
  const waive = 'node lpk/bin/lpk waive gate:ci --why "CI is down"';
  assert.equal(bash(waive), '');
  assert.match(bash(waive, { agent_id: 'a1', agent_type: 'lpk:staff' }), /lead/);
  assert.match(bash('lpk waive connector:editJiraIssue --why x --via /lpk-waive'), /--via/);
  assert.match(bash('cat .git/lpk/records.jsonl'), /records\.jsonl/);
  assert.match(bash('cat .git/lpk/records.jsonl', { agent_id: 'a1' }), /records\.jsonl/);
});

test('R5 an id no gate reads is refused with the forms, and a bare gate name expands', () => {
  const { repo, dir } = runIn('lead-ids', 'ids');
  for (const id of ['gate:review', 'gate:reviews (Recommended)', 'gate:plan', 'Waive, merge']) {
    const r = lpk(repo, 'ids', 'waive', id, '--why', 'x');
    assert.equal(r.status, 2, `${id}: ${r.stdout}`);
    assert.ok(r.stderr.includes(id) && r.stderr.includes('gate:<name>'), r.stderr);
  }
  assert.deepEqual(waivers(dir), []);
  assert.equal(lpk(repo, 'ids', 'waive', 'reviews', 'commit', 'gate:brief-check', '--why', 'x').status, 0);
  assert.deepEqual(waivers(dir), ['gate:reviews', 'gate:commit', 'gate:brief-check']);
});

test('R6 lpk decide refuses a design round line it cannot parse, printing the shape, and records the right one', () => {
  const { repo, dir } = runIn('lead-decide', 'decide');
  const bad = lpk(repo, 'decide', 'decide', 'design review round 1 pass 0/2/1', '--why', 'x');
  assert.equal(bad.status, 2, bad.stdout);
  assert.match(bad.stderr, /design review round <n>: <verdict>, <High>\/<Medium>\/<Low>/);
  assert.match(bad.stderr, /design review round 1: pass, 0\/2\/1/);
  assert.equal(lines(dir, 'decisions.jsonl').length, 0);
  assert.equal(lpk(repo, 'decide', 'decide', '  design review round 1: pass, 0/2/1', '--why', 'x').status, 0);
  assert.equal(lpk(repo, 'decide', 'decide', 'use one test file', '--why', 'x').status, 0);
  assert.equal(lines(dir, 'decisions.jsonl').length, 2);
});

test('R7 every gate hook is a gate a waiver can name, and so is every gate the delivery gates print but the plan row', () => {
  const { repo } = runIn('lead-gates', 'gates');
  const hooks = Object.entries(HOOKS).filter(([, h]) => h.gate).map(([name]) => name);
  assert.ok(hooks.includes('pre') && hooks.includes('commit'), hooks.join());
  for (const name of hooks) assert.ok(GATES.includes(name), name);
  const rows = [...lpk(repo, 'gates', 'gates').stdout.matchAll(/^(\S+) +(?:holds|DENY|print) /gm)].map((m) => m[1]);
  assert.ok(rows.includes('reviews') && rows.includes('plan'), rows.join());
  for (const row of rows.filter((r) => r !== 'plan')) assert.ok(GATES.includes(row), row);
  assert.ok(!GATES.includes('plan'));
  for (const name of GATES) assert.ok(rows.includes(name) || hooks.includes(name) || ['error', 'brief-check'].includes(name), `${name} is a gate nothing prints or enforces`);
});

test('R8 only the session that holds the run waives its gates as the lead', () => {
  const { repo, dir } = runIn('lead-other', 'holder', { scenarios: [{ id: 'S1', cmd: 'false', surface: 'cli', entry: 'false' }] });
  const r = lpk(repo, 'child', 'waive', 'gate:scenarios', '--why', 'x');
  assert.equal(r.status, 2, r.stdout);
  assert.deepEqual(waivers(dir), []);
  assert.match(lpk(repo, 'holder', 'gates').stdout, /^scenarios +DENY /m);
  assert.equal(lpk(repo, 'child', 'waive', 'gate:scenarios', '--why', 'the owner said so', '--via', 'ask').status, 2, 'ask is the hook\'s, not the command\'s');
});

test('R3 a stored lead record for gate:pre or a connector counts for nothing, and one for a normal gate counts', () => {
  const { repo, dir } = runIn('lead-stored', 'stored');
  const run = readRun(repo, 'stored');
  for (const what of ['gate:pre', 'connector:editJiraIssue', 'gate:commit']) appendFileSync(join(dir, 'records.jsonl'), `${JSON.stringify({ kind: 'waiver', run: run.id, what, why: 'x', by: 'lead', via: 'lead', exit: 0 })}\n`);
  assert.equal(waiverOf(repo, run.id, 'gate:pre'), null);
  assert.equal(waiverOf(repo, run.id, 'connector:editJiraIssue'), null);
  assert.ok(waiverOf(repo, run.id, 'gate:commit'));
  const jira = hook('PreToolUse', 'pre', { tool_name: 'mcp__atlassian__editJiraIssue', session_id: 'stored', cwd: repo, tool_input: {} });
  assert.match(reason(jira), /editJiraIssue/);
});

test('R9 a pr id is refused by the command and by a waiver question pick unless it holds a URL', () => {
  const { repo, dir } = runIn('lead-pr', 'prs');
  for (const id of ['pr:123', 'pr:']) {
    const r = lpk(repo, 'prs', 'waive', id, '--why', 'x', '--via', '/lpk-waive');
    assert.equal(r.status, 2, `${id}: ${r.stdout}`);
  }
  const question = 'Release it?';
  hook('PostToolUse', 'waive', { tool_name: 'AskUserQuestion', session_id: 'prs', cwd: repo,
    tool_input: { metadata: { source: 'lpk:waive' }, questions: [{ question, options: [{ label: 'pr:123' }] }] },
    tool_response: { answers: { [question]: 'pr:123' } } });
  assert.deepEqual(waivers(dir), []);
});
