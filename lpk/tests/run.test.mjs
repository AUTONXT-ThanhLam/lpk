// An lpk run as Claude Code drives it: `lpk run` and `lpk verify` from the session's shell, and the
// hook commands hooks.json registers, fed the JSON Claude Code sends, in real git repos.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { context, ENV, hook, lpk, reason, repoWith, sh, tmp, write } from './hooks-env.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const start = (repo, session, ...args) => ok(lpk(repo, session, 'run', 'start', '--target', 'main', ...(args.length ? args : ['--verify', 'true'])));
const commitHook = (repo, session, command) => hook('PreToolUse', 'commit', { tool_name: 'Bash', cwd: repo, session_id: session, tool_input: { command } });
const runFile = (repo) => join(sh(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk', 'run.json');

test('a second run start in the same session amends the run and keeps its findings; another session waits until the first has exited', () => {
  const repo = repoWith('life', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.match(start(repo, 'one', '--verify', 'true', '--lane', 'quick', '--why', 'one file', '--scenario', 'true'), /lpk run (\S+) started .* quick lane, branch feat\.[\s\S]*Scenarios: S1 `true`/);
  const id = JSON.parse(readFileSync(runFile(repo), 'utf8')).id;
  const ledger = join(runFile(repo), '..', 'findings.jsonl');
  writeFileSync(ledger, `${JSON.stringify({ ev: 'add', finding: { id: 'F1', run: id, from: 'lpk:techlead', at: 'a..b', claim: 'c', repro: 'r', kind: 'defect', severity: 'nit' } })}\n`);
  assert.match(start(repo, 'one', '--judged', 'the owner sees the new total'), new RegExp(`lpk run ${id} amended[\\s\\S]*S1 \\(agent-judged\\) the owner sees the new total`));
  assert.ok(existsSync(ledger), 'the open run keeps its ledger');
  const other = lpk(repo, 'two', 'run', 'start', '--target', 'main', '--verify', 'true');
  assert.equal(other.status, 2);
  assert.match(other.stderr, /a run of session one is open in this repo .*`lpk run start --take`/);
  // Session one still runs: Claude Code's file for its process names it.
  mkdirSync(join(ENV.HOME, '.claude', 'sessions'), { recursive: true });
  writeFileSync(join(ENV.HOME, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'one' }));
  assert.match(lpk(repo, 'two', 'run', 'take').stderr, new RegExp(`session one still runs \\(pid ${process.pid}\\)`));
  writeFileSync(join(ENV.HOME, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'someone' }));
  assert.match(ok(lpk(repo, 'two', 'run', 'take')), new RegExp(`lpk run ${id} taken over by this session`));
  assert.equal(JSON.parse(ok(lpk(repo, 'two', 'run', 'status'))).session, 'two');
  assert.match(ok(lpk(repo, 'two', 'run', 'end')), /lpk run ended\. Last verify: never ran.*The delivery gates still hold on feat\./);
  assert.ok(existsSync(join(runFile(repo), '..', 'runs', id, 'run.json')), 'the ended run is kept by its id');
  start(repo, 'two');
  assert.ok(existsSync(join(runFile(repo), '..', 'runs', id, 'findings.jsonl')), 'the next run moves the old ledger under the old id');
  assert.ok(!existsSync(ledger));
});

test('lpk run end never refuses: with no run, and with a damaged run file', () => {
  const repo = repoWith('end', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.match(ok(lpk(repo, 'e', 'run', 'end')), /no lpk run is open/);
  mkdirSync(join(runFile(repo), '..'), { recursive: true });
  writeFileSync(runFile(repo), '{"v": 2, "id": ');
  assert.match(lpk(repo, 'e', 'run', 'status').stderr, /cannot be read/);
  assert.match(ok(lpk(repo, 'e', 'run', 'end')), /damaged run file was set aside/);
  assert.ok(!existsSync(runFile(repo)));
});

test('lpk verify records red, then green, on the exact tree it ran on', () => {
  const repo = repoWith('verify', { 'src/a.mjs': 'export const a = 1;\n', 'check.sh': 'grep -q "a = 2" src/a.mjs\n' });
  start(repo, 'v', '--verify', 'bash check.sh');
  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  const red = lpk(repo, 'v', 'verify');
  assert.equal(red.status, 1);
  assert.match(red.stdout, /FAIL `bash check\.sh` exit 1/);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  write(repo, 'src/new.mjs', 'export const n = 1;\n');
  assert.match(ok(lpk(repo, 'v', 'verify')), /Untracked code files in this tree: src\/new\.mjs[\s\S]*verified: green on tree/);
});

test('a check that rewrites code voids its own verify; files it writes beside the code do not', () => {
  const repo = repoWith('rewrite', { 'src/a.mjs': 'export const a = 1;\n', 'stamp.txt': '0\n' });
  start(repo, 'rw', '--verify', 'date > app.tsbuildinfo; date > stamp.txt');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, 'rw', 'verify'));
  start(repo, 'rw', '--verify', 'echo "// formatted" >> src/a.mjs');
  const r = lpk(repo, 'rw', 'verify');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Files changed while the checks ran \(src\/a\.mjs\)/);
});

test('the commit gate lets in the tree lpk verify ran on before the commit; build files do not count, a new code file does', () => {
  const repo = repoWith('commit', { 'src/a.mjs': 'export const a = 1;\n' });
  // The check writes a build file nobody git-ignored, as tsc does with its build info.
  start(repo, 'c', '--verify', 'date > app.tsbuildinfo');
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  assert.match(reason(commitHook(repo, 'c', 'git commit -am x')), /commit refused, the tree is not verified \(no `lpk verify` has run/);
  ok(lpk(repo, 'c', 'verify'));
  assert.equal(commitHook(repo, 'c', 'git commit -am x'), null);
  write(repo, 'test/a.test.mjs', 'export const t = 1;\n');
  assert.match(reason(commitHook(repo, 'c', 'git commit -am x')), /the files changed after the last `lpk verify`/);
  sh(repo, 'add', 'test/a.test.mjs');
  assert.equal(commitHook(repo, 'c', 'git commit -m tests'), null, 'staged test files alone commit');
  assert.equal(commitHook(tmp, 'c', 'git status'), null, 'not a commit');
});

test('in a run, a candidate comes back once, right after the edit that adds it, also to a session in the parent directory', () => {
  const repo = repoWith('post', { 'src/a.mjs': 'export const a = 1;\n' });
  start(repo, 'p');
  write(repo, 'src/a.mjs', 'export const a = 1;\nload().catch(() => undefined);\n');
  const first = hook('PostToolUse', 'post', { tool_name: 'Bash', cwd: tmp, session_id: 'p', tool_input: { command: 'sed -i s/x/y/ post/src/a.mjs' } });
  assert.match(context(first), /- no-silent-failure {2}src\/a\.mjs:2 {2}load\(\)\.catch/);
  assert.equal(hook('PostToolUse', 'post', { tool_name: 'Bash', cwd: repo, session_id: 'p', tool_input: { command: 'ls' } }), null, 'reported twice');
  assert.equal(hook('PostToolUse', 'post', { tool_name: 'Bash', cwd: repo, session_id: 'other', tool_input: { command: 'ls' } }), null, 'another session');
});

test('what the owner says during a run is kept for learn, and lpk run end says where', () => {
  const repo = repoWith('memory', { 'src/a.mjs': 'export const a = 1;\n' });
  start(repo, 'm');
  hook('UserPromptSubmit', 'prompt', { cwd: repo, session_id: 'm', prompt: 'no, keep the old route working' });
  hook('UserPromptSubmit', 'prompt', { cwd: repo, session_id: 'm', prompt: '<task-notification>\n<task-id>a1</task-id>' });
  const ended = ok(lpk(repo, 'm', 'run', 'end'));
  const file = ended.match(/Owner messages during the run: 1, in (\S+prompts\.jsonl)/)[1];
  assert.equal(JSON.parse(readFileSync(file, 'utf8').trim()).prompt, 'no, keep the old route working');
});

test('lpk precedent shows what the tech lead said before on the files a change touches', () => {
  const repo = repoWith('precedent', { 'src/api/lock.ts': 'export const a = 1;\n', 'src/api/runs.ts': 'export const b = 1;\n' });
  sh(repo, 'config', 'lpk.slug', 'acme/app');
  write(ENV.XDG_DATA_HOME, 'lpk/reviews/acme__app.jsonl', [
    { id: 1, pr: 7, url: 'u1', path: 'src/api/lock.ts', line: 3, body: 'This fails open when the gateway is down.' },
    { id: 2, pr: 9, url: 'u2', path: 'src/api/runs.ts', line: 1, body: 'The resume route skips the guard.' },
    { id: 3, pr: 9, url: 'u3', path: 'docs/x.md', line: 1, body: 'unrelated' },
  ].map((c) => JSON.stringify(c)).join('\n') + '\n');
  write(repo, 'src/api/lock.ts', 'export const a = 2;\n');
  const out = lpk(repo, '', 'precedent', '--base', 'main').stdout;
  assert.match(out, /On the files of this change \(1\): 1\.\n- #7 src\/api\/lock\.ts:3 {2}This fails open/);
  assert.match(out, /same directories or with the same names: 1\.\n- #9 src\/api\/runs\.ts:1 {2}The resume route skips the guard\./);
  assert.doesNotMatch(out, /unrelated/);
});

test('lpk facts says how far the branch is behind main and whether it still merges', () => {
  const repo = repoWith('behind', { 'src/a.mjs': 'export const a = 1;\n' });
  write(repo, 'src/a.mjs', 'export const a = 2;\n'); sh(repo, 'commit', '-qam', 'feat');
  sh(repo, 'switch', '-q', 'main');
  write(repo, 'src/a.mjs', 'export const a = 3;\n'); sh(repo, 'commit', '-qam', 'main moved');
  sh(repo, 'switch', '-q', 'feat');
  const out = lpk(repo, '', 'facts', '--base', 'main', '--out', join(tmp, 'behind-bundle')).stdout;
  assert.match(out, /merge: 1 commit\(s\) behind main \(never fetched\), CONFLICTS in src\/a\.mjs; rebase onto main and rerun `lpk verify`/);
});

test('inside a run, lpk facts without --base diffs against the run target, not the default branch', () => {
  const repo = repoWith('to-target', { 'src/a.mjs': 'export const a = 1;\n' });
  sh(repo, 'switch', '-qc', 'studio', 'main');
  write(repo, 'src/studio.mjs', 'export const s = 1;\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'studio work');
  sh(repo, 'switch', '-q', 'main');
  write(repo, 'src/main.mjs', 'export const m = 1;\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'main moved');
  sh(repo, 'switch', '-qC', 'feat', 'studio');
  write(repo, 'src/a.mjs', 'export const a = 2;\n'); sh(repo, 'commit', '-qam', 'feat');
  ok(lpk(repo, 's', 'run', 'start', '--target', 'studio', '--verify', 'true'));
  const facts = JSON.parse(ok(lpk(repo, 's', 'facts', '--json', '--out', join(tmp, 'to-target-bundle'))));
  assert.deepEqual(facts.files.map((f) => f.path), ['src/a.mjs']);
  assert.match(ok(lpk(repo, 's', 'facts', '--out', join(tmp, 'to-target-text'))), /merge: 0 commit\(s\) behind studio /);
  const named = JSON.parse(ok(lpk(repo, 's', 'facts', '--json', '--base', 'main', '--out', join(tmp, 'to-target-named'))));
  assert.deepEqual(named.files.map((f) => f.path).sort(), ['src/a.mjs', 'src/studio.mjs'], 'an explicit --base wins over the run');
  const other = join(tmp, 'to-target-other');
  sh(repo, 'worktree', 'add', '-qb', 'other', other, 'main');
  write(other, 'src/o.mjs', 'export const o = 1;\n'); sh(other, 'add', '.'); sh(other, 'commit', '-qm', 'other');
  const elsewhere = JSON.parse(ok(lpk(other, 's', 'facts', '--json', '--out', join(tmp, 'to-target-elsewhere'))));
  assert.deepEqual(elsewhere.files.map((f) => f.path), ['src/o.mjs'], 'a worktree on a branch the run never noted uses the default branch');
});
