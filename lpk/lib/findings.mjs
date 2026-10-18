// The findings ledger of an lpk run: reviewers raise findings, a verifier rules on each, whoever
// fixes one closes it with the commit that fixed it. It lives beside the run marker in the repo's
// common git directory, so every worktree of the repo, and every agent working in one, reads the
// same ledger. What each entry means is the agent's call; this file only keeps the records exact.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { absGitPath, git } from './git.mjs';

// `open` until a verifier rules; `confirmed` is a defect to fix, `preexisting` reproduces on the
// base too (reported, not fixed), `dropped` does not hold. A confirmed one is `fixed` once a
// commit after it was raised changes it.
export const STATES = ['open', 'confirmed', 'preexisting', 'dropped', 'fixed'];

export function ledgerOf(repo) {
  const common = absGitPath(repo, git(['rev-parse', '--git-common-dir'], repo).trim());
  return common ? join(common, 'lpk', 'findings.json') : '';
}

export function readLedger(file) {
  if (!file || !existsSync(file)) return { findings: [] };
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(v.findings) ? v : { findings: [] };
  } catch { return { findings: [] }; }
}

// Written aside and renamed, so a reader never sees half a file.
function writeLedger(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, file);
}

export function resetLedger(file) {
  if (file) rmSync(file, { force: true });
}

const oneLine = (s) => String(s ?? '').trim();
const nextId = (findings) => `F${Math.max(0, ...findings.map((f) => Number(/^F(\d+)$/.exec(f.id)?.[1]) || 0)) + 1}`;

// A finding a reviewer raises. `at` is the commit it was raised on: a fix must be a later commit.
export function addFinding(file, { from, file: path, line, claim, repro, verdict, evidence, at }) {
  const text = oneLine(claim);
  const steps = oneLine(repro);
  if (!text) return { error: 'claim: what is wrong and who meets it' };
  if (!steps) return { error: 'repro: the steps or command that show it' };
  const state = verdict ? String(verdict).trim() : 'open';
  if (!STATES.includes(state)) return { error: `verdict is one of ${STATES.filter((s) => s !== 'open' && s !== 'fixed').join(', ')}` };
  const data = readLedger(file);
  const f = {
    id: nextId(data.findings), from: oneLine(from) || 'unknown', file: oneLine(path), line: Number(line) || 0,
    claim: text, repro: steps, state, evidence: oneLine(evidence), fix: '', fixedCommit: '', at: oneLine(at), raisedAt: new Date().toISOString(),
  };
  data.findings.push(f);
  writeLedger(file, data);
  return { finding: f };
}

export function getFinding(file, id) {
  return readLedger(file).findings.find((f) => f.id === oneLine(id)) || null;
}

// A verifier's ruling. Only a finding still open is ruled on: a second verdict on the same
// finding is a second reviewer answering a question already answered.
export function ruleOn(file, { id, verdict, evidence }) {
  const v = oneLine(verdict);
  if (!['confirmed', 'preexisting', 'dropped'].includes(v)) return { error: 'verdict is confirmed, preexisting or dropped' };
  const why = oneLine(evidence);
  if (!why) return { error: 'evidence: the reproduction, or why it does not hold' };
  const data = readLedger(file);
  const f = data.findings.find((x) => x.id === oneLine(id));
  if (!f) return { error: `no finding ${oneLine(id)}` };
  if (f.state !== 'open') return { error: `${f.id} is already ${f.state} (${f.evidence})` };
  f.state = v;
  f.evidence = why;
  f.ruledAt = new Date().toISOString();
  writeLedger(file, data);
  return { finding: f };
}

// The commit that fixed a confirmed finding, and how. `commit` must differ from the one it was
// raised on, so a fix that was already in the tree when the finding arrived is not counted.
export function markFixed(file, { id, commit, fix }) {
  const sha = oneLine(commit);
  if (!sha) return { error: 'commit: the sha of the commit that fixes it' };
  const data = readLedger(file);
  const f = data.findings.find((x) => x.id === oneLine(id));
  if (!f) return { error: `no finding ${oneLine(id)}` };
  if (f.state !== 'confirmed') return { error: `${f.id} is ${f.state}; only a confirmed finding is fixed` };
  if (f.at && (sha === f.at || sha.startsWith(f.at) || f.at.startsWith(sha))) return { error: `${f.id} was raised on ${f.at}: its fix is a commit after that one` };
  f.state = 'fixed';
  f.fixedCommit = sha;
  f.fix = oneLine(fix);
  writeLedger(file, data);
  return { finding: f };
}

// What delivery refuses on: a finding no verifier settled, or one confirmed and not yet fixed.
export const unsettled = (findings) => findings.filter((f) => f.state === 'open');
export const unfixed = (findings) => findings.filter((f) => f.state === 'confirmed');

// One line per finding, in the order they were raised.
export function findingsText(findings, { state } = {}) {
  const list = state ? findings.filter((f) => f.state === state) : findings;
  if (!list.length) return state ? `no ${state} finding` : 'no finding recorded';
  return list.map((f) => {
    const at = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : '';
    const verdict = f.state === 'open' ? 'open' : `${f.state}${f.evidence ? `: ${f.evidence}` : ''}`;
    const fixed = f.fixedCommit ? ` [fixed in ${f.fixedCommit.slice(0, 12)}]` : '';
    return `${f.id} ${f.from}${at} — ${f.claim} (${verdict})${fixed}`;
  }).join('\n');
}
