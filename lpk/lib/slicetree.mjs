import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { runDir } from './run.mjs';

export const treeRoot = (repo, run) => join(runDir(repo), 'wt', run.id);
export const treeOf = (repo, run, name) => join(treeRoot(repo, run), name);

export function cleanTrees(repo, run) {
  const root = treeRoot(repo, run);
  const gone = [];
  const kept = [];
  if (!existsSync(root)) return { gone, kept };
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    const r = spawnSync('git', ['worktree', 'remove', dir], { cwd: repo, stdio: 'ignore' });
    (r.status === 0 ? gone : kept).push(dir);
  }
  git(['worktree', 'prune'], repo);
  if (!kept.length) rmdirSync(root);
  return { gone, kept };
}
