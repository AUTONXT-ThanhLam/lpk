// `lpk ci <pr>`: per failing CI job of the PR's head, whether it is also red on the target branch's
// latest run, red only here, or flipped on a rerun; recorded for the ci gate.
import { ciFacts } from '../ci.mjs';
import { capped, parseArgs, repoOf } from '../out.mjs';
import { appendRecord } from '../records.mjs';

const USAGE = 'usage: lpk ci <pr number or url> [--repo <dir>]';

export async function main(argv) {
  const a = parseArgs(argv, ['--repo']);
  if (a.error || a.words.length !== 1) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  let f;
  try { f = ciFacts(repo, a.words[0]); } catch (e) {
    console.error(`lpk: gh failed (${e.code === 'ENOENT' ? 'not installed' : String(e.stderr || e.message).trim().split('\n')[0]})`);
    return 1;
  }
  appendRecord(repo, { kind: 'ci', pr: f.pr, head: f.head, exit: f.jobs.some((j) => j.onlyHere) ? 1 : 0, jobs: f.jobs, pending: f.pending, at: new Date().toISOString() });
  const head = [
    `PR #${f.pr} head ${f.head.slice(0, 12)} into ${f.base}: ${f.runs} run(s), ${f.jobs.length} red or flipped job(s)${f.pending.length ? `; still running: ${f.pending.join(', ')} (run lpk ci again when they finish)` : ''}`,
  ];
  const rows = f.jobs.map((j) => `  ${j.workflow} / ${j.job}: ${j.verdict}${j.rerun ? `; to see if it flips: ${j.rerun}` : ''}`);
  console.log(capped(repo, `ci-${f.pr}`, head, rows.length ? rows : ['  no red job']));
  return 0;
}
