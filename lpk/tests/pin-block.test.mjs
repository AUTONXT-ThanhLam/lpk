import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PARTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'ui-craft', 'parts.md');
const URL_IN_BLOCK = 'https://github.com/emilkowalski/skills.git';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let root, bare, pin, staleSha, script, wrapperDir, fetchLog;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'pin-block-'));
  const work = join(root, 'work');
  bare = join(root, 'skills.git');
  mkdirSync(join(work, 'skills', 'apple-design'), { recursive: true });
  git(work, 'init', '-q');
  git(work, 'config', 'user.email', 't@t');
  git(work, 'config', 'user.name', 't');
  writeFileSync(join(work, 'skills', 'apple-design', 'SKILL.md'), 'old\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'old');
  staleSha = git(work, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'skills', 'apple-design', 'SKILL.md'), 'pinned\n');
  git(work, 'commit', '-qam', 'pinned');
  pin = git(work, 'rev-parse', 'HEAD');
  git(root, 'clone', '-q', '--bare', work, bare);
  git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const block = /```sh\n([\s\S]*?)```/.exec(readFileSync(PARTS, 'utf8'))[1];
  assert.match(block, /^PIN=[0-9a-f]{40}$/m);
  script = join(root, 'block.sh');
  writeFileSync(script, block.replace(/^PIN=[0-9a-f]{40}$/m, `PIN=${pin}`));
  wrapperDir = join(root, 'bin');
  fetchLog = join(root, 'fetch.pids');
  mkdirSync(wrapperDir);
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(wrapperDir, 'git'), `#!/bin/sh\nfor a in "$@"; do if [ "$a" = fetch ]; then echo $$ >> "${fetchLog}"; sleep 1; fi; done\nexec ${realGit} "$@"\n`);
  chmodSync(join(wrapperDir, 'git'), 0o755);
});

after(() => rmSync(root, { recursive: true, force: true }));

const freshHome = (name, stale) => {
  const home = join(root, name);
  const clone = join(home, '.local', 'share', 'lpk', 'design-kit', 'emilkowalski-skills');
  mkdirSync(clone, { recursive: true });
  if (stale) {
    git(clone, 'init', '-q');
    git(clone, 'fetch', '-q', bare, staleSha);
    git(clone, 'checkout', '-q', '-f', 'FETCH_HEAD');
  } else rmSync(clone, { recursive: true });
  return { home, clone, kit: dirname(clone) };
};

const env = (home) => ({
  ...process.env, HOME: home, PATH: `${wrapperDir}${delimiter}${process.env.PATH}`,
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.file://${bare}.insteadOf`, GIT_CONFIG_VALUE_0: URL_IN_BLOCK,
});

const run = (shell, home) => new Promise((resolve) => {
  const child = spawn(shell, [script], { env: env(home) });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', (code) => resolve({ code, out: out.trim() }));
});

for (const shell of ['sh', 'bash']) {
  test(`the pin block run by ${shell} six times at once moves a stale clone to the pin and leaves no temp directory`, async () => {
    const { home, clone, kit } = freshHome(`stale-${shell}`, true);
    const results = await Promise.all(Array.from({ length: 6 }, () => run(shell, home)));
    assert.deepEqual(results.map((r) => r.out), Array(6).fill(`pinned ${pin}`));
    assert.equal(git(clone, 'rev-parse', 'HEAD'), pin);
    assert.deepEqual(readdirSync(kit), ['emilkowalski-skills']);
  });
}

test('the pin block run from an empty home pins, and does nothing the second time', async () => {
  const { home, clone } = freshHome('empty', false);
  assert.equal((await run('sh', home)).out, `pinned ${pin}`);
  const before = readdirSync(clone, { recursive: true }).length;
  rmSync(fetchLog, { force: true });
  assert.equal((await run('sh', home)).out, `pinned ${pin}`);
  assert.equal(existsSync(fetchLog), false);
  assert.equal(readdirSync(clone, { recursive: true }).length, before);
});

test('a run whose shell is killed mid-fetch does not stall the next run, and a later run sweeps what it left', async () => {
  const { home, kit } = freshHome('killed', false);
  rmSync(fetchLog, { force: true });
  const victim = spawn('sh', [script], { env: env(home), detached: true, stdio: 'ignore' });
  const exited = new Promise((resolve) => victim.on('close', resolve));
  try {
    for (let i = 0; i < 100 && !existsSync(fetchLog); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(fetchLog));
  } finally {
    process.kill(-victim.pid, 'SIGKILL');
    await exited;
  }
  const started = Date.now();
  const next = spawnSync('sh', [script], { env: env(home), encoding: 'utf8', timeout: 20000 });
  assert.equal(next.stdout.trim(), `pinned ${pin}`);
  assert.ok(Date.now() - started < 10000);
  const orphans = readdirSync(kit).filter((n) => n.startsWith('.pin.'));
  assert.equal(orphans.length, 1);
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  utimesSync(join(kit, orphans[0]), twoHoursAgo, twoHoursAgo);
  assert.equal(spawnSync('sh', [script], { env: env(home), encoding: 'utf8' }).stdout.trim(), `pinned ${pin}`);
  assert.deepEqual(readdirSync(kit), ['emilkowalski-skills']);
});
