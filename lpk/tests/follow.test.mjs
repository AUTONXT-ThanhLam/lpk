import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = { skip: process.platform === 'win32' && 'follow-account runs under cc-switch, which is bash only' };
const tmp = mkdtempSync(join(tmpdir(), 'lpk-follow-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function setup(name, sessions) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const list = sessions.map(({ id }) => {
    const cwd = join(dir, 'work', id);
    mkdirSync(cwd, { recursive: true });
    return { id, kind: 'background', cwd, sessionId: `${id}-session`, name: `job ${id}`, state: 'working' };
  });
  list.push({ kind: 'interactive', cwd: '/work/main', sessionId: 'main-session', name: 'main', status: 'busy' });
  writeFileSync(join(dir, 'list.json'), JSON.stringify(list));
  writeFileSync(join(dir, 'claude'), `#!/usr/bin/env node
const fs = require('node:fs');
const dir = ${JSON.stringify(dir)};
const a = process.argv.slice(2);
fs.appendFileSync(dir + '/calls', [process.env.LPK_ACCOUNT, process.cwd(), a.join(' ')].join(' | ') + '\\n');
if (a[0] === 'agents') {
  const stopped = fs.existsSync(dir + '/stopped') ? fs.readFileSync(dir + '/stopped', 'utf8').split('\\n') : [];
  console.log(JSON.stringify(JSON.parse(fs.readFileSync(dir + '/list.json', 'utf8')).map((s) => (stopped.includes(s.id) ? { ...s, state: 'blocked' } : s))));
} else if (a[0] === 'stop' && fs.existsSync(dir + '/nostop-' + a[1])) { console.log('no such session'); process.exit(1); }
else if (a[0] === 'stop') fs.appendFileSync(dir + '/stopped', a[1] + '\\n');
else if (a[0] === 'daemon' && fs.existsSync(dir + '/daemonfail')) { console.log('daemon refused'); process.exit(1); }
else console.log('ok ' + a[0]);
`);
  chmodSync(join(dir, 'claude'), 0o755);
  return dir;
}

const follow = (dir, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'follow-account', ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, LPK_ACCOUNT: 'cc2', CLAUDE_CONFIG_DIR: join(dir, 'cfg') } });
const calls = (dir) => spawnSync('cat', [join(dir, 'calls')], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.split(' | '));
const verbs = (dir) => calls(dir).map((c) => c[2]);

test('follow-account stops every working session, restarts the daemon and resumes each in its folder as the new account', SKIP, () => {
  const dir = setup('all', [{ id: 'a1' }, { id: 'b2' }]);
  const r = follow(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const v = verbs(dir);
  for (const id of ['a1', 'b2']) {
    assert.ok(v.indexOf(`stop ${id}`) >= 0 && v.indexOf(`stop ${id}`) < v.indexOf('daemon stop --any'), v.join('\n'));
    const resume = calls(dir).find((c) => c[2].startsWith(`--bg --resume ${id}-session `));
    assert.equal(resume[0], 'cc2');
    assert.equal(resume[1], join(dir, 'work', id));
  }
  assert.equal(v.filter((x) => x.includes('--resume')).length, 2);
  assert.ok(!v.some((x) => x.includes('main-session')));
});

test('follow-account leaves alone a session that will not stop instead of resuming it', SKIP, () => {
  const dir = setup('nostop', [{ id: 'a1' }, { id: 'b2' }]);
  writeFileSync(join(dir, 'nostop-a1'), '');
  const r = follow(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /not moved: a1 \(job a1\) would not stop: no such session/);
  const resumed = verbs(dir).filter((x) => x.includes('--resume'));
  assert.equal(resumed.length, 1);
  assert.ok(resumed[0].startsWith('--bg --resume b2-session '));
});

test('follow-account puts the stopped sessions back where they were when the daemon will not stop', SKIP, () => {
  const dir = setup('daemonfail', [{ id: 'a1' }]);
  writeFileSync(join(dir, 'daemonfail'), '');
  const r = follow(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /could not stop the daemon: daemon refused/);
  const resumes = verbs(dir).filter((x) => x.startsWith('--bg --resume a1-session'));
  assert.equal(resumes.length, 1);
});

test('follow-account with no background session still restarts the daemon so the next --bg starts on the new account', SKIP, () => {
  const dir = setup('none', []);
  const r = follow(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(verbs(dir).filter((x) => !x.startsWith('agents')), ['daemon stop --any']);
});
