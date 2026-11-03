import { floor } from './floor.mjs';
import { PROTECTED } from './findings.mjs';
import { patchesOf } from './patches.mjs';

export const BARS = ['increment', 'production'];
export const isIncrement = (run) => run?.bar === 'increment';
export const barFor = (open, asked) => (asked === 'production' ? 'production' : open ? open.bar : 'increment');

export function knownLimits(repo, run, confirmed) {
  if (!isIncrement(run) || floor(repo, patchesOf(repo, run.target).base).lenses.includes('security')) return [];
  return confirmed.filter((f) => !PROTECTED.includes(f.area) && f.kind !== 'scenario');
}

export const leftUnfixed = (repo, run, ledger) => [...ledger.filter((f) => f.state === 'deferred'), ...knownLimits(repo, run, ledger.filter((f) => f.state === 'confirmed' && f.kind !== 'test-gap'))];
export const limitLine = (f) => `- ${f.id} ${f.kind}/${f.severity}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}: ${f.claim} — ${f.deferEvidence || 'confirmed; a known limit of the increment bar'}${f.deferredBy ? ` (deferred by ${f.deferredBy})` : ''}`;
