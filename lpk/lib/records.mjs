// What the CLI itself ran during a run, and the choices the run made off its defaults: one JSON
// line each, beside run.json in the repo's common git directory. A gate reads these records, never
// what an agent says it did. Each line is appended whole, so readers never see half a record.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRun, runDir } from './run.mjs';

export const KINDS = ['verify', 'prove', 'repro', 'ci', 'review-start', 'waiver', 'handover', 'go', 'code-review', 'learn'];

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
export function appendDecision(repo, { what, why, ...more }) {
  if (!String(what ?? '').trim() || !String(why ?? '').trim()) throw new Error('a decision names what was decided and why');
  return append(repo, 'decisions.jsonl', { what: String(what).trim(), why: String(why).trim(), ...more });
}

export function readDecisions(repo, { run } = {}) {
  const dir = runDir(repo);
  const all = dir ? lines(join(dir, 'decisions.jsonl')) : [];
  return run ? all.filter((r) => r.run === run) : all;
}

// The record that released `what` in this run: the owner's, through /lpk-waive or the waiver
// question (recorded with the question it answered), for any id; the lead's (`via: lead`) for a
// `gate:` id other than `gate:pre`, which fails before the lead's command can run. An old `via: cli`
// record counts for nothing.
export const WAIVE_SOURCE = 'lpk:waive';
const OWNER = new Set(['/lpk-waive', 'ask']);
const byOwner = (r) => OWNER.has(r.via) || (r.via === undefined && Boolean(r.question));
export const leadMay = (what) => what.startsWith('gate:') && what !== 'gate:pre';
export function waiverOf(repo, runId, what) {
  const all = readRecords(repo, { run: runId }).filter((r) => r.kind === 'waiver' && r.what === what);
  return all.find(byOwner) || all.find((r) => r.via === 'lead' && leadMay(what)) || null;
}
export const waived = (repo, runId, what) => Boolean(waiverOf(repo, runId, what));
export const countedWaiver = (r) => byOwner(r) || (r.via === 'lead' && leadMay(String(r.what ?? '')));
export const waiversIn = (repo, runId) => readRecords(repo, { run: runId }).filter((r) => r.kind === 'waiver')
  .map((r) => ({ what: r.what, by: byOwner(r) ? 'owner' : r.via === 'lead' ? 'lead' : r.by || r.via || 'unknown', via: r.via, why: r.why ?? r.question ?? '', at: r.at, session: r.session ?? null, counted: countedWaiver(r) }));
export const waiveCommand = (ids) => `lpk waive ${ids.join(' ')} --why "<what stays unproved, and why delivering anyway is right>"`;
