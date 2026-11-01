import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = resolve(here, '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const only = flag('--task', '');
const arms = flag('--arms', 'with,without').split(',');
const runs = Number(flag('--runs', '1'));
const maxTurns = flag('--max-turns', '60');
const budget = Number(flag('--max-cost-usd', '10'));
const out = flag('--out', join(tmpdir(), `lpk-flow-${Date.now()}.jsonl`));
const keep = args.includes('--keep');

const tasks = readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(here, d.name, 'prompt.txt')) && (!only || d.name === only)).map((d) => d.name);
if (!tasks.length) { console.error(`no task${only ? ` named ${only}` : ''} with a prompt.txt in ${here}`); process.exit(2); }
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.error('run it as: cc-switch run env -u ANTHROPIC_API_KEY node lpk/evals-run/run.mjs'); process.exit(2); }

const sh = (cmd, argv, opts) => spawnSync(cmd, argv, { encoding: 'utf8', ...opts });
const count = (text, word) => Number((text.match(new RegExp(`^[ℹ#] ${word} (\\d+)`, 'm')) || [])[1] || 0);

function grade(dir, task, base) {
  const own = sh('npm', ['test', '--silent'], { cwd: dir, timeout: 120000 });
  const dirty = (sh('git', ['status', '--porcelain'], { cwd: dir }).stdout || '').split('\n').filter(Boolean).length;
  copyFileSync(join(here, task, 'hidden.test.mjs'), join(dir, 'hidden.test.mjs'));
  const h = sh('node', ['--test', 'hidden.test.mjs'], { cwd: dir, timeout: 120000 });
  return {
    hiddenPass: count(h.stdout, 'pass'),
    hiddenFail: count(h.stdout, 'fail') || (h.status ? 1 : 0),
    ownFail: count(own.stdout, 'fail') || (own.status ? 1 : 0),
    commits: Number((sh('git', ['rev-list', '--count', `${base}..HEAD`], { cwd: dir }).stdout || '0').trim()),
    dirty,
    lpkRun: existsSync(join(dir, '.git', 'lpk')),
  };
}

const claudeBin = sh('bash', ['-c', 'command -v claude']).stdout.trim() || 'claude';
const withoutLpk = (path) => path.split(':').filter((d) => !existsSync(join(d, 'lpk'))).join(':');

function once(task, arm, n) {
  const root = mkdtempSync(join(tmpdir(), `flow-${task}-${arm}-`));
  try {
    const dir = join(root, 'work');
    const home = join(root, 'home');
    mkdirSync(dir);
    mkdirSync(home);
    const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), XDG_DATA_HOME: join(home, 'data'), XDG_CACHE_HOME: join(home, 'cache'), XDG_STATE_HOME: join(home, 'state'), XDG_CONFIG_HOME: join(home, 'config') };
    env.PATH = arm === 'without' ? withoutLpk(env.PATH) : `${join(plugin, 'bin')}:${env.PATH}`;
    const f = sh('bash', [join(here, task, 'fixture.sh')], { cwd: dir, env });
    if (f.status !== 0) return { task, arm, n, error: `fixture failed: ${f.stderr}` };
    const base = sh('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
    const text = readFileSync(join(here, task, 'prompt.txt'), 'utf8').trim();
    const prompt = arm === 'with' ? `/lpk:lpk ${text}` : arm === 'flow' ? `/lpk:lpk ${text} Run \`lpk run start\` before the first edit and follow every step of the lpk skill, including the reviews it owes.` : text;
    const argv = ['-p', prompt, '--output-format', 'json', '--model', 'sonnet', '--permission-mode', 'bypassPermissions', '--max-turns', maxTurns];
    if (arm !== 'without') argv.push('--plugin-dir', plugin);
    const t0 = Date.now();
    const r = sh(claudeBin, argv, { cwd: dir, env, timeout: 2400000, maxBuffer: 64 * 1024 * 1024 });
    let res = {};
    try { res = JSON.parse(r.stdout); } catch { res = { parseError: (r.stdout || r.stderr || '').slice(0, 300) }; }
    const row = { task, arm, n, costUsd: res.total_cost_usd ?? null, seconds: Math.round((Date.now() - t0) / 1000), turns: res.num_turns ?? null, stop: res.subtype || res.parseError || null, ...grade(dir, task, base) };
    if (keep) row.dir = root;
    return row;
  } finally {
    if (!keep) rmSync(root, { recursive: true, force: true });
  }
}

let spent = 0;
for (const task of tasks) {
  for (let n = 1; n <= runs; n++) {
    for (const arm of arms) {
      if (spent >= budget) { console.error(`budget ${budget} USD reached; stopping`); process.exit(2); }
      const row = once(task, arm, n);
      writeFileSync(out, `${JSON.stringify(row)}\n`, { flag: 'a' });
      console.log(JSON.stringify(row));
      if (row.costUsd == null) { console.error('a run reported no cost, so the spend is unknown; stopping'); process.exit(2); }
      spent += row.costUsd;
    }
  }
}
console.error(`wrote ${out}, spent ${spent.toFixed(2)} USD`);
