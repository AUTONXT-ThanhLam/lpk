import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { context, ENV, hook, lpk, repoWith, ROOT, startRun, write } from './hooks-env.mjs';

const HAS_SG = spawnSync('ast-grep', ['--version']).error?.code !== 'ENOENT';
const NO_SG = 'ast-grep is not installed here (CI installs @ast-grep/cli@0.51.0): npm i -g @ast-grep/cli@0.51.0 to run this test';
const AST = join(ENV.XDG_DATA_HOME, 'lpk', 'rules', 'ast');
const rule = (id, call) => {
  write(AST, `${id}.yml`, `id: ${id}\nlanguage: JavaScript\nseverity: warning\nmessage: ${call} runs text as code\nrule:\n  pattern: ${call}($X)\n`);
  write(AST, `tests/${id}-test.yml`, `id: ${id}\nvalid:\n  - "run(x)"\ninvalid:\n  - "${call}(x)"\n`);
};
rule('lpk-test-eval', 'eval');
rule('lpk-test-exec', 'exec');
write(join(ENV.XDG_DATA_HOME, 'lpk', 'rules'), 'all.md', '## Learned\n\n### lpk-test-exec: exec runs text as code\n- when: always\n- find: `exec\\(`\n- rule: no exec\n- check: none\n');

const changed = () => {
  const repo = repoWith(`ast-${Math.random().toString(36).slice(2, 8)}`, { 'src/a.js': 'const a = 1;\neval(a);\n' });
  write(repo, 'src/a.js', 'const a = 1;\neval(a);\neval(\n  b\n);\nexec(c);\n');
  write(repo, 'src/b.js', 'eval(z);\n');
  write(repo, 'tests/a.test.js', 'eval(x);\n');
  return repo;
};
const ours = (out) => out.split('\n').filter((l) => /lpk-test-/.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());

test('lpk check reports each ast match on added lines by rule id, once, beside the regex candidates', { skip: !HAS_SG && !process.env.CI && NO_SG }, () => {
  const r = lpk(changed(), '', 'check', '--base', 'main');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ours(r.stdout), [
    'lpk-test-eval src/a.js:3 eval(',
    'lpk-test-exec src/a.js:6 exec(c);',
    'lpk-test-eval src/b.js:1 eval(z);',
  ]);
  assert.doesNotMatch(r.stdout, /ast-grep: not installed/);
});

test('without ast-grep, lpk check says how to install it and keeps the regex candidates', () => {
  const PATH = process.env.PATH.split(delimiter).filter((d) => !existsSync(join(d, 'ast-grep'))).join(delimiter);
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'lpk'), 'check', '--base', 'main'], { cwd: changed(), env: { ...ENV, PATH }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ours(r.stdout), ['lpk-test-exec src/a.js:6 exec(c);']);
  assert.match(r.stdout, /ast-grep: not installed, so only the regex patterns ran; install it with `npm i -g @ast-grep\/cli@0\.51\.0`/);
});

test('the edit hook hands the builder the ast matches of the file it just edited', { skip: !HAS_SG && !process.env.CI && NO_SG }, () => {
  const repo = changed();
  startRun(repo, 'ast');
  const out = context(hook('PostToolUse', 'post', { tool_name: 'Edit', session_id: 'ast', cwd: repo, tool_input: { file_path: join(repo, 'src/b.js') } }));
  assert.match(out, /lpk-test-eval {2}src\/b\.js:1 {2}eval\(z\);/);
  assert.doesNotMatch(out, /lpk-test-eval {2}src\/a\.js/);
});

test('lpk rules --test passes the plugin and learned ast rules and fails a rule whose test does not hold', { skip: !HAS_SG && !process.env.CI && NO_SG }, () => {
  const ok = lpk(ROOT, '', 'rules', '--test');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /learned ast rules \(.+\): PASS/);
  write(AST, 'tests/lpk-test-bad-test.yml', 'id: lpk-test-bad\nvalid:\n  - "eval(y)"\ninvalid:\n  - "eval(x)"\n');
  write(AST, 'lpk-test-bad.yml', 'id: lpk-test-bad\nlanguage: JavaScript\nseverity: warning\nmessage: bad\nrule:\n  pattern: eval($X)\n');
  const bad = lpk(ROOT, '', 'rules', '--test');
  rmSync(join(AST, 'lpk-test-bad.yml')); rmSync(join(AST, 'tests', 'lpk-test-bad-test.yml'));
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /learned ast rules \(.+\): FAIL/);
  write(AST, 'lpk-test-bare.yml', 'id: lpk-test-bare.javascript\nlanguage: JavaScript\nseverity: warning\nmessage: bare\nrule:\n  pattern: eval($X)\n');
  const bare = lpk(ROOT, '', 'rules', '--test');
  rmSync(join(AST, 'lpk-test-bare.yml'));
  assert.equal(bare.status, 1, bare.stdout);
  assert.match(bare.stdout, /no tests\/<id>-test\.yml for: lpk-test-bare/);
});

test('a changed file whose name starts with a dash does not hide the matches of the other files', { skip: !HAS_SG && !process.env.CI && NO_SG }, () => {
  const repo = changed();
  write(repo, '-dash.js', 'eval(q);\n');
  const out = lpk(repo, '', 'check', '--base', 'HEAD').stdout;
  assert.doesNotMatch(out, /could not load/);
  assert.match(out, /lpk-test-eval\s+src\/b\.js:1/);
});

test('a focused test added under a test path is reported while other rules stay quiet there', { skip: !HAS_SG && !process.env.CI && NO_SG }, () => {
  const repo = changed();
  write(repo, 'tests/a.test.js', "it.only('a', () => {});\neval(q);\n");
  const out = lpk(repo, '', 'check', '--base', 'HEAD').stdout;
  assert.match(out, /tests-prove\s+tests\/a\.test\.js:1/);
  assert.doesNotMatch(out, /lpk-test-eval\s+tests\/a\.test\.js/);
});

test('lpk check reports a comment added in code or in a test, and not a tool directive or a comment already there', { skip: !HAS_SG && !process.env.CI && NO_SG }, () => {
  const repo = repoWith(`cm-${Math.random().toString(36).slice(2, 8)}`, { 'src/c.js': 'const a = 1;\n// written long ago\nconst b = 2;\n' });
  write(repo, 'src/c.js', 'const a = 1;\n// written long ago\nconst b = 2;\n// the retry count is three\n// eslint-disable-next-line no-console\nconsole.log(b);\n');
  write(repo, 'tests/c.test.js', '// check the total\ntest("t", () => {});\n');
  const out = lpk(repo, '', 'check', '--base', 'main').stdout;
  const hits = out.split('\n').filter((l) => /^no-comments /.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());
  assert.deepEqual(hits, ['no-comments src/c.js:4 // the retry count is three', 'no-comments tests/c.test.js:1 // check the total']);
});

test('lpk rules --yield counts findings per rule by state, and --prune disables a learned rule that only drew drops', () => {
  const repo = repoWith('yield', { 'a.js': 'x\n' });
  const add = (id, ruleId) => JSON.stringify({ ev: 'add', finding: { id, run: 'r1', from: 'lpk:techlead', at: 'a..b', claim: 'c', repro: 'r', kind: 'rule', ruleId, severity: 'important' } });
  const verdict = (id, state) => JSON.stringify({ ev: 'verdict', id, state, by: 'lpk:verifier', evidence: 'e' });
  write(join(repo, '.git', 'lpk', 'runs', 'r1'), 'findings.jsonl', [
    add('F1', 'lpk-test-exec'), add('F2', 'lpk-test-exec'), add('F3', 'lpk-test-exec'), add('F4', 'lpk-test-eval'),
    verdict('F1', 'dropped'), verdict('F2', 'dropped'), verdict('F3', 'dropped'), verdict('F4', 'confirmed'), '',
  ].join('\n'));
  write(join(repo, '.git', 'lpk'), 'findings.jsonl', `${add('F1', 'lpk-test-eval')}\n${verdict('F1', 'dropped')}\n`);
  const y = lpk(repo, '', 'rules', '--yield');
  assert.equal(y.status, 0, y.stderr);
  const row = (id) => y.stdout.split('\n').find((l) => l.startsWith(`${id} `)).trim().split(/\s+/).slice(1);
  assert.match(y.stdout, /rule\s+confirmed\s+fixed\s+deferred\s+dropped\s+duplicate\s+preexisting\s+open/);
  assert.deepEqual(row('lpk-test-exec'), ['0', '0', '0', '3', '0', '0', '0', 'yes']);
  assert.deepEqual(row('lpk-test-eval'), ['1', '0', '0', '1', '0', '0', '0', 'yes']);
  assert.match(y.stdout, /^prune .*: lpk-test-exec$/m);
  const p = lpk(repo, '', 'rules', '--prune');
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(readdirSync(join(AST, 'disabled')).sort(), ['lpk-test-exec.yml', 'tests']);
  assert.deepEqual(readdirSync(join(AST, 'disabled', 'tests')), ['lpk-test-exec-test.yml']);
  assert.ok(!existsSync(join(AST, 'lpk-test-exec.yml')) && existsSync(join(AST, 'lpk-test-eval.yml')));
});
