// `lpk statusline`: the run band for Claude Code's status line, from the status line's JSON on stdin
// (session_id, cwd). While this session has an lpk run open (or invoked /lpk), it prints the band
// line: the step track, what waits on the owner, the time worked and tokens. With no run it prints
// nothing. It never computes the band itself: it prints the band `lpk status --write-cache` last
// kept for the session, and when that is older than STALE_MS starts one such refresh in the
// background, detached. Before the first refresh it prints the step track from cheap facts only
// (run.json, the review-start records, brief.md).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bandLines, NAMES, readBand, takeLock } from '../band.mjs';
import { top } from '../git.mjs';
import { PHASES } from '../phase.mjs';
import { readRecords } from '../records.mjs';
import { activeRun, readRun, runDir } from '../run.mjs';

const STALE_MS = 3000;
// A band whose run files are gone stays on screen only this long, while its refresh runs.
const GONE_MS = 10_000;
const BIN = fileURLToPath(new URL('../../bin/lpk', import.meta.url));

function refresh(session, repo) {
  if (!takeLock(session)) return;
  spawn(process.execPath, [BIN, 'status', '--json', '--write-cache', '--session', session, '--repo', repo], { detached: true, stdio: 'ignore', cwd: repo }).unref();
}

// The track from cheap facts: the open run is building until its first review start.
function cheapLine(run, repo, design) {
  const phase = !run ? 'design' : readRecords(repo, { run: run.id }).some((r) => r.kind === 'review-start') ? 'review' : 'build';
  const at = PHASES.indexOf(phase);
  const track = PHASES.filter((p, i) => i >= at ? !(p === 'design' && run?.lane === 'quick') : p === 'understand' || (p === 'design' && design));
  const view = { track: track.map((p, i) => ({ name: NAMES[p], state: p === phase ? 'current' : i < track.indexOf(phase) ? 'visited' : 'next' })), quiet: '', waits: '', head: '', detail: '', rows: [] };
  return bandLines({ view })[0];
}

export function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return 0; }
  const session = String(input.session_id || '');
  if (!session) return 0;
  const cwd = input.workspace?.current_dir || input.cwd || process.cwd();
  let run = activeRun(session, false, cwd);
  const repo = run?.repo || top(cwd);
  if (!repo) return 0;
  // A run no hook has bound to a session yet belongs to the session working in its repo.
  if (!run) { const r = readRun(repo, session); if (r && (!r.session || r.session === session)) run = r; }
  const design = existsSync(join(runDir(repo, session), 'brief.md'));
  const files = Boolean(run) || design;
  const band = readBand(session);
  const age = band ? Date.now() - band.at : Infinity;
  if ((files || band?.status?.open) && age > STALE_MS) refresh(session, repo);
  let lines = [];
  if (band?.status?.open && (files || age < GONE_MS)) lines = bandLines(band.status);
  else if (!band && files) lines = [cheapLine(run, repo, design)];
  if (lines.length) process.stdout.write(lines.join('\n'));
  return 0;
}
