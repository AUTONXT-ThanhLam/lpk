import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { launchAs } from '../lib/account.mjs';
import { runChild } from '../lib/codereview.mjs';

const SKIP = { skip: process.platform === 'win32' && 'cc-switch is bash only' };
const tmp = mkdtempSync(join(tmpdir(), 'lpk-account-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function ccSwitch(name, active) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cc-switch'), `#!/bin/sh\n[ "$1" = run ] || exit 2\nshift\nLPK_ACCOUNT=${active} CLAUDE_CODE_OAUTH_TOKEN=token-of-${active} exec "$@"\n`);
  chmodSync(join(dir, 'cc-switch'), 0o755);
  return { ...process.env, PATH: `${dir}:${process.env.PATH}`, LPK_ACCOUNT: 'cc2', CLAUDE_CODE_OAUTH_TOKEN: '' };
}

test('a shell with no token starts claude through cc-switch run when the active account is the session account', SKIP, () => {
  const env = ccSwitch('same', 'cc2');
  assert.deepEqual(launchAs('claude', ['-p', 'x'], env), { cmd: 'cc-switch', args: ['run', 'claude', '-p', 'x'] });
});

test('claude is not started when the active account is another one than the session runs as', SKIP, async () => {
  const env = ccSwitch('other', 'cc1');
  const launch = launchAs('claude', ['-p', 'x'], env);
  assert.match(launch.error, /runs as cc2 but the active account is cc1/);
  const marker = join(tmp, 'ran');
  const bin = join(tmp, 'fake-claude');
  writeFileSync(bin, `#!/bin/sh\necho ran > ${marker}\n`);
  chmodSync(bin, 0o755);
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const child = await runChild({ cwd: tmp, timeoutMs: 5000, rawFile: join(tmp, 'raw'), bin, prompt: 'p', model: 'sonnet' });
    assert.equal(child.exit, 'not started');
    assert.match(child.stderr, /active account is cc1/);
  } finally {
    process.env = saved;
  }
  assert.throws(() => readFileSync(marker), /ENOENT/);
});

test('a session without an account, or with a token in its shell, starts claude as before', () => {
  assert.deepEqual(launchAs('claude', ['a'], { PATH: process.env.PATH }), { cmd: 'claude', args: ['a'] });
  assert.deepEqual(launchAs('claude', ['a'], { LPK_ACCOUNT: 'cc2', CLAUDE_CODE_OAUTH_TOKEN: 't' }), { cmd: 'claude', args: ['a'] });
});
