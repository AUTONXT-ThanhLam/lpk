// `lpk verify`: runs the run's checks in place and records the working-tree id they ran on.
import { parseArgs, repoOf } from '../out.mjs';
import { verify } from '../verify.mjs';

const USAGE = 'usage: lpk verify [--final] [--only <check number or exact command>]... [--parallel] [--repo <dir>] [--timeout <s>]';
const mark = (x) => (x.exit === 0 ? 'ok  ' : x.exit === 'not run' || x.exit === 'stopped' ? 'skip' : 'FAIL');

function line(x) {
  if (x.reused) return `${mark(x)} \`${x.cmd}\` green earlier on this tree, not run again`;
  const head = `${mark(x)} \`${x.cmd}\` ${x.exit === 0 || mark(x) === 'FAIL' ? `exit ${x.exit} in ${Math.round(x.ms / 1000)}s` : x.exit}`;
  if (mark(x) !== 'FAIL') return head;
  const tail = x.tail.split('\n').map((l) => `  | ${l}`).join('\n');
  return `${head}\n${tail}${x.log ? `\n  full log (last 1 MiB of output): ${x.log}` : ''}`;
}

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--timeout', '--only'], ['--parallel', '--final']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\n${USAGE}`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  const timeout = a.opt('--timeout') === undefined ? undefined : Number(a.opt('--timeout'));
  if (timeout !== undefined && !(timeout > 0)) { console.error(`lpk: --timeout takes a number of seconds above 0\n${USAGE}`); return 2; }
  const r = repo ? await verify(repo, { only: a.all('--only'), parallel: a.flags.has('--parallel'), final: a.flags.has('--final'), timeout }) : { error: 'not inside a git repository' };
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  for (const x of r.verified.results) console.log(line(x));
  if (r.changedDuring.length) console.log(`Files changed while the checks ran (${r.changedDuring.slice(0, 5).join(', ')}): an edit landed, or a check rewrote code, so this result counts for nothing. Run it again on a still tree.`);
  if (r.untracked.length) console.log(`Untracked code files in this tree: ${r.untracked.slice(0, 10).join(', ')}. Add them or ignore them before handover; a tree with code left untracked never matches what is committed.`);
  const skipped = r.verified.results.some((x) => mark(x) === 'skip');
  if (r.partial) console.log(`${r.verified.green ? 'green' : 'NOT green'} for the checks named by --only; this counts for nothing at the commit gate. The full \`lpk verify${r.final ? ' --final' : ''}\` is still owed: run it once, on the tree you commit${r.final ? '' : '; it runs only the checks not green on that tree'}.`);
  else console.log(r.verified.green ? `verified${r.final ? ' (final checks)' : ''}: green on tree ${r.verified.id.slice(0, 12)}` : `verified: NOT green${skipped ? ' (stopped at the first red check; the rest did not run)' : ''}`);
  if (r.finalOwed) console.log('The final checks are still owed: run `lpk verify --final` on the committed tree, in the review worktree, before delivery.');
  return r.verified.green ? 0 : 1;
}
