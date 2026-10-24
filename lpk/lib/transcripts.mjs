// Facts about the agents a session ran, read from the transcripts the host keeps on disk: each
// subagent's and each workflow agent's type, the range its first prompt names, and how it ended. No
// agent writes these; a gate reads them to know a lens ran. Both hosts' stores are searched, so a
// lens that ran on the other one is still seen, and each row names the store it came from.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { agentFile, agentIdOf, hostOf, sessionDirs } from './host.mjs';

// The first `<sha>..<sha>` or `<sha>`: 7 to 40 hex characters with at least one digit, so a word
// such as "defaced" is not taken for a commit.
const SHA = '(?=[a-f]*\\d)[0-9a-f]{7,40}';
const RANGE = new RegExp(`(?<![0-9a-zA-Z])(${SHA})(?:\\.\\.\\.?(${SHA}))?(?![0-9a-zA-Z])`);
const RELAY = '[Workflow harness — user request]';

// The session's directories that hold subagents, on either host: the session may have started in a
// parent of the repo or in a worktree of it, so every project folder of both stores is asked.
const lensDirs = (session) => sessionDirs(session).filter((d) => existsSync(join(d, 'subagents')));

function agentFiles(dir) {
  const sub = join(dir, 'subagents');
  const here = (d) => (existsSync(d) ? readdirSync(d).filter((n) => agentFile(n)).map((n) => join(d, n)) : []);
  const wf = join(sub, 'workflows');
  return [...here(sub), ...(existsSync(wf) ? readdirSync(wf).flatMap((w) => here(join(wf, w))) : [])];
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '');

// One agent's facts. A line cut short (the agent is still writing) is skipped.
export function lensRun(file) {
  const entries = readFileSync(file, 'utf8').split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
  let meta = {};
  try { meta = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* an agent without its meta file has no type */ }
  const firstAssistant = entries.findIndex((e) => e.type === 'assistant');
  const prompt = entries.slice(0, firstAssistant < 0 ? entries.length : firstAssistant)
    .filter((e) => e.type === 'user').map((e) => textOf(e.message?.content)).filter((t) => !t.startsWith(RELAY)).join('\n');
  const m = RANGE.exec(prompt);
  const last = entries.filter((e) => e.type === 'assistant').at(-1);
  const blocks = Array.isArray(last?.message?.content) ? last.message.content : [];
  const so = blocks.find((b) => b?.type === 'tool_use' && b.name === 'StructuredOutput');
  const ended = !last ? 'running' : last.isApiErrorMessage ? 'error' : so ? 'structured' : last.message?.stop_reason === 'end_turn' ? 'end_turn' : 'running';
  return {
    agentType: meta.agentType || '',
    // Its own id where the lines carry one; else the name of its file, which on Qoder is the type and
    // a hash rather than a bare id.
    agentId: entries.find((e) => e.agentId)?.agentId || agentIdOf(file) || basename(file).replace(/\.jsonl$/, ''),
    range: m ? (m[2] ? `${m[1]}..${m[2]}` : m[1]) : '',
    ended,
    structured: so ? so.input ?? null : null,
    at: entries.at(-1)?.timestamp || '',
    started: entries[0]?.timestamp || '',
    host: hostOf(file),
  };
}

// Every subagent and workflow agent of the session. `repo` is kept for callers; the transcripts are
// found by session id alone, in either host's store.
export function lensRuns(repo, session) {
  return lensDirs(session).flatMap((d) => agentFiles(d).map(lensRun));
}

// How many findings an agent's structured output returned: a prover's scenarios that its `results`
// do not mark PASS (each is one ledger finding, whatever else it lists), else its `findings`.
export function findingCount(structured) {
  if (!structured) return null;
  if (Array.isArray(structured.results)) return structured.results.filter((x) => x?.status !== 'PASS').length;
  return Array.isArray(structured.findings) ? structured.findings.length : 0;
}
