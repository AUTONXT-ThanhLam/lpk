// Exact facts from git and the files in a checkout. No judgement lives here.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

// Paths come back unquoted (core.quotepath=off), so non-ASCII file names match the diff headers.
// Directories of vendored or generated code: never the change's own source.
export const VENDORED = /(^|\/)(node_modules|vendor|dist|build)\//;

export function git(args, cwd) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return e.stdout || '';
  }
}

export const top = (cwd) => git(['rev-parse', '--show-toplevel'], cwd).trim();

// The git directory git reports (`--git-common-dir`, `--git-dir`) as an absolute path: it answers
// with a path relative to the repo, or with a Windows drive path that the posix `isAbsolute`
// does not recognise.
export function absGitPath(repo, p) {
  if (!p) return '';
  return isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) ? p : join(repo, p);
}

// The branch the change will merge into: origin's default branch, else main, else master.
export function defaultBranch(repo) {
  const head = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], repo).trim();
  if (head) return head.replace('refs/remotes/', '');
  for (const b of ['origin/main', 'origin/master', 'main', 'master'])
    if (git(['rev-parse', '--verify', '--quiet', b], repo).trim()) return b;
  return '';
}

// The commit the change starts from: where HEAD left the default branch.
export function mergeBase(repo, ref) {
  return git(['merge-base', ref, 'HEAD'], repo).trim();
}

// How the branch stands against the latest default branch: commits it is behind, and the files
// a merge would conflict on (empty when it merges cleanly).
export function mergeState(repo) {
  const target = defaultBranch(repo);
  if (!target) return null;
  const behind = Number(git(['rev-list', '--count', `HEAD..${target}`], repo).trim() || 0);
  const r = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', target, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const conflicts = r.status === 1 ? r.stdout.split('\n').slice(1).filter(Boolean) : [];
  // When the remote was last fetched: a stale fetch hides what landed on the target since.
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo).trim();
  const fetched = common && existsSync(join(common, 'FETCH_HEAD')) ? statSync(join(common, 'FETCH_HEAD')).mtimeMs : 0;
  return { target, behind, conflicts, fetched, error: r.status > 1 ? (r.stderr || '').trim() : '' };
}

// Whether a shell command runs `git <sub>` anywhere outside quotes (a commit message may mention
// one), with global options between: the hooks' `if` filter also fires on commands it cannot parse.
export function runsGit(cmd, sub) {
  // Text a command only carries (quoted strings, here-document bodies) never runs git.
  const bare = String(cmd || '').replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, '\n')
    .replace(/"(\\.|[^"\\])*"|'[^']*'/g, '""');
  return new RegExp(`(^|[;&|(\`\\s])git((\\s+-[Cc]\\s+\\S+)|(\\s+--?[\\w-]+(=\\S+)?))*\\s+${sub}(?![\\w-])`).test(bare);
}

// Dead-code finders this machine can run on the change: on PATH, or in the repo's node_modules.
export function scanners(repo) {
  const names = ['knip', 'ts-prune', 'vulture', 'ruff', 'deadcode', 'staticcheck'];
  return names.filter((n) => existsSync(join(repo, 'node_modules', '.bin', n))
    || spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).status === 0);
}

// The superproject a submodule sits in and the submodule's own checkout there, also from a linked
// worktree of the submodule (the frozen review tree), where git reports no superproject.
export function superproject(repo) {
  const sup = git(['rev-parse', '--show-superproject-working-tree'], repo).trim();
  if (sup) return { sup, checkout: repo };
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo).trim();
  const wt = common && git(['--git-dir', common, 'config', 'core.worktree'], repo).trim();
  if (!wt) return { sup: '', checkout: repo };
  const checkout = resolve(common, wt);
  return { sup: git(['rev-parse', '--show-superproject-working-tree'], checkout).trim(), checkout };
}

// The name a repo's learned rules and profile are kept under: the main checkout's folder, also
// from a linked worktree (whose own folder is named for its slice) and a submodule's worktree.
export function repoName(repo) {
  if (!repo) return '';
  const common = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repo).trim();
  return basename(common) === '.git' ? basename(dirname(common)) : basename(superproject(repo).checkout);
}

// Where each sibling is read: one found in the superproject at its default branch, the code that
// runs beside the change, not the branch its checkout happens to be on; one named by hand, or one
// with no default branch, as its folder stands ('').
export function siblingRefs(sibs, named = []) {
  const hand = new Set(named.map((d) => resolve(d)));
  return new Map(sibs.map((s) => [s, hand.has(s) ? '' : defaultBranch(s)]));
}

// Other checkouts whose code may call into this one: the sibling submodules of the
// superproject this repo sits in, plus any directories given by hand.
export function siblings(repo, extra = []) {
  const found = new Set(extra.map((d) => resolve(d)));
  const { sup, checkout } = superproject(repo);
  if (sup) {
    for (const line of git(['config', '--file', '.gitmodules', '--get-regexp', 'path'], sup).split('\n')) {
      const p = line.split(' ')[1];
      if (!p) continue;
      const dir = join(sup, p);
      if (dir !== repo && dir !== checkout && existsSync(join(dir, '.git'))) found.add(dir);
    }
  }
  found.delete(repo);
  return [...found];
}

// Commits that would be pushed, with the facts a reviewer or CI checks on them.
export function commits(repo, range) {
  const out = git(['log', '--format=%H%x00%P%x00%s', range], repo);
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, parents, subject] = l.split('\0');
    return { sha: sha.slice(0, 12), subject, length: [...subject].length, merge: parents.split(' ').length > 1 };
  });
}

// The commands CI runs: the `run:` steps of every GitHub Actions workflow and the `script:`
// lines of every GitLab CI job.
export function ciCommands(repo) {
  const dir = join(repo, '.github', 'workflows');
  const out = gitlabCommands(repo);
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
    const lines = readFileSync(join(dir, f), 'utf8').split('\n');
    let job = '';
    for (let i = 0; i < lines.length; i++) {
      const jm = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
      if (jm && lines.slice(0, i).some((l) => /^jobs:\s*$/.test(l))) job = jm[1];
      const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
      if (!m) continue;
      let cmd = m[2].trim();
      if (/^[|>][-+]?$/.test(cmd)) {
        const body = [];
        const ind = m[1].length;
        while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].search(/\S/) > ind)) body.push(lines[++i].trim());
        cmd = body.filter(Boolean).join('\n');
      }
      if (cmd) out.push({ workflow: f, job, run: cmd });
    }
  }
  return out;
}


const GITLAB_KEYS = new Set(['stages', 'variables', 'default', 'include', 'workflow', 'image', 'services', 'cache', 'before_script', 'after_script']);

// Every line at column 0 starts a top-level key; jobs are the keys that are neither GitLab's own
// nor hidden templates (`.name`). A `- |` item is one multi-line command.
function gitlabCommands(repo) {
  const file = join(repo, '.gitlab-ci.yml');
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const out = [];
  const push = (job, run) => { if (run) out.push({ workflow: '.gitlab-ci.yml', job, run }); };
  const unquote = (t) => t.trim().replace(/^(['"])(.*)\1$/, '$2');
  let job = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^[^\s#-]/.test(l)) {
      const key = l.match(/^(.+?):(\s+&\S+)?\s*(#.*)?$/)?.[1].trim() || '';
      job = !key || GITLAB_KEYS.has(key) || key.startsWith('.') ? '' : key;
      continue;
    }
    const m = job && l.match(/^(\s+)(before_script|script):\s*(.*)$/);
    if (!m) continue;
    if (m[3].trim()) { push(job, unquote(m[3])); continue; }
    const ind = m[1].length;
    while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].search(/\S/) > ind || /^\s*- /.test(lines[i + 1]) && lines[i + 1].search(/\S/) === ind)) {
      const item = lines[++i].match(/^(\s*)- (.*)$/);
      if (!item) continue;
      if (!/^[|>][-+]?$/.test(item[2].trim())) { push(job, unquote(item[2])); continue; }
      const body = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === '' || lines[i + 1].search(/\S/) > item[1].length + 1)) body.push(lines[++i].trim());
      push(job, body.filter(Boolean).join('\n'));
    }
  }
  return out;
}
