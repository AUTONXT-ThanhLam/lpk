// The findings ledger a run keeps: what a reviewer records, what a verifier rules, what a fix
// closes, and the MCP server the agents reach it through.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { addFinding, ledgerOf, markFixed, readLedger, resetLedger, ruleOn, unsettled, unfixed } from '../lib/findings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LPK = join(ROOT, 'bin', 'lpk');
const MCP = join(ROOT, 'mcp', 'lpk.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-findings-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const lpk = (cwd, ...args) => execFileSync('node', [LPK, ...args], { cwd, env: ENV, encoding: 'utf8' });
const commit = (repo, text) => {
  writeFileSync(join(repo, 'f.txt'), `${text}\n`, { flag: 'a' });
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', text);
  return sh(repo, 'rev-parse', '--short=12', 'HEAD').trim();
};

function repo(name) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'f.txt'), 'a\n');
  sh(dir, 'add', '.'); sh(dir, 'commit', '-qm', 'init');
  return dir;
}

test('the ledger sits in the repo common dir, so every worktree of the repo shares one', () => {
  const r = repo('shared');
  const common = sh(r, 'rev-parse', '--git-common-dir').trim();
  assert.equal(ledgerOf(r), join(r, common, 'lpk', 'findings.json'));
  sh(r, 'worktree', 'add', '--detach', '-q', join(tmp, 'shared-review'), 'HEAD');
  assert.equal(ledgerOf(join(tmp, 'shared-review')), ledgerOf(r));
});

test('a finding is raised, ruled on once, and closed only by a later commit', () => {
  const r = repo('states');
  const file = ledgerOf(r);
  const first = commit(r, 'one');
  const { finding } = addFinding(file, { from: 'techlead', file: 'src/a.ts', line: 4, claim: 'the guard fails open', repro: 'run it, it prints ok', at: first });
  assert.equal(finding.id, 'F1');
  assert.equal(finding.state, 'open');

  assert.match(ruleOn(file, { id: 'F1', verdict: 'dropped', evidence: '' }).error, /evidence/);
  assert.equal(ruleOn(file, { id: 'F1', verdict: 'confirmed', evidence: 'reproduced on the commit' }).finding.state, 'confirmed');
  assert.match(ruleOn(file, { id: 'F1', verdict: 'dropped', evidence: 'on second look' }).error, /already confirmed/);

  assert.match(markFixed(file, { id: 'F1', commit: first }).error, /raised on/);
  assert.equal(markFixed(file, { id: 'F1', commit: commit(r, 'two') }).finding.state, 'fixed');
  assert.match(markFixed(file, { id: 'F1', commit: commit(r, 'three') }).error, /only a confirmed/);

  const second = addFinding(file, { from: 'perf', claim: 'N+1 on the list', repro: 'time it', at: first }).finding;
  assert.equal(second.id, 'F2');
  const all = readLedger(file).findings;
  assert.deepEqual(unsettled(all).map((f) => f.id), ['F2']);
  assert.deepEqual(unfixed(all), []);

  assert.match(addFinding(file, { from: 'x', claim: '', repro: 'r' }).error, /claim/);
  assert.match(addFinding(file, { from: 'x', claim: 'c', repro: '' }).error, /repro/);
  resetLedger(file);
  assert.deepEqual(readLedger(file).findings, []);
});

test('lpk finding lists, rules and closes a finding from the command line', () => {
  const r = repo('cli');
  const base = sh(r, 'rev-parse', '--short=12', 'HEAD').trim();
  addFinding(ledgerOf(r), { from: 'bug-hunter', file: 'a.ts', line: 2, claim: 'off by one', repro: 'i=0', at: base });
  assert.match(lpk(r, 'finding', 'list'), /F1 bug-hunter a\.ts:2 — off by one \(open\)/);
  lpk(r, 'finding', 'verdict', 'F1', 'confirmed', '--evidence', 'it prints 0 for n=1');
  const fix = commit(r, 'fix');
  assert.match(lpk(r, 'finding', 'fixed', 'F1', '--commit', fix, '--fix', 'clamped at 1'), /F1 fixed in/);
  assert.match(lpk(r, 'finding', 'list', '--state', 'open'), /no open finding/);
  assert.match(lpk(r, 'finding', 'get', 'F1'), /"fixedCommit": "/);
  assert.match(lpk(r, 'finding', 'list'), /\[fixed in /);
});

// One request and the one reply it gets, over the server's stdin and stdout.
function ask(proc, msg) {
  return new Promise((resolve) => {
    const onData = (chunk) => {
      const line = String(chunk).split('\n').find(Boolean);
      if (!line) return;
      proc.stdout.off('data', onData);
      resolve(JSON.parse(line));
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

test('the MCP server answers initialize, lists its tools and records a finding', async () => {
  const r = repo('mcp');
  const proc = spawn('node', [MCP], { cwd: r, env: ENV, stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    const init = await ask(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    const list = await ask(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.result.tools.map((t) => t.name), ['finding_add', 'finding_get', 'finding_verdict', 'finding_fixed', 'finding_list']);
    const call = (id, name, args) => ask(proc, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const added = await call(3, 'finding_add', { claim: 'the retry repeats a side effect', repro: 'ran it twice', from: 'bug-hunter', file: 'a.ts', line: 9 });
    assert.match(added.result.content[0].text, /^F1 recorded/);
    const got = await call(4, 'finding_get', { id: 'F1' });
    assert.match(got.result.content[0].text, /"state": "open"/);
    const ruled = await call(5, 'finding_verdict', { id: 'F1', verdict: 'confirmed', evidence: 'reproduced' });
    assert.match(ruled.result.content[0].text, /F1 is confirmed/);
    const missing = await call(6, 'finding_get', { id: 'F9' });
    assert.equal(missing.result.isError, true);
    assert.equal((await ask(proc, { jsonrpc: '2.0', id: 7, method: 'nonsense' })).error.code, -32601);
    assert.match(readFileSync(ledgerOf(r), 'utf8'), /the retry repeats a side effect/);
  } finally {
    proc.kill();
  }
});
