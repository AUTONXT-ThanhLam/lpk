// The apps lpk starts for a run (a dev server, an API for the prover): each recorded with its
// process group, port, commit and data dir in the run directory, so a resumed prover reuses the
// live one for the same commit, port and data dir, and `lpk reap` stops exactly these and nothing else.
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { git } from './git.mjs';
import { locked } from './lock.mjs';
import { outDir } from './out.mjs';
import { killGroup, spawnGroup, startTime } from './proc.mjs';
import { runDir } from './run.mjs';

const registry = (repo) => join(runDir(repo), 'spawned.json');
const read = (repo) => { try { return JSON.parse(readFileSync(registry(repo), 'utf8')); } catch { return []; } };
const write = (repo, list) => writeFileSync(registry(repo), JSON.stringify(list, null, 1));
const edit = (repo, fn) => locked(runDir(repo), () => { const l = fn(read(repo)); write(repo, l); return l; }, 'spawned.lock');

export const alive = (rec) => Boolean(rec.start) && startTime(rec.pid) === rec.start;

// Whether something accepts connections on the port on this machine.
export function listening(port) {
  return new Promise((done) => {
    const s = connect({ port, host: '127.0.0.1' });
    const end = (v) => { s.destroy(); done(v); };
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
    s.setTimeout(1000, () => end(false));
  });
}

// The commit the app runs: HEAD of its checkout, marked dirty (and never reused) when tracked
// files differ from it.
export function codeOf(cwd) {
  const head = git(['rev-parse', 'HEAD'], cwd).trim();
  const dirty = Boolean(git(['status', '--porcelain', '--untracked-files=no'], cwd).trim());
  return { commit: head, dirty };
}

export const records = read;

// A live app this run started for the same commit, port and data dir, if any.
export function reusable(repo, { commit, dirty, port, dataDir }) {
  if (dirty) return null;
  return read(repo).find((r) => r.commit === commit && !r.dirty && r.port === port && r.dataDir === dataDir && alive(r)) || null;
}

// Starts `cmd` in its own process group with PORT set, output to a log in the run directory.
export function start(repo, { cmd, cwd, port, dataDir, commit, dirty }) {
  const log = join(outDir(repo), `spawn-${port}-${Date.now()}.log`);
  const fd = openSync(log, 'a');
  const child = spawnGroup(cmd, { cwd, survive: true, stdio: ['ignore', fd, fd], env: { ...process.env, PORT: String(port) } });
  closeSync(fd);
  child.unref();
  const rec = { pid: child.pid, start: '', port, dataDir, commit, dirty, cmd, cwd, log, at: new Date().toISOString() };
  for (let i = 0; i < 50 && !rec.start; i++) { rec.start = startTime(child.pid); if (!rec.start) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); }
  edit(repo, (l) => [...l.filter(alive), rec]);
  return rec;
}

// Stops every app this run started that is still alive: TERM to its group, KILL after 5 seconds.
export async function reap(repo) {
  const list = existsSync(registry(repo)) ? read(repo) : [];
  const out = [];
  for (const r of list) {
    if (!alive(r)) { out.push({ ...r, was: 'already stopped' }); continue; }
    killGroup(r.pid, 'SIGTERM');
    for (let i = 0; i < 50 && alive(r); i++) await new Promise((t) => setTimeout(t, 100));
    if (alive(r)) killGroup(r.pid);
    out.push({ ...r, was: alive(r) ? 'STILL RUNNING' : 'stopped' });
  }
  edit(repo, (l) => l.filter((r) => !list.some((x) => x.pid === r.pid && x.start === r.start) && alive(r)));
  return out;
}
