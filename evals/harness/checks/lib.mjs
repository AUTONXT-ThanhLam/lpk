// Helpers for hidden checks: load a workspace module, run a command, collect failures. Each check
// runs in its own hook process, so a plain import already sees the final code, and it shares module
// instances with the workspace's own imports (a cache-busting query would load a second copy).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const load = (ws, path) => import(pathToFileURL(join(ws, path)).href);
export function run(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 60000 });
  return { code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}`, stdout: r.stdout || '' };
}
export async function expect(failures, label, fn) {
  try { const ok = await fn(); if (ok !== true) failures.push(`${label}: got ${JSON.stringify(ok)}`); }
  catch (e) { failures.push(`${label}: threw ${e && e.message}`); }
}
