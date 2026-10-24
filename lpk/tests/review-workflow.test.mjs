// The review workflow as the Workflow tool runs it: its script body with agent(), parallel(),
// pipeline() and log() standing in for the runtime's, and agents that answer from a table.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lpk, repoWith, sh, write } from './gates-env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BODY = readFileSync(join(ROOT, 'workflows', 'review.js'), 'utf8').replace(/^export const meta = \{[\s\S]*?\n\}\n/, '');
const AsyncFunction = (async () => {}).constructor;
const tick = () => new Promise((r) => setTimeout(r, 5));

// The runtime's barrier and pipeline: a thunk or stage that throws becomes null.
const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));
const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
  let v = item;
  for (const s of stages) { try { v = await s(v, item, i); } catch { return null; } }
  return v;
}));

const R = 'a'.repeat(40) + '..' + 'b'.repeat(40);
const ARGS = { repo: '/r', base: 'a'.repeat(40), commit: 'b'.repeat(40), range: R, bundle: '/b', request: 'add paging', scenarios: 'S1 a page has n rows', surface: 'http://localhost:3000', testCmd: 'npm test -- page' };

// Runs the workflow; `answer(prompt, opts)` gives each agent's return, and every call is kept with
// how many agents were running when it started.
async function run(args, answer) {
  const calls = [], logs = [];
  let running = 0, peak = 0;
  const agent = async (prompt, opts) => {
    calls.push({ prompt, opts, running });
    peak = Math.max(peak, ++running);
    try { await tick(); return await answer(prompt, opts); } finally { running--; }
  };
  const out = await new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'log', 'phase', BODY)(args, agent, parallel, pipeline, (m) => logs.push(m), () => {});
  return { out, calls, logs, peak };
}

const found = (...ids) => ({ findings: ids.map((id) => ({ id, file: 'a.js', line: 2, claim: `claim of ${id}`, repro: `repro of ${id}` })) });
const confirm = { verdict: 'confirmed', reach: 'user', evidence: 'exit 1 on the commit, 0 on the base' };

test('every owed lens starts at once, the /code-review children through a clamped relay, and each finding gets its own verifier', async () => {
  const lenses = ['techlead', 'code-review:sonnet', 'code-review:sonnet', 'code-review:opus', 'security-review', 'bug-hunter', 'prover', 'mutant'];
  const { out, calls } = await run({ ...ARGS, lenses }, (prompt, o) => {
    if (o.agentType === 'lpk:verifier') return confirm;
    if (o.schema?.required?.includes('record')) return { record: `/out/${o.label}.json`, ids: o.label === 'code-review:opus' ? ['F9'] : [] };
    if (o.agentType === 'lpk:prover') return { findings: [], results: [{ scenario: 'S1', status: 'PASS', evidence: 'saw 3 rows' }] };
    if (o.agentType === 'lpk:mutant') return found('F7');
    return o.agentType === 'lpk:techlead' ? found('F1', 'F2') : found();
  });
  const review = calls.filter((c) => c.opts.phase === 'Review');
  // Every lens, the mutant included, starts before any lens has answered.
  assert.deepEqual(review.slice(0, 8).map((c) => c.opts.label), ['techlead', 'code-review:sonnet', 'code-review:sonnet#2', 'code-review:opus', 'security-review', 'bug-hunter', 'prover', 'mutant']);
  assert.ok(review.slice(0, 8).every((c, i) => c.running === i));
  for (const c of review.filter((x) => x.opts.bashCommandClamp)) {
    assert.deepEqual(c.opts.bashCommandClamp, ['Bash(lpk code-review *)']);
    assert.deepEqual([c.opts.model, c.opts.effort], ['haiku', 'low']);
  }
  assert.match(review[3].prompt, /\nlpk code-review --repo \/r --model opus --effort high\n/);
  assert.match(review[4].prompt, /\nlpk code-review --repo \/r --security --model sonnet --effort high\n/);
  assert.ok(review.every((c) => c.prompt.startsWith(`Review range ${R}.`)));
  // Verifiers: one per ledger finding, identical options, the same prompt up to the finding.
  const verifiers = calls.filter((c) => c.opts.agentType === 'lpk:verifier');
  assert.deepEqual(verifiers.map((c) => c.opts.label).sort(), ['verify:F1', 'verify:F2', 'verify:F9']);
  const strip = ({ label, ...rest }) => rest;
  assert.ok(verifiers.every((c) => assert.deepEqual(strip(c.opts), strip(verifiers[0].opts)) ?? true));
  const head = verifiers[0].prompt.slice(0, verifiers[0].prompt.indexOf('Finding:'));
  assert.ok(verifiers.every((c) => c.prompt.startsWith(`${head}Finding: F`)));
  assert.match(verifiers.find((c) => c.opts.label === 'verify:F9').prompt, /F9 from code-review:opus \(read it with finding_get\)$/);
  assert.deepEqual(out.confirmed.map((v) => v.id).sort(), ['F1', 'F2', 'F9']);
  assert.deepEqual(out.testGaps, ['F7']);
  assert.deepEqual(out.ungraded, []);
  assert.equal(out.lenses.find((l) => l.lens === 'code-review:opus').record, '/out/code-review:opus.json');
});

test('the mutant runs beside the prover unless told they share a database or port', async () => {
  const order = async (flag) => {
    const events = [];
    const { calls } = await run({ ...ARGS, lenses: ['prover', 'mutant'], ...flag }, async (p, o) => {
      if (o.agentType === 'lpk:prover') { await new Promise((r) => setTimeout(r, 30)); events.push('prover ends'); return { results: [] }; }
      events.push('mutant answers');
      return found();
    });
    return { events, mutant: calls.find((c) => c.opts.agentType === 'lpk:mutant') };
  };
  const atOnce = await order({});
  assert.equal(atOnce.mutant.running, 1);
  assert.deepEqual(atOnce.events, ['mutant answers', 'prover ends']);
  const waits = await order({ mutantAfterProver: true });
  assert.equal(waits.mutant.running, 0);
  assert.deepEqual(waits.events, ['prover ends', 'mutant answers']);
});

test('proverGroups starts one Prover per group at once, each told only its group, and a mutant told to wait waits for every one', async () => {
  const events = [];
  const groups = ['S1, FM1: the CLI', 'S2, S3, FM2: the contacts page'];
  const { out, calls } = await run({ ...ARGS, lenses: ['prover', 'mutant'], proverGroups: groups, mutantAfterProver: true }, async (p, o) => {
    if (o.agentType === 'lpk:prover') {
      await new Promise((r) => setTimeout(r, o.label === 'prover:1' ? 10 : 40));
      events.push(`${o.label} ends`);
      return { results: [{ scenario: o.label === 'prover:1' ? 'S1' : 'S2', status: 'PASS', evidence: 'ran it', proves: [] }] };
    }
    events.push('mutant answers');
    return found();
  });
  const provers = calls.filter((c) => c.opts.agentType === 'lpk:prover');
  assert.deepEqual(provers.map((c) => [c.opts.label, c.running]), [['prover:1', 0], ['prover:2', 1]]);
  assert.ok(provers[0].prompt.includes(`Prove only this group;`) && provers[0].prompt.includes(groups[0]) && !provers[0].prompt.includes(groups[1]));
  assert.ok(provers[1].prompt.includes(groups[1]) && !provers[1].prompt.includes(groups[0]));
  assert.deepEqual(events, ['prover:1 ends', 'prover:2 ends', 'mutant answers']);
  assert.deepEqual(out.scenarios.map((x) => x.scenario), ['S1', 'S2']);
});

test('a lens that fails runs once more, then is ungraded with the reason', async () => {
  const { out, calls } = await run({ ...ARGS, lenses: ['techlead', 'bug-hunter', 'code-review:sonnet'] }, (prompt, o) => {
    if (o.agentType === 'lpk:techlead') return null;
    if (o.agentType === 'lpk:bug-hunter') { if (!o.label.endsWith('(retry)')) throw new Error('agent stalled on all 6 attempts'); return found('F1'); }
    if (o.agentType === 'lpk:verifier') return confirm;
    return { record: '/out/r.json', ids: [], error: 'lpk code-review: the review child failed' };
  });
  assert.deepEqual(calls.filter((c) => c.opts.phase === 'Review').map((c) => c.opts.label).sort(),
    ['bug-hunter', 'bug-hunter (retry)', 'code-review:sonnet', 'code-review:sonnet (retry)', 'techlead', 'techlead (retry)']);
  assert.deepEqual(out.ungraded, ['techlead: no answer (an API error, or the agent was skipped)', 'code-review:sonnet: lpk code-review: the review child failed']);
  assert.deepEqual(out.confirmed.map((v) => v.id), ['F1']);
});

test('a /code-review child that added some findings before failing is not run again, and its findings are verified', async () => {
  const { out, calls } = await run({ ...ARGS, lenses: ['code-review:sonnet'] }, (p, o) => {
    if (o.agentType === 'lpk:verifier') return confirm;
    return { record: '/out/r.json', ids: ['F1'], error: 'lpk code-review: 1 finding(s) could not be added to the ledger: a.js:x: line is not a whole number' };
  });
  assert.deepEqual(calls.map((c) => c.opts.label), ['code-review:sonnet', 'verify:F1']);
  assert.deepEqual(out.confirmed.map((v) => v.id), ['F1']);
  assert.match(out.notCovered[0], /^code-review:sonnet: lpk code-review: 1 finding\(s\) could not be added .*not run again/);
});

test('a fix round reviews only the delta: one Sonnet /code-review and the lenses that raised the fixed findings', async () => {
  const delta = { range: 'b'.repeat(40) + '..' + 'c'.repeat(40), raisedBy: ['lpk:techlead', 'code-review:opus', 'main'] };
  const { calls } = await run({ ...ARGS, delta }, (p, o) => (o.schema?.required?.includes('record') ? { record: '/r', ids: [] } : found()));
  const review = calls.filter((c) => c.opts.phase === 'Review');
  assert.deepEqual(review.map((c) => c.opts.label), ['code-review:sonnet', 'techlead']);
  assert.match(review[0].prompt, new RegExp(`--model sonnet --effort high --range ${delta.range}\\n`));
  assert.ok(review.every((c) => c.prompt.startsWith(`Review range ${delta.range}.`)));
  const docs = await run({ ...ARGS, delta: { ...delta, raisedBy: ['lpk:claims'], docsOnly: true } }, () => found());
  assert.deepEqual(docs.calls.map((c) => c.opts.label), ['claims']);
});

test('no more agents run at once than args.maxParallel allows', async () => {
  const { peak, out } = await run({ ...ARGS, maxParallel: 2, lenses: ['techlead', 'bug-hunter', 'regression', 'claims', 'security'] }, (p, o) => {
    if (o.agentType === 'lpk:verifier') return confirm;
    return o.agentType === 'lpk:regression' ? { ...found('F3'), groups: [{ id: 'g2', status: 'skipped', changes: 'too large' }] } : found(`F-${o.agentType}`);
  });
  assert.equal(peak, 2);
  assert.equal(out.confirmed.length, 5);
  assert.deepEqual(out.notCovered, ['regression: did not review g2: too large']);
});

test('the lenses `lpk reviews owed` lists are the workflow\'s own names, a lens owed twice listed twice', async () => {
  const repo = repoWith('owed-full', { 'a.mjs': 'export const a = 1;\n' });
  assert.equal(lpk(repo, 'S', 'run', 'start', '--verify', 'true').status, 0);
  write(repo, 'a.mjs', 'export const a = 2;\n');
  assert.equal(lpk(repo, 'S', 'verify').status, 0);
  sh(repo, 'commit', '-qam', 'Set a to 2');
  const lenses = JSON.parse(lpk(repo, 'S', 'reviews', 'owed', '--json').stdout).map((r) => r.lens);
  assert.equal(lenses.filter((l) => l === 'code-review:sonnet').length, 2);
  const { out, calls } = await run({ ...ARGS, lenses }, (p, o) => (o.schema?.required?.includes('record') ? { record: '/r', ids: [] } : o.agentType === 'lpk:prover' ? { results: [] } : found()));
  assert.equal(out.error, undefined);
  assert.equal(calls.filter((c) => c.opts.phase === 'Review' && c.opts.label.startsWith('code-review:sonnet')).length, 2);
});

test('the workflow refuses a lens it does not know instead of skipping it', async () => {
  const { out, calls } = await run({ ...ARGS, lenses: ['techlead', 'linter'] }, () => found());
  assert.match(out.error, /unknown lens linter/);
  assert.equal(calls.length, 0);
});

test('OpenCodeReview splits the files into batches and reports each file no batch reviewed', async () => {
  const paths = Array.from({ length: 23 }, (_, i) => `src/f${String(i).padStart(2, '0')}.ts`);
  const batches = [];
  const { out, calls } = await run({ ...ARGS, lenses: ['ocr'] }, (prompt, o) => {
    if (o.label === 'ocr:preview') return { paths };
    const mine = paths.filter((p) => prompt.includes(p));
    batches.push(mine);
    if (batches.length === 2) return null;
    return { findings: [], files: mine.filter((p) => p !== 'src/f00.ts').map((p) => (p === 'src/f01.ts' ? { path: p, status: 'skipped', reason: 'generated' } : { path: p, status: 'reviewed' })) };
  });
  assert.deepEqual(calls[0].opts.bashCommandClamp, ['Bash(npx -y -p @alibaba-group/open-code-review@1.13.0 ocr delegate preview *)']);
  assert.deepEqual(batches.map((b) => b.length).sort(), [7, 8, 8]);
  assert.deepEqual(batches.flat().sort(), paths);
  assert.ok(out.notCovered.includes('ocr: did not review src/f00.ts'));
  assert.ok(out.notCovered.includes('ocr: did not review src/f01.ts: generated'));
  assert.equal(out.notCovered.length, 2 + batches[1].length);
});

test('reviewers see the failure table, and a finding the verifier could not settle comes back unsettled', async () => {
  const { out, calls } = await run({ ...ARGS, failureModes: 'redis down: refuse the lock', lenses: ['techlead'] }, (p, o) =>
    (o.agentType === 'lpk:verifier' ? { verdict: 'unsettled', evidence: 'could not start the app' } : found('F1')));
  assert.match(calls[0].prompt, /redis down: refuse the lock/);
  assert.deepEqual(out.confirmed, []);
  assert.deepEqual(out.unsettled.map((v) => [v.id, v.lens]), [['F1', 'techlead']]);
});

test('a mutant that finds the tests failing on the change itself sends that defect to a verifier', async () => {
  const { out, calls } = await run({ ...ARGS, lenses: ['mutant'] }, (prompt, o) => {
    if (o.agentType === 'lpk:verifier') return confirm;
    return { findings: [{ id: 'F3', kind: 'defect', file: 'a.test.js', line: 9, claim: 'fails 2 of 3 runs: deadlock detected', repro: 'npm test -- a' }] };
  });
  assert.deepEqual(calls.filter((c) => c.opts.agentType === 'lpk:verifier').map((c) => c.opts.label), ['verify:F3']);
  assert.deepEqual(out.confirmed.map((v) => v.id), ['F3']);
  assert.deepEqual(out.testGaps, []);
});
