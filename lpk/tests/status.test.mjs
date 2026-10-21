// `lpk status`: the step a run is in, the time it worked, who of the team runs and what each does,
// read from the run's files and the session's transcripts as Claude Code writes them.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, lens, lpk, repoWith, sh, write } from './gates-env.mjs';
import { addFinding, markFixed, ruleOn } from '../lib/findings.mjs';
import { meter, total } from '../lib/meter.mjs';
import { appendRecord } from '../lib/records.mjs';
import { status } from '../lib/status.mjs';

const MIN = 60_000;
const NOW = Date.now();
const at = (m) => new Date(NOW + m * MIN).toISOString();
const project = join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-scratch');
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
let n = 0;
const said = (m, content, extra = {}) => ({ type: 'user', timestamp: at(m), message: { role: 'user', content }, ...extra });
const did = (m, content, stop = 'tool_use', usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 20 }) =>
  ({ type: 'assistant', timestamp: at(m), message: { id: `msg${++n}`, model: 'claude-opus-5-5', role: 'assistant', content, stop_reason: stop, usage } });
const tool = (name, input, id = `t${++n}`) => [{ type: 'tool_use', id, name, input }];
const mainOf = (session, rows) => { mkdirSync(project, { recursive: true }); writeFileSync(join(project, `${session}.jsonl`), jsonl(rows)); };
function agentOf(session, id, meta, rows, workflow = '') {
  const dir = join(project, session, 'subagents', ...(workflow ? ['workflows', workflow] : []));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${id}.jsonl`), jsonl(rows.map((r) => ({ agentId: id, ...r }))));
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify(meta));
}
const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const json = (repo, session) => JSON.parse(ok(lpk(repo, session, 'status', '--json')));
const LPK = '<command-name>/lpk</command-name>';

test('three Builders at work in parallel show as three rows, each with its slice and its last tool call', () => {
  const S = 'status-build';
  const repo = repoWith('status-build', { 'src/api.mjs': '1\n', 'src/ui.tsx': '1\n', 'src/docs.md': '1\n', 'src/cli.mjs': '1\n' });
  write(repo, '.git/lpk/brief.md', '# Brief\n');
  write(repo, '.git/lpk/brief.json', JSON.stringify({ slices: ['api', 'ui', 'docs', 'cli'].map((name) => ({ name, files: [`src/${name}.${{ api: 'mjs', ui: 'tsx', docs: 'md', cli: 'mjs' }[name]}`] })) }));
  ok(lpk(repo, S, 'run', 'start', '--verify', 'true'));
  write(repo, 'src/api.mjs', '2\n');
  sh(repo, 'commit', '-qam', 'Build the api slice');
  const first = did(-16, tool('Agent', { description: 'Build slice api', subagent_type: 'lpk:builder' }));
  mainOf(S, [said(-20, `${LPK} build the dashboard`), first]);
  // A fork replays its parent's messages under the same ids; they count once.
  agentOf(S, 'k1', { agentType: 'fork', description: 'fork', finished: true }, [first, did(-15, [{ type: 'text', text: 'ok' }], 'end_turn')]);
  agentOf(S, 'b0', { agentType: 'lpk:builder', description: 'Build slice api', finished: true }, [said(-15, 'Build the slice api in /w/api.'), did(-12, [{ type: 'text', text: 'done' }], 'end_turn')]);
  agentOf(S, 'b1', { agentType: 'lpk:builder', description: 'Build slice ui' }, [said(-10, 'The brief has the slices api (another Builder has it) and ui. Yours is ui.'), did(-1, tool('Edit', { file_path: '/w/ui/src/kpi.tsx', old_string: 'a', new_string: 'b' }))]);
  agentOf(S, 'b2', { agentType: 'lpk:builder', description: 'Build slice docs' }, [said(-10, 'Your slice: docs.'), did(-2, tool('Bash', { command: 'npx vitest run src/docs.test.mjs --reporter dot\necho done' }))]);
  agentOf(S, 'b3', { agentType: 'lpk:builder', description: 'Build slice cli' }, [said(-10, 'Your slice: cli.'), did(-8, tool('Read', { file_path: '/w/cli/src/cli.mjs' }))]);

  const s = json(repo, S);
  assert.equal(s.open, true);
  assert.equal(s.phase, 'build');
  assert.deepEqual(s.phasesVisited, ['understand', 'design', 'build']);
  assert.deepEqual(s.track, ['understand', 'design', 'build', 'review', 'fix', 'prove', 'deliver']);
  assert.deepEqual(s.phaseDetail, { slices: [{ name: 'api', state: 'landed' }, { name: 'ui', state: 'building' }, { name: 'docs', state: 'building' }, { name: 'cli', state: 'building' }] });
  assert.deepEqual(s.team.filter((r) => r.state === 'running' && r.id !== 'main').map((r) => [r.title, r.what, r.action, Math.round((r.stalledMs || 0) / MIN)]), [
    ['Builder', 'slice ui', 'Edit kpi.tsx', 0],
    ['Builder', 'slice docs', 'Bash npx vitest run src/docs.test.mjs --reporter dot', 0],
    ['Builder', 'slice cli', 'Read cli.mjs', 8],
  ]);
  assert.deepEqual(s.team.find((r) => r.id === 'b0').state, 'finished');
  assert.equal(s.tokens.fresh, total(meter(S)).fresh, 'fresh tokens as lpk meter counts them');
  assert.deepEqual([s.stuck, s.waits], [false, []]);
  const text = ok(lpk(repo, S, 'status'));
  assert.match(text, /^Understand › Design › \[Build\] › Review › Fix › Prove › Deliver · worked \d+m · 780 tokens · full lane\n● api {2}◐ ui {2}◐ docs {2}◐ cli\n/);
  assert.match(text, /\n {2}Builder {2}slice cli {2}stalled 8m {2}10m/);
});

test('the tokens are the run\'s own: what the session spent before its /lpk is left out', () => {
  const S = 'status-tokens';
  const repo = repoWith('status-tokens', { 'a.mjs': '1\n' });
  ok(lpk(repo, S, 'run', 'start', '--verify', 'true'));
  mainOf(S, [said(-120, 'an earlier task'), did(-119, [{ type: 'text', text: 'done' }], 'end_turn'), said(-20, `${LPK} the next task`), did(-5, tool('Read', { file_path: '/w/a.mjs' }))]);
  assert.deepEqual(json(repo, S).tokens, { fresh: 130, cacheRead: 1000 });
});

test('the time worked is the union of the session\'s and its agents\' working spans, without the waits on the owner', async () => {
  const S = 'status-time';
  const repo = repoWith('status-time', { 'a.mjs': '1\n' });
  mainOf(S, [
    said(-60, `${LPK} fix it`),
    did(-59, tool('AskUserQuestion', { questions: [] }, 'ask1')),
    said(-49, [{ type: 'tool_result', tool_use_id: 'ask1', content: 'yes' }]), // ten minutes waiting on the owner's answer
    did(-48, [{ type: 'text', text: 'Waiting for you.' }], 'end_turn'),
    said(-30, '<command-name>/lpk-status</command-name>'), // eighteen idle minutes between the turn's end and the owner's next command
    did(-29, tool('Agent', { description: 'Explore the code' })),
    said(-28, [{ type: 'tool_result', tool_use_id: 'x', content: 'launched' }]),
    did(-27, [{ type: 'text', text: 'It runs.' }], 'end_turn'),
  ]);
  agentOf(S, 'e1', { agentType: 'Explore', description: 'Explore the code', finished: true }, [said(-29, 'Find it.'), did(-25, tool('Grep', { pattern: 'x' })), did(-20, [{ type: 'text', text: 'found' }], 'end_turn')]);
  const s = await status(repo, { session: S, now: NOW });
  // Main: 60→59, 49→48, 30→27; the Explorer 29→20; their union is 1 + 1 + 10 minutes.
  assert.equal(s.activeMs, 12 * MIN);
  assert.equal(s.elapsedMs, 60 * MIN);
  assert.equal(s.phase, 'understand');
  assert.deepEqual(s.waits, [{ what: 'reply', why: 'the Captain ended its turn and no agent runs' }]);
  assert.equal(s.stuck, false, 'a run that waits on the owner is not stuck');
});

test('a run where nothing moved for five minutes says so, and an agent that failed shows why', () => {
  const S = 'status-stuck';
  const repo = repoWith('status-stuck', { 'a.mjs': '1\n' });
  ok(lpk(repo, S, 'run', 'start', '--verify', 'true'));
  mainOf(S, [said(-30, `${LPK} fix it`), said(-12, '<task-notification>\n<task-id>x1</task-id>\n<status>stopped</status>\n</task-notification>'), did(-9, tool('Bash', { command: 'npm test' }))]);
  agentOf(S, 'x1', { agentType: 'lpk:techlead', description: 'first tech lead' }, [said(-25, 'Review a1b2c3d..e4f5a6b.'), did(-13, tool('Read', { file_path: '/w/a.mjs' }))]);
  agentOf(S, 'w1', { agentType: 'lpk:techlead', description: 'techlead', workflowPhase: 'Review' },
    [said(-20, 'Review a1b2c3d..e4f5a6b.'), { type: 'assistant', timestamp: at(-9), isApiErrorMessage: true, message: { role: 'assistant', content: [{ type: 'text', text: 'API Error: 529 overloaded\nretry later' }], stop_reason: 'stop_sequence' } }], 'wf_1');
  const s = json(repo, S);
  assert.equal(s.stuck, true);
  assert.deepEqual(s.team.filter((r) => r.state === 'failed').map((r) => [r.title, r.reason]), [['Tech lead', 'API Error: 529 overloaded retry later']]);
  const text = ok(lpk(repo, S, 'status'));
  assert.match(text, /^Understand › \[Build\] .*· nothing moved for 9m · worked/);
  assert.match(text, /\n {2}Tech lead {2}techlead {2}failed: API Error: 529 overloaded retry later/);
  assert.equal(s.team.find((r) => r.id === 'x1').state, 'stopped');
  assert.doesNotMatch(text, /first tech lead/, 'an agent stopped on purpose leaves the band');
});

test('the step follows the run\'s records from understanding to delivery, and the track leaves out the steps skipped', () => {
  const S = 'status-walk';
  const repo = repoWith('status-walk', { 'src/a.mjs': 'export const a = 1;\n' });
  mainOf(S, [said(-30, `${LPK} set a to 2`), did(-29, tool('Read', { file_path: '/w/src/a.mjs' }))]);
  const step = () => { const s = json(repo, S); return [s.phase, s.phaseDetail]; };
  assert.deepEqual(step(), ['understand', { doing: 'Read a.mjs', openQuestions: 0 }]);
  write(repo, '.git/lpk/brief.md', '# Brief\n');
  ok(lpk(repo, S, 'decide', 'design review round 1: revise, 2/3/1', '--why', 'two High findings'));
  assert.deepEqual(step(), ['design', { round: 1, verdict: 'revise', high: 2, medium: 3, low: 1, running: [] }]);
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'grep -q "a = [23]" src/a.mjs', '--expect', '', '--verify', 'true'));
  assert.equal(json(repo, S).phase, 'build');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  const base = sh(repo, 'merge-base', 'main', 'HEAD').trim();
  const head = () => sh(repo, 'rev-parse', 'HEAD').trim();
  const range = `${base}..${head()}`;
  ok(lpk(repo, S, 'review', 'start', range));
  assert.deepEqual(step(), ['review', { lensesDone: 0, lenses: 0, owed: 3, raised: 0, confirmed: 0, dropped: 0, verifiersRunning: 0 }]);
  const net = (r, id, findings) => { for (const kind of ['code-review', 'security-review']) appendRecord(repo, { kind, range: r, model: 'sonnet', exit: 0, findings: 0 }); lens(S, id, 'lpk:bug-hunter', r, { findings }); };
  net(range, 'bh1', [{ claim: 'a must stay odd' }]);
  addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'a must stay odd', repro: 'r', kind: 'defect', severity: 'important' });
  ruleOn(repo, { id: 'F1', verdict: 'confirmed', evidence: 'repro fails', by: 'lpk:verifier' });
  assert.deepEqual(step(), ['fix', { left: ['F1'], fixed: 0, delta: 'not yet' }]);
  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  sh(repo, 'commit', '-qam', 'Keep a odd');
  const fix = head();
  markFixed(repo, { id: 'F1', commit: fix, closedBy: 'repro', evidence: 'repro green', by: 'main' });
  assert.deepEqual(step(), ['fix', { left: [], fixed: 1, delta: 'owed' }]);
  net(`${range.split('..')[1]}..${fix}`, 'bh2', []);
  assert.deepEqual(step(), ['prove', { scenarios: { passed: 0, total: 1 }, requirements: { proved: 0, total: 0 } }]);
  ok(lpk(repo, S, 'verify'));
  ok(lpk(repo, S, 'prove', '--all'));
  const s = json(repo, S);
  assert.deepEqual([s.phase, s.phaseDetail], ['deliver', { holding: 5, total: 5, firstDeny: null }]);
  assert.deepEqual(s.phasesVisited, ['understand', 'design', 'build', 'review', 'fix', 'prove', 'deliver']);
});

test('a quick run that needed no fix leaves Design and Fix off its track', () => {
  const S = 'status-quick';
  const repo = repoWith('status-quick', { 'src/a.mjs': 'export const a = 1;\n' });
  mainOf(S, [said(-5, `${LPK} set a to 2`)]);
  ok(lpk(repo, S, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'grep -q "a = 2" src/a.mjs', '--expect', '', '--verify', 'true'));
  assert.deepEqual(json(repo, S).track, ['understand', 'build', 'review', 'fix', 'prove', 'deliver']);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  const range = `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;
  ok(lpk(repo, S, 'review', 'start', range));
  for (const kind of ['code-review', 'security-review']) appendRecord(repo, { kind, range, model: 'sonnet', exit: 0, findings: 0 });
  lens(S, 'bhq', 'lpk:bug-hunter', range, { findings: [] });
  addFinding(repo, { from: 'main', at: range, claim: 'a may be odd', repro: 'r', kind: 'defect', severity: 'nit' });
  ruleOn(repo, { id: 'F1', verdict: 'dropped', basis: 'disproved', evidence: 'no caller reads a', by: 'main' });
  const s = json(repo, S);
  assert.deepEqual([s.phase, s.track], ['prove', ['understand', 'build', 'review', 'prove', 'deliver']]);
  assert.deepEqual([s.findings.needsOwner, s.waits.some((w) => w.what === 'F1')], [1, false], 'the lead\'s own ruling is counted, not waited on');
  assert.equal(json(repo, 'another-session').open, false, 'another session sees no band for this run');
});
