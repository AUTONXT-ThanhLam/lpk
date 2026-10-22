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

const ARGS = { repo: '/r', base: 'main', brief: '/r/.git/lpk/brief.md', skillDir: '/p/skills/lpk', sources: ['/r/.git/lpk/sources/request.md'], round: 2, changed: [30] };

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

const finding = (severity, lines) => ({ severity, lines, claim: `a ${severity} claim`, evidence: '[ran] exit 1', fix: 'say what happens' });
const answers = (by) => (o) => ({ findings: [], stages: [{ stage: 'build', minutes: 12, basis: '[inferred]' }], totalMinutes: 30, trace: [], ...(by[o.label] || by[o.agentType]) });

test('a later round starts five focused critics, the plan simulator and the plan tracer at once on the changed lines only, none told about earlier rounds, and passes only with no High', async () => {
  const { out, calls } = await run(ARGS, answers({ 'lpk:plan-sim': { findings: [finding('Medium', [4])] } }));
  assert.deepEqual(calls.map((c) => [c.opts.label, c.opts.agentType, c.running]), [
    ['design-critic:state', 'lpk:design-critic', 0], ['design-critic:failures', 'lpk:design-critic', 1], ['design-critic:main', 'lpk:design-critic', 2],
    ['design-critic:proof', 'lpk:design-critic', 3], ['design-critic:reuse', 'lpk:design-critic', 4], ['plan-sim', 'lpk:plan-sim', 5],
    ['plan-trace', 'lpk:plan-trace', 6]]);
  assert.ok(calls.slice(0, 5).every((c) => /Your focus: answer only these questions/.test(c.prompt)));
  assert.equal(new Set(calls.slice(0, 5).map((c) => c.prompt)).size, 5);
  for (const c of calls) assert.doesNotMatch(c.prompt, /round|earlier|previous/i);
  for (const c of calls) assert.match(c.prompt, /Review only the brief's lines 30, which were just rewritten, and what they reach/);
  assert.match(calls[6].prompt, /\/r\/\.git\/lpk\/sources\/request\.md/);
  assert.equal(out.round, 2);
  assert.equal(out.verdict, 'pass');
  assert.deepEqual(out.counts, { High: 0, Medium: 1, Low: 0 });
  assert.equal(out.findings[0].angle, 'plan-sim');
  assert.equal(out.totalMinutes, 30);
});

test('a design High on changed lines asks for another approach, a plan or proof High there asks for a revision, round 3 is the last, and a round missing an angle does not pass', async () => {
  const highs = answers({ 'design-critic:state': { findings: [finding('Low', [1]), finding('High', [9])] }, 'lpk:plan-trace': { findings: [finding('High', [20])] } });
  const patched = await run({ ...ARGS, changed: [8, 9] }, highs);
  assert.equal(patched.out.verdict, 'redesign');
  assert.deepEqual(patched.out.findings.map((f) => [f.angle, f.severity, f.onChanged]), [['design-critic:state', 'High', true], ['plan-trace', 'High', false], ['design-critic:state', 'Low', false]]);
  assert.equal((await run({ ...ARGS, changed: [30] }, highs)).out.verdict, 'revise');
  const planHighs = answers({ 'design-critic:proof': { findings: [finding('High', [9])] }, 'lpk:plan-sim': { findings: [finding('High', [8])] }, 'lpk:plan-trace': { findings: [finding('High', [9])] } });
  assert.equal((await run({ ...ARGS, changed: [8, 9] }, planHighs)).out.verdict, 'revise');
  assert.equal((await run({ ...ARGS, round: 3, changed: [8, 9] }, highs)).out.verdict, 'last');
  assert.equal((await run({ ...ARGS, round: 3, changed: [8, 9] }, answers({}))).out.verdict, 'pass');
  const silent = await run(ARGS, (o) => (o.agentType === 'lpk:plan-trace' ? null : answers({})(o)));
  assert.equal(silent.out.verdict, 'incomplete');
  assert.deepEqual(silent.out.missing, ['plan-trace']);
  assert.deepEqual(silent.calls.map((c) => c.opts.label).sort(), ['design-critic:failures', 'design-critic:main', 'design-critic:proof', 'design-critic:reuse', 'design-critic:state', 'plan-sim', 'plan-trace', 'plan-trace#2']);
});

test('a later round without changed is refused', async () => {
  const { changed, ...noChanged } = ARGS;
  const { out, calls } = await run(noChanged, answers({}));
  assert.match(out.error, /\bchanged\b/);
  assert.equal(calls.length, 0);
  // A revision that only deleted lines has no changed line to name.
  assert.equal((await run({ ...ARGS, changed: [] }, answers({}))).out.verdict, 'pass');
  // Round 1, and the round 1 again after a change of approach, has no previous revision.
  const first = await run({ ...noChanged, round: 1 }, answers({}));
  assert.equal(first.out.verdict, 'pass');
  for (const c of first.calls) assert.match(c.prompt, /Review the whole brief\./);
});
