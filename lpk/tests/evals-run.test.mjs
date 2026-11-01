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
  const r = spawnSync(process.execPath, [script, ...argv, '--out', out], { encoding: 'utf8', env, timeout: 120000 });
  const rows = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const ran = existsSync(marker);
  rmSync(root, { recursive: true, force: true });
  return { r, rows, ran };
}

test('a flag with no value is refused before any run starts', { skip }, () => {
  const { r, rows, ran } = harness('echo {}', ['--task']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--task needs a value/);
  assert.equal(rows.length, 0);
  assert.equal(ran, false);
});

test('a flag followed by another flag is refused', { skip }, () => {
  const { r, ran } = harness('echo {}', ['--runs', '--keep']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--runs needs a value/);
  assert.equal(ran, false);
});

test('a result the CLI marks as an error is recorded as an error row and stops the batch', { skip }, () => {
  const body = `echo '{"is_error":true,"subtype":"success","total_cost_usd":0,"num_turns":1,"result":"Invalid API key"}'`;
  const { r, rows } = harness(body, ['--task', 'csv', '--arms', 'without', '--runs', '2']);
  assert.equal(r.status, 2);
  assert.equal(rows.length, 1);
  assert.match(rows[0].error, /Invalid API key/);
  assert.equal(rows[0].hiddenFail, undefined);
  assert.match(r.stderr, /Invalid API key/);
});
