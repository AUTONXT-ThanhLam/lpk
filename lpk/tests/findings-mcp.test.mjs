// The finding tools as an agent meets them: the hook stamps who calls and on what range, and the MCP
// server records the call against the session's run.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLedger, VERIFIER } from '../lib/findings.mjs';
import { stampFinding, stampHookOutput } from '../lib/stamp.mjs';

const MCP = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'lpk.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'lpk-findings-mcp-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function repoWithRun(name) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'change');
  const range = `${sh(dir, 'rev-parse', 'HEAD~1').trim()}..${sh(dir, 'rev-parse', 'HEAD').trim()}`;
  mkdirSync(join(dir, '.git', 'lpk'));
  writeFileSync(join(dir, '.git', 'lpk', 'run.json'), JSON.stringify({ v: 2, id: 'run7', repo: dir, session: 's1', reviewRange: range }));
  return { dir, range };
}
const hook = (dir, tool, toolInput, who = {}) => ({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: dir, tool_name: `mcp__plugin_lpk_lpk__finding_${tool}`, tool_input: toolInput, ...who });

test('the hook stamps run, raiser, agent id and the reviewed range over whatever the agent wrote', () => {
  const { dir, range } = repoWithRun('stamp');
  const add = stampFinding(hook(dir, 'add', { claim: 'c', from: 'lpk:verifier', at: 'HEAD', run: 'other' }, { agent_type: 'lpk:bug-hunter', agent_id: 'a1' }));
  assert.deepEqual(add, { claim: 'c', repo: dir, run: 'run7', from: 'lpk:bug-hunter', agentId: 'a1', at: range });
  assert.equal(stampFinding(hook(dir, 'verdict', { id: 'F1', by: VERIFIER })).by, 'main');
  assert.equal(stampFinding(hook(dir, 'fixed', { id: 'F1' }, { agent_type: VERIFIER, agent_id: 'v1' })).by, VERIFIER);
  assert.deepEqual(stampHookOutput(hook(dir, 'list', {})), { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { repo: dir, run: 'run7' } } });
  assert.equal(stampFinding({ ...hook(dir, 'add', {}), tool_name: 'Bash' }), null);
  // Another session's run is not this session's: nothing but the repo is stamped.
  assert.deepEqual(stampFinding({ ...hook(dir, 'add', { claim: 'c', from: 'lpk:verifier' }), session_id: 's2' }), { claim: 'c', repo: dir });
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

test('the MCP server records a stamped finding, takes the verifier\'s ruling only with where the defect began, and refuses an unstamped one', async () => {
  const { dir, range } = repoWithRun('mcp');
  const proc = spawn('node', [MCP], { cwd: tmp, env: ENV, stdio: ['pipe', 'pipe', 'ignore'] });
  try {
    const init = await ask(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    const list = await ask(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(list.result.tools.map((t) => t.name), ['finding_add', 'finding_get', 'finding_verdict', 'finding_fixed', 'finding_list']);
    let n = 2;
    const call = (tool, args, who) => ask(proc, { jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name: `finding_${tool}`, arguments: stampFinding(hook(dir, tool, args, who)) } });
    const raised = await call('add', { claim: 'the retry repeats a side effect', repro: 'ran it twice', kind: 'defect', severity: 'important', file: 'a.ts', line: 9 }, { agent_type: 'lpk:bug-hunter', agent_id: 'a1' });
    assert.match(raised.result.content[0].text, /^F1 recorded \(lpk:bug-hunter a\.ts:9, open\)/);
    const causeless = await call('verdict', { id: 'F1', verdict: 'confirmed', evidence: 'ran it twice, two charges' }, { agent_type: VERIFIER, agent_id: 'v1' });
    assert.match(causeless.result.content[0].text, /born: the step the defect began in/);
    const ruled = await call('verdict', { id: 'F1', verdict: 'confirmed', born: 'design', cause: 'the brief never says a retry must not repeat the charge', evidence: 'ran it twice, two charges' }, { agent_type: VERIFIER, agent_id: 'v1' });
    assert.match(ruled.result.content[0].text, /F1 is confirmed/);
    const wrong = await call('add', { claim: 'c', repro: 'r', kind: 'defect', severity: 'nit', verdict: 'confirmed' }, { agent_type: 'lpk:bug-hunter' });
    assert.match(wrong.result.content[0].text, /unknown field verdict/);
    const unstamped = await ask(proc, { jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: 'finding_add', arguments: { repo: dir, claim: 'c', repro: 'r', kind: 'defect', severity: 'nit' } } });
    assert.equal(unstamped.result.isError, true);
    assert.match(unstamped.result.content[0].text, /from: /);
    const listed = await call('list', {});
    assert.match(listed.result.content[0].text, /\(confirmed by lpk:verifier; born in design: the brief never says a retry must not repeat the charge\)/);
    assert.deepEqual(readLedger(dir).findings.map((f) => [f.id, f.from, f.agentId, f.at, f.run, f.state, f.by]), [['F1', 'lpk:bug-hunter', 'a1', range, 'run7', 'confirmed', VERIFIER]]);
  } finally {
    proc.kill();
  }
});
