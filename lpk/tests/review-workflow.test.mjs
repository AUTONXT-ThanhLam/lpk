// The review workflow as the Workflow tool runs it: its script body with agent(), parallel(),
// pipeline() and log() standing in for the runtime's, and agents that answer from a table. Every
// lens of the net is one of those agents: nothing here runs a CLI child.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FULL, QUICK, label } from '../lib/owed.mjs';
import { addFinding, markFixed, ruleOn } from '../lib/findings.mjs';
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

// The lens names the workflow itself offers, read off the list it prints when it refuses one it does
// not know. Nothing here retypes them.
const workflowLenses = async () => (await run({ ...ARGS, lenses: ['no-such-lens'] }, () => found())).out.error.match(/; lenses are (.*)$/)[1].split(', ');
// The conditional lenses the floor can add to a lane's set, read off lib/floor.mjs's own list.
const FLOOR = (() => {
  const m = readFileSync(join(ROOT, 'lib', 'floor.mjs'), 'utf8').match(/const order = \[([^\]]*)\]/);
  assert.ok(m, 'lib/floor.mjs lists the conditional lenses in a `const order` array');
  return [...new Set(m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')))];
})();
// Every name the net can ever owe: one of the lane's fixed sets, plus a conditional lens.
const oweable = () => [...new Set([...FULL, ...QUICK].map(label).concat(FLOOR))].sort();

test('every owed lens starts at once as its own agent, and each finding gets its own verifier', async () => {
  const lenses = ['techlead', 'bug-hunter', 'bug-hunter', 'code-reviewer', 'claims', 'regression', 'prover', 'mutant'];
  const { out, calls } = await run({ ...ARGS, lenses }, (prompt, o) => {
    if (o.agentType === 'lpk:verifier') return confirm;
    if (o.agentType === 'lpk:prover') return { findings: [], results: [{ scenario: 'S1', status: 'PASS', evidence: 'saw 3 rows' }] };
    if (o.agentType === 'lpk:mutant') return found('F7');
    // One finding reached the ledger with only its id: the verifier reads it back from there.
    if (o.agentType === 'lpk:regression') return { findings: [{ id: 'F9' }], groups: [] };
    return o.agentType === 'lpk:techlead' ? found('F1', 'F2') : found();
  });
  const review = calls.filter((c) => c.opts.phase === 'Review');
  // Every lens, the mutant included, starts before any lens has answered.
  assert.deepEqual(review.slice(0, 8).map((c) => c.opts.label), ['techlead', 'bug-hunter', 'bug-hunter#2', 'code-reviewer', 'claims', 'regression', 'prover', 'mutant']);
  assert.ok(review.slice(0, 8).every((c, i) => c.running === i));
  // Each lens runs as the agent of its own type: none is relayed to a command, so none is clamped to
  // one or pinned to a model of its own, and a lens owed twice is labelled with a second number.
  assert.deepEqual(review.slice(0, 8).map((c) => c.opts.agentType), lenses.map((l) => `lpk:${l}`));
  assert.ok(review.slice(0, 8).every((c) => !c.opts.bashCommandClamp && !('model' in c.opts)), 'no lens call names a bash command or a model');
  assert.ok(review.every((c) => c.prompt.startsWith(`Review range ${R}.`)));
  // Verifiers: one per ledger finding, identical options, the same prompt up to the finding.
  const verifiers = calls.filter((c) => c.opts.agentType === 'lpk:verifier');
  assert.deepEqual(verifiers.map((c) => c.opts.label).sort(), ['verify:F1', 'verify:F2', 'verify:F9']);
  const strip = ({ label, ...rest }) => rest;
  assert.ok(verifiers.every((c) => assert.deepEqual(strip(c.opts), strip(verifiers[0].opts)) ?? true));
  const head = verifiers[0].prompt.slice(0, verifiers[0].prompt.indexOf('Finding:'));
  assert.ok(verifiers.every((c) => c.prompt.startsWith(`${head}Finding: F`)));
  assert.match(verifiers.find((c) => c.opts.label === 'verify:F9').prompt, /F9 from regression \(read it with finding_get\)$/);
  assert.deepEqual(out.confirmed.map((v) => v.id).sort(), ['F1', 'F2', 'F9']);
  assert.deepEqual(out.testGaps, ['F7']);
  assert.deepEqual(out.ungraded, []);
  // The ledger is the record: a lens hands back its finding ids, never a file of its own.
  assert.deepEqual(out.lenses.map((l) => l.lens), ['techlead', 'bug-hunter', 'bug-hunter#2', 'code-reviewer', 'claims', 'regression', 'prover', 'mutant']);
  assert.ok(out.lenses.every((l) => l.ids && !l.record), 'every lens reports the ids the ledger gave it');
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
  const { out, calls } = await run({ ...ARGS, lenses: ['techlead', 'bug-hunter', 'security'] }, (prompt, o) => {
    if (o.agentType === 'lpk:techlead') return null;
    if (o.agentType === 'lpk:bug-hunter') { if (!o.label.endsWith('(retry)')) throw new Error('agent stalled on all 6 attempts'); return found('F1'); }
    if (o.agentType === 'lpk:verifier') return confirm;
    return { findings: [], error: 'the security agent gave no structured output' };
  });
  assert.deepEqual(calls.filter((c) => c.opts.phase === 'Review').map((c) => c.opts.label).sort(),
    ['bug-hunter', 'bug-hunter (retry)', 'security', 'security (retry)', 'techlead', 'techlead (retry)']);
  assert.deepEqual(out.ungraded, ['techlead: no answer (an API error, or the agent was skipped)', 'security: the security agent gave no structured output']);
  assert.deepEqual(out.confirmed.map((v) => v.id), ['F1']);
});

test('a lens whose findings partly reached the ledger is not run again, and those findings are verified', async () => {
  // A fresh lens would add the ones that did land a second time, so a lens that added some findings
  // and had others refused stops there: its ids go to a verifier, its error is listed.
  const { out, calls } = await run({ ...ARGS, lenses: ['bug-hunter'] }, (p, o) => {
    if (o.agentType === 'lpk:verifier') return confirm;
    return { findings: [{ id: 'F1' }], error: 'finding_add refused a.js:x: line is not a whole number' };
  });
  assert.deepEqual(calls.map((c) => c.opts.label), ['bug-hunter', 'verify:F1']);
  assert.deepEqual(out.confirmed.map((v) => v.id), ['F1']);
  assert.match(out.notCovered[0], /^bug-hunter: finding_add refused a\.js:x: line is not a whole number; not run again, since its other findings are in the ledger/);
});

test('a fix round reviews only the delta: one code review and the lenses that raised the fixed findings', async () => {
  const delta = { range: 'b'.repeat(40) + '..' + 'c'.repeat(40), raisedBy: ['lpk:techlead', 'lpk:security', 'main'] };
  const { calls } = await run({ ...ARGS, delta }, (p, o) => found());
  const review = calls.filter((c) => c.opts.phase === 'Review');
  assert.deepEqual(review.map((c) => c.opts.label), ['code-reviewer', 'techlead', 'security']);
  assert.ok(review.every((c) => c.prompt.startsWith(`Review range ${delta.range}.`)), 'every lens reviews the delta, not the change');
  assert.match(review[0].prompt, /This is the fix delta of the change .*: review only what the delta changes/);
  // A docs-only delta starts no code review: only the lens whose finding the words fixed.
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
  const repo = repoWith('owed-full', { 'a.mjs': 'const a = 1;\n' });
  assert.equal(lpk(repo, 'S', 'run', 'start', '--verify', 'true').status, 0);
  write(repo, 'a.mjs', 'const a = 2;\n');
  assert.equal(lpk(repo, 'S', 'verify').status, 0);
  sh(repo, 'commit', '-qam', 'Set a to 2');
  const patch = `${sh(repo, 'merge-base', 'main', 'HEAD').trim()}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;
  // A confirmed finding the next commit fixes: the patch still owes its whole lane set, and the fix
  // delta owes the bug hunter again.
  const f = addFinding(repo, { from: 'lpk:bug-hunter', at: patch, claim: 'a must stay even', repro: 'r', kind: 'defect', severity: 'important' }).finding;
  ruleOn(repo, { id: f.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'repro fails', by: 'lpk:verifier' });
  write(repo, 'a.mjs', 'const a = 3;\n');
  sh(repo, 'commit', '-qam', 'Set a to 3, keeping it odd');
  assert.ok(markFixed(repo, { id: f.id, commit: sh(repo, 'rev-parse', 'HEAD').trim(), closedBy: 'repro', evidence: 'repro green', by: 'main' }).finding);
  const rows = JSON.parse(lpk(repo, 'S', 'reviews', 'owed', '--json').stdout);
  const lenses = rows.map((r) => r.lens);
  assert.deepEqual(rows.filter((r) => r.lens === 'bug-hunter').map((r) => r.why),
    ['has not run on it', 'fix delta; has not run on it'], 'the bug hunter is owed once on the patch and once on the delta');
  assert.equal(new Set(rows.filter((r) => r.lens === 'bug-hunter').map((r) => r.range)).size, 2, 'the two rows name the two ranges');
  // The names the net prints are owed.mjs's own exported set: a full lane with nothing conditional in
  // it owes exactly FULL, one row per run it owes. code-reviewer needs two, so it is listed twice.
  assert.deepEqual([...new Set(lenses)].sort(), FULL.map(label).sort());
  const need = FULL.find((q) => q.key === 'code-reviewer')?.need || 1;
  assert.deepEqual(rows.filter((r) => r.lens === 'code-reviewer').map((r) => r.why),
    [...Array(need).fill('has not run on it'), 'fix delta; has not run on it'], 'the lens the lane needs twice is owed twice on the one patch');
  // and the workflow runs every name it prints, and knows nothing the net can never owe: the lane's
  // fixed sets plus the conditional lenses the floor adds.
  const known = await workflowLenses();
  assert.deepEqual(known.sort(), oweable(), 'the workflow\'s LENSES are exactly the lenses the net can owe');
  const { out, calls } = await run({ ...ARGS, lenses }, (p, o) => {
    if (o.agentType === 'lpk:verifier') return confirm;
    if (o.label === 'ocr:preview') return { paths: [] };
    if (o.agentType === 'lpk:prover') return { results: [] };
    if (o.agentType === 'lpk:regression') return { findings: [], groups: [] };
    return found();
  });
  assert.equal(out.error, undefined);
  const started = calls.filter((c) => c.opts.phase === 'Review').map((c) => c.opts.label);
  assert.equal(started.filter((l) => l.startsWith('bug-hunter')).length, 2, 'a lens owed twice runs twice');
  assert.equal(started.filter((l) => l.startsWith('code-reviewer')).length, need + 1);
  assert.ok(started.includes('code-reviewer#2') && started.includes('bug-hunter#2'), 'the second run of a lens gets its own label');
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
