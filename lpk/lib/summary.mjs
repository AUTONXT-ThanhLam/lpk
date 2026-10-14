// The narrative of a run for the status page: what the agent is delivering, which lpk step it is
// in, what is done and what is next. Meaning, so a small model writes it from the session's
// transcript, in the background, every few tool calls and at the end of each turn.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cut, items, readFrom } from './feed.mjs';
import { promptsOf } from './run.mjs';
import { narrativeOf, ticksOf, transcriptOf } from './status.mjs';

export const EVERY = 10;
const MAX = 40000;
const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT = join(HERE, '..', 'status', 'summarize.md');
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'story', 'step', 'now', 'done', 'next', 'waiting', 'log'],
  properties: {
    headline: { type: 'string' }, story: { type: 'string' }, step: { type: 'integer', minimum: 0, maximum: 9 }, now: { type: 'string' },
    done: { type: 'array', items: { type: 'string' } }, next: { type: 'array', items: { type: 'string' } }, waiting: { type: 'string' },
    log: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'msg'], properties: { kind: { enum: ['start', 'done', 'warn', 'info'] }, msg: { type: 'string' } } } },
  },
};

// Called by the hook on every tool call of the run's session and at the end of each turn: counts
// the call, and every EVERY calls (or at the turn's end) starts the summarizer, detached, so the
// session never waits on it.
export function tick(run, transcript, final) {
  const ticks = ticksOf(run.marker);
  if (!final) appendFileSync(ticks, '.');
  if (transcript) writeFileSync(transcriptOf(run.marker), transcript);
  let n = 0;
  try { n = statSync(ticks).size; } catch { /* first call */ }
  if (!transcript || (!final && n % EVERY !== 0)) return false;
  spawn(process.execPath, [join(HERE, '..', 'bin', 'lpk'), 'status', 'summarize', '--marker', run.marker, '--transcript', transcript],
    { detached: true, stdio: 'ignore', cwd: tmpdir(), env: { ...process.env, LPK_SUMMARY: '1' } }).unref();
  return true;
}

const LINE = { owner: (x) => `OWNER: ${x.text}`, skill: (x) => `OWNER started skill ${x.text}`, agent: (x) => `AGENT: ${cut(x.text, 800)}`,
  tool: (x) => `TOOL ${x.tool}: ${x.text}`, result: (x) => `RESULT: ${x.text}`, error: (x) => `ERROR: ${x.text}` };

// The main session's turns since `from` (a byte offset), one line each, the newest MAX characters.
export function excerpt(transcript, from) {
  const { text: raw, end } = readFrom(transcript, from);
  let text = items(raw).map((x) => LINE[x.who](x)).join('\n');
  if (text.length > MAX) text = `(earlier lines omitted)\n${text.slice(-MAX)}`;
  return { text, end };
}

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

// One summarizer per run at a time. One that finds another running leaves a note and goes; the
// running one then summarizes again, so the end of a turn is never lost to a summary in flight.
// A lock older than five minutes belonged to a summarizer that died.
export function summarize(marker, transcript) {
  const lock = join(marker, '..', 'status.lock');
  const again = join(marker, '..', 'status.again');
  try { closeSync(openSync(lock, 'wx')); } catch {
    let age = 0;
    try { age = Date.now() - statSync(lock).mtimeMs; } catch { /* gone meanwhile */ }
    if (age < 300000) { writeFileSync(again, ''); return { skipped: 'another summarizer is running; it summarizes again when done' }; }
    writeFileSync(lock, '');
  }
  let r;
  try {
    do { rmSync(again, { force: true }); r = once(marker, transcript); } while (existsSync(again));
  } finally { rmSync(lock, { force: true }); }
  return existsSync(again) ? summarize(marker, transcript) : r;
}

function once(marker, transcript) {
  const prev = readJson(narrativeOf(marker));
  const { text, end } = excerpt(transcript, prev?.offset || 0);
  if (!text.trim()) return { skipped: 'nothing new in the transcript' };
  const owner = (() => { try { return readFileSync(promptsOf(marker), 'utf8').split('\n').filter(Boolean).map((l) => cut(JSON.parse(l).prompt, 600)); } catch { return []; } })();
  const input = [
    readFileSync(PROMPT, 'utf8'),
    '## The previous summary', prev ? JSON.stringify({ ...prev, log: prev.log?.slice(-8), offset: undefined }) : '(none: this is the first)',
    '## The owner\'s messages since the run started', owner.length ? owner.map((o) => `- ${o}`).join('\n') : '(none recorded)',
    '## The session since the previous summary', text,
  ].join('\n\n');
  const p = spawnSync('claude', ['-p', '--model', 'haiku', '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
    '--settings', '{"disableAllHooks":true}', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA)],
  { input, cwd: tmpdir(), encoding: 'utf8', timeout: 180000, env: { ...process.env, LPK_SUMMARY: '1' } });
  let out;
  try { out = JSON.parse(p.stdout).structured_output; } catch { /* below */ }
  if (!out) return { error: `the summarizer gave no summary (exit ${p.status}): ${cut(p.stderr || p.stdout, 300)}` };
  const at = Date.now();
  const next = { ...out, log: [...(prev?.log || []), ...out.log.map((x) => ({ ...x, t: at }))].slice(-80), offset: end, updated: at };
  const file = narrativeOf(marker);
  writeFileSync(`${file}.${process.pid}`, JSON.stringify(next));
  renameSync(`${file}.${process.pid}`, file);
  return { summary: next };
}
