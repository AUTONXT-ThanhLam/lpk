import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, ROOT, repoWith, startRun, tmp } from './hooks-env.mjs';

const LAUNCHER_VARS = ['CC_SWAP_REQUEST', 'CC_SWAP_LAUNCHER', 'LPK_ACCOUNT'];
const RUNTIME = join(tmp, 'runtime');
const SAFE = Object.fromEntries(Object.entries({ ...ENV, XDG_RUNTIME_DIR: RUNTIME }).filter(([k]) => !LAUNCHER_VARS.includes(k)));
for (const k of ['XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) process.env[k] = SAFE[k];
const { drive } = await import('../lib/drive.mjs');

const BIN = join(ROOT, 'bin', 'lpk');
const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const plansDir = join(SAFE.XDG_DATA_HOME, 'lpk', 'plans');
const fileOf = (name) => join(plansDir, `${name}.json`);
const planOf = (name) => JSON.parse(readFileSync(fileOf(name), 'utf8'));
const doneFile = (name) => join(plansDir, 'done', `${name}.json`);

const lpk = (cwd, session, ...args) => spawnSync('node', [BIN, ...args], { cwd, env: { ...SAFE, CLAUDE_CODE_SESSION_ID: session }, encoding: 'utf8', timeout: 60_000 });
const must = (p) => { assert.equal(p.status, 0, p.stderr + p.stdout); return p; };

function seeded(name, session, proofs) {
  const repo = repoWith(`repo-${name}`, { 'a.txt': 'a\n' });
  must(lpk(repo, session, 'plan', 'new', name));
  proofs.forEach((proof, i) => must(lpk(repo, session, 'plan', 'add', `item ${i + 1}`, '--proof', proof, '--source', 'the owner said so')));
  return repo;
}

function stop(repo, session) {
  const entry = HOOKS.Stop.find((h) => h.hooks[0].command.endsWith('/lib/cmd/hook.mjs" plan'));
  const input = JSON.stringify({ hook_event_name: 'Stop', cwd: repo, session_id: session, stop_hook_active: false, last_assistant_message: 'done', background_tasks: [], session_crons: [] });
  const p = spawnSync('bash', ['-c', entry.hooks[0].command], { cwd: repo, env: SAFE, input, encoding: 'utf8', timeout: 60_000 });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim() ? JSON.parse(p.stdout) : null;
}

test('R2: a moved item is what lpk plan calls next and what drive opens', () => {
  const repo = seeded('order', 's-order', ['true', 'true', 'true']);
  must(lpk(repo, 's-order', 'plan', 'move', 'P3', '--before', 'P1'));
  assert.deepEqual(planOf('order').items.map((i) => i.id), ['P3', 'P1', 'P2']);
  const shown = must(lpk(repo, 's-order', 'plan')).stdout.trim().split('\n');
  assert.match(shown.at(-1), /^next: P3 /);
  const request = join(tmp, 'order-request');
  const r = drive({
    plan: planOf('order'),
    session: 's-order',
    env: { CC_SWAP_REQUEST: request, CC_SWAP_LAUNCHER: '100', XDG_RUNTIME_DIR: RUNTIME },
    deps: { start: 7, parent: (pid) => ({ 7: '100' })[pid], say: () => {}, kill: () => {} },
  });
  assert.ok(!r.error, r.error);
  assert.equal(r.item.id, 'P3');
  assert.match(readFileSync(r.card, 'utf8'), /^Item: P3$/m);
});

test('R2 R3: a bad move or remove says what is wrong, exits 2 and leaves the file as it was', () => {
  const repo = seeded('bad', 's-bad', ['true', 'true']);
  const rows = [
    [['move', 'P9', '--before', 'P1'], /\bP9\b/],
    [['move', 'P1', '--before', 'P9'], /\bP9\b/],
    [['move', 'P1'], /--before/],
    [['move', 'P1', '--before', 'P1'], /\bP1\b.*itself/],
    [['remove', 'P9', '--why', 'w'], /\bP9\b/],
    [['remove', 'P1'], /--why/],
    [['remove', 'P1', '--why', '  '], /--why/],
  ];
  const before = readFileSync(fileOf('bad'), 'utf8');
  for (const [args, says] of rows) {
    const p = lpk(repo, 's-bad', 'plan', ...args);
    assert.equal(p.status, 2, args.join(' '));
    assert.match(p.stderr, says);
    assert.doesNotMatch(p.stderr, /unknown verb/);
    assert.equal(readFileSync(fileOf('bad'), 'utf8'), before, args.join(' '));
  }
});

test('R3: remove drops an open or held item and its id is never given again, a done item is refused', () => {
  const repo = seeded('drop', 's-drop', ['true', 'exit 1', 'exit 1', 'exit 1']);
  must(lpk(repo, 's-drop', 'plan', 'prove', 'P1'));
  const before = readFileSync(fileOf('drop'), 'utf8');
  const refused = lpk(repo, 's-drop', 'plan', 'remove', 'P1', '--why', 'w');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /\bP1\b/);
  assert.equal(readFileSync(fileOf('drop'), 'utf8'), before);

  must(lpk(repo, 's-drop', 'plan', 'hold', 'P2', '--why', 'which colour'));
  const said = must(lpk(repo, 's-drop', 'plan', 'remove', 'P2', '--why', 'the owner withdrew it')).stdout;
  assert.ok(said.includes('P2') && said.includes('the owner withdrew it') && said.includes('lpk decide'), said);
  must(lpk(repo, 's-drop', 'plan', 'remove', 'P4', '--why', 'w4'));
  assert.deepEqual(planOf('drop').items.map((i) => i.id), ['P1', 'P3']);
  assert.deepEqual(planOf('drop').removed.map((r) => [r.id, r.title, r.why]), [['P2', 'item 2', 'the owner withdrew it'], ['P4', 'item 4', 'w4']]);
  assert.ok(planOf('drop').removed.every((r) => r.at));

  assert.match(must(lpk(repo, 's-drop', 'plan', 'add', 'later', '--proof', 'true', '--source', 's')).stdout, /\bP5\b/);
  const shown = must(lpk(repo, 's-drop', 'plan')).stdout.trim().split('\n');
  assert.ok(shown.some((l) => l.includes('P2') && l.includes('the owner withdrew it')), shown.join('\n'));
  assert.match(shown.at(-1), /^next: P3 /);
});

test('R3: every way a plan completes prints each removed id and why', async (t) => {
  const rows = [
    ['removing the last open item', ['true', 'exit 1'], [['prove', 'P1'], ['remove', 'P2', '--why', 'why two']], ['P2', 'why two'], null],
    ['proving the last open item after a removal', ['exit 1', 'true'], [['remove', 'P1', '--why', 'why one'], ['prove', 'P2']], ['P1', 'why one'], null],
    ['removing every item', ['exit 1', 'exit 1'], [['remove', 'P1', '--why', 'why one'], ['remove', 'P2', '--why', 'why two']], ['P1', 'why one', 'P2', 'why two'], /no item left, 2 removed/],
  ];
  for (const [index, [name, proofs, steps, names, line]] of rows.entries()) {
    await t.test(name, () => {
      const plan = `complete-${index}`;
      const repo = seeded(plan, `s-${plan}`, proofs);
      const out = steps.map((s) => must(lpk(repo, `s-${plan}`, 'plan', ...s)).stdout);
      const last = out.at(-1);
      assert.ok(!existsSync(fileOf(plan)) && existsSync(doneFile(plan)), 'the plan is in done');
      for (const fact of names) assert.ok(last.includes(fact), last);
      if (line) assert.match(last, line);
    });
  }
});

test('R3: a plan that never had an item is not ended by remove and a plan with an open item stays', () => {
  const repo = seeded('none', 's-none', []);
  assert.equal(lpk(repo, 's-none', 'plan', 'remove', 'P1', '--why', 'w').status, 2);
  assert.ok(existsSync(fileOf('none')));
  const open = seeded('stays', 's-stays', ['exit 1', 'exit 1']);
  must(lpk(open, 's-stays', 'plan', 'remove', 'P1', '--why', 'w'));
  assert.ok(existsSync(fileOf('stays')) && !existsSync(doneFile('stays')));
});

test('R3: run end carries one line per removed item of the plan', () => {
  const repo = seeded('told', 's-told', ['exit 1', 'exit 1', 'exit 1']);
  must(lpk(repo, 's-told', 'plan', 'remove', 'P1', '--why', 'why one'));
  must(lpk(repo, 's-told', 'plan', 'remove', 'P2', '--why', 'why two'));
  startRun(repo, 's-told');
  const out = must(lpk(repo, 's-told', 'run', 'end')).stdout.split('\n');
  assert.equal(out.filter((l) => /\bP1\b/.test(l) && l.includes('why one')).length, 1, out.join('\n'));
  assert.equal(out.filter((l) => /\bP2\b/.test(l) && l.includes('why two')).length, 1, out.join('\n'));
});

test('R3: report and run end name a removal once after the plan completed during the run', () => {
  const repo = seeded('told-done', 's-told-done', ['exit 1', 'true']);
  must(lpk(repo, 's-told-done', 'plan', 'remove', 'P1', '--why', 'why one'));
  startRun(repo, 's-told-done');
  must(lpk(repo, 's-told-done', 'plan', 'prove', 'P2'));
  assert.ok(existsSync(doneFile('told-done')), 'the plan is in done');
  for (const verb of ['report', 'run end']) {
    const out = lpk(repo, 's-told-done', ...verb.split(' ')).stdout.split('\n');
    assert.equal(out.filter((l) => /\bP1\b/.test(l) && l.includes('why one')).length, 1, `${verb}:\n${out.join('\n')}`);
  }
});

test('R6: the Stop hook pursues the new next item with a full budget after a move or a removal', async (t) => {
  const rows = [
    ['move', ['plan', 'move', 'P2', '--before', 'P1'], 'P2'],
    ['remove', ['plan', 'remove', 'P1', '--why', 'w'], 'P2'],
  ];
  for (const [name, args, next] of rows) {
    await t.test(name, () => {
      const plan = `budget-${name}`;
      const session = `s-${plan}`;
      const repo = seeded(plan, session, ['exit 1', 'exit 1']);
      for (let n = 0; n < 10; n++) assert.equal(stop(repo, session).decision, 'block');
      assert.equal(stop(repo, session), null, 'the budget of the first item is spent');
      must(lpk(repo, session, ...args));
      const first = stop(repo, session);
      assert.equal(first.decision, 'block');
      assert.ok(first.reason.includes(`${next} is open`), first.reason);
      assert.ok(!first.reason.includes('PushNotification'), first.reason);
    });
  }
});

test('R6: moving a done item past another done item does not renew the Stop hook budget', () => {
  const repo = seeded('budget-done', 's-budget-done', ['true', 'true', 'exit 1']);
  must(lpk(repo, 's-budget-done', 'plan', 'prove', 'P1'));
  must(lpk(repo, 's-budget-done', 'plan', 'prove', 'P2'));
  for (let n = 0; n < 10; n++) assert.equal(stop(repo, 's-budget-done').decision, 'block');
  assert.equal(stop(repo, 's-budget-done'), null, 'the budget of P3 is spent');
  must(lpk(repo, 's-budget-done', 'plan', 'move', 'P2', '--before', 'P1'));
  assert.deepEqual(planOf('budget-done').items.map((i) => i.id), ['P2', 'P1', 'P3']);
  assert.equal(stop(repo, 's-budget-done'), null, 'no work was done, so the hook stays silent');
});

test('R5: understand.md names the two verbs and both are verbs of lpk plan', () => {
  const text = readFileSync(join(ROOT, 'skills', 'lpk', 'understand.md'), 'utf8');
  const repo = seeded('verbs', 's-verbs', []);
  for (const verb of ['move', 'remove']) {
    assert.ok(text.includes(`lpk plan ${verb} `), verb);
    assert.doesNotMatch(lpk(repo, 's-verbs', 'plan', verb).stderr, /unknown verb/);
  }
});
