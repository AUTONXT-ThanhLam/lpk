import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sessionId } from './host.mjs';
import { ACTIVE, currentBranch, endedRuns, runDir, writeRun } from './run.mjs';
import { activeFile } from './where.mjs';

export function endedHere(repo) {
  const branch = currentBranch(repo);
  return branch ? endedRuns(repo).find((r) => r.branches?.includes(branch)) || null : null;
}

export function reopenRun(repo, session = sessionId()) {
  const last = endedHere(repo);
  if (!last) {
    return { error: endedRuns(repo).length ? `no ended run here delivered ${currentBranch(repo) || 'this checkout'}; \`lpk run start\` begins a new one` : 'no open run to take' };
  }
  const from = join(runDir(repo), 'runs', last.id);
  const marker = join(runDir(repo), 'run.json');
  const { marker: _, ended, endedAt, abandon, ...run } = last;
  for (const f of ['brief.md', 'brief.json']) if (existsSync(join(from, f))) renameSync(join(from, f), join(dirname(marker), f));
  const reopened = { ...run, marker, previous: [...(run.previous || []), ...(run.session && run.session !== session ? [run.session] : [])], ...(session ? { session } : {}) };
  writeRun(reopened);
  rmSync(join(from, 'run.json'), { force: true });
  mkdirSync(ACTIVE, { recursive: true });
  writeFileSync(activeFile(marker), marker);
  return { run: reopened, reopened: true };
}
