// The findings ledger as MCP tools, so a reviewer records a finding and a verifier rules on it
// without passing a multi-line claim and reproduction through a shell command line. Plain stdio
// JSON-RPC, one message per line: the plugin ships no dependencies and this must start anywhere.
// The PreToolUse hook on these tools stamps repo, run, from, agentId, at and by (lib/stamp.mjs).
import { REACH } from '../lib/reach.mjs';
import { addFinding, BORN, counts, findingsText, getFinding, KINDS, markFixed, PROTECTED, readLedger, ruleOn, SEVERITIES, STATES, VERDICTS, VERIFIER, CLOSED_BY } from '../lib/findings.mjs';
import { top } from '../lib/git.mjs';

const PROTOCOL = ['2024-11-05', '2025-03-26', '2025-06-18'];

const ok = (text) => ({ content: [{ type: 'text', text }] });
const bad = (text) => ({ content: [{ type: 'text', text }], isError: true });
const say = (r, f) => (r.error ? bad(`lpk: ${r.error}`) : ok(f(r.finding)));
const str = (description) => ({ type: 'string', description });
const STAMP = 'stamped by lpk; leave out';
const stamped = { repo: str(STAMP), run: str(STAMP) };

const TOOLS = [
  {
    name: 'finding_add',
    description: 'Record one finding on the change under review: what is wrong and who meets it, and the repro (the command and its real output, or the input, state and wrong outcome traced through code you read).',
    inputSchema: {
      type: 'object',
      properties: {
        claim: str('what is wrong, for whom'),
        repro: str('the steps or command that show it'),
        kind: { type: 'string', enum: KINDS },
        severity: { type: 'string', enum: SEVERITIES },
        file: str('path at the reviewed commit'),
        line: { type: 'integer', minimum: 1 },
        ruleId: str('the rule id, for kind rule'),
        area: { type: 'string', enum: PROTECTED, description: 'set when the finding is in one of these areas' },
        ...stamped, from: str(STAMP), agentId: str(STAMP), at: str(STAMP),
      },
      required: ['claim', 'repro', 'kind', 'severity'],
    },
  },
  {
    name: 'finding_get',
    description: 'Read one finding: claim, repro, ruling and fix.',
    inputSchema: { type: 'object', properties: { id: str('F<n>'), ...stamped }, required: ['id'] },
  },
  {
    name: 'finding_verdict',
    description: 'Rule on one finding with evidence: confirmed (with born, cause and reach), preexisting (also fails on the base), dropped (with basis), duplicate (with primary) or unsettled.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('F<n>'),
        verdict: { type: 'string', enum: VERDICTS },
        evidence: str('the repro you ran and its output, or why the claim is false'),
        basis: { type: 'string', enum: ['not-reproduced', 'disproved'], description: 'for dropped' },
        primary: str('for duplicate: the finding it repeats'),
        born: { type: 'string', enum: BORN, description: 'for confirmed: the step the defect began in' },
        cause: str('for confirmed: why the defect exists, at the place it starts, in one sentence'),
        reach: { type: 'string', enum: REACH, description: 'for confirmed: user (a person or caller meets it), merge (the tech lead would block the merge on it) or neither (the finding is deferred, listed as a known limit)' },
        area: { type: 'string', enum: PROTECTED, description: 'for confirmed: set it when the defect is in a protected area and the finding has none; such a finding is never a known limit' },
        ...stamped, by: str(STAMP),
      },
      required: ['id', 'verdict', 'evidence'],
    },
  },
  {
    name: 'finding_fixed',
    description: 'Close a confirmed finding: the fix commit, and how it is known fixed (repro green on it, a test failing on its parent, or your ruling as verifier) with that evidence. A fixed finding whose commit left the branch (a cherry-pick, an amend, a rebase) is closed again on the commit now on HEAD. closedBy owner, with no commit, defers a finding outside a protected area and not a failing scenario under a policy the owner stated, quoting the owner\'s words as evidence; the report lists it as a known limit.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('F<n>'),
        commit: str('the fix commit; none for closedBy owner'),
        closedBy: { type: 'string', enum: CLOSED_BY },
        evidence: str('the repro or test output, the ruling, or for closedBy owner the owner\'s words'),
        fix: str('how, in one sentence'),
        sweep: str('for a finding with a file: a git grep -E pattern for the form of the defect. lpk runs it over the files the change touches: it must hit before the fix and on no line the change adds after it'),
        ...stamped, by: str(STAMP),
      },
      required: ['id', 'closedBy', 'evidence'],
    },
  },
  {
    name: 'finding_list',
    description: 'The findings of this run, or those in one state.',
    inputSchema: { type: 'object', properties: { state: { type: 'string', enum: STATES }, ...stamped } },
  },
];

const where = (f) => (f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : '');

function call(name, input) {
  const { repo: given, run, ...a } = input;
  const repo = given || top(process.cwd());
  if (!repo) return bad('lpk: no repo was stamped and this server does not run in a git repository, so there is no ledger to use');
  if (name === 'finding_add') return say(addFinding(repo, { ...a, run }), (f) => `${f.id} recorded (${f.from}${where(f)}, open).`);
  if (name === 'finding_get') { const f = getFinding(repo, a.id); return f ? ok(JSON.stringify(f, null, 1)) : bad(`lpk: no finding ${a.id}`); }
  if (name === 'finding_verdict') {
    if (a.by !== VERIFIER) return bad(`lpk: only ${VERIFIER} rules on a finding, and this call came from ${a.by || 'nobody'}. Start ${VERIFIER} with the finding's id, claim and reproduction, and it rules with evidence.`);
    return say(ruleOn(repo, a), (f) => `${f.id} is ${f.state}${f.asked ? ` (asked ${f.asked}; in a protected area it stays unsettled, for the owner to read)` : ''}: ${f.evidence}`);
  }
  if (name === 'finding_fixed') return say(markFixed(repo, a), (f) => (f.state === 'deferred' ? `${f.id} deferred: ${f.deferEvidence}` : `${f.id} fixed in ${f.fixedCommit} (${f.closedBy}).`));
  if (name === 'finding_list') {
    const all = readLedger(repo).findings;
    const c = counts(all);
    return ok(`${findingsText(all, { state: a.state })}\n${c.open} open, ${c.confirmed} confirmed and unfixed, ${c.unsettled} unsettled, ${c.needsOwner} for the owner to read, ${c.total} in all`);
  }
  return bad(`lpk: no tool ${name}`);
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

function handle(m) {
  if (m.method === 'initialize') {
    const want = m.params?.protocolVersion;
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: PROTOCOL.includes(want) ? want : PROTOCOL.at(-1), capabilities: { tools: {} }, serverInfo: { name: 'lpk', version: '2.0.0' } } });
  } else if (m.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  } else if (m.method === 'tools/call') {
    let out;
    try { out = call(m.params?.name, m.params?.arguments || {}); } catch (e) { out = bad(`lpk: ${e.message}`); }
    send({ jsonrpc: '2.0', id: m.id, result: out });
  } else if (m.method === 'ping') {
    send({ jsonrpc: '2.0', id: m.id, result: {} });
  } else if (m.id !== undefined) {
    send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); } catch { /* a message that is not JSON-RPC is not ours to answer */ }
  }
});
