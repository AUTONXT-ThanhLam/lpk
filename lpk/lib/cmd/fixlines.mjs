// `lpk fixlines [<fix commit>]`: the lines a fix commit changes that an earlier commit of the same
// run wrote. A fix on the run's own earlier lines is a fix on a fix; a confirmed finding there means
// revert or redesign, never a third patch. Exact facts from `git diff` and `git blame`.
import { git } from '../git.mjs';
import { baseOf, capped, parseArgs, repoOf } from '../out.mjs';

const USAGE = 'usage: lpk fixlines [<fix commit>] [--base <ref>] [--repo <dir>]';

// Each hunk of the fix: the file before it, the old lines it replaces (a pure insertion counts the
// lines on either side of it) and the new lines it writes.
export function fixHunks(repo, fix) {
  const out = [];
  let path = '';
  for (const l of git(['diff', '-U0', '--no-color', '--find-renames', `${fix}^`, fix], repo).split('\n')) {
    if (l.startsWith('--- ')) path = l === '--- /dev/null' ? '' : l.slice(6);
    const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!m || !path) continue;
    const [a, b, c, d] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    const old = b > 0 ? [a, a + b - 1] : [Math.max(1, a), a + 1];
    out.push({ path, old, insertion: b === 0, fresh: d > 0 ? [c, c + d - 1] : null });
  }
  return out;
}

// The commit that last wrote each old line of the range, from `git blame` on the fix's parent.
function blame(repo, rev, path, [from, to]) {
  const shas = [];
  let raw = git(['blame', '--porcelain', '-L', `${from},${to}`, rev, '--', path], repo);
  // An insertion after the last line has no line below it.
  if (!raw && to > from) raw = git(['blame', '--porcelain', '-L', `${from},${to - 1}`, rev, '--', path], repo);
  for (const l of raw.split('\n')) {
    const m = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (m) shas.push({ sha: m[1], line: Number(m[2]) });
  }
  return shas;
}

export function fixLines(repo, fix, base) {
  const ours = new Set(git(['rev-list', `${base}..${fix}^`], repo).split('\n').filter(Boolean));
  const rows = [];
  for (const h of fixHunks(repo, fix)) {
    const hits = blame(repo, `${fix}^`, h.path, h.old).filter((x) => ours.has(x.sha));
    const bySha = new Map();
    for (const x of hits) bySha.set(x.sha, [...(bySha.get(x.sha) || []), x.line]);
    for (const [sha, lines] of bySha) rows.push({ path: h.path, lines, sha, insertion: h.insertion, fresh: h.fresh });
  }
  return { ours: ours.size, rows };
}

const span = (ls) => (ls.length === 1 ? `${ls[0]}` : `${Math.min(...ls)}-${Math.max(...ls)}`);
const subject = (repo, sha) => git(['log', '-1', '--format=%s', sha], repo).trim();

export async function main(argv) {
  const a = parseArgs(argv, ['--base', '--repo']);
  if (a.error || a.words.length > 1) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const fix = git(['rev-parse', '--verify', '--quiet', `${a.words[0] || 'HEAD'}^{commit}`], repo).trim();
  if (!fix) { console.error(`lpk: no commit ${a.words[0]}`); return 2; }
  if (!git(['rev-parse', '--verify', '--quiet', `${fix}^`], repo).trim()) { console.error('lpk: the fix commit has no parent'); return 2; }
  const base = baseOf(repo, a.opt('--base'));
  if (!base) { console.error('lpk: no --base given, no run target and no default branch found'); return 2; }
  const r = fixLines(repo, fix, base);
  const head = [`fix ${fix.slice(0, 12)} "${subject(repo, fix)}"; ${r.ours} earlier commit(s) of this change since ${base.slice(0, 12)}`];
  if (!r.rows.length) { console.log([...head, 'none of the lines this fix changes were written by an earlier commit of this change'].join('\n')); return 0; }
  head.push(`${r.rows.length} place(s) where this fix changes lines an earlier commit of this change wrote:`);
  const rows = r.rows.map((x) => `  ${x.path}:${span(x.lines)} ${x.insertion ? '(inserted next to)' : '(changed)'} written by ${x.sha.slice(0, 12)} "${subject(repo, x.sha)}"${x.fresh ? `; the fix writes ${x.path}:${span(x.fresh)}` : ''}`);
  console.log(capped(repo, `fixlines-${fix.slice(0, 12)}`, head, rows));
  return 0;
}
