// `lpk learn [--rule <id>]...`: records that lpk:learn ran on this run, covering every confirmed,
// fixed or deferred finding in its ledger now, and the rules it saved. A rule id must be one lpk loads.
import { learnable } from '../learn.mjs';
import { parseArgs, repoOf } from '../out.mjs';
import { appendRecord } from '../records.mjs';
import { loadRules } from '../rules.mjs';
import { readRun } from '../run.mjs';

export function main(argv) {
  const a = parseArgs(argv, ['--rule', '--repo']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk learn [--rule <id>]... [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const run = readRun(repo);
  if (!run) { console.error('lpk: no lpk run delivers this branch'); return 1; }
  const known = new Set(loadRules(repo).map((r) => r.id));
  const unknown = a.all('--rule').filter((id) => !known.has(id));
  if (unknown.length) { console.error(`lpk: no loaded rule ${unknown.join(', ')} (\`lpk rules --all\` lists them); save the rule first`); return 2; }
  const reviewed = learnable(repo, run);
  appendRecord(repo, { kind: 'learn', reviewed, rules: a.all('--rule') });
  console.log(`learned from ${reviewed.length} finding(s); rules saved: ${a.all('--rule').join(', ') || 'none'}`);
  return 0;
}
