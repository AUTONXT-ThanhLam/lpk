import { execFile } from 'node:child_process';
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

export async function background(run = claude) {
  const r = await run(['agents', '--json']);
  if (r.code !== 0) throw new Error(`claude agents --json failed: ${r.out.trim()}`);
  return JSON.parse(r.out).filter((a) => a.kind === 'background' && a.id);
}

const label = (s) => `${s.id} (${s.name})`;

export async function follow({ run = claude, say = console.log, account = process.env.LPK_ACCOUNT } = {}) {
  say(`following account ${account ?? '(not named)'}`);
  const working = (await background(run)).filter((s) => s.state === 'working');
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
  const after = await background(run);
  for (const s of stopped) say(`${s.id} is now ${after.find((a) => a.id === s.id)?.state ?? 'missing'}`);
  return failed ? 1 : 0;
}
