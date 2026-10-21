// `lpk reviews owed`: the lenses the run still owes, per range, and why. `lpk reviews fetch`: the
// tech lead's past review comments from GitHub (lib/reviews.mjs).
import { owed } from '../owed.mjs';
import { capped, parseArgs, repoOf } from '../out.mjs';
import { fetchReviews } from '../reviews.mjs';
import { runHere } from './gates.mjs';

const USAGE = 'usage: lpk reviews owed [--repo <dir>] [--json]  |  lpk reviews fetch --reviewer <login> [--repo <dir>]';

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--reviewer'], ['--json']);
  if (a.error) { console.error(`lpk: ${a.error}\n${USAGE}`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  if (a.words[0] === 'owed') {
    let run, rows;
    try { run = runHere(repo); if (run) rows = await owed(repo, run); } catch (e) { console.error(`lpk: ${e.message}`); return 1; }
    if (!run) { console.error('lpk: no lpk run delivers this branch'); return 1; }
    if (a.flags.has('--json')) console.log(JSON.stringify(rows, null, 1));
    else console.log(rows.length ? capped(repo, 'reviews-owed', [`owed in run ${run.id} (${run.lane} lane): ${rows.length}`], rows.map((r) => `- ${r.lens} on ${r.range}: ${r.why}`)) : `nothing owed in run ${run.id}: every lens of the ${run.lane} lane ran on every patch`);
    return rows.length ? 1 : 0;
  }
  const reviewer = a.opt('--reviewer') || process.env.LPK_REVIEWER;
  if (a.words[0] !== 'fetch' || !reviewer) { console.error(USAGE); return 2; }
  let r;
  try { r = fetchReviews(repo, reviewer); } catch (e) { r = { error: `gh failed (${e.code === 'ENOENT' ? 'not installed' : String(e.stderr || e.message).trim().split('\n')[0]}); install it and run \`gh auth login\`` }; }
  if (r.error) { console.error(`lpk: ${r.error}`); return 1; }
  console.log(`${r.fresh.length} new comments by ${reviewer} on ${r.slug}; ${r.total} stored in ${r.file}`);
  return 0;
}
