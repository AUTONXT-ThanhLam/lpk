import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../evals-run/run.mjs', import.meta.url));
const skip = process.platform === 'win32' && 'the harness needs GNU timeout';

function harness(claudeBody, argv) {
  const root = mkdtempSync(join(tmpdir(), 'evals-run-test-'));
  const bin = join(root, 'bin');
  const marker = join(root, 'claude-ran');
  const out = join(root, 'rows.jsonl');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash\ntouch ${marker}\n${claudeBody}\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_CODE_OAUTH_TOKEN: 'dummy' };
  const r = spawnSync(process.execPath, [script, ...argv.map((a) => (a === '@out' ? out : a))], { encoding: 'utf8', env, timeout: 120000 });
  const rows = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const ran = existsSync(marker);
  rmSync(root, { recursive: true, force: true });
  return { r, rows, ran };
}

const refused = [['--task'], ['--task', ''], ['--out', ''], ['--runs', '--keep'], ['--bogus', '1'], ['--task=csv'], ['--run', '3']];
for (const argv of refused) {
  test(`${JSON.stringify(argv)} is refused before any run starts`, { skip }, () => {
    const { r, rows, ran } = harness('echo {}', argv);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /needs a value|unknown argument/);
    assert.equal(rows.length, 0);
    assert.equal(ran, false);
  });
}

test('a result the CLI marks as an error is recorded as an error row and stops the batch', { skip }, () => {
  const body = `echo '{"is_error":true,"subtype":"success","total_cost_usd":0,"num_turns":1,"result":"Invalid API key"}'`;
  const { r, rows } = harness(body, ['--task', 'csv', '--arms', 'without', '--runs', '2', '--out', '@out']);
  assert.equal(r.status, 2);
  assert.equal(rows.length, 1);
  assert.match(rows[0].error, /Invalid API key/);
  assert.equal(rows[0].hiddenFail, undefined);
  assert.match(r.stderr, /Invalid API key/);
});

test('a CLI that fails without JSON is an error row, not a graded failure', { skip }, () => {
  const { r, rows } = harness('echo "Invalid API key - Please run /login"; exit 1', ['--task', 'csv', '--arms', 'without', '--runs', '2', '--out', '@out']);
  assert.equal(r.status, 2);
  assert.equal(rows.length, 1);
  assert.match(rows[0].error, /Invalid API key/);
  assert.equal(rows[0].hiddenFail, undefined);
});

test('an unwritable --out is refused before any run starts', { skip }, () => {
  const { r, ran } = harness('echo {}', ['--task', 'csv', '--out', '/nonexistent-dir-for-test/rows.jsonl']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not writable/);
  assert.equal(ran, false);
});

test('each run is given the budget still left as its own cap', { skip }, () => {
  const body = `case " $* " in *" --max-budget-usd "*) echo '{"subtype":"success","total_cost_usd":0.5,"num_turns":1}';; *) echo '{"is_error":true,"result":"no cap"}';; esac`;
  const { rows } = harness(body, ['--task', 'csv', '--arms', 'without', '--out', '@out']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, undefined);
});
