import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readLedger } from '../findings.mjs';
import { readRecords } from '../records.mjs';
import { runDir } from '../run.mjs';

// A lens name as the ledger and the transcripts both write it: `code-review:sonnet`, `lpk:claims`.
const lensOf = (from) => String(from || 'unknown');

// The CLI children, from the run records: what each headless lens ran, what it returned, how long it
// took, what it cost. Only `code-review` is still written; the other two kinds are history.
export function cliLensRuns(repos) {
  const rows = [];
  for (const { repo, run } of repos) {
    let recs = [];
    try { recs = readRecords(repo, run ? { run } : {}); } catch { /* not a git repository any more */ }
    rows.push(...recs);
  }
  return rows.filter((r) => ['code-review', 'security-review', 'self-review'].includes(r.kind));
}

// Every ledger the recorded runs still have on disk. The path a row names may be a scratch worktree
// that is gone, so a ledger is read from every run directory a surviving path can reach: worktrees of
// one repo share it, and a run's archived ledger sits beside another run's live one.
function ledgerFiles(dir) {
  const one = join(dir, 'findings.jsonl');
  const live = existsSync(one) ? [one] : [];
  let ids = [];
  try { ids = readdirSync(join(dir, 'runs')); } catch { return live; }
  const archived = ids.flatMap((id) => {
    let names = [];
    try { names = readdirSync(join(dir, 'runs', id)); } catch { return []; }
    return names.filter((n) => /^findings(\.\d+)?\.jsonl$/.test(n)).map((n) => join(dir, 'runs', id, n));
  });
  return [...live, ...archived];
}

export function ledgers(runs) {
  const out = { byRun: new Map(), absent: [], dirs: [], unrecorded: [] };
  const seen = new Set();
  for (const r of runs) {
    if (!r.path || !existsSync(r.path)) continue;
    let dir = '';
    try { dir = runDir(r.path); } catch { continue /* not a git repository any more */ }
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    out.dirs.push(dir);
    for (const file of ledgerFiles(dir)) {
      let found = [];
      try { found = readLedger(null, file).findings; } catch (e) { out.absent.push(`${file}: ${String(e.message).split('\n')[0]}`); continue; }
      for (const f of found) if (!out.byRun.has(f.run)) out.byRun.set(f.run, []);
      for (const f of found) out.byRun.get(f.run).push(f);
    }
  }
  const rows = new Set(runs.map((r) => r.id));
  out.unrecorded = [...out.byRun.entries()].filter(([id]) => !rows.has(id)).map(([id, f]) => ({ run: id, findings: f.length, fixed: f.filter((x) => x.state === 'fixed').length }));
  for (const x of out.unrecorded) out.byRun.delete(x.run);
  for (const r of runs) if (r.id && !out.byRun.has(r.id)) out.absent.push(`${r.id} (${r.path && existsSync(r.path) ? 'no ledger names it' : `${r.path || 'no path'} is gone`})`);
  return out;
}

export const STATES = ['fixed', 'confirmed', 'dropped', 'duplicate', 'preexisting', 'unsettled', 'open', 'deferred'];

// Per lens: raised, settled each way, and how many of its findings no other lens of the same run put
// on the same file or area. A finding id is only unique inside its run, so the dedup key is both.
export function yieldOf(all) {
  const by = new Map();
  const area = (f) => f.area || f.file || '(no file)';
  const seen = new Set();
  const uniq = (f) => `${f.run}|${f.id}`;
  const rows = all.filter((f) => !seen.has(uniq(f)) && (seen.add(uniq(f)) || true));
  for (const f of rows) {
    const k = lensOf(f.from);
    const t = (by.get(k) || (() => { const x = { lens: k, source: 'ledger', raised: 0, unique: 0, repeated: 0, uniqueFixed: 0, ...Object.fromEntries(STATES.map((s) => [s, 0])) }; by.set(k, x); return x; })());
    t.raised++;
    t[f.state] = (t[f.state] || 0) + 1;
    const dup = rows.some((d) => d !== f && d.run === f.run && d.from !== f.from && area(d) === area(f));
    if (dup) t.repeated++; else t.unique++;
    if (f.state === 'fixed' && !dup) t.uniqueFixed++;
  }
  return [...by.values()];
}
