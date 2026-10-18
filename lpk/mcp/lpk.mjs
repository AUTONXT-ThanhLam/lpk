// The findings ledger as MCP tools, so a reviewer records a finding and a verifier rules on it
// without passing a multi-line claim and reproduction through a shell command line. Plain stdio
// JSON-RPC, one message per line: the plugin ships no dependencies and this must start anywhere.
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { addFinding, findingsText, getFinding, ledgerOf, markFixed, readLedger, ruleOn, unsettled, unfixed } from '../lib/findings.mjs';
import { git } from '../lib/git.mjs';

const PROTOCOL = ['2024-11-05', '2025-03-26', '2025-06-18'];
const ACTIVE = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'lpk', 'active');

// The repo this ledger belongs to: the session's own directory, else the newest lpk run on this
// machine (a reviewer works in the frozen worktree while the session sits in the checkout).
function repo() {
  const here = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  if (here) return here;
  let names = [];
  try { names = readdirSync(ACTIVE); } catch { return ''; }
  const runs = names.map((n) => {
    try { return JSON.parse(readFileSync(readFileSync(join(ACTIVE, n), 'utf8').trim(), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => (b.started || 0) - (a.started || 0));
  return runs[0]?.repo || '';
}

const ok = (text) => ({ content: [{ type: 'text', text }] });
const bad = (text) => ({ content: [{ type: 'text', text }], isError: true });
const say = (r, f) => (r.error ? bad(`lpk: ${r.error}`) : ok(f(r.finding)));

const TOOLS = [
  {
    name: 'finding_add',
    description: 'Record a finding on the committed change under review. Give the claim (what is wrong and who meets it) and the reproduction (the command and its real output, or the input, state and wrong outcome traced through code you read). `verdict: confirmed` with `evidence` only when a command you ran proves it, as `lpk mutate` does for a mutant.',
    inputSchema: {
      type: 'object',
      properties: {
        claim: { type: 'string', description: 'what is wrong, for whom' },
        repro: { type: 'string', description: 'the steps or command that show it' },
        file: { type: 'string', description: 'path at the reviewed commit' },
        line: { type: 'integer' },
        from: { type: 'string', description: 'the role raising it' },
        verdict: { type: 'string', enum: ['confirmed'] },
        evidence: { type: 'string', description: 'the command output that proves it, with verdict confirmed' },
      },
      required: ['claim', 'repro'],
    },
  },
  {
    name: 'finding_get',
    description: 'Read one finding: its claim, reproduction, the verdict a verifier gave it and the commit that fixed it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'finding_verdict',
    description: 'Rule on the one finding you were given: confirmed (it reproduces), preexisting (it reproduces on the base too, so it is reported and not fixed) or dropped (it does not hold), with the reproduction or the reason as evidence. Only a finding still open can be ruled on.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'preexisting', 'dropped'] }, evidence: { type: 'string' } },
      required: ['id', 'verdict', 'evidence'],
    },
  },
  {
    name: 'finding_fixed',
    description: 'Close a confirmed finding with the commit that fixed it (a commit after the one it was raised on) and, in one sentence, how.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, commit: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'commit'] },
  },
  {
    name: 'finding_list',
    description: 'Every finding of this run, in the order they were raised, or only those in one state.',
    inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['open', 'confirmed', 'preexisting', 'dropped', 'fixed'] } } },
  },
];

function call(name, a) {
  const repoPath = repo();
  const file = ledgerOf(repoPath);
  if (!file) return bad('lpk: no git repository here and no lpk run open on this machine, so there is nowhere to keep findings');
  const head = git(['rev-parse', '--short=12', 'HEAD'], repoPath).trim();
  if (name === 'finding_add') return say(addFinding(file, { ...a, at: head }), (f) => `${f.id} recorded (${f.from}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}, state ${f.state}).`);
  if (name === 'finding_get') return getFinding(file, a.id) ? ok(JSON.stringify(getFinding(file, a.id), null, 1)) : bad(`lpk: no finding ${a.id}`);
  if (name === 'finding_verdict') return say(ruleOn(file, a), (f) => `${f.id} is ${f.state}: ${f.evidence}`);
  if (name === 'finding_fixed') return say(markFixed(file, a), (f) => `${f.id} fixed in ${f.fixedCommit}.`);
  if (name === 'finding_list') {
    const all = readLedger(file).findings;
    const tail = `\n${unsettled(all).length} open, ${unfixed(all).length} confirmed and unfixed, ${all.length} in all`;
    return ok(findingsText(all, { state: a.state }) + tail);
  }
  return bad(`lpk: no tool ${name}`);
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

function handle(m) {
  if (m.method === 'initialize') {
    const want = m.params?.protocolVersion;
    send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: PROTOCOL.includes(want) ? want : PROTOCOL.at(-1), capabilities: { tools: {} }, serverInfo: { name: 'lpk', version: '1.0.0' } } });
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
