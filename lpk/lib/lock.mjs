// A lock one process at a time holds while it writes a shared file under the repo's git directory.
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

const STALE_MS = 30_000;
const WAIT_MS = 10_000;

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// One writer at a time: a lockfile created with O_EXCL holding "pid host time". A lock whose holder
// died on this host, or that is older than any write takes, is stale: it is renamed aside (only one
// taker wins the rename) and, if what was renamed is not the stale lock that was read, put back.
export function locked(dir, fn, name = 'findings.lock') {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, name);
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx');
      writeSync(fd, `${process.pid} ${hostname()} ${Date.now()}`);
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let seen = '';
    try { seen = readFileSync(lock, 'utf8'); } catch { continue; }
    const [pid, host, t] = seen.split(' ');
    if ((host === hostname() && !alive(Number(pid))) || Date.now() - Number(t) > STALE_MS) {
      const aside = `${lock}.${process.pid}.${Math.random().toString(36).slice(2)}`;
      try {
        renameSync(lock, aside);
        if (readFileSync(aside, 'utf8') !== seen) { try { linkSync(aside, lock); } catch { /* a new holder already took it */ } }
        unlinkSync(aside);
      } catch { /* another taker moved it first */ }
      continue;
    }
    if (Date.now() > until) throw new Error(`${name} is held by ${seen} (${lock})`);
    pause(15);
  }
  try { return fn(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

