// `lpk floor`: the exact facts of the change that owe the full-lane net, and the facts that owe each
// conditional lens (mutant, regression, claims, designer, a11y, perf). What is owed is decided by
// `lpk reviews owed` from these facts; this verb only prints them.
import { floor } from '../floor.mjs';
import { baseOf, capped, parseArgs, repoOf } from '../out.mjs';

const USAGE = 'usage: lpk floor [--base <ref>] [--repo <dir>] [--json]';

export async function main(argv) {
  const a = parseArgs(argv, ['--base', '--repo'], ['--json']);
  if (a.error || a.words.length) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const base = baseOf(repo, a.opt('--base'));
  if (!base) { console.error('lpk: no --base given, no run target and no default branch found'); return 2; }
  const f = floor(repo, base);
  if (a.flags.has('--json')) { console.log(JSON.stringify({ base, ...f })); return 0; }
  const head = [
    `change from ${base.slice(0, 12)} to the working tree: ${f.files.length} file(s)`,
    f.full ? 'floor: FULL — these facts owe the full-lane net:' : 'floor: none of the full-lane facts (more than 3 files, auth marker, credential path, SENSITIVE.md glob, migration, manifest) is in the diff',
  ];
  const lenses = f.lenses.length ? f.lenses.map((k) => `  lens ${k}: ${f.lensWhy[k]}`) : ['  no conditional lens is owed by these facts'];
  console.log(capped(repo, 'floor', head, [...f.why.map((w) => `  ${w}`), 'lenses the facts call for:', ...lenses]));
  return 0;
}
