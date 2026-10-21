// The delivery gates as the session meets them: `gh pr ready` and `gh pr create` refused for each
// gate that does not hold, then let through; the reviews a rebase and a fix round owe; pushes of
// the run's branch from any session, also after `lpk run end`.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { hookBash, lens, lpk, repoWith, sh, tmp, write } from './gates-env.mjs';
import { addFinding, markFixed, ruleOn } from '../lib/findings.mjs';
import { appendRecord } from '../lib/records.mjs';
import { readRun } from '../lib/run.mjs';

const head = (repo) => sh(repo, 'rev-parse', 'HEAD').trim();
const base = (repo) => sh(repo, 'merge-base', 'main', 'HEAD').trim();
const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };

// A quick-lane run on `feat` with one command scenario, its change verified and committed.
function quickRun(name, session) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, session, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'grep -q "a = 2" src/a.mjs', '--expect', '', '--verify', 'true'));
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, session, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  return repo;
}

// The quick lane's net on `range`: the CLI's two records and the Bug hunter's transcript.
function quickNet(repo, session, range, hunter = { findings: [] }, id = 'bh1') {
  for (const kind of ['code-review', 'security-review']) appendRecord(repo, { kind, range, model: 'sonnet', exit: 0, findings: 0 });
  lens(session, id, 'lpk:bug-hunter', range, hunter);
}

test('gh pr ready is refused while any gate does not hold, naming each and its way out, then let through', () => {
  const S = 'ready-session';
  const repo = quickRun('ready', S);
  write(repo, 'src/b.mjs', 'export const b = 1;\n');
  let why = hookBash(repo, S, 'gh pr ready');
  assert.match(why, /- verify: code files that are not committed: src\/b\.mjs → add or ignore src\/b\.mjs/);
  assert.match(why, /- reviews: code-review:sonnet on \w{12}\.\.\w{12} \(has not run on it\)/);
  assert.match(why, /- scenarios: S1 not proved on HEAD's tree/);
  write(repo, '.git/info/exclude', 'src/b.mjs\n');

  const range = `${base(repo)}..${head(repo)}`;
  // The Bug hunter returned two findings and only one reached the ledger: it did not run, as far as the gate can tell.
  quickNet(repo, S, range, { findings: [{ claim: 'x' }, { claim: 'y' }] });
  const f = addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'a is 2 for every caller', repro: 'node -e', kind: 'defect', severity: 'important' }).finding;
  why = hookBash(repo, S, 'cd . && gh pr ready');
  assert.match(why, /bug-hunter on \S+ \(ungraded: agent bh1 returned 2 findings, the ledger holds 1\)/);
  assert.match(why, new RegExp(`- findings: open, no verifier ruling: ${f.id}`));
  assert.doesNotMatch(why, /- verify:/);

  addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'b', repro: 'r', kind: 'defect', severity: 'nit' });
  ruleOn(repo, { id: f.id, verdict: 'dropped', basis: 'disproved', evidence: 'callers expect 2', by: 'lpk:verifier' });
  ruleOn(repo, { id: 'F2', verdict: 'dropped', basis: 'disproved', evidence: 'not a defect', by: 'main' });
  why = hookBash(repo, S, 'gh pr ready');
  assert.doesNotMatch(why, /- findings:/, 'a ruling by someone other than the verifier does not block');
  assert.doesNotMatch(why, /- reviews:/);
  assert.match(lpk(repo, S, 'gates').stdout, /^findings +holds .*\n +.*F2 \(dropped by main\)/m);
  assert.match(ok(lpk(repo, S, 'waive', 'gate:scenarios', '--why', 'I am sure')), /not an owner waiver/);

  assert.match(hookBash(repo, S, 'gh pr create --title "Set a" --body x'), /`gh pr create` without --draft on feat is refused[\s\S]*- scenarios:/, 'an agent running lpk waive releases nothing');
  assert.equal(hookBash(repo, S, 'gh pr create --draft --title "Set a" --body x'), null, 'a draft PR is not a handover');
  ok(lpk(repo, S, 'prove', '--all'));
  assert.equal(hookBash(repo, 'another-session', 'gh pr ready'), null);
  const report = ok(lpk(repo, S, 'report'));
  assert.match(report, /^deliverable at \w{12}: every delivery gate holds/);
  assert.match(report, /^- F2 dropped by main: b — not a defect$/m);

  // Handed over: a push of new, unreviewed code to the branch now meets the gates too.
  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 3');
  assert.match(hookBash(repo, S, 'git push'), /a push to a branch handed over for review on feat is refused[\s\S]*- reviews:/);
});

test('after a rebase that leaves every patch unchanged, only lpk verify and the command scenarios are owed', () => {
  const S = 'rebase-session';
  const repo = quickRun('rebase', S);
  quickNet(repo, S, `${base(repo)}..${head(repo)}`);
  ok(lpk(repo, S, 'prove', '--all'));
  assert.equal(lpk(repo, S, 'gates').status, 0);
  sh(repo, 'switch', '-q', 'main'); write(repo, 'README.md', 'docs\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'Docs');
  sh(repo, 'switch', '-q', 'feat'); sh(repo, 'rebase', '-q', 'main');
  const gates = lpk(repo, S, 'gates').stdout;
  assert.match(gates, /verify +DENY/);
  assert.match(gates, /reviews +holds/);
  assert.match(gates, /scenarios +DENY/);
  ok(lpk(repo, S, 'verify'));
  ok(lpk(repo, S, 'prove', '--all'));
  assert.match(ok(lpk(repo, S, 'reviews', 'owed')), /nothing owed/);
  ok(lpk(repo, S, 'gates'));
});

test('a fix commit owes one Sonnet /code-review and the lens whose finding it fixed, on that commit only', () => {
  const S = 'fix-session';
  const repo = quickRun('fix', S);
  const range = `${base(repo)}..${head(repo)}`;
  quickNet(repo, S, range, { findings: [{ claim: 'x' }] });
  const f = addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'a must stay odd', repro: 'r', kind: 'defect', severity: 'important' }).finding;
  ruleOn(repo, { id: f.id, verdict: 'confirmed', evidence: 'repro fails', by: 'lpk:verifier' });
  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  sh(repo, 'commit', '-qam', 'Keep a odd');
  const fix = head(repo);
  markFixed(repo, { id: f.id, commit: fix, closedBy: 'repro', evidence: 'repro green', by: 'main' });
  const owed = lpk(repo, S, 'reviews', 'owed', '--json');
  assert.deepEqual(JSON.parse(owed.stdout).map((r) => [r.lens, r.range, r.why]), [
    ['code-review:sonnet', `${range.split('..')[1].slice(0, 12)}..${fix.slice(0, 12)}`, 'fix delta; has not run on it'],
    ['bug-hunter', `${range.split('..')[1].slice(0, 12)}..${fix.slice(0, 12)}`, 'fix delta; has not run on it'],
  ]);
  quickNet(repo, S, `${range.split('..')[1]}..${fix}`, { findings: [] }, 'bh2');
  assert.match(ok(lpk(repo, S, 'reviews', 'owed')), /nothing owed/);
});

test('a push of the run\'s branch waits for the owner\'s grant, from any session and after the run ends', () => {
  const S = 'push-session';
  const repo = quickRun('push', S);
  assert.match(hookBash(repo, 'someone-else', 'git push -u origin feat'), /the owner has not granted draft pushes/);
  assert.equal(hookBash(repo, S, 'git push -u origin main'), null, 'a branch no run delivers');
  ok(lpk(repo, S, 'run', 'grant', 'draft-push', '--why', 'owner: push drafts here'));
  assert.equal(hookBash(repo, 'someone-else', 'git push -u origin feat'), null);
  write(repo, 'src/a.mjs', 'export const a = 4;\n'); sh(repo, 'commit', '-qam', 'Set a to 4');
  assert.match(hookBash(repo, S, 'git push'), /no green `lpk verify` was recorded/);
  const id = readRun(repo).id;
  assert.match(ok(lpk(repo, S, 'run', 'end', '--abandon', 'owner stopped it')), /ended: owner stopped it/);
  assert.match(hookBash(repo, 'someone-else', 'gh pr ready'), new RegExp(`delivery gates of run ${id} do not hold`), 'the gates key on the branch, not on the open run');
  assert.match(hookBash(repo, 'someone-else', 'gh api -X POST graphql -f query="mutation { markPullRequestReadyForReview(input: {}) { clientMutationId } }"'), /gh pr ready <branch>/);
});

test('after a later run starts, the gates of an ended run read its archived ledger on its branch', () => {
  const S = 'archive-session';
  const repo = quickRun('archived', S);
  const range = `${base(repo)}..${head(repo)}`;
  quickNet(repo, S, range, { findings: [{ claim: 'x' }] });
  const f = addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'a is 2 for every caller', repro: 'r', kind: 'defect', severity: 'important' }).finding;
  ruleOn(repo, { id: f.id, verdict: 'dropped', basis: 'disproved', evidence: 'callers expect 2', by: 'lpk:verifier' });
  ok(lpk(repo, S, 'prove', '--all'));
  const id = readRun(repo).id;
  ok(lpk(repo, S, 'run', 'end'));
  sh(repo, 'switch', '-q', 'main');
  ok(lpk(repo, 'next-session', 'run', 'start', '--verify', 'true'));
  sh(repo, 'switch', '-q', 'feat');
  assert.match(ok(lpk(repo, S, 'gates')), new RegExp(`^run ${id},[\\s\\S]*^findings +holds +ledger: 1 findings of run ${id}`, 'm'));
  assert.equal(hookBash(repo, 'next-session', 'gh pr ready'), null);
});

test('a branch the run never noted is its branch: work merged in after a start on main meets the gates at handover and push, also after the run ends', () => {
  const S = 'merge-session';
  const repo = repoWith('merged', { 'src/a.mjs': 'export const a = 1;\n' });
  sh(repo, 'switch', '-q', 'main');
  ok(lpk(repo, S, 'run', 'start', '--verify', 'true', '--scenario', 'true'));
  sh(repo, 'switch', '-qc', 'slice'); write(repo, 'src/b.mjs', 'export const b = 1;\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'Add b');
  sh(repo, 'switch', '-q', 'main'); sh(repo, 'switch', '-qc', 'work'); sh(repo, 'merge', '-q', '--ff-only', 'slice');
  assert.match(hookBash(repo, S, 'gh pr create --title "Add b" --body x'), /`gh pr create` without --draft on work is refused/);
  assert.match(hookBash(repo, S, 'gh -R owner/repo pr ready work'), /`gh pr ready` on work is refused/);
  assert.match(hookBash(repo, S, 'git push origin work'), /no green `lpk verify` was recorded/);
  assert.equal(hookBash(repo, S, 'git push origin main'), null, 'the target branch is not the run\'s');
  ok(lpk(repo, S, 'run', 'end'));
  assert.match(hookBash(repo, 'someone-else', 'gh pr ready work'), /delivery gates of run \S+ do not hold/);
});

test('a check or a scenario changed by lpk run start voids what the old one proved', () => {
  const S = 'amend-session';
  const repo = quickRun('amend', S);
  ok(lpk(repo, S, 'prove', '--all'));
  const rows = () => lpk(repo, S, 'gates').stdout;
  assert.match(rows(), /^verify\s+holds[\s\S]*^scenarios\s+holds/m);
  ok(lpk(repo, S, 'run', 'start', '--verify', 'false'));
  assert.match(rows(), /^verify\s+DENY/m);
  ok(lpk(repo, S, 'run', 'start', '--verify', 'true', '--scenario', 'test -f nowhere'));
  assert.match(rows(), /^verify\s+holds[\s\S]*^scenarios\s+DENY[^\n]*\n\s+S1 not proved on HEAD's tree/m);
});

test('the owner\'s waiver of gate:error lets through a call the gate cannot decide', () => {
  const S = 'error-session';
  const repo = quickRun('gate-error', S);
  write(tmp, 'broken-gh/gh', '#!/bin/sh\necho "gh: no host" >&2; exit 1\n');
  chmodSync(join(tmp, 'broken-gh', 'gh'), 0o755);
  const env = { PATH: `${join(tmp, 'broken-gh')}:${process.env.PATH}` };
  assert.match(hookBash(repo, S, 'gh pr ready 12', env), /could not decide: .*gh pr view 12[\s\S]*`gate:error`/);
  ok(lpk(repo, S, 'waive', 'gate:error', '--why', 'GitHub is down', '--via', '/lpk-waive'));
  assert.equal(hookBash(repo, S, 'gh pr ready 12', env), null);
});

test('a new file staged before lpk verify is in the tree it verified, so the commit after it holds', () => {
  const S = 'staged-session';
  const repo = repoWith('staged', { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--verify', 'true'));
  write(repo, 'src/new.mjs', 'export const n = 1;\n'); sh(repo, 'add', 'src/new.mjs');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qm', 'Add new');
  assert.match(lpk(repo, S, 'gates').stdout, /^verify\s+holds/m);
});
