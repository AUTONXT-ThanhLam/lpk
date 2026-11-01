import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { move } from '../lib/plan.mjs';
import { ENV, HOME, ROOT, hook, lpk, repoWith, sh, tmp, write } from './hooks-env.mjs';

const plans = join(tmp, 'data', 'lpk', 'plans');
const planOf = (name) => JSON.parse(readFileSync(join(plans, `${name}.json`), 'utf8'));
const run = (repo, session, ...args) => lpk(repo, session, 'plan', ...args);
const must = (p) => { assert.equal(p.status, 0, p.stderr + p.stdout); return p; };
const alive = (session) => {
  mkdirSync(join(HOME, '.claude', 'sessions'), { recursive: true });
  writeFileSync(join(HOME, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ sessionId: session, pid: process.pid }));
};
const gone = () => rmSync(join(HOME, '.claude', 'sessions', `${process.pid}.json`), { force: true });

function stop(repo, session, extra = {}) {
  const out = hook('Stop', 'plan', { cwd: repo, session_id: session, stop_hook_active: false, last_assistant_message: 'done for now', background_tasks: [], session_crons: [], ...extra });
  if (out) assert.deepEqual(Object.keys(out).filter((k) => !['decision', 'reason', 'systemMessage'].includes(k)), [], 'Stop answers only a block or a systemMessage');
  return out;
}

function seeded(name, session, items = [['first', 'true']]) {
  const repo = repoWith(`repo-${name}`, { 'a.txt': 'a\n' });
  must(run(repo, session, 'new', name));
  for (const [title, proof] of items) must(run(repo, session, 'add', title, '--proof', proof, '--source', 'the owner said so'));
  return repo;
}

test('R1 R2: a stop with an open item blocks naming it and its proof, unless something is in flight or the session is another', () => {
  const repo = seeded('r1', 's-r1', [['wire the hook', 'echo proof-r1']]);
  const out = stop(repo, 's-r1');
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /P1/);
  assert.ok(out.reason.includes('echo proof-r1'));
  assert.ok(out.reason.includes('lpk plan prove P1'));
  assert.equal(stop(repo, 's-r1', { background_tasks: [{ id: 't1' }] }), null);
  assert.equal(stop(repo, 's-r1', { session_crons: [{ id: 'c1' }] }), null);
  assert.equal(stop(repo, 's-someone-else'), null);
  assert.equal(stop(repo, ''), null);
  assert.equal(stop(repo, 's-r1').decision, 'block');
});

test('R3: a failing proof keeps the item open, a passing one marks it done, and the last done closes the plan', () => {
  const repo = seeded('r3', 's-r3', [['one', 'echo broken >&2; exit 3'], ['two', 'true']]);
  const bad = run(repo, 's-r3', 'prove', 'P1');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /broken/);
  assert.equal(planOf('r3').items[0].status, 'todo');
  assert.equal(planOf('r3').items[0].proved.exit, 3);
  must(run(repo, 's-r3', 'prove', 'P2'));
  assert.deepEqual(planOf('r3').items.map((i) => i.status), ['todo', 'done']);
  assert.equal(stop(repo, 's-r3').decision, 'block');
  const fixed = planOf('r3');
  fixed.items[0].proof = 'true';
  writeFileSync(join(plans, 'r3.json'), JSON.stringify(fixed));
  assert.match(must(run(repo, 's-r3', 'prove', 'P1')).stdout, /complete/);
  assert.ok(!existsSync(join(plans, 'r3.json')) && existsSync(join(plans, 'done', 'r3.json')));
  assert.equal(stop(repo, 's-r3'), null);
});

test('R3: no verb and no transition makes an item done without a proof exiting 0', () => {
  const repo = seeded('r3b', 's-r3b');
  assert.equal(run(repo, 's-r3b', 'done', 'P1').status, 2);
  const item = { id: 'P1', status: 'todo' };
  const plan = { name: 'x', items: [item] };
  assert.ok(move(plan, 'P1', 'done').error);
  assert.ok(move(plan, 'P1', 'done', '', { exit: 1 }).error);
  assert.ok(move(plan, 'P1', 'todo', '', { exit: 0 }).error);
  assert.equal(item.status, 'todo');
  assert.equal(move(plan, 'P1', 'done', '', { exit: 0 }).error, undefined);
  assert.equal(item.status, 'done');
});

test('R3: hold and pause need a reason, move only an open item, and the hook then leaves the item alone', () => {
  const repo = seeded('r3c', 's-r3c', [['ask', 'false'], ['go', 'false']]);
  for (const verb of ['hold', 'pause']) {
    assert.equal(run(repo, 's-r3c', verb, 'P1').status, 2);
    assert.equal(run(repo, 's-r3c', verb, 'P1', '--why', '   ').status, 2);
  }
  assert.equal(planOf('r3c').items[0].status, 'todo');
  must(run(repo, 's-r3c', 'hold', 'P1', '--why', 'which database?'));
  assert.equal(planOf('r3c').items[0].why, 'which database?');
  assert.equal(run(repo, 's-r3c', 'pause', 'P1', '--why', 'later').status, 2);
  assert.match(stop(repo, 's-r3c').reason, /P2/);
  must(run(repo, 's-r3c', 'pause', 'P2', '--why', 'waiting on the owner'));
  const told = stop(repo, 's-r3c');
  assert.match(told.systemMessage, /which database\?/);
  assert.equal(told.decision, undefined);
  assert.equal(stop(repo, 's-r3c'), null);
  must(run(repo, 's-r3c', 'open', 'P1'));
  assert.equal(stop(repo, 's-r3c').decision, 'block');
});

test('R4: the fifth stop with no commit and no item changed says it is the last, the sixth passes; failing proofs do not renew it, a commit does', () => {
  const repo = seeded('r4', 's-r4', [['stuck', 'exit 1']]);
  for (let n = 1; n <= 5; n++) {
    const out = stop(repo, 's-r4');
    assert.equal(out.decision, 'block', `stop ${n}`);
    assert.equal(out.reason.includes('PushNotification'), n === 5, `stop ${n}`);
    assert.equal(run(repo, 's-r4', 'prove', 'P1').status, 1);
  }
  assert.equal(stop(repo, 's-r4'), null);
  assert.equal(stop(repo, 's-r4'), null);
  write(repo, 'b.txt', 'b\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'progress');
  const again = stop(repo, 's-r4');
  assert.equal(again.decision, 'block');
  assert.ok(!again.reason.includes('PushNotification'));
  must(run(repo, 's-r4', 'hold', 'P1', '--why', 'needs the owner'));
  must(run(repo, 's-r4', 'open', 'P1'));
  assert.equal(stop(repo, 's-r4').decision, 'block');
});

test('R5: a new or compacted session sees its plan; a session whose holder exited is told to take it, and take refuses while the holder lives', () => {
  const repo = seeded('r5', 's-r5', [['carry on', 'echo proof-r5']]);
  const start = (session, source = 'compact') => hook('SessionStart', 'plan', { cwd: repo, session_id: session, source }, source);
  alive('s-r5');
  const own = start('s-r5').hookSpecificOutput;
  assert.equal(own.hookEventName, 'SessionStart');
  assert.ok(own.additionalContext.includes('echo proof-r5') && own.additionalContext.includes('P1'));
  assert.equal(start('s-r5b', 'startup'), null);
  const refused = run(repo, 's-r5b', 'take', 'r5');
  assert.equal(refused.status, 2);
  assert.equal(planOf('r5').session, 's-r5');
  assert.equal(stop(repo, 's-r5b'), null);
  gone();
  const told = start('s-r5b', 'resume').hookSpecificOutput.additionalContext;
  assert.ok(told.includes('lpk plan take r5'));
  must(run(repo, 's-r5b', 'take', 'r5'));
  assert.equal(planOf('r5').session, 's-r5b');
  assert.equal(stop(repo, 's-r5b').decision, 'block');
  assert.equal(stop(repo, 's-r5'), null);
  assert.equal(hook('SessionStart', 'plan', { cwd: tmp, session_id: 's-elsewhere' }, 'startup'), null);
});

test('R2: a garbled plan answers nothing to other sessions and only a systemMessage to the session it names', () => {
  const repo = seeded('fm1', 's-fm1');
  writeFileSync(join(plans, 'zz-garbled.json'), '{"name":"zz-garbled","session":"s-garbled-owner","items":[{"id":"P1"');
  writeFileSync(join(plans, 'zz-shape.json'), JSON.stringify({ name: 'zz-shape', repo, session: 's-shape-owner', items: 'nope' }));
  assert.equal(stop(repo, 's-fm1').decision, 'block');
  assert.equal(stop(repo, 's-unrelated'), null);
  const own = stop(repo, 's-garbled-owner');
  assert.match(own.systemMessage, /zz-garbled\.json/);
  assert.equal(own.decision, undefined);
  assert.equal(hook('Stop', 'plan', 'not json'), null);
});

test('R3: a proof that hangs is killed at the timeout, recorded as exit 124, and the item stays open', () => {
  const repo = seeded('fm2', 's-fm2', [['hang', 'sleep 30']]);
  const t0 = Date.now();
  const p = run(repo, 's-fm2', 'prove', 'P1', '--timeout', '1');
  assert.ok(Date.now() - t0 < 15000);
  assert.equal(p.status, 1);
  assert.equal(planOf('fm2').items[0].status, 'todo');
  assert.equal(planOf('fm2').items[0].proved.exit, 124);
});

test('R3 R4: an item added while a proof runs is kept, and the proof result is kept with it', async () => {
  const repo = seeded('fm4', 's-fm4', [['slow', 'sleep 2; true']]);
  const child = spawn('node', [join(ROOT, 'bin', 'lpk'), 'plan', 'prove', 'P1'], { cwd: repo, env: { ...ENV, CLAUDE_CODE_SESSION_ID: 's-fm4' }, stdio: 'ignore' });
  const closed = new Promise((done) => child.on('close', done));
  await sleep(700);
  must(run(repo, 's-fm4', 'add', 'late', '--proof', 'true', '--source', 'owner'));
  assert.equal(await closed, 0);
  assert.deepEqual(planOf('fm4').items.map((i) => `${i.id}:${i.status}`), ['P1:done', 'P2:todo']);
});

test('R3 R5: a missing repo or command is a recorded failure; a plan made from a shell with no session is bound only by take; the output keeps the last 2000 characters', () => {
  const repo = seeded('fm3', 's-fm3', [['noisy', 'seq 1 5000; exit 2'], ['nothing', 'no-such-command-lpk-plan']]);
  const noisy = run(repo, 's-fm3', 'prove', 'P1');
  assert.equal(noisy.status, 1);
  assert.ok(planOf('fm3').items[0].proved.tail.length <= 2000 && planOf('fm3').items[0].proved.tail.endsWith('5000'));
  assert.equal(run(repo, 's-fm3', 'prove', 'P2').status, 1);
  assert.notEqual(planOf('fm3').items[1].proved.exit, 0);
  const loose = repoWith('repo-fm6', { 'a.txt': 'a\n' });
  must(run(loose, '', 'new', 'fm6'));
  assert.equal(planOf('fm6').session, '');
  assert.equal(run(loose, '', 'take', 'fm6').status, 2);
  assert.equal(stop(loose, ''), null);
  must(run(loose, 's-fm6', 'take', 'fm6'));
  assert.equal(planOf('fm6').session, 's-fm6');
});

test('R3: lpk plan prints each item with its status, proof and source, and the next item', () => {
  const repo = seeded('s1', 's-s1', [['alpha', 'true'], ['beta', 'echo beta-proof']]);
  must(run(repo, 's-s1', 'prove', 'P1'));
  const text = must(run(repo, 's-s1')).stdout;
  assert.match(text, /P1 \[done\] alpha/);
  assert.match(text, /P2 \[todo\] beta/);
  assert.ok(text.includes('echo beta-proof') && text.includes('the owner said so'));
  assert.match(text, /next: P2 beta/);
});

test('R3: a failing proof reopens only a done item; a held or paused item keeps its status and its question', () => {
  const repo = seeded('r3d', 's-r3d', [['ask', 'exit 1'], ['gate', 'exit 1'], ['ok', 'true']]);
  must(run(repo, 's-r3d', 'hold', 'P1', '--why', 'which database?'));
  must(run(repo, 's-r3d', 'pause', 'P2', '--why', 'later'));
  assert.equal(run(repo, 's-r3d', 'prove', 'P1').status, 1);
  assert.equal(run(repo, 's-r3d', 'prove', 'P2').status, 1);
  const [p1, p2] = planOf('r3d').items;
  assert.deepEqual([p1.status, p1.why, p1.proved.exit], ['held', 'which database?', 1]);
  assert.deepEqual([p2.status, p2.why], ['paused', 'later']);
  must(run(repo, 's-r3d', 'prove', 'P3'));
  const edit = planOf('r3d');
  edit.items[2].proof = 'exit 4';
  writeFileSync(join(plans, 'r3d.json'), JSON.stringify(edit));
  assert.equal(run(repo, 's-r3d', 'prove', 'P3').status, 1);
  assert.equal(planOf('r3d').items[2].status, 'todo');
  assert.equal(run(repo, 's-r3d', 'open', 'P3').status, 2);
});

test('R4: holding and reopening an item between stops does not renew the nudge budget', () => {
  const repo = seeded('r4b', 's-r4b', [['loop', 'exit 1'], ['other', 'exit 1']]);
  let blocks = 0;
  for (let n = 0; n < 6; n++) {
    if (stop(repo, 's-r4b')?.decision === 'block') blocks++;
    must(run(repo, 's-r4b', 'hold', 'P1', '--why', 'asking'));
    if (stop(repo, 's-r4b')?.decision === 'block') blocks++;
    must(run(repo, 's-r4b', 'open', 'P1'));
  }
  assert.equal(blocks, 5);
});

test('R4: a commit on a detached worktree of the plan repo counts as progress', () => {
  const repo = seeded('r4c', 's-r4c', [['stuck', 'exit 1']]);
  for (let n = 0; n < 5; n++) assert.equal(stop(repo, 's-r4c').decision, 'block');
  assert.equal(stop(repo, 's-r4c'), null);
  const wt = join(tmp, 'wt-r4c');
  sh(repo, 'worktree', 'add', '-q', '--detach', wt);
  write(wt, 'c.txt', 'c\n');
  sh(wt, 'add', '.'); sh(wt, 'commit', '-qm', 'detached progress');
  assert.equal(stop(repo, 's-r4c').decision, 'block');
});

test('R5: the nudge budget a holder spent is not the session\'s that takes the plan over', () => {
  const repo = seeded('r5b', 's-r5b-old', [['stuck', 'exit 1']]);
  for (let n = 0; n < 5; n++) assert.equal(stop(repo, 's-r5b-old').decision, 'block');
  assert.equal(stop(repo, 's-r5b-old'), null);
  must(run(repo, 's-r5b-new', 'take', 'r5b'));
  const first = stop(repo, 's-r5b-new');
  assert.equal(first.decision, 'block');
  assert.ok(!first.reason.includes('PushNotification'));
});
