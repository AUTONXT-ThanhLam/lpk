import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { top } from './git.mjs';
import { lastSeen, sessionPid } from './sessions.mjs';
import { ACTIVE, activeFile, markerOf, parse, registered } from './where.mjs';

export const STALE = 3 * 24 * 3600 * 1000;

export function sweepStale() {
  for (const { file, run } of registered()) {
    if (!run?.session || sessionPid(run.session)) continue;
    let used = 0;
    try { used = statSync(file).mtimeMs; } catch { continue; }
    const at = Math.max(used, lastSeen(run.session));
    if (Date.now() - at > STALE) rmSync(file, { force: true });
  }
}

export function touchPointer(run) {
  const now = new Date();
  try { utimesSync(activeFile(run.marker), now, now); } catch { /* not registered */ }
}

export function ensureRegistered(input) {
  const repo = top(input.cwd || '.');
  const marker = repo && markerOf(repo, input.session_id);
  if (!marker || existsSync(activeFile(marker))) return;
  const { run } = parse(marker);
  if (!run || run.session !== input.session_id) return;
  mkdirSync(ACTIVE, { recursive: true });
  writeFileSync(activeFile(marker), marker);
}
