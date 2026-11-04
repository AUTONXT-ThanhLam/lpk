// `lpk finding list|get|verdict|fixed|counts`: the run's findings ledger from a shell. A ruling or a
// closure made here is recorded as by `cli`: the CLI cannot tell which agent ran it, so a drop,
// pre-existing, duplicate or verifier closure made here is listed for the owner to read.
import { resolve } from 'node:path';
import { counts, findingsText, getFinding, markFixed, readLedger, ruleOn, STATES, stateOf } from '../findings.mjs';
import { top } from '../git.mjs';

const USAGE = `usage:
  lpk finding list [--state <state>] [--json] [--repo <dir>]
  lpk finding get <id> [--repo <dir>]
  lpk finding verdict <id> <confirmed|preexisting|dropped|duplicate|unsettled> --evidence "<why>" [--born request|design|build|fix --cause "<why it exists>" --reach user|merge|neither] [--area security|auth|data|concurrency|migration|permissions] [--basis not-reproduced|disproved] [--primary <id>] [--repo <dir>]
  lpk finding fixed <id> --commit <sha> --closed-by <repro|test|verifier> --evidence "<output>" --sweep "<git grep -E pattern of the defect form>" [--fix "<how>"] [--repo <dir>]
  lpk finding fixed <id> --commit <sha> --closed-by mutant --evidence "<lpk mutate --patch output on the fix>" [--fix "<how>"] [--repo <dir>]   (a test gap)
  lpk finding fixed <id> --closed-by defer --evidence "<the lead's reason it waits>" [--repo <dir>]
  lpk finding defer <id>... --why "<the lead's reason they wait>" [--repo <dir>]
  lpk finding counts [--repo <dir>]`;

const VALUED = ['--why', '--repo'];

function deferMany(repo, argv, why) {
  const ids = argv.slice(1).filter((a, i, rest) => !VALUED.includes(a) && !VALUED.includes(rest[i - 1]));
  if (!ids.length || ids.some((a) => a.startsWith('--')) || !why?.trim() || VALUED.includes(why)) { console.error(USAGE); return 2; }
  const unknown = ids.filter((x) => !getFinding(repo, x));
  if (unknown.length) { for (const x of unknown) console.error(`lpk: no finding ${x}`); return 1; }
  let code = 0;
  for (const x of ids) {
    const f = getFinding(repo, x);
    if (f.state !== 'confirmed') { console.log(`${f.id} skipped: ${f.state}`); continue; }
    const r = markFixed(repo, { id: f.id, closedBy: 'defer', evidence: why, by: 'cli' });
    if (r.error) { console.error(`lpk: ${r.error}`); code = 1; } else console.log(closed(r.finding));
  }
  return code;
}

const closed = (f) => (f.state === 'deferred' ? `${f.id} deferred: ${f.deferEvidence}` : `${f.id} fixed in ${f.fixedCommit} (${f.closedBy}).`);

export async function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i < 0 ? undefined : argv[i + 1]; };
  const [sub, id] = argv;
  const repo = top(resolve(opt('--repo') || '.'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const done = (r, line) => {
    if (r.error) { console.error(`lpk: ${r.error}`); return 1; }
    console.log(line(r.finding));
    return 0;
  };
  try {
    if (sub === 'list') {
      const { findings, file } = readLedger(repo);
      const state = opt('--state');
      if (state !== undefined && !STATES.includes(state)) { console.error(`lpk: --state is one of ${STATES.join(', ')}\n${USAGE}`); return 2; }
      if (argv.includes('--json')) console.log(JSON.stringify(state ? findings.filter((f) => f.state === state || stateOf(f, findings) === state) : findings, null, 1));
      else console.log(`${findingsText(findings, { state })}\n${file}`);
      return 0;
    }
    if (sub === 'defer') return deferMany(repo, argv, opt('--why'));
    if (sub === 'counts') { console.log(JSON.stringify(counts(readLedger(repo).findings))); return 0; }
    if (sub === 'get' && id) {
      const f = getFinding(repo, id);
      if (!f) { console.error(`lpk: no finding ${id}`); return 1; }
      console.log(JSON.stringify(f, null, 1));
      return 0;
    }
    if (sub === 'verdict' && id) {
      const r = ruleOn(repo, { id, verdict: argv[2], evidence: opt('--evidence'), basis: opt('--basis'), primary: opt('--primary'), born: opt('--born'), cause: opt('--cause'), reach: opt('--reach'), area: opt('--area'), by: 'cli' });
      return done(r, (f) => `${f.id} is ${f.state}${f.asked ? ` (asked ${f.asked}; in a protected area it stays unsettled and blocks the findings gate until it is ruled or waived)` : ''}: ${f.evidence}`);
    }
    if (sub === 'fixed' && id) {
      const r = markFixed(repo, { id, commit: opt('--commit'), closedBy: opt('--closed-by'), evidence: opt('--evidence'), fix: opt('--fix'), sweep: opt('--sweep'), by: 'cli' });
      return done(r, closed);
    }
  } catch (e) {
    console.error(`lpk: ${e.message}`);
    return 2;
  }
  console.error(USAGE);
  return 2;
}
