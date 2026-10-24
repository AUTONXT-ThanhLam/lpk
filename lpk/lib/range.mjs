// `a..b` with both ends resolved to full commit ids, or why it is not one. A ref name never holds
// `..` (git check-ref-format), so the first `..` splits the ends and dots inside them (`v1.2`,
// `release-1.2`) stay; an empty end is HEAD, as in git. `a...b` is the change b made since it left
// a: from their merge base to b, the diff `git diff a...b` shows.
import { git } from './git.mjs';

export function resolveRange(repo, range) {
  const text = String(range || '');
  const at = text.indexOf('..');
  if (at < 0 || /\s/.test(text)) return { error: `${range || '(none)'} is not a range <from>..<to>` };
  const three = text[at + 2] === '.';
  const ends = [text.slice(0, at) || 'HEAD', text.slice(at + (three ? 3 : 2)) || 'HEAD'];
  const sha = (ref) => git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], repo).trim();
  const [from, b] = ends.map(sha);
  if (!from || !b) return { error: `${!from ? ends[0] : ends[1]} is not a commit in ${repo}` };
  const a = three ? git(['merge-base', from, b], repo).trim() : from;
  if (!a) return { error: `${ends[0]} and ${ends[1]} have no merge base` };
  if (a === b) return { error: `${range} is empty: both ends are ${a.slice(0, 12)}` };
  return { a, b, range: `${a}..${b}` };
}
