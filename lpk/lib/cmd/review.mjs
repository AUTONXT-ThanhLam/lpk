// `lpk review start <from>..<to>`: names the range under review before the review workflow starts
// (the whole change, a fix delta, or one rebased commit pair). The finding hook stamps it on every
// finding raised from then on, `lpk code-review` reviews it, and the gates match each lens's
// first prompt against it.
import { resolveRange } from '../codereview.mjs';
import { git } from '../git.mjs';
import { parseArgs, repoOf } from '../out.mjs';
import { appendRecord } from '../records.mjs';
import { update } from '../run.mjs';

const USAGE = 'usage: lpk review start <from>..<to> [--repo <dir>]';

export function main(argv) {
  const a = parseArgs(argv, ['--repo']);
  if (a.error || a.words[0] !== 'start' || a.words.length !== 2) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const r = resolveRange(repo, a.words[1]);
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  let before = '';
  const u = update(repo, (run) => { before = run.reviewRange || ''; run.reviewRange = r.range; });
  if (u.error) { console.error(`lpk: ${u.error}; a review belongs to a run (lpk run start)`); return 1; }
  const replaced = before && before !== r.range ? before : '';
  appendRecord(repo, { kind: 'review-start', range: r.range, tree: git(['rev-parse', `${r.b}^{tree}`], repo).trim(), exit: 0, ...(replaced ? { replaced } : {}) });
  // The whole ids: lens prompts and `lpk code-review` name the range exactly as printed here.
  console.log(`reviewing ${r.range} (${git(['rev-list', '--count', r.range], repo).trim()} commit(s))${replaced ? `; replaces ${replaced}` : ''}`);
  return 0;
}
