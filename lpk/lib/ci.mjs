// CI facts for a PR, per failing job: is the same job red on the target branch's latest run too, red
// only here, or did it flip on a rerun. Read from `gh`; what a red job means is the agent's reading.
import { execFileSync } from 'node:child_process';

const RED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure']);
const gh = (args, cwd) => JSON.parse(execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }) || 'null');

const jobsOf = (cwd, id, attempt) => gh(['run', 'view', String(id), ...(attempt ? ['--attempt', String(attempt)] : []), '--json', 'jobs,attempt'], cwd)?.jobs || [];

// The conclusion of each job (by name) in every earlier attempt of the run.
function earlier(cwd, run) {
  const out = [];
  for (let k = 1; k < (run.attempt || 1); k++) for (const j of jobsOf(cwd, run.databaseId, k)) out.push({ attempt: k, name: j.name, conclusion: j.conclusion });
  return out;
}

// The latest completed run of the same workflow on the target branch, by job name.
function targetJobs(cwd, branch, workflow, cache) {
  const key = `${branch}\0${workflow}`;
  if (!cache.has(key)) {
    const [run] = gh(['run', 'list', '--branch', branch, '--workflow', workflow, '--status', 'completed', '--limit', '1', '--json', 'databaseId,headSha'], cwd) || [];
    cache.set(key, run ? { sha: run.headSha, jobs: new Map(jobsOf(cwd, run.databaseId).map((j) => [j.name, j.conclusion])) } : null);
  }
  return cache.get(key);
}

export function ciFacts(cwd, pr) {
  const p = gh(['pr', 'view', String(pr), '--json', 'number,headRefOid,baseRefName,url'], cwd);
  const runs = gh(['run', 'list', '--commit', p.headRefOid, '--limit', '100', '--json', 'databaseId,workflowName,status,conclusion,attempt'], cwd) || [];
  const pending = runs.filter((r) => r.status !== 'completed').map((r) => r.workflowName);
  const cache = new Map();
  const jobs = [];
  for (const run of runs.filter((r) => r.status === 'completed')) {
    const now = jobsOf(cwd, run.databaseId);
    const before = earlier(cwd, run);
    for (const j of now) {
      const past = before.filter((b) => b.name === j.name);
      const flipped = past.find((b) => RED.has(b.conclusion) !== RED.has(j.conclusion));
      if (!RED.has(j.conclusion) && !flipped) continue;
      const row = { workflow: run.workflowName, job: j.name, run: run.databaseId, attempt: run.attempt || 1, conclusion: j.conclusion };
      if (flipped) row.verdict = `flipped on rerun (${flipped.conclusion} on attempt ${flipped.attempt}, ${j.conclusion} on attempt ${row.attempt})`;
      else {
        const t = targetJobs(cwd, p.baseRefName, run.workflowName, cache);
        const there = t?.jobs.get(j.name);
        row.verdict = !t ? `red only here (no completed ${run.workflowName} run on ${p.baseRefName})`
          : RED.has(there) ? `red on ${p.baseRefName} latest too (${t.sha.slice(0, 12)}: ${there})`
            : `red only here (${p.baseRefName} latest ${t.sha.slice(0, 12)}: ${there || 'no such job'})`;
        if (row.attempt === 1) row.rerun = `gh run rerun ${run.databaseId} --failed`;
      }
      row.onlyHere = row.verdict.startsWith('red only here');
      jobs.push(row);
    }
  }
  return { pr: p.number, url: p.url, head: p.headRefOid, base: p.baseRefName, runs: runs.length, pending, jobs };
}
