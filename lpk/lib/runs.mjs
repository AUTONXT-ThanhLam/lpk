// One row per lpk run in the user's `runs.jsonl`, written from facts on disk (run.json, the ledger,
// the records, the session's transcripts), never from what an agent says: what `lpk report`, the
// measurement batch and `lpk escapes` read.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readLedger } from './findings.mjs';
import { defaultBranch, git, repoName } from './git.mjs';
import { meter } from './meter.mjs';
import { readRecords } from './records.mjs';
import { readRun } from './run.mjs';
import { lensRuns } from './transcripts.mjs';

export const runsFile = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'lpk', 'runs.jsonl');

export function readRuns() {
  if (!existsSync(runsFile())) return [];
  return readFileSync(runsFile(), 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
}

const CONFIRMED = new Set(['confirmed', 'fixed']);

// Per lens (`from`): findings raised, confirmed (fixed ones included), dropped, pre-existing,
// duplicates, still open or unsettled, and confirmed-unique: confirmed with no duplicate of it
// raised by another lens.
export function yieldOf(findings) {
  const out = {};
  for (const f of findings) {
    const y = (out[f.from || 'unknown'] ||= { raised: 0, confirmed: 0, dropped: 0, preexisting: 0, duplicate: 0, open: 0, confirmedUnique: 0 });
    y.raised++;
    if (CONFIRMED.has(f.state)) y.confirmed++;
    else if (f.state === 'unsettled' || f.state === 'open') y.open++;
    else if (y[f.state] !== undefined) y[f.state]++;
    if (CONFIRMED.has(f.state) && !findings.some((d) => d.primary === f.id && d.from !== f.from)) y.confirmedUnique++;
  }
  return out;
}

// The row for the repo's open run. `extra` adds what the caller computed (the lenses owed but not
// run, with why), so this module needs no second copy of that rule.
export function runRow(repo, extra = {}) {
  const run = readRun(repo);
  if (!run) return null;
  const target = run.target || defaultBranch(repo);
  const head = git(['rev-parse', 'HEAD'], repo).trim();
  const base = target ? git(['merge-base', target, 'HEAD'], repo).trim() : '';
  const findings = readLedger(repo).findings.filter((f) => !f.run || f.run === run.id);
  const records = readRecords(repo, { run: run.id });
  const lenses = {};
  for (const l of run.session ? lensRuns(repo, run.session) : []) {
    const e = (lenses[l.agentType || 'unknown'] ||= { runs: 0, ended: {} });
    e.runs++;
    e.ended[l.ended] = (e.ended[l.ended] || 0) + 1;
  }
  // Tokens, models and first-to-last wall time per agent type, from the transcripts.
  const agents = {};
  for (const r of (run.session && meter(run.session)) || []) {
    const a = (agents[r.agent] ||= { count: 0, fresh: 0, cacheRead: 0, models: [], first: r.first, last: r.last });
    a.count++; a.fresh += r.fresh; a.cacheRead += r.cacheRead;
    a.models = [...new Set([...a.models, ...r.models])];
    if (r.first && r.first < a.first) a.first = r.first;
    if (r.last > a.last) a.last = r.last;
  }
  let version = '';
  try { version = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version; } catch { /* no manifest */ }
  const reviewStarts = records.filter((r) => r.kind === 'review-start').length;
  return {
    id: run.id, repo: repoName(repo), path: repo, session: run.session || null, target, branches: run.branches || [],
    lane: run.lane, laneWhy: run.laneWhy || '', started: new Date(run.started).toISOString(), recorded: new Date().toISOString(),
    wallMs: Date.now() - run.started, sha: head, base, cli: version,
    files: base ? git(['diff', '--name-only', base, head], repo).split('\n').filter(Boolean) : [],
    findingFiles: [...new Set(findings.map((f) => f.file).filter(Boolean))],
    yield: yieldOf(findings.filter((f) => f.kind !== 'test-gap')), testGaps: findings.filter((f) => f.kind === 'test-gap').length,
    fixRounds: Math.max(0, reviewStarts - 1), verifies: records.filter((r) => r.kind === 'verify').length,
    lenses, agents, ...extra,
  };
}

export function recordRun(repo, extra = {}) {
  const row = runRow(repo, extra);
  if (!row) return null;
  mkdirSync(join(runsFile(), '..'), { recursive: true });
  appendFileSync(runsFile(), `${JSON.stringify(row)}\n`);
  return row;
}
