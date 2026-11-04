import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ENV, ROOT, repoWith, startRun, tmp } from './hooks-env.mjs';

const SKIP = { skip: process.platform === 'win32' && 'the cc-switch launcher is bash only' };
const LAUNCHER_VARS = ['CC_SWAP_REQUEST', 'CC_SWAP_LAUNCHER', 'LPK_ACCOUNT'];
const RUNTIME = join(tmp, 'runtime');
const SAFE = Object.fromEntries(Object.entries({ ...ENV, XDG_RUNTIME_DIR: RUNTIME }).filter(([k]) => !LAUNCHER_VARS.includes(k)));
for (const k of ['XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) process.env[k] = SAFE[k];
const { drive } = await import('../lib/drive.mjs');
const { planFile } = await import('../lib/plan.mjs');

const BIN = join(ROOT, 'bin', 'lpk');
const HOOKS = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const planOf = (name) => JSON.parse(readFileSync(join(SAFE.XDG_DATA_HOME, 'lpk', 'plans', `${name}.json`), 'utf8'));
const cardDir = join(RUNTIME, 'lpk-drive');
const cards = () => (existsSync(cardDir) ? readdirSync(cardDir).sort() : []);
const readOr = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
const underTest = (request) => ({ CC_SWAP_REQUEST: request, CC_SWAP_LAUNCHER: String(process.pid) });

const lpk = (cwd, session, args, extra = {}) => spawnSync('node', [BIN, ...args], { cwd, env: { ...SAFE, CLAUDE_CODE_SESSION_ID: session, ...extra }, encoding: 'utf8', timeout: 60_000 });
const must = (p) => { assert.equal(p.status, 0, p.stderr + p.stdout); return p; };

function seeded(name, session, items) {
  const repo = repoWith(`repo-${name}`, { 'a.txt': 'a\n' });
  must(lpk(repo, session, ['plan', 'new', name]));
  for (const [title, proof, source] of items) must(lpk(repo, session, ['plan', 'add', title, '--proof', proof, '--source', source ?? 'the owner said so']));
  return repo;
}

function stop(repo, session, extra = {}) {
  const entry = HOOKS.Stop.find((h) => h.hooks[0].command.endsWith('/lib/cmd/hook.mjs" plan'));
  const input = JSON.stringify({ hook_event_name: 'Stop', cwd: repo, session_id: session, stop_hook_active: false, last_assistant_message: 'done', background_tasks: [], session_crons: [] });
  const p = spawnSync('bash', ['-c', entry.hooks[0].command], { cwd: repo, env: { ...SAFE, ...extra }, input, encoding: 'utf8', timeout: 60_000 });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.trim() ? JSON.parse(p.stdout) : null;
}

const LAUNCHER = `#!/bin/bash
dir=$1; shift
req=$dir/request
once=()
n=0
while :; do
  : > "$req"
  n=$((n + 1))
  echo "$$" > "$dir/launcher-pid"
  status=0
  CC_SWAP_REQUEST=$req CC_SWAP_LAUNCHER=$$ "$@" "\${once[@]}" || status=$?
  [[ -s $req ]] || exit "$status"
  cp "$req" "$dir/request-$n"
  id=$(sed -n 1p "$req")
  card=$(sed -n 2p "$req")
  once=()
  [[ $id == - ]] || once=(--resume "$id")
  once+=("The owner moved this session to another account and it restarted. Read the state card at $card first, then continue.")
  (( n < 3 )) || exit 9
done
`;

const STUB = `#!/bin/bash
dir=$FIX
n=$(( $(cat "$dir/n" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/n"
if (( n == 1 )); then
  echo "$$" > "$dir/first-pid"
  echo "$PPID" > "$dir/first-ppid"
  trap 'touch "$dir/termed"; exit 143' TERM
  CLAUDE_CODE_SESSION_ID=s-old node "$LPK_BIN" plan drive > "$dir/drive.out" 2> "$dir/drive.err"
  sleep 20 & wait $!
  exit 0
fi
printf '%s\\n' "$@" > "$dir/argv"
cd "$REPO"
CLAUDE_CODE_SESSION_ID=s-new node "$LPK_BIN" plan take "$PLAN" > "$dir/take.out" 2>&1
CLAUDE_CODE_SESSION_ID=s-new node "$LPK_BIN" plan prove P2 > "$dir/prove.out" 2>&1
`;

test('R1 R2 R5: plan drive under the launcher ends the session and a fresh claude starts on the next item with its card, and proves it', SKIP, () => {
  const fix = join(tmp, 'fixture-s1');
  mkdirSync(fix, { recursive: true });
  writeFileSync(join(fix, 'launcher'), LAUNCHER);
  writeFileSync(join(fix, 'claude'), STUB);
  chmodSync(join(fix, 'launcher'), 0o755);
  chmodSync(join(fix, 'claude'), 0o755);
  const proof = `test "a b" = 'a b' && echo "$HOME" > /dev/null`;
  const source = 'the owner wrote: "drive it"\nand then `go on`; $(not run)';
  const repo = seeded('s1', 's-old', [['first one', 'true'], ['second "quoted" item', proof, source]]);
  must(lpk(repo, 's-old', ['plan', 'prove', 'P1']));

  const p = spawnSync('bash', [join(fix, 'launcher'), fix, join(fix, 'claude')], { cwd: repo, env: { ...SAFE, FIX: fix, LPK_BIN: BIN, REPO: repo, PLAN: 's1' }, encoding: 'utf8', timeout: 90_000 });
  assert.equal(p.status, 0, `${p.stdout}${p.stderr}${readOr(join(fix, 'drive.err'))}`);

  const card = join(cardDir, 'card-s1-P2.md');
  assert.equal(readFileSync(join(fix, 'request-1'), 'utf8'), `-\n${card}\n`);
  assert.ok(existsSync(join(fix, 'termed')), 'the first claude ended on SIGTERM, not on its own');
  assert.equal(readFileSync(join(fix, 'first-ppid'), 'utf8').trim(), readFileSync(join(fix, 'launcher-pid'), 'utf8').trim(), 'the signalled claude is the launcher\'s direct child');

  const text = readFileSync(card, 'utf8');
  for (const fact of ['P2', 'second "quoted" item', proof, source, 's-old', 'claude --resume s-old', 'lpk plan take s1', 'lpk plan prove P2', 'lpk:lpk']) assert.ok(text.includes(fact), `the card holds ${fact}`);
  const said = readFileSync(join(fix, 'drive.out'), 'utf8');
  assert.ok(said.includes('s-old') && said.includes('claude --resume s-old'), said);

  const argv = readFileSync(join(fix, 'argv'), 'utf8').split('\n');
  assert.ok(argv.some((a) => a.includes(card)), 'the second claude is told to read the card');
  assert.ok(!argv.includes('-p') && !argv.includes('--print'));

  const done = JSON.parse(readFileSync(join(SAFE.XDG_DATA_HOME, 'lpk', 'plans', 'done', 's1.json'), 'utf8'));
  assert.equal(done.session, 's-new');
  assert.deepEqual(done.items.map((i) => [i.id, i.status, i.proved.exit]), [['P1', 'done', 0], ['P2', 'done', 0]]);
});

test('R4 R6: plan drive refuses with exit 2 and writes nothing when it cannot hand over', SKIP, async (t) => {
  const real = process.env.CC_SWAP_REQUEST;
  const realBefore = real ? readOr(real) : null;
  const request = join(tmp, 's2-request');
  const pending = join(tmp, 's2-pending');
  writeFileSync(pending, 's-other\n/some/card.md\n');
  const repo = seeded('s2', 's-two', [['first one', 'true'], ['second', 'true']]);
  must(lpk(repo, 's-two', ['plan', 'prove', 'P1']));
  const empty = seeded('s2-none', 's-none', [['only', 'true'], ['later', 'true']]);
  must(lpk(empty, 's-none', ['plan', 'hold', 'P1', '--why', 'which colour']));
  must(lpk(empty, 's-none', ['plan', 'hold', 'P2', '--why', 'which size']));
  const ran = seeded('s2-run', 's-run', [['only', 'true']]);
  const marker = startRun(ran, 's-run');
  const runId = JSON.parse(readFileSync(join(marker, 'run.json'), 'utf8')).id;
  const nobody = seeded('s2-nobody', 's-nobody', [['only', 'true']]);
  writeFileSync(planFile('s2-nobody'), JSON.stringify({ ...planOf('s2-nobody'), session: '' }));
  const gone = String(spawnSync('true').pid);

  const rows = [
    ['outside a launcher', repo, 's-two', ['plan', 'drive'], {}, request, /CC_SWAP_REQUEST/],
    ['no claude under the launcher', repo, 's-two', ['plan', 'drive'], { CC_SWAP_REQUEST: request, CC_SWAP_LAUNCHER: gone }, request, new RegExp(`\\b${gone}\\b`)],
    ['a plan held by no session, from no session', nobody, '', ['plan', 'drive', '--plan', 's2-nobody'], underTest(request), request, /lpk plan take s2-nobody/],
    ['no open item', empty, 's-none', ['plan', 'drive'], underTest(request), request, /P1|P2/],
    ['a plan another session holds', repo, 's-intruder', ['plan', 'drive', '--plan', 's2'], underTest(request), request, /s-two/],
    ['a request pending', repo, 's-two', ['plan', 'drive'], underTest(pending), pending, new RegExp(pending)],
    ['a run of this session open', ran, 's-run', ['plan', 'drive'], underTest(request), request, null],
  ];
  writeFileSync(request, '');
  for (const [name, cwd, session, args, env, req, names] of rows) {
    await t.test(name, () => {
      const before = readFileSync(req, 'utf8');
      const cardsBefore = cards();
      const p = lpk(cwd, session, args, env);
      assert.equal(p.status, 2, p.stdout + p.stderr);
      assert.ok(p.stderr.trim(), 'it says why');
      if (names) assert.match(p.stderr, names);
      assert.equal(readFileSync(req, 'utf8'), before);
      assert.deepEqual(cards(), cardsBefore, 'no card is written');
    });
  }
  const runRow = lpk(ran, 's-run', ['plan', 'drive'], underTest(request));
  assert.ok(runRow.stderr.includes(runId) && runRow.stderr.includes(`lpk run end --repo ${ran}`), runRow.stderr);
  if (real) assert.equal(readOr(real), realBefore, 'the real launcher request of the session running the suite is untouched');
});

test('R3: under the launcher the Stop hook asks a session that finished an item to report and drive, naming no next item', SKIP, () => {
  const repo = seeded('s3', 's-three', [['first one', 'true'], ['second secret title', 'true']]);
  must(lpk(repo, 's-three', ['plan', 'prove', 'P1']));
  const marker = startRun(repo, 's-three');
  const runId = JSON.parse(readFileSync(join(marker, 'run.json'), 'utf8')).id;
  const request = join(tmp, 's3-request');
  writeFileSync(request, '');

  const driven = stop(repo, 's-three', underTest(request));
  assert.equal(driven.decision, 'block');
  assert.ok(driven.reason.includes('lpk plan drive'), driven.reason);
  assert.ok(driven.reason.includes(runId) && driven.reason.includes(`lpk run end --repo ${repo}`), driven.reason);
  assert.ok(!/P2|second secret title/.test(driven.reason), driven.reason);

  const today = stop(repo, 's-three');
  assert.ok(today.reason.includes('P2') && !today.reason.includes('lpk plan drive'), today.reason);

  const plan = planOf('s3');
  delete plan.since;
  writeFileSync(planFile('s3'), JSON.stringify(plan));
  const legacy = stop(repo, 's-three', underTest(request));
  assert.ok(legacy.reason.includes('P2') && !legacy.reason.includes('lpk plan drive'), legacy.reason);
  assert.equal(readFileSync(request, 'utf8'), '');
});

test('a session that takes a plan is asked to drive naming only the items it finished after the take', SKIP, () => {
  const repo = seeded('s5', 's-five-old', [['first one', 'true'], ['second one', 'true'], ['third one', 'true']]);
  must(lpk(repo, 's-five-old', ['plan', 'prove', 'P1']));
  must(lpk(repo, 's-five', ['plan', 'take', 's5']));
  must(lpk(repo, 's-five', ['plan', 'prove', 'P2']));
  const request = join(tmp, 's5-request');
  writeFileSync(request, '');
  const driven = stop(repo, 's-five', underTest(request));
  assert.ok(driven.reason.includes('lpk plan drive') && /\bP2\b/.test(driven.reason), driven.reason);
  assert.ok(!/\bP1\b/.test(driven.reason), driven.reason);
});

test('R1 R6 signal: when the signal throws, the request is emptied and drive refuses', SKIP, () => {
  const request = join(tmp, 's4-request');
  writeFileSync(request, '');
  const plan = { name: 's4', repo: tmp, session: 's-four', items: [{ id: 'P1', title: 'one', proof: 'true', source: 'x', status: 'todo' }] };
  const killed = [];
  const said = [];
  const r = drive({
    plan,
    session: 's-four',
    env: { CC_SWAP_REQUEST: request, CC_SWAP_LAUNCHER: '100', XDG_RUNTIME_DIR: RUNTIME },
    deps: { start: 7, parent: (pid) => ({ 7: '100' })[pid], say: (m) => said.push(m), kill: (pid, sig) => { killed.push([pid, sig]); throw new Error('kill ESRCH'); } },
  });
  assert.ok(r.error, 'drive refuses');
  assert.deepEqual(killed, [[7, 'SIGTERM']]);
  assert.ok(!readOr(request), 'no restart request is left for the launcher');
  assert.deepEqual(said, [], 'no hand-over is announced');
  assert.ok(!existsSync(join(cardDir, 'card-s4-P1.md')), 'no card is left behind');
});

test('without XDG_RUNTIME_DIR the plan-drive card lives in a directory only its user can open', SKIP, () => {
  const home = join(tmp, 'home-s6');
  const request = join(tmp, 's6-request');
  writeFileSync(request, '');
  const plan = { name: 's6', repo: tmp, session: 's-six', items: [{ id: 'P1', title: 'one', proof: 'true', source: 'x', status: 'todo' }] };
  const was = process.env.HOME;
  process.env.HOME = home;
  try {
    const r = drive({ plan, session: 's-six', env: { CC_SWAP_REQUEST: request, CC_SWAP_LAUNCHER: '100' }, deps: { start: 7, parent: (pid) => ({ 7: '100' })[pid], say: () => {}, kill: () => {} } });
    assert.ok(!r.error, r.error);
    const dir = join(home, '.cache', 'lpk', 'drive');
    assert.equal(dirname(r.card), dir);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(r.card).mode & 0o777, 0o600);
  } finally {
    process.env.HOME = was;
  }
});

test('under the launcher run end names the hand-over, not the next item; elsewhere it names the next item', SKIP, () => {
  const repo = seeded('s7', 's-seven', [['first one', 'true'], ['second secret title', 'true']]);
  const request = join(tmp, 's7-request');
  writeFileSync(request, '');
  startRun(repo, 's-seven');
  const driven = must(lpk(repo, 's-seven', ['run', 'end'], underTest(request))).stdout;
  assert.ok(driven.includes('lpk plan prove P1') && driven.includes('lpk plan drive'), driven);
  assert.ok(!/P2|second secret title/.test(driven), driven);
  startRun(repo, 's-seven');
  const today = must(lpk(repo, 's-seven', ['run', 'end'])).stdout;
  assert.ok(today.includes('P2') && !today.includes('lpk plan drive'), today);
});
