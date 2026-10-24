// Tokens per agent come from the transcripts Claude Code writes, each API message once; the run's
// row in runs.jsonl is built from the same facts.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { addFinding, ruleOn } from '../lib/findings.mjs';
import { ENV, lpk, repoWith, sh, tmp, write } from './verbs-env.mjs';

process.env.CLAUDE_CONFIG_DIR = ENV.CLAUDE_CONFIG_DIR;
process.env.XDG_DATA_HOME = ENV.XDG_DATA_HOME;
const { readRuns, recordRun } = await import('../lib/runs.mjs');

// One transcript line per content block, as Claude Code writes them: a message split in two lines
// carries the same id and usage both times.
const msg = (id, model, [input, write_, read, output], at = '2026-10-21T10:00:00Z') => ({ type: 'assistant', timestamp: at, message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: input, cache_creation_input_tokens: write_, cache_read_input_tokens: read, output_tokens: output } } });
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n');

function session(id) {
  const dir = join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-work-repo');
  write(dir, `${id}.jsonl`, jsonl([{ type: 'user', timestamp: '2026-10-21T09:59:00Z', message: { content: 'go' } }, msg('m1', 'claude-opus-5-5', [10, 1000, 5000, 200]), msg('m1', 'claude-opus-5-5', [10, 1000, 5000, 200]), msg('m2', 'claude-opus-5-5', [5, 100, 6000, 50])]));
  write(dir, `${id}/subagents/agent-a1.jsonl`, jsonl([msg('s1', 'claude-sonnet-5-5', [3, 300, 0, 30]), msg('s1', 'claude-sonnet-5-5', [3, 300, 0, 30]), { type: 'assistant', message: { id: 'syn', model: '<synthetic>', usage: { input_tokens: 999 } } }]));
  write(dir, `${id}/subagents/agent-a1.meta.json`, JSON.stringify({ agentType: 'lpk:techlead' }));
  write(dir, `${id}/subagents/workflows/wf_1/agent-w1.jsonl`, jsonl([msg('w1', 'claude-haiku-5-5', [1, 10, 100, 5]), msg('m1', 'claude-opus-5-5', [10, 1000, 5000, 200])]));
  write(dir, `${id}/subagents/workflows/wf_1/agent-w1.meta.json`, JSON.stringify({ agentType: 'workflow-subagent', description: 'verify:1' }));
}

test('lpk meter gives each agent its fresh tokens and cache reads apart, counting every API message once', () => {
  session('sess-1');
  const r = lpk(tmp, 'meter', '--session', 'sess-1', '--json');
  assert.equal(r.status, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  const by = Object.fromEntries(m.agents.map((a) => [a.agent, a]));
  assert.deepEqual([by['main session'].fresh, by['main session'].cacheRead, by['main session'].messages], [1365, 11000, 2]);
  assert.deepEqual([by['lpk:techlead'].fresh, by['lpk:techlead'].cacheRead], [333, 0]);
  assert.deepEqual([by['main session'].peakContext, by['lpk:techlead'].peakContext], [6105, 303]);
  assert.match(lpk(tmp, 'meter', '--session', 'sess-1').stdout, /2 msgs, 0 tool calls \(0\.00 per msg\), peak context 6,105/);
  assert.deepEqual([by['workflow-subagent'].fresh, by['workflow-subagent'].label, by['workflow-subagent'].messages], [16, 'verify:1', 1], 'a message already counted elsewhere is not counted again');
  assert.deepEqual(m.total, { fresh: 1714, cacheRead: 11100, messages: 4 });
  assert.match(lpk(tmp, 'meter', '--session', 'sess-1').stdout, /fresh tokens 1,714 \(input \+ cache write \+ output\), cache reads 11,100/);
});

test('the run\'s row in runs.jsonl holds its lane, each lens\'s yield, the files it changed and its tokens', () => {
  session('sess-2');
  const repo = repoWith('runs', { 'a.js': 'a\n' });
  write(repo, 'a.js', 'b\n');
  sh(repo, 'commit', '-qam', 'Change a');
  write(join(repo, '.git', 'lpk'), 'run.json', JSON.stringify({ v: 2, id: 'run1', repo, session: 'sess-2', target: 'main', lane: 'quick', laneWhy: 'one file', branches: ['feat'], reviewRange: '', started: Date.now() - 60000 }));
  const raise = (from, extra = {}) => addFinding(repo, { from, at: 'HEAD', claim: 'c', repro: 'r', kind: 'defect', severity: 'important', file: 'a.js', ...extra }).finding;
  const a = raise('lpk:techlead');
  raise('lpk:bug-hunter');
  raise('lpk:techlead', { kind: 'test-gap' });
  assert.ok(ruleOn(repo, { id: a.id, verdict: 'confirmed', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'ran it', by: 'lpk:verifier' }).finding);
  const row = recordRun(repo);
  assert.equal(readRuns().at(-1).id, 'run1');
  assert.deepEqual([row.lane, row.laneWhy, row.files, row.findingFiles, row.testGaps], ['quick', 'one file', ['a.js'], ['a.js'], 1]);
  assert.deepEqual(row.yield['lpk:techlead'], { raised: 1, confirmed: 1, dropped: 0, preexisting: 0, duplicate: 0, open: 0, confirmedUnique: 1 });
  assert.equal(row.yield['lpk:bug-hunter'].open, 1);
  assert.equal(row.agents['main session'].fresh, 1365);
  assert.ok(row.wallMs >= 60000);
});
