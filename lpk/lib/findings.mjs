// The findings ledger of an lpk run: reviewers raise findings, a verifier rules on each, a fix closes
// one with its evidence. It is an append-only file of events under the repo's common git directory,
// so every worktree of the repo, and every agent working in one, reads the same ledger, and no write
// ever rewrites an earlier one. What a finding means is the agent's call; this file keeps the
// records exact and says which rulings the owner should read.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { absGitPath, git, isAncestor } from './git.mjs';
import { locked } from './lock.mjs';
import { readRun } from './run.mjs';

export const STATES = ['open', 'confirmed', 'unsettled', 'dropped', 'preexisting', 'duplicate', 'fixed'];
export const VERDICTS = ['confirmed', 'unsettled', 'dropped', 'preexisting', 'duplicate'];
export const KINDS = ['defect', 'test-gap', 'scenario', 'rule'];
export const SEVERITIES = ['important', 'nit'];
export const CLOSED_BY = ['repro', 'test', 'verifier'];
// Where "could not reproduce" is not enough to drop a finding: the verifier's not-reproduced
// becomes unsettled, and the report shows it to the owner.
export const PROTECTED = ['security', 'auth', 'data', 'concurrency', 'migration', 'permissions'];
// The agent type whose rulings stand on their own. Anyone else's drop, pre-existing, duplicate or
// closing ruling is kept with who made it, for the owner to read in the report.
export const VERIFIER = 'lpk:verifier';
const ADD_FIELDS = ['run', 'from', 'agentId', 'at', 'file', 'line', 'claim', 'repro', 'kind', 'ruleId', 'severity', 'area'];

export function ledgerDir(repo) {
  const common = repo ? git(['rev-parse', '--git-common-dir'], repo).trim() : '';
  if (!common) throw new Error(`${repo || '(no repo given)'} is not a git repository, so it has no findings ledger`);
  return join(absGitPath(repo, common), 'lpk');
}
export const ledgerFile = (repo) => join(ledgerDir(repo), 'findings.jsonl');

const now = () => new Date().toISOString();
const text = (v) => (typeof v === 'string' ? v.trim() : '');

function events(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { throw new Error(`${file}:${i + 1} is not a JSON line; the ledger is damaged and no gate can read it`); }
  });
}

// Every finding of the live ledger (or of `file`, one a run left under runs/<id>/), as the events
// left it. A duplicate keeps its own state and names its primary; `stateOf` gives the state it
// closes with.
export function readLedger(repo, file = ledgerFile(repo)) {
  const byId = new Map();
  for (const e of events(file)) {
    if (e.ev === 'add') byId.set(e.finding.id, { ...e.finding, state: 'open' });
    else if (!byId.has(e.id)) throw new Error(`${file}: an event names ${e.id}, which was never added`);
    else if (e.ev === 'verdict') {
      const { ev, time, id, state, ...rest } = e;
      const f = byId.get(id);
      for (const k of ['by', 'evidence', 'basis', 'primary', 'asked']) delete f[k];
      Object.assign(f, rest, { state, ruledAt: time });
    } else if (e.ev === 'fixed') {
      Object.assign(byId.get(e.id), { state: 'fixed', fixedCommit: e.commit, fix: e.fix, closedBy: e.closedBy, fixEvidence: e.evidence, fixedBy: e.by, fixedAt: e.time });
    } else throw new Error(`${file}: unknown event ${JSON.stringify(e.ev)}`);
  }
  return { findings: [...byId.values()], file };
}

export const getFinding = (repo, id) => readLedger(repo).findings.find((f) => f.id === text(id)) || null;

// A primary may later be ruled a duplicate itself, so the chain is followed to its end; a chain
// that loops never settles, so it counts as open.
export function stateOf(f, findings) {
  const seen = new Set();
  while (f?.state === 'duplicate' && !seen.has(f.id)) { seen.add(f.id); f = findings.find((p) => p.id === f.primary); }
  return f && f.state !== 'duplicate' ? f.state : 'open';
}

// True when the owner should read this finding in the report: an unsettled finding, or a drop,
// pre-existing, duplicate or closing ruling made by someone other than the verifier. None blocks.
export function needsOwner(f) {
  if (f.state === 'unsettled') return true;
  if (['dropped', 'preexisting', 'duplicate'].includes(f.state)) return f.by !== VERIFIER;
  if (f.state === 'fixed' && f.closedBy === 'verifier') return f.fixedBy !== VERIFIER;
  return false;
}

function append(repo, event) {
  const dir = ledgerDir(repo);
  appendFileSync(join(dir, 'findings.jsonl'), `${JSON.stringify({ ...event, time: now() })}\n`);
}

// A finding a reviewer raises on the run's reviewed range. Unknown fields are refused, so a field
// misspelled by an agent never vanishes silently.
export function addFinding(repo, input) {
  const unknown = Object.keys(input).filter((k) => !ADD_FIELDS.includes(k));
  if (unknown.length) return { error: `unknown field ${unknown.join(', ')}; a finding takes ${ADD_FIELDS.join(', ')}` };
  const run = readRun(repo);
  if (!run?.id) return { error: `no lpk run in ${repo}; findings belong to a run (lpk run start)` };
  if (input.run !== undefined && input.run !== run.id) return { error: `this finding was stamped for run ${input.run}, but the run in ${repo} is ${run.id}` };
  const f = { run: run.id, from: text(input.from), at: text(input.at), claim: text(input.claim), repro: text(input.repro), kind: input.kind, severity: input.severity };
  if (!f.from) return { error: 'from: the agent type raising it (the finding hook stamps it)' };
  if (!f.at) return { error: 'at: the reviewed range (lpk review start <range> records it; the finding hook stamps it)' };
  if (!f.claim) return { error: 'claim: what is wrong and who meets it' };
  if (!f.repro) return { error: 'repro: the steps or command that show it' };
  if (!KINDS.includes(f.kind)) return { error: `kind is one of ${KINDS.join(', ')}` };
  if (!SEVERITIES.includes(f.severity)) return { error: `severity is one of ${SEVERITIES.join(', ')}` };
  if (f.kind === 'rule') { f.ruleId = text(input.ruleId); if (!f.ruleId) return { error: 'ruleId: the id of the rule a kind rule finding cites' }; }
  if (text(input.agentId)) f.agentId = text(input.agentId);
  if (text(input.file)) f.file = text(input.file);
  if (input.line !== undefined) { if (!Number.isInteger(input.line) || input.line < 1) return { error: 'line is a whole number from 1' }; f.line = input.line; }
  const area = input.area ?? (f.from === 'lpk:security' ? 'security' : undefined);
  if (area !== undefined) { if (!PROTECTED.includes(area)) return { error: `area is one of ${PROTECTED.join(', ')}` }; f.area = area; }
  return locked(ledgerDir(repo), () => {
    const row = { id: `F${readLedger(repo).findings.length + 1}`, ...f };
    append(repo, { ev: 'add', finding: row });
    return { finding: { ...row, state: 'open' } };
  });
}

// A ruling on one finding. A ruling the verifier made and settled stands; one anybody else made,
// or an unsettled one, may be ruled on again. In a protected area a not-reproduced drop is kept
// as unsettled.
export function ruleOn(repo, { id, verdict, evidence, by, basis, primary }) {
  if (!VERDICTS.includes(verdict)) return { error: `verdict is one of ${VERDICTS.join(', ')}` };
  const why = text(evidence);
  if (!why) return { error: 'evidence: the reproduction and its output, or why it does not hold' };
  if (!text(by)) return { error: 'by: who rules (the finding hook stamps it)' };
  if (verdict === 'dropped' && !['not-reproduced', 'disproved'].includes(basis)) return { error: 'basis: not-reproduced (the repro did not fail) or disproved (evidence shows the claim is false)' };
  return locked(ledgerDir(repo), () => {
    const { findings } = readLedger(repo);
    const f = findings.find((x) => x.id === text(id));
    if (!f) return { error: `no finding ${text(id)}` };
    if (f.state === 'fixed') return { error: `${f.id} is fixed in ${f.fixedCommit}` };
    if (f.state !== 'open' && f.state !== 'unsettled' && f.by === VERIFIER) return { error: `${f.id} is already ${f.state} by the verifier (${f.evidence})` };
    const e = { ev: 'verdict', id: f.id, state: verdict, by: text(by), evidence: why };
    if (verdict === 'duplicate') {
      const p = findings.find((x) => x.id === text(primary));
      if (!p || p.id === f.id) return { error: 'primary: the id of the other finding this one repeats' };
      if (p.state === 'duplicate') return { error: `${p.id} is itself a duplicate of ${p.primary}; name ${p.primary}` };
      e.primary = p.id;
    }
    if (verdict === 'dropped') e.basis = basis;
    if (verdict === 'dropped' && basis === 'not-reproduced' && PROTECTED.includes(f.area)) Object.assign(e, { state: 'unsettled', asked: 'dropped' });
    append(repo, e);
    return { finding: readLedger(repo).findings.find((x) => x.id === f.id) };
  });
}

// Closes a confirmed finding with the commit that fixed it and how that is known: a repro now
// green, a test that fails before the fix, or the verifier's ruling. The commit must exist and must
// not be the reviewed commit itself. A fixed finding is closed again only from a checkout whose HEAD
// holds the new fix and no longer holds the old one (the branch was rebuilt).
export function markFixed(repo, { id, commit, fix, closedBy, evidence, by }) {
  if (!CLOSED_BY.includes(closedBy)) return { error: `closedBy is one of ${CLOSED_BY.join(', ')}` };
  const why = text(evidence);
  if (!why) return { error: 'evidence: the repro or test run that shows it fixed, or the ruling' };
  if (!text(by)) return { error: 'by: who closes it (the finding hook stamps it)' };
  const sha = git(['rev-parse', '--verify', '--quiet', `${text(commit)}^{commit}`], repo).trim();
  if (!text(commit) || !sha) return { error: `commit: ${text(commit) || '(none)'} is not a commit in ${repo}` };
  return locked(ledgerDir(repo), () => {
    const f = readLedger(repo).findings.find((x) => x.id === text(id));
    if (!f) return { error: `no finding ${text(id)}` };
    const rebuilt = f.state === 'fixed' && !isAncestor(repo, f.fixedCommit, 'HEAD') && isAncestor(repo, sha, 'HEAD');
    if (f.state !== 'confirmed' && !rebuilt) return { error: `${f.id} is ${f.state}${f.state === 'fixed' ? ` in ${f.fixedCommit}` : ''}; only a confirmed finding is fixed, or a fixed one again from a checkout whose HEAD holds the new fix and lost the old` };
    const reviewed = git(['rev-parse', '--verify', '--quiet', `${f.at.split('..').pop()}^{commit}`], repo).trim();
    if (reviewed === sha) return { error: `${f.id} was raised on ${f.at}: its fix is a commit after that one` };
    append(repo, { ev: 'fixed', id: f.id, commit: sha, fix: text(fix), closedBy, evidence: why, by: text(by) });
    return { finding: readLedger(repo).findings.find((x) => x.id === f.id) };
  });
}

// A run that ends keeps its ledger: the file moves under runs/<id>/, and the next run starts empty.
export function archiveLedger(repo, runId) {
  if (!/^[\w.-]+$/.test(runId ?? '') || /^\.+$/.test(runId)) return { error: `run id ${JSON.stringify(runId)} cannot name a directory` };
  const dir = ledgerDir(repo);
  return locked(dir, () => {
    const file = join(dir, 'findings.jsonl');
    if (!existsSync(file)) return { archived: null };
    const into = join(dir, 'runs', runId);
    mkdirSync(into, { recursive: true });
    let n = 0;
    const name = () => join(into, n ? `findings.${n}.jsonl` : 'findings.jsonl');
    while (existsSync(name())) n += 1;
    renameSync(file, name());
    return { archived: name() };
  });
}

// The listing `bin/lpk` and the MCP server print.
export { counts, findingsText } from './findings-text.mjs';

// The names `bin/lpk` still imports: the ledger's path, and a reset that keeps the old ledger
// under runs/ instead of deleting it.
export const ledgerOf = (repo) => { try { return ledgerFile(repo); } catch { return ''; } };
export function resetLedger(file) {
  if (!file || !existsSync(file)) return;
  locked(dirname(file), () => {
    const into = join(dirname(file), 'runs', `before-${Date.now()}`);
    mkdirSync(into, { recursive: true });
    renameSync(file, join(into, 'findings.jsonl'));
  });
}
