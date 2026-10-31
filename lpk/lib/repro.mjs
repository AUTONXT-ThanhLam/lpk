// Disposable worktrees a verifier reproduces a finding in: one per commit, under the user's cache
// (outside `.git`, where test runners ignore every path), each installed once from its own lockfile
// out of the local package store and then shared by every verifier of the run. A link to the
// checkout's `node_modules` is never made: in a workspace monorepo it resolves to the checkout's code.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { homedir, constants } from 'node:os';
import { join } from 'node:path';
import { takeLock, release } from './flock.mjs';
import { killGroup, spawnGroup } from './proc.mjs';
import { git } from './git.mjs';

export const reproRoot = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lpk', 'repro');
const INSTALL_TIMEOUT_S = 900;
// A run id names one directory under the root, never a path out of it.
const runRoot = (run) => {
  if (!/^[\w.-]+$/.test(run || '') || /^\.+$/.test(run)) throw new Error(`not a run id: ${JSON.stringify(run)}`);
  return join(reproRoot(), run);
};

// The install command for the lockfile at the tree's root, or null when it has none lpk knows.
export function installer(dir) {
  const has = (f) => existsSync(join(dir, f));
  if (has('pnpm-lock.yaml')) return ['pnpm', ['install', '--frozen-lockfile', '--prefer-offline']];
  if (has('package-lock.json') || has('npm-shrinkwrap.json')) return ['npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']];
  if (has('yarn.lock')) return has('.yarnrc.yml') ? ['yarn', ['install', '--immutable']] : ['yarn', ['install', '--frozen-lockfile', '--prefer-offline']];
  if (has('bun.lock') || has('bun.lockb')) return ['bun', ['install', '--frozen-lockfile']];
  return null;
}

// The worktree for `sha`, created and installed on first use. Two verifiers asking at once wait
// for one install; a failed install is retried by the next call.
export function reproTree(repo, run, sha) {
  const root = runRoot(run);
  const dir = join(root, sha.slice(0, 12));
  const mark = `${dir}.install.json`;
  const fd = takeLock(`${dir}.lock`, INSTALL_TIMEOUT_S + 60);
  if (fd === null) return { dir, error: `another process holds ${dir}.lock for more than ${INSTALL_TIMEOUT_S + 60}s` };
  try {
    if (!existsSync(join(dir, '.git'))) {
      if (existsSync(dir)) return { dir, error: `${dir} exists but is not a worktree; remove it` };
      git(['worktree', 'prune'], repo);
      const r = spawnSync('git', ['worktree', 'add', '--detach', dir, sha], { cwd: repo, encoding: 'utf8' });
      if (r.status !== 0) return { dir, error: `git worktree add failed: ${(r.stderr || '').trim().split('\n').at(-1)}` };
    }
    let install = existsSync(mark) ? JSON.parse(readFileSync(mark, 'utf8')) : null;
    if (!install || install.exit !== 0) {
      const how = installer(dir);
      const t0 = Date.now();
      const log = `${dir}.install.log`;
      if (!how) install = { cmd: null, exit: 0, ms: 0 };
      else {
        const opts = { cwd: dir, encoding: 'utf8', timeout: INSTALL_TIMEOUT_S * 1000, env: { ...process.env, CI: '1', HUSKY: '0' }, maxBuffer: 1 << 28 };
        const r = process.platform === 'win32' ? spawnSync([how[0], ...how[1]].join(' '), { ...opts, shell: true }) : spawnSync(how[0], how[1], opts);
        writeFileSync(log, `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`);
        install = { cmd: [how[0], ...how[1]].join(' '), exit: r.status ?? (r.signal || r.error?.code || 'failed'), ms: Date.now() - t0, log };
      }
      writeFileSync(mark, JSON.stringify(install));
    }
    return { dir, install };
  } finally {
    release(fd);
  }
}

// Runs `cmd` in `cwd` in its own process group, the whole output kept in `log`. A signal that ends
// the command or its shell is a crash, never a pass or an ordinary failure.
export function runIn(cwd, cmd, timeoutS, log) {
  const t0 = Date.now();
  return new Promise((done) => {
    const out = createWriteStream(log);
    const child = spawnGroup(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', timedOut = false;
    const keep = (b) => { out.write(b); tail = (tail + b).slice(-16384); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const kill = () => killGroup(child.pid);
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutS * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      kill();
      const byShell = code > 128 && code < 160 ? Object.keys(constants.signals).find((k) => constants.signals[k] === code - 128) : null;
      const sig = timedOut ? null : signal || byShell;
      const r = { exit: code ?? -1, signal: sig || null, crash: Boolean(sig), timedOut, ms: Date.now() - t0, tail: tail.trimEnd() };
      out.end(() => done(r));
    });
  });
}

// Removes every repro worktree of the run, and its logs.
export function cleanRepro(repo, run) {
  const root = runRoot(run);
  if (!existsSync(root)) return [];
  const gone = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (existsSync(join(dir, '.git'))) { git(['worktree', 'remove', '--force', dir], repo); gone.push(dir); }
  }
  rmSync(root, { recursive: true, force: true });
  git(['worktree', 'prune'], repo);
  return gone;
}

export const logPath = (run, sha, side) => {
  const dir = join(runRoot(run), 'logs');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${side}-${sha.slice(0, 12)}-${process.pid}.log`);
};
