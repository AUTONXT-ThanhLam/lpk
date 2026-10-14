// The owner's status page as they meet it: the server `lpk run start` brings up, the runs it lists,
// and the summary the hooks have a model write in the background (a stand-in `claude` here).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LPK = join(ROOT, 'bin', 'lpk');
const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const tmp = mkdtempSync(join(tmpdir(), 'lpk-status-'));
const PORT = String(20000 + (process.pid % 20000));
const bin = join(tmp, 'bin');
mkdirSync(bin);
// The stand-in model: answers after a second, counting its calls in the headline.
writeFileSync(join(bin, 'claude'), `#!/bin/sh
cat > /dev/null
touch "${tmp}/started"
sleep 1
n=$(( $(cat "${tmp}/calls" 2>/dev/null || echo 0) + 1 )); echo $n > "${tmp}/calls"
echo '{"structured_output":{"headline":"Greet users by name (call '$n')","step":5,"now":"Writing greet","done":["Run started"],"next":["Verify"],"waiting":"","log":[{"kind":"start","msg":"Build started"}]}}'
`);
chmodSync(join(bin, 'claude'), 0o755);
const ENV = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LPK_STATUS_PORT: PORT, LPK_STATUS_URL: 'http://lpk.status/', CLAUDE_CODE_SESSION_ID: 's1', XDG_STATE_HOME: join(tmp, 'state'), XDG_DATA_HOME: join(tmp, 'data'), CLAUDE_PLUGIN_ROOT: ROOT, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
after(() => {
  try { process.kill(JSON.parse(readFileSync(join(tmp, 'state', 'lpk', 'status', 'server.json'), 'utf8')).pid); } catch { /* never started */ }
  rmSync(tmp, { recursive: true, force: true });
});

const lpk = (cwd, ...args) => spawnSync('node', [LPK, ...args], { cwd, env: ENV, encoding: 'utf8' });
const tick = (cwd, input) => {
  const cmd = HOOKS[input.hook_event_name].map((h) => h.hooks[0]).find((h) => h.command.endsWith('hook tick'));
  assert.equal(cmd.async, true, 'the session never waits on the summary');
  assert.equal(spawnSync('bash', ['-c', cmd.command], { cwd, env: ENV, input: JSON.stringify({ cwd, session_id: 's1', ...input }) }).status, 0);
};
const until = async (what, ok, ms = 15000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 200))) { const v = await what().catch(() => null); if (ok(v)) return v; }
  assert.fail('timed out');
};
const get = (path, host = 'lpk.status') => new Promise((resolve, reject) => {
  request({ host: '127.0.0.1', port: PORT, path, headers: { host } }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; }).on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject).end();
});
const runs = async () => JSON.parse((await get('/api/runs')).body);

function repo() {
  const dir = join(tmp, 'app');
  mkdirSync(join(dir, '.lpk', 'status'), { recursive: true });
  writeFileSync(join(dir, 'a.mjs'), 'export const a = 1;\n');
  writeFileSync(join(dir, '.lpk', 'status', 'index.html'), '<h1>roadmap</h1>');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: ENV });
  execFileSync('git', ['add', '.'], { cwd: dir, env: ENV });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir, env: ENV });
  execFileSync('git', ['switch', '-qc', 'greet'], { cwd: dir, env: ENV });
  return dir;
}
const line = (o) => `${JSON.stringify(o)}\n`;

test('the page lists a live run with its verify and summary, serves its project page, and keeps it after it ends', async () => {
  const dir = repo();
  const started = lpk(dir, 'run', 'start', '--base', 'main', '--verify', 'true');
  assert.match(started.stdout, /The owner follows this run at http:\/\/lpk\.status\//);
  writeFileSync(join(dir, 'greet.mjs'), 'export const greet = (n) => `Hello, ${n}`;\n');
  assert.equal(lpk(dir, 'verify').status, 0);
  const transcript = join(tmp, 's1.jsonl');
  writeFileSync(transcript, line({ type: 'user', origin: { kind: 'human' }, message: { content: 'Greet users by name' } })
    + line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'greet.mjs' } }] } }));

  for (let i = 0; i < 9; i++) tick(dir, { hook_event_name: 'PostToolUse', tool_name: 'Bash', transcript_path: transcript });
  assert.equal((await until(runs, (r) => r?.runs.length)).runs[0].narrative, null, 'nine calls start no summary');
  tick(dir, { hook_event_name: 'PostToolUse', tool_name: 'Bash', transcript_path: transcript });
  // The end of the turn comes while the tenth call's summary is still running: it is not lost.
  await until(async () => existsSync(join(tmp, 'started')), Boolean);
  appendFileSync(transcript, line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done, verify is green.' }] } }));
  tick(dir, { hook_event_name: 'Stop', transcript_path: transcript });
  const r = (await until(runs, (x) => x?.runs[0]?.narrative?.offset === statSync(transcript).size)).runs[0];
  assert.equal(r.name, 'app');
  assert.equal(r.branch, 'greet');
  assert.deepEqual([r.verify.green, r.verify.current], [true, true]);
  assert.equal(r.narrative.step, 5);
  assert.match(r.narrative.headline, /^Greet users by name \(call 2\)$/);
  assert.deepEqual(r.narrative.log.map((l) => l.msg), ['Build started', 'Build started']);

  assert.equal((await get(`/project/${r.id}/index.html`)).body, '<h1>roadmap</h1>');
  assert.equal((await get(`/project/${r.id}/..%2f..%2fa.mjs`)).status, 404, 'only the repo\'s .lpk/status is served');
  assert.equal((await get('/api/runs', `evil.example:${PORT}`)).status, 403, 'a page from another site gets nothing');
  assert.match((await get('/')).body, /<title>lpk runs<\/title>/);
  assert.equal((await get('/', `lpk.localhost:${PORT}`)).status, 200, 'the address that needs no setup still works');

  assert.equal(lpk(dir, 'run', 'end', '--reason', 'delivered').status, 0);
  const ended = await runs();
  assert.equal(ended.runs.length, 0);
  assert.deepEqual([ended.ended[0].id, ended.ended[0].reason, ended.ended[0].narrative.headline], [r.id, 'delivered', r.narrative.headline]);
  assert.ok(!existsSync(join(dir, '.git', 'lpk', 'status.json')), 'the next run starts without this one\'s summary');
});
