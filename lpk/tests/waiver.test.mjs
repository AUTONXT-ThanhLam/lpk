// The owner's two ways to release a gate as a session meets them: /lpk-waive typed in a session
// that stands outside the run's repo, and the waiver question the gates' deny tells the agent to ask.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { hookBash, lpk, repoWith, sh, tmp, write } from './gates-env.mjs';
import { readRun } from '../lib/run.mjs';
import { recordWaiver, waiverRun } from '../lib/waiver.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };

function quickRun(name, session) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, session, 'run', 'start', '--lane', 'quick', '--why', 'one line', '--scenario', 'grep -q "a = 2" src/a.mjs', '--expect', '', '--verify', 'true'));
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  ok(lpk(repo, session, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 2');
  return repo;
}

test('the owner\'s /lpk-waive reaches the session\'s run from a directory outside its repo', () => {
  const S = 'outside-session';
  const repo = quickRun('outside', S);
  const outside = join(tmp, 'outside-parent');
  write(outside, 'README', 'not the run\'s repo\n');
  const r = lpk(outside, S, 'waive', 'gate:scenarios', '--why', 'the owner decided', '--via', '/lpk-waive');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /waived gate:scenarios in run \S+ via \/lpk-waive/);
  assert.match(lpk(repo, S, 'gates').stdout, /^scenarios +holds[\s\S]*waived by the owner/m);
  assert.equal(lpk(outside, 'another-session', 'waive', 'gate:scenarios', '--why', 'x', '--via', '/lpk-waive').status, 1, 'another session holds no run there');
});

test('the handover deny names the options of the waiver question, and the owner\'s picks release those gates', async () => {
  const S = 'ask-session';
  const repo = quickRun('ask', S);
  const create = 'gh pr create --title "Set a" --body x';
  const labels = [...new Set([...hookBash(repo, S, create).matchAll(/`(gate:\w+)`/g)].map((m) => m[1]))];
  assert.ok(labels.includes('gate:scenarios') && labels.includes('gate:reviews'), labels.join());
  const question = 'Release these?';
  const input = { session_id: S, tool_input: { questions: [{ question, multiSelect: true, options: labels.map((label) => ({ label, description: '' })) }], metadata: { source: 'lpk:waive' } }, tool_response: { answers: { [question]: labels.join(', ') } } };
  assert.equal(await recordWaiver(input, readRun(repo, S)), labels.length);
  assert.equal(hookBash(repo, S, create), null);
});

test('a waiver asked after the run ended still releases the gates that stay on its branch', async () => {
  const S = 'ended-session';
  const repo = quickRun('ended', S);
  sh(repo, 'checkout', '-q', '-b', 'ended-work');
  write(repo, 'src/a.mjs', 'export const a = 3;\n');
  ok(lpk(repo, S, 'verify'));
  sh(repo, 'commit', '-qam', 'Set a to 3');
  ok(lpk(repo, S, 'run', 'end', '--abandon', 'the work moved on'));
  const create = 'gh pr create --title "Set a" --body x';
  const labels = [...new Set([...hookBash(repo, S, create).matchAll(/`(gate:\w+)`/g)].map((m) => m[1]))];
  assert.ok(labels.length > 0, 'the ended run still holds the branch\'s gates');
  const question = 'Release these?';
  const input = { session_id: S, cwd: repo, tool_input: { questions: [{ question, multiSelect: true, options: labels.map((label) => ({ label, description: '' })) }], metadata: { source: 'lpk:waive' } }, tool_response: { answers: { [question]: labels.join(', ') } } };
  assert.equal(await recordWaiver(input, waiverRun(input)), labels.length);
  assert.equal(hookBash(repo, S, create), null);
});
