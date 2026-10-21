// The verbs that read GitHub through `gh`: CI per failing job, and the review comments that
// reached a delivered PR afterwards.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, ghAnswers, lpk, repoWith, write } from './verbs-env.mjs';

test('lpk ci tells a job red on main too from one red only here and one that flipped on a rerun, and records it', () => {
  const repo = repoWith('ci', { 'a.js': 'a\n' });
  const jobs = (...js) => ({ jobs: js.map(([name, conclusion]) => ({ name, conclusion })), attempt: 1 });
  ghAnswers({
    'pr view 7 --json number,headRefOid,baseRefName,url': { number: 7, headRefOid: 'f'.repeat(40), baseRefName: 'main', url: 'u' },
    [`run list --commit ${'f'.repeat(40)} --limit 100 --json databaseId,workflowName,status,conclusion,attempt`]: [
      { databaseId: 1, workflowName: 'test', status: 'completed', conclusion: 'failure', attempt: 1 },
      { databaseId: 2, workflowName: 'e2e', status: 'completed', conclusion: 'failure', attempt: 2 },
      { databaseId: 3, workflowName: 'lint', status: 'in_progress', conclusion: '', attempt: 1 },
    ],
    'run view 1 --json jobs,attempt': jobs(['unit', 'failure'], ['types', 'failure'], ['build', 'success']),
    'run view 2 --json jobs,attempt': jobs(['browser', 'failure']),
    'run view 2 --attempt 1 --json jobs,attempt': jobs(['browser', 'success']),
    'run list --branch main --workflow test --status completed --limit 1 --json databaseId,headSha': [{ databaseId: 9, headSha: 'a'.repeat(40) }],
    'run view 9 --json jobs,attempt': jobs(['unit', 'failure'], ['types', 'success']),
  });
  const r = lpk(repo, 'ci', '7');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /still running: lint/);
  assert.match(r.stdout, /test \/ unit: red on main latest too \(aaaaaaaaaaaa: failure\)/);
  assert.match(r.stdout, /test \/ types: red only here \(main latest aaaaaaaaaaaa: success\); to see if it flips: gh run rerun 1 --failed/);
  assert.match(r.stdout, /e2e \/ browser: flipped on rerun \(success on attempt 1, failure on attempt 2\)/);
  assert.doesNotMatch(r.stdout, /build/);
  const rec = readFileSync(join(repo, '.git', 'lpk', 'records.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.equal(rec.kind, 'ci');
  assert.equal(rec.exit, 1, 'a job red only here makes the record red');
  assert.deepEqual(rec.jobs.filter((j) => j.onlyHere).map((j) => j.job), ['types']);
});

test('lpk escapes keeps the reviewer\'s comments made after delivery, joined by file to the run\'s change and ledger', () => {
  const repo = repoWith('escapes', { 'a.js': 'a\n' });
  write(ENV.XDG_DATA_HOME, 'lpk/runs.jsonl', `${JSON.stringify({ id: 'r1', repo: 'escapes', path: repo, branches: ['feat'], recorded: '2026-10-01T00:00:00Z', files: ['a.js', 'b.js'], findingFiles: ['a.js'] })}\n`);
  const c = (id, path, login, at) => ({ id, path, line: 3, user: { login }, created_at: at, body: `comment ${id}\nmore`, html_url: `u${id}` });
  ghAnswers({
    'pr list --head feat --state all --json number,url,author --limit 5': [{ number: 4, url: 'pr', author: { login: 'me' } }],
    'api --paginate --slurp repos/{owner}/{repo}/pulls/4/comments': [[c(1, 'a.js', 'lead', '2026-10-02T00:00:00Z'), c(2, 'b.js', 'lead', '2026-10-03T00:00:00Z')], [c(3, 'c.js', 'lead', '2026-10-03T00:00:00Z'), c(4, 'a.js', 'lead', '2026-09-30T00:00:00Z'), c(5, 'a.js', 'me', '2026-10-03T00:00:00Z')]],
  });
  const r = lpk(repo, 'escapes', '--reviewer', 'lead');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^3 comment\(s\) after delivery by lead on .*; 3 new/);
  assert.match(r.stdout, /escapes#4 a\.js:3 by lead 2026-10-02: file in the change, ledger had a finding on it \| comment 1\n/);
  assert.match(r.stdout, /escapes#4 b\.js:3 by lead 2026-10-03: file in the change, NO ledger finding on it/);
  assert.match(r.stdout, /escapes#4 c\.js:3 by lead 2026-10-03: file NOT in the change/);
  assert.match(lpk(repo, 'escapes', '--reviewer', 'lead').stdout, /; 0 new/, 'a comment is kept once');
  assert.equal(readFileSync(join(ENV.XDG_DATA_HOME, 'lpk', 'escapes.jsonl'), 'utf8').trim().split('\n').length, 3);
});
