// An lpk run as Claude Code drives it: the hook commands from hooks.json, fed the JSON Claude
// Code sends, in a real git repo.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LPK = join(ROOT, 'bin', 'lpk');
const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const tmp = mkdtempSync(join(tmpdir(), 'lpk-run-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { ...process.env, CLAUDE_CODE_SESSION_ID: '', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', XDG_DATA_HOME: join(tmp, 'data'), XDG_STATE_HOME: join(tmp, 'state'), CLAUDE_PLUGIN_ROOT: ROOT };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
// lpk runs from the session's own shell, which Claude Code gives the session id.
const lpk = (cwd, ...args) => spawnSync('node', [LPK, ...args], { cwd, env: { ...ENV, CLAUDE_CODE_SESSION_ID: session }, encoding: 'utf8' });

// Each test is its own Claude Code session.
let session = '';
beforeEach((t) => { session = t.name; });

// Runs a hook exactly as hooks.json registers it, with the event JSON on stdin.
function hook(event, cwd, input, name = `hook ${{ PostToolUse: 'post', Stop: 'stop', PreToolUse: 'commit', SessionStart: 'start', UserPromptSubmit: 'prompt' }[event]}`) {
  const cmd = HOOKS[event].map((h) => h.hooks[0].command).find((c) => c.endsWith(name));
  const p = spawnSync('bash', ['-c', cmd], { cwd, env: ENV, input: JSON.stringify({ cwd, session_id: session, ...input }), encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim() ? JSON.parse(p.stdout) : null;
}

function repoWith(name, files) {
  const repo = join(tmp, name);
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  for (const [p, t] of Object.entries(files)) write(repo, p, t);
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'switch', '-qc', 'feat');
  return repo;
}

test('outside an lpk run the hooks say nothing, even with a swallowed error on the tree', () => {
  const repo = repoWith('quiet', { 'src/a.mjs': 'export const a = 1;\n' });
  write(repo, 'src/a.mjs', 'load().catch(() => undefined);\n');
  assert.equal(hook('PostToolUse', repo, { tool_name: 'Bash', tool_input: { command: 'x' } }), null);
  assert.equal(hook('Stop', repo, { stop_hook_active: false }), null);
});

test('in a run, a candidate comes back once, right after the edit that adds it', () => {
  const repo = repoWith('post', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'true').status, 0);
  write(repo, 'src/a.mjs', 'export const a = 1;\nload().catch(() => undefined);\n');
  assert.equal(hook('PostToolUse', repo, { tool_name: 'Bash', agent_id: 'r1', agent_type: 'lpk:techlead', tool_input: { command: 'ls' } }), null, 'a reviewer takes the session\'s candidate');
  const first = hook('PostToolUse', repo, { tool_name: 'Write', tool_input: { file_path: join(repo, 'src/a.mjs') } });
  assert.match(first.hookSpecificOutput.additionalContext, /no-silent-failure {2}src\/a\.mjs:2 {2}load\(\)\.catch/);
  assert.equal(hook('PostToolUse', repo, { tool_name: 'Bash', tool_input: { command: 'ls' } }), null, 'reported twice');
  assert.equal(hook('PostToolUse', repo, { tool_name: 'Bash', session_id: 'other', tool_input: { command: 'ls' } }), null);
});

test('the turn cannot end with changed source until lpk verify is green on that exact tree', () => {
  const repo = repoWith('stop', { 'src/a.mjs': 'export const a = 1;\n', 'check.sh': 'grep -q "a = 2" src/a.mjs\n' });
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'bash check.sh').status, 0);
  assert.equal(hook('Stop', repo, {}), null, 'nothing built yet');
  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  assert.match(hook('Stop', repo, {}).reason, /no `lpk verify` has run/);
  const red = lpk(repo, 'verify');
  assert.equal(red.status, 1);
  assert.match(red.stdout, /FAIL `bash check\.sh` exit 1/);
  assert.match(hook('Stop', repo, {}).reason, /the last `lpk verify` failed: `bash check\.sh` exit 1/);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  assert.equal(lpk(repo, 'verify').status, 0);
  assert.equal(hook('Stop', repo, {}), null);
  const line = spawnSync('node', [LPK, 'statusline'], { cwd: tmp, env: ENV, input: JSON.stringify({ session_id: session }), encoding: 'utf8' }).stdout;
  assert.equal(line, 'lpk 0m · verify green 0m ago', 'the owner sees the run in the status line');
  write(repo, 'src/b.mjs', 'export const b = 1;\n');
  assert.match(hook('Stop', repo, {}).reason, /the code changed after the last `lpk verify`/);
  assert.match(lpk(repo, 'run', 'end', '--reason', 'b.mjs is a stub').stdout, /ended: b\.mjs is a stub/);
  assert.equal(hook('Stop', repo, {}), null);
});

test('a check that rewrites code voids its own verify; files it writes beside the code do not', () => {
  const repo = repoWith('rewrite', { 'src/a.mjs': 'export const a = 1;\n', 'stamp.txt': '0\n' });
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'date > app.tsbuildinfo; date > stamp.txt').status, 0);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  assert.equal(lpk(repo, 'verify').status, 0);
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'echo "// formatted" >> src/a.mjs').status, 0);
  const r = lpk(repo, 'verify');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Files changed while the checks ran \(src\/a\.mjs\)/);
  assert.equal(lpk(repo, 'run', 'end').status, 0);
});

test('only a verified tree is committed, build files the checks write included; test edits hold the commit, not the turn', () => {
  const repo = repoWith('commit', { 'src/a.mjs': 'export const a = 1;\n' });
  const commit = (extra = {}) => hook('PreToolUse', repo, { tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, ...extra });
  // The check writes a build file nobody git-ignored, as tsc does with its build info.
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'date > app.tsbuildinfo').status, 0);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  assert.match(commit().hookSpecificOutput.permissionDecisionReason, /commit refused, the tree is not verified \(no `lpk verify` has run/);
  assert.equal(commit({ tool_input: { command: 'git status; ls "${HOME}/x" 2>&1 | head' } }), null, 'not a commit');
  assert.equal(commit({ agent_id: 'builder-1' }), null, 'a builder commits in its own worktree');
  assert.equal(lpk(repo, 'verify').status, 0);
  assert.equal(commit(), null);
  write(repo, 'test/a.test.mjs', 'export const t = 1;\n');
  assert.equal(hook('Stop', repo, {}), null, 'a new test does not hold the turn');
  assert.match(commit().hookSpecificOutput.permissionDecisionReason, /the files changed after the last `lpk verify`/);
  sh(repo, 'add', 'test/a.test.mjs');
  assert.equal(commit({ tool_input: { command: 'git commit -m tests' } }), null, 'staged test files alone commit');
  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  assert.match(commit().hookSpecificOutput.permissionDecisionReason, /not verified/, '-a also commits the edited source');
  // Only a bare `git commit -m <msg>` commits the staged tests alone: any other form may add source.
  for (const command of ['git commit -m x src/a.mjs test/a.test.mjs', 'git commit -m x .', 'git commit -i -m x src/a.mjs', 'git add src && git commit -m x'])
    assert.equal(commit({ tool_input: { command } })?.hookSpecificOutput.permissionDecision, 'deny', command);
  assert.equal(lpk(repo, 'run', 'end').status, 0);
});

test('a session standing in the parent of the repo it changes still meets its run', () => {
  const repo = repoWith('sub', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'true').status, 0);
  write(repo, 'src/a.mjs', 'load().catch(() => undefined);\n');
  assert.match(hook('PostToolUse', tmp, { tool_name: 'Bash', tool_input: { command: 'sed -i s/x/y/ sub/src/a.mjs' } }).hookSpecificOutput.additionalContext, /no-silent-failure {2}src\/a\.mjs:1/);
  assert.match(hook('Stop', tmp, {}).reason, /no `lpk verify` has run/);
  assert.equal(lpk(repo, 'run', 'end').status, 0);
  assert.equal(hook('Stop', tmp, {}), null);
});

test('a builder in its own worktree is part of the same run', () => {
  const repo = repoWith('wt', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'true').status, 0);
  const wt = join(tmp, 'wt-builder');
  sh(repo, 'worktree', 'add', '-q', '-b', 'slice', wt);
  write(wt, 'src/poll.mjs', 'setInterval(tick, 1000);\n');
  const out = hook('PostToolUse', wt, { tool_name: 'Write', agent_id: 'b1', agent_type: 'lpk:builder', tool_input: { file_path: join(wt, 'src/poll.mjs') } });
  assert.match(out.hookSpecificOutput.additionalContext, /bounded-work {2}src\/poll\.mjs:1/);
});

test('lpk precedent shows what the tech lead said before on the files a change touches', () => {
  const repo = repoWith('precedent', { 'src/api/lock.ts': 'export const a = 1;\n', 'src/api/runs.ts': 'export const b = 1;\n' });
  sh(repo, 'config', 'lpk.slug', 'acme/app');
  write(join(tmp, 'data'), 'lpk/reviews/acme__app.jsonl', [
    { id: 1, pr: 7, url: 'u1', path: 'src/api/lock.ts', line: 3, body: 'This fails open when the gateway is down.' },
    { id: 2, pr: 9, url: 'u2', path: 'src/api/runs.ts', line: 1, body: 'The resume route skips the guard.' },
    { id: 3, pr: 9, url: 'u3', path: 'docs/x.md', line: 1, body: 'unrelated' },
  ].map((c) => JSON.stringify(c)).join('\n') + '\n');
  write(repo, 'src/api/lock.ts', 'export const a = 2;\n');
  const out = lpk(repo, 'precedent', '--base', 'main').stdout;
  assert.match(out, /On the files of this change \(1\): 1\.\n- #7 src\/api\/lock\.ts:3 {2}This fails open/);
  assert.match(out, /same directories or with the same names: 1\.\n- #9 src\/api\/runs\.ts:1 {2}The resume route skips the guard\./);
  assert.doesNotMatch(out, /unrelated/);
});

test('after a compaction the run comes back, and what the owner says during it is kept for learn', () => {
  const repo = repoWith('memory', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(hook('SessionStart', repo, { source: 'compact' }), null, 'no run, nothing to say');
  const started = lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'true');
  assert.match(started.stdout, /CI: no GitHub Actions or GitLab CI steps found/);
  hook('PostToolUse', repo, { tool_name: 'Bash', tool_input: { command: 'lpk run start' } });
  assert.equal(hook('UserPromptSubmit', repo, { prompt: 'no, keep the old route working' }), null);
  hook('UserPromptSubmit', repo, { prompt: 'another session', session_id: 'other' });
  hook('UserPromptSubmit', repo, { prompt: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>' });
  hook('UserPromptSubmit', repo, { prompt: 'a teammate wrote this', source: 'system' });
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  assert.equal(lpk(repo, 'verify').status, 0);
  const brief = join(sh(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk', 'brief.md');
  writeFileSync(brief, '# Design Brief\n');
  const back = hook('SessionStart', repo, { source: 'compact' }).hookSpecificOutput.additionalContext;
  assert.ok(back.includes(`Design Brief: ${brief}`));
  assert.match(back, /inside an lpk run in .*\/memory/);
  assert.match(back, /Checks: `true`\. Last `lpk verify`: green on the current tree\./);
  assert.match(back, /re-read \S+\/skills\/lpk\/SKILL\.md/);
  assert.ok(existsSync(back.match(/re-read (\S+SKILL\.md)/)[1]));
  const ended = lpk(repo, 'run', 'end').stdout;
  assert.match(ended, /Owner messages during the run: 1, in (\S+prompts\.jsonl)/);
  assert.ok(!existsSync(brief), 'the brief ends with its run');
  const file = ended.match(/in (\S+prompts\.jsonl)/)[1];
  assert.equal(JSON.parse(readFileSync(file, 'utf8').trim()).prompt, 'no, keep the old route working');
});

test('lpk facts says how far the branch is behind main and whether it still merges', () => {
  const repo = repoWith('behind', { 'src/a.mjs': 'export const a = 1;\n' });
  write(repo, 'src/a.mjs', 'export const a = 2;\n'); sh(repo, 'commit', '-qam', 'feat');
  sh(repo, 'switch', '-q', 'main');
  write(repo, 'src/a.mjs', 'export const a = 3;\n'); sh(repo, 'commit', '-qam', 'main moved');
  sh(repo, 'switch', '-q', 'feat');
  const out = lpk(repo, 'facts', '--base', 'main', '--out', join(tmp, 'behind-bundle')).stdout;
  assert.match(out, /merge: 1 commit\(s\) behind main \(never fetched\), CONFLICTS in src\/a\.mjs; rebase onto main and rerun `lpk verify`/);
});

test('during a run a push publishes only code a green lpk verify ran on, rebased or not', () => {
  const repo = repoWith('pushrun', { 'src/a.mjs': 'export const a = 1;\n' });
  const push = (extra = {}) => hook('PreToolUse', repo, { tool_name: 'Bash', tool_input: { command: 'git push -u origin feat' }, ...extra }, 'push-check');
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'true').status, 0);
  write(repo, 'src/a.mjs', 'export const a = 2;\n'); sh(repo, 'commit', '-qam', 'feat');
  assert.match(push().hookSpecificOutput.permissionDecisionReason, /no green `lpk verify` was recorded for/);
  assert.equal(push({ session_id: 'other' }), null, 'another session is not in this run');
  assert.equal(lpk(repo, 'verify').status, 0);
  assert.equal(push(), null);
  write(repo, 'src/a.mjs', 'export const a = 3;\n'); sh(repo, 'commit', '-qa', '--amend', '--no-edit');
  assert.match(push().hookSpecificOutput.permissionDecisionReason, /no green `lpk verify`/, 'the rewritten commit was never verified');
  assert.equal(lpk(repo, 'run', 'end').status, 0);
  assert.equal(push(), null);
});

test('each agent writes only where its role allows: builder, test author, reviewers', () => {
  const repo = repoWith('wguard', { 'src/a.mjs': 'export const a = 1;\n' });
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'true').status, 0);
  const wt = join(tmp, 'wguard-slice');
  sh(repo, 'worktree', 'add', '-q', '-b', 'slice', wt);
  const write_ = (file, agent_type) => hook('PreToolUse', repo, { tool_name: 'Write', agent_type, tool_input: { file_path: file } }, 'hook write');
  assert.match(write_(join(repo, 'src/new/b.mjs'), 'lpk:builder').hookSpecificOutput.permissionDecisionReason, /a builder writes only in its own worktree/);
  assert.equal(write_(join(wt, 'src/b.mjs'), 'lpk:builder'), null);
  assert.match(write_(join(repo, 'src/b.mjs'), 'lpk:test-author').hookSpecificOutput.permissionDecisionReason, /the test author writes only tests/);
  assert.equal(write_(join(repo, 'tests/b.test.mjs'), 'lpk:test-author'), null);
  assert.equal(write_(join(repo, 'src/__mocks__/api.mjs'), 'lpk:test-author'), null);
  assert.match(write_(join(repo, 'src/main/kotlin/ProductSpec.kt'), 'lpk:test-author').hookSpecificOutput.permissionDecisionReason, /is production code/);
  assert.match(write_(join(repo, 'tests/scratch.test.mjs'), 'lpk:verifier').hookSpecificOutput.permissionDecisionReason, /lpk:verifier never edits a checkout/);
  assert.equal(write_(join(tmp, 'outside', 'repro.mjs'), 'lpk:verifier'), null);
  assert.match(write_(join(repo, 'src/a.mjs'), 'lpk:ocr').hookSpecificOutput.permissionDecisionReason, /lpk:ocr never edits a checkout/);
  assert.match(write_(join(repo, 'src/a.mjs'), 'lpk:regression').hookSpecificOutput.permissionDecisionReason, /lpk:regression never edits a checkout/);
  assert.equal(write_(join(repo, 'src/b.mjs'), undefined), null);
  assert.equal(lpk(repo, 'run', 'end').status, 0);
});

test('a run started from a terminal is not taken by another session working elsewhere', () => {
  const repo = repoWith('terminal', { 'src/a.mjs': 'export const a = 1;\n' });
  const elsewhere = repoWith('elsewhere', { 'src/b.mjs': 'export const b = 1;\n' });
  assert.equal(spawnSync('node', [LPK, 'run', 'start', '--base', 'main', '--verify', 'true'], { cwd: repo, env: ENV, encoding: 'utf8' }).status, 0);
  write(repo, 'src/a.mjs', 'load().catch(() => undefined);\n');
  assert.equal(hook('PostToolUse', elsewhere, { tool_name: 'Bash', session_id: 'other', tool_input: { command: 'ls' } }), null);
  assert.match(hook('PostToolUse', repo, { tool_name: 'Bash', tool_input: { command: 'ls' } }).hookSpecificOutput.additionalContext, /no-silent-failure {2}src\/a\.mjs:1/);
  assert.equal(lpk(repo, 'run', 'end').status, 0);
});

test('a run gates only its own repo and session, for as long as the work takes', () => {
  const repo = repoWith('scope', { 'src/a.mjs': 'export const a = 1;\n' });
  const other = repoWith('scope-other', { 'src/b.mjs': 'export const b = 1;\n' });
  assert.equal(lpk(repo, 'run', 'start', '--base', 'main', '--verify', 'true').status, 0);
  const second = spawnSync('node', [LPK, 'run', 'start', '--base', 'main', '--verify', 'true'], { cwd: repo, env: { ...ENV, CLAUDE_CODE_SESSION_ID: 'other' }, encoding: 'utf8' });
  assert.match(second.stderr + second.stdout, /a run of session .* is open in this repo/);
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  const bash = (cwd, command) => hook('PreToolUse', cwd, { tool_name: 'Bash', tool_input: { command } });
  assert.equal(bash(other, 'git commit -m x'), null, 'a run in another repo does not gate this one');
  assert.equal(bash(repo, "cat > NOTES.md <<'EOF'\nthen git commit it\nEOF"), null, 'a here-document only mentions git');
  assert.match(bash(repo, 'git commit -m x').hookSpecificOutput.permissionDecisionReason, /not verified/);
  assert.match(bash(tmp, `cd ${repo} && git commit -m x`).hookSpecificOutput.permissionDecisionReason, /not verified/, 'cd into the repo first');
  const marker = join(repo, '.git', 'lpk', 'run.json');
  writeFileSync(marker, JSON.stringify({ ...JSON.parse(readFileSync(marker, 'utf8')), started: Date.now() - 3 * 24 * 3600 * 1000 }));
  assert.match(bash(repo, 'git commit -m x').hookSpecificOutput.permissionDecisionReason, /not verified/, 'three days on, still gated');
  sh(repo, 'checkout', '--', 'src/a.mjs');
  write(repo, 'README.md', 'docs\n'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'docs');
  assert.equal(hook('PreToolUse', repo, { tool_name: 'Bash', tool_input: { command: 'git push' } }, 'push-check'), null, 'a docs-only push needs no verify');
  assert.equal(lpk(repo, 'run', 'end').status, 0);
});
