// A run's session as its transcript records it: the owner's messages, the agent's replies, its tool
// calls and the errors they returned, each at the time Claude Code wrote it. Facts only: the status
// page shows them as they are, and the summarizer reads the same lines.
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';

// Screenshots make transcripts heavy, so the tail read is generous and redone only when the file grew.
const TAIL = 4 * 1024 * 1024;
const cache = new Map();

export const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
export const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b.type === 'text' ? b.text : '')).join(' ') : '');
const what = (i) => i.description || i.command || i.file_path || i.pattern || i.prompt || i.skill || i.url || i.query || JSON.stringify(i);

// The bytes of `transcript` from `from` up to its last full line, and where they end: a line Claude
// Code is still writing waits for the next read.
export function readFrom(transcript, from) {
  const fd = openSync(transcript, 'r');
  try {
    const size = fstatSync(fd).size;
    const start = from >= 0 ? (from <= size ? from : 0) : Math.max(0, size + from);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const whole = buf.subarray(0, buf.lastIndexOf(10) + 1);
    return { text: whole.toString('utf8'), end: start + whole.length };
  } finally { closeSync(fd); }
}

// One item per thing the main session said or did, in order. `long` sets how much of a message is
// kept.
export function items(text, long = 1500) {
  const out = [];
  for (const l of text.split('\n')) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (e.isSidechain || !e.message) continue;
    const t = Date.parse(e.timestamp) || 0;
    const c = e.message.content;
    // The owner's turn: typed (`origin` human) or from `claude -p` (no origin); not a task
    // notification, a compaction summary or text Claude Code adds.
    if (e.type === 'user' && textOf(c) && !e.isMeta && !e.isCompactSummary && (!e.origin || e.origin.kind === 'human')) {
      const s = textOf(c);
      const cmd = s.match(/<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([\s\S]*?)<\/command-args>|$)/);
      if (/^Base directory for this skill:/.test(s)) out.push({ t, who: 'skill', text: cut(s.split('\n')[0].split('/').at(-1), 60) });
      else out.push({ t, who: 'owner', text: cut(cmd ? `${cmd[1]} ${cmd[2] || ''}` : s, long) });
    } else if (e.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) {
        if (b.type === 'text' && b.text.trim()) out.push({ t, who: 'agent', text: String(b.text).trim().slice(0, long * 2) });
        else if (b.type === 'tool_use') out.push({ t, who: 'tool', tool: b.name, text: cut(what(b.input || {}), 240) });
      }
    } else if (e.type === 'user' && Array.isArray(c)) {
      for (const b of c.filter((x) => x.type === 'tool_result')) out.push({ t, who: b.is_error ? 'error' : 'result', text: cut(textOf(b.content), b.is_error ? 400 : 200) });
    }
  }
  return out;
}

// The last `n` things the session said or did, for the page; tool results that went fine are left
// out, errors are kept.
export function feed(transcript, n = 80) {
  if (!transcript) return [];
  try {
    const size = statSync(transcript).size;
    const c = cache.get(transcript);
    if (c?.size === size && c.n === n) return c.feed;
    const out = items(readFrom(transcript, -TAIL).text).filter((x) => x.who !== 'result').slice(-n);
    cache.set(transcript, { size, n, feed: out });
    return out;
  } catch { return []; }
}
