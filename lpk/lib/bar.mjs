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

const limitLine = (f) => `- ${f.id} ${f.kind}/${f.severity}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}: ${f.claim} — ${f.deferEvidence || 'confirmed; a known limit of the increment bar'}${f.deferredBy ? ` (deferred by ${f.deferredBy})` : ''}`;

export function limitsBlock(repo, run, ledger) {
  const left = [...ledger.filter((f) => f.state === 'deferred'), ...knownLimits(repo, run, ledger.filter((f) => f.state === 'confirmed' && f.kind !== 'test-gap'))];
  return { heading: left.length ? 'Known limits, not fixed (for the PR body):' : 'Known limits, not fixed: none', entries: left.map(limitLine) };
}
