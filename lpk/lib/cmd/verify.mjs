// `lpk verify`: runs the run's checks in place and records the working-tree id they ran on.
import { parseArgs, repoOf } from '../out.mjs';
import { verify } from '../verify.mjs';

export function main(argv) {
  const a = parseArgs(argv, ['--repo', '--timeout']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk verify [--repo <dir>] [--timeout <s>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  const r = repo ? verify(repo, Number(a.opt('--timeout') || 1200)) : { error: 'not inside a git repository' };
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  for (const x of r.verified.results) console.log(`${x.exit === 0 ? 'ok  ' : 'FAIL'} \`${x.cmd}\` exit ${x.exit} in ${Math.round(x.ms / 1000)}s${x.exit === 0 ? '' : `\n${x.tail.split('\n').map((l) => `  | ${l}`).join('\n')}`}`);
  if (r.changedDuring.length) console.log(`Files changed while the checks ran (${r.changedDuring.slice(0, 5).join(', ')}): an edit landed, or a check rewrote code, so this result counts for nothing. Run it again on a still tree.`);
  if (r.untracked.length) console.log(`Untracked code files in this tree: ${r.untracked.slice(0, 10).join(', ')}. Add them or ignore them before handover; a tree with code left untracked never matches what is committed.`);
  console.log(r.verified.green ? `verified: green on tree ${r.verified.id.slice(0, 12)}` : 'verified: NOT green');
  return r.verified.green ? 0 : 1;
}
