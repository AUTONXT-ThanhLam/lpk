// The findings ledger a run keeps: what a reviewer records, what a verifier rules, what a fix
// closes with its evidence, and which rulings the owner reads.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCOPE } from '../lib/reach.mjs';
import { addFinding, archiveLedger, counts, ledgerFile, markFixed, needsOwner, readLedger, resetLedger, ruleOn, VERIFIER } from '../lib/findings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'lpk-findings-')));
after(() => rmSync(tmp, { recursive: true, force: true }));

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const lpk = (cwd, ...args) => execFileSync('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: ENV, encoding: 'utf8' });
const commit = (repo, text) => {
  writeFileSync(join(repo, 'f.txt'), `${text}\n`, { flag: 'a' });
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', text);
  return sh(repo, 'rev-parse', 'HEAD').trim();
};

// A repo with an lpk run open on its first commit, as run.json v2 describes one.
function repoWithRun(name, run = {}) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  const head = commit(dir, 'init');
  const lpkDir = join(dir, '.git', 'lpk');
  mkdirSync(lpkDir, { recursive: true });
  writeFileSync(join(lpkDir, 'run.json'), JSON.stringify({ v: 2, id: 'run1', repo: dir, session: 's1', reviewRange: head, started: Date.now(), ...run }));
  return { dir, head };
}
const raise = (repo, at, extra = {}) => addFinding(repo, { from: 'lpk:bug-hunter', at, claim: 'the guard fails open', repro: 'run it, it prints ok', kind: 'defect', severity: 'important', ...extra });

test('the ledger is one append-only file in the repo common dir, shared by every worktree', () => {
  const { dir, head } = repoWithRun('shared');
  sh(dir, 'worktree', 'add', '--detach', '-q', join(tmp, 'shared-review'), 'HEAD');
  assert.equal(ledgerFile(join(tmp, 'shared-review')), join(dir, '.git', 'lpk', 'findings.jsonl'));
  const f = raise(join(tmp, 'shared-review'), head, { file: 'a.ts', line: 4 }).finding;
  assert.deepEqual([f.id, f.run, f.state], ['F1', 'run1', 'open']);
  ruleOn(dir, { id: 'F1', verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'exit 1 on the commit', by: VERIFIER });
  const lines = readFileSync(ledgerFile(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.ev), ['add', 'verdict']);
  assert.equal(lines[0].finding.claim, 'the guard fails open');
  assert.equal(readLedger(dir).findings[0].state, 'confirmed');
});

test('a finding with an unknown field, a bad kind, no stamp or no run is refused with the reason', () => {
  const { dir, head } = repoWithRun('strict');
  assert.match(raise(dir, head, { verdict: 'confirmed' }).error, /unknown field verdict/);
  assert.match(raise(dir, head, { kind: 'bug' }).error, /kind is one of defect/);
  assert.match(raise(dir, head, { severity: 'high' }).error, /severity is one of important, nit/);
  assert.match(raise(dir, head, { kind: 'rule' }).error, /ruleId/);
  assert.match(raise(dir, head, { from: '' }).error, /from: /);
  assert.match(raise(dir, '').error, /at: the reviewed range/);
  assert.match(raise(dir, head, { run: 'run0' }).error, /stamped for run run0, but the run .* is run1/);
  assert.match(ruleOn(dir, { id: 'F1', verdict: 'wrong', evidence: 'x', by: VERIFIER }).error, /verdict is one of/);
  rmSync(join(dir, '.git', 'lpk', 'run.json'));
  assert.match(raise(dir, head).error, /no lpk run/);
  assert.deepEqual(readLedger(dir).findings, []);
});

test('only the verifier drops a finding on its own; anyone else\'s drop is marked for the owner to read', () => {
  const { dir, head } = repoWithRun('rulings');
  raise(dir, head); raise(dir, head);
  assert.match(ruleOn(dir, { id: 'F1', verdict: 'dropped', evidence: 'the guard returns early', by: 'main' }).error, /basis/);
  const lead = ruleOn(dir, { id: 'F1', verdict: 'dropped', basis: 'disproved', evidence: 'the guard returns early', by: 'main' }).finding;
  assert.equal(lead.by, 'main');
  assert.equal(needsOwner(lead), true);
  const verifier = ruleOn(dir, { id: 'F1', verdict: 'dropped', basis: 'disproved', evidence: 'repro exits 0 on commit', by: VERIFIER }).finding;
  assert.equal(needsOwner(verifier), false);
  assert.match(ruleOn(dir, { id: 'F1', verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'on second look', by: 'main' }).error, /already dropped by the verifier/);
  assert.equal(needsOwner(ruleOn(dir, { id: 'F2', verdict: 'preexisting', evidence: 'fails on base too', by: 'main' }).finding), true);
});

test('in a protected area a verifier that could not reproduce leaves the finding unsettled', () => {
  const { dir, head } = repoWithRun('protected');
  raise(dir, head, { area: 'auth' });
  raise(dir, head);
  const auth = ruleOn(dir, { id: 'F1', verdict: 'dropped', basis: 'not-reproduced', evidence: 'repro exits 0', by: VERIFIER }).finding;
  assert.deepEqual([auth.state, auth.asked, needsOwner(auth)], ['unsettled', 'dropped', true]);
  assert.equal(ruleOn(dir, { id: 'F2', verdict: 'dropped', basis: 'not-reproduced', evidence: 'repro exits 0', by: VERIFIER }).finding.state, 'dropped');
  assert.equal(raise(dir, head, { from: 'lpk:security' }).finding.area, 'security');
  assert.match(raise(dir, head, { area: 'ui' }).error, /area is one of/);
});

test('a duplicate closes with its primary, and a fix closes only with a later commit and its evidence', () => {
  const { dir, head } = repoWithRun('closure');
  raise(dir, head); raise(dir, head);
  assert.match(ruleOn(dir, { id: 'F2', verdict: 'duplicate', evidence: 'same line', by: VERIFIER, primary: 'F2' }).error, /primary/);
  ruleOn(dir, { id: 'F2', verdict: 'duplicate', evidence: 'same line', by: VERIFIER, primary: 'F1' });
  ruleOn(dir, { id: 'F1', verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'exit 1', by: VERIFIER });
  assert.deepEqual([counts(readLedger(dir).findings).confirmed, counts(readLedger(dir).findings).fixed], [2, 0]);

  const fix = { id: 'F1', fix: 'guard closed', closedBy: 'test', evidence: 'guard.test fails on fix^, passes on fix', by: 'lpk:builder' };
  assert.match(markFixed(dir, { ...fix, commit: head }).error, /raised on/);
  assert.match(markFixed(dir, { ...fix, commit: 'deadbeef' }).error, /not a commit/);
  assert.match(markFixed(dir, { ...fix, commit: head, closedBy: 'said-so' }).error, /closedBy is one of repro, test, verifier, owner/);
  assert.match(markFixed(dir, { ...fix, commit: head, evidence: '' }).error, /evidence/);
  const sha = commit(dir, 'fix');
  const fixed = markFixed(dir, { ...fix, commit: sha.slice(0, 10) }).finding;
  assert.deepEqual([fixed.state, fixed.fixedCommit, fixed.closedBy, needsOwner(fixed)], ['fixed', sha, 'test', false]);
  const c = counts(readLedger(dir).findings);
  assert.deepEqual([c.fixed, c.confirmed, c.duplicate], [2, 0, 1]);
  assert.match(markFixed(dir, { ...fix, commit: sha }).error, /which is on HEAD/);

  raise(dir, head);
  ruleOn(dir, { id: 'F3', verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'the PR body says 3 retries, code does 2', by: VERIFIER });
  const docs = markFixed(dir, { id: 'F3', commit: sha, closedBy: 'verifier', evidence: 'body now says 2', by: 'main' }).finding;
  assert.equal(needsOwner(docs), true);

  raise(dir, head); raise(dir, head);
  ruleOn(dir, { id: 'F5', verdict: 'duplicate', evidence: 'same claim', by: VERIFIER, primary: 'F4' });
  ruleOn(dir, { id: 'F4', verdict: 'duplicate', evidence: 'same claim', by: VERIFIER, primary: 'F3' });
  assert.deepEqual([counts(readLedger(dir).findings).fixed, counts(readLedger(dir).findings).duplicate], [5, 3]);
});

test('a fix closed on a builder\'s commit moves to its cherry-pick on the branch, and nowhere else', () => {
  const { dir, head } = repoWithRun('repoint');
  raise(dir, head);
  ruleOn(dir, { id: 'F1', verdict: 'confirmed', reach: 'user', born: 'build', cause: 'the guard reads the wrong flag', evidence: 'exit 1', by: VERIFIER });
  const fix = { id: 'F1', closedBy: 'test', evidence: 'guard.test fails on fix^, passes on fix', by: 'main' };
  sh(dir, 'switch', '-qc', 'builder');
  const built = commit(dir, 'fix');
  assert.equal(markFixed(dir, { ...fix, commit: built }).finding.fixedCommit, built);
  sh(dir, 'switch', '-q', 'main');
  assert.match(markFixed(dir, { ...fix, commit: built }).error, /is not on HEAD/);
  sh(dir, 'cherry-pick', '-x', built);
  const picked = sh(dir, 'rev-parse', 'HEAD').trim();
  assert.equal(markFixed(dir, { ...fix, commit: picked }).finding.fixedCommit, picked);
  assert.match(markFixed(dir, { ...fix, commit: picked }).error, /which is on HEAD/);
});

test('the owner\'s stated policy defers a confirmed finding with their words, never one in a protected area or a failing scenario', () => {
  const { dir, head } = repoWithRun('defer');
  raise(dir, head, { severity: 'nit' }); raise(dir, head, { area: 'data' }); raise(dir, head, { kind: 'scenario' }); raise(dir, head);
  for (const id of ['F1', 'F2', 'F3']) ruleOn(dir, { id, verdict: 'confirmed', reach: 'user', born: 'build', cause: 'c', evidence: 'exit 1', by: VERIFIER });
  const owner = { closedBy: 'owner', evidence: 'owner: "non-critical errors users cannot reach may be skipped"', by: 'main' };
  const f = markFixed(dir, { id: 'F1', ...owner }).finding;
  assert.deepEqual([f.state, f.deferEvidence, f.fixedCommit], ['deferred', owner.evidence, undefined]);
  assert.match(markFixed(dir, { id: 'F2', ...owner }).error, /data area/);
  assert.match(markFixed(dir, { id: 'F3', ...owner }).error, /acceptance scenario/);
  assert.match(markFixed(dir, { id: 'F4', ...owner }).error, /F4 is open; only a confirmed finding is deferred/);
  assert.match(markFixed(dir, { id: 'F2', ...owner, evidence: '' }).error, /the owner's words/);
});

test('a confirmed finding that reaches neither a user nor the merge is deferred at once, never one in a protected area or a failing scenario', () => {
  const { dir, head } = repoWithRun('reach');
  raise(dir, head, { severity: 'nit' }); raise(dir, head, { area: 'data' }); raise(dir, head, { kind: 'scenario' }); raise(dir, head);
  const rule = (id, reach) => ruleOn(dir, { id, verdict: 'confirmed', reach, born: 'build', cause: 'a helper no caller reaches', evidence: 'exit 1', by: VERIFIER });
  assert.match(rule('F4').error, /reach: who meets the defect/);
  const f = rule('F1', 'neither').finding;
  assert.deepEqual([f.state, f.reach, f.deferEvidence], ['deferred', 'neither', 'no user meets it and it blocks no merge: a helper no caller reaches']);
  assert.match(rule('F2', 'neither').error, /data area/);
  assert.match(rule('F3', 'neither').error, /acceptance scenario/);
  assert.equal(rule('F4', 'merge').finding.state, 'confirmed');
  assert.equal(counts(readLedger(dir).findings).confirmed, 1);
});

// The one scope every lens works to: the workflow states it to its agents, and the ledger's own
// module states it to whoever raises a finding.
test('the review workflow gives every agent lens the same scope as the reach module states', () => {
  const script = readFileSync(join(ROOT, 'workflows', 'review.js'), 'utf8');
  assert.ok(script.includes(`const SCOPE = '${SCOPE}'`));
});

test('a new run archives the old ledger under its run id and never deletes one', () => {
  const { dir, head } = repoWithRun('archive');
  raise(dir, head);
  const { archived } = archiveLedger(dir, 'run1');
  assert.equal(archived, join(dir, '.git', 'lpk', 'runs', 'run1', 'findings.jsonl'));
  assert.deepEqual(readLedger(dir).findings, []);
  raise(dir, head);
  assert.equal(archiveLedger(dir, 'run1').archived, join(dir, '.git', 'lpk', 'runs', 'run1', 'findings.1.jsonl'));
  assert.match(archiveLedger(dir, '../x').error, /cannot name a directory/);
  raise(dir, head);
  resetLedger(ledgerFile(dir));
  assert.equal(existsSync(ledgerFile(dir)), false);
  assert.ok(readdirSync(join(dir, '.git', 'lpk', 'runs'), { recursive: true }).some((p) => new RegExp(`^before-\\d+\\${sep}findings\\.jsonl$`).test(p)));
});

test('findings added by many processes at once all land, each with its own id', async () => {
  const { dir, head } = repoWithRun('lock');
  // A lock left by a process that died is taken over, not waited on forever.
  writeFileSync(join(dir, '.git', 'lpk', 'findings.lock'), `999999999 ${(await import('node:os')).hostname()} ${Date.now()}`);
  const script = `import { addFinding } from ${JSON.stringify(pathToFileURL(join(ROOT, 'lib', 'findings.mjs')).href)};
for (let i = 0; i < 10; i++) { const r = addFinding(process.argv[1], { from: 'p', at: '${head}', claim: 'c' + i, repro: 'r', kind: 'defect', severity: 'nit' }); if (r.error) throw new Error(r.error); }`;
  await Promise.all(Array.from({ length: 6 }, () => new Promise((done, fail) => {
    spawn('node', ['--input-type=module', '-e', script, dir], { stdio: 'inherit' }).on('exit', (code) => (code === 0 ? done() : fail(new Error(`exit ${code}`))));
  })));
  const ids = readLedger(dir).findings.map((f) => f.id);
  assert.equal(ids.length, 60);
  assert.equal(new Set(ids).size, 60);
});

test('lpk finding lists, rules, closes and counts from the command line, a ruling there marked for the owner', () => {
  const { dir, head } = repoWithRun('cli');
  raise(dir, head, { file: 'a.ts', line: 2 }); raise(dir, head);
  assert.match(lpk(dir, 'finding', 'list'), /F1 defect\/important lpk:bug-hunter a\.ts:2 — the guard fails open \(open\)/);
  assert.match(lpk(dir, 'finding', 'verdict', 'F1', 'confirmed', '--reach', 'user', '--born', 'design', '--cause', 'the brief never says n starts at 1', '--evidence', 'it prints 0 for n=1'), /F1 is confirmed/);
  const fix = commit(dir, 'fix');
  assert.match(lpk(dir, 'finding', 'fixed', 'F1', '--commit', fix, '--closed-by', 'repro', '--evidence', 'lpk repro F1 exit 0'), /F1 fixed in .* \(repro\)/);
  lpk(dir, 'finding', 'verdict', 'F2', 'dropped', '--basis', 'disproved', '--evidence', 'unreachable');
  assert.match(lpk(dir, 'finding', 'list', '--state', 'dropped'), /F2 .*\(dropped by cli, [^)]*owner[^)]*\)/);
  assert.deepEqual(JSON.parse(lpk(dir, 'finding', 'counts')), { open: 0, confirmed: 0, unsettled: 0, dropped: 1, preexisting: 0, fixed: 1, deferred: 0, duplicate: 0, needsOwner: 1, total: 2 });
  assert.match(JSON.parse(lpk(dir, 'finding', 'get', 'F1')).fixEvidence, /lpk repro F1 exit 0/);
});
