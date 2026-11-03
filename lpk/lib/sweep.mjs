import { git } from './git.mjs';
import { baseOf } from './out.mjs';

const lines = (out) => out.split('\n').filter(Boolean);

function hitsAt(repo, rev, pattern, files) {
  if (!files.length) return [];
  return lines(git(['--literal-pathspecs', 'grep', '-z', '-n', '-I', '-E', '-e', pattern, rev, '--', ...files], repo)).flatMap((l) => {
    const [head, num = ''] = l.split('\0');
    const n = num.match(/^\d+$/);
    return n ? [{ path: head.slice(rev.length + 1), line: Number(n[0]) }] : [];
  });
}

function writtenByChange(repo, sha, hit, ours) {
  const out = git(['blame', '--porcelain', '-L', `${hit.line},${hit.line}`, sha, '--', hit.path], repo);
  return ours.has(out.slice(0, 40));
}

export function sweepOf(repo, finding, sha, pattern) {
  const text = typeof pattern === 'string' ? pattern.trim() : '';
  if (!text) {
    return { error: `sweep: a git grep -E pattern for the class of defect ${finding.id} is (the form of the defect, not of its fix). lpk runs it over the files the change touches: it must hit before the fix and nowhere on the lines the change adds after it` };
  }
  const base = baseOf(repo);
  if (!base) return { error: 'sweep: no run target and no default branch to take the change from' };
  const files = git(['diff', '--name-only', '--no-renames', '-z', base, sha], repo).split('\0').filter(Boolean);
  const before = hitsAt(repo, `${sha}^`, text, files);
  if (!before.length) return { error: `sweep: no hit before the fix, in ${files.length} file(s) of the change, for ${text} (an invalid extended regex also hits nothing): a pattern that finds nothing before the fix proves nothing about its class` };
  const ours = new Set(lines(git(['rev-list', `${base}..${sha}`], repo)));
  const after = hitsAt(repo, sha, text, files);
  const written = after.map((h) => writtenByChange(repo, sha, h, ours));
  const left = after.filter((h, i) => written[i]).map((h) => `${h.path}:${h.line}`);
  if (left.length) return { error: `sweep: ${left.length} more place(s) of the same class are on lines this change adds, fix them in the same commit: ${left.slice(0, 12).join(', ')}${left.length > 12 ? ` and ${left.length - 12} more` : ''}` };
  return { sweep: { pattern: text, before: before.length, preexisting: after.filter((h, i) => !written[i]).map((h) => `${h.path}:${h.line}`).slice(0, 12) } };
}
