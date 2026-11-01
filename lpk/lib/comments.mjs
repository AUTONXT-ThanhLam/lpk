import { allCandidates } from './ast.mjs';
import { git } from './git.mjs';
import { changeOf, loadRules } from './rules.mjs';
import { writeRun } from './run.mjs';

export const COMMENT_ID = /^no-comments(\.|$)/;
const SHOW = 15;
const keyOf = (c) => `${c.id}|${c.path}|${c.text.trim()}`;

export function commentsAtCommit(repo, run, base) {
  const staged = git(['diff', '--cached', '--name-only'], repo).split('\n').filter(Boolean);
  const found = allCandidates(repo, loadRules(repo), changeOf(repo, base), staged.length ? staged : undefined).cands.filter((c) => COMMENT_ID.test(c.id));
  const told = new Set(run.commentsTold);
  const fresh = found.filter((c) => !told.has(keyOf(c)));
  if (!fresh.length) return '';
  run.commentsTold = [...told, ...fresh.map(keyOf)];
  writeRun(run);
  return [
    'lpk: commit refused once, the lines it adds hold comments (the no-comments rule). Remove them, or commit again if one is right:',
    ...fresh.slice(0, SHOW).map((c) => `- ${c.id}  ${c.path}:${c.n}  ${c.text.trim().slice(0, 160)}`),
    ...(fresh.length > SHOW ? [`${fresh.length - SHOW} more: run lpk check`] : []),
  ].join('\n');
}
