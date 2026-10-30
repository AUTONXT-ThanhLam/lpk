// `lpk slot [--mb <n>] -- <command>`: runs a heavy command (a build, an e2e suite, an install) only
// when one of the machine's heavy-job slots is free, so parallel agents do not run out of memory.
// Slots = free memory / memory per slot (2048 MB unless `--mb` or LPK_SLOT_MB says), at least one;
// each is an flock(1) lock under the user's cache, released when the command ends or is killed.
// `lpk slot --count` prints the lanes a run can carry at once (memory slots and model streams, the
// tighter of the two), which is what a workflow takes as its `maxParallel`.
import { readFileSync } from 'node:fs';
import { constants, freemem, homedir } from 'node:os';
import { join } from 'node:path';
import { release, takeLock } from '../flock.mjs';
import { killGroup, spawnGroup } from '../proc.mjs';
import { parseArgs } from '../out.mjs';

const USAGE = 'usage: lpk slot [--mb <MB per slot>] -- <command>  |  lpk slot --count [--mb <MB per slot>]';
const DIR = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lpk', 'slots');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Memory the kernel can hand out now (MemAvailable counts reclaimable cache), in MB.
export function availableMb() {
  try { return Math.floor(Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)[1]) / 1024); } catch { return Math.floor(freemem() / 2 ** 20); }
}

export const slotCount = (mb) => Math.max(1, Math.floor(availableMb() / mb));

// How many model streams the backend answers at once. A self-hosted one (the owner's local vLLM)
// was measured flat past two concurrent streams: a third lane does not add throughput, it only
// takes a smaller share, and a wide fan-out on such a backend turns into stalled lenses. The
// hosts' own pools have no measured ceiling, so they are not capped here.
export const MODEL_LANES_MEASURED = 2;
export function modelLanes(env = process.env) {
  const declared = Number(env.LPK_MODEL_LANES || 0);
  if (declared > 0) return declared;
  const base = env.ANTHROPIC_BASE_URL || '';
  if (base && !/^https:\/\/api\.anthropic\.com/i.test(base)) return MODEL_LANES_MEASURED;
  return Infinity;
}

// The lanes a run can carry at once: the machine's memory and the backend's streams, whichever is
// the tighter. `lpk slot --count` prints this, and the review workflow takes it as `maxParallel`.
export const width = (mb, env = process.env) => Math.min(slotCount(mb), modelLanes(env));

export async function main(argv) {
  const a = parseArgs(argv, ['--mb'], ['--count']);
  const mb = Number(a.opt?.('--mb') || process.env.LPK_SLOT_MB || 2048);
  if (a.error || a.words.length || !(mb > 0) || (!a.cmd && !a.flags.has('--count'))) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  if (a.flags.has('--count')) {
    const lanes = modelLanes();
    console.log(`${width(mb)} lane(s): ${slotCount(mb)} memory slot(s) of ${availableMb()} MB free at ${mb} MB, ${Number.isFinite(lanes) ? `${lanes} model lane(s) (declared or measured on this backend)` : 'model lanes uncapped'}`);
    return 0;
  }
  let fd = null, said = false;
  for (;;) {
    const n = slotCount(mb);
    for (let i = 0; i < n && fd === null; i++) fd = takeLock(join(DIR(), `slot-${i}.lock`));
    if (fd !== null) break;
    if (!said) { console.error(`lpk slot: all ${n} slot(s) busy; waiting`); said = true; }
    await pause(1000);
  }
  // The command runs in its own process group; an interrupt to lpk reaches the whole group.
  const child = spawnGroup(a.cmd, { stdio: 'inherit' });
  const stop = (sig) => killGroup(child.pid, sig);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
  const code = await new Promise((r) => child.on('close', (c, s) => r(c ?? 128 + (constants.signals[s] || 1))));
  release(fd);
  return code;
}
