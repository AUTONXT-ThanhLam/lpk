import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const CONTINUE = 'The owner moved every claude session to another account and this session was stopped to follow. A tool call may have been cut off. Read the transcript to see which step was last finished, check the state on disk before running anything again, and continue the task from there.';
export const RESTORE = 'The owner tried to move every claude session to another account and could not. This session was paused for a moment. A tool call may have been cut off. Check the state on disk before running anything again and continue the task from where the transcript stops.';

export async function claude(args, opts = {}) {
  try {
    const r = await exec('claude', args, { encoding: 'utf8', timeout: 120_000, ...opts });
    return { code: 0, out: r.stdout };
  } catch (err) {
    return { code: typeof err.code === 'number' ? err.code : 1, out: `${err.stdout ?? ''}${err.stderr ?? err.message}` };
  }
}

export async function sessions(run = claude) {
  const r = await run(['agents', '--json']);
  if (r.code !== 0) throw new Error(`claude agents --json failed: ${r.out.trim()}`);
  return JSON.parse(r.out);
}

export const background = async (run = claude) => (await sessions(run)).filter((a) => a.kind === 'background' && a.id);

const CARD = 'The owner moved every claude session to another account with /lpk-switch and this session restarted on it. Agents and workflows that were running here are gone, and a tool call may have been cut off. Read the end of your transcript, check the state on disk before running anything again, and continue what you were doing; if nothing was unfinished, say so in one line and wait.\n';

function environOf(pid) {
  try {
    return Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map((e) => [e.slice(0, e.indexOf('=')), e.slice(e.indexOf('=') + 1)]));
  } catch {
    return undefined;
  }
}

function parentOf(pid) {
  try {
    return readFileSync(`/proc/${pid}/status`, 'utf8').match(/^PPid:\s*(\d+)/m)?.[1];
  } catch {
    return undefined;
  }
}

function hasTranscript(sessionId, configDir = process.env.CLAUDE_CONFIG_DIR) {
  const projects = join(configDir || join(homedir(), '.claude'), 'projects');
  return existsSync(projects) && readdirSync(projects).some((d) => existsSync(join(projects, d, `${sessionId}.jsonl`)));
}

export function moveInteractive(list, { except, account, say, environ = environOf, parent = parentOf, kill = process.kill.bind(process) }) {
  let failed = 0;
  for (const s of list.filter((a) => a.kind === 'interactive' && a.sessionId !== except)) {
    const who = `pid ${s.pid} in ${s.cwd}`;
    const env = environ(s.pid);
    if (!env) { say(`not moved: ${who}, its environment cannot be read`); failed += 1; continue; }
    if (env.LPK_ACCOUNT === account) continue;
    if (!env.CC_SWAP_REQUEST || !env.CC_SWAP_LAUNCHER || parent(s.pid) !== env.CC_SWAP_LAUNCHER) {
      say(`not moved: ${who} was not started through the cc-switch launcher; /exit there and run claude -c`);
      failed += 1;
      continue;
    }
    try {
      const dir = join(process.env.XDG_RUNTIME_DIR || tmpdir(), 'lpk-follow');
      mkdirSync(dir, { recursive: true });
      const card = join(dir, `card-${s.sessionId}.md`);
      writeFileSync(card, CARD);
      writeFileSync(env.CC_SWAP_REQUEST, `${hasTranscript(s.sessionId, env.CLAUDE_CONFIG_DIR) ? s.sessionId : '-'}\n${card}\n`);
      try {
        kill(s.pid, 'SIGTERM');
      } catch (err) {
        rmSync(env.CC_SWAP_REQUEST, { force: true });
        throw err;
      }
      say(`restarting ${who} on ${account ?? 'the active account'}`);
    } catch (err) {
      say(`not moved: ${who}, ${err.message}`);
      failed += 1;
    }
  }
  return failed;
}

const label = (s) => `${s.id} (${s.name})`;

export async function follow({ run = claude, say = console.log, account = process.env.LPK_ACCOUNT, except, move = moveInteractive } = {}) {
  say(`following account ${account ?? '(not named)'}`);
  const all = await sessions(run);
  const working = all.filter((a) => a.kind === 'background' && a.id && a.state === 'working');
  const stopped = [];
  const restore = async () => {
    for (const s of stopped) await run(['--bg', '--resume', s.sessionId, RESTORE], { cwd: s.cwd });
    say(`nothing moved; ${stopped.length} stopped session(s) were resumed where they were.`);
  };
  for (const s of working) {
    const r = await run(['stop', s.id]);
    if (r.code === 0) { stopped.push(s); say(`stopped ${label(s)}`); } else say(`not moved: ${label(s)} would not stop: ${r.out.trim().split('\n')[0]}`);
  }
  const down = await run(['daemon', 'stop', '--any']);
  if (down.code !== 0) {
    say(`could not stop the daemon: ${down.out.trim()}`);
    await restore();
    return 1;
  }
  say('daemon stopped; the next claude --bg starts one on this account');
  let failed = working.length - stopped.length;
  for (const s of stopped) {
    const r = await run(['--bg', '--resume', s.sessionId, CONTINUE], { cwd: s.cwd });
    say(`${r.code === 0 ? 'resumed' : 'FAILED to resume'} ${label(s)}: ${r.out.trim().split('\n')[0]}`);
    if (r.code !== 0) failed += 1;
  }
  for (const s of all.filter((a) => a.kind === 'background' && a.id && a.state !== 'working')) {
    if (!hasTranscript(s.sessionId)) { say(`lost: ${label(s)} has no transcript to resume`); continue; }
    const r = await run(['--bg', '--resume', s.sessionId], { cwd: s.cwd });
    say(`${r.code === 0 ? 'kept' : 'FAILED to keep'} ${label(s)} (${s.state}) in the list, idle on the new account`);
    if (r.code !== 0) failed += 1;
  }
  const after = await background(run);
  for (const s of stopped) say(`${s.id} is now ${after.find((a) => a.id === s.id)?.state ?? 'missing'}`);
  failed += move(all, { except, account, say });
  return failed ? 1 : 0;
}
