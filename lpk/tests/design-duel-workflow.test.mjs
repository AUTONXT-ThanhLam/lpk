// The design duel workflow as the Workflow tool runs it: its script body with agent(), parallel()
// and log() standing in for the runtime's, and the architects and the judge answering from a table.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BODY = readFileSync(join(ROOT, 'workflows', 'design-duel.js'), 'utf8').replace(/^export const meta = \{[\s\S]*?\n\}\n/, '');
const AsyncFunction = (async () => {}).constructor;
const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)));

const ARGS = { repo: '/r', base: 'main', skillDir: '/p/skills/lpk', sources: ['/r/.git/lpk/sources/request.md'], dir: '/r/.git/lpk/duel' };

async function run(args, answer) {
  const calls = [];
  const agent = async (prompt, opts) => { calls.push({ prompt, opts }); return answer(opts); };
  const out = await new AsyncFunction('args', 'agent', 'parallel', 'log', 'phase', BODY)(args, agent, parallel, () => {}, () => {});
  return { out, calls };
}
const judge = { ranking: [{ card: 'failure', open: [] }, { card: 'small', open: [{ attack: 'two runs at once', harm: 'High' }] }], pick: 'failure', why: 'no High left' };
const answers = (fail = []) => (o) => {
  if (o.label === 'judge') return judge;
  if (fail.some((f) => o.label.startsWith(f))) throw new Error('stalled');
  return { summary: o.label };
};
const step = (calls, mode) => calls.filter((c) => c.opts.label.startsWith(`${mode}:`));

test('three architects write, each attacks the two rival briefs, each revises against the attacks on it, and a Sonnet judge picks', async () => {
  const { out, calls } = await run(ARGS, answers());
  assert.deepEqual(calls.map((c) => c.opts.label), ['write:small', 'write:failure', 'write:pattern',
    'attack:small', 'attack:failure', 'attack:pattern', 'revise:small', 'revise:failure', 'revise:pattern', 'judge']);
  assert.ok(calls.slice(0, 9).every((c) => c.opts.agentType === 'lpk:architect'));
  const attack = step(calls, 'attack').find((c) => c.opts.label === 'attack:small').prompt;
  assert.match(attack, /duel\/failure\/brief\.md/);
  assert.match(attack, /duel\/pattern\/brief\.md/);
  assert.doesNotMatch(attack.split('The rival briefs:')[1], /duel\/small\//);
  const revise = step(calls, 'revise').find((c) => c.opts.label === 'revise:small').prompt;
  assert.match(revise, /duel\/failure\/attacks\.md[\s\S]*duel\/pattern\/attacks\.md/);
  assert.doesNotMatch(revise.split('The attacks on your brief')[1], /duel\/small\/attacks/);
  assert.equal(calls.at(-1).opts.model, 'sonnet');
  assert.equal(out.pick, 'failure');
  assert.deepEqual(out.briefs.map((b) => b.brief), ['small', 'failure', 'pattern'].map((c) => `/r/.git/lpk/duel/${c}/brief.md`));
});

test('an architect that never writes is left out of the duel and named; with fewer than two there is no duel', async () => {
  const { out, calls } = await run(ARGS, answers(['write:pattern']));
  assert.deepEqual(out.missing, ['pattern']);
  assert.deepEqual(step(calls, 'write').map((c) => c.opts.label), ['write:small', 'write:failure', 'write:pattern', 'write:pattern#2']);
  assert.ok(!calls.some((c) => /pattern\/(brief|attacks)/.test(c.prompt) && !c.opts.label.startsWith('write:pattern')));
  const lone = await run(ARGS, answers(['write:pattern', 'write:failure']));
  assert.match(lone.out.error, /fewer than two/);
  assert.equal(step(lone.calls, 'attack').length, 0);
});
