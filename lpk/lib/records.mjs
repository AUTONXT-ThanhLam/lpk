// What the CLI itself ran during a run, and the choices the run made off its defaults: one JSON
// line each, beside run.json in the repo's common git directory. A gate reads these records, never
// what an agent says it did. Each line is appended whole, so readers never see half a record.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRun, runDir } from './run.mjs';

const KINDS = ['verify', 'prove', 'repro', 'ci', 'review-start', 'waiver', 'handover', 'go'];

function lines(file) {
  if (!existsSync(file)) return [];
  // A line cut short by a crash is skipped; every whole line before and after it still counts.
  return readFileSync(file, 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
}

function append(repo, name, rec) {
  const dir = runDir(repo);
  if (!dir) throw new Error(`${repo} is not a git repository`);
  mkdirSync(dir, { recursive: true });
  const line = { at: new Date().toISOString(), run: readRun(repo)?.id ?? null, ...rec };
  appendFileSync(join(dir, name), `${JSON.stringify(line)}\n`);
  return line;
}

// `rec.kind` is one of KINDS; `run` defaults to the open run's id, `at` to now.
export function appendRecord(repo, rec) {
  if (!KINDS.includes(rec?.kind)) throw new Error(`record kind ${JSON.stringify(rec?.kind)} is not one of ${KINDS.join(', ')}`);
  return append(repo, 'records.jsonl', rec);
}

// Every record, or those of one run when `run` is given.
export function readRecords(repo, { run } = {}) {
  const dir = runDir(repo);
  const all = dir ? lines(join(dir, 'records.jsonl')) : [];
  return run ? all.filter((r) => r.run === run) : all;
}

// A choice taken without the owner, with its reason; the report lists them.
export function appendDecision(repo, { what, why }) {
  if (!String(what ?? '').trim() || !String(why ?? '').trim()) throw new Error('a decision names what was decided and why');
  return append(repo, 'decisions.jsonl', { what: String(what).trim(), why: String(why).trim() });
}

export function readDecisions(repo, { run } = {}) {
  const dir = runDir(repo);
  const all = dir ? lines(join(dir, 'decisions.jsonl')) : [];
  return run ? all.filter((r) => r.run === run) : all;
}

// Whether the owner released `what` (a gate as `gate:<name>`, a finding by its id) in this run,
// through one of the owner's channels: /lpk-waive, or the waiver question (recorded with the
// question it answered). `lpk waive` run by an agent records `via: cli` and counts for nothing.
export const WAIVE_SOURCE = 'lpk:waive';
const OWNER = new Set(['/lpk-waive', 'ask']);
export const waived = (repo, runId, what) => readRecords(repo, { run: runId })
  .some((r) => r.kind === 'waiver' && r.what === what && (OWNER.has(r.via) || (r.via === undefined && r.question)));
