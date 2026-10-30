import { acquire } from './lock.mjs';

export function takeLock(file, waitS = 0) {
  const got = acquire(file, { waitMs: waitS * 1000, staleMs: Infinity });
  return got.release ? got : null;
}

export function release(lock) {
  if (lock) lock.release();
}
