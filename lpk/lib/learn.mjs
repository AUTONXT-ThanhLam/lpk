import { ledgerFor } from './owed.mjs';

const LEARNABLE = ['confirmed', 'fixed', 'deferred'];

export const learnable = (repo, run) => ledgerFor(repo, run).filter((f) => LEARNABLE.includes(f.state)).map((f) => f.id);

export function learnGate(repo, run, recs) {
  const owed = learnable(repo, run);
  const covered = new Set(recs.filter((r) => r.kind === 'learn').flatMap((r) => r.reviewed || []));
  const open = owed.filter((id) => !covered.has(id));
  return {
    holds: !open.length,
    read: `${owed.length} confirmed, fixed or deferred findings; ${owed.length - open.length} covered by \`lpk learn\``,
    why: open.length ? `not yet learned from: ${open.slice(0, 8).join(', ')}${open.length > 8 ? ` and ${open.length - 8} more` : ''}` : '',
    wayOut: 'run the lpk:learn skill on this run, then `lpk learn [--rule <id>]...` for the rules it saved',
  };
}
