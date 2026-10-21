// `lpk gates`: every delivery gate of the run on this checkout, with what it read and the way out.
// Exit 0 when every gate that can deny holds.
import { failing, gates, gatesText } from '../gates.mjs';
import { git } from '../git.mjs';
import { parseArgs, repoOf } from '../out.mjs';
import { currentBranch, runForBranch, runState } from '../run.mjs';

// The run this checkout delivers: the run the push and ready guard judges on the current branch,
// else (on the target branch or a detached HEAD) the open run.
export function runHere(repo) {
  const st = runState(repo);
  if (st.error) throw new Error(st.error);
  return runForBranch(repo, currentBranch(repo)) || st.run;
}

export async function main(argv) {
  const a = parseArgs(argv, ['--repo'], ['--json']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk gates [--repo <dir>] [--json]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  let run;
  try { run = runHere(repo); } catch (e) { console.error(`lpk: ${e.message}`); return 1; }
  if (!run) { console.error('lpk: no lpk run delivers this branch'); return 1; }
  const rows = await gates(repo, run);
  console.log(a.flags.has('--json') ? JSON.stringify(rows, null, 1) : `run ${run.id}, ${run.lane} lane, HEAD ${git(['rev-parse', '--short=12', 'HEAD'], repo).trim()}\n${gatesText(rows)}`);
  return failing(rows).length ? 1 : 0;
}
