import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, existsSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listening, nextRun, pairOrder, portAfterRun, portVoid, settled } from './pair.mjs';
import { mentionsHidden, smokeFixture, smokePrompt, smokeVerdict } from './smoke.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, '..');
const runnerTree = resolve(plugin, '..');
const args = process.argv.slice(2);
const usage = (why) => { console.error(`${why}\nrun it as: cc-switch run env -u ANTHROPIC_API_KEY node lpk/evals-run/run.mjs [--task name] [--arms with,without,flow | --baseline dir --candidate dir --hidden dir --out-dir dir] [--tasks dir] [--hidden dir] [--out-dir dir] [--runs n] [--max-turns n] [--max-cost-usd n] [--max-run-usd n] [--run-timeout seconds] [--busy-port port] [--model name] [--out file] [--keep] [--smoke]`); process.exit(2); };
const valued = ['--task', '--arms', '--runs', '--max-turns', '--max-cost-usd', '--model', '--out', '--baseline', '--candidate', '--tasks', '--hidden', '--out-dir', '--run-timeout', '--max-run-usd', '--busy-port'];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--keep' || args[i] === '--smoke') continue;
  if (!valued.includes(args[i])) usage(`unknown argument ${args[i]}`);
  const value = args[++i];
  if (!value || value.startsWith('--')) usage(`${args[i - 1]} needs a value`);
}
const flag = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const only = flag('--task', '');
const runs = Number(flag('--runs', '1'));
const maxTurns = flag('--max-turns', null);
const budget = Number(flag('--max-cost-usd', '10'));
const runUsd = flag('--max-run-usd', null);
const runTimeout = Number(flag('--run-timeout', '2400'));
const busyPort = Number(flag('--busy-port', '9333'));
const model = flag('--model', 'sonnet');
const out = flag('--out', join(tmpdir(), `lpk-flow-${Date.now()}.jsonl`));
const keep = args.includes('--keep');
const smoke = args.includes('--smoke');
const outDir = flag('--out-dir', '') && resolve(flag('--out-dir', ''));
const tasksDir = resolve(flag('--tasks', here));
const hiddenDir = resolve(flag('--hidden', here));
const armDirs = Object.fromEntries(['baseline', 'candidate'].filter((a) => args.includes(`--${a}`)).map((a) => [a, resolve(flag(`--${a}`))]));
const compare = Object.keys(armDirs).length > 0;
const hiddenGiven = args.includes('--hidden');
if (compare && args.includes('--arms')) usage('--arms cannot be combined with --baseline or --candidate');
const arms = compare ? Object.keys(armDirs) : flag('--arms', 'with,without').split(',');

const badArm = compare ? undefined : arms.find((a) => !['with', 'without', 'flow'].includes(a));
if (badArm !== undefined) usage(`unknown arm "${badArm}"`);
if (!Number.isInteger(runs) || runs < 1) usage('--runs needs a whole number of 1 or more');
if (!Number.isFinite(budget) || budget <= 0) usage('--max-cost-usd needs a positive number');
if (runUsd !== null && !(Number(runUsd) > 0)) usage('--max-run-usd needs a positive number');
if (!Number.isInteger(runTimeout) || runTimeout < 1) usage('--run-timeout needs a whole number of seconds');
if (!Number.isInteger(busyPort) || busyPort < 1 || busyPort > 65535) usage('--busy-port needs a port number');
if (maxTurns !== null && !/^\d+$/.test(maxTurns)) usage('--max-turns needs a whole number');
const armFacts = {};
const gitIn = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
for (const [arm, dir] of Object.entries(armDirs)) {
  const head = gitIn(dir, 'rev-parse', 'HEAD');
  const top = gitIn(dir, 'rev-parse', '--show-toplevel').stdout?.trim();
  const same = head.status === 0 && top && existsSync(dir) && realpathSync(top) === realpathSync(dir);
  if (!same || !existsSync(join(dir, 'lpk', 'bin'))) usage(`--${arm} ${dir} is not the top of a git checkout holding lpk/bin`);
  const changed = gitIn(dir, 'status', '--porcelain').stdout.split('\n').filter(Boolean).length;
  armFacts[arm] = changed ? { commit: head.stdout.trim(), armDirty: changed } : { commit: head.stdout.trim() };
}
if (compare && !outDir) usage('--baseline and --candidate need --out-dir, where every run is kept');
if (compare && !smoke && !hiddenGiven) usage('--baseline and --candidate need --hidden, a directory the agent never sees');
if (outDir) { try { mkdirSync(outDir, { recursive: true }); } catch (e) { usage(`--out-dir cannot be created: ${e.message}`); } }
const real = (p, name) => { try { return realpathSync(p); } catch (e) { return usage(`${name} ${p}: ${e.message}`); } };
const nested = (a, b) => a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
if (hiddenGiven) {
  const hidden = real(hiddenDir, '--hidden');
  const near = compare ? [...Object.entries(armDirs).map(([a, d]) => [`--${a}`, d]), ['the runner tree', runnerTree]] : [];
  const others = outDir ? [...near, ['--out-dir', outDir]] : near;
  for (const [name, dir] of others) if (nested(hidden, real(dir, name))) usage(`--hidden ${hiddenDir} overlaps ${name} ${dir}`);
}

const needed = ['prompt.txt', 'fixture.sh'];
const tasks = smoke ? ['smoke'] : existsSync(tasksDir) ? readdirSync(tasksDir, { withFileTypes: true }).filter((d) => d.isDirectory() && needed.every((f) => existsSync(join(tasksDir, d.name, f))) && (!only || d.name === only)).map((d) => d.name) : [];
if (!tasks.length) usage(`no task${only ? ` named ${only}` : ''} holding ${needed.join(', ')} in ${tasksDir}`);
const lacking = smoke ? undefined : tasks.find((t) => !existsSync(join(hiddenDir, t, 'hidden.test.mjs')));
if (lacking) usage(`--hidden ${hiddenDir} holds no ${lacking}/hidden.test.mjs`);
const hiddenReal = smoke ? '' : realpathSync(hiddenDir);
const hiddenNames = smoke ? [] : [...new Set(tasks.flatMap((t) => readdirSync(join(hiddenDir, t)).filter((f) => f === 'hidden.test.mjs' || !existsSync(join(tasksDir, t, f)))))];
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) usage('CLAUDE_CODE_OAUTH_TOKEN is not set');
try { writeFileSync(out, '', { flag: 'a' }); } catch (e) { usage(`--out is not writable: ${e.message}`); }

const sh = (cmd, argv, opts = {}) => {
  const { limit, ...rest } = opts;
  const r = spawnSync('timeout', ['-k', '10', String(limit ?? 60), cmd, ...argv], { encoding: 'utf8', ...rest });
  return { ...r, timedOut: r.status === 124 };
};
const failed = (r) => r.status !== 0;
const count = (text, word) => Number((text.match(new RegExp(`^[ℹ#] ${word} (\\d+)`, 'm')) || [])[1] || 0);

function grade(dir, task, base, env) {
  const dirty = (sh('git', ['status', '--porcelain'], { cwd: dir, env }).stdout || '').split('\n').filter(Boolean).length;
  const own = sh('npm', ['test', '--silent'], { cwd: dir, env, limit: 120 });
  copyFileSync(join(hiddenDir, task, 'hidden.test.mjs'), join(dir, 'hidden.test.mjs'));
  const h = sh('node', ['--test', 'hidden.test.mjs'], { cwd: dir, env, limit: 120 });
  return {
    hiddenPass: count(h.stdout || '', 'pass'),
    hiddenFail: count(h.stdout || '', 'fail') || (failed(h) ? 1 : 0),
    ownFail: count(own.stdout || '', 'fail') || (failed(own) ? 1 : 0),
    commits: Number((sh('git', ['rev-list', '--count', `${base}..HEAD`], { cwd: dir, env }).stdout || '0').trim()),
    dirty,
    lpkRun: existsSync(join(dir, '.git', 'lpk')),
  };
}

const claudeBin = sh('bash', ['-c', 'command -v claude']).stdout.trim() || 'claude';
const withoutLpk = (path) => path.split(':').filter((d) => !existsSync(join(d, 'lpk'))).join(':');
const pluginOf = (arm) => (armDirs[arm] ? join(armDirs[arm], 'lpk') : plugin);
const flowPrompt = (text) => `/lpk:lpk ${text} Run \`lpk run start\` before the first edit and follow every step of the lpk skill, including the reviews it owes.`;
const promptFor = (arm, text) => (smoke ? smokePrompt : arm === 'with' ? `/lpk:lpk ${text}` : arm === 'without' ? text : flowPrompt(text));

function extraWorktrees(clone, root, env) {
  const rootReal = realpathSync(root);
  const listed = (sh('git', ['worktree', 'list', '--porcelain'], { cwd: clone, env }).stdout || '').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)).slice(1);
  return listed.filter((p) => existsSync(p)).filter((p) => { const r = settled(p); return r !== rootReal && !r.startsWith(rootReal + sep); });
}

async function settle(arm, clone, home, root, env) {
  const row = {};
  const reaped = sh(join(pluginOf(arm), 'bin', 'lpk'), ['reap', '--repo', clone], { cwd: clone, env });
  if (failed(reaped)) row.reap = `exit ${reaped.status}: ${(reaped.stderr || '').slice(0, 300)}`;
  Object.assign(row, await portAfterRun(busyPort, home));
  for (const wt of extraWorktrees(clone, root, env)) sh('git', ['worktree', 'remove', '--force', wt], { cwd: clone, env });
  return row;
}

async function attempt(root, cloneName, task, arm, n) {
  const dir = join(root, cloneName);
  const home = join(root, 'home');
  mkdirSync(dir);
  mkdirSync(home);
  const base = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'), XDG_CONFIG_HOME: join(home, 'config') };
  base.PATH = arm === 'without' ? withoutLpk(base.PATH) : `${join(pluginOf(arm), 'bin')}:${compare ? withoutLpk(base.PATH) : base.PATH}`;
  delete base.ANTHROPIC_API_KEY;
  const { CLAUDE_CODE_OAUTH_TOKEN: token, ...plain } = base;
  const f = smoke ? sh('bash', ['-c', smokeFixture], { cwd: dir, env: plain }) : sh('bash', [join(tasksDir, task, 'fixture.sh')], { cwd: dir, env: plain });
  if (failed(f)) return { task, arm, n, error: `fixture failed: ${f.stderr}` };
  const sha = sh('git', ['rev-parse', 'HEAD'], { cwd: dir, env: plain }).stdout.trim();
  const text = smoke ? '' : readFileSync(join(tasksDir, task, 'prompt.txt'), 'utf8').trim();
  const left = budget - spent;
  const cap = runUsd === null ? left : Math.min(Number(runUsd), left);
  const argv = ['-p', promptFor(arm, text), '--output-format', 'json', '--model', model, '--permission-mode', 'bypassPermissions', '--max-budget-usd', cap.toFixed(4)];
  if (maxTurns !== null) argv.push('--max-turns', maxTurns);
  if (arm !== 'without') argv.push('--plugin-dir', pluginOf(arm));
  const t0 = Date.now();
  const r = sh(claudeBin, argv, { cwd: dir, env: base, limit: runTimeout, maxBuffer: 64 * 1024 * 1024 });
  let res = {};
  try { res = JSON.parse(r.stdout); if (!res || typeof res !== 'object') throw new Error('not an object'); } catch { res = { parseError: r.timedOut ? 'timeout' : `exit ${r.status}: ${(r.stdout || r.stderr || '').slice(0, 300)}` }; }
  const seconds = Math.round((Date.now() - t0) / 1000);
  const after = compare ? await settle(arm, dir, home, root, plain) : {};
  if (res.is_error || res.parseError) return { task, arm, n, costUsd: res.total_cost_usd ?? null, seconds, ...after, error: res.parseError ? `claude failed: ${res.parseError}` : `claude reported an error (${res.subtype}): ${String(res.result ?? '').slice(0, 300)}` };
  const row = { task, arm, n, costUsd: res.total_cost_usd ?? null, seconds, turns: res.num_turns ?? null, stop: res.subtype || null, ...after };
  const projects = join(home, '.claude', 'projects');
  if (smoke) return { ...row, smoke: smokeVerdict(projects) };
  if (hiddenGiven && !row.voided && mentionsHidden(projects, hiddenReal, hiddenNames)) row.voided = 'hidden test in a transcript';
  return row.voided ? row : { ...row, ...grade(dir, task, sha, plain) };
}

const batch = randomBytes(3).toString('hex');
async function once(task, arm, n, extra) {
  const name = `${task}-${arm}-${n}`;
  const root = outDir ? join(outDir, name) : mkdtempSync(join(tmpdir(), `flow-${task}-${arm}-`));
  if (outDir) mkdirSync(root);
  try {
    const row = { model, ...extra, ...await attempt(root, outDir ? `${name}-${batch}` : 'work', task, arm, n) };
    if (keep || outDir) row.dir = root;
    return row;
  } finally {
    if (!keep && !outDir) rmSync(root, { recursive: true, force: true });
  }
}

let spent = 0;
const stop = (why) => { console.error(`${why}\nwrote ${out}, spent ${spent.toFixed(2)} USD`); process.exit(2); };
const record = (row) => { writeFileSync(out, `${JSON.stringify(row)}\n`, { flag: 'a' }); console.log(JSON.stringify(row)); };
if (compare) console.error(`This comparison needs the host to itself until it ends: no other lpk session running, and the owner's Chrome on port ${busyPort} closed.`);
for (const task of tasks) {
  for (let round = 1; round <= runs; round++) {
    const n = outDir ? nextRun(outDir, task, arms) : round;
    const order = compare ? pairOrder().filter((a) => armDirs[a]) : arms;
    for (const [pos, arm] of order.entries()) {
      if (spent >= budget) stop(`budget ${budget} USD reached; stopping`);
      const extra = compare ? { ...armFacts[arm], pair: n, pos } : {};
      if (compare && await listening(busyPort)) {
        const error = `a listener on port ${busyPort} before the run; the batch needs the port free`;
        record({ task, arm, n, ...extra, error });
        stop(error);
      }
      const row = await once(task, arm, n, extra);
      record(row);
      spent += row.costUsd ?? 0;
      if (row.error) stop(row.error);
      if (row.voided === portVoid) stop(row.ownChrome ? `a listener on port ${busyPort} after the run in ${row.dir} is still on the port after the attempt to stop it` : `a listener on port ${busyPort} after the run in ${row.dir}, not started under its HOME; nothing was stopped`);
      if (row.costUsd == null) stop('a run reported no cost, so the spend is unknown; stopping');
    }
  }
}
console.error(`wrote ${out}, spent ${spent.toFixed(2)} USD`);
