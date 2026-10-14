// Proof that tests can fail: in a scratch worktree of the current change, undo one changed
// source file at a time and run the test command. A file whose undo leaves the tests green is
// not proved by them. The developer's checkout, index and stash are never touched.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { git } from './git.mjs';
import { CODE, TEST } from './rules.mjs';

const SHARED = ['node_modules', '.venv', 'venv', '.env', '.env.local', '.env.test', '.env.development'];

// The working tree (tracked, staged, unstaged and untracked, minus ignored files) as a commit,
// built through a private index file.
export function snapshot(repo, scratch) {
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') };
  const run = (args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run(['read-tree', 'HEAD']);
  run(['add', '-A']);
  const tree = run(['write-tree']);
  return run(['-c', 'user.name=lpk', '-c', 'user.email=lpk@localhost', 'commit-tree', tree, '-p', 'HEAD', '-m', 'lpk mutate snapshot']);
}

// Dependencies and local env files are ignored by git, so the worktree links to the repo's own.
export function linkShared(repo, wt) {
  const dirs = new Set(['.']);
  for (const p of git(['ls-files', '*package.json', '*pyproject.toml', '*requirements*.txt'], repo).split('\n').filter(Boolean))
    if (p.split('/').length <= 4) dirs.add(dirname(p));
  for (const d of dirs) for (const name of SHARED) {
    const src = join(repo, d, name), dest = join(wt, d, name);
    if (existsSync(src) && !existsSync(dest)) { mkdirSync(dirname(dest), { recursive: true }); symlinkSync(src, dest); }
  }
}

// The test command runs in its own process group, so a timeout or an interrupt stops the
// runner together with its workers and servers.
let current = null, groupFile = '';
export const killGroup = (child) => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };

function runTests(dir, cmd, timeout) {
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn('bash', ['-c', cmd], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    if (groupFile) writeFileSync(groupFile, String(child.pid));
    let out = '', timedOut = false;
    const keep = (b) => { out = (out + b).slice(-65536); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeout * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      killGroup(child);
      current = null;
      done({ exit: code ?? `killed (${signal})`, ms: Date.now() - t0, timedOut, tail: out.trimEnd().split('\n').slice(-12).join('\n') });
    });
  });
}

// A run killed outright (out of memory, SIGKILL) cannot clean up after itself. The next run
// removes this repo's mutate and compare worktrees whose owning process is gone.
export function removeOrphans(repo, root) {
  const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  for (const line of git(['worktree', 'list', '--porcelain'], repo).split('\n')) {
    const wt = line.startsWith('worktree ') ? line.slice(9) : '';
    if (!wt.startsWith(`${root}/run-`) || !/\/(wt|base)$/.test(wt)) continue;
    const scratch = dirname(wt);
    let pid = '';
    try { pid = readFileSync(join(scratch, 'pid'), 'utf8').trim(); } catch { /* no owner recorded: leave it */ }
    if (!pid || alive(pid)) continue;
    try { process.kill(-Number(readFileSync(join(scratch, 'group'), 'utf8')), 'SIGKILL'); } catch { /* no test command left running */ }
    git(['worktree', 'remove', '--force', wt], repo);
    if (['wt', 'base'].some((d) => existsSync(join(scratch, d)))) continue; // compare's other tree is next
    for (const f of ['index', 'pid', 'group']) if (existsSync(join(scratch, f))) unlinkSync(join(scratch, f));
    try { rmdirSync(scratch); } catch { /* something else is in it; leave it */ }
  }
  git(['worktree', 'prune'], repo);
}

// One run's scratch directory under the cache, holding its worktrees (`trees`, by name). `end`
// removes them, after `stop` kills what the run still has running; an interrupt does the same.
export function scratchRun(repo, trees, stop) {
  const root = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lpk', 'mutate');
  mkdirSync(root, { recursive: true });
  removeOrphans(repo, root);
  const scratch = mkdtempSync(join(root, 'run-'));
  writeFileSync(join(scratch, 'pid'), String(process.pid));
  const cleanup = () => {
    stop();
    for (const t of trees) if (existsSync(join(scratch, t))) git(['worktree', 'remove', '--force', join(scratch, t)], repo);
    git(['worktree', 'prune'], repo);
    for (const f of ['index', 'pid', 'group']) if (existsSync(join(scratch, f))) unlinkSync(join(scratch, f));
    try { rmdirSync(scratch); } catch { /* not empty: left for the next run's orphan check */ }
  };
  const onSignal = (sig) => { cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143); };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, onSignal);
  return { scratch, end: () => { for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(sig, onSignal); cleanup(); } };
}

// `only` limits the run to these paths; by default every changed non-test code file is undone.
// `sub` is the caller's directory inside the repo, where the test command runs.
// Each hunk of a modified file as the file with only that hunk undone. With -U0, a hunk that
// adds no lines (d = 0) sits after line c; otherwise it starts at line c.
function hunkUndos(repo, base, snap, c) {
  const before = git(['show', `${base}:${c.from}`], repo).split('\n');
  const after = git(['show', `${snap}:${c.path}`], repo).split('\n');
  const heads = [...git(['diff', '-U0', base, snap, '--', c.path], repo).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)];
  return heads.map((h, i) => {
    const [a, b, n, d] = [Number(h[1]), h[2] === undefined ? 1 : Number(h[2]), Number(h[3]), h[4] === undefined ? 1 : Number(h[4])];
    const at = d === 0 ? n : n - 1;
    const old = b === 0 ? [] : before.slice(a - 1, a - 1 + b);
    const text = [...after.slice(0, at), ...old, ...after.slice(at + d)].join('\n');
    return { text, label: `${d === 0 ? `re-added ${b} removed line(s) after line ${n}` : `undid lines ${n}-${n + d - 1}`} (hunk ${i + 1} of ${heads.length})` };
  });
}

// `hunks` undoes each hunk of a modified file on its own instead of the whole file, at most
// `maxRuns` test runs in all. `patches` replaces the undos with given mutants: each a unified diff
// against the change, applied alone; a mutant the tests still pass on is a defect they miss.
export async function mutate({ repo, base, cmd, sub = '', only = [], timeout = 600, hunks = false, maxRuns = 40, patches = [] }) {
  const { scratch, end } = scratchRun(repo, ['wt'], () => current && killGroup(current));
  groupFile = join(scratch, 'group');
  const wt = join(scratch, 'wt');
  try {
    const snap = snapshot(repo, scratch);
    const changes = git(['diff', '--name-status', '--find-renames', base, snap], repo).split('\n').filter(Boolean)
      .map((l) => { const [st, a, b] = l.split('\t'); return { status: st[0], from: a, path: b || a }; })
      .filter((c) => c.status !== 'D' && CODE.test(c.path) && !TEST.test(c.path) && (!only.length || only.includes(c.path)));
    git(['worktree', 'add', '--detach', wt, snap], repo);
    if (!existsSync(join(wt, '.git'))) return { error: `could not create a worktree at ${wt}` };
    linkShared(repo, wt);
    const dir = join(wt, sub);
    const baseline = await runTests(dir, cmd, timeout);
    if (baseline.exit !== 0) return { snapshot: snap, baseline, files: [], error: `the tests fail on the change itself (in ${sub || 'the repo root'}), so undoing a file proves nothing` };
    const files = [];
    let skipped = 0;
    for (const p of patches) {
      const name = basename(p);
      const apply = (...flags) => spawnSync('git', ['apply', ...flags, p], { cwd: wt, encoding: 'utf8' });
      const a = apply();
      if (a.status !== 0) { files.push({ path: name, undo: 'mutant', exit: 'not applied', ms: 0, timedOut: false, tail: (a.stderr || '').trim().slice(0, 300) }); continue; }
      files.push({ path: name, undo: 'mutant', ...(await runTests(dir, cmd, timeout)) });
      if (apply('-R').status !== 0) git(['checkout', '-f', snap, '--', '.'], wt);
    }
    for (const c of patches.length ? [] : changes) {
      if (hunks && c.status === 'M') {
        for (const u of hunkUndos(repo, base, snap, c)) {
          if (files.length >= maxRuns) { skipped++; continue; }
          writeFileSync(join(wt, c.path), u.text);
          files.push({ path: c.path, undo: u.label, ...(await runTests(dir, cmd, timeout)) });
        }
        git(['checkout', snap, '--', c.path], wt);
        continue;
      }
      if (files.length >= maxRuns) { skipped++; continue; }
      if (c.status === 'A') unlinkSync(join(wt, c.path));
      else {
        if (c.status === 'R') unlinkSync(join(wt, c.path));
        mkdirSync(dirname(join(wt, c.from)), { recursive: true });
        writeFileSync(join(wt, c.from), git(['show', `${base}:${c.from}`], repo));
      }
      const r = await runTests(dir, cmd, timeout);
      files.push({ path: c.path, undo: c.status === 'A' ? 'deleted the new file' : c.status === 'R' ? `restored ${c.from} from base` : 'restored from base', ...r });
      if (c.status === 'R' && c.from !== c.path) unlinkSync(join(wt, c.from));
      git(['checkout', snap, '--', c.path], wt);
    }
    return { snapshot: snap, baseline, files, skipped };
  } finally {
    end();
  }
}
