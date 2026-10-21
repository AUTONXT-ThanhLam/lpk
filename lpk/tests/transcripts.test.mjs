// Which lenses ran, read from the transcripts Claude Code writes for a session's subagents and
// workflow agents, in the shapes it writes them.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { agent, assistant, ENV, user } from './gates-env.mjs';
import { findingCount, lensRuns } from '../lib/transcripts.mjs';

test('a lens ran when its transcript ends in structured output or end_turn; an API error or a cut-off run did not', () => {
  const s = join(ENV.CLAUDE_CONFIG_DIR, 'projects', '-home-me-repo', 'sess-1', 'subagents');
  const range = 'a1b2c3d4e5f6..0f9e8d7c6b5a';
  agent(s, 'aa1', 'lpk:techlead', [user(`Review ${range} as the tech lead.`), assistant([{ type: 'tool_use', name: 'StructuredOutput', input: { findings: [{ claim: 'x' }] } }], 'tool_use'), user([{ type: 'tool_result', content: 'Structured output provided successfully' }])]);
  agent(s, 'aa2', 'lpk:bug-hunter', [user([{ type: 'text', text: `Hunt bugs in ${range}.` }]), assistant([{ type: 'text', text: 'done' }], 'end_turn')]);
  agent(s, 'aa3', 'lpk:claims', [user(`Check claims in ${range}.`), assistant([{ type: 'text', text: 'API Error: overloaded' }], 'stop_sequence', { isApiErrorMessage: true })]);
  agent(s, 'aa4', 'lpk:ocr', [user(`Review ${range}.`), assistant([{ type: 'tool_use', name: 'Bash', input: {} }], 'tool_use')]);
  writeFileSync(join(s, 'agent-aa4.jsonl'), '{"type":"assistant","message":{"content":[', { flag: 'a' });
  // A workflow agent: the relayed request comes first and names nothing; the computed task names the range.
  agent(join(s, 'workflows', 'wf_1'), 'bb1', 'lpk:prover', [
    user('[Workflow harness — user request] The harness relays ... fix deadbeef1234 later'),
    user(`[Workflow harness — computed task] Prove the scenarios on 1234abc..5678def.`),
    assistant([{ type: 'tool_use', name: 'StructuredOutput', input: { results: [{ scenario: 'S1', status: 'PASS' }, { scenario: 'S2', status: 'FAIL', id: 'F4' }], findings: [{ id: 'F4' }] } }], 'tool_use'),
  ]);
  const runs = Object.fromEntries(lensRuns('/home/me/repo', 'sess-1').map((r) => [r.agentId, r]));
  assert.deepEqual([runs.aa1.ended, runs.aa2.ended, runs.aa3.ended, runs.aa4.ended, runs.bb1.ended], ['structured', 'end_turn', 'error', 'running', 'structured']);
  assert.equal(runs.aa1.range, range);
  assert.equal(runs.aa1.agentType, 'lpk:techlead');
  assert.equal(runs.bb1.range, '1234abc..5678def', 'the relayed request is not the prompt');
  assert.equal(findingCount(runs.aa1.structured), 1);
  assert.equal(findingCount(runs.bb1.structured), 1, 'a FAIL scenario is one finding, also when the prover lists it under findings too');
  assert.equal(findingCount(runs.aa2.structured), null, 'end_turn returns no count');
  assert.deepEqual(lensRuns('/home/me/repo', 'other-session'), []);
});
