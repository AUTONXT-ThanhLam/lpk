// What the owner's agent relies on: the facts bundle, the push guard, and that the skill only names
// commands, agents and workflows the plugin really ships.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { touched } from '../lib/facts.mjs';
import { gitPath } from '../lib/git.mjs';
import { stubBin } from './stub.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LPK = join(ROOT, 'bin', 'lpk');
const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'lpk-test-')));
after(() => rmSync(tmp, { recursive: true, force: true }));

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
const lpk = (cwd, args, input) => execFileSync('node', [LPK, ...args], { cwd, env: ENV, encoding: 'utf8', input });

// A repo on `main` with a remote, and a feature branch that removes a function another file calls.
function fixture(name) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  sh(dir, 'init', '-q', '--bare', 'remote.git');
  const repo = join(dir, 'work');
  sh(dir, 'clone', '-q', 'remote.git', 'work');
  write(repo, 'src/limits.ts', 'export function clampLimit(n: number) {\n  return Math.min(n, 100);\n}\n');
  write(repo, 'src/routes.ts', "import { clampLimit } from './limits';\nexport const page = (n: number) => clampLimit(n);\n");
  write(repo, 'pkg/auth.go', 'package pkg\n\nfunc CheckToken(t string) bool { return t != "" }\n');
  write(repo, 'pkg/api.go', 'package pkg\n\nfunc h(t string) bool { return CheckToken(t) }\n');
  write(repo, '.github/workflows/ci.yml', 'name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: |\n          npm run lint\n          npm test\n');
  write(repo, '.gitlab-ci.yml', 'stages: [test]\n.base: &base\n  script:\n    - echo hidden\nunit:test: &unit\n  script:\n    - |\n      make deps\n      make test\n    - make lint\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init');
  sh(repo, 'push', '-q', 'origin', 'HEAD:main'); sh(repo, 'remote', 'set-head', 'origin', 'main');
  sh(repo, 'switch', '-qc', 'feat');
  write(repo, 'src/limits.ts', 'export const MAX_LIMIT = 100;\n');
  write(repo, 'pkg/auth.go', 'package pkg\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'refactor: replace clampLimit with MAX_LIMIT');
  return repo;
}

// The facts fixture also renames a file and touches one with a Vietnamese name.
function factsFixture(name) {
  const repo = fixture(name);
  sh(repo, 'switch', '-q', 'main');
  write(repo, 'src/guard.ts', 'export const guard = (u: string) => u.length > 0;\n'.repeat(3));
  write(repo, 'docs/tài liệu.md', 'a\n');
  write(repo, 'pkg/token.go', 'package pkg\n\nfunc parseToken(t string) string {\n\tif t == "" {\n\t\treturn ""\n\t}\n\treturn t\n}\n');
  write(repo, 'pkg/use.go', 'package pkg\n\nvar first = parseToken("a")\n');
  write(repo, 'app/cart.py', 'class Cart:\n    def checkout_all(self):\n        return 1\n'); write(repo, 'app/use.py', 'Cart().checkout_all()\n');
  write(repo, 'src/settings.ts', 'export const runtime = {\n  dod_pass_ratio: 0.6,\n  timeout_ms: 5,\n};\n'); write(repo, 'web/admin.ts', 'const pct = runtime.dod_pass_ratio * 100;\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'more'); sh(repo, 'push', '-q', 'origin', 'HEAD:main');
  sh(repo, 'switch', '-q', 'feat'); sh(repo, 'rebase', '-q', 'main');
  sh(repo, 'mv', 'src/guard.ts', 'src/guards.ts');
  write(repo, 'docs/tài liệu.md', 'a\nb\n');
  write(repo, 'pkg/token.go', 'package pkg\n\nfunc parseToken(t string) string {\n\tif t == "" {\n\t\treturn ""\n\t}\n\treturn strings.TrimSpace(t)\n}\n');
  write(repo, 'app/cart.py', 'class Cart:\n    def checkout_all(self):\n        return 2\n');
  write(repo, 'src/settings.ts', 'export const runtime = {\n  timeout_ms: 5,\n};\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'move guard');
  return repo;
}

test('lpk facts writes a bundle that shows the change, its base, its outside callers and CI', () => {
  const repo = factsFixture('facts');
  const out = join(tmp, 'facts-out');
  const text = lpk(repo, ['facts', '--out', out]);
  assert.match(text, /groups: 2/);
  assert.match(text, /ci\.yml test: npm ci ; \[npm run lint ; npm test\]/);
  assert.match(text, /\.gitlab-ci\.yml unit:test: \[make deps ; make test\] ; make lint\n/);
  const bundle = JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8'));
  assert.deepEqual(bundle.files.map((f) => f.path).sort(), ['app/cart.py', 'docs/tài liệu.md', 'pkg/auth.go', 'pkg/token.go', 'src/guards.ts', 'src/limits.ts', 'src/settings.ts']);
  assert.equal(bundle.commits.length, 2);
  assert.match(readFileSync(join(out, 'base', 'src/guards.ts'), 'utf8'), /export const guard/);
  assert.match(readFileSync(join(out, 'base', 'src/limits.ts'), 'utf8'), /function clampLimit/);
  const impact = readFileSync(join(out, 'impact.md'), 'utf8');
  assert.match(impact, /## clampLimit \(symbol, removed in src\/limits\.ts\)/);
  assert.match(impact, /## dod_pass_ratio \(field, removed in src\/settings\.ts\)\n.*\n {2}- web\/admin\.ts:1:/);
  assert.match(impact, /## checkout_all \(symbol, body changed in app\/cart\.py\)\n.*\n {2}- app\/use\.py:1:/);
  assert.match(impact, /## parseToken \(symbol, body changed in pkg\/token\.go\)\n.*\n {2}- pkg\/use\.go:3:/);
  assert.match(impact, /src\/routes\.ts:2:export const page = \(n: number\) => clampLimit\(n\);/);
  assert.match(impact, /## CheckToken \(symbol, removed in pkg\/auth\.go\)\n- this repo: 0 hits in changed files, 1 elsewhere\n {2}- pkg\/api\.go:3:/);
});

test('on a large change every removed field keeps its place in impact.md beside the other names', () => {
  const lines = [...Array.from({ length: 30 }, (_, i) => `-  removed_field_${i}: 1,`), ...Array.from({ length: 30 }, (_, i) => `+export const addedSymbol${i} = 1;`)];
  const names = touched([{ path: 'src/a.ts', skipped: false, text: lines.join('\n') }]);
  assert.equal(names.length, 50);
  assert.equal(names.filter((e) => e.kind === 'field').length, 30);
});

test('lpk facts searches the sibling submodules of a superproject', () => {
  const sup = join(tmp, 'super');
  mkdirSync(sup);
  for (const name of ['api', 'web']) {
    const r = join(tmp, `${name}-src`);
    mkdirSync(r); sh(r, 'init', '-q');
    write(r, 'x.ts', name === 'web' ? "fetch('/api/v1/widgets')\n" : "app.get('/api/v1/widgets', h)\n");
    if (name === 'web') { write(r, 'x.test.ts', "import './x';\n"); write(r, 'r.ts', "app.get('/api/v1/web', h)\n"); }
    sh(r, 'add', '.'); sh(r, 'commit', '-qm', 'init');
  }
  sh(sup, 'init', '-q');
  for (const name of ['api', 'web']) sh(sup, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', join(tmp, `${name}-src`), name);
  sh(sup, 'commit', '-qm', 'subs');
  const api = join(sup, 'api');
  const base = sh(api, 'rev-parse', 'HEAD').trim();
  write(api, 'x.ts', "app.get('/api/v2/widgets', h)\n");
  sh(api, 'commit', '-qam', 'move route');
  // The web checkout sits on a branch without the caller; the default branch still has it.
  sh(join(sup, 'web'), 'switch', '-qc', 'wip');
  write(join(sup, 'web'), 'x.ts', '\n');
  sh(join(sup, 'web'), 'rm', '-q', 'x.test.ts', 'r.ts');
  const out = join(tmp, 'sib-out');
  lpk(api, ['facts', '--base', base, '--out', out]);
  const impact = readFileSync(join(out, 'impact.md'), 'utf8');
  assert.match(impact, /## \/api\/v1\/widgets \(route, removed/);
  assert.match(impact, new RegExp(`${join(sup, 'web').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} at origin/\\w+: 1 hits\n {2}- x\\.ts:1:fetch`));
  assert.match(lpk(api, ['map', '/api/v1/widgets']), /# \/api\/v1\/widgets in .*web at origin\/\w+: 1 lines in 1 files\nx\.ts {2}tests by package, name or import: x\.test\.ts/);
  assert.match(lpk(api, ['map', '--routes']), /# Routes and tools in .*web at origin\/\w+: 1\nr\.ts:1 {2}GET \/api\/v1\/web/);
  // Named by hand, a sibling is searched as its folder stands: here, without the caller.
  lpk(api, ['facts', '--base', base, '--out', out, '--sibling', join(sup, 'web')]);
  assert.doesNotMatch(readFileSync(join(out, 'impact.md'), 'utf8'), /x\.ts:1:fetch/);
});

test('the push guard refuses long subjects and merge commits, and lets a clean push through', () => {
  const repo = fixture('push');
  const hook = (command) => lpk(repo, ['push-check'], JSON.stringify({ tool_input: { command }, cwd: repo }));
  assert.equal(hook('git push -u origin feat'), '');
  assert.equal(hook('git status'), '');
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'fix: a subject that keeps going well past the seventy-two characters a reviewer allows');
  const deny = JSON.parse(hook(`git -C "${repo}" push`));
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /subject is 8\d characters \(max 72\)/);
  assert.match(JSON.parse(hook(`cd ${repo} && git push`)).hookSpecificOutput.permissionDecisionReason, /a command of its own/);
  assert.equal(hook('git commit -m "docs: explain git push"'), '');
  const long = 'lpk: a pull request title that keeps going well past what a reviewer allows';
  assert.match(JSON.parse(hook(`gh pr create --base main --title "${long}" --body x`)).hookSpecificOutput.permissionDecisionReason, /PR title is 7\d characters/);
  assert.match(JSON.parse(hook(`gh pr edit 3 -t '${long}'`)).hookSpecificOutput.permissionDecisionReason, /PR title/);
  assert.equal(hook('gh pr create --title "lpk: short" --body x'), '');
  assert.equal(hook(`gh pr create --fill --body 'see --title "${long}"'`), '');
  sh(repo, 'reset', '-q', '--soft', 'HEAD~1');
  sh(repo, 'switch', '-qc', 'side', 'origin/main'); sh(repo, 'commit', '-q', '--allow-empty', '-m', 'side');
  sh(repo, 'switch', '-q', 'feat'); sh(repo, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side');
  assert.match(JSON.parse(hook('git push')).hookSpecificOutput.permissionDecisionReason, /is a merge commit/);
});

test('after a rebase onto main the push guard checks only the commits the branch adds, not main\'s own', () => {
  const repo = fixture('rebased');
  const hook = (command) => lpk(repo, ['push-check'], JSON.stringify({ tool_input: { command }, cwd: repo }));
  sh(repo, 'push', '-q', '-u', 'origin', 'feat');
  sh(repo, 'switch', '-q', 'main');
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'chore: a subject merged on main that keeps going well past the seventy-two characters');
  sh(repo, 'push', '-q', 'origin', 'HEAD:main');
  sh(repo, 'switch', '-q', 'feat'); sh(repo, 'rebase', '-q', 'origin/main');
  assert.equal(hook('git push --force-with-lease'), '');
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'fix: a subject on the branch that keeps going well past the seventy-two characters');
  const reason = JSON.parse(hook('git push --force-with-lease')).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /"fix: a subject on the branch/);
  assert.doesNotMatch(reason, /chore: a subject merged on main/);
});

test('the push guard runs the gitleaks lpk setup fetched when none is on PATH', () => {
  const repo = fixture('own-gitleaks');
  const data = join(tmp, 'own-gitleaks-data');
  // A stand-in for the fetched binary that reports one secret, as `gitleaks git --exit-code 3` does.
  mkdirSync(join(data, 'lpk', 'bin'), { recursive: true });
  stubBin(join(data, 'lpk', 'bin'), 'gitleaks', `process.stdout.write(${JSON.stringify('[{"Commit":"abc","File":"a.env","StartLine":1,"RuleID":"generic-api-key"}]')});\nprocess.exitCode = 3;\n`);
  const PATH = process.env.PATH.split(delimiter).filter((d) => !['gitleaks', 'gitleaks.exe'].some((n) => existsSync(join(d, n)))).join(delimiter);
  const out = execFileSync('node', [LPK, 'push-check'], { cwd: repo, env: { ...ENV, PATH, XDG_DATA_HOME: data }, encoding: 'utf8', input: JSON.stringify({ tool_input: { command: 'git push' }, cwd: repo }) });
  assert.match(JSON.parse(out).hookSpecificOutput.permissionDecisionReason, /gitleaks found 1 secret.*\n.*a\.env:1 generic-api-key/);
});

test('the prompts name only commands, agents, workflows, skills and files the plugin ships', () => {
  const skill = ['lpk', 'learn'].map((n) => readFileSync(join(ROOT, 'skills', n, 'SKILL.md'), 'utf8')).join('\n');
  const agents = readdirSync(join(ROOT, 'agents')).map((f) => readFileSync(join(ROOT, 'agents', f), 'utf8')).join('\n');
  const usage = spawnSync('node', [LPK], { encoding: 'utf8' }).stderr;
  for (const sub of new Set([...(skill + agents).matchAll(/`lpk ([a-z-]+)/g)].map((m) => m[1]))) assert.match(usage, new RegExp(`lpk ${sub}(?![\\w-])`), `a prompt names lpk ${sub}`);
  for (const [, f] of skill.matchAll(/`([a-z-]+\.md)` in this skill's directory/g)) assert.ok(existsSync(join(ROOT, 'skills', 'lpk', f)), `the skill points at ${f}`);
  for (const [, f] of skill.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) assert.ok(existsSync(join(ROOT, f)), `the skill points at ${f}`);
  for (const name of [...skill.matchAll(/`lpk:([a-z-]+)`/g)].map((m) => m[1])) {
    const asAgent = existsSync(join(ROOT, 'agents', `${name}.md`));
    const asWorkflow = existsSync(join(ROOT, 'workflows', `${name}.js`)) && readFileSync(join(ROOT, 'workflows', `${name}.js`), 'utf8').includes(`name: '${name}'`);
    const asSkill = existsSync(join(ROOT, 'skills', name, 'SKILL.md'));
    assert.ok(asAgent || asWorkflow || asSkill, `skill names lpk:${name}, which the plugin does not ship`);
  }
  const mcp = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers['chrome-devtools'], 'mcp__plugin_lpk_chrome-devtools__* needs the server named chrome-devtools');
  assert.match(readdirSync(join(ROOT, 'skills', 'lpk')).map((f) => readFileSync(join(ROOT, 'skills', 'lpk', f), 'utf8')).join('\n'), /mcp__plugin_lpk_chrome-devtools__/);
  const review = readFileSync(join(ROOT, 'workflows', 'review.js'), 'utf8');
  for (const [, name] of review.matchAll(/'lpk:([a-z-]+)'/g)) assert.ok(existsSync(join(ROOT, 'agents', `${name}.md`)), `the review workflow starts lpk:${name}, which the plugin does not ship`);
});

test('lpk compare tables the inputs on which main and the uncommitted change disagree', () => {
  const repo = join(tmp, 'compare');
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  write(repo, 'src/size.mjs', 'export const cap = (n) => Math.min(n, 100);\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init'); sh(repo, 'switch', '-qc', 'feat');
  write(repo, 'src/size.mjs', 'export const cap = (n) => { if (n < 0) throw new Error("negative"); return Math.min(n, 50); };\n');
  const inputs = join(tmp, 'compare-in');
  for (const [name, n] of [['a', '7'], ['b', '80'], ['c', '-1']]) write(inputs, name, n);
  const harness = join(tmp, 'cap.mjs');
  writeFileSync(harness, "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { pathToFileURL } from 'node:url';\nconst { cap } = await import(pathToFileURL(join(process.cwd(), 'src', 'size.mjs')).href);\nconsole.log(cap(Number(readFileSync(0, 'utf8'))));\n");
  const out = lpk(repo, ['compare', '--run', `node ${gitPath(harness)}`, '--inputs', inputs, '--base', 'main']);
  assert.match(out, /3 inputs: 1 same, 2 differ/);
  assert.match(out, /\| b `80` \| exit 0: 80 \| exit 0: 50 \|/);
  assert.match(out, /\| c `-1` \| exit 0: -1 \| exit 1: \(stderr below\) \|/);
  assert.match(out, /c on this change, last lines of stderr:\n```\n[^`]*Error: negative/);
  assert.equal(sh(repo, 'status', '--short'), ' M src/size.mjs\n');
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
  // From a directory the change adds, main has no such directory: a fact, not a crash.
  write(repo, 'tools/run.sh', 'cat\n');
  const fresh = execFileSync('node', [LPK, 'compare', '--run', 'sh run.sh', '--inputs', inputs, '--base', 'main'], { cwd: join(repo, 'tools'), env: ENV, encoding: 'utf8' });
  assert.match(fresh, /3 inputs: 0 same, 3 differ/);
  assert.match(fresh, /\| a `7` \| exit ENOENT: .* \| exit 0: 7 \|/);
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
});

test('lpk facts prints the branch and its commit subjects, so a second ticket is seen before review', () => {
  const repo = join(tmp, 'tickets');
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  write(repo, 'a.ts', 'export const a = 1;\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'init'); sh(repo, 'switch', '-qc', 'kd-737-yaml-as-text');
  write(repo, 'a.ts', 'export const a = 2;\n');
  sh(repo, 'commit', '-qam', 'KD-738: batch embeddings, UTF-8 names');
  sh(repo, 'commit', '-q', '--allow-empty', '-m', 'ABC-9 take the other fix along');
  assert.match(lpk(repo, ['facts', '--base', 'main', '--out', join(tmp, 'tickets-out')]), /branch: kd-737-yaml-as-text; commit subjects: ABC-9 take the other fix along \| KD-738: batch embeddings, UTF-8 names\n/);
});
