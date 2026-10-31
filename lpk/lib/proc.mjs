import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { constants } from 'node:os';

const WIN = process.platform === 'win32';

export function spawnGroup(cmd, opts = {}) {
  const { survive, ...rest } = opts;
  return spawn('bash', ['-c', cmd], { ...rest, detached: !WIN || Boolean(survive), windowsHide: true });
}

export function killGroup(pid, signal = 'SIGKILL') {
  if (WIN) { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); return; }
  try { process.kill(-pid, signal); } catch { /* group gone */ }
}

const text = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true }).stdout?.trim() || '';
export function startTime(pid) {
  if (WIN) return text('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue).StartTime.ToFileTimeUtc()`]);
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')[19]; } catch { /* not Linux */ }
  return text('ps', ['-o', 'lstart=', '-p', String(pid)]);
}

export function signalOf(code, signal) {
  if (signal) return signal;
  const n = code > 128 && code < 160 ? code - 128 : WIN && code >= 256 && code % 256 === 0 ? code / 256 : 0;
  return Object.keys(constants.signals).find((k) => constants.signals[k] === n) || null;
}

export function recordGroup(scratch, child) {
  if (!child.pid) return;
  const file = join(scratch, `group-${child.pid}`);
  writeFileSync(file, String(child.pid));
  child.on('close', () => rmSync(file, { force: true }));
}

export function killRecorded(scratch) {
  for (const f of readdirSync(scratch).filter((n) => n.startsWith('group-'))) {
    try { killGroup(Number(readFileSync(join(scratch, f), 'utf8'))); } catch { continue; }
    rmSync(join(scratch, f), { force: true });
  }
}
