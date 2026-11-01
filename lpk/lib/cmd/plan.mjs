import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sessionId } from '../host.mjs';
import { top } from '../git.mjs';
import { NAME, listPlans, move, planFile, plansDir, readPlan, render, writeAtomic } from '../plan.mjs';
import { runIn } from '../repro.mjs';
import { sessionPid } from '../sessions.mjs';
import { parseArgs } from '../out.mjs';

const USAGE = `usage:
  lpk plan [show] [--plan <name>]
  lpk plan new <name> [--repo <dir>]
  lpk plan add "<title>" --proof "<command>" --source "<the owner's words that asked for it>"
  lpk plan prove <id> [--timeout <seconds, default 540>]
  lpk plan hold <id> --why "<what the owner must answer>"  |  lpk plan pause <id> --why "<why>"  |  lpk plan open <id>
  lpk plan take <name>
  (--plan <name> names the plan when this shell holds none)`;
const TAIL = 2000;
const fail = (msg) => { console.error(`lpk plan: ${msg}`); return 2; };

function mine(session) {
  const { plans, broken } = listPlans(session);
  return { plans: session ? plans.filter((p) => p.session === session) : [], broken };
}

function target(a) {
  const named = a.opt('--plan');
  if (named) {
    if (!NAME.test(named)) return { error: `${named} is not a plan name` };
    const r = readPlan(planFile(named));
    if (r.plan) return { plan: r.plan };
    return { error: existsSync(planFile(named)) ? `${r.garbled} is not a readable plan` : `no plan ${named}` };
  }
  const { plans, broken } = mine(sessionId());
  if (broken.length) return { error: `${broken[0]} is not a readable plan` };
  if (plans.length === 1) return { plan: plans[0] };
  return { error: plans.length ? `this session holds ${plans.map((p) => p.name).join(', ')}: name one with --plan` : 'this session holds no plan: `lpk plan new <name>` or `lpk plan take <name>`, or name one with --plan' };
}

function show(a) {
  if (!a.opt('--plan')) {
    const { plans, broken } = mine(sessionId());
    if (broken.length) return fail(`${broken[0]} is not a readable plan`);
    if (!plans.length) { console.log('this session holds no plan'); return 0; }
    console.log(plans.map(render).join('\n\n'));
    return 0;
  }
  const t = target(a);
  if (t.error) return fail(t.error);
  console.log(render(t.plan));
  return 0;
}

function create(a) {
  const name = a.words[1];
  const repo = top(resolve(a.opt('--repo') || '.'));
  if (!name || !NAME.test(name) || a.words.length > 2) return fail(`a plan name is lowercase letters, digits and dashes\n${USAGE}`);
  if (!repo) return fail('not inside a git repository: give --repo <dir>');
  if (existsSync(planFile(name)) || existsSync(join(plansDir(), 'done', `${name}.json`))) return fail(`a plan named ${name} exists`);
  const session = sessionId();
  const held = mine(session);
  if (session && (held.plans.length || held.broken.length)) return fail(`this session already holds ${held.plans[0]?.name ?? held.broken[0]}: finish it first`);
  writeAtomic(planFile(name), { name, repo, session, created: new Date().toISOString(), items: [] });
  console.log(session ? `plan ${name} created and held by this session` : `plan ${name} created, held by no session: run \`lpk plan take ${name}\` in the session that should pursue it`);
  return 0;
}

function add(a) {
  const [, title] = a.words;
  const proof = a.opt('--proof'), source = a.opt('--source');
  if (!title || a.words.length > 2 || !proof?.trim() || !source?.trim()) return fail(`add needs a title, --proof and --source\n${USAGE}`);
  const t = target(a);
  if (t.error) return fail(t.error);
  const n = Math.max(0, ...t.plan.items.map((i) => Number(i.id.slice(1)) || 0)) + 1;
  t.plan.items.push({ id: `P${n}`, title, proof, source, added: new Date().toISOString(), status: 'todo', why: '', proved: null });
  writeAtomic(planFile(t.plan.name), t.plan);
  console.log(`added P${n}`);
  return 0;
}

function change(to, a) {
  const id = a.words[1];
  if (!id || a.words.length > 2) return fail(USAGE);
  const t = target(a);
  if (t.error) return fail(t.error);
  const r = move(t.plan, id, to, a.opt('--why') || '');
  if (r.error) return fail(r.error);
  writeAtomic(planFile(t.plan.name), t.plan);
  console.log(`${id} is ${to}`);
  return 0;
}

async function prove(a) {
  const id = a.words[1];
  const seconds = a.opt('--timeout') === undefined ? 540 : Number(a.opt('--timeout'));
  if (!id || a.words.length > 2 || !(seconds > 0)) return fail(USAGE);
  const t = target(a);
  if (t.error) return fail(t.error);
  const item = t.plan.items.find((i) => i.id === id);
  if (!item) return fail(`no item ${id} in plan ${t.plan.name}`);
  const scratch = mkdtempSync(join(tmpdir(), 'lpk-plan-'));
  let proved;
  if (!existsSync(t.plan.repo)) proved = { at: new Date().toISOString(), exit: 127, tail: `the plan's repo ${t.plan.repo} is gone` };
  else {
    const r = await runIn(t.plan.repo, item.proof, seconds, join(scratch, 'proof.log'));
    proved = { at: new Date().toISOString(), exit: r.timedOut ? 124 : r.exit, tail: r.timedOut ? `${r.tail}\n(killed after ${seconds}s)`.slice(-TAIL) : r.tail.slice(-TAIL) };
  }
  rmSync(scratch, { recursive: true, force: true });
  const fresh = readPlan(planFile(t.plan.name));
  if (!fresh.plan) return fail(`${planFile(t.plan.name)} changed while the proof ran and is not a readable plan`);
  const r = move(fresh.plan, id, proved.exit === 0 ? 'done' : 'todo', '', proved);
  if (r.error) return fail(r.error);
  writeAtomic(planFile(fresh.plan.name), fresh.plan);
  console.log(`${id} ${proved.exit === 0 ? 'done' : `stays open: \`${item.proof}\` exited ${proved.exit}`}${proved.tail ? `\n${proved.tail}` : ''}`);
  if (fresh.plan.items.every((i) => i.status === 'done')) {
    mkdirSync(join(plansDir(), 'done'), { recursive: true });
    renameSync(planFile(fresh.plan.name), join(plansDir(), 'done', `${fresh.plan.name}.json`));
    rmSync(join(plansDir(), `${fresh.plan.name}.nudge`), { force: true });
    console.log(`plan ${fresh.plan.name} is complete: every item is done`);
  }
  return proved.exit === 0 ? 0 : 1;
}

function take(a) {
  const name = a.words[1];
  const session = sessionId();
  if (!name || !NAME.test(name) || a.words.length > 2) return fail(USAGE);
  if (!session) return fail('take binds a plan to the session that runs it, and this shell has no session');
  const r = readPlan(planFile(name));
  if (!r.plan) return fail(existsSync(planFile(name)) ? `${r.garbled} is not a readable plan` : `no plan ${name}`);
  if (r.plan.session === session) { console.log(`this session already holds ${name}`); return 0; }
  if (r.plan.session && sessionPid(r.plan.session)) return fail(`${name} is held by session ${r.plan.session}, which is still running`);
  const held = mine(session);
  if (held.plans.length) return fail(`this session already holds ${held.plans[0].name}`);
  writeAtomic(planFile(name), { ...r.plan, session });
  console.log(`plan ${name} is now held by this session`);
  return 0;
}

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--proof', '--source', '--why', '--timeout', '--plan']);
  if (a.error) return fail(`${a.error}\n${USAGE}`);
  const verb = a.words[0] || 'show';
  const verbs = { show, new: create, add, prove, take, hold: (x) => change('held', x), pause: (x) => change('paused', x), open: (x) => change('todo', x) };
  if (!verbs[verb]) return fail(`unknown verb ${verb}\n${USAGE}`);
  return verbs[verb](a);
}
