import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
