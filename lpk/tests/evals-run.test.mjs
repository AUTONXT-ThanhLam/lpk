import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../evals-run/run.mjs', import.meta.url));
const skip = process.platform === 'win32' && 'the harness needs GNU timeout';

function harness(claudeBody, argv, extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'evals-run-test-'));
  const bin = join(root, 'bin');
  const marker = join(root, 'claude-ran');
  const out = join(root, 'rows.jsonl');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/usr/bin/env bash\ntouch ${marker}\n${claudeBody}\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: 'dummy', ...extraEnv, PATH: [bin, extraEnv.PATH, process.env.PATH].filter(Boolean).join(':') };
  delete env.NODE_TEST_CONTEXT;
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

const seen = `pd=; mt=none; pr=; usd=; prev=; for a in "$@"; do case $prev in --plugin-dir) pd=$a;; --max-turns) mt=$a;; --max-budget-usd) usd=$a;; -p) pr=$a;; esac; prev=$a; done
printf '{"plugin":"%s","lpk":"%s","path":"%s","turns":"%s","usd":"%s","flow":%s}\\n' "$pd" "$(command -v lpk)" "$PATH" "$mt" "$usd" "$([[ $pr == *'lpk run start'* ]] && echo true || echo false)" >> "$EVALS_LOG"`;
const transcript = 'mkdir -p "$CLAUDE_CONFIG_DIR/projects/p" && printf \'%s\\n\' "$EVALS_TEXT" > "$CLAUDE_CONFIG_DIR/projects/p/s.jsonl"';
const listen = `setsid -f node -e 'require("net").createServer().listen(+process.argv[1], "127.0.0.1", () => require("fs").writeFileSync(process.argv[2], String(process.pid)))' "$EVALS_PORT" "$EVALS_PIDS/$(basename "$PWD")" "--user-data-dir=\${EVALS_UDD:-$HOME/chrome}" >/dev/null 2>&1
for i in $(seq 50); do [ -s "$EVALS_PIDS/$(basename "$PWD")" ] && break; sleep 0.1; done`;
const ok = `echo '{"subtype":"success","total_cost_usd":'"\${EVALS_COST:-0}"',"num_turns":1}'`;
const stub = (...parts) => [seen, ...parts, ok].join('\n');

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).stdout.trim();
const freePort = () => new Promise((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const listeners = (b) => readdirSync(b.pids).map((f) => Number(readFileSync(join(b.pids, f), 'utf8')));
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []);

async function bench(fn) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evals-bench-')));
  const arm = (name) => {
    const d = join(root, name);
    mkdirSync(join(d, 'lpk', 'bin'), { recursive: true });
    writeFileSync(join(d, 'lpk', 'bin', 'lpk'), '#!/usr/bin/env bash\necho "$0 $*" >> "$EVALS_REAP"\nexit "${EVALS_REAP_EXIT:-0}"\n');
    chmodSync(join(d, 'lpk', 'bin', 'lpk'), 0o755);
    git(d, 'init', '-q');
    git(d, 'add', '-A');
    git(d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', name);
    return d;
  };
  const H = join(root, 'hidden');
  mkdirSync(join(H, 'csv'), { recursive: true });
  writeFileSync(join(H, 'csv', 'hidden.test.mjs'), "import { test } from 'node:test';\nfor (const n of [1, 2, 3]) test(`fingerprint ${n}`, () => {});\n");
  const b = { root, A: arm('A'), B: arm('B'), H, D: join(root, 'out'), log: join(root, 'log'), reap: join(root, 'reap'), pids: join(root, 'pids'), port: await freePort() };
  b.env = { EVALS_LOG: b.log, EVALS_REAP: b.reap, EVALS_PIDS: b.pids, EVALS_PORT: String(b.port) };
  mkdirSync(b.pids);
  b.compare = (...more) => ['--task', 'csv', '--baseline', b.A, '--candidate', b.B, '--hidden', H, '--out-dir', b.D, '--busy-port', String(b.port), '--out', '@out', ...more];
  try { await fn(b); } finally {
    for (const pid of listeners(b)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    rmSync(root, { recursive: true, force: true });
  }
}

test('each comparison arm runs its own plugin, lpk alone on PATH and flow prompt, records its commit and uncommitted changes, and its outside worktree goes even when lpk reap fails', { skip }, () => bench((b) => {
  writeFileSync(join(b.A, 'scratch'), '');
  const decoy = join(b.root, 'decoy');
  mkdirSync(decoy);
  writeFileSync(join(decoy, 'lpk'), '');
  const wt = 'git worktree add -q --detach "/tmp/$(basename "$PWD")-main" && git worktree add -q --detach .git/inner';
  const { r, rows } = harness(stub(wt), b.compare(), { ...b.env, EVALS_REAP_EXIT: '3', PATH: decoy });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rows.length, 2);
  const seenBy = lines(b.log).map((l) => JSON.parse(l));
  assert.deepEqual(seenBy.map((s) => s.plugin).sort(), [join(b.A, 'lpk'), join(b.B, 'lpk')]);
  for (const s of seenBy) assert.deepEqual([s.lpk, ...s.path.split(':').filter((d) => existsSync(join(d, 'lpk')))], [join(s.plugin, 'bin', 'lpk'), join(s.plugin, 'bin')]);
  for (const s of seenBy) assert.equal(s.path.split(':')[0], join(s.plugin, 'bin'));
  assert.ok(seenBy.every((s) => s.flow && s.turns === 'none'));
  for (const row of rows) {
    assert.equal(row.commit, git(row.arm === 'baseline' ? b.A : b.B, 'rev-parse', 'HEAD'));
    assert.equal(row.armDirty, row.arm === 'baseline' ? 1 : undefined);
    assert.match(row.reap, /^exit 3/);
    const clone = readdirSync(row.dir).find((d) => d !== 'home');
    assert.equal(existsSync(join('/tmp', `${clone}-main`)), false);
    assert.equal(existsSync(join(row.dir, clone, '.git', 'inner')), true);
  }
}));

test('an arm dir that is not the top of a git checkout holding lpk/bin is refused before any run', { skip }, () => bench((b) => {
  const plain = join(b.root, 'plain');
  const inner = join(b.A, 'inner');
  for (const d of [plain, inner]) mkdirSync(join(d, 'lpk', 'bin'), { recursive: true });
  rmSync(join(b.B, 'lpk'), { recursive: true });
  for (const bad of [plain, inner, b.B]) {
    const { r, ran } = harness(stub(), b.compare().map((a) => (a === b.B ? bad : a)), b.env);
    assert.equal(r.status, 2);
    assert.ok(r.stderr.includes(bad));
    assert.equal(ran, false);
  }
}));

test('the graded hidden test is the one in --hidden', { skip }, () => bench((b) => {
  const { rows } = harness(stub(), ['--task', 'csv', '--arms', 'without', '--hidden', b.H, '--out', '@out'], b.env);
  assert.equal(rows[0].hiddenPass, 3);
  assert.equal(rows[0].hiddenFail, 0);
}));

test('a comparison without --hidden or --out-dir, or with them nested in each other or an arm, is refused before any run', { skip }, () => bench((b) => {
  mkdirSync(join(b.A, 'h', 'csv'), { recursive: true });
  writeFileSync(join(b.A, 'h', 'csv', 'hidden.test.mjs'), '');
  mkdirSync(join(b.root, 'empty'));
  const drop = (name) => (argv) => argv.filter((a, i) => a !== name && argv[i - 1] !== name);
  const set = (name, value) => (argv) => argv.map((a, i) => (argv[i - 1] === name ? value : a));
  const cases = [drop('--hidden'), drop('--out-dir'), set('--hidden', join(b.A, 'h')), set('--hidden', b.A), set('--out-dir', join(b.H, 'runs')), set('--hidden', join(b.root, 'empty')), set('--hidden', fileURLToPath(new URL('../evals-run', import.meta.url)))];
  for (const edit of cases) {
    const { r, ran } = harness(stub(), edit(b.compare()), b.env);
    assert.equal(r.status, 2, r.stderr);
    assert.doesNotMatch(r.stderr, /ENOENT|at file:/);
    assert.equal(ran, false);
  }
}));

test('--out-dir keeps the home and the clone named after the run, with its wall seconds; --tasks gives the fixture and the prompt', { skip }, () => bench((b) => {
  const T = join(b.root, 'tasks', 'csv');
  mkdirSync(T, { recursive: true });
  writeFileSync(join(T, 'prompt.txt'), 'the prompt from --tasks\n');
  writeFileSync(join(T, 'fixture.sh'), 'git init -q && touch from-tasks && git add -A && git -c user.name=t -c user.email=t@t commit -qm t\n');
  const { r, rows } = harness(stub(transcript, 'printf %s "$pr" > prompt.seen'), ['--task', 'csv', '--arms', 'without', '--tasks', join(b.root, 'tasks'), '--out-dir', b.D, '--out', '@out'], { ...b.env, EVALS_TEXT: '{}' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(rows[0].dir, join(b.D, 'csv-without-1'));
  assert.ok(existsSync(join(rows[0].dir, 'home', '.claude', 'projects', 'p', 's.jsonl')));
  const clone = join(rows[0].dir, readdirSync(rows[0].dir).find((d) => /^csv-without-1-[0-9a-f]+$/.test(d)));
  assert.ok(existsSync(join(clone, 'from-tasks')));
  assert.equal(readFileSync(join(clone, 'prompt.seen'), 'utf8'), 'the prompt from --tasks');
  assert.equal(typeof rows[0].seconds, 'number');
}));

test('a transcript naming the given hidden dir or a file only it holds voids the run; a sibling path or a task file does not', { skip }, () => bench((b) => {
  writeFileSync(join(b.H, 'csv', 'fixture.sh'), '');
  const cases = [[`read ${b.H}/csv`, true], ['cat hidden.test.mjs', true], [`cd "${b.H}" && cat */*`, true], [`ls ${b.H}`, true], [`ls ${b.H}-x/csv`, false], [`ls ${b.H}2`, false], ['cat fixture.sh', false]];
  for (const [text, voided, hidden = ['--hidden', b.H]] of [...cases, ['cat fixture.sh hidden.test.mjs', false, []]]) {
    const { rows } = harness(stub(transcript), ['--task', 'csv', '--arms', 'without', ...hidden, '--out', '@out'], { ...b.env, EVALS_TEXT: text });
    assert.equal(Boolean(rows[0].voided), voided, text);
    assert.equal(rows[0].hiddenPass === undefined, voided, text);
  }
  const nested = harness(stub(), ['--task', 'csv', '--arms', 'without', '--hidden', b.H, '--out-dir', join(b.H, 'runs'), '--out', '@out'], b.env);
  assert.equal(nested.r.status, 2);
  assert.equal(nested.ran, false);
}));

test('--max-turns reaches claude only when given, and --max-run-usd caps one run, and --run-timeout ends a run with an error row', { skip }, () => bench((b) => {
  harness(stub(), ['--task', 'csv', '--arms', 'without', '--max-turns', '7', '--out', '@out'], b.env);
  assert.deepEqual([JSON.parse(lines(b.log)[0]).turns, JSON.parse(lines(b.log)[0]).usd], ['7', '10.0000']);
  harness(stub(), ['--task', 'csv', '--arms', 'without', '--max-run-usd', '0.25', '--out', '@out'], b.env);
  assert.equal(JSON.parse(lines(b.log)[1]).usd, '0.2500');
  const t0 = Date.now();
  const { r, rows } = harness('sleep 30', ['--task', 'csv', '--arms', 'without', '--run-timeout', '1', '--out', '@out'], b.env);
  assert.equal(r.status, 2);
  assert.match(rows[0].error, /timeout/);
  assert.ok(Date.now() - t0 < 25000);
}));

test('pair order is drawn at random and recorded; a broken pair is never re-paired', { skip }, async () => {
  const { pairOrder } = await import('../evals-run/pair.mjs');
  const orders = new Set(Array.from({ length: 20 }, () => pairOrder().join()));
  assert.equal(orders.size, 2);
  await bench((b) => {
    const first = harness(stub(), b.compare('--max-cost-usd', '1'), { ...b.env, EVALS_COST: '1' });
    assert.equal(first.r.status, 2);
    assert.equal(first.rows.length, 1);
    const { r, rows } = harness(stub(), b.compare('--max-cost-usd', '1'), b.env);
    assert.equal(r.status, 0, r.stderr);
    const order = lines(b.log).slice(1).map((l) => (JSON.parse(l).plugin === join(b.A, 'lpk') ? 'baseline' : 'candidate'));
    assert.deepEqual(rows.map((row) => row.arm), order);
    assert.deepEqual(rows.map((row) => [row.pair, row.pos]), [[2, 0], [2, 1]]);
    assert.equal(first.rows[0].pair, 1);
    assert.equal(new Set([first.rows[0].dir, ...rows.map((row) => row.dir)]).size, 3);
  });
});

const hold = (b, host, args = [], env = {}) => new Promise((up) => {
  const c = spawn(process.execPath, ['-e', `require('net').createServer().listen(${b.port}, '${host}', () => console.log('up')).on('error', () => console.log('no'))`, '--', ...args], { detached: true, env: { ...process.env, ...env } });
  writeFileSync(join(b.pids, String(c.pid)), String(c.pid));
  c.stdout.once('data', (d) => { c.stdout.destroy(); c.unref(); up(String(d).startsWith('up') ? c : null); }).once('close', () => up(null));
});

for (const host of ['127.0.0.1', '::1']) test(`a listener on --busy-port at ${host} stops a comparison before its first run and leaves the other arms alone`, { skip }, (t) => bench(async (b) => {
  const holder = await hold(b, host);
  if (!holder) return assert.equal(host, '::1') ?? t.skip('the host has no IPv6');
  try {
    const stopped = harness(stub(), b.compare(), b.env);
    assert.equal(stopped.r.status, 2);
    assert.equal(stopped.ran, false);
    assert.ok(stopped.rows[0].error.includes(String(b.port)));
    const old = harness(stub(), ['--task', 'csv', '--arms', 'without', '--busy-port', String(b.port), '--out', '@out'], b.env);
    assert.equal(old.r.status, 0, old.r.stderr);
  } finally { holder.kill(); }
}));

test('a listener is the run\'s own by its --user-data-dir in either form, else its HOME; one that stays on the port after it is stopped voids the row', { skip }, () => bench(async (b) => {
  const { portAfterRun, portVoid } = await import('../evals-run/pair.mjs');
  const home = join(b.root, 'home');
  mkdirSync(home);
  const cases = [[[`--user-data-dir=${home}/chrome`]], [['--user-data-dir', `${home}/chrome`]], [[], { HOME: home }], [[], { HOME: b.root }, { voided: portVoid }]];
  for (const [args, env, want = { ownChrome: true, voided: portVoid }] of cases) {
    const holder = await hold(b, '127.0.0.1', args, env);
    assert.deepEqual(await portAfterRun(b.port, home, async () => true, 1), want, JSON.stringify([args, env]));
    holder.kill('SIGKILL');
    await new Promise((gone) => (holder.exitCode !== null || holder.signalCode ? gone() : holder.once('exit', gone)));
  }
}));

test('a listener this run started under its own HOME is stopped and the row stands; lpk reap runs on the clone', { skip }, () => bench((b) => {
  const { r, rows } = harness(stub(listen), b.compare(), b.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(rows.every((row) => row.ownChrome === true && !row.voided));
  assert.equal(listeners(b).length, 2);
  assert.ok(listeners(b).every((pid) => !alive(pid)));
  const reaped = lines(b.reap);
  assert.equal(reaped.length, 2);
  for (const row of rows) {
    const clone = join(row.dir, readdirSync(row.dir).find((d) => d !== 'home'));
    assert.ok(reaped.includes(`${join(row.arm === 'baseline' ? b.A : b.B, 'lpk', 'bin', 'lpk')} reap --repo ${clone}`));
  }
}));

test('a listener owned outside the run voids the row, stops the batch naming the port, and is not killed', { skip }, () => bench((b) => {
  const { r, rows } = harness(stub(listen), b.compare(), { ...b.env, EVALS_UDD: join(b.root, 'foreign') });
  assert.equal(r.status, 2);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].voided);
  assert.ok(r.stderr.includes(String(b.port)));
  assert.ok(listeners(b).every(alive));
}));

const call = (id) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Workflow', input: {} }] } });
const note = (id, status) => JSON.stringify({ type: 'user', message: { content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>` } });
const queued = (id, status) => JSON.stringify({ type: 'attachment', attachment: { type: 'queued_command', prompt: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>` } });
const reply = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } });
test('--smoke passes only on the Workflow call followed by its completed notification', { skip }, () => bench((b) => {
  const cases = [
    [[call('t1'), note('t1', 'completed'), reply], 'pass'],
    [[call('t1'), queued('t1', 'completed'), reply], 'pass'],
    [[call('t1'), queued('t2', 'completed'), reply], 'fail'],
    [[call('t1'), reply], 'fail'],
    [[call('t1'), note('t2', 'completed'), reply], 'fail'],
    [[call('t1'), note('t1', 'failed'), reply], 'fail'],
    [[call('t1'), note('t1', 'killed'), reply], 'fail'],
    [[note('t1', 'completed'), call('t1'), reply], 'fail'],
    [[call('t1'), reply, note('t1', 'completed')], 'fail'],
    [null, 'fail'],
  ];
  for (const [entries, smoke] of cases) {
    const { r, rows } = harness(stub(entries ? transcript : ''), ['--smoke', '--arms', 'without', '--out', '@out'], { ...b.env, EVALS_TEXT: (entries || []).join('\n') });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(rows[0].smoke, smoke, JSON.stringify(entries));
    assert.equal(rows[0].voided, undefined);
    assert.equal(typeof rows[0].seconds, 'number');
  }
}));
