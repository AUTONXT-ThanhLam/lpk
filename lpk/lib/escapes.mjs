// The escape ledger: review comments a PR received after lpk delivered it, joined to that run's
// facts by file: was the file in the change, and did the run's ledger hold any finding on it. What
// class of defect a comment names is the agent's reading of its text.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRuns, runsFile } from './runs.mjs';

export const escapesFile = () => join(runsFile(), '..', 'escapes.jsonl');
const gh = (args, cwd) => JSON.parse(execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }) || 'null');

export function readEscapes() {
  if (!existsSync(escapesFile())) return [];
  return readFileSync(escapesFile(), 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
}


// Every comment on the run's PRs after the run was recorded, by `reviewer` (else by anyone but
// the PR's author and bots). Runs whose checkout is gone are listed in `skipped`.
export function escapes({ repo = '', reviewer = '' } = {}) {
  const rows = [], skipped = [];
  for (const run of readRuns().filter((r) => !repo || r.path === repo)) {
    if (!run.path || !existsSync(run.path)) { skipped.push(`${run.id}: checkout ${run.path} is gone`); continue; }
    for (const branch of run.branches || []) {
      let prs;
      try { prs = gh(['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,url,author', '--limit', '5'], run.path) || []; } catch (e) { skipped.push(`${run.id} ${branch}: gh failed (${String(e.stderr || e.message).trim().split('\n')[0]})`); continue; }
      for (const pr of prs) {
        // `--slurp` wraps every page's array in one list.
        for (const c of (gh(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/pulls/${pr.number}/comments`], run.path) || []).flat()) {
          const who = c.user?.login || '';
          if (reviewer ? who !== reviewer : who === pr.author?.login || who.endsWith('[bot]')) continue;
          if (c.created_at <= run.recorded) continue;
          rows.push({
            id: c.id, run: run.id, repo: run.repo, pr: pr.number, url: c.html_url, by: who, at: c.created_at,
            file: c.path, line: c.line ?? c.original_line ?? null, inChange: (run.files || []).includes(c.path),
            ledgerHadFile: (run.findingFiles || []).includes(c.path), body: String(c.body || '').slice(0, 2000),
          });
        }
      }
    }
  }
  return { rows, skipped };
}

// Appends the comments not yet in escapes.jsonl and returns them.
export function recordEscapes(rows) {
  const have = new Set(readEscapes().map((e) => e.id));
  const fresh = rows.filter((r) => !have.has(r.id));
  if (fresh.length) {
    mkdirSync(join(escapesFile(), '..'), { recursive: true });
    appendFileSync(escapesFile(), fresh.map((r) => `${JSON.stringify(r)}\n`).join(''));
  }
  return fresh;
}
