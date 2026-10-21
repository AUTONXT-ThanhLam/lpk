// `lpk spawn --port <p> [--data-dir <d>] -- <command>`: starts an app for the run (PORT set), or
// reuses the live one it started for the same commit, port and data dir, and waits until the port
// accepts connections. `lpk reap` stops exactly what this started.
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseArgs, repoOf } from '../out.mjs';
import { alive, codeOf, listening, reusable, start } from '../spawn.mjs';

const USAGE = 'usage: lpk spawn --port <port> [--data-dir <dir>] [--wait <seconds>] [--repo <dir>] -- <command>';

export async function main(argv) {
  const a = parseArgs(argv, ['--port', '--data-dir', '--wait', '--repo']);
  const port = Number(a.opt?.('--port'));
  if (a.error || !a.cmd || a.words.length || !Number.isInteger(port) || port < 1 || port > 65535) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const cwd = process.cwd();
  const repo = repoOf(a.opt('--repo') || cwd);
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const dataDir = a.opt('--data-dir') ? resolve(a.opt('--data-dir')) : '';
  const code = codeOf(cwd);
  const old = reusable(repo, { ...code, port, dataDir });
  if (old) { console.log(`reusing pid ${old.pid} on port ${port}, started ${old.at} for ${old.commit.slice(0, 12)}${dataDir ? ` with ${dataDir}` : ''}; log ${old.log}`); return 0; }
  if (await listening(port)) { console.error(`lpk: port ${port} is in use by a process lpk did not start for ${code.commit.slice(0, 12)}${code.dirty ? ' (dirty tree)' : ''}${dataDir ? ` and ${dataDir}` : ''}; pick another port, or stop it`); return 1; }
  const rec = start(repo, { cmd: a.cmd, cwd, port, dataDir, ...code });
  const wait = Number(a.opt('--wait') || 60);
  const t0 = Date.now();
  while (Date.now() - t0 < wait * 1000) {
    if (await listening(port)) { console.log(`started pid ${rec.pid} on port ${port} for ${code.commit.slice(0, 12)}${code.dirty ? ' (dirty tree: never reused)' : ''} in ${Math.round((Date.now() - t0) / 1000)}s; log ${rec.log}`); return 0; }
    if (!alive(rec)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const tail = (() => { try { return readFileSync(rec.log, 'utf8').trimEnd().split('\n').slice(-20); } catch { return []; } })();
  console.error([`lpk: pid ${rec.pid} ${alive(rec) ? `is running but port ${port} does not accept connections after ${wait}s` : 'exited before its port accepted connections'}; log ${rec.log}`, ...tail.map((l) => `  | ${l}`)].join('\n'));
  return 1;
}
