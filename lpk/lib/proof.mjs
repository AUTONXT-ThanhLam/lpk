// What proves a run's scenarios and its numbered requirements, from what the CLI recorded and the
// Prover's structured output. A requirement (`R1`, `R2`, ...) is proved by a scenario or failure
// row that names it in `proves` and is itself proved on HEAD, or by a test that names it on a line
// the change adds to a test file, with `lpk verify` green on HEAD's tree.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { evidence, ledgerFor } from './owed.mjs';
import { patchesOf } from './patches.mjs';
import { TEST } from './rules.mjs';
import { readRun, runDir } from './run.mjs';
import { codeOfCommit, headTree } from './tree.mjs';

const short = (s) => String(s || '').slice(0, 12);

// A record proves only what it ran: a `prove` record counts for the scenario whose command and
// expected text it ran, a `verify` record for the run's current list of checks. A scenario or check
// changed by `lpk run start` leaves the old records behind.
export const proofsOf = (recs, s) => recs.filter((r) => r.kind === 'prove' && r.scenario === s.id && r.cmd === s.cmd && (r.expect ?? null) === (s.expect ?? null));
const sameChecks = (results, run) => JSON.stringify((results || []).map((x) => x.cmd)) === JSON.stringify(run.verify || []);
export const verifiedGreen = (run, recs, tree) => recs.some((r) => r.kind === 'verify' && r.green && r.tree === tree && sameChecks(r.results, run))
  || Boolean(run.verified?.green && run.verified.id === tree && sameChecks(run.verified.results, run));

// The Prover's result line for scenario or failure row `s`: by its id (`S1`, `S1: ...`), or by the
// agent-judged text itself.
export const named = (results, s) => results.find((x) => { const t = String(x?.scenario || '').trim(); return t === s.id || t.startsWith(`${s.id}:`) || t.startsWith(`${s.id} `) || (s.agentJudged && t === s.agentJudged); });

// The newest Prover run whose reviewed commit has HEAD's code, started after the run's scenarios
// last changed, or null.
export function lastProver(repo, run) {
  const code = codeOfCommit(repo, 'HEAD').code;
  return evidence(repo, run, ledgerFor(repo, run)).items
    .filter((i) => i.key === 'prover' && i.structured && !(Date.parse(i.started) < (run.scenariosAt || 0)) && codeOfCommit(repo, i.range.split(/\.\.\.?/).pop()).code === code)
    .sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) || null;
}

// The run's brief.json: beside run.json while the run is open, under runs/<id>/ once it ended.
export function briefOf(repo, run) {
  const file = join(runDir(repo), ...(readRun(repo)?.id === run.id ? [] : ['runs', run.id]), 'brief.json');
  return { file, brief: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}

// The requirements and what claims to prove each: brief.json when it numbers them (the Full lane),
// else run.json (`lpk run start --req`, the Quick lane).
export function requirementsOf(repo, run) {
  const { file, brief } = briefOf(repo, run);
  const own = brief?.requirements?.length ? { from: 'brief.json', file, requirements: brief.requirements, scenarios: brief.scenarios || [], failures: brief.failures || [] }
    : { from: 'run.json', file: run.marker || 'run.json', requirements: run.requirements || [], scenarios: run.scenarios || [], failures: [] };
  const ids = own.requirements.map((r) => r?.id);
  const bad = ids.find((id, i) => !/^R\d+$/.test(String(id)) || ids.indexOf(id) !== i);
  if (bad !== undefined) throw new Error(`${own.from} requirement ${bad ?? '(no id)'} is not a unique id R<n>`);
  return own;
}

// Requirement ids named on the lines the change adds to test files, each with those files. Only
// added lines count, so an id an older test in the same file already carried proves nothing here.
export function testsNaming(repo, run) {
  const base = patchesOf(repo, run.target).base;
  const files = git(['diff', '--name-only', `${base}..HEAD`], repo).split('\n').filter((f) => f && TEST.test(f));
  const out = new Map();
  if (!files.length) return out;
  let file = '';
  for (const line of git(['diff', '-U0', '--no-color', `${base}..HEAD`, '--', ...files], repo).split('\n')) {
    if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (!line.startsWith('+')) continue;
    for (const m of line.matchAll(/(?<![\w-])(R\d+)(?!\w)/g)) out.set(m[1], [...new Set([...(out.get(m[1]) || []), file])]);
  }
  return out;
}

// One row per requirement: the proofs that hold on HEAD, and why each claimed proof does not.
export function trace(repo, run, recs) {
  const own = requirementsOf(repo, run);
  const tree = headTree(repo);
  const verified = verifiedGreen(run, recs, tree);
  const inRun = new Map((run.scenarios || []).map((s) => [s.id, s]));
  let prover;
  const results = () => { if (prover === undefined) prover = lastProver(repo, run); return prover?.structured?.results || []; };
  const passBy = (s) => { const r = named(results(), s); return r?.status === 'PASS' ? `PASS by Prover ${prover.agentId}` : null; };
  const scenario = (claimed) => {
    const s = inRun.get(claimed.id);
    if (!s) return { note: `${claimed.id} is not a scenario of the run` };
    if (claimed.cmd && claimed.cmd !== s.cmd) return { note: `${claimed.id} in ${own.from} is not the run's ${s.id}` };
    if (s.cmd) {
      const ok = proofsOf(recs, s).some((r) => r.pass && r.tree === tree);
      return ok ? { proof: `${s.id} green on tree ${short(tree)}` } : { note: `${s.id} not green on HEAD's tree` };
    }
    const by = passBy(s);
    return by ? { proof: `${s.id} ${by}` } : { note: `${s.id} has no Prover PASS on HEAD's code` };
  };
  const failure = (row) => { const by = passBy(row); return by ? { proof: `${row.id} ${by}` } : { note: `failure row ${row.id} has no Prover PASS on HEAD's code` }; };
  const tests = testsNaming(repo, run);
  const rows = own.requirements.map((req) => {
    const got = [
      ...own.scenarios.filter((s) => (s.proves || []).includes(req.id)).map(scenario),
      ...own.failures.filter((f) => (f.proves || []).includes(req.id)).map(failure),
      ...(tests.has(req.id) ? [verified ? { proof: `test in ${tests.get(req.id).join(', ')}, verify green` } : { note: `test in ${tests.get(req.id).join(', ')}, but no green verify on HEAD's tree` }] : []),
    ];
    return { id: req.id, text: req.text || '', source: req.source || '', proofs: got.map((g) => g.proof).filter(Boolean), notes: got.map((g) => g.note).filter(Boolean) };
  });
  return { from: own.from, file: own.file, rows };
}
