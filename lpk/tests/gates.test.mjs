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
  assert.equal(lpk(repo, S, 'waive', 'F2', '--why', 'I read it', '--via', '/lpk-waive').status, 2, 'a finding id is not waived');

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
  ruleOn(repo, { id: f.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'repro fails', by: 'lpk:verifier' });
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
  assert.match(lpk(repo, S, 'report').stdout, /^Confirmed defects by the step they began in: build 1$/m);
});

test('a fix closed in a builder\'s worktree and cherry-picked owes only the fix delta once it is closed on the pick', () => {
  const S = 'pick-session';
  const repo = quickRun('pick', S);
  const range = `${base(repo)}..${head(repo)}`;
  quickNet(repo, S, range, { findings: [{ claim: 'x' }] });
  const f = addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'a must stay odd', repro: 'r', kind: 'defect', severity: 'important' }).finding;
  ruleOn(repo, { id: f.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'repro fails', by: 'lpk:verifier' });
  const wt = join(tmp, 'pick-fix-1');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feat-fix-1', wt, 'HEAD');
  write(wt, 'src/a.mjs', 'export const a = 3;\n'); sh(wt, 'commit', '-qam', 'Keep a odd');
  const built = head(wt);
  assert.ok(markFixed(wt, { id: f.id, commit: built, closedBy: 'repro', evidence: 'repro green', by: 'main' }).finding);
  sh(repo, 'cherry-pick', '-x', built);
  const picked = head(repo);
  const owedOn = () => JSON.parse(lpk(repo, S, 'reviews', 'owed', '--json').stdout).map((r) => r.why);
  assert.ok(owedOn().every((why) => !/fix delta/.test(why)), 'the pick is unreviewed new work until the fix follows it');
  assert.equal(markFixed(repo, { id: f.id, commit: picked, closedBy: 'repro', evidence: 'repro green on the pick', by: 'main' }).finding.fixedCommit, picked);
  assert.deepEqual(owedOn(), ['fix delta; has not run on it', 'fix delta; has not run on it']);
});

test('a confirmed finding the owner defers holds no gate and is listed as a known limit', () => {
  const S = 'defer-session';
  const repo = quickRun('defer', S);
  const range = `${base(repo)}..${head(repo)}`;
  const f = addFinding(repo, { from: 'lpk:bug-hunter', at: range, claim: 'the tooltip truncates a long name', repro: 'r', kind: 'defect', severity: 'nit' }).finding;
  ruleOn(repo, { id: f.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'a fixed width', evidence: 'seen', by: 'lpk:verifier' });
  assert.match(lpk(repo, S, 'gates').stdout, /findings[\s\S]*confirmed and not fixed: F1/);
  ok(lpk(repo, S, 'finding', 'fixed', f.id, '--closed-by', 'owner', '--evidence', 'owner: skip what users cannot reach'));
  const report = lpk(repo, S, 'report').stdout;
  assert.match(report, /^findings +holds/m);
  assert.match(report, /^Known limits, not fixed \(for the PR body\):\n- F1 defect\/nit: the tooltip truncates a long name — owner: skip what users cannot reach$/m);
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
  ok(lpk(repo, S, 'run', 'end'));
  sh(repo, 'switch', '-q', 'main');
  ok(lpk(repo, 'next-session', 'run', 'start', '--verify', 'true'));
  sh(repo, 'switch', '-q', 'feat');
  assert.equal(hookBash(repo, 'next-session', 'gh pr ready'), null);
  // A query judges the open run, and adopts no branch into it.
  const next = readRun(repo).id;
  assert.match(lpk(repo, 'next-session', 'gates').stdout, new RegExp(`^run ${next},`));
  sh(repo, 'switch', '-qc', 'scratch');
  for (const verb of [['gates'], ['report'], ['reviews', 'owed']]) lpk(repo, 'next-session', ...verb);
  assert.deepEqual(readRun(repo).branches, []);
});

test('a finding an ended run left confirmed holds its branch, and once a later run archives it only the owner can release it', () => {
  const S = 'stuck-session';
  const repo = quickRun('stuck', S);
  const range = `${base(repo)}..${head(repo)}`;
  quickNet(repo, S, range, { findings: [{ claim: 'x' }] });
  const f = addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'a must stay odd', repro: 'r', kind: 'defect', severity: 'important' }).finding;
  ruleOn(repo, { id: f.id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'repro fails', by: 'lpk:verifier' });
  ok(lpk(repo, S, 'prove', '--all'));
  ok(lpk(repo, S, 'run', 'end'));
  assert.match(hookBash(repo, S, 'gh pr ready'), /- findings: confirmed and not fixed: F1 → [^\n]*finding_fixed/, 'its ledger is still live');
  sh(repo, 'switch', '-q', 'main');
  ok(lpk(repo, 'next-session', 'run', 'start', '--verify', 'true'));
  sh(repo, 'switch', '-q', 'feat');
  const why = hookBash(repo, S, 'gh pr ready');
  assert.match(why, /- findings: confirmed and not fixed: F1 → [^\n]*gate:findings/);
  assert.doesNotMatch(why, /finding_fixed|have a verifier rule/);
  assert.match(markFixed(repo, { id: 'F1', commit: head(repo), closedBy: 'repro', evidence: 'x', by: 'main' }).error, /no finding F1/);
});

test('an unsettled finding shows the owner the ruling asked and the area that kept it open, and the gate row names its id first', () => {
  const S = 'unsettled-session';
  const repo = quickRun('unsettled', S);
  const range = `${base(repo)}..${head(repo)}`;
  quickNet(repo, S, range, { findings: [{ claim: 'x' }] });
  addFinding(repo, { from: 'lpk:bug-hunter', agentId: 'bh1', at: range, claim: 'the cookie is readable', repro: 'r', kind: 'defect', severity: 'important', area: 'security' });
  assert.equal(ruleOn(repo, { id: 'F1', verdict: 'dropped', basis: 'not-reproduced', evidence: 'the repro passed', by: 'lpk:verifier' }).finding.state, 'unsettled');
  assert.match(lpk(repo, S, 'report').stdout, /^- F1 unsettled \([^)]*dropped[^)]*not-reproduced[^)]*security\)[^\n]*the cookie is readable/m);
  const row = JSON.parse(lpk(repo, S, 'gates', '--json').stdout).find((r) => r.gate === 'findings');
  assert.deepEqual([row.holds, row.why.slice(0, 2)], [true, 'F1']);
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

test('the owner\'s grant reaches the run that delivers the branch after that run has ended', () => {
  const S = 'ended-push-session';
  const repo = quickRun('ended-push', S);
  ok(lpk(repo, S, 'run', 'end'));
  assert.match(hookBash(repo, 'another-session', 'git push -u origin feat'), /the owner has not granted draft pushes/);
  assert.match(ok(lpk(repo, 'another-session', 'run', 'grant', 'draft-push', '--why', 'owner: push it')), /draft pushes granted in run/);
  assert.equal(hookBash(repo, 'another-session', 'git push -u origin feat'), null);
});

test('a branch whose run lives in its own worktree meets the gates when pushed from the main checkout', () => {
  const repo = repoWith('wt-push', { 'src/a.mjs': 'export const a = 1;\n' });
  const wt = join(tmp, 'wt-push-w');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feat-w', wt, 'main');
  ok(lpk(wt, 'w', 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'true', '--verify', 'true'));
  write(wt, 'src/a.mjs', 'export const a = 2;\n'); sh(wt, 'commit', '-qam', 'Set a to 2');
  assert.match(hookBash(repo, 'other', 'git push -u origin feat-w'), /the owner has not granted draft pushes/);
  assert.match(hookBash(repo, 'other', 'gh pr ready feat-w'), /delivery gates of run/);
});
