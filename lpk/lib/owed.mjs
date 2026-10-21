// The reviews a run still owes: for each of its patches, each lens of the lane's fixed set that has
// not run on a range covering it. A lens ran when the CLI recorded its child run, or when a
// transcript shows an agent of that type, given a range naming the patch, that ended with
// structured output or end_turn and whose findings all reached the ledger. A fix commit owes only
// the delta: one Sonnet /code-review (none when it touches no code) and the lenses whose findings
// it fixed. After a rebase an unchanged patch keeps its reviews; a changed one owes a delta review.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLedger } from './findings.mjs';
import { commitsOf, pairs, patchesOf, rangesOf, touches } from './patches.mjs';
import { readRecords } from './records.mjs';
import { CODE, TEST } from './rules.mjs';
import { readRun, runDir } from './run.mjs';
import { findingCount, lensRuns } from './transcripts.mjs';

const CR = (model, need = 1) => ({ key: 'code-review', model, need });
export const FULL = [{ key: 'techlead' }, CR('sonnet', 2), CR('opus'), { key: 'security-review' }, { key: 'security' }, { key: 'bug-hunter' }, { key: 'regression' }, { key: 'claims' }, { key: 'ocr' }, { key: 'prover' }];
export const QUICK = [CR('sonnet'), { key: 'security-review' }, { key: 'bug-hunter' }];
const CLI = new Set(['code-review', 'security-review']);
// A lens by the name the lpk:review workflow takes in args.lenses (`techlead`, `code-review:sonnet`).
export const label = (q) => (q.key === 'code-review' ? `code-review:${q.model}` : q.key);
// An agent type (`lpk:techlead`) or a CLI child's `from` (`code-review:sonnet`) as a lens key.
const keyOf = (type) => { const t = String(type || ''); return CLI.has(t.split(':')[0]) ? t.split(':')[0] : t.split(':').pop(); };

// The run's findings. A run whose ledger moved under runs/<id>/ when a later run started cannot be
// read here, and says so rather than reading as "no findings".
export function ledgerFor(repo, run) {
  if (readRun(repo)?.id !== run.id && existsSync(join(runDir(repo), 'runs', run.id, 'findings.jsonl'))) throw new Error(`the findings of run ${run.id} were archived when a later run started, and lpk does not read an archived ledger`);
  return readLedger(repo).findings.filter((f) => f.run === run.id);
}

// What ran: items that count, and notes on runs that do not (errored, still running, ungraded).
export function evidence(repo, run, ledger) {
  const items = [], notes = [];
  const counted = (agentId, n) => n === null || ledger.filter((f) => f.agentId === agentId).length === n;
  for (const r of readRecords(repo, { run: run.id })) {
    if (!CLI.has(r.kind) || !r.range) continue;
    if (r.exit !== 0) notes.push({ key: r.kind, range: r.range, why: `exited ${r.exit}` });
    else if (r.agentId && typeof r.findings === 'number' && !counted(r.agentId, r.findings)) notes.push({ key: r.kind, range: r.range, why: `ungraded: ${r.findings} findings returned, ${ledger.filter((f) => f.agentId === r.agentId).length} in the ledger` });
    else items.push({ key: r.kind, model: String(r.model || ''), range: r.range });
  }
  for (const s of [...new Set([run.session, ...(run.previous || [])].filter(Boolean))]) {
    for (const l of lensRuns(repo, s)) {
      const key = keyOf(l.agentType);
      if (!key || !l.range) continue;
      const n = findingCount(l.structured);
      if (l.ended === 'error') notes.push({ key, range: l.range, why: `agent ${l.agentId} ended on an API error` });
      else if (l.ended === 'running') notes.push({ key, range: l.range, why: `agent ${l.agentId} has not finished` });
      else if (!counted(l.agentId, n)) notes.push({ key, range: l.range, why: `ungraded: agent ${l.agentId} returned ${n} findings, the ledger holds ${ledger.filter((f) => f.agentId === l.agentId).length}` });
      else items.push({ key, range: l.range, agentId: l.agentId, structured: l.structured, at: l.at, started: l.started });
    }
  }
  return { items, notes };
}

// The lens set the lane owes on new work, and why when the floor's facts changed it.
async function laneSet(repo, run, base, list) {
  let floor = null;
  const file = new URL('./floor.mjs', import.meta.url);
  if (existsSync(file)) floor = await (await import(file)).floor(repo, base);
  const extra = (floor?.lenses || []).map(keyOf);
  if (list.some((c) => touches(repo, c, TEST))) extra.push('mutant');
  if (run.lane === 'quick' && floor && !floor.full) return { set: QUICK, why: '' };
  const why = run.lane !== 'quick' ? '' : floor ? `quick lane, but lpk floor: ${floor.why.join('; ')}` : 'quick lane, and lpk floor is not installed to clear it';
  return { set: [...FULL, ...[...new Set(extra)].filter((k) => !FULL.some((q) => q.key === k)).map((key) => ({ key }))], why };
}

const covers = (repo, item, sha) => commitsOf(repo, item.range).includes(sha);
const fits = (item, q) => item.key === q.key && (!q.model || item.model.includes(q.model));

export async function owed(repo, run = readRun(repo)) {
  if (!run) throw new Error('no lpk run in this repo');
  const p = patchesOf(repo, run.target);
  if (!p.list.length) return [];
  const ledger = ledgerFor(repo, run);
  const { items, notes } = evidence(repo, run, ledger);
  const { set, why: laneWhy } = await laneSet(repo, run, p.base, p.list);
  const paired = pairs(repo, p, [...items, ...notes].map((i) => i.range));
  const rows = new Map();
  // One row per run owed, so a lens owed twice is listed twice, as the workflow takes it.
  const owe = (q, sha, why, n) => { for (let i = 0; i < n; i++) { const k = `${label(q)}\0${why}\0${i}`; rows.set(k, [...(rows.get(k) || []), sha]); } };
  for (const sha of p.list) {
    const pair = paired.get(sha);
    const fixed = ledger.filter((f) => f.fixedCommit && (f.fixedCommit === sha || f.fixedCommit === pair?.old));
    const direct = (q) => items.filter((i) => fits(i, q) && covers(repo, i, sha)).length;
    const inherited = (q) => (pair ? items.filter((i) => fits(i, q) && covers(repo, i, pair.old)).length : 0);
    const reqs = fixed.length
      ? [...(touches(repo, sha, CODE) ? [{ ...CR('sonnet'), delta: true }] : []), ...[...new Set(fixed.map((f) => keyOf(f.from)))].filter((k) => k && k !== 'main').map((key) => ({ key, delta: true }))]
      : [...set, ...(pair && !pair.same ? [{ ...CR('sonnet'), delta: true }] : [])];
    for (const q of reqs) {
      const have = q.delta ? direct(q) : direct(q) + inherited(q);
      if (have >= (q.need || 1)) continue;
      const note = notes.find((n) => n.key === q.key && commitsOf(repo, n.range).includes(sha));
      owe(q, sha, [fixed.length ? 'fix delta' : pair && !pair.same && q.delta ? 'changed by the rebase' : laneWhy,
        have ? `ran ${have} of ${q.need} times` : note ? note.why : 'has not run on it'].filter(Boolean).join('; '), (q.need || 1) - have);
    }
  }
  return [...rows].flatMap(([k, shas]) => { const [lens, why] = k.split('\0'); return rangesOf(p, shas).map((range) => ({ lens, range, why })); });
}
