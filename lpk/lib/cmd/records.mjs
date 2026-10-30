import { KINDS, readRecords } from '../records.mjs';
import { parseArgs, repoOf } from '../out.mjs';
import { readRun } from '../run.mjs';

const USAGE = `usage: lpk records [--kind <kind>] [--run <id> | --all] [--repo <dir>]\n  prints the run's records, one JSON line each (kinds: ${KINDS.join(', ')}); the open run's by default`;

export function main(argv) {
  const a = parseArgs(argv, ['--kind', '--run', '--repo'], ['--all']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || `unknown argument ${a.words[0]}`}\n${USAGE}`); return 2; }
  const empty = ['--kind', '--run', '--repo'].find((k) => a.opt(k) === '');
  if (empty) { console.error(`lpk: ${empty} needs a value\n${USAGE}`); return 2; }
  const kind = a.opt('--kind');
  if (kind && !KINDS.includes(kind)) { console.error(`lpk: --kind ${kind} is not one of ${KINDS.join(', ')}\n${USAGE}`); return 2; }
  const all = a.flags.has('--all');
  const given = a.opt('--run');
  if (all && given !== undefined) { console.error(`lpk: --all and --run exclude each other\n${USAGE}`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const run = all ? undefined : given ?? readRun(repo)?.id;
  if (!all && !run) { console.error(`lpk: no open run here; give --run <id> or --all\n${USAGE}`); return 2; }
  for (const r of readRecords(repo, { run }).filter((x) => !kind || x.kind === kind)) console.log(JSON.stringify(r));
  return 0;
}
