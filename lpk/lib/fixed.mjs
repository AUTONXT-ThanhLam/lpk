import { append, ledgerDir, PROTECTED, readLedger } from './findings.mjs';
import { git } from './git.mjs';
import { locked } from './lock.mjs';
import { lateFix, lateFixError, sweepOf } from './sweep.mjs';

export const CLOSED_BY = ['repro', 'test', 'verifier', 'owner'];

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const commitOf = (repo, ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).trim();
const onHead = (repo, sha) => git(['merge-base', sha, 'HEAD'], repo).trim() === sha;

function defer(repo, f, words, by) {
  if (f.state !== 'confirmed') return { error: `${f.id} is ${f.state}; only a confirmed finding is deferred` };
  if (PROTECTED.includes(f.area)) return { error: `${f.id} is in the ${f.area} area, which no speed policy defers: fix it, or ask the owner to waive the findings gate` };
  if (f.kind === 'scenario') return { error: `${f.id} is an acceptance scenario that fails, which its user meets: fix it, or ask the owner to waive the findings gate` };
  append(repo, { ev: 'deferred', id: f.id, evidence: words, by });
  return { finding: readLedger(repo).findings.find((x) => x.id === f.id) };
}

export function markFixed(repo, { id, commit, fix, closedBy, evidence, by, sweep }) {
  if (!CLOSED_BY.includes(closedBy)) return { error: `closedBy is one of ${CLOSED_BY.join(', ')}` };
  const owner = closedBy === 'owner';
  const why = text(evidence);
  if (!why) return { error: owner ? 'evidence: the owner\'s words that let this finding wait, quoted' : 'evidence: the repro or test run that shows it fixed, or the ruling' };
  if (!text(by)) return { error: 'by: who closes it (the finding hook stamps it)' };
  const sha = owner ? '' : commitOf(repo, text(commit));
  if (!owner && !sha) return { error: `commit: ${text(commit) || '(none)'} is not a commit in ${repo}` };
  return locked(ledgerDir(repo), () => {
    const f = readLedger(repo).findings.find((x) => x.id === text(id));
    if (!f) return { error: `no finding ${text(id)}` };
    if (owner) return defer(repo, f, why, text(by));
    if (f.state === 'fixed') {
      if (onHead(repo, f.fixedCommit)) return { error: `${f.id} is fixed in ${f.fixedCommit}, which is on HEAD; it is closed again only after that commit left the branch` };
      if (!onHead(repo, sha)) return { error: `${f.id} is fixed in ${f.fixedCommit}; it moves only to a commit on HEAD that carries the fix, and ${sha} is not on HEAD` };
    } else if (f.state !== 'confirmed') return { error: `${f.id} is ${f.state}; only a confirmed finding is fixed` };
    const reviewed = commitOf(repo, f.at.split('..').pop());
    if (reviewed === sha) return { error: `${f.id} was raised on ${f.at}: its fix is a commit after that one` };
    let kept = f.sweep;
    if (f.state === 'confirmed') {
      const late = lateFix(repo, f, readLedger(repo).findings);
      if (late) return { error: lateFixError(f, late) };
      if (f.file) {
        const s = sweepOf(repo, f, sha, sweep);
        if (s.error) return s;
        kept = s.sweep;
      }
    }
    append(repo, { ev: 'fixed', id: f.id, commit: sha, fix: text(fix), closedBy, evidence: why, by: text(by), ...(kept ? { sweep: kept } : {}) });
    return { finding: readLedger(repo).findings.find((x) => x.id === f.id) };
  });
}
