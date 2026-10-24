// What a session's transcripts say so far, read incrementally: each file is read from where the
// last read stopped, and what it said is folded into a small state kept in a cache file per
// session. A transcript of tens of megabytes is read once; each later call reads only its new lines.
// Tokens are counted as lib/meter.mjs counts them: each API message once by its id, fresh = input +
// cache write + output, cache reads apart, and a transcript whose host recorded no counts (measured:
// Qoder writes them all as 0) marks its state unrecorded so its tokens read as unmeasured.
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { agentFile, agentIdOf, projectsDirs, TOKEN_KEYS, usageRecorded } from './host.mjs';
import { sessionFiles } from './meter.mjs';

const V = 5;
const PROMPT_MAX = 2000;
const RELAY = '[Workflow harness — user request]';
const ACTION_MAX = 70;

export const cacheFile = (session) => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lpk', 'status', `${session}.json`);

export function readCache(session) {
  try { const c = JSON.parse(readFileSync(cacheFile(session), 'utf8')); if (c.v === V) return c; } catch { /* none yet, or another version */ }
  return { v: V, files: {} };
}

export function writeCache(session, cache) {
  const file = cacheFile(session);
  mkdirSync(dirname(file), { recursive: true });
  // Written aside and renamed, so a second status call at the same moment never reads half a file.
  const tmp = `${file}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(cache));
  renameSync(tmp, file);
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '');
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cut = (s, n = ACTION_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// A tool call as one short line: the tool and the argument that says what it touches.
export function actionOf(name, input = {}) {
  const tool = name.startsWith('mcp__') ? name.split('__').pop() : name;
  const file = input.file_path || input.notebook_path || input.path;
  const arg = ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name) && file ? basename(file)
    : name === 'Bash' ? String(input.command || '').split('\n')[0]
      : ['Agent', 'Task'].includes(name) ? input.description || input.subagent_type
        : name === 'Skill' ? input.skill
          : name === 'StructuredOutput' ? 'its report'
            : input.pattern || input.url || input.query || input.description || Object.values(input).find((v) => typeof v === 'string') || '';
  return cut(oneLine(`${tool} ${arg || ''}`));
}

const fresh = () => ({ spans: [], waiting: false, error: '', offset: 0, first: '', last: '', prompt: '', sawAssistant: false, end: 'open', action: '', toolAt: '', asks: [], notes: {}, results: [], lpkAt: '', interruptedAt: '', usage: {}, recorded: false });

// Each API message's usage by its id, the largest of each count over its lines: a transcript writes
// one line per content block, each carrying the same usage. The fifth number is when the message was
// first written, so a run counts only its own messages. `recorded` says the host wrote a count at
// all; a transcript of only zeros measured nothing.
function usage(st, m, at) {
  if (!m?.usage || !m.id || m.model === '<synthetic>') return;
  if (usageRecorded(m.usage)) st.recorded = true;
  const prev = st.usage[m.id] || [0, 0, 0, 0, Date.parse(at || '') || 0];
  st.usage[m.id] = [...TOKEN_KEYS.map((k, i) => Math.max(prev[i], m.usage[k] || 0)), prev[4]];
}

const NOTE = /<task-id>([^<]+)<\/task-id>[\s\S]*?<status>([a-z_]+)<\/status>/g;
const LPK_COMMAND = /<command-name>\/lpk(?::lpk)?<\/command-name>/;

// The time a transcript worked, as spans [from, to] in ms: each gap between two timestamped lines
// counts, except a gap that starts while the file waits on the owner, which is after a turn ended
// (end_turn: the owner's next prompt, or a notice, starts the next turn) and while an
// AskUserQuestion has no answer yet. Spans that touch are merged as they are added.
function span(st, t) {
  const at = Date.parse(t);
  if (!Number.isFinite(at)) return;
  const prev = st.last ? Date.parse(st.last) : NaN;
  if (Number.isFinite(prev) && !st.waiting && at > prev) {
    const s = st.spans.at(-1);
    if (s && s[1] === prev) s[1] = at; else st.spans.push([prev, at]);
  }
}

// Whether the file waits on the owner after this line. A turn ends with end_turn or the owner's
// interrupt and starts again with a prompt or a notice; an unanswered AskUserQuestion waits too.
// Lines that are neither (system lines, attachments, meta lines) leave it as it was.
function waits(st, e) {
  if (st.asks.length) return true;
  if (e.type === 'assistant') return st.end === 'end_turn';
  if (e.type !== 'user' || e.isMeta || e.isCompactSummary || e.isVisibleInTranscriptOnly) return st.waiting;
  const c = e.message?.content;
  const text = textOf(c);
  if (text.startsWith('[Request interrupted by user')) return true;
  if (Array.isArray(c) && c.some((b) => b?.type === 'tool_result')) return false;
  // A command's own output is no prompt; a slash command the owner typed starts a turn.
  return text.startsWith('<local-command') ? st.waiting : false;
}

// One transcript line folded into its file's state.
function fold(st, e) {
  if (e.timestamp) { span(st, e.timestamp); st.first ||= e.timestamp; st.last = e.timestamp; }
  facts(st, e);
  st.waiting = waits(st, e);
}

// What one line says: the prompt, answers, notices, the last tool call, how the turn ended, tokens.
function facts(st, e) {
  if (e.type === 'result' && e.agentId) { st.results.push(e.agentId); return; } // a workflow journal line
  const content = e.message?.content;
  if (e.type === 'user') {
    const text = textOf(content);
    if (!st.sawAssistant && !text.startsWith(RELAY) && st.prompt.length < PROMPT_MAX) st.prompt = `${st.prompt}${st.prompt ? '\n' : ''}${text}`.slice(0, PROMPT_MAX);
    if (Array.isArray(content)) for (const b of content) if (b?.type === 'tool_result') st.asks = st.asks.filter((id) => id !== b.tool_use_id);
    for (const m of text.matchAll(NOTE)) st.notes[m[1]] = m[2];
    const r = e.toolUseResult;
    if (r && typeof r === 'object' && r.agentId && r.status && r.status !== 'async_launched') st.notes[r.agentId] = r.status;
    if (LPK_COMMAND.test(text)) st.lpkAt = e.timestamp || st.lpkAt;
    if (text.startsWith('[Request interrupted by user')) st.interruptedAt = e.timestamp || st.interruptedAt;
    return;
  }
  if (e.type !== 'assistant') return;
  st.sawAssistant = true;
  usage(st, e.message, e.timestamp);
  const blocks = Array.isArray(content) ? content : [];
  for (const b of blocks.filter((x) => x?.type === 'tool_use')) {
    st.action = actionOf(b.name, b.input || {});
    st.toolAt = e.timestamp || st.toolAt;
    if (b.name === 'AskUserQuestion') st.asks.push(b.id);
    if (b.name === 'Skill' && /^(lpk:)?lpk$/.test(String(b.input?.skill || ''))) st.lpkAt = e.timestamp || st.lpkAt;
  }
  if (e.isApiErrorMessage) st.error = oneLine(textOf(content)).slice(0, 120);
  st.end = e.isApiErrorMessage ? 'error' : blocks.some((b) => b?.type === 'tool_use' && b.name === 'StructuredOutput') ? 'structured'
    : e.message?.stop_reason === 'end_turn' ? 'end_turn' : 'open';
}

// The bytes written since `from`, up to the last whole line: a line still being written waits for
// the next call.
function newLines(file, from) {
  let fd;
  try { fd = openSync(file, 'r'); } catch { return null; }
  try {
    const size = fstatSync(fd).size;
    if (size < from) return { restart: true };
    const buf = Buffer.alloc(size - from);
    let got = 0;
    while (got < buf.length) { const n = readSync(fd, buf, got, buf.length - got, from + got); if (!n) break; got += n; }
    const end = got ? buf.lastIndexOf(10, got - 1) : -1;
    return end < 0 ? { text: '', next: from } : { text: buf.subarray(0, end).toString('utf8'), next: from + end + 1 };
  } finally { closeSync(fd); }
}

export function scanFile(prev, file) {
  let st = prev ? { ...prev, usage: { ...prev.usage }, notes: { ...prev.notes }, asks: [...prev.asks], results: [...prev.results], spans: prev.spans.map((x) => [...x]) } : fresh();
  let got = newLines(file, st.offset);
  if (got?.restart) { st = fresh(); got = newLines(file, 0); }
  if (!got) return st;
  for (const line of got.text.split('\n')) {
    if (!line.trim()) continue;
    try { fold(st, JSON.parse(line)); } catch { /* a damaged line is skipped, as meter skips it */ }
  }
  st.offset = got.next;
  return st;
}

// The session's tokens as lib/meter.mjs counts them: files in its order, each message id once, a
// message a fork replays from an earlier file left out, and only messages written from `since` on.
// `recorded` is false when no transcript of the session carried a count, so its caller prints the
// totals as unmeasured rather than as 0.
export function tokensOf(states, since = 0) {
  const seen = new Set();
  const t = { fresh: 0, cacheRead: 0, recorded: false };
  for (const st of states) {
    if (st.recorded) t.recorded = true;
    const mine = Object.entries(st.usage).filter(([id]) => !seen.has(id));
    for (const [, [input, cacheWrite, cacheRead, output, at]] of mine.filter(([, u]) => u[4] >= since)) { t.fresh += input + cacheWrite + output; t.cacheRead += cacheRead; }
    for (const id of Object.keys(st.usage)) seen.add(id);
  }
  return t;
}

const metaOf = (file) => { try { return JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { return {}; } };

// The session's main transcript, every agent with its meta file, and each workflow's journal, each
// brought up to date in `cache`. Null when neither host's store holds a transcript of the session.
export function scanSession(session, cache, root) {
  const found = session ? sessionFiles(session, root || projectsDirs()) : null;
  if (!found) return null;
  const files = {};
  const take = (f) => { files[f] = scanFile(cache.files[f], f); return files[f]; };
  const main = found.main ? take(found.main) : null;
  const own = found.agents.filter((f) => agentFile(basename(f)));
  const journals = new Set(own.filter((f) => f.includes('/workflows/')).map((f) => join(dirname(f), 'journal.jsonl')));
  const done = new Set([...journals].filter(existsSync).flatMap((j) => take(j).results));
  const agents = own.map((f) => ({ id: agentIdOf(f), file: f, workflow: f.includes('/workflows/') ? basename(dirname(f)) : '', meta: metaOf(f), st: take(f) }));
  cache.files = files;
  return { main, agents, done };

}
