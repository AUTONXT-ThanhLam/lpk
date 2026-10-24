// Shared by the hook tests: a scratch home, git repos, `lpk` run from the session's shell, and each
// hook run exactly as hooks.json registers it, with the event JSON Claude Code sends on stdin.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
export const tmp = mkdtempSync(join(tmpdir(), 'lpk-hooks-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
// `lib/host.mjs` answers for the host whose names the environment carries, so both families are
// dropped from what a child inherits: a suite launched by Qoder would else hand its own
// `QODER_SESSION_ID` to every hook and `lpk` run here, and a test could pass or fail by who started
// it. The helper's own `CLAUDE_*` is what a child runs under.
export const noHost = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(CLAUDE|QODER)_/.test(k)));
export const HOME = join(tmp, 'home');
export const ENV = { ...noHost(process.env), HOME, CLAUDE_CODE_SESSION_ID: '', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', XDG_DATA_HOME: join(tmp, 'data'), XDG_STATE_HOME: join(tmp, 'state'), XDG_CACHE_HOME: join(tmp, 'cache'), CLAUDE_PLUGIN_ROOT: ROOT };
export const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
export const lpk = (cwd, session, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: { ...ENV, CLAUDE_CODE_SESSION_ID: session }, encoding: 'utf8' });

// Runs the hook registered for `event` whose command runs `hook.mjs <name>`, for tool `tool` when the
// entry has a matcher, and returns its parsed answer (null when it printed nothing).
export function hook(event, name, input, tool = input.tool_name ?? input.agent_type) {
  const entry = HOOKS[event].find((h) => h.hooks[0].command.endsWith(`/lib/cmd/hook.mjs\" ${name}`));
  assert.ok(entry, `hooks.json registers \`hook ${name}\` on ${event}`);
  if (entry.matcher && tool !== undefined) assert.match(tool, new RegExp(`^(${entry.matcher})$`), `the ${event} matcher reaches ${tool}`);
  const p = spawnSync('bash', ['-c', entry.hooks[0].command], { cwd: input.cwd, env: ENV, input: typeof input === 'string' ? input : JSON.stringify({ hook_event_name: event, ...input }), encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim() ? JSON.parse(p.stdout) : null;
}

// Whether the hooks.json entry of `hook <name>` on `event` fires for `tool` at all.
export function reaches(event, name, tool) {
  const entry = HOOKS[event].find((h) => h.hooks[0].command.endsWith(`/lib/cmd/hook.mjs" ${name}`));
  return new RegExp(`^(${entry.matcher})$`).test(tool);
}

export function repoWith(name, files) {
  const repo = join(tmp, name);
  mkdirSync(repo, { recursive: true });
  sh(repo, 'init', '-q', '-b', 'main');
  for (const [p, t] of Object.entries(files)) write(repo, p, t);
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'switch', '-qc', 'feat');
  return repo;
}

// Starts a run held by `session` in `repo`, as `lpk run start` does from that session's shell.
export function startRun(repo, session, extra = {}) {
  const base = sh(repo, 'merge-base', 'main', 'HEAD').trim();
  const code = `const { startRun } = await import(${JSON.stringify(join(ROOT, 'lib', 'run.mjs'))}); const r = startRun(process.cwd(), ${JSON.stringify({ target: 'main', base, verify: ['true'], ...extra })}); if (r.error) { console.error(r.error); process.exit(1); }`;
  const p = spawnSync('node', ['--input-type=module', '-e', code], { cwd: repo, env: { ...ENV, CLAUDE_CODE_SESSION_ID: session }, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return join(sh(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').trim(), 'lpk');
}

export const reason = (out) => out?.hookSpecificOutput?.permissionDecisionReason ?? '';
export const context = (out) => out?.hookSpecificOutput?.additionalContext ?? '';
