// An flock(1) lock held by this process: the `flock` child locks the open file this process passes
// it, so the lock lasts until this process closes the file or exits, also when it is killed.
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

// Takes the lock on `file`, waiting up to `waitS` seconds (0 = only if free now). Returns the open
// file to pass to `release`, or null when it is held elsewhere.
export function takeLock(file, waitS = 0) {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  const args = waitS > 0 ? ['-w', String(waitS), '3'] : ['-n', '3'];
  const r = spawnSync('flock', args, { stdio: ['ignore', 'ignore', 'pipe', fd], encoding: 'utf8' });
  if (r.error) { closeSync(fd); throw new Error(`flock is not installed (${r.error.code}); it comes with util-linux`); }
  if (r.status === 0) return fd;
  closeSync(fd);
  return null;
}

export function release(fd) {
  if (fd !== null && fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
}
