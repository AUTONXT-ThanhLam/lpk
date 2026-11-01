import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { context, measureInjections } from '../lib/dev/bench-context.mjs';
import { hostOf } from '../lib/host.mjs';
import { ENV, ROOT, lpk, tmp, write } from './verbs-env.mjs';

const CLAUDE = ENV.CLAUDE_CONFIG_DIR;
const DATA = join(ENV.XDG_DATA_HOME, 'lpk');
const msg = (id, [input, write_, read, output], at) => ({ type: 'assistant', timestamp: at, message: { id, model: 'claude-sonnet-5-5', role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: input, cache_creation_input_tokens: write_, cache_read_input_tokens: read, output_tokens: output } } });
const jsonl = (rows) => rows.map((r) => `${JSON.stringify(r)}`).join('\n') + '\n';
const RUN1 = '20261021100000-r1';
const RUN2 = '20261021100000-r2';
const RUN3 = '20261021100000-r3';

import { commit, repoWith, sh } from './verbs-env.mjs';

function plant(name) {
  const repo = repoWith(name, { 'src/a.ts': 'a\n', 'src/b.ts': 'b\n' });
  const sha = sh(repo, 'rev-parse', 'HEAD').trim();
  const lpkDir = join(repo, '.git', 'lpk');
  mkdirSync(lpkDir, { recursive: true });
  const ev = (o) => `${JSON.stringify({ time: '2026-10-21T10:00:00Z', ...o })}\n`;
  writeFileSync(join(lpkDir, 'findings.jsonl'), [
    ev({ ev: 'add', finding: { id: 'F1', run: RUN1, from: 'code-review:sonnet', at: `${sha}..${sha}`, claim: 'a', repro: 'b', kind: 'defect', severity: 'important', file: 'src/a.ts' } }),
    ev({ ev: 'add', finding: { id: 'F2', run: RUN1, from: 'lpk:techlead', at: `${sha}..${sha}`, claim: 'a', repro: 'b', kind: 'defect', severity: 'important', file: 'src/a.ts' } }),
    ev({ ev: 'add', finding: { id: 'F3', run: RUN1, from: 'lpk:bug-hunter', at: `${sha}..${sha}`, claim: 'a', repro: 'b', kind: 'defect', severity: 'important', file: 'src/b.ts' } }),
    ev({ ev: 'fixed', id: 'F1', commit: sha, fix: 'a', closedBy: 'test', evidence: 'green', by: 'main' }),
    ev({ ev: 'verdict', id: 'F2', state: 'confirmed', by: 'lpk:verifier', evidence: 'yes', born: 'design', cause: 'the brief chose one writer while the plan has two', reach: 'merge' }),
    ev({ ev: 'verdict', id: 'F3', state: 'dropped', by: 'lpk:verifier', evidence: 'no', basis: 'disproved' }),
  ].join(''));
  writeFileSync(join(lpkDir, 'records.jsonl'), jsonl([
    { at: '2026-10-21T10:01:00Z', run: RUN1, kind: 'code-review', model: 'sonnet', range: `${sha}..${sha}`, exit: 0, findings: 1, ids: ['F1'], durationMs: 4000, tokens: { fresh: 700, cacheRead: 900 } },
    { at: '2026-10-21T10:02:00Z', run: RUN1, kind: 'security-review', model: 'sonnet', range: `${sha}..${sha}`, exit: 0, findings: 0, ids: [], durationMs: 1000, tokens: { fresh: 500, cacheRead: 100 } },
    { at: '2026-10-21T10:03:00Z', run: RUN2, kind: 'code-review', model: 'opus', range: `${sha}..${sha}`, exit: 1, findings: 0, ids: [], durationMs: 800, tokens: { fresh: 10, cacheRead: 20 } },
  ]));
  // Claude Code's store: real counts, one message written twice, and two agents whose working spans
  // overlap by ten seconds.
  const main = join(CLAUDE, 'projects', '-work-repo');
  write(main, 's-claude.jsonl', jsonl([
    { type: 'user', timestamp: '2026-10-21T09:59:50Z', message: { content: 'go' } },
    msg('m1', [100, 200, 5000, 50], '2026-10-21T10:00:00Z'),
    msg('m1', [100, 200, 5000, 50], '2026-10-21T10:00:00Z'),
    msg('m2', [1, 2, 3000, 3], '2026-10-21T10:00:40Z'),
  ]));
  write(main, 's-claude/subagents/agent-a1.jsonl', jsonl([msg('s1', [10, 10, 700, 10], '2026-10-21T10:00:00Z'), msg('s2', [1, 1, 700, 1], '2026-10-21T10:00:20Z')]));
  write(main, 's-claude/subagents/agent-a1.meta.json', JSON.stringify({ agentType: 'lpk:techlead' }));
  write(main, 's-claude/subagents/agent-a2.jsonl', jsonl([msg('s3', [5, 5, 40, 5], '2026-10-21T10:00:10Z'), msg('s4', [5, 5, 40, 5], '2026-10-21T10:00:30Z')]));
  write(main, 's-claude/subagents/agent-a2.meta.json', JSON.stringify({ agentType: 'lpk:bug-hunter' }));
  write(main, 's-claude/subagents/agent-a3.jsonl', jsonl([msg('s5', [1, 1, 100000, 1], '2026-10-21T10:00:10Z')]));
  write(main, 's-claude/subagents/agent-a3.meta.json', JSON.stringify({ agentType: 'lpk:cachey' }));
  write(DATA, 'runs.jsonl', jsonl([
    { id: RUN1, repo: 'work-repo', path: repo, session: 's-claude', lane: 'full', started: '2026-10-21T10:00:00.000Z', recorded: '2026-10-21T11:00:00.000Z', wallMs: 3600000, yield: {}, agents: {}, lenses: {}, files: [] },
    { id: RUN2, repo: 'work-repo', path: repo, session: 's-zero', lane: 'quick', started: '2026-10-21T10:00:00.000Z', recorded: '2026-10-21T10:30:00.000Z', wallMs: 1800000, yield: {}, agents: {}, lenses: {}, files: [] },
    { id: RUN3, repo: 'work-repo', path: repo, session: 's-gone', lane: 'full', started: '2026-10-21T10:00:00.000Z', recorded: '2026-10-21T10:10:00.000Z', wallMs: 600000, yield: {}, agents: {}, lenses: {}, files: [] },
  ]));
  return repo;
}

const bench = (cwd, ...args) => lpk(cwd, 'dev', 'bench', ...args);
const out = (cwd, ...args) => { const r = bench(cwd, '--json', ...args); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };

// The row that decides whether the next spend goes before the build or into it. A ruled finding with
// no birth recorded must not be counted as one, and a step nobody was born in reads 0, not absent.
test('a ruled confirmed finding says where it was born', () => {
  plant('bench-born');
  const j = out(tmp);
  assert.equal(j.born.counts.design, 1, 'the one finding ruled confirmed with born=design counts once');
  assert.deepEqual(Object.keys(j.born.counts).sort(), ['build', 'design', 'fix', 'request'], 'every birth step is a key: 0 is a verdict, absence is a failure');
  assert.equal(j.born.counts.build, 0);
  assert.equal(j.born.ruled, 1, 'the finding dropped without a born is not counted as a birth: two verdicts, one step');
  assert.match(j.born.note, /design 1 of 1 ruled finding/);
});

test('fresh tokens leave cache reads out, and say so per agent and per lens', () => {
  plant('bench-tokens');
  const j = out(tmp);
  const by = Object.fromEntries(j.agents.map((a) => [a.agent, a]));
  // main session: (100+200+50) + (1+2+3) = 356 fresh, and its 8000 cache reads apart from it.
  assert.equal(by['main session'].fresh, 356, 'fresh is input + cache write + output only');
  assert.equal(by['main session'].cacheRead, 8000, 'cache reads are counted, but apart');
  assert.ok(by['main session'].fresh < by['main session'].cacheRead, 'had cache reads been counted as fresh the figure would be the larger one');
  assert.equal(by['lpk:techlead'].fresh, 33, '(10+10+10) + (1+1+1): its 1400 cache reads are not in it');
  assert.equal(by['lpk:techlead'].host, 'claude', 'a figure says which host produced it');
  assert.deepEqual(j.agents.map((a) => a.agent).slice(0, 2), ['lpk:cachey', 'main session'], 'agents are ordered by cost: 3 fresh with 100000 reads outranks 356 fresh with 8000');
  // The CLI child has no transcript: its cost is the records', and the lens row carries it.
  const cr = j.lenses.find((l) => l.lens === 'code-review:sonnet');
  assert.equal(cr.fresh, 700, 'the record\'s own fresh tokens, not a transcript\'s');
  assert.equal(cr.fixed, 1);
  assert.ok(cr.cacheRead > 0);
  const idle0 = j.lenses.filter((l) => l.raised === 0 && l.usd !== null).map((l) => l.usd);
  assert.deepEqual(idle0, [...idle0].sort((x, y) => y - x), 'lenses that raised the same number of findings are ordered by cost');
  assert.ok(idle0.length >= 2);
  assert.equal(cr.tokensPerFixed, 700, 'tokens per finding fixed = the lens cost over what it fixed');
  const missing = j.lenses.find((l) => l.lens === 'security-review:sonnet');
  assert.equal(missing.raised, 0, 'a lens that ran and raised nothing is a row of 0, not a missing row');
  assert.equal(missing.findingsReturned, undefined);
  assert.equal(j.cliLensRuns.find((c) => c.lens === 'security-review:sonnet').findingsReturned, 0);
  assert.equal(j.cliLensRuns.find((c) => c.lens === 'security-review:sonnet').runs, 1);
});

test('a store whose usage counts are all zeros has no token figure: unavailable, never 0', () => {
  plant('bench-zero');
  const measured = out(tmp).hosts.find((h) => h.host === 'claude');
  assert.equal(measured.tokensAvailable, true);
  assert.ok(measured.fresh > 0);
  const kept = ENV.CLAUDE_CONFIG_DIR;
  ENV.CLAUDE_CONFIG_DIR = join(tmp, 'claude-zero');
  let j, text;
  try {
    write(join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-work-repo'), 's-zero.jsonl', jsonl([
      { type: 'user', timestamp: '2026-10-21T09:59:00Z', message: { content: 'go' } },
      msg('z1', [0, 0, 0, 0], '2026-10-21T10:00:00Z'),
      msg('z2', [0, 0, 0, 0], '2026-10-21T10:01:00Z'),
    ]));
    j = out(tmp);
    text = bench(tmp).stdout;
  } finally { ENV.CLAUDE_CONFIG_DIR = kept; }
  assert.equal(j.hosts.length, 1);
  const q = j.hosts[0];
  assert.equal(q.host, 'claude');
  assert.equal(q.tokensAvailable, false, 'the verdict is measured from the transcripts, not hardcoded');
  assert.equal(q.fresh, null, 'a token figure that does not exist is null');
  assert.equal(JSON.stringify(q.fresh), 'null', 'and stays null through the JSON, not 0');
  assert.equal(j.missing.tokensUnavailableFor.join(), 'claude');
  assert.match(q.note, /SKIPPED/, 'the note says the row was skipped and why');
  assert.match(q.note, /unavailable, not 0/);
  assert.ok(!('creditsSum' in q) && !('creditsNote' in q), 'the zero-usage row carries no credits figure');
  assert.ok(!JSON.stringify(j).includes('credits'));
  assert.ok(!JSON.stringify(q).includes('"fresh":0'), 'no zero of a token figure stands in for the absent measurement, not even per transcript');
  // The run made on that host keeps its row, with the reason its cost is blank.
  const r2 = j.wall.runs.find((r) => r.id === RUN2);
  assert.ok(r2, 'a run of the unmeasured host is still a run');
  assert.equal(r2.fresh, null);
  assert.match(r2.note, /unavailable, not 0/);
  assert.equal(r2.host, 'claude');
  const row = text.split('\n').find((l) => l.startsWith('  host claude:'));
  assert.ok(row, 'the store has its row in the text output');
  assert.ok(row.includes('UNAVAILABLE') && !/fresh tokens \d/.test(row), 'the row states no token figure, 0 included');
  assert.ok(!/credits/.test(text), 'a store with no usage prints no credits fragment');
});

test('a finding only one lens raised counts once, and a shared file does not count as unique', () => {
  plant('bench-unique');
  const j = out(tmp);
  const by = Object.fromEntries(j.lenses.filter((l) => l.source === 'ledger').map((l) => [l.lens, l]));
  assert.deepEqual(Object.keys(by).sort(), ['code-review:sonnet', 'lpk:bug-hunter', 'lpk:techlead']);
  assert.equal(by['lpk:bug-hunter'].unique, 1, 'its finding stands alone on src/b.ts');
  assert.equal(by['code-review:sonnet'].unique, 0, 'a second lens put a finding on the same file');
  assert.equal(by['lpk:techlead'].unique, 0);
  assert.equal(j.lenses.reduce((n, l) => n + l.unique, 0), 1, 'one unique finding in the whole table: counted once, not once per lens');
  assert.equal(by['code-review:sonnet'].raised, 1);
  assert.equal(by['code-review:sonnet'].fixed, 1);
  assert.equal(by['lpk:bug-hunter'].dropped, 1, 'a contested finding is not counted as a fixed one');
  assert.equal(by['lpk:techlead'].confirmed, 1);
  assert.equal(by['lpk:techlead'].fixed, 0);
});

test('a transcript under a store whose paths use backslashes is still that host\'s', () => {
  const env = { CLAUDE_CONFIG_DIR: 'D:\\a\\claude' };
  assert.equal(hostOf('D:\\a\\claude\\projects\\p\\s.jsonl', env), 'claude');
  assert.equal(hostOf('D:\\a\\claude-other\\projects', env), '');
});

test('work a session does after its run ended is no part of the run\'s window', () => {
  plant('bench-after-end');
  const main = join(CLAUDE, 'projects', '-work-repo', 's-claude', 'subagents');
  write(main, 'agent-late.jsonl', jsonl([msg('l1', [7, 7, 70, 7], '2026-10-21T14:00:00Z'), msg('l2', [7, 7, 70, 7], '2026-10-21T14:30:00Z')]));
  write(main, 'agent-late.meta.json', JSON.stringify({ agentType: 'lpk:builder' }));
  const j = out(tmp);
  rmSync(join(main, 'agent-late.jsonl'));
  rmSync(join(main, 'agent-late.meta.json'));
  const r = j.wall.runs.find((x) => x.id === RUN1);
  assert.equal(r.criticalPathMs, 30000, 'the run began at 10:00 and lasted an hour: work at 14:00 is another job');
  assert.equal(r.lensMsSum, 40000);
  assert.equal(r.longPole, 'lpk:techlead');
  assert.equal(j.agents.find((a) => a.agent === 'lpk:builder'), undefined, 'an agent that worked only after the run ended is no role of the run');
});

test('the critical path is the union of the lenses\' spans, not their sum', () => {
  plant('bench-wall');
  const j = out(tmp);
  const r = j.wall.runs.find((x) => x.id === RUN1);
  // Two agents: 10:00:00-10:00:20 and 10:00:10-10:00:30. The window holds 30s of work; 40s of agent
  // time ran inside it, ten of those seconds beside the other agent.
  assert.equal(r.criticalPathMs, 30000, 'the union of the overlapping spans');
  assert.equal(r.lensMsSum, 40000, 'their sum is the larger figure, and not the critical path');
  assert.ok(r.criticalPathMs < r.lensMsSum, 'a critical path that equalled the sum would say the run cannot overlap');
  assert.ok(r.criticalPathMs > 0, 'and a broken span reader would say it did nothing at all');
  assert.equal(r.longPole, 'lpk:techlead', 'the lens holding the most of the path');
  assert.equal(r.findings, 3);
  assert.equal(r.fixed, 1);
  assert.equal(r.ledger, 'present');
  assert.equal(j.wall.runs.find((x) => x.id === RUN3).ledger, 'absent', 'a run with no ledger says so');
});

test('absence is printed as an empty verdict, and every key the gates read is there', () => {
  const repo = plant('bench-absent');
  mkdirSync(join(CLAUDE, 'projects', '-empty-ok'), { recursive: true });
  const j = out(tmp);
  for (const k of ['runs', 'hosts', 'lenses', 'cliLensRuns', 'born', 'agents', 'wall', 'context', 'missing']) assert.ok(k in j, `${k} is a key even when nothing was found`);
  assert.ok(Array.isArray(j.lenses) && Array.isArray(j.cliLensRuns) && Array.isArray(j.agents) && Array.isArray(j.wall.runs));
  assert.equal(j.runs.recorded, 3);
  assert.equal(j.runs.withLedger, 1);
  assert.equal(j.runs.withoutLedger, 2);
  assert.equal(j.runs.unrecordedLedgers.length, 0, 'no orphan ledger here, and that is a 0-length array, not a missing key');
  assert.deepEqual(j.missing.tokensUnavailableFor, []);
  assert.ok(j.context.resident.agents.length > 0 && j.context.resident.skills.length > 0, 'the plugin itself is always measured');
  assert.ok(j.context.residentBytes > 0 && j.context.onInvokeBytes > j.context.residentBytes);
  // The repo filter narrows to its runs and still answers with arrays, not absent keys.
  const only = out(repo, '--repo', repo);
  assert.equal(only.runs.distinct, 3);
  const none = out(repo, '--lane', 'full', '--runs', '1');
  assert.equal(none.runs.distinct, 1);
  assert.equal(none.lenses.length > 0, true);
  // With the transcripts left unread, every cost row is a null and every array is there anyway: a
  // skipped read is said, not faked as a zero.
  const noRead = out(repo, '--no-transcripts');
  assert.deepEqual(noRead.agents, [], 'no agent was read, so no agent row');
  assert.equal(noRead.wall.runs.every((r) => r.fresh === null), true, 'a run whose transcripts were not read has no token figure');
  assert.equal(noRead.wall.runs.length, 3, 'but every run keeps its row');
  assert.equal(noRead.hosts.length, 1, 'the store is still named, with its verdict');
  assert.equal(out(repo, '--lane', 'quick').runs.distinct, 1);
});

test('bad arguments are refused, and the command is reachable as lpk dev bench', () => {
  plant('bench-args');
  const r = bench(tmp, '--nonsense');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --nonsense/);
  assert.match(bench(tmp, '--lane', 'full').stdout, /lens \| raised \| fixed/);
  assert.match(bench(tmp, '--lane', 'full').stdout, /critical path .*lens sum/);
});

test('a run\'s idle time is the waits the owner closed, apart from the time agents worked', () => {
  plant('bench-idle');
  const turn = (id, at, stop, extra = []) => ({ ...msg(id, [1, 1, 1, 1], at), message: { ...msg(id, [1, 1, 1, 1], at).message, stop_reason: stop, content: [{ type: 'text', text: 'x' }, ...extra] } });
  const say = (at, content) => ({ type: 'user', timestamp: at, message: { content } });
  write(join(CLAUDE, 'projects', '-work-repo'), 's-idle.jsonl', jsonl([
    say('2026-10-21T10:00:00Z', 'go'),
    turn('i1', '2026-10-21T10:00:10Z', 'end_turn'),
    say('2026-10-21T10:01:50Z', 'next'),
    turn('i2', '2026-10-21T10:02:00Z', 'end_turn'),
    say('2026-10-21T10:03:00Z', '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>'),
    turn('i3', '2026-10-21T10:03:10Z', 'tool_use'),
    turn('i4', '2026-10-21T10:03:15Z', 'tool_use', [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} }]),
    say('2026-10-21T10:04:15Z', [{ type: 'tool_result', tool_use_id: 'q1', content: 'yes' }]),
    turn('i5', '2026-10-21T10:04:25Z', 'end_turn'),
  ]));
  const rows = readFileSync(join(DATA, 'runs.jsonl'), 'utf8');
  writeFileSync(join(DATA, 'runs.jsonl'), `${rows}${JSON.stringify({ id: '20261021100000-r4', repo: 'work-repo', path: tmp, session: 's-idle', lane: 'full', started: '2026-10-21T10:00:00.000Z', recorded: '2026-10-21T10:05:00.000Z', wallMs: 300000, yield: {}, agents: {}, lenses: {}, files: [] })}\n`);
  const j = out(tmp);
  const r = j.wall.runs.find((x) => x.id === '20261021100000-r4');
  assert.equal(r.ownerIdleMs, 160000, '100s until the owner\'s prompt and 60s until the answer to the question; the 60s a task notice closed is not theirs');
  assert.equal(r.workingMs, 140000, 'the wall without the owner\'s idle time');
  assert.equal(j.wall.runs.find((x) => x.id === RUN3).ownerIdleMs, null, 'a run with no transcript has no idle figure, not 0');
  assert.equal(j.wall.runs.find((x) => x.id === RUN1).ownerIdleMs, 0, 'agents working end to end leave no idle gap');
  assert.equal(j.wall.runs.find((x) => x.id === RUN1).criticalPathMs, 30000, 'the critical path is untouched');
});

test('an injection is counted by what it carries, and a line that only quotes its marker is counted in no bucket', () => {
  const advice = 'lpk check, on lines you just added: x';
  const skill = 'Base directory for this skill: /p\nbody';
  const toolResult = (text) => ({ type: 'user', toolUseResult: { stdout: text }, message: { content: [{ type: 'tool_result', content: text }] } });
  const rows = [
    { type: 'attachment', attachment: { type: 'hook_additional_context', content: [advice], hookEvent: 'PostToolUse' }, rendered: [{ content: `hook additional context: ${advice}` }] },
    { type: 'attachment', attachment: { type: 'hook_additional_context', content: ['another plugin says hi'] } },
    { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: skill }] } },
    { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: '<command-message>x</command-message>\n<skill-format>true</skill-format>' }, { type: 'text', text: skill }] } },
    toolResult(`hook additional context: ${advice} ${'x'.repeat(5000)}`),
    toolResult(skill),
    { type: 'attachment', attachment: { type: 'invoked_skills', skills: [{ name: 'a', content: skill }, { name: 'b', content: skill }] } },
    { type: 'api-request-blob', content: [{ type: 'text', text: `${skill} hook additional context: ${advice}` }] },
  ];
  const file = join(tmp, 'injections.jsonl');
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"half');
  const ctx = context(ROOT);
  measureInjections(ctx, [file]);
  assert.deepEqual(ctx.measured, { adviceLines: 1, adviceBytes: advice.length, skillInjectLines: 3, skillInjectBytes: skill.length * 4, mainTranscriptBytes: readFileSync(file, 'utf8').length });
});

test('lpk dev bench --json larger than a pipe buffer reaches a reader that starts late, whole', async () => {
  const repo = plant('bench-pipe');
  const rows = Array.from({ length: 600 }, (_, i) => JSON.stringify({ id: `20261022100000-p${i}`, repo: 'work-repo', path: tmp, session: `s-${i}`, lane: 'full', started: '2026-10-22T10:00:00.000Z', recorded: '2026-10-22T10:05:00.000Z', wallMs: 300000, yield: {}, agents: {}, lenses: {}, files: [] })).join('\n');
  writeFileSync(join(DATA, 'runs.jsonl'), `${readFileSync(join(DATA, 'runs.jsonl'), 'utf8')}${rows}\n`);
  const child = spawn('node', [join(ROOT, 'bin', 'lpk'), 'dev', 'bench', '--json'], { cwd: repo, env: ENV, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => setTimeout(r, 400));
  let text = '';
  child.stdout.on('data', (b) => { text += b; });
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0);
  assert.ok(text.length > 65536, `the fixture must exceed one pipe buffer, got ${text.length}`);
  assert.ok(JSON.parse(text).wall.runs.length >= 600);
});
