import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { claudePid, driveReason } from './drive.mjs';
import { within } from './git.mjs';
import { sessionPid } from './sessions.mjs';

export const NUDGES = 10;
export const NAME = /^[a-z0-9][a-z0-9-]*$/;
const STATUS = ['todo', 'done', 'held', 'paused'];

export const plansDir = () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'lpk', 'plans');
export const planFile = (name) => join(plansDir(), `${name}.json`);
const nudgeFile = (name) => join(plansDir(), `${name}.nudge`);

export function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, file);
}

const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const readdirOr = (dir) => { try { return readdirSync(dir); } catch { return []; } };
const valid = (p) => Boolean(p) && typeof p === 'object' && typeof p.name === 'string' && typeof p.repo === 'string'
  && typeof p.session === 'string' && Array.isArray(p.items)
  && p.items.every((i) => i && typeof i.id === 'string' && STATUS.includes(i.status) && typeof i.proof === 'string');

export function readPlan(file) {
  const text = readText(file);
  const plan = parse(text);
  return valid(plan) ? { plan } : { garbled: file, text };
}

export function listPlans(session, dir = plansDir()) {
  const names = readdirOr(dir).filter((n) => n.endsWith('.json')).sort();
  const plans = [], broken = [];
  for (const n of names) {
    const file = join(dir, n);
    const r = readPlan(file);
    if (r.plan) plans.push(r.plan);
    else if (session && r.text.includes(session)) broken.push(file);
  }
  return { plans, broken };
}

export function move(plan, id, to, why = '', proved = null) {
  const item = plan.items.find((i) => i.id === id);
  if (!item) return { error: `no item ${id} in plan ${plan.name}` };
  if (!STATUS.includes(to)) return { error: `unknown status ${to}` };
  if (proved && to !== 'done') return { error: `a proof only ever makes ${id} done` };
  if (proved) item.proved = proved;
  if (proved && proved.exit !== 0) return { item };
  if (to === 'done' && proved?.exit !== 0) return { error: `${id} becomes done only when its proof exits 0: run \`lpk plan prove ${id}\`` };
  if ((to === 'held' || to === 'paused') && (item.status !== 'todo' || !String(why).trim())) {
    return { error: item.status !== 'todo' ? `${id} is ${item.status}: only an open item can be ${to}` : `${to} needs a reason: --why "<what the owner must answer or decide>"` };
  }
  if (to === 'todo' && item.status !== 'held' && item.status !== 'paused') return { error: `${id} is ${item.status}: only a held or paused item is opened` };
  item.status = to;
  item.why = to === 'held' || to === 'paused' ? String(why).trim() : '';
  return { item };
}

export const doneIds = (plan) => plan.items.filter((i) => i.status === 'done').map((i) => i.id).join(',');

export const nextOpen = (plan) => plan.items.find((i) => i.status === 'todo');

export const waitingOf = (plan) => plan.items.filter((i) => i.status === 'held' || i.status === 'paused').map((i) => `${i.id} ${i.status} (${i.why})`);

export function planLines(run) {
  const sessions = [run.session, ...(run.previous || [])].filter(Boolean);
  const held = (dir) => listPlans('', dir).plans.filter((p) => sessions.includes(p.session));
  const live = held(plansDir());
  const waiting = live.filter((p) => waitingOf(p).length).map((p) => `Plan waiting (${p.name}): ${waitingOf(p).join('; ')}`);
  const removed = [...new Set([...live, ...held(join(plansDir(), 'done'))].flatMap((p) => (p.removed ?? []).map((r) => `Plan removed (${p.name}): ${r.id} ${r.title} (${r.why})`)))];
  return [...waiting, ...removed, ...[...new Set(sessions.flatMap((s) => listPlans(s).broken))].map((file) => `plan not read: ${file}`)];
}

function thenNote(plan, item, handOver) {
  const after = nextOpen({ items: plan.items.slice(plan.items.indexOf(item) + 1) });
  if (after && handOver) return 'then write the report in your reply and run `lpk plan drive`: a fresh session takes the next item.';
  if (after) return `then start ${after.id}: ${after.title}.`;
  const waiting = waitingOf(plan);
  return waiting.length ? `the plan then waits on the owner for ${waiting.length} held or paused item${waiting.length === 1 ? '' : 's'}.` : 'the plan is then done.';
}

export function openItemNotes(session, env = process.env, deps = {}) {
  if (!session) return [];
  const launched = claudePid(env, deps) !== undefined;
  return listPlans(session).plans.filter((p) => p.session === session && nextOpen(p)).map((p) => {
    const item = nextOpen(p);
    return `Plan ${p.name}: ${item.id} ${item.title} is still open. Its proof: ${item.proof}. Once that exits 0, run \`lpk plan prove ${item.id}\`; ${thenNote(p, item, launched && p.since?.session === session)}`;
  });
}

export function render(plan) {
  const lines = [`plan ${plan.name} (repo ${plan.repo}; ${plan.session ? `held by session ${plan.session}` : 'held by no session: `lpk plan take` binds it'})`];
  for (const i of plan.items) {
    lines.push(`  ${i.id} [${i.status}] ${i.title}${i.why ? ` (${i.why})` : ''}`, `      proof: ${i.proof}`, `      source: ${i.source || '-'} (added ${i.added || '-'})`);
    if (i.proved) lines.push(`      last proof: exit ${i.proved.exit} at ${i.proved.at}`);
  }
  for (const r of plan.removed ?? []) lines.push(`  ${r.id} [removed] ${r.title} (${r.why})`);
  const n = nextOpen(plan);
  lines.push(n ? `next: ${n.id} ${n.title}, done when \`${n.proof}\` exits 0` : 'next: no open item');
  return lines.join('\n');
}

function readNudge(name) {
  const n = parse(readText(nudgeFile(name)));
  return n && typeof n === 'object' ? n : {};
}

const reasonFor = (plan, item) => `lpk plan ${plan.name}: ${item.id} is open: ${item.title}. It is done when \`${item.proof}\` exits 0; run \`lpk plan prove ${item.id}\` then. Work on it now. A finding, a side fix or another repo is not on the plan: a finding outside this item goes in its PR body as a known limit. If it needs the owner, run \`lpk plan hold ${item.id} --why "<question>"\`, ask, and go on to the next item. If you are waiting on something that will wake you, say so and stop. A proof that runs longer than a few minutes goes through Bash with run_in_background.`;

function nudge(plan, item, drive = null) {
  const done = doneIds(plan).split(',').sort().join(',');
  const was = readNudge(plan.name);
  const seen = was.done === done && was.session === plan.session && was.next === item.id ? Number(was.count) || 0 : 0;
  if (seen >= NUDGES) return null;
  writeAtomic(nudgeFile(plan.name), { done, session: plan.session, next: item.id, count: seen + 1 });
  const last = seen + 1 === NUDGES ? ` This is the last nudge: no item done in ${NUDGES} turns. Send the owner a PushNotification saying what blocks ${drive ? 'the hand-over' : item.id}, then stop.` : '';
  return { decision: 'block', reason: (drive ?? reasonFor(plan, item)) + last };
}

function waitingNote(plan) {
  const waiting = waitingOf(plan);
  if (!waiting.length) return '';
  const note = `lpk plan ${plan.name} waits on the owner: ${waiting.join('; ')}`;
  const was = readNudge(plan.name);
  if (was.told === note) return '';
  writeAtomic(nudgeFile(plan.name), { ...was, told: note });
  return note;
}

function onStop(input, me) {
  if (input.background_tasks?.length || input.session_crons?.length) return null;
  const { plans, broken } = listPlans(me);
  if (broken.length) return { systemMessage: `lpk plan: ${broken[0]} is not a readable plan, so no item is pursued; fix or remove the file` };
  const mine = plans.filter((p) => p.session === me);
  for (const p of mine) {
    const item = nextOpen(p);
    if (item) return nudge(p, item, driveReason(p, item, me));
  }
  const notes = mine.map(waitingNote).filter(Boolean);
  return notes.length ? { systemMessage: notes.join('\n') } : null;
}

function onStart(input, me) {
  const { plans } = listPlans(me);
  const mine = plans.filter((p) => p.session === me);
  let text = mine.map(render).join('\n\n');
  if (!mine.length) {
    const orphans = plans.filter((p) => (!p.session || !sessionPid(p.session)) && within(input.cwd, p.repo));
    if (orphans.length) text = `lpk: ${orphans.length > 1 ? 'these plans have' : 'this plan has'} a session that exited. If you are continuing that work, run ${orphans.map((p) => `\`lpk plan take ${p.name}\``).join(' or ')} and the Stop hook pursues it with you.\n\n${orphans.map(render).join('\n\n')}`;
  }
  return text ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } } : null;
}

export function planHook(input) {
  try {
    const me = String(input.session_id || '');
    if (!me) return null;
    if (input.hook_event_name === 'Stop') return onStop(input, me);
    if (input.hook_event_name === 'SessionStart') return onStart(input, me);
  } catch { return null; }
  return null;
}
