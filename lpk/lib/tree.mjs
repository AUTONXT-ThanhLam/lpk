// The tree a run verifies and hands over, as git object ids. The working-tree id is every tracked
// file as it stands (a staged new file is tracked) plus the untracked files that are code; other
// untracked files (build info, stamps, logs a check writes) never count. A committed change that
// left no code file behind untracked has HEAD^{tree} equal to the id `lpk verify` recorded, so the
// commit gate and the delivery gate compare the same thing.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from './git.mjs';
import { CODE, TEST } from './rules.mjs';

// Digests of the code files among `blob<TAB>path` lines: `source` for non-test code, `code` for
// all code including tests.
function digests(entries) {
  const code = entries.filter((e) => CODE.test(e.split('\t')[1] || ''));
  const hash = (xs) => createHash('sha1').update(xs.join('\n')).digest('hex');
  return { source: hash(code.filter((e) => !TEST.test(e.split('\t')[1]))), code: hash(code) };
}

// Untracked, not ignored files whose names are code.
export function untrackedCode(repo) {
  return git(['ls-files', '--others', '--exclude-standard', '-z'], repo).split('\0').filter((p) => p && CODE.test(p));
}

// The working-tree id without touching the real index: `id` (also as `tree`, the name the hooks
// read), the digests, and the untracked code files it took in.
export function treeOf(repo) {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-tree-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  const run = (args, input) => spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: repo, env, input, encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    run(['read-tree', 'HEAD']);
    run(['add', '-u']);
    // A new file staged but not yet committed is tracked, and goes into the commit like the rest.
    const staged = git(['diff', '--cached', '--name-only', '--diff-filter=A', '-z'], repo).split('\0').filter((p) => p && existsSync(join(repo, p)));
    const untracked = untrackedCode(repo);
    const add = [...staged, ...untracked];
    if (add.length) run(['add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], `${add.join('\0')}\0`);
    const entries = run(['ls-files', '-s']).stdout.split('\n').filter(Boolean).map((l) => { const [meta, p] = l.split('\t'); return `${meta.split(' ')[1]}\t${p}`; });
    const id = run(['write-tree']).stdout.trim();
    return { id, tree: id, ...digests(entries), untracked };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export const headTree = (repo, ref = 'HEAD') => git(['rev-parse', '--verify', '--quiet', `${ref}^{tree}`], repo).trim();

// The same digests for a commit, to compare what a push publishes with what was verified.
export function codeOfCommit(repo, ref) {
  const out = spawnSync('git', ['-c', 'core.quotepath=off', 'ls-tree', '-r', ref], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  return digests(out.split('\n').filter(Boolean).map((l) => { const [meta, p] = l.split('\t'); return `${meta.split(' ')[2]}\t${p}`; }));
}
