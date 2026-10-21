// The run's patches and which of them a reviewed range covers, as git sets. The patches are
// merge-base(target, HEAD)..HEAD, computed when asked. After a rebase the reviewed commits are no
// longer on the branch: `git range-diff` pairs each old commit with its new one, `=` when the
// patch is unchanged and `!` when it changed.
import { spawnSync } from 'node:child_process';
import { git } from './git.mjs';

const full = (repo, ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repo).trim();

export function patchesOf(repo, target, head = 'HEAD') {
  const base = git(['merge-base', target, head], repo).trim();
  if (!base) throw new Error(`no merge base between ${target} and ${head}`);
  return { base, head: full(repo, head), list: git(['rev-list', '--reverse', `${base}..${head}`], repo).split('\n').filter(Boolean) };
}

// The commits a range names: `a..b` is what b has and a lacks, a single sha is that commit.
const cache = new Map();
export function commitsOf(repo, range) {
  const key = `${repo}\0${range}`;
  if (!cache.has(key)) {
    const [a, b] = range.split(/\.\.\.?/);
    cache.set(key, b === undefined ? [full(repo, a)].filter(Boolean)
      : git(['rev-list', `${a}..${b}`], repo).split('\n').filter(Boolean));
  }
  return cache.get(key);
}

// For each current patch that is not itself in a reviewed range, its old partner: Map new sha →
// { old, same }. Each reviewed range whose commits left the branch is paired once.
export function pairs(repo, { base, list }, ranges) {
  const now = new Set(list);
  const out = new Map();
  for (const range of new Set(ranges)) {
    const old = commitsOf(repo, range);
    if (!old.length || old.every((c) => now.has(c))) continue;
    const r = spawnSync('git', ['range-diff', '--no-color', range.includes('..') ? range : `${range}^..${range}`, `${base}..HEAD`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
    for (const l of (r.stdout || '').split('\n')) {
      const m = l.match(/^\s*\d+:\s+([0-9a-f]+) ([=!]) \s*\d+:\s+([0-9a-f]+)/);
      if (!m) continue;
      const n = full(repo, m[3]);
      if (!out.has(n) || out.get(n).same === false) out.set(n, { old: full(repo, m[1]), same: m[2] === '=' });
    }
  }
  return out;
}

// Contiguous runs of `shas` within the patch list, each as `<parent>..<last>`.
export function rangesOf({ base, list }, shas) {
  const want = new Set(shas);
  const out = [];
  let start = -1;
  for (let i = 0; i <= list.length; i++) {
    if (i < list.length && want.has(list[i])) { if (start < 0) start = i; continue; }
    if (start >= 0) out.push(`${(start ? list[start - 1] : base).slice(0, 12)}..${list[i - 1].slice(0, 12)}`);
    start = -1;
  }
  return out;
}

// Whether two commits carry the same change (`git patch-id --stable`); a commit with no diff matches none.
const patchId = (repo, sha) => spawnSync('git', ['patch-id', '--stable'], { cwd: repo, input: git(['show', '--format=', sha], repo), encoding: 'utf8' }).stdout.split(' ')[0];
export const samePatch = (repo, a, b) => { const id = patchId(repo, a); return Boolean(id) && id === patchId(repo, b); };

// Whether the commit changes any file matching `re`.
export const touches = (repo, sha, re) => git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha], repo).split('\n').some((p) => p && re.test(p));
