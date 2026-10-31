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

async function runWith(env, bin) {
  const keys = Object.keys(env);
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await runChild({ cwd: tmp, timeoutMs: 5000, rawFile: join(tmp, 'raw'), bin, prompt: 'p', model: 'sonnet' });
  } finally {
    for (const k of keys) before[k] === undefined ? delete process.env[k] : (process.env[k] = before[k]);
  }
}

function fakeClaude(name) {
  const bin = join(tmp, name);
  writeFileSync(bin, `#!/bin/sh\necho "$LPK_ACCOUNT $CLAUDE_CODE_OAUTH_TOKEN" > ${bin}.ran\necho '{"type":"result","subtype":"success","is_error":false,"result":"done"}'\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('the review child runs as the session account through cc-switch run', SKIP, async () => {
  const bin = fakeClaude('claude-same');
  const child = await runWith(ccSwitch('run-same', 'cc2'), bin);
  assert.equal(child.exit, 0);
  assert.equal(readFileSync(`${bin}.ran`, 'utf8').trim(), 'cc2 token-of-cc2');
});

test('claude is not started when the active account is another one than the session runs as', SKIP, async () => {
  const env = ccSwitch('other', 'cc1');
  assert.match(launchAs('claude', ['-p', 'x'], env).error, /runs as cc2 but the active account is cc1/);
  const bin = fakeClaude('claude-other');
  const child = await runWith(env, bin);
  assert.equal(child.exit, 'not started');
  assert.match(child.stderr, /active account is cc1/);
  assert.throws(() => readFileSync(`${bin}.ran`), /ENOENT/);
});

test('claude is not started when cc-switch is missing or fails', SKIP, async () => {
  const empty = join(tmp, 'empty');
  mkdirSync(empty, { recursive: true });
  const missing = { ...process.env, PATH: empty, LPK_ACCOUNT: 'cc2', CLAUDE_CODE_OAUTH_TOKEN: '' };
  assert.match(launchAs('claude', [], missing).error, /cc-switch did not run/);
  const failing = join(tmp, 'failing');
  mkdirSync(failing, { recursive: true });
  writeFileSync(join(failing, 'cc-switch'), '#!/bin/sh\necho broken >&2\nexit 1\n');
  chmodSync(join(failing, 'cc-switch'), 0o755);
  assert.match(launchAs('claude', [], { ...missing, PATH: failing }).error, /cc-switch did not run \(broken\)/);
});

test('a session without an account, or with a token in its shell, starts claude as before', () => {
  assert.deepEqual(launchAs('claude', ['a'], { PATH: process.env.PATH }), { cmd: 'claude', args: ['a'] });
  assert.deepEqual(launchAs('claude', ['a'], { LPK_ACCOUNT: 'cc2', CLAUDE_CODE_OAUTH_TOKEN: 't' }), { cmd: 'claude', args: ['a'] });
});
