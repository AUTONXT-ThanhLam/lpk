// `lpk code-review` as the lead meets it: a headless /code-review child whose findings land in the
// ledger and whose record pays the code review the lane owes, and a child that fails pays nothing.
import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, ROOT, lpk, noHost, repoWith, sh, tmp, write } from './gates-env.mjs';
import { readLedger } from '../lib/findings.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const owed = (repo, S, env = ENV) => JSON.parse(spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'reviews', 'owed', '--json'], { cwd: repo, env: { ...env, CLAUDE_CODE_SESSION_ID: S }, encoding: 'utf8' }).stdout).map((r) => r.lens);

function fakeClaude(name, lines) {
  const bin = join(tmp, `${name}.mjs`);
  write(tmp, `${name}.mjs`, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(`${bin}.args`)}, JSON.stringify(process.argv.slice(2)));\n${lines.map((l) => `console.log(${JSON.stringify(JSON.stringify(l))});`).join('\n')}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const report = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ReportFindings', input: { findings: [
  { file: 'src/a.mjs', line: 1, summary: 'a is now a string, so a + 1 concatenates', failure_scenario: 'a + 1 returns "21" instead of 3', category: 'correctness' },
] } }] } };
const result = { type: 'result', subtype: 'success', is_error: false, result: 'done', duration_ms: 5, total_cost_usd: 0.01, modelUsage: { 'claude-sonnet-5-5': {} } };

function changedRepo(name, S) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  ok(lpk(repo, S, 'run', 'start', '--verify', 'false', '--scenario', 'true'));
  write(repo, 'src/a.mjs', 'export const a = "2";\n');
  sh(repo, 'commit', '-qam', 'Make a a string');
  return repo;
}

const codeReview = (repo, S, bin) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'code-review'], { cwd: repo, env: { ...ENV, CLAUDE_CODE_SESSION_ID: S, LPK_CLAUDE_BIN: bin }, encoding: 'utf8' });

test('a code review adds its findings to the ledger and pays the code review the lane owes', () => {
  const S = 'cr';
  const repo = changedRepo('cr', S);
  assert.ok(owed(repo, S).includes('code-review'));
  const bin = fakeClaude('claude-ok', [report, result]);
  const out = ok(codeReview(repo, S, bin));
  assert.match(out, /1 finding\(s\) added as F1; record /);
  const [f] = readLedger(repo).findings;
  assert.deepEqual([f.from, f.file, f.line, f.claim], ['code-review:sonnet', 'src/a.mjs', 1, 'a is now a string, so a + 1 concatenates']);
  assert.ok(!owed(repo, S).includes('code-review'), 'the record pays the owed code review');
  const args = JSON.parse(readFileSync(`${bin}.args`, 'utf8'));
  assert.deepEqual(args.slice(0, 4), ['-p', '/code-review high --max-findings all', '--model', 'sonnet']);
  assert.match(args[args.indexOf('--append-system-prompt') + 1], /^You review a diff\./);
});

test('a code review child that ends without a result fails and leaves the code review owed', () => {
  const S = 'crfail';
  const repo = changedRepo('crfail', S);
  const r = codeReview(repo, S, fakeClaude('claude-dead', [{ type: 'system', subtype: 'init' }]));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the review child ended without a result/);
  assert.ok(owed(repo, S).includes('code-review'));
});

test('on a host without the code review command the lane owes the code-reviewer agent', () => {
  const S = 'qoder';
  const repo = changedRepo('qoder', S);
  const env = { ...noHost(ENV), QODER_CONFIG_DIR: join(tmp, 'home', '.qoder'), QODER_PLUGIN_ROOT: ROOT };
  const lenses = owed(repo, S, env);
  assert.ok(lenses.includes('code-reviewer') && !lenses.includes('code-review'), lenses.join());
});
