// The design review workflow as the Workflow tool runs it: its script body with agent(), parallel()
// and log() standing in for the runtime's, and the three angles answering from a table.
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
const answers = (by) => (o) => ({ findings: [], stages: [{ stage: 'build', minutes: 12, basis: '[inferred]' }], totalMinutes: 30, trace: [], ...by[o.agentType] });

test('a round starts the critic, the plan simulator and the plan tracer at once, none told about earlier rounds, and passes only with no High', async () => {
  const { out, calls } = await run(ARGS, answers({ 'lpk:plan-sim': { findings: [finding('Medium', [4])] } }));
  assert.deepEqual(calls.map((c) => [c.opts.agentType, c.running]), [['lpk:design-critic', 0], ['lpk:plan-sim', 1], ['lpk:plan-trace', 2]]);
  for (const c of calls) assert.doesNotMatch(c.prompt, /round|earlier|previous/i);
  assert.match(calls[2].prompt, /\/r\/\.git\/lpk\/sources\/request\.md/);
  assert.equal(out.round, 2);
  assert.equal(out.verdict, 'pass');
  assert.deepEqual(out.counts, { High: 0, Medium: 1, Low: 0 });
  assert.equal(out.findings[0].angle, 'plan-sim');
  assert.equal(out.totalMinutes, 30);
});

test('a High on lines the previous revision changed asks for another approach, and a round missing an angle does not pass', async () => {
  const highs = answers({ 'lpk:design-critic': { findings: [finding('Low', [1]), finding('High', [9])] }, 'lpk:plan-trace': { findings: [finding('High', [20])] } });
  const patched = await run({ ...ARGS, changed: [8, 9] }, highs);
  assert.equal(patched.out.verdict, 'redesign');
  assert.deepEqual(patched.out.findings.map((f) => [f.angle, f.severity, f.onChanged]), [['design-critic', 'High', true], ['plan-trace', 'High', false], ['design-critic', 'Low', false]]);
  assert.equal((await run({ ...ARGS, changed: [30] }, highs)).out.verdict, 'revise');
  const silent = await run(ARGS, (o) => (o.agentType === 'lpk:plan-trace' ? null : answers({})(o)));
  assert.equal(silent.out.verdict, 'incomplete');
  assert.deepEqual(silent.out.missing, ['plan-trace']);
  assert.deepEqual(silent.calls.map((c) => c.opts.label).sort(), ['design-critic', 'plan-sim', 'plan-trace', 'plan-trace#2']);
});

test('a later round without changed is refused', async () => {
  const { changed, ...noChanged } = ARGS;
  const { out, calls } = await run(noChanged, answers({}));
  assert.match(out.error, /\bchanged\b/);
  assert.equal(calls.length, 0);
  // A revision that only deleted lines has no changed line to name.
  assert.equal((await run({ ...ARGS, changed: [] }, answers({}))).out.verdict, 'pass');
  // Round 1, and the round 1 again after a change of approach, has no previous revision.
  assert.equal((await run({ ...noChanged, round: 1 }, answers({}))).out.verdict, 'pass');
});
