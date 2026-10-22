// The design review workflow as the Workflow tool runs it: its script body with agent(), parallel()
// and log() standing in for the runtime's, and the angles answering from a table.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BODY = readFileSync(join(ROOT, 'workflows', 'design-review.js'), 'utf8').replace(/^export const meta = \{[\s\S]*?\n\}\n/, '');
const AsyncFunction = (async () => {}).constructor;
const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));

const ARGS = { repo: '/r', base: 'main', brief: '/r/.git/lpk/brief.md', skillDir: '/p/skills/lpk', sources: ['/r/.git/lpk/sources/request.md'], round: 1 };
const LATER = { ...ARGS, round: 2, changed: [30] };

// Runs the workflow; `answer(opts)` gives each agent's return, and every call is kept with how many
// agents were running when it started.
async function run(args, answer) {
  const calls = [];
  let running = 0;
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts, running: running++ });
    try { await new Promise((r) => setTimeout(r, 5)); return await answer(opts); } finally { running--; }
  };
  const out = await new AsyncFunction('args', 'agent', 'parallel', 'log', 'phase', BODY)(args, agent, parallel, () => {}, () => {});
  return { out, calls };
}

const finding = (severity, lines, basis = 'ran') => ({ severity, lines, claim: `a ${severity} claim`, evidence: '[ran] exit 1', basis, fix: 'say what happens' });
const answers = (by) => (o) => ({ findings: [], stages: [{ stage: 'build', minutes: 12, basis: '[inferred]' }], totalMinutes: 30, trace: [], ...(by[o.label] || by[o.agentType]) });

test('round 1 starts five focused critics, the plan simulator and the plan tracer at once on the whole brief, and passes only with no High', async () => {
  const { out, calls } = await run(ARGS, answers({ 'lpk:plan-sim': { findings: [finding('Medium', [4])] } }));
  assert.deepEqual(calls.map((c) => [c.opts.label, c.opts.agentType, c.running]), [
    ['design-critic:state', 'lpk:design-critic', 0], ['design-critic:failures', 'lpk:design-critic', 1], ['design-critic:main', 'lpk:design-critic', 2],
    ['design-critic:proof', 'lpk:design-critic', 3], ['design-critic:reuse', 'lpk:design-critic', 4], ['plan-sim', 'lpk:plan-sim', 5],
    ['plan-trace', 'lpk:plan-trace', 6]]);
  assert.equal(new Set(calls.slice(0, 5).map((c) => c.prompt)).size, 5);
  for (const c of calls) assert.match(c.prompt, /Review the whole brief\./);
  assert.match(calls[6].prompt, /\/r\/\.git\/lpk\/sources\/request\.md/);
  assert.equal(out.verdict, 'pass');
  assert.deepEqual(out.counts, { High: 0, Medium: 1, Low: 0 });
});

test('a High resting only on inference counts as Medium, and each angle keeps its Highs and at most three other findings', async () => {
  const many = [finding('High', [1], 'inferred'), finding('High', [2]), ...[3, 4, 5, 6].map((n) => finding('Low', [n]))];
  const { out } = await run(ARGS, answers({ 'design-critic:state': { findings: many } }));
  const state = out.findings.filter((f) => f.angle === 'design-critic:state');
  assert.deepEqual(state.map((f) => [f.severity, f.lines[0], !!f.demoted]), [['High', 2, false], ['Medium', 1, true], ['Low', 3, false], ['Low', 4, false]]);
  assert.equal(out.verdict, 'revise');
});

test('a later round reruns only the angles whose High is open, tells each its Highs to check closed, and keeps to the changed lines', async () => {
  const open = [{ angle: 'design-critic:state', severity: 'High', lines: [9], claim: 'two writers race on the row', cause: 'one writer per row' }, { angle: 'plan-sim', severity: 'High', lines: [40], claim: 'the build waits on itself' }];
  const { out, calls } = await run({ ...LATER, open }, answers({}));
  assert.deepEqual(calls.map((c) => c.opts.label), ['design-critic:state', 'plan-sim']);
  assert.match(calls[0].prompt, /check on the brief as it stands whether it is closed[\s\S]*lines 9: two writers race on the row \(cause: one writer per row\)/);
  assert.doesNotMatch(calls[0].prompt, /the build waits on itself/);
  for (const c of calls) assert.match(c.prompt, /Review only the brief's lines 30, which were just rewritten, and what they reach/);
  assert.equal(out.verdict, 'pass');
  assert.deepEqual(out.missing, []);
});

test('a design High on changed lines asks for another approach, a plan or proof High there asks for a revision, round 3 is the last, and a round missing an angle does not pass', async () => {
  const highs = answers({ 'design-critic:state': { findings: [finding('Low', [1]), finding('High', [9])] }, 'lpk:plan-trace': { findings: [finding('High', [20])] } });
  const patched = await run({ ...ARGS, round: 2, changed: [8, 9], open: [{ angle: 'design-critic:state' }, { angle: 'plan-trace' }] }, highs);
  assert.equal(patched.out.verdict, 'redesign');
  assert.deepEqual(patched.out.findings.map((f) => [f.angle, f.severity, f.onChanged]), [['design-critic:state', 'High', true], ['plan-trace', 'High', false], ['design-critic:state', 'Low', false]]);
  assert.equal((await run({ ...ARGS, round: 2, changed: [30], open: [{ angle: 'design-critic:state' }] }, highs)).out.verdict, 'revise');
  const planHighs = answers({ 'design-critic:proof': { findings: [finding('High', [9])] }, 'lpk:plan-sim': { findings: [finding('High', [8])] } });
  assert.equal((await run({ ...ARGS, round: 2, changed: [8, 9], open: [{ angle: 'design-critic:proof' }, { angle: 'plan-sim' }] }, planHighs)).out.verdict, 'revise');
  assert.equal((await run({ ...ARGS, round: 3, changed: [8, 9], open: [{ angle: 'design-critic:state' }] }, highs)).out.verdict, 'last');
  const silent = await run(ARGS, (o) => (o.agentType === 'lpk:plan-trace' ? null : answers({})(o)));
  assert.equal(silent.out.verdict, 'incomplete');
  assert.deepEqual(silent.out.missing, ['plan-trace']);
});

test('a later round without changed or open is refused', async () => {
  const { changed, ...noChanged } = LATER;
  for (const [args, key] of [[LATER, 'open'], [{ ...noChanged, open: [] }, 'changed']]) {
    const { out, calls } = await run(args, answers({}));
    assert.match(out.error, new RegExp(`\\b${key}\\b`));
    assert.equal(calls.length, 0);
  }
  assert.equal((await run({ ...LATER, changed: [], open: [] }, answers({}))).out.verdict, 'pass', 'a revision that only deleted lines, with no High left open');
});
