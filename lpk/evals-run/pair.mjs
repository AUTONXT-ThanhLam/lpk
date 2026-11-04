import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { connect } from 'node:net';
import { basename, dirname, join, resolve, sep } from 'node:path';

export const pairOrder = (draw = randomInt) => (draw(2) === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']);

export function nextRun(outDir, task, arms) {
  let top = 0;
  for (const name of readdirSync(outDir)) {
    for (const arm of arms) {
      const prefix = `${task}-${arm}-`;
      const rest = name.startsWith(prefix) ? name.slice(prefix.length) : '';
      if (/^\d+$/.test(rest)) top = Math.max(top, Number(rest));
    }
  }
  return top + 1;
}

export const portVoid = 'a listener on the port after the run';

const answers = (host, port) => new Promise((done) => {
  const s = connect({ host, port });
  const end = (yes) => { s.destroy(); done(yes); };
  s.once('connect', () => end(true));
  s.once('error', () => end(false));
  s.setTimeout(2000, () => end(false));
});
export const listening = async (port) => (await Promise.all(['127.0.0.1', '::1'].map((h) => answers(h, port)))).some(Boolean);

const pause = (ms) => new Promise((t) => setTimeout(t, ms));
const readProc = (pid, file) => { try { return readFileSync(`/proc/${pid}/${file}`, 'utf8'); } catch { return ''; } };
const groupOf = (pid) => Number(readProc(pid, 'stat').split(')').pop().trim().split(' ')[2]);
const ownGroup = groupOf(process.pid);

function ownerDir(pid) {
  const argv = readProc(pid, 'cmdline').split('\0');
  const i = argv.findIndex((a) => a === '--user-data-dir' || a.startsWith('--user-data-dir='));
  if (i >= 0) return argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : argv[i + 1];
  const home = readProc(pid, 'environ').split('\0').find((e) => e.startsWith('HOME='));
  return home ? home.slice(5) : '';
}

export function settled(p) {
  const abs = resolve(p);
  const up = dirname(abs);
  try { return realpathSync(abs); } catch { return up === abs ? abs : join(settled(up), basename(abs)); }
}

function ownListeners(port, home) {
  const ss = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8', timeout: 10000 });
  const pids = [...new Set([...(ss.stdout || '').matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])))];
  const homeReal = realpathSync(home);
  const inside = (p) => { const r = settled(p); return r === homeReal || r.startsWith(homeReal + sep); };
  return pids.length && pids.every((pid) => ownerDir(pid) && inside(ownerDir(pid))) ? pids : null;
}

async function stopListeners(pids, port, probe, patience) {
  const targets = pids.map((pid) => { const g = groupOf(pid); return g > 1 && g !== ownGroup ? -g : pid; });
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const t of targets) { try { process.kill(t, signal); } catch {} }
    for (let i = 0; i < patience && await probe(port); i++) await pause(100);
    if (!await probe(port)) return true;
  }
  return false;
}

export async function portAfterRun(port, home, probe = listening, patience = 50) {
  if (!await probe(port)) return {};
  const own = ownListeners(port, home);
  if (!own) return { voided: portVoid };
  return await stopListeners(own, port, probe, patience) ? { ownChrome: true } : { ownChrome: true, voided: portVoid };
}
