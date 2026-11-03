import { stateOf } from './findings.mjs';
import { learnGate } from './learn.mjs';
import { ledgerFor } from './owed.mjs';
import { countedWaiver, readDecisions, readRecords } from './records.mjs';
import { endedRuns } from './run.mjs';

const UNCLOSED = ['open', 'unsettled', 'confirmed', 'deferred'];

function leftBy(repo, earlier) {
  try {
    const all = ledgerFor(repo, earlier);
    const findings = all.filter((f) => f.state !== 'duplicate' && UNCLOSED.includes(stateOf(f, all))).map((f) => ({ id: f.id, state: f.state }));
    const recs = readRecords(repo, { run: earlier.id });
    const waivers = [...new Set(recs.filter((r) => r.kind === 'waiver' && countedWaiver(r)).map((r) => r.what))];
    const learn = learnGate(repo, earlier, recs);
    if (!findings.length && !waivers.length && learn.holds) return null;
    return { run: earlier.id, findings, waivers, ...(learn.holds ? {} : { learn: learn.why }) };
  } catch (e) {
    return { run: earlier.id, error: String(e.message || e).split('\n')[0] };
  }
}

export function leftBehind(repo, branch, run) {
  if (!branch) return [];
  const logged = readDecisions(repo).map((d) => String(d.what)).filter((w) => w.startsWith('left behind by '));
  const isLogged = (id) => logged.some((w) => w === `left behind by ${id}` || w.startsWith(`left behind by ${id}:`));
  return endedRuns(repo)
    .filter((r) => r.id !== run.id && r.branches?.includes(branch) && r.endedAt < run.started && !isLogged(r.id))
    .map((r) => leftBy(repo, r)).filter(Boolean);
}

const one = (l) => (l.error ? `could not read run ${l.run}: ${l.error}`
  : `run ${l.run} left ${[l.findings.length && `findings ${l.findings.map((f) => `${f.id} ${f.state}`).join(', ')}`, l.waivers.length && `waivers ${l.waivers.join(', ')}`, l.learn && `learn: ${l.learn}`].filter(Boolean).join('; ')}`);

export function leftText(repo, branches, run) {
  const rows = new Map();
  for (const b of branches || []) for (const l of leftBehind(repo, b, run)) rows.set(l.run, l);
  if (!rows.size) return '';
  return `Earlier runs on this branch left: ${[...rows.values()].map(one).join(' | ')}. Once read, log each with \`lpk decide "left behind by <run id>: <why>" --why "<why>"\``;
}
