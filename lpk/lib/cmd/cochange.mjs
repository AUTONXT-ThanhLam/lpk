// `lpk cochange [<file>...]`: for each file, the files that changed with it in the repo's history
// (named when this change leaves them alone), the fix, revert and hotfix commits on the lines this
// change touches, and the dependency lines this change moves. Counts from `git log`; whether a
// co-changed file needs changing too is the agent's call.
import { diffLines, MANIFEST } from '../floor.mjs';
import { git } from '../git.mjs';
import { baseOf, capped, parseArgs, repoOf } from '../out.mjs';

const USAGE = 'usage: lpk cochange [<file>...] [--base <ref>] [--commits <n>] [--repo <dir>]';
// A commit subject that names a fix, a revert or a hotfix (a fixed list).
const FIX = /^(fix|hotfix|revert|bugfix)\b|^Revert "|\bfix(es|ed)?\b|\bhotfix\b/i;

// The last `n` commits of HEAD's history, each with the files it touched.
function history(repo, n) {
  const out = [];
  for (const block of git(['log', '-n', String(n), '--no-merges', '--name-only', '--format=%x01%H'], repo).split('\x01').filter(Boolean)) {
    const [sha, ...files] = block.split('\n').map((x) => x.trim()).filter(Boolean);
    out.push({ sha, files });
  }
  return out;
}

// The base-side line ranges of this change's hunks in one file.
function hunksOf(repo, base, path) {
  const out = [];
  for (const m of git(['diff', '-U0', '--no-color', base, '--', path], repo).matchAll(/^@@ -(\d+)(?:,(\d+))?/gm)) {
    const a = Number(m[1]), b = m[2] === undefined ? 1 : Number(m[2]);
    out.push(b > 0 ? [a, a + b - 1] : [Math.max(1, a), Math.max(1, a)]);
  }
  return out;
}

export function cochange(repo, base, files, n = 400) {
  const hist = history(repo, n);
  const named = new Set(files);
  return files.map((path) => {
    const mine = hist.filter((c) => c.files.includes(path));
    const counts = new Map();
    for (const c of mine) for (const f of c.files) if (f !== path) counts.set(f, (counts.get(f) || 0) + 1);
    const partners = [...counts].filter(([, k]) => k >= 2).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 8)
      .map(([f, k]) => ({ path: f, together: k, inChange: named.has(f) }));
    const fixes = new Map();
    for (const [a, b] of hunksOf(repo, base, path).slice(0, 10))
      for (const l of git(['log', '-s', '--format=%h%x00%s', '-L', `${a},${b}:${path}`, base], repo).split('\n').filter(Boolean)) {
        const [sha, subject] = l.split('\0');
        if (FIX.test(subject || '')) fixes.set(sha, subject);
      }
    return { path, commits: mine.length, partners, fixes: [...fixes].map(([sha, subject]) => ({ sha, subject })) };
  });
}

export async function main(argv) {
  const a = parseArgs(argv, ['--base', '--repo', '--commits']);
  if (a.error) { console.error(`lpk: ${a.error}\n${USAGE}`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const base = baseOf(repo, a.opt('--base'));
  if (!base) { console.error('lpk: no --base given, no run target and no default branch found'); return 2; }
  const n = Number(a.opt('--commits') || 400);
  if (!Number.isInteger(n) || n < 1) { console.error(`lpk: --commits takes a whole number\n${USAGE}`); return 2; }
  const changed = diffLines(repo, base);
  const files = a.words.length ? a.words : changed.map((f) => f.path);
  if (!files.length) { console.log(`no files named and no change from ${base.slice(0, 12)}`); return 0; }
  const rows = [];
  for (const r of cochange(repo, base, files, n)) {
    rows.push(`${r.path}: in ${r.commits} of the last ${n} commits`);
    for (const p of r.partners) rows.push(`  changed together ${p.together}x: ${p.path}${p.inChange ? '' : '  (not in this change)'}`);
    for (const x of r.fixes) rows.push(`  fix on these lines: ${x.sha} ${x.subject}`);
  }
  const deps = changed.filter((f) => MANIFEST.test(f.path)).flatMap((f) => f.lines.filter((l) => l.text.trim()).map((l) => `  ${f.path}:${l.n} ${l.side} ${l.text.trim().slice(0, 160)}`));
  if (deps.length) rows.push('dependency lines this change moves:', ...deps);
  console.log(capped(repo, 'cochange', [`co-change facts from the last ${n} commits of HEAD; change from ${base.slice(0, 12)}`], rows));
  return 0;
}
