import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { doneIds, nextOpen, waitingOf } from './plan.mjs';
import { parentOf, requestRestart } from './restart.mjs';
import { sessionRuns } from './run.mjs';

export function claudePid(env, { parent = parentOf, start = process.pid } = {}) {
  const launcher = String(env.CC_SWAP_LAUNCHER || '');
  if (!launcher || !env.CC_SWAP_REQUEST) return undefined;
  for (let pid = String(start); pid && pid !== '0' && pid !== '1';) {
    const up = parent(pid);
    if (up === launcher) return Number(pid);
    pid = up;
  }
  return undefined;
}

const doneSince = (plan, me) => {
  if (!me || plan.since?.session !== me) return [];
  const before = String(plan.since.done ?? '').split(',');
  return doneIds(plan).split(',').filter((id) => id && !before.includes(id));
};

const openRuns = (me) => sessionRuns(me).map((r) => `run ${r.id} in ${r.repo}: \`lpk run end --repo ${r.repo}\``);

export function driveReason(plan, item, me, env = process.env, deps = {}) {
  const done = doneSince(plan, me);
  if (!item || !done.length || claudePid(env, deps) === undefined) return null;
  const runs = openRuns(me);
  return `lpk plan ${plan.name}: ${done.join(', ')} done in this session. Do not start the next item here: a fresh session takes it. Finish what the delivery leaves: ${runs.length ? `end each open run of this session (${runs.join('; ')})` : 'no run of this session is open'}; then run \`lpk reap\` and the repo's post-merge steps. Write the report in your reply, then run \`lpk plan drive\`: it ends this session and opens the next item in a fresh claude in this terminal.`;
}

export function cardFor(plan, item, previous) {
  return [
    'This is a plan hand-over by `lpk plan drive`, not an account move: ignore the first message that says the session moved to another account.',
    `The previous session was ${previous}; \`claude --resume ${previous}\` reopens it. Say that session id in your first reply.`,
    '',
    `Plan: ${plan.name}`,
    `Repo: ${plan.repo}`,
    `Item: ${item.id}`,
    `Title: ${item.title}`,
    'Proof (verbatim):',
    item.proof,
    'Source (verbatim):',
    item.source ?? '',
    '',
    'Steps:',
    `1. Run \`lpk plan take ${plan.name}\`.`,
    `2. Run the lpk skill on the item: the Skill tool with skill \`lpk:lpk\` and args "${item.id}: ${item.title}".`,
    `3. When the proof is met, run \`lpk plan prove ${item.id}\`.`,
    '4. Deliver the item and write the report in your reply.',
    '5. If an item of the plan is still open, run `lpk plan drive`; a held item is opened by the owner, not by you. Otherwise say what the plan waits on.',
    '',
  ].join('\n');
}

const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };

const cardDir = (env) => (env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, 'lpk-drive') : join(homedir(), '.cache', 'lpk', 'drive'));

function writeCard(dir, name, text) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const card = join(dir, name);
  const tmp = `${card}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, card);
  return card;
}

export function drive({ plan, session, env = process.env, deps = {} }) {
  const { say = console.log, kill } = deps;
  if (!session || plan.session !== session) return { error: `plan ${plan.name} is held by ${plan.session ? `session ${plan.session}` : 'no session'}, not by this one: \`lpk plan take ${plan.name}\` first` };
  const item = nextOpen(plan);
  if (!item) {
    const waiting = waitingOf(plan);
    return { error: `plan ${plan.name} has no open item${waiting.length ? `; it waits on the owner: ${waiting.join('; ')}. The owner opens a held item with \`lpk plan open <id>\`` : ''}` };
  }
  const runs = openRuns(session);
  if (runs.length) return { error: `a run of this session is still open; end each first: ${runs.join('; ')}` };
  if (!env.CC_SWAP_REQUEST || !env.CC_SWAP_LAUNCHER) return { error: 'this claude was not started by the cc-switch launcher (CC_SWAP_REQUEST or CC_SWAP_LAUNCHER is unset): start the next item in a new session yourself' };
  const pid = claudePid(env, deps);
  if (pid === undefined) return { error: `no ancestor of this process is a claude started by launcher ${env.CC_SWAP_LAUNCHER}` };
  if (readText(env.CC_SWAP_REQUEST).length) return { error: `a restart is already requested in ${env.CC_SWAP_REQUEST}: it runs when this claude exits` };
  const card = writeCard(cardDir(env), `card-${plan.name}-${item.id}.md`, cardFor(plan, item, session));
  try {
    requestRestart({ request: env.CC_SWAP_REQUEST, id: '-', card, pid, kill });
  } catch (err) {
    rmSync(card, { force: true });
    return { error: `the hand-over did not happen: signalling claude pid ${pid} failed (${err.message}), and the request is withdrawn` };
  }
  const done = doneSince(plan, session);
  say(`${done.length ? `${done.join(', ')} done in this session. ` : ''}${item.id} ${item.title} opens in a fresh claude in this terminal; its card is ${card}.`);
  say(`This session is ${session}: \`claude --resume ${session}\` reopens it.`);
  return { pid, card, item };
}
