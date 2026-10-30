// The reviews a run still owes: for each of its patches, each lens of the lane's fixed set that has
// not run on a range covering it. A lens ran when `lpk code-review` recorded a clean run on a range
// covering the patch, or when a transcript shows an agent of that type, given a range naming the
// patch, that ended with structured output or end_turn and whose findings all reached the ledger.
// A fix commit owes only the delta: one code review of it (none when it touches no code) and the
// lenses whose findings it fixed. After a rebase an unchanged patch keeps its reviews; a changed
// one owes a delta review.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIncrement } from './bar.mjs';
import { ledgerFile, readLedger } from './findings.mjs';
import { hostName } from './host.mjs';
import { commitsOf, pairs, patchesOf, rangesOf, touches } from './patches.mjs';
import { readRecords } from './records.mjs';
import { CODE, TEST } from './rules.mjs';
import { readRun, runDir } from './run.mjs';
import { findingCount, lensRuns } from './transcripts.mjs';

export const FULL = [{ key: 'techlead' }, { key: 'code-reviewer' }, { key: 'bug-hunter' }, { key: 'regression' }, { key: 'claims' }, { key: 'prover' }];
export const DOCS = [{ key: 'techlead' }, { key: 'claims' }];
export const QUICK = [{ key: 'code-reviewer' }, { key: 'bug-hunter' }];
// A lens by the name the lpk:review workflow takes in args.lenses (`techlead`, `code-reviewer`).
export const label = (q) => q.key;
const keyOf = (type) => { const t = String(type || ''); return t.startsWith('code-review:') ? 'code-review' : t.split(':').pop(); };

const onClaude = () => hostName() === 'claude';
export const CODE_REVIEW = { key: 'code-review' };
export const forHost = (set, need) => (onClaude() ? set.map((q) => (q.key === 'code-reviewer' ? { ...CODE_REVIEW, need } : q)) : set);
const delta = () => (onClaude() ? CODE_REVIEW : { key: 'code-reviewer' });

// The run's findings: those its ledger left under runs/<id>/ when a later run started (findings.jsonl,
// then findings.<n>.jsonl, in the order archiveLedger wrote them), and those in the live ledger.
const nth = (name) => Number(name.match(/^findings\.(\d+)\.jsonl$/)?.[1] || 0);
export function ledgerFor(repo, run) {
  const dir = join(runDir(repo), 'runs', run.id);
  const archived = existsSync(dir) ? readdirSync(dir).filter((n) => /^findings(\.\d+)?\.jsonl$/.test(n)).sort((a, b) => nth(a) - nth(b)) : [];
  return [...archived.map((n) => join(dir, n)), ledgerFile(repo)].flatMap((file) => readLedger(repo, file).findings).filter((f) => f.run === run.id);
}

// What ran: items that count, and notes on runs that do not (errored, still running, ungraded).
export function evidence(repo, run, ledger) {
  const items = [], notes = [];
  const counted = (agentId, n) => n === null || ledger.filter((f) => f.agentId === agentId).length === n;
  for (const r of readRecords(repo, { run: run.id })) {
    if (r.kind !== 'code-review' || !r.range) continue;
    if (r.exit !== 0) notes.push({ key: r.kind, range: r.range, why: `lpk code-review exited ${r.exit}: ${r.error || 'no error kept'}` });
    else items.push({ key: r.kind, range: r.range });
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
  if (existsSync(file)) floor = await (await import(pathToFileURL(file))).floor(repo, base);
  const extra = (floor?.lenses || []).map(keyOf);
  if (list.some((c) => touches(repo, c, TEST))) extra.push('mutant');
  if (floor?.docsOnly) return { set: DOCS, why: 'the change is documentation only' };
  if (isIncrement(run)) return { set: [...forHost(QUICK, 1), ...(extra.includes('security') ? [{ key: 'security' }] : [])], why: 'increment bar' };
  if (run.lane === 'quick' && floor && !floor.full) return { set: forHost(QUICK, 1), why: '' };
  const why = run.lane !== 'quick' ? '' : floor ? `quick lane, but lpk floor: ${floor.why.join('; ')}` : 'quick lane, and lpk floor is not installed to clear it';
  const full = forHost(FULL, 2);
  return { set: [...full, ...[...new Set(extra)].filter((k) => !full.some((q) => q.key === k)).map((key) => ({ key }))], why };
}

const covers = (repo, item, sha) => commitsOf(repo, item.range).includes(sha);
const fits = (item, q) => item.key === q.key;

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
      ? [...(touches(repo, sha, CODE) ? [{ ...delta(), delta: true }] : []), ...[...new Set(fixed.map((f) => keyOf(f.from)))].filter((k) => k && k !== 'main').map((key) => ({ key, delta: true }))]
      : [...set, ...(pair && !pair.same ? [{ ...delta(), delta: true }] : [])];
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
