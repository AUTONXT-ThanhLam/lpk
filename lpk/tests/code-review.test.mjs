// `lpk code-review` as the lead meets it: a headless /code-review child whose findings land in the
// ledger and whose record pays the code review the lane owes, and a child that fails pays nothing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENV, ROOT, lpk, noHost, repoWith, sh, tmp, write } from './gates-env.mjs';
import { readLedger, ruleOn } from '../lib/findings.mjs';
import { stubBin } from './stub.mjs';

const ok = (r) => { assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
const owed = (repo, S, env = ENV) => JSON.parse(spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'reviews', 'owed', '--json'], { cwd: repo, env: { ...env, CLAUDE_CODE_SESSION_ID: S }, encoding: 'utf8' }).stdout).map((r) => r.lens);

function fakeClaude(name, lines) {
  const bin = join(tmp, process.platform === 'win32' ? `${name}.exe` : name);
  const seen = `{ argv: process.argv.slice(2), refs: git('for-each-ref', '--format=%(objectname)', 'refs/heads', 'refs/remotes').split('\\n').filter(Boolean), head: git('rev-parse', 'HEAD').trim(), remotes: git('remote').trim(), index: git('write-tree').trim(), staged: git('diff', '--cached', '--name-only').split('\\n').filter(Boolean) }`;
  return stubBin(tmp, name, `import { writeFileSync } from 'node:fs';\nimport { execFileSync } from 'node:child_process';\nconst git = (...a) => execFileSync('git', a, { encoding: 'utf8' });\nwriteFileSync(${JSON.stringify(`${bin}.seen`)}, JSON.stringify(${seen}));\n${lines.map((l) => `console.log(${JSON.stringify(JSON.stringify(l))});`).join('\n')}\n`);
}

const report = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'ReportFindings', input: { findings: [
  { file: 'src/a.mjs', line: 1, summary: 'a is now a string, so a + 1 concatenates', failure_scenario: 'a + 1 returns "21" instead of 3', category: 'correctness' },
] } }] } };
const result = { type: 'result', subtype: 'success', is_error: false, result: 'done', duration_ms: 5, total_cost_usd: 0.01, modelUsage: { 'claude-sonnet-5-5': {} } };

function changedRepo(name, S) {
  const repo = repoWith(name, { 'src/a.mjs': 'export const a = 1;\n' });
  sh(repo, 'config', 'diff.od.textconv', 'od -c');
  write(repo, '.git/info/attributes', '*.mjs diff=od\n');
  ok(lpk(repo, S, 'run', 'start', '--verify', 'false', '--scenario', 'true'));
  write(repo, 'src/a.mjs', 'export const a = "2";\n');
  sh(repo, 'commit', '-qam', 'Make a a string');
  return repo;
}

const seen = (bin) => JSON.parse(readFileSync(`${bin}.seen`, 'utf8'));
const codeReview = (repo, S, bin, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'code-review', ...args], { cwd: repo, env: { ...ENV, CLAUDE_CODE_SESSION_ID: S, LPK_CLAUDE_BIN: bin }, encoding: 'utf8' });

test('a code review adds its findings to the ledger and pays the code review the lane owes', () => {
  const S = 'cr';
  const repo = changedRepo('cr', S);
  assert.ok(owed(repo, S).includes('code-review'));
  const bin = fakeClaude('claude-ok', [report, result]);
  const out = ok(codeReview(repo, S, bin));
  assert.match(out, /1 finding\(s\) added as F1; record /);
  const [f] = readLedger(repo).findings;
  assert.deepEqual([f.from, f.file, f.line, f.claim], ['code-review:sonnet', 'src/a.mjs', 1, 'a is now a string, so a + 1 concatenates']);
  assert.ok(!owed(repo, S).includes('code-review'), 'the record pays the owed code review');
  const args = seen(bin).argv;
  assert.deepEqual(args.slice(0, 4), ['-p', '/code-review high --max-findings all', '--model', 'sonnet']);
  assert.match(args[args.indexOf('--append-system-prompt') + 1], /^You review a diff\./);
});

test('the child is given a fallback model only when --fallback-model is passed', () => {
  const S = 'crfallback';
  const repo = changedRepo('crfallback', S);
  const bin = fakeClaude('claude-fallback', [report, result]);
  ok(codeReview(repo, S, bin));
  assert.ok(!seen(bin).argv.includes('--fallback-model'), 'no fallback model unless asked');
  ok(codeReview(repo, S, bin, '--fallback-model', 'opus'));
  const args = seen(bin).argv;
  assert.equal(args[args.indexOf('--fallback-model') + 1], 'opus');
});

test('a code review finding the verifier confirms carries reach and born into the ledger and the report', () => {
  const S = 'crreach';
  const repo = changedRepo('crreach', S);
  ok(codeReview(repo, S, fakeClaude('claude-reach', [report, result])));
  ruleOn(repo, { id: 'F1', verdict: 'confirmed', born: 'build', cause: 'the edit turned a into a string', reach: 'user', evidence: 'a + 1 is "21"', by: 'lpk:verifier' });
  const [f] = readLedger(repo).findings;
  assert.deepEqual([f.from, f.state, f.born, f.reach], ['code-review:sonnet', 'confirmed', 'build', 'user']);
  const shown = lpk(repo, S, 'report').stdout;
  assert.match(shown, /^Confirmed defects by the step they began in: build 1$/m);
  assert.match(shown, /^Confirmed defects by who meets them: user 1$/m);
});

test('a fix delta is reviewed alone: the child finds no branch or upstream holding the reviewed change', () => {
  const S = 'crdelta';
  const repo = changedRepo('crdelta', S);
  const reviewed = sh(repo, 'rev-parse', 'HEAD').trim();
  write(repo, 'src/b.mjs', 'export const b = 1;\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'Add b');
  const bin = fakeClaude('claude-delta', [report, result]);
  ok(codeReview(repo, S, bin, '--range', `${reviewed}..HEAD`));
  const { refs, head, staged, remotes, index } = seen(bin);
  assert.deepEqual([head, [...new Set(refs)], remotes, staged, index], [reviewed, [reviewed], '', ['src/b.mjs'], sh(repo, 'rev-parse', 'HEAD^{tree}').trim()]);
});

async function workflowCodeReview(args) {
  const body = readFileSync(join(ROOT, 'workflows', 'review.js'), 'utf8').replace(/^export const meta = \{[\s\S]*?\n\}\n/, '');
  const prompts = [];
  const agent = async (prompt) => { prompts.push(prompt); return { record: '', ids: [] }; };
  const parallel = (ts) => Promise.all(ts.map((t) => Promise.resolve().then(t).catch(() => null)));
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let v = item;
    for (const s of stages) { try { v = await s(v, item, i); } catch { return null; } }
    return v;
  }));
  await new (async () => {}).constructor('args', 'agent', 'parallel', 'pipeline', 'log', 'phase', body)(args, agent, parallel, pipeline, () => {}, () => {});
  return prompts.join('\n').match(/^lpk code-review .*$/m)[0];
}

test('a review workflow given a range lpk review start did not record stops its code review before any model runs', async () => {
  const S = 'crexpect';
  const repo = changedRepo('crexpect', S);
  const reviewed = sh(repo, 'rev-parse', 'HEAD').trim();
  ok(lpk(repo, S, 'review', 'start', `${reviewed}~1..${reviewed}`));
  write(repo, 'src/b.mjs', 'export const b = 1;\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-qm', 'Add b');
  const range = `${reviewed}..${sh(repo, 'rev-parse', 'HEAD').trim()}`;
  const cmd = await workflowCodeReview({ repo, base: reviewed, commit: 'HEAD', range, bundle: '/b', request: 'r', scenarios: 's', lenses: ['code-review'] });
  const bin = fakeClaude('claude-expect', [report, result]);
  const r = codeReview(repo, S, bin, ...cmd.split(' ').slice(2));
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes(`lpk review start ${range}`), r.stderr);
  assert.throws(() => seen(bin), /ENOENT/);
  ok(codeReview(repo, S, bin, '--expect-range', `${reviewed}~1..${reviewed.slice(0, 7)}`));
});

test('a code review child that ends without a result fails and leaves the code review owed', () => {
  const S = 'crfail';
  const repo = changedRepo('crfail', S);
  const r = codeReview(repo, S, fakeClaude('claude-dead', [{ type: 'system', subtype: 'init' }]));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the review child ended without a result/);
  assert.ok(owed(repo, S).includes('code-review'));
});

test('on a host without the code review command the lane owes the code-reviewer agent', () => {
  const S = 'nohost';
  const repo = changedRepo('nohost', S);
  const out = spawnSync('node', [join(ROOT, 'bin', 'lpk'), 'reviews', 'owed', '--json'], { cwd: repo, env: noHost(ENV), encoding: 'utf8' });
  const lenses = JSON.parse(out.stdout).map((r) => r.lens);
  assert.ok(lenses.includes('code-reviewer') && !lenses.includes('code-review'), lenses.join());
});

test('a review child that cannot be started fails with lpk\'s message, not a stack, and pays nothing', () => {
  const S = 'nostart';
  const repo = changedRepo('nostart', S);
  write(tmp, 'not-a-program.txt', 'this is text, not an executable\n');
  const r = codeReview(repo, S, join(tmp, 'not-a-program.txt'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /the review child ended without a result \(exit [^)]+\): /);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.ok(owed(repo, S).includes('code-review'));
});
