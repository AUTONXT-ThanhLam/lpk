// A verifier's reproduction runs in the run's shared worktree of the reviewed commit or of its base,
// installed from that commit's own lockfile, and what it did is recorded for the gates.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { addFinding } from '../lib/findings.mjs';
import { commit, ENV, lpk, repoWith, ROOT, sh, write } from './verbs-env.mjs';

const records = (repo) => readFileSync(join(repo, '.git', 'lpk', 'records.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.kind === 'repro');

test('lpk repro runs a command at the reviewed commit and at its base, each in its own installed worktree, never the checkout\'s', () => {
  // A workspace-style dependency: `dep` resolves to the tree's own copy only when the tree is installed.
  const repo = repoWith('repro', {
    'dep/package.json': '{ "name": "dep", "version": "1.0.0", "main": "index.js" }\n',
    'dep/index.js': 'module.exports = "base";\n',
    'package.json': '{ "name": "app", "version": "1.0.0", "dependencies": { "dep": "file:./dep" } }\n',
  });
  sh(repo, 'switch', '-q', 'main');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: repo, env: ENV });
  write(repo, '.gitignore', 'node_modules\n');
  commit(repo, 'Lock the dependencies', {});
  sh(repo, 'switch', '-q', 'feat');
  sh(repo, 'reset', '-q', '--hard', 'main');
  const head = commit(repo, 'Change dep', { 'dep/index.js': 'module.exports = "commit";\n' });
  const base = sh(repo, 'rev-parse', 'main').trim();
  write(join(repo, '.git', 'lpk'), 'run.json', JSON.stringify({ v: 2, id: 'run1', repo, session: 's1', target: 'main', reviewRange: `${base}..${head}`, started: Date.now() }));
  const cmd = 'node -e "console.log(\'dep is \' + require(\'dep\'), require.resolve(\'dep\'))"';
  const atCommit = lpk(repo, 'repro', '--cmd', cmd, '--at', 'commit');
  assert.equal(atCommit.status, 0, atCommit.stderr);
  const tree = join(ENV.XDG_CACHE_HOME, 'lpk', 'repro', 'run1', head.slice(0, 12));
  assert.match(atCommit.stdout, new RegExp(`commit ${head.slice(0, 12)} tree ${tree}: installed with \`npm ci --prefer-offline --no-audit --no-fund\``));
  assert.match(atCommit.stdout, new RegExp(`exit 0 in \\d+s\\n {2}\\| dep is commit ${realpathSync(tree)}/dep/index\\.js`));
  const atBase = lpk(repo, 'repro', '--cmd', cmd, '--at', 'base');
  assert.match(atBase.stdout, /\| dep is base /);
  // The second verifier on the same commit shares the tree and its install.
  const installed = statSync(`${tree}.install.json`).mtimeMs;
  assert.equal(lpk(repo, 'repro', '--cmd', 'true', '--at', 'commit').status, 0);
  assert.equal(statSync(`${tree}.install.json`).mtimeMs, installed, 'installed once');
  assert.deepEqual(records(repo).map((r) => [r.side, r.commit, r.exit, r.crash]), [['commit', head, 0, false], ['base', base, 0, false], ['commit', head, 0, false]]);
  const clean = lpk(repo, 'repro', 'clean');
  assert.match(clean.stdout, /removed 2 repro worktree\(s\)/);
  assert.equal(sh(repo, 'worktree', 'list').trim().split('\n').length, 1);
});

test('a finding\'s own repro runs at the commit it was raised at, and a command killed by a signal is a crash', () => {
  const repo = repoWith('crash', { 'a.sh': 'echo one\n' });
  const head = commit(repo, 'Change a', { 'a.sh': 'echo two\n' });
  write(join(repo, '.git', 'lpk'), 'run.json', JSON.stringify({ v: 2, id: 'run2', repo, session: 's1', target: 'main', reviewRange: '', started: Date.now() }));
  const f = addFinding(repo, { from: 'lpk:bug-hunter', at: head, claim: 'prints two', repro: 'bash a.sh', kind: 'defect', severity: 'important' });
  assert.ok(f.finding, f.error);
  commit(repo, 'Move on', { 'b.sh': 'x\n' });
  const r = lpk(repo, 'repro', f.finding.id, '--at', 'commit');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`\`bash a\\.sh\` at commit ${head.slice(0, 12)}: exit 0 in \\d+s\\n {2}\\| two`));
  assert.match(r.stdout, /no lockfile lpk installs from/);
  const killed = lpk(repo, 'repro', f.finding.id, '--cmd', 'kill -9 $$', '--at', 'base');
  assert.match(killed.stdout, /at base [0-9a-f]{12}: CRASH \(killed by SIGKILL\)/);
  const rec = records(repo).at(-1);
  assert.deepEqual([rec.finding, rec.side, rec.crash, rec.signal], [f.finding.id, 'base', true, 'SIGKILL']);
  assert.equal(lpk(repo, 'repro', 'F99', '--at', 'commit').status, 2);
});

test('a verifier in the superproject reproduces in the submodule its session\'s run works in', () => {
  const inner = repoWith('repro-inner', { 'a.sh': 'echo one\n' });
  const outer = repoWith('repro-outer', { 'README.md': 'x\n' });
  sh(outer, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'services/inner');
  const sub = join(outer, 'services', 'inner');
  const head = commit(sub, 'Change a', { 'a.sh': 'echo two\n' });
  const as = (cwd, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: { ...ENV, CLAUDE_CODE_SESSION_ID: 'lead' }, encoding: 'utf8' });
  const started = as(sub, 'run', 'start', '--target', 'origin/main', '--verify', 'true');
  assert.equal(started.status, 0, started.stderr);
  const f = addFinding(sub, { from: 'lpk:bug-hunter', at: `origin/main..${head}`, claim: 'prints two', repro: 'bash a.sh', kind: 'defect', severity: 'important' });
  assert.ok(f.finding, f.error);
  const r = as(outer, 'repro', f.finding.id, '--at', 'commit');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /`bash a\.sh` at commit [0-9a-f]{12}: exit 0 in \d+s\n {2}\| two/);
  assert.equal(sh(sub, 'worktree', 'list').trim().split('\n').length, 2, 'the repro tree is the submodule\'s');
  assert.equal(sh(outer, 'worktree', 'list').trim().split('\n').length, 1);
});
