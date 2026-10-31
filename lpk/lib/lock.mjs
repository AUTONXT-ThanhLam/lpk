// A lock one process at a time holds while it writes a shared file under the repo's git directory.
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

const STALE_MS = 30_000;
const WAIT_MS = 10_000;
const EMPTY_MS = 5_000;
const WIN = process.platform === 'win32';

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// One writer at a time: a lockfile created with O_EXCL holding "pid host time". A lock whose holder
// died on this host, or that is older than any write takes, or that stayed empty (a lock file the
// flock(1) version left, or a holder that died before writing), is stale: it is renamed aside (only one
// taker wins the rename) and, if what was renamed is not the stale lock that was read, put back.
export function acquire(lock, { waitMs = WAIT_MS, staleMs = STALE_MS } = {}) {
  mkdirSync(dirname(lock), { recursive: true });
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, `${process.pid} ${hostname()} ${Date.now()}`);
      closeSync(fd);
      return { release: () => { try { unlinkSync(lock); } catch { /* already gone */ } } };
    } catch (e) {
      if (e.code === 'EPERM' && WIN && Date.now() <= until) { pause(15); continue; }
      if (e.code !== 'EEXIST') throw e;
    }
    let seen = '';
    try { seen = readFileSync(lock, 'utf8'); } catch { continue; }
    const [pid, host, t] = seen.split(' ');
    let idle = 0;
    try { idle = Date.now() - statSync(lock).mtimeMs; } catch { continue; }
    const abandoned = seen ? (host === hostname() && !alive(Number(pid))) || Date.now() - Number(t) > staleMs : idle > EMPTY_MS;
    if (abandoned) {
      const aside = `${lock}.${process.pid}.${Math.random().toString(36).slice(2)}`;
      try {
        renameSync(lock, aside);
        if (readFileSync(aside, 'utf8') !== seen) { try { linkSync(aside, lock); } catch { /* a new holder already took it */ } }
        unlinkSync(aside);
      } catch { /* another taker moved it first */ }
      continue;
    }
    if (Date.now() > until) return { seen };
    pause(15);
  }
}

export function locked(dir, fn, name = 'findings.lock') {
  const lock = join(dir, name);
  const got = acquire(lock);
  if (!got.release) throw new Error(`${name} is held by ${got.seen} (${lock})`);
  try { return fn(); } finally { got.release(); }
}
