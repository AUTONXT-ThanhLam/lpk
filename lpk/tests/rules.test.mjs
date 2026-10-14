// The facts behind the rule catalog: which rules a change loads, the literal candidates and
// unwired env names `lpk check` reports, the route census, and which changes no test depends on.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { broken, loadRules } from '../lib/rules.mjs';

const LPK = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lpk');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-rules-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', XDG_CACHE_HOME: join(tmp, 'cache'), XDG_DATA_HOME: join(tmp, 'data') };
// The fixture's own `node --test` must not report into this runner as a subtest.
delete ENV.NODE_TEST_CONTEXT;
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
const lpk = (cwd, args) => spawnSync('node', [LPK, ...args], { cwd, env: ENV, encoding: 'utf8' });

// A repo on `main` with the given files, switched to a branch `feat`.
function repoWith(name, files) {
  const repo = join(tmp, name);
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  for (const [p, t] of Object.entries(files)) write(repo, p, t);
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'switch', '-qc', 'feat');
  return repo;
}

test('every catalog rule has an id, a statement, a check and a trigger', () => {
  const rules = loadRules('');
  assert.ok(rules.length >= 20);
  for (const r of rules) {
    assert.match(r.id, /^[a-z-]+$/, r.id);
    assert.ok(r.rule && r.check && r.when.length, `${r.id} is incomplete`);
    assert.ok(['high', 'medium', 'low'].includes(r.blocks), `${r.id} blocks: ${r.blocks}`);
  }
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length, 'rule ids are unique');
  assert.deepEqual(broken.filter((b) => b.startsWith('catalog')), [], 'every plugin pattern compiles and sits in backticks');
});

test('lpk check reports swallowed errors, polling and env names no deploy file passes, before any commit', () => {
  const repo = repoWith('check', {
    'src/api.ts': 'export const ping = () => 1;\n',
    'docker-compose.yml': 'services:\n  api:\n    environment:\n      - PORT=3000\n',
  });
  write(repo, 'src/api.ts', 'export const ping = () => 1;\nexport const port = process.env.PORT;\nexport const key = process.env.LOCK_URL;\n++hits;\nload().catch(() => undefined);\nconst { STRIPE_KEY } = process.env;\n');
  write(repo, 'src/poll.ts', 'const t = setInterval(tick, 2000);\n');
  write(repo, 'app/load.py', 'def load():\n    try:\n        read()\n    except Exception:\n        pass\n');
  write(repo, 'cmd/pay/main.go', 'package main\n\nvar key = os.Getenv("PAY_KEY")\n\nfunc stop() {\n\t_ = conn.Close()\n}\n');
  write(repo, 'deploy/values.yaml', 'env:\n  - STRIPE_KEY\n');
  const out = lpk(repo, ['check', '--base', 'main']).stdout;
  assert.match(out, /no-silent-failure {2}src\/api\.ts:5 {2}load\(\)\.catch\(\(\) => undefined\);/);
  assert.match(out, /STRIPE_KEY {2}read at src\/api\.ts:6 {2}mentioned in deploy\/values\.yaml/);
  assert.match(out, /bounded-work {2}src\/poll\.ts:1 {2}const t = setInterval/);
  assert.match(out, /no-silent-failure {2}app\/load\.py:4 {2}except Exception:/);
  assert.match(out, /PORT {2}read at src\/api\.ts:2 {2}mentioned in docker-compose\.yml/);
  assert.match(out, /LOCK_URL {2}read at src\/api\.ts:3 {2}MENTIONED IN NO DEPLOY FILE/);
  assert.match(out, /PAY_KEY {2}read at cmd\/pay\/main\.go:3 {2}MENTIONED IN NO DEPLOY FILE/);
  assert.match(out, /no-silent-failure {2}cmd\/pay\/main\.go:6 {2}_ = conn\.Close\(\)/);
  const rules = lpk(repo, ['rules', '--base', 'main']).stdout;
  assert.match(rules, /### no-silent-failure: .*\nloaded by: always/);
  assert.match(rules, /### deploy-wiring: .*\nloaded by: src\/api\.ts:2 /);
  assert.match(rules, /not loaded \(no trigger in the diff\): .*ui-states/);
  write(join(tmp, 'data'), 'lpk/rules/all.md', '### learned-bad: a learned rule with a pattern JS cannot compile\n- when: added `(?i)bearer`\n- rule: r\n- check: c\n');
  const listed = lpk(repo, ['rules', '--list']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /patterns skipped because they do not compile or are not in backticks:\n.*all\.md learned-bad: `\(\?i\)bearer`/);
  // What /lpk:learn appends: a trigger for an existing rule, and a new rule whose regex lacks backticks.
  write(join(tmp, 'data'), 'lpk/rules/all.md', '### fail-closed\n- when: added `fooBarTrigger`\n\n### my-rule: calls are checked\n- when: added fooBarTrigger\n- rule: r\n- check: c\n');
  write(repo, 'src/lock.ts', 'fooBarTrigger();\n');
  const learned = lpk(repo, ['rules', '--base', 'main']).stdout;
  assert.match(learned, /### fail-closed: .*\nloaded by: .*\nrule: .*\ncheck: .*\nwhen: .*; added `fooBarTrigger`\n(find: .*\n)*extended by: .*all\.md/);
  assert.equal(lpk(repo, ['rules', '--list']).stdout.match(/^fail-closed /gm).length, 1);
  assert.match(learned, /all\.md my-rule: `when: added fooBarTrigger`/);
  // A repo's own word, banned in one directory only.
  write(join(tmp, 'data'), 'lpk/rules/check.md', '### neutral-engine: no product words\n- when: path `^src/engine/`\n- find: `\\bAtlas\\b` in path `^src/engine/`\n- rule: r\n- check: c\n');
  write(repo, 'src/engine/tools.ts', 'export const d = "Ask Atlas";\n');
  write(repo, 'src/ui.ts', 'export const title = "Atlas";\n');
  const scoped = lpk(repo, ['check', '--base', 'main']).stdout;
  assert.match(scoped, /neutral-engine {2}src\/engine\/tools\.ts:1/);
  assert.doesNotMatch(scoped, /neutral-engine {2}src\/ui\.ts/);
  assert.match(lpk(repo, ['rules', '--all']).stdout, /find: `\\bAtlas\\b` in path `\^src/);
  rmSync(join(tmp, 'data', 'lpk'), { recursive: true, force: true });
});

test('a submodule change, also in its frozen review tree, sees the team rule files and sibling submodules of its superproject', () => {
  const sup = repoWith('sup', {
    'CLAUDE.md': 'Read [the rules](docs/rules/), [the guide](docs/guide.md#urls), [site](https://x.dev) and [old](docs/gone.md).\n',
    'docs/rules/security.md': 'never log tokens\n',
    'docs/guide.md': 'svc reads runtime URL_* only\n',
    'docs/unlinked.md': 'not a rule\n',
  });
  const origin = repoWith('svc-origin', { 'AGENTS.md': 'errors go through fail()\n', 'pkg/CLAUDE.md': 'pkg rule\n', 'pkg/a.ts': 'export const a = 1;\n' });
  sh(origin, 'switch', '-q', 'main');
  sh(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', origin, 'services/svc');
  sh(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', origin, 'services/web');
  sh(sup, 'commit', '-qm', 'svc');
  const svc = join(sup, 'services', 'svc');
  write(svc, 'pkg/a.ts', 'export const a = 2;\n');
  const listed = (out) => out.slice(out.indexOf('Team rule files')).split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(' (')[0]).sort();
  const want = ['AGENTS.md', 'pkg/CLAUDE.md', join(sup, 'CLAUDE.md'), join(sup, 'docs/guide.md'), join(sup, 'docs/rules/security.md')].sort();
  const out = lpk(svc, ['rules', '--base', 'main']).stdout;
  assert.deepEqual(listed(out), want);
  assert.match(out, /docs\/guide\.md \(1 lines, linked from .*CLAUDE\.md\) {2}names: svc\n {6}Read \[the rules\]/);
  // The frozen review tree is a linked worktree of the submodule, where git names no superproject.
  const frozen = join(tmp, 'svc-review');
  sh(svc, 'worktree', 'add', '-q', '--detach', frozen);
  write(frozen, 'pkg/a.ts', 'export const a = 2;\n');
  assert.deepEqual(listed(lpk(frozen, ['rules', '--base', 'main']).stdout), want);
  assert.match(lpk(frozen, ['facts', '--base', 'main']).stdout, new RegExp(`siblings searched: ${join(sup, 'services', 'web')}\n`));
});

test('lpk check puts the language and CI traps on the line they are written, and only there', () => {
  const repo = repoWith('traps', { 'README.md': 'x\n' });
  write(repo, '.github/workflows/ci.yml', 'on: pull_request\njobs:\n  a:\n    steps:\n      - run: echo "${{ github.event.pull_request.title }}"\n');
  write(repo, 'app/conf.py', 'a = yaml.load(text)\nb = yaml.load(text, Loader=yaml.SafeLoader)\n');
  write(repo, 'src/copy.c', 'strcpy(dst, src);\n');
  write(repo, 'docs/c.md', 'never call strcpy(dst, src);\n');
  const out = lpk(repo, ['check', '--base', 'main']).stdout;
  assert.match(out, /ci-workflow-trust {2}\.github\/workflows\/ci\.yml:5 /);
  assert.match(out, /python-traps {2}app\/conf\.py:1 /);
  assert.doesNotMatch(out, /app\/conf\.py:2 /, 'a safe loader is not a candidate');
  assert.match(out, /c-unsafe-memory {2}src\/copy\.c:1 /);
  assert.doesNotMatch(out, /docs\/c\.md/);
});

test('lpk map lists every route with whether the guard appears in its handler, and who tests a file', () => {
  const repo = repoWith('map', {
    'src/routes.ts': [
      "router.post('/api/runs', (req, res) => { if (lockBlocks(req)) return res.status(423).end(); start(req); });",
      'router.post(',
      "  '/api/runs/:id/resume',",
      '  (req, res) => { if (lockBlocks(req)) return res.status(423).end(); resume(req); });',
      "router.post('/api/runs/:id/answer', (req, res) => { answer(req); });",
      '',
    ].join('\n'),
    'src/store.ts': 'export function setStatus(id, s) { db.status = s; }\n',
    'tests/store.test.ts': "import { setStatus } from '../src/store';\n",
    'pkg/store/store.go': 'package store\n\nfunc setStatus() {}\n',
    'pkg/store/flow_test.go': 'package store\n',
    'pkg/other/other_test.go': 'package other\n',
    'src/status.rs': 'pub fn setStatus() {}\n\n#[cfg(test)]\nmod tests {}\n',
    'src/Widget.vue': '<script>setStatus()</script>\n',
    'src/io.ts': 'setStatus();\n',
    'tests/socket.test.ts': "import io from 'socket.io-client';\n",
    'src/typed.ts': "fastify.get<{ Querystring: Q }>(\n  '/login', async (req) => login(req));\napp.get(`${base}/health`, (req, res) => ok(res));\n",
    'src/__tests__/ui.test.js': "import W from '../Widget.vue';\n",
    'src/tail.ts': "adminRouter.post('/admin/reset', (req, res) => reset());\nexport function lockBlocks(req) { return false; }\n",
    'app/views.py': "@bp.route('/admin/wipe', methods=['POST'])\ndef wipe():\n    return do_wipe()\n\ndef lockBlocks():\n    pass\n",
    'cmd/api/main.go': 'func routes(r *gin.Engine) {\n\tr.DELETE("/api/items/:id", func(c *gin.Context) {\n\t\tif lockBlocks(c) {\n\t\t\treturn\n\t\t}\n\t\tdrop(c)\n\t})\n\thttp.HandleFunc("/healthz", health)\n\tmux.HandleFunc("POST /api/pay", pay)\n}\n',
    'src/service.rs': 'fn app() -> Router {\n    Router::new()\n        .route("/frame", get(snap).post(inject))\n}\n',
    'src/main/java/app/ItemController.java': 'class ItemController {\n  @PreAuthorize("@guard.lockBlocks()")\n  @DeleteMapping("/items/{id}")\n  public void drop(@PathVariable String id) {\n    items.remove(id);\n  }\n\n  @GetMapping\n  public List<Item> list() { return items.all(); }\n}\n',
  });
  write(repo, 'src/new.ts', "fastify.route({\n  method: 'DELETE',\n  schema: { body: Body },\n  url: '/api/runs/:id',\n  handler: (req) => { if (lockBlocks(req)) throw locked; drop(req); },\n});\n");
  const out = lpk(repo, ['map', '--routes', '--guard', 'lockBlocks', 'setStatus']).stdout;
  assert.match(out, /src\/tail\.ts:1 {2}POST \/admin\/reset {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /app\/views\.py:1 {2}POST \/admin\/wipe {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /src\/new\.ts:1 {2}DELETE \/api\/runs\/:id {2}\[lockBlocks: in handler\]/);
  assert.match(out, /src\/routes\.ts:1 {2}POST \/api\/runs {2}\[lockBlocks: in handler\]/);
  assert.match(out, /src\/routes\.ts:2 {2}POST \/api\/runs\/:id\/resume {2}\[lockBlocks: in handler\]/);
  assert.match(out, /src\/routes\.ts:5 {2}POST \/api\/runs\/:id\/answer {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /src\/store\.ts {2}tests by package, name or import: tests\/store\.test\.ts/);
  assert.match(out, /pkg\/store\/store\.go {2}tests by package, name or import: pkg\/store\/flow_test\.go\n/);
  assert.match(out, /src\/typed\.ts:1 {2}GET \/login {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /src\/typed\.ts:3 {2}GET \$\{base\}\/health {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /src\/io\.ts {2}tests by package, name or import: none\n/);
  assert.match(out, /src\/Widget\.vue {2}tests by package, name or import: src\/__tests__\/ui\.test\.js\n/);
  assert.match(out, /src\/status\.rs {2}tests by package, name or import: src\/status\.rs \(its own test module\)\n/);
  assert.match(out, /cmd\/api\/main\.go:2 {2}DELETE \/api\/items\/:id {2}\[lockBlocks: in handler\]/);
  assert.match(out, /cmd\/api\/main\.go:8 {2}ANY \/healthz {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /cmd\/api\/main\.go:9 {2}POST \/api\/pay {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /src\/service\.rs:3 {2}GET,POST \/frame {2}\[lockBlocks: NOT SEEN\]/);
  assert.match(out, /ItemController\.java:3 {2}DELETE \/items\/\{id\} {2}\[lockBlocks: in handler\]/);
  assert.match(out, /ItemController\.java:8 {2}GET \(base path\) {2}\[lockBlocks: NOT SEEN\]/);
});

test('lpk mutate names the changed file no test depends on and leaves the checkout as it was', () => {
  const repo = repoWith('mutate', {
    'package.json': '{ "type": "module", "scripts": { "test": "node --test" } }\n',
    'src/clamp.mjs': 'export const clamp = (n) => n;\n',
    'src/label.mjs': "export const label = (n) => `n=${n}`;\n",
    'test/clamp.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { clamp } from '../src/clamp.mjs';\ntest('c', () => assert.ok(clamp(1) === 1));\n",
  });
  write(repo, 'src/clamp.mjs', 'export const clamp = (n) => Math.min(n, 100);\n');
  write(repo, 'src/label.mjs', "export const label = (n) => `#${n}`;\n");
  write(repo, 'test/clamp.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { clamp } from '../src/clamp.mjs';\ntest('c', () => assert.equal(clamp(500), 100));\n");
  const before = sh(repo, 'status', '--porcelain');
  const r = lpk(repo, ['mutate', '--base', 'main', '--test', 'npm test --silent', '--timeout', '120']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /baseline \(the change as it is\): exit 0/);
  assert.match(r.stdout, /src\/clamp\.mjs \(restored from base\): tests fail \(exit 1\)/);
  assert.match(r.stdout, /src\/label\.mjs \(restored from base\): TESTS STILL PASS/);
  assert.equal(sh(repo, 'status', '--porcelain'), before);
  assert.equal(sh(repo, 'stash', 'list'), '');
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
});

test('an interrupted lpk mutate stops its tests and removes its worktree', async () => {
  const repo = repoWith('interrupt', { 'src/a.mjs': 'export const a = 1;\n' });
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  const child = spawn('node', [LPK, 'mutate', '--base', 'main', '--test', 'sleep 30 && echo lpk-marker-sleep'], { cwd: repo, env: ENV });
  const childClosed = new Promise((r) => child.on('close', r));
  await new Promise((r) => setTimeout(r, 2000));
  child.kill('SIGTERM');
  await childClosed;
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
  let alive = true;
  for (let i = 0; i < 20 && alive; i++) { alive = spawnSync('pgrep', ['-f', '^bash -c sleep 30 && echo lpk-marker-sleep']).status === 0; if (alive) await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(alive, false, 'the test command still runs');
});

test('a run killed outright is cleaned up by the next lpk mutate', async () => {
  const repo = repoWith('orphan', { 'src/a.mjs': 'export const a = 1;\n' });
  write(repo, 'src/a.mjs', 'export const a = 2;\n');
  const child = spawn('node', [LPK, 'mutate', '--base', 'main', '--test', 'sleep 30 && echo lpk-marker-orphan'], { cwd: repo, env: ENV });
  const childClosed = new Promise((r) => child.on('close', r));
  await new Promise((r) => setTimeout(r, 2000));
  child.kill('SIGKILL');
  await childClosed;
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 2, 'SIGKILL leaves the worktree behind');
  const next = lpk(repo, ['mutate', '--base', 'main', '--test', 'true']);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
  assert.equal(spawnSync('pgrep', ['-f', '^bash -c sleep 30 && echo lpk-marker-orphan']).status, 1, 'the orphaned test command still runs');
  // lpk compare keeps two worktrees, main's and the change's: both are cleaned up the same way.
  write(tmp, 'orphan-in/a', '1\n');
  const cmp = spawn('node', [LPK, 'compare', '--base', 'main', '--run', 'sleep 3', '--inputs', join(tmp, 'orphan-in')], { cwd: repo, env: ENV });
  const cmpClosed = new Promise((r) => cmp.on('close', r));
  await new Promise((r) => setTimeout(r, 1500));
  cmp.kill('SIGKILL');
  await cmpClosed;
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 3, 'SIGKILL leaves both worktrees behind');
  assert.equal(lpk(repo, ['mutate', '--base', 'main', '--test', 'true']).status, 0);
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
});

test('lpk mutate --hunks names each hunk of a tested file that no test depends on, imports included', () => {
  const pad = Array.from({ length: 6 }, (_, i) => (i === 3 ? "import { f } from './slow.mjs';" : `// ${i}`)).join('\n');
  const repo = repoWith('hunks', {
    'package.json': '{ "type": "module", "scripts": { "test": "node --test" } }\n',
    'src/v.mjs': `export const name = (s) => s;\n${pad}\nexport const age = (n) => n;\n`,
    'src/slow.mjs': 'export const f = 1;\n',
    'src/fast.mjs': 'export const f = 2;\n',
    'test/v.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { name } from '../src/v.mjs';\ntest('n', () => assert.equal(name(' a '), ' a '));\n",
  });
  write(repo, 'src/v.mjs', `export const name = (s) => s.trim();\n${pad.replace('slow', 'fast')}\nexport const age = (n) => Math.max(n, 1);\n`);
  write(repo, 'test/v.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { name } from '../src/v.mjs';\ntest('n', () => assert.equal(name(' a '), 'a'));\n");
  const whole = lpk(repo, ['mutate', '--base', 'main', '--test', 'npm test --silent']).stdout;
  assert.match(whole, /src\/v\.mjs \(restored from base\): tests fail/);
  const r = lpk(repo, ['mutate', '--hunks', '--base', 'main', '--test', 'npm test --silent']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /src\/v\.mjs \(undid lines 1-1 \(hunk 1 of 3\)\): tests fail/);
  assert.match(r.stdout, /src\/v\.mjs \(undid lines 8-8 \(hunk 3 of 3\)\): TESTS STILL PASS/);
  assert.match(r.stdout, /src\/v\.mjs \(undid lines 5-5 \(hunk 2 of 3\)\): TESTS STILL PASS/, 'an import that moved is a change too');
});

test('lpk mutate --patch runs each mutant alone and names the ones the tests miss', () => {
  const repo = repoWith('mutants', {
    'package.json': '{ "type": "module", "scripts": { "test": "node --test" } }\n',
    'src/v.mjs': 'export const clamp = (n) => n;\n',
    'test/v.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { clamp } from '../src/v.mjs';\ntest('c', () => assert.equal(clamp(5), 5));\n",
  });
  write(repo, 'src/v.mjs', 'export const clamp = (n) => Math.min(Math.max(n, 0), 10);\n');
  write(repo, 'test/v.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { clamp } from '../src/v.mjs';\ntest('c', () => { assert.equal(clamp(-1), 0); assert.equal(clamp(5), 5); });\n");
  const dir = join(tmp, 'mutant-patches');
  mkdirSync(dir);
  const patch = (name, to) => {
    const body = `--- a/src/v.mjs\n+++ b/src/v.mjs\n@@ -1 +1 @@\n-export const clamp = (n) => Math.min(Math.max(n, 0), 10);\n+${to}\n`;
    writeFileSync(join(dir, name), body);
    return join(dir, name);
  };
  const lower = patch('lower-bound.diff', 'export const clamp = (n) => Math.min(n, 10);');
  const upper = patch('upper-bound.diff', 'export const clamp = (n) => Math.max(n, 0);');
  writeFileSync(join(dir, 'stale.diff'), '--- a/src/v.mjs\n+++ b/src/v.mjs\n@@ -1 +1 @@\n-export const nope = 1;\n+export const nope = 2;\n');
  const r = lpk(repo, ['mutate', '--base', 'main', '--test', 'npm test --silent', '--patch', lower, '--patch', upper, '--patch', join(dir, 'stale.diff')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /lower-bound\.diff \(mutant\): tests fail/);
  assert.match(r.stdout, /upper-bound\.diff \(mutant\): TESTS STILL PASS: no test catches this mutant/);
  assert.match(r.stdout, /stale\.diff \(mutant\): NOT APPLIED/);
  assert.equal(readFileSync(join(repo, 'src/v.mjs'), 'utf8'), 'export const clamp = (n) => Math.min(Math.max(n, 0), 10);\n', 'the checkout is untouched');
});
