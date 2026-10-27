import { floor } from './floor.mjs';
import { PROTECTED } from './findings.mjs';
import { patchesOf } from './patches.mjs';

export const BARS = ['increment', 'production'];
export const isIncrement = (run) => run?.bar === 'increment';
export const barFor = (open, asked) => (asked === 'production' ? 'production' : open ? open.bar : 'increment');

export function knownLimits(repo, run, confirmed) {
  if (!isIncrement(run) || floor(repo, patchesOf(repo, run.target).base).sensitive) return [];
  return confirmed.filter((f) => !PROTECTED.includes(f.area) && f.kind !== 'scenario');
}
