// `lpk verify`: runs the run's checks in place and records the working-tree id they ran on.
import { parseArgs, repoOf } from '../out.mjs';
import { verify } from '../verify.mjs';

const USAGE = 'usage: lpk verify [--only <check number or exact command>]... [--parallel] [--repo <dir>] [--timeout <s>]';
const mark = (x) => (x.exit === 0 ? 'ok  ' : x.exit === 'not run' || x.exit === 'stopped' ? 'skip' : 'FAIL');

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--timeout', '--only'], ['--parallel']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\n${USAGE}`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  const r = repo ? await verify(repo, Number(a.opt('--timeout') || 1200), { only: a.all('--only'), parallel: a.flags.has('--parallel') }) : { error: 'not inside a git repository' };
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  for (const x of r.verified.results) console.log(`${mark(x)} \`${x.cmd}\` ${x.exit === 0 || mark(x) === 'FAIL' ? `exit ${x.exit} in ${Math.round(x.ms / 1000)}s` : x.exit}${mark(x) === 'FAIL' ? `\n${x.tail.split('\n').map((l) => `  | ${l}`).join('\n')}` : ''}`);
  if (r.changedDuring.length) console.log(`Files changed while the checks ran (${r.changedDuring.slice(0, 5).join(', ')}): an edit landed, or a check rewrote code, so this result counts for nothing. Run it again on a still tree.`);
  if (r.untracked.length) console.log(`Untracked code files in this tree: ${r.untracked.slice(0, 10).join(', ')}. Add them or ignore them before handover; a tree with code left untracked never matches what is committed.`);
  const skipped = r.verified.results.some((x) => mark(x) === 'skip');
  if (r.partial) console.log(`${r.verified.green ? 'green' : 'NOT green'} for the checks named by --only; this counts for nothing at the commit gate. Run \`lpk verify\` once, on the tree you commit.`);
  else console.log(r.verified.green ? `verified: green on tree ${r.verified.id.slice(0, 12)}` : `verified: NOT green${skipped ? ' (stopped at the first red check; the rest did not run)' : ''}`);
  return r.verified.green ? 0 : 1;
}
