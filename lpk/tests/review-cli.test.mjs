// `lpk code-review` and `lpk review start` as a session runs them, in a real git repo, with a
// stand-in `claude` on PATH that answers the way the headless review child does.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveRange } from '../lib/codereview.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-review-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// The stand-in child: it logs what it was given (the token it read on its descriptor, never the
// token itself in a log a test prints) and answers in the form STUB_MODE names.
const BIN = join(tmp, 'bin');
mkdirSync(BIN);
writeFileSync(join(BIN, 'claude'), `#!/usr/bin/env node
const fs = require('node:fs'), { execFileSync } = require('node:child_process');
const fd = process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
const token = fd ? fs.readFileSync(Number(fd), 'utf8').split('\\n')[0] : null;
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim();
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ args: process.argv.slice(2), token, envToken: process.env.CLAUDE_CODE_OAUTH_TOKEN ?? null, report: process.env.CLAUDE_CODE_REPORT_FINDINGS, staged }) + '\\n');
const say = (e) => process.stdout.write(JSON.stringify(e) + '\\n');
const done = (result, extra = {}) => say({ type: 'result', subtype: 'success', is_error: false, result, duration_ms: 1200, usage: { input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100 }, modelUsage: { 'claude-sonnet-5': {} }, ...extra });
const mode = process.env.STUB_MODE;
say({ type: 'system', subtype: 'init' });
if (mode === 'report') {
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ReportFindings', input: { level: 'high', findings: [
    { file: 'a.js', line: 2, summary: 'the limit is off by one', failure_scenario: 'limit 3 returns 4 rows', category: 'correctness', verdict: 'CONFIRMED' },
    { file: 'a.js', line: 1, summary: 'the helper duplicates util.take', failure_scenario: 'two copies to keep in step', category: 'reuse' },
  ] } }] } });
  done('');
} else if (mode === 'partial') {
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ReportFindings', input: { level: 'high', findings: [
    { file: 'a.js', line: 2, summary: 'the limit is off by one', failure_scenario: 'limit 3 returns 4 rows', category: 'correctness' },
    { file: 'a.js', line: 2, summary: '', failure_scenario: 'page(xs, 0) returns one row', category: 'correctness' },
    { file: 'a.js', line: 1, summary: '', failure_scenario: '', category: 'correctness' },
  ] } }] } });
  done('');
} else if (mode === 'prose') done('1 finding:\\n\\n1. \`a.js:2\`: the limit is off by one\\n   Failure scenario: limit 3 returns 4 rows');
else if (mode === 'security') done('# Vuln 1: Command injection: \`a.js:2\`\\n\\n* Severity: High\\n* Description: the name reaches a shell unquoted\\n* Exploit Scenario: a name of \`; rm -rf ~\` runs it\\n* Recommendation: use execFile');
else if (mode === 'fail') { say({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'rate limited' }); process.exit(1); }
`);
chmodSync(join(BIN, 'claude'), 0o755);

const ACCOUNTS = join(tmp, 'accounts');
mkdirSync(ACCOUNTS);
writeFileSync(join(ACCOUNTS, 'active'), 'cc2\n');
writeFileSync(join(ACCOUNTS, 'cc2.token'), 'token-of-cc2\n');

const ENV = { ...process.env, PATH: `${BIN}:${process.env.PATH}`, LPK_ACCOUNTS_DIR: ACCOUNTS, CLAUDE_CODE_OAUTH_TOKEN: 'token-from-the-parent-env', CLAUDE_CODE_SESSION_ID: '', XDG_CACHE_HOME: join(tmp, 'cache'), XDG_STATE_HOME: join(tmp, 'state'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lpk = (cwd, mode, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: { ...ENV, STUB_MODE: mode, STUB_LOG: join(cwd, '.git', 'stub.log') }, encoding: 'utf8' });
const stubCalls = (repo) => readFileSync(join(repo, '.git', 'stub.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const jsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const records = (repo) => jsonl(join(repo, '.git', 'lpk', 'records.jsonl'));
const ledger = (repo) => jsonl(join(repo, '.git', 'lpk', 'findings.jsonl')).filter((e) => e.ev === 'add').map((e) => e.finding);

// A repo whose base has a REVIEW.md, one commit of change on top, and an lpk run reviewing it.
function repo(name, { run = true } = {}) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'REVIEW.md'), 'Every query names its limit.\n');
  writeFileSync(join(dir, 'a.js'), 'export const take = (xs, n) => xs.slice(0, n);\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'base');
  const base = sh(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'a.js'), 'export const take = (xs, n) => xs.slice(0, n);\nexport const page = (xs, n) => xs.slice(0, n + 1);\n');
  sh(dir, 'commit', '-qam', 'add page');
  const head = sh(dir, 'rev-parse', 'HEAD');
  if (run) {
    mkdirSync(join(dir, '.git', 'lpk'), { recursive: true });
    writeFileSync(join(dir, '.git', 'lpk', 'run.json'), JSON.stringify({ v: 2, id: 'run1', repo: dir, session: 's1', target: 'main', lane: 'full', reviewRange: `${base}..${head}`, started: Date.now() }));
  }
  return { dir, base, head };
}

test('a /code-review child signs in on a descriptor, and its typed findings land in the ledger with a record', () => {
  const { dir, base, head } = repo('typed');
  const p = lpk(dir, 'report', 'code-review');
  assert.equal(p.status, 0, p.stderr);
  const [call] = stubCalls(dir);
  assert.equal(call.token, 'token-of-cc2');
  assert.equal(call.envToken, null);
  assert.equal(call.report, '1');
  assert.equal(call.staged, 'a.js');
  for (const flag of ['--no-session-persistence', '--exclude-dynamic-system-prompt-sections']) assert.ok(call.args.includes(flag), flag);
  const arg = (k) => call.args[call.args.indexOf(k) + 1];
  assert.deepEqual([arg('-p'), arg('--model'), arg('--fallback-model'), arg('--effort'), arg('--output-format')], ['/code-review high --max-findings all', 'sonnet', 'opus', 'high', 'stream-json']);
  assert.match(arg('--append-system-prompt'), /Every query names its limit/);
  assert.deepEqual(ledger(dir).map((f) => [f.id, f.from, f.at, f.file, f.line, f.kind, f.severity]), [
    ['F1', 'code-review:sonnet', `${base}..${head}`, 'a.js', 2, 'defect', 'important'],
    ['F2', 'code-review:sonnet', `${base}..${head}`, 'a.js', 1, 'defect', 'nit'],
  ]);
  const [rec] = records(dir);
  assert.deepEqual([rec.kind, rec.range, rec.model, rec.exit, rec.findings, rec.ids, rec.account, rec.via, rec.run], ['code-review', `${base}..${head}`, 'sonnet', 0, 2, ['F1', 'F2'], 'cc2', 'ReportFindings', 'run1']);
  assert.deepEqual(rec.tokens, { fresh: 22, cacheRead: 100 });
  assert.match(p.stdout.trim().split('\n').at(-1), new RegExp(`2 finding\\(s\\) added as F1 F2; record ${rec.out}$`));
  assert.ok(!readFileSync(rec.stream, 'utf8').includes('token-of-cc2'));
  assert.equal(sh(dir, 'worktree', 'list').split('\n').length, 1, 'the scratch worktree is removed');
});

test('the child is told the run\'s requirements and decisions, so intended behaviour is not reported as a defect', () => {
  const { dir } = repo('intent');
  const runFile = join(dir, '.git', 'lpk', 'run.json');
  writeFileSync(runFile, JSON.stringify({ ...JSON.parse(readFileSync(runFile, 'utf8')), requirements: [{ id: 'R1', text: 'page(xs, n) returns n + 1 rows so the caller can tell there is a next page', source: 'request' }, { id: 'R2', source: 'request' }] }));
  writeFileSync(join(dir, '.git', 'lpk', 'decisions.jsonl'), `${JSON.stringify({ run: 'run1', what: 'keep take() unbounded', why: 'callers slice it themselves' })}\n${JSON.stringify({ run: 'other', what: 'not this run', why: 'x' })}\n`);
  writeFileSync(join(dir, '.git', 'lpk', 'decisions.jsonl'), Array.from({ length: 50 }, (_, i) => JSON.stringify({ run: 'run1', what: `choice ${i}`, why: 'w' })).concat(JSON.stringify({ run: 'other', what: 'not this run', why: 'x' })).join('\n') + '\n');
  assert.equal(lpk(dir, 'report', 'code-review').status, 0);
  const text = stubCalls(dir)[0].args[stubCalls(dir)[0].args.indexOf('--append-system-prompt') + 1];
  assert.match(text, /R1: page\(xs, n\) returns n \+ 1 rows/);
  assert.match(text, /decided: choice 49 \(w\)/);
  assert.doesNotMatch(text, /choice 9 |not this run|R2|undefined/);
  assert.match(text, /Every query names its limit/);
});

test('a child that prints its findings instead of reporting them is still read', () => {
  const { dir } = repo('prose');
  const p = lpk(dir, 'prose', 'code-review', '--model', 'opus');
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(ledger(dir).map((f) => [f.from, f.file, f.line, f.claim, f.repro]), [['code-review:opus', 'a.js', 2, 'the limit is off by one', 'limit 3 returns 4 rows']]);
  assert.equal(records(dir)[0].via, 'prose');
});

test('a fix-delta review covers only its range and is told what the ledger already holds', () => {
  const { dir, head } = repo('delta');
  assert.equal(lpk(dir, 'report', 'code-review').status, 0);
  writeFileSync(join(dir, 'a.js'), 'export const take = (xs, n) => xs.slice(0, n);\nexport const page = (xs, n) => xs.slice(0, n);\n');
  sh(dir, 'commit', '-qam', 'fix page');
  const fix = sh(dir, 'rev-parse', 'HEAD');
  const p = lpk(dir, 'prose', 'code-review', '--range', `${head}..HEAD`);
  assert.equal(p.status, 0, p.stderr);
  const call = stubCalls(dir)[1];
  assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1], /already raised[\s\S]*F1 a\.js:2 \(open\): the limit is off by one/);
  assert.deepEqual(records(dir).map((r) => [r.range, r.delta]), [[records(dir)[0].range, false], [`${head}..${fix}`, true]]);
  assert.equal(ledger(dir).at(-1).at, `${head}..${fix}`);
});

test('/security-review findings are read from its report and marked as a security area', () => {
  const { dir } = repo('security');
  const p = lpk(dir, 'security', 'code-review', '--security');
  assert.equal(p.status, 0, p.stderr);
  assert.match(stubCalls(dir)[0].args[1], /^\/security-review Review only the change `git diff [0-9a-f]{40}\.\.[0-9a-f]{40}`/);
  assert.deepEqual(ledger(dir).map((f) => [f.from, f.file, f.line, f.area, f.severity, f.claim]), [['security-review:sonnet', 'a.js', 2, 'security', 'important', 'Command injection: the name reaches a shell unquoted']]);
  assert.equal(records(dir)[0].kind, 'security-review');
});

test('a child that fails is recorded as failed, never as a review with no findings', () => {
  const { dir } = repo('fail');
  const p = lpk(dir, 'fail', 'code-review');
  assert.equal(p.status, 1);
  assert.match(p.stderr, /failed \(error_during_execution\): rate limited/);
  const [rec] = records(dir);
  assert.deepEqual([rec.exit, rec.findings, rec.ids], [1, 0, []]);
  assert.deepEqual(ledger(dir), []);
});

test('a child whose findings the ledger partly refuses counts as run, and names each refused one', () => {
  const { dir, base, head } = repo('partial');
  const p = lpk(dir, 'partial', 'code-review');
  assert.equal(p.status, 1);
  assert.match(p.stderr, /1 finding\(s\) could not be added to the ledger: a\.js:1: claim: what is wrong/);
  assert.deepEqual(ledger(dir).map((f) => f.claim), ['the limit is off by one', 'page(xs, 0) returns one row']);
  const [rec] = records(dir);
  assert.deepEqual([rec.range, rec.exit, rec.ids, rec.refused.map((r) => [r.file, r.line, r.error.split(':')[0]])], [`${base}..${head}`, 0, ['F1', 'F2'], [['a.js', 1, 'claim']]]);
});

test('a builder self-review reviews its uncommitted slice against the slice base, prints its findings and leaves the ledger alone', () => {
  const { dir, head } = repo('slice', { run: false });
  // A fresh slice worktree: HEAD is the slice base, and the slice is not committed yet.
  writeFileSync(join(dir, 'a.js'), 'export const take = (xs, n) => xs.slice(0, n - 1);\n');
  writeFileSync(join(dir, 'b.js'), 'export const two = 2;\n');
  assert.equal(lpk(dir, 'report', 'code-review', '--slice').status, 2);
  const p = lpk(dir, 'report', 'code-review', '--slice', '--base', 'HEAD');
  assert.equal(p.status, 0, p.stderr);
  assert.equal(stubCalls(dir)[0].staged, 'a.js\nb.js');
  assert.match(p.stdout, /- a\.js:2: the limit is off by one\n {2}scenario: limit 3 returns 4 rows/);
  const [rec] = records(dir);
  assert.deepEqual([rec.kind, rec.range.split('..')[0], rec.findings], ['self-review', head, 2]);
  assert.deepEqual(ledger(dir), []);
});

test('a review range takes refs whose names hold dots, and a...b reviews from their merge base', () => {
  const { dir, base, head } = repo('dotted', { run: false });
  sh(dir, 'tag', 'v1.2', base);
  sh(dir, 'branch', 'release-1.2', base);
  for (const range of ['v1.2..HEAD', 'release-1.2..main', 'v1.2..', 'release-1.2...main']) assert.deepEqual(resolveRange(dir, range), { a: base, b: head, range: `${base}..${head}` }, range);
  assert.match(resolveRange(dir, 'v1.3..HEAD').error, /^v1\.3 is not a commit/);
});

test('review start records the range under review in the run, with whole commit ids', () => {
  const { dir, head } = repo('start');
  const p = lpk(dir, '', 'review', 'start', 'HEAD~1..HEAD');
  assert.equal(p.status, 0, p.stderr);
  const base = sh(dir, 'rev-parse', 'HEAD~1');
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'lpk', 'run.json'), 'utf8')).reviewRange, `${base}..${head}`);
  assert.match(p.stdout, new RegExp(`^reviewing ${base}\\.\\.${head} \\(1 commit\\(s\\)\\)`));
  assert.deepEqual(records(dir).map((r) => [r.kind, r.range]), [['review-start', `${base}..${head}`]]);
  assert.equal(lpk(dir, '', 'review', 'start', 'HEAD..HEAD').status, 2);
  const none = repo('start-norun', { run: false });
  const q = lpk(none.dir, '', 'review', 'start', 'HEAD~1..HEAD');
  assert.equal(q.status, 1);
  assert.match(q.stderr, /no lpk run/);
});
