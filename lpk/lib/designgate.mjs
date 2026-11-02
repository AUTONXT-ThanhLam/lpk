import { briefHash, briefUnchecked } from './briefcheck.mjs';
import { floor } from './floor.mjs';
import { patchesOf } from './patches.mjs';

export function designGate(repo, run) {
  const f = floor(repo, patchesOf(repo, run.target).base);
  if (!f.full || f.docsOnly) return { holds: true, read: 'the floor calls the change small', why: '' };
  const facts = `the floor calls this change full: ${f.why.slice(0, 4).join('; ')}`;
  if (!briefHash(repo, run)) return { holds: false, read: 'no Design Brief', why: facts, wayOut: 'write the Design Brief and pass a design review round on it (`design.md`); a run that declared Quick runs `lpk run lane full --why "<why>"` first, so the track and `lpk go` follow' };
  const unchecked = briefUnchecked(repo, { ...run, lane: 'full' }, { go: false });
  return { holds: !unchecked, read: 'brief.md and brief.json; the design review rounds', why: unchecked ? `${facts}; ${unchecked}` : '', wayOut: 'run the design review on the brief as it stands' };
}
