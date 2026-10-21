// `lpk watch [--minutes <n>]`: for Monitor. Prints one line when a running agent of the session has
// made no tool call for n minutes (10 unless told), once per stall; a later tool call re-arms it.
// Read from the tails of the agents' transcripts; whether the agent is stuck is the reader's call.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { latestSession, sessionFiles } from '../meter.mjs';
import { parseArgs, repoOf } from '../out.mjs';
import { readRun } from '../run.mjs';

const USAGE = 'usage: lpk watch [--minutes <n>] [--every <seconds>] [--session <id>] [--once]';
const TAIL = 512 * 1024;

function tail(file) {
  const size = statSync(file).size;
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(size, TAIL));
    readSync(fd, buf, 0, buf.length, size - buf.length);
    const text = buf.toString('utf8');
    // The first line of a cut tail is partial unless the tail is the whole file.
    return (size > TAIL ? text.slice(text.indexOf('\n') + 1) : text).split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
  } finally { closeSync(fd); }
}

// The agent's state: finished, or its last tool call (name, time, whether its result came back).
export function agentState(file) {
  let meta = {};
  try { meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* no meta */ }
  const entries = tail(file);
  const lastAssistant = entries.filter((e) => e.type === 'assistant').at(-1);
  const content = (e) => (Array.isArray(e?.message?.content) ? e.message.content : []);
  const finished = meta.finished === true || lastAssistant?.message?.stop_reason === 'end_turn' || content(lastAssistant).some((b) => b.type === 'tool_use' && b.name === 'StructuredOutput');
  let call = null;
  for (const e of entries) {
    if (e.type === 'assistant') for (const b of content(e)) if (b.type === 'tool_use') call = { name: b.name, id: b.id, at: e.timestamp, answered: false };
    if (e.type === 'user' && call) for (const b of content(e)) if (b.type === 'tool_result' && b.tool_use_id === call.id) call.answered = true;
  }
  return { agent: meta.agentType || 'agent', label: meta.description || '', finished, call, since: call?.at || entries[0]?.timestamp || '' };
}

export function stalls(session, minutes, now = Date.now()) {
  const files = sessionFiles(session);
  const out = [];
  for (const file of files?.agents || []) {
    // An agent untouched for two hours past the threshold is gone, not stalled.
    if (now - statSync(file).mtimeMs > (minutes + 120) * 60000) continue;
    const s = agentState(file);
    if (s.finished || !s.since) continue;
    const idle = (now - Date.parse(s.since)) / 60000;
    if (idle >= minutes) out.push({ file, key: `${file}@${s.since}`, idle: Math.floor(idle), ...s });
  }
  return out;
}

const line = (s) => `stalled: ${s.agent}${s.label ? ` "${s.label.slice(0, 50)}"` : ''} has made no tool call for ${s.idle} min (${s.call ? `last: ${s.call.name} at ${s.call.at.slice(11, 16)} UTC${s.call.answered ? '' : ', still waiting for its result'}` : 'none yet'}) — ${s.file}`;

export async function main(argv) {
  const a = parseArgs(argv, ['--minutes', '--every', '--session'], ['--once']);
  const minutes = Number(a.opt?.('--minutes') || 10), every = Number(a.opt?.('--every') || 60);
  if (a.error || a.words.length || !(minutes > 0) || !(every > 0)) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf('.');
  const session = a.opt('--session') || (repo && readRun(repo)?.session) || latestSession(process.cwd());
  if (!session || !sessionFiles(session)) { console.error(`lpk: no transcripts found for session ${session || '(none: give --session)'}`); return 1; }
  const told = new Set();
  for (;;) {
    for (const s of stalls(session, minutes)) if (!told.has(s.key)) { told.add(s.key); console.log(line(s)); }
    if (a.flags.has('--once')) return 0;
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}
