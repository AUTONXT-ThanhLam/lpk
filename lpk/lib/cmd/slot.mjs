// `lpk slot [--mb <n>] -- <command>`: runs a heavy command (a build, an e2e suite, an install) only
// when one of the machine's heavy-job slots is free, so parallel agents do not run out of memory.
// Slots = free memory / memory per slot (2048 MB unless `--mb` or LPK_SLOT_MB says), at least one;
// each is an flock(1) lock under the user's cache, released when the command ends or is killed.
// `lpk slot --count` prints the number of slots, for a workflow's `maxParallel`. With `--idle <s>`, a
// command that prints nothing on stdout or stderr for that long is stopped and lpk exits 124.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants, freemem, homedir } from 'node:os';
import { join } from 'node:path';
import { release, takeLock } from '../flock.mjs';
import { parseArgs } from '../out.mjs';

const USAGE = 'usage: lpk slot [--mb <MB per slot>] [--idle <seconds>] -- <command>  |  lpk slot --count [--mb <MB per slot>]';
const DIR = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lpk', 'slots');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Memory the kernel can hand out now (MemAvailable counts reclaimable cache), in MB.
export function availableMb() {
  try { return Math.floor(Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)[1]) / 1024); } catch { return Math.floor(freemem() / 2 ** 20); }
}

export const slotCount = (mb) => Math.max(1, Math.floor(availableMb() / mb));

export async function main(argv) {
  const a = parseArgs(argv, ['--mb', '--idle'], ['--count']);
  const mb = Number(a.opt?.('--mb') || process.env.LPK_SLOT_MB || 2048);
  const idle = Number(a.opt?.('--idle') ?? 0);
  if (a.error || a.words.length || !(mb > 0) || (a.opt('--idle') !== undefined && !(idle > 0)) || (!a.cmd && !a.flags.has('--count'))) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  if (a.flags.has('--count')) { console.log(`${slotCount(mb)} slot(s): ${availableMb()} MB available, ${mb} MB per slot`); return 0; }
  let fd = null, said = false;
  for (;;) {
    const n = slotCount(mb);
    for (let i = 0; i < n && fd === null; i++) fd = takeLock(join(DIR(), `slot-${i}.lock`));
    if (fd !== null) break;
    if (!said) { console.error(`lpk slot: all ${n} slot(s) busy; waiting`); said = true; }
    await pause(1000);
  }
  // The command runs in its own process group; an interrupt to lpk reaches the whole group.
  const child = spawn('bash', ['-c', a.cmd], { stdio: idle ? ['inherit', 'pipe', 'pipe'] : 'inherit', detached: true });
  const stop = (sig) => { try { process.kill(-child.pid, sig); } catch { /* gone */ } };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop(sig));
  const code = await (idle ? watch(child, idle, stop) : new Promise((r) => child.on('close', (c, s) => r(exitOf(c, s)))));
  release(fd);
  return code;
}

const exitOf = (c, s) => c ?? 128 + (constants.signals[s] || 1);

// With --idle the command's output passes through lpk, chunk by chunk, so its silence can be timed.
// Silent for `idle` seconds, its whole group is stopped and the result is 124. Once the command has
// exited, its last output is read for at most DRAIN ms: what it left running in the background may
// hold the pipes open, and is not waited on, as it is not without --idle.
// shortcut: output is read through pipes, so a program that block-buffers when not on a terminal
// (Python's print) looks silent until its buffer fills; revisit with a pty if a run meets it.
const DRAIN = 1000;
function watch(child, idle, stop) {
  return new Promise((done) => {
    let tail = '', exited = null, stopped = false, timer = null;
    const arm = (ms = idle * 1000) => { clearTimeout(timer); timer = setTimeout(silent, ms); };
    for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      from.on('data', (chunk) => { to.write(chunk); tail = (tail + chunk).slice(-4096); if (exited === null && !stopped) arm(); });
    }
    child.on('exit', (c, s) => { exited = exitOf(c, s); if (!stopped) arm(DRAIN); });
    child.on('close', (c, s) => { if (!stopped) { clearTimeout(timer); done(exitOf(c, s)); } });
    function silent() {
      if (exited !== null) { console.error(`lpk slot: the command exited ${exited}; what it left running still holds its output, not waited on`); return done(exited); }
      const last = tail.split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
      console.error(`lpk slot: the command printed nothing for ${idle} s; stopped it and its process group. Last line it printed: ${last ?? '(none)'}`);
      // SIGTERM first, so what holds a port or a file can let go; what is left after 5 s is killed.
      stopped = true;
      stop('SIGTERM');
      const end = Date.now() + 5000;
      const wait = setInterval(() => {
        try { process.kill(-child.pid, 0); if (Date.now() < end) return; } catch { /* the group is gone */ }
        clearInterval(wait);
        stop('SIGKILL');
        done(124);
      }, 100);
    }
    arm();
  });
}
