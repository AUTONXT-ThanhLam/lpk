// What a person or an agent reads of the ledger: one line per finding, and the counts by state.
import { needsOwner, STATES, stateOf } from './findings.mjs';

// One line per finding, in the order they were raised; a filter on state matches what a duplicate
// closes with, too.
export function findingsText(findings, { state } = {}) {
  const list = state ? findings.filter((f) => f.state === state || stateOf(f, findings) === state) : findings;
  if (!list.length) return state ? `no ${state} finding` : 'no finding recorded';
  return list.map((f) => {
    const where = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : '';
    const ruled = f.state === 'duplicate' ? `duplicate of ${f.primary}` : f.state;
    const by = f.by ? ` by ${f.by}` : '';
    const owner = needsOwner(f) ? ', for the owner to read' : '';
    const fixed = f.fixedCommit ? ` [fixed in ${f.fixedCommit.slice(0, 12)}, ${f.closedBy}]` : f.state === 'deferred' ? ` [deferred: ${f.deferEvidence}]` : '';
    const cause = f.cause ? `; born in ${f.born}: ${f.cause}` : '';
    return `${f.id} ${f.kind}/${f.severity} ${f.from}${where} — ${f.claim} (${ruled}${by}${owner}${cause})${fixed}`;
  }).join('\n');
}

// How many findings stand in each state (a duplicate counted where its primary is), and how many
// are for the owner to read.
export function counts(findings) {
  const out = Object.fromEntries(STATES.filter((s) => s !== 'duplicate').map((s) => [s, 0]));
  for (const f of findings) out[stateOf(f, findings)] += 1;
  return { ...out, duplicate: findings.filter((f) => f.state === 'duplicate').length, needsOwner: findings.filter(needsOwner).length, total: findings.length };
}
