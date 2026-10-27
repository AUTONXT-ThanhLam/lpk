import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, HOME, hook, lpk, repoWith, sh, startRun, write } from './hooks-env.mjs';
import { markerOf } from '../lib/run.mjs';

const registry = () => { const d = join(ENV.XDG_STATE_HOME, 'lpk', 'active'); return readdirSync(d).map((n) => readFileSync(join(d, n), 'utf8').trim()); };
const exited = (session) => {
  const file = join(HOME, '.claude', 'projects', 'p', `${session}.jsonl`);
  write(HOME, `.claude/projects/p/${session}.jsonl`, '{}\n');
  const old = new Date(Date.now() - 24 * 3600 * 1000);
  utimesSync(file, old, old);
};
const live = (session, pid) => write(HOME, `.claude/sessions/${pid}.json`, JSON.stringify({ pid, sessionId: session }));
const heldBy = (repo) => JSON.parse(readFileSync(markerOf(repo), 'utf8'));
const startup = (session, cwd) => hook('SessionStart', 'start', { cwd, session_id: session, source: 'startup' }, undefined);
const text = (card) => card?.hookSpecificOutput.additionalContext ?? '';

test('a new session opens in a repo and continues the run of a session that has exited', () => {
  const repo = repoWith('continue-open', { 'a.txt': '1\n' });
  startRun(repo, 'gone-1');
  exited('gone-1');
  live('new-1', process.pid);
  assert.match(text(startup('new-1', repo)), /you are inside an lpk run in .*continue-open/);
  assert.equal(heldBy(repo).session, 'new-1');
  assert.deepEqual(heldBy(repo).previous, ['gone-1']);
  assert.ok(registry().includes(markerOf(repo)), 'the run stays registered');
});

test('a run whose session still lives is left to it', () => {
  const repo = repoWith('continue-live', { 'a.txt': '1\n' });
  startRun(repo, 'live-2');
  live('live-2', process.ppid);
  live('new-2', process.pid);
  assert.equal(text(startup('new-2', repo)), '');
  assert.equal(heldBy(repo).session, 'live-2');
});

test('the run that delivered the branch is reopened by `lpk run take`, and its waiver works before and after', () => {
  const repo = repoWith('continue-ended', { 'a.txt': '1\n' });
  startRun(repo, 'gone-3');
  exited('gone-3');
  assert.equal(lpk(repo, 'gone-3', 'run', 'end').status, 0);
  live('new-3', process.pid);
  assert.match(text(startup('new-3', repo)), /feat was delivered by run \S+.*lpk run take/s);
  const w = lpk(repo, 'new-3', 'waive', 'gate:verify', '--why', 'owner', '--via', '/lpk-waive');
  assert.equal(w.status, 0, w.stderr);
  assert.equal(existsSync(markerOf(repo)), false, 'waiving does not reopen the run');
  const t = lpk(repo, 'new-3', 'run', 'take');
  assert.equal(t.status, 0, t.stderr);
  assert.equal(heldBy(repo).session, 'new-3');
  assert.ok(registry().includes(markerOf(repo)), 'and is registered again');
  assert.match(lpk(repo, 'new-3', 'gates').stdout, /^verify +holds[\s\S]*waived by the owner/m);
  assert.equal(lpk(repo, 'new-3', 'run', 'end').status, 0);
  sh(repo, 'switch', '-qc', 'other');
  assert.match(lpk(repo, 'new-3', 'run', 'take').stderr, /no ended run here delivered other/);
});

test('several runs left open below a repo are listed for the owner to choose, not taken', () => {
  const repo = repoWith('continue-many', { 'a.txt': '1\n' });
  const wts = ['one', 'two'].map((n) => {
    const wt = join(repo, '..', `continue-many-${n}`);
    sh(repo, 'worktree', 'add', '-q', '-b', `feat-${n}`, wt, 'main');
    startRun(wt, 'gone-4');
    exited('gone-4');
    return wt;
  });
  live('new-4', process.pid);
  const card = text(startup('new-4', repo));
  assert.match(card, /2 open runs here lost the session that held them/);
  for (const wt of wts) assert.ok(card.includes(wt), `names ${wt}`);
  for (const wt of wts) assert.equal(heldBy(wt).session, 'gone-4');
});

test('a run whose session left no trace in this host\'s store is not taken from a session that may live elsewhere', () => {
  const repo = repoWith('continue-elsewhere', { 'a.txt': '1\n' });
  startRun(repo, 'elsewhere-5');
  live('new-5', process.pid);
  assert.equal(text(startup('new-5', repo)), '');
  assert.equal(heldBy(repo).session, 'elsewhere-5');
});
