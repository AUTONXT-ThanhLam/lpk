// `lpk finding list|get|verdict|fixed|counts`: the run's findings ledger from a shell. A ruling or a
// closure made here is recorded as by `cli`: the CLI cannot tell which agent ran it, so a drop,
// pre-existing, duplicate or verifier closure made here waits for the owner.
import { resolve } from 'node:path';
import { counts, findingsText, getFinding, markFixed, readLedger, ruleOn } from '../findings.mjs';
import { top } from '../git.mjs';

const USAGE = `usage:
  lpk finding list [--state <state>] [--repo <dir>]
  lpk finding get <id> [--repo <dir>]
  lpk finding verdict <id> <confirmed|preexisting|dropped|duplicate|unsettled> --evidence "<why>" [--basis not-reproduced|disproved] [--primary <id>] [--repo <dir>]
  lpk finding fixed <id> --commit <sha> --closed-by <repro|test|verifier> --evidence "<output>" [--fix "<how>"] [--repo <dir>]
  lpk finding counts [--repo <dir>]`;

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
      console.log(`${findingsText(findings, { state: opt('--state') })}\n${file}`);
      return 0;
    }
    if (sub === 'counts') { console.log(JSON.stringify(counts(readLedger(repo).findings))); return 0; }
    if (sub === 'get' && id) {
      const f = getFinding(repo, id);
      if (!f) { console.error(`lpk: no finding ${id}`); return 1; }
      console.log(JSON.stringify(f, null, 1));
      return 0;
    }
    if (sub === 'verdict' && id) {
      const r = ruleOn(repo, { id, verdict: argv[2], evidence: opt('--evidence'), basis: opt('--basis'), primary: opt('--primary'), by: 'cli' });
      return done(r, (f) => `${f.id} is ${f.state}${f.asked ? ` (asked ${f.asked}; in a protected area it stays unsettled, for the owner to read)` : ''}: ${f.evidence}`);
    }
    if (sub === 'fixed' && id) {
      const r = markFixed(repo, { id, commit: opt('--commit'), closedBy: opt('--closed-by'), evidence: opt('--evidence'), fix: opt('--fix'), by: 'cli' });
      return done(r, (f) => `${f.id} fixed in ${f.fixedCommit} (${f.closedBy}).`);
    }
  } catch (e) {
    console.error(`lpk: ${e.message}`);
    return 2;
  }
  console.error(USAGE);
  return 2;
}
