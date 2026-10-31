import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { killRecorded } from '../lib/proc.mjs';

const WIN = process.platform === 'win32';
const LPK = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lpk');
const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'lpk-mutate-kill-')));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', XDG_CACHE_HOME: join(tmp, 'cache'), XDG_DATA_HOME: join(tmp, 'data') };
delete ENV.NODE_TEST_CONTEXT;
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const lpk = (cwd, args) => spawnSync('node', [LPK, ...args], { cwd, env: ENV, encoding: 'utf8' });
const inBash = (path) => path.replaceAll('\\', '/');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const worktrees = (repo) => sh(repo, 'worktree', 'list').trim().split('\n').length;

function repoWith(name) {
  const repo = join(tmp, name);
  mkdirSync(join(repo, 'src'), { recursive: true });
  sh(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'src', 'a.mjs'), 'export const a = 1;\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init'); sh(repo, 'switch', '-qc', 'feat');
  writeFileSync(join(repo, 'src', 'a.mjs'), 'export const a = 2;\n');
  return repo;
}

const SLEEPER = join(tmp, 'sleeper.mjs');
writeFileSync(SLEEPER, "import { basename } from 'node:path';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(`${process.argv[2]}.${basename(process.cwd())}`, String(process.pid));\nsetTimeout(() => {}, Number(process.argv[3]) * 1000);\n");
const sleeper = (name, seconds) => ({ file: (tree) => join(tmp, `${name}.pid.${tree}`), cmd: `node ${inBash(SLEEPER)} ${inBash(join(tmp, `${name}.pid`))} ${seconds}` });

async function pidOf(file) {
  for (let i = 0; i < 300 && !existsSync(file); i++) await pause(100);
  assert.ok(existsSync(file), `${file} was never written: the command did not start`);
  return Number(readFileSync(file, 'utf8'));
}
const processes = () => (WIN ? spawnSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) <- $($_.ParentProcessId) $($_.Name) $($_.CommandLine)" }'], { encoding: 'utf8' }).stdout : '');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid) {
  for (let i = 0; i < 30 && alive(pid); i++) await pause(100);
  return !alive(pid);
}

const INTERRUPTER = join(tmp, 'interrupter.mjs');
writeFileSync(INTERRUPTER, "import { existsSync } from 'node:fs';\nimport { pathToFileURL } from 'node:url';\nconst [lpk, marker, ...rest] = process.argv.slice(2);\nprocess.argv = [process.argv[0], lpk, ...rest];\nconst poll = setInterval(() => { if (existsSync(marker)) { clearInterval(poll); process.emit('SIGINT'); } }, 100);\nawait import(pathToFileURL(lpk).href);\n");

test('an interrupted lpk mutate stops its tests and removes its worktree', async () => {
  const repo = repoWith('interrupt');
  const t = sleeper('interrupt', 30);
  const args = ['mutate', '--base', 'main', '--test', t.cmd];
  const child = WIN ? spawn('node', [INTERRUPTER, LPK, t.file, ...args], { cwd: repo, env: ENV }) : spawn('node', [LPK, ...args], { cwd: repo, env: ENV });
  const childClosed = new Promise((r) => child.on('close', r));
  const testPid = await pidOf(t.file('wt'));
  if (!WIN) child.kill('SIGTERM');
  await childClosed;
  assert.equal(worktrees(repo), 1);
  assert.equal(await gone(testPid), true, 'the test command still runs');
});

test('a run killed outright is cleaned up by the next lpk mutate', async () => {
  const repo = repoWith('orphan');
  const t = sleeper('orphan', 30);
  const child = spawn('node', [LPK, 'mutate', '--base', 'main', '--test', t.cmd], { cwd: repo, env: ENV });
  const childClosed = new Promise((r) => child.on('close', r));
  const testPid = await pidOf(t.file('wt'));
  child.kill('SIGKILL');
  await childClosed;
  assert.equal(worktrees(repo), 2, 'SIGKILL leaves the worktree behind');
  const next = lpk(repo, ['mutate', '--base', 'main', '--test', 'true']);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(worktrees(repo), 1);
  assert.equal(await gone(testPid), true, `the orphaned test command ${testPid} still runs:\n${processes()}`);
  mkdirSync(join(tmp, 'orphan-in'), { recursive: true });
  writeFileSync(join(tmp, 'orphan-in', 'a'), '1\n');
  const c = sleeper('orphan-compare', 30);
  const cmp = spawn('node', [LPK, 'compare', '--base', 'main', '--run', c.cmd, '--inputs', join(tmp, 'orphan-in')], { cwd: repo, env: ENV });
  const cmpClosed = new Promise((r) => cmp.on('close', r));
  const cmpPids = [await pidOf(c.file('base')), await pidOf(c.file('wt'))];
  cmp.kill('SIGKILL');
  await cmpClosed;
  assert.equal(worktrees(repo), 3, 'SIGKILL leaves both worktrees behind');
  assert.equal(lpk(repo, ['mutate', '--base', 'main', '--test', 'true']).status, 0);
  assert.equal(worktrees(repo), 1);
  for (const pid of cmpPids) assert.equal(await gone(pid), true, `the orphaned compare command ${pid} still runs:\n${processes()}`);
});

test('a run sweeping a killed run that a sibling run already swept goes on', () => {
  assert.doesNotThrow(() => killRecorded(join(tmp, 'scratch-a-sibling-removed')));
});
