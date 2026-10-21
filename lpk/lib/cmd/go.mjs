// `lpk go`: records, when the owner says go, the checks the run then names, so `lpk gates` can print
// that the checks changed after go.
import { parseArgs, repoOf } from '../out.mjs';
import { appendRecord } from '../records.mjs';
import { readRun } from '../run.mjs';

export function main(argv) {
  const a = parseArgs(argv, ['--repo']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk go [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  const run = repo && readRun(repo);
  if (!run) { console.error('lpk: no lpk run in this repo'); return 1; }
  appendRecord(repo, { kind: 'go', run: run.id, verify: run.verify, scenarios: run.scenarios.map((s) => s.id), exit: 0 });
  console.log(`go recorded for run ${run.id}; checks: ${run.verify.map((c) => `\`${c}\``).join(', ')}`);
  return 0;
}
