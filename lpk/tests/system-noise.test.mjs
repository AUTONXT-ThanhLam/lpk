import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { context, ENV, hook, HOME, reason, repoWith, ROOT, sh, startRun, tmp, write } from './hooks-env.mjs';

const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const ACTIVE = join(ENV.XDG_STATE_HOME, 'lpk', 'active');
const DAY = 24 * 3600 * 1000;

function guardSpawns(event, tail) {
  const spy = join(tmp, 'spy-root');
  const seen = join(tmp, `spy-${tail}`);
  write(spy, 'lib/cmd/hook.mjs', "import { appendFileSync } from 'node:fs'; appendFileSync(process.env.SPY, 'x');\n");
  rmSync(seen, { force: true });
  const entry = HOOKS[event].find((h) => h.hooks[0].command.endsWith(`hook.mjs" ${tail}`));
  spawnSync('bash', ['-c', entry.hooks[0].command], { env: { ...ENV, CLAUDE_PLUGIN_ROOT: spy, SPY: seen }, input: '{}', encoding: 'utf8' });
  return existsSync(seen);
}

function transcript(session, ageMs) {
  const file = join(HOME, '.claude', 'projects', 'p', `${session}.jsonl`);
  write(join(HOME, '.claude', 'projects', 'p'), `${session}.jsonl`, '{}\n');
  const at = new Date(Date.now() - ageMs);
  utimesSync(file, at, at);
}

function alive(session) {
  write(join(HOME, '.claude', 'sessions'), `${process.pid}.json`, JSON.stringify({ sessionId: session, pid: process.pid }));
}

test('a run whose session is long gone stops switching every hook guard on, and a resumed session switches its own back on', () => {
  rmSync(ACTIVE, { recursive: true, force: true });
  const stale = repoWith('sweep-stale', { 'src/a.mjs': 'export const a = 1;\n' });
  const live = repoWith('sweep-live', { 'src/a.mjs': 'export const a = 1;\n' });
  const elsewhere = repoWith('sweep-elsewhere', { 'src/a.mjs': 'export const a = 1;\n' });
  startRun(stale, 'gone-session');
  startRun(live, 'live-session');
  transcript('gone-session', 10 * DAY);
  transcript('live-session', 10 * DAY);
  alive('live-session');
  assert.equal(readdirSync(ACTIVE).length, 2);
  assert.equal(guardSpawns('PreToolUse', 'commit'), true, 'with a run registered the guard runs');

  hook('SessionStart', 'start', { session_id: 'new-session', cwd: elsewhere });
  assert.equal(readdirSync(ACTIVE).length, 1, 'only the run whose session lives is still registered');
  assert.equal(readFileSync(join(ACTIVE, readdirSync(ACTIVE)[0]), 'utf8').trim(), join(sh(live, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk', 'run.json'));

  rmSync(join(HOME, '.claude', 'sessions'), { recursive: true, force: true });
  hook('SessionStart', 'start', { session_id: 'new-session', cwd: elsewhere });
  assert.equal(readdirSync(ACTIVE).length, 1, 'the run of a session that is not idle yet stays registered');

  alive('gone-session');
  hook('SessionStart', 'start', { session_id: 'gone-session', cwd: stale });
  assert.equal(readdirSync(ACTIVE).length, 2, 'the resumed session registers its run again');
  assert.ok(existsSync(join(sh(stale, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk', 'run.json')), 'the run itself was never touched');
  rmSync(join(HOME, '.claude', 'sessions'), { recursive: true, force: true });
  rmSync(ACTIVE, { recursive: true, force: true });
  assert.equal(guardSpawns('PreToolUse', 'commit'), false, 'with no run registered the guard costs no node spawn');
});

function commitWithComment(name) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  startRun(repo, name);
  write(repo, 'src/a.mjs', 'export const a = 1;\n// the retry count is three\nexport const b = 2;\n');
  return repo;
}

test('a comment is raised once, when the code is committed, and not after every edit', () => {
  const repo = commitWithComment('comments');
  const edited = hook('PostToolUse', 'post', { tool_name: 'Edit', session_id: 'comments', cwd: repo, tool_input: { file_path: join(repo, 'src/a.mjs') } });
  assert.doesNotMatch(context(edited), /no-comments/, 'an edit hears nothing about comments');
  sh(repo, 'add', 'src/a.mjs');
  const commit = () => hook('PreToolUse', 'commit', { tool_name: 'Bash', session_id: 'comments', cwd: repo, tool_input: { command: 'git commit -m x' } });
  assert.match(reason(commit()), /no-comments .*src\/a\.mjs:2/, 'the commit is refused once, naming the line');
  assert.doesNotMatch(reason(commit()), /no-comments/, 'the same staged lines are not refused twice');
});

test('a run card is a few lines: where the base and brief are, the role limits, and how to ask for the rest', () => {
  const repo = repoWith('card-small', { 'src/a.mjs': 'export const a = 1;\n' });
  startRun(repo, 'card-small');
  for (const type of ['lpk:builder', 'lpk:techlead', 'lpk:verifier']) {
    const card = context(hook('SubagentStart', 'card', { session_id: 'card-small', cwd: repo, agent_id: 'a1', agent_type: type }));
    assert.ok(card.length > 0 && card.length < 600, `${type} card is ${card.length} characters`);
  }
});

const SLEEPS = "require('node:fs').writeFileSync(__dirname + '/argv.txt', process.argv.slice(2).join(' '));\nsetTimeout(() => {}, 60000);\n";

test('the type check gives up within the time it is allowed, tells the model so, and keeps its cache between edits', () => {
  const repo = repoWith('tsc-slow', { 'tsconfig.json': '{}\n', 'src/a.ts': 'export const x = 1;\n' });
  write(repo, 'node_modules/typescript/bin/tsc', SLEEPS);
  ENV.LPK_TYPECHECK_MS = '400';
  try {
    const started = Date.now();
    const out = hook('PostToolUse', 'typecheck', { tool_name: 'Edit', session_id: 'tsc', cwd: repo, tool_input: { file_path: join(repo, 'src/a.ts') } });
    assert.ok(Date.now() - started < 5000, 'returned long before the 30 s the hook is allowed');
    assert.match(context(out), /did not finish in 0\.4s/);
  } finally { delete ENV.LPK_TYPECHECK_MS; }
  const argv = readFileSync(join(repo, 'node_modules/typescript/bin/argv.txt'), 'utf8');
  assert.match(argv, /--incremental --tsBuildInfoFile \S+/);
});

test('a push the guard cannot judge is refused, not let through', () => {
  const entry = HOOKS.PreToolUse.find((h) => h.hooks[0].command.includes('push-check')).hooks[0].command;
  const input = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: tmp, session_id: 's', tool_input: { command: 'git push' } });
  const bin = join(tmp, 'push-bin');
  mkdirSync(bin, { recursive: true });
  if (!existsSync(join(bin, 'cat'))) symlinkSync(['/usr/bin/cat', '/bin/cat'].find(existsSync), join(bin, 'cat'));
  const noNode = spawnSync('/bin/bash', ['-c', entry], { env: { PATH: bin, CLAUDE_PLUGIN_ROOT: ROOT }, input, encoding: 'utf8' });
  assert.equal(noNode.status, 2, noNode.stderr);
  assert.match(noNode.stderr, /push guard could not run/);

  const broken = join(tmp, 'broken-root');
  write(broken, 'bin/lpk', 'this is not javascript (\n');
  const crashed = spawnSync('bash', ['-c', entry], { env: { ...ENV, CLAUDE_PLUGIN_ROOT: broken }, input, encoding: 'utf8' });
  assert.equal(crashed.status, 2, crashed.stderr);

  const fine = spawnSync('bash', ['-c', entry], { env: ENV, input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: tmp, session_id: 's', tool_input: { command: 'ls' } }), encoding: 'utf8' });
  assert.equal(fine.status, 0);
});
