import assert from 'node:assert/strict';
import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendRecord } from '../lib/records.mjs';
import { ghAnswers, lpk, repoWith } from './verbs-env.mjs';

const FIELDS = 'number,url,state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefName';
const URL1 = 'https://github.com/o/r/pull/7';
const pr = (over) => ({ number: 7, url: URL1, state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', baseRefName: 'main', headRefName: 'feat', ...over });
const listed = (...prs) => ({ [`pr list --head feat --state open --json ${FIELDS}`]: prs });
const started = (name) => {
  const repo = repoWith(name, { 'a.js': 'a\n' });
  const r = lpk(repo, 'run', 'start', '--verify', 'true');
  assert.equal(r.status, 0, r.stderr);
  return repo;
};
const status = (repo) => JSON.parse(lpk(repo, 'run', 'status').stdout);
const promptsFile = (repo) => join(repo, '.git', 'lpk', readdirSync(join(repo, '.git', 'lpk'), { recursive: true }).find((f) => f.endsWith('prompts.jsonl')));

test('lpk run end lists the run\'s PRs, each against its own base, and ends when none is in conflict', () => {
  const repo = started('end-prs-ok');
  ghAnswers(listed(pr({ mergeStateStatus: 'BEHIND', baseRefName: 'stack-base' }), pr({ number: 8, url: 'https://github.com/o/r/pull/8', isDraft: true })));
  const r = lpk(repo, 'run', 'end');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`${URL1}: ready, mergeable MERGEABLE, behind stack-base`));
  assert.match(r.stdout, /pull\/8: draft, mergeable MERGEABLE, not behind main/);
  assert.match(r.stdout, /lpk run ended/);
});

test('lpk run end refuses a draft PR once the owner asked for ready, and the run stays open', () => {
  const repo = started('end-prs-draft');
  assert.equal(lpk(repo, 'run', 'grant', 'ready', '--why', 'push lên và chuyển sang ready').status, 0);
  ghAnswers(listed(pr({ isDraft: true })));
  const r = lpk(repo, 'run', 'end');
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(`${URL1} \\(it is still a draft, and the owner asked for it ready\\)`));
  assert.ok(status(repo).id, 'the run is still open');
  ghAnswers(listed(pr()));
  assert.equal(lpk(repo, 'run', 'end').status, 0, 'ready now');
});

test('lpk run end refuses a conflicting PR until the owner waives it or the run is abandoned', () => {
  const repo = started('end-prs-conflict');
  ghAnswers(listed(pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })));
  const r = lpk(repo, 'run', 'end');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /conflicts with main/);
  assert.match(r.stderr, new RegExp(`pr:${URL1}`));
  appendRecord(repo, { kind: 'waiver', what: `pr:${URL1}`, question: 'q', run: status(repo).id, exit: 0 });
  assert.equal(lpk(repo, 'run', 'end').status, 0, 'the owner released it');
});

test('lpk run end also reads a PR the owner named in a message', () => {
  const repo = started('end-prs-named');
  const other = 'https://github.com/o/other/pull/9';
  ghAnswers({ ...listed(), [`pr view ${other} --json ${FIELDS}`]: pr({ url: other, mergeable: 'CONFLICTING' }) });
  appendFileSync(promptsFile(repo), `${JSON.stringify({ at: 'x', prompt: `see ${other}` })}\n`);
  const r = lpk(repo, 'run', 'end');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /other\/pull\/9/);
});
