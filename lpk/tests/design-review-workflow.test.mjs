// The design review workflow as the Workflow tool runs it: its script body with agent(), parallel()
// and log() standing in for the runtime's, and the critic answering from a table.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BODY = readFileSync(join(ROOT, 'workflows', 'design-review.js'), 'utf8').replace(/^export const meta = \{[\s\S]*?\n\}\n/, '');
const AsyncFunction = (async () => {}).constructor;
const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));

const ARGS = { repo: '/r', base: 'main', brief: '/r/.git/lpk/brief.md', sources: ['/r/.git/lpk/sources/request.md'], round: 1, words: 3000 };
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
const answers = (by) => (o) => ({ findings: [], ...(by[o.label] || by[o.agentType]) });

test('round 1 starts one design critic on the whole brief with every focus and the sources, and passes only with no High', async () => {
  const { out, calls } = await run(ARGS, answers({ 'lpk:design-critic': { findings: [finding('Medium', [4])] } }));
  assert.deepEqual(calls.map((c) => [c.opts.label, c.opts.agentType]), [['design-critic', 'lpk:design-critic']]);
  for (const focus of ['state', 'failures', 'main', 'proof', 'sources', 'reuse']) assert.match(calls[0].prompt, new RegExp(`- ${focus}: `));
  assert.match(calls[0].prompt, /Review the whole brief\./);
  assert.match(calls[0].prompt, /\/r\/\.git\/lpk\/sources\/request\.md/);
  assert.equal(out.verdict, 'pass');
  assert.deepEqual(out.counts, { High: 0, Medium: 1, Low: 0 });
});

test('a brief over the word limit is refused before the critic starts', async () => {
  const { out, calls } = await run({ ...ARGS, words: 5001 }, answers({}));
  assert.match(out.error, /5001 words[\s\S]*5000 or fewer/);
  assert.equal(calls.length, 0);
  assert.match((await run({ ...ARGS, words: undefined }, answers({}))).out.error, /needs words/);
  assert.match((await run({ ...LATER, words: 5280, open: [] }, answers({}))).out.error, /5280 words/);
});

test('the requirement ids no row proves reach the critic as a fact', async () => {
  assert.match((await run({ ...ARGS, coverage: 'R3\nR5' }, answers({}))).calls[0].prompt, /not a finding[\s\S]*R3, R5/);
  assert.doesNotMatch((await run(ARGS, answers({}))).calls[0].prompt, /not a finding/);
});

test('a High resting only on inference counts as Medium, and the critic keeps its Highs and at most three other findings', async () => {
  const many = [finding('High', [1], 'inferred'), finding('High', [2]), ...[3, 4, 5, 6].map((n) => finding('Low', [n]))];
  const { out } = await run(ARGS, answers({ 'design-critic': { findings: many } }));
  assert.deepEqual(out.findings.map((f) => [f.severity, f.lines[0], !!f.demoted]), [['High', 2, false], ['Medium', 1, true], ['Low', 3, false], ['Low', 4, false]]);
  assert.equal(out.verdict, 'revise');
});

test('a later round tells the critic its open Highs to check closed and keeps it to the changed lines', async () => {
  const open = [{ angle: 'design-critic', severity: 'High', lines: [9], claim: 'two writers race on the row', cause: 'one writer per row' }];
  const { out, calls } = await run({ ...LATER, open }, answers({}));
  assert.equal(calls.length, 1);
  assert.match(calls[0].prompt, /check on the brief as it stands whether it is closed[\s\S]*lines 9: two writers race on the row \(cause: one writer per row\)/);
  assert.match(calls[0].prompt, /Review only the brief's lines 30, which were just rewritten, and what they reach/);
  assert.equal(out.verdict, 'pass');
});

test('an open High still open on changed lines asks for another approach, a new High asks for a revision, round 3 is the last, and a critic that never answers does not pass', async () => {
  const stillOpen = answers({ 'design-critic': { findings: [finding('Low', [1]), { ...finding('High', [9]), stillOpen: true }] } });
  const fresh = answers({ 'design-critic': { findings: [finding('High', [9])] } });
  const open = [{ angle: 'design-critic', lines: [9] }];
  assert.equal((await run({ ...ARGS, round: 2, changed: [8, 9], open }, fresh)).out.verdict, 'revise');
  const patched = await run({ ...ARGS, round: 2, changed: [8, 9], open }, stillOpen);
  assert.equal(patched.out.verdict, 'redesign');
  assert.deepEqual(patched.out.findings.map((f) => [f.severity, f.onChanged]), [['High', true], ['Low', false]]);
  assert.equal((await run({ ...ARGS, round: 2, changed: [30], open }, stillOpen)).out.verdict, 'revise');
  assert.equal((await run({ ...ARGS, round: 3, changed: [8, 9], open }, stillOpen)).out.verdict, 'last');
  const silent = await run(ARGS, () => null);
  assert.equal(silent.out.verdict, 'incomplete');
  assert.deepEqual(silent.out.missing, ['design-critic']);
});

test('a later round without changed or open is refused', async () => {
  const { changed, ...noChanged } = LATER;
  for (const [args, key] of [[LATER, 'open'], [{ ...noChanged, open: [] }, 'changed']]) {
    const { out, calls } = await run(args, answers({}));
    assert.match(out.error, new RegExp(`\\b${key}\\b`));
    assert.equal(calls.length, 0);
  }
  assert.match((await run({ ...LATER, open: [] }, answers({}))).out.error, /no open High/);
  assert.equal((await run({ ...LATER, changed: [], open: [{ angle: 'design-critic' }] }, answers({}))).out.verdict, 'pass', 'a revision that only deleted lines');
});
