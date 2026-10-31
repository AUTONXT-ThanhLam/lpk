// Shared by the run and gate tests: a scratch home (its own Claude Code config directory, where the
// lens transcripts are written), git repos on a feature branch, `lpk` from a session's shell, the
// push hook as Claude Code calls it, and the lib modules loaded against the same scratch dirs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const tmp = mkdtempSync(join(tmpdir(), 'lpk-gates-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
export const noHost = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^CLAUDE_|^LPK_ACCOUNT$/.test(k)));
export const ENV = { ...noHost(process.env), HOME: join(tmp, 'home'), CLAUDE_CONFIG_DIR: join(tmp, 'home', '.claude'), CLAUDE_CODE_SESSION_ID: '', LPK_CHROME_PORT: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', XDG_DATA_HOME: join(tmp, 'data'), XDG_STATE_HOME: join(tmp, 'state'), XDG_CACHE_HOME: join(tmp, 'cache'), CLAUDE_PLUGIN_ROOT: ROOT };
delete ENV.NODE_TEST_CONTEXT;
// The lib modules read these when they load, so the in-process calls below use the same dirs — and no
// launcher's host vars either, which would point them at the store of whoever started the suite.
for (const k of Object.keys(process.env)) if (/^CLAUDE_|^LPK_ACCOUNT$/.test(k)) delete process.env[k];
for (const k of ['HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_PLUGIN_ROOT', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) process.env[k] = ENV[k];

export const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
export const lpk = (cwd, session, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: { ...ENV, CLAUDE_CODE_SESSION_ID: session }, encoding: 'utf8' });

// The push hook as hooks.json registers it for a Bash call: the deny reason, or null when it lets the
// call through. An entry with an `if` rule runs only when its pattern matches the whole command, as
// a permission rule does.
const PUSH = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks.PreToolUse.filter((e) => e.hooks[0].command.includes('push-check')).map((e) => e.hooks[0]);
const fires = (h, command) => !h.if || new RegExp(`^${h.if.replace(/^Bash\((.*)\)$/, '$1').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 's').test(command);
export function hookBash(cwd, session, command, env = {}) {
  for (const h of PUSH.filter((x) => fires(x, command))) {
    const p = spawnSync('bash', ['-c', h.command], { cwd, env: { ...ENV, ...env }, input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, session_id: session, tool_input: { command } }), encoding: 'utf8' });
    if (p.status !== 0) throw new Error(p.stderr);
    if (p.stdout.trim()) return JSON.parse(p.stdout).hookSpecificOutput.permissionDecisionReason;
  }
  return null;
}

export function repoWith(name, files) {
  const repo = join(tmp, name);
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  for (const [p, t] of Object.entries(files)) write(repo, p, t);
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'switch', '-qc', 'feat');
  return repo;
}

export const user = (content) => ({ type: 'user', message: { role: 'user', content }, timestamp: '2026-10-21T10:00:00Z' });
export const assistant = (content, stop_reason, extra = {}) => ({ type: 'assistant', message: { role: 'assistant', content, stop_reason }, timestamp: '2026-10-21T10:05:00Z', ...extra });

// One agent's transcript and meta file, where Claude Code keeps them (`dir` is its subagents dir).
export function agent(dir, id, agentType, entries) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${id}.jsonl`), `${entries.map((e) => JSON.stringify({ agentId: id, ...e })).join('\n')}\n`);
  writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType }));
}

// A lens of `session` that reviewed `range` and returned `findings` as structured output.
export function lens(session, id, agentType, range, structured) {
  agent(join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-scratch', session, 'subagents'), id, agentType,
    [user(`Review ${range}.`), assistant([{ type: 'tool_use', name: 'StructuredOutput', input: structured }], 'tool_use')]);
}
