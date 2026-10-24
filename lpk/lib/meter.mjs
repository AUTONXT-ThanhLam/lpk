// Tokens per agent, from the transcripts Claude Code writes: the session's own, its subagents' and
// its workflow agents'. Each API message is counted once by its message id (a transcript writes one
// line per content block, each carrying the same usage). Fresh tokens = input + cache write +
// output; cache reads are counted apart.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const projectsDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
// Claude Code names a project's folder after its directory, every character but a letter or digit a dash.
export const slugOf = (dir) => dir.replace(/[^A-Za-z0-9]/g, '-');

const list = (dir) => { try { return readdirSync(dir); } catch { return []; } };
const meta = (p) => { try { return JSON.parse(readFileSync(p.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { return {}; } };

// The session's transcript and every agent transcript under it, wherever its project folder is.
export function sessionFiles(session, root = projectsDir()) {
  for (const project of list(root)) {
    const main = join(root, project, `${session}.jsonl`);
    const sub = join(root, project, session, 'subagents');
    if (!existsSync(main) && !existsSync(sub)) continue;
    const agents = list(sub).filter((n) => n.endsWith('.jsonl')).map((n) => join(sub, n));
    for (const wf of list(join(sub, 'workflows'))) for (const n of list(join(sub, 'workflows', wf))) if (n.endsWith('.jsonl')) agents.push(join(sub, 'workflows', wf, n));
    return { project: join(root, project), main: existsSync(main) ? main : null, agents };
  }
  return null;
}

// The newest session transcript of the project folder for `dir`.
export function latestSession(dir, root = projectsDir()) {
  const p = join(root, slugOf(dir));
  const files = list(p).filter((n) => n.endsWith('.jsonl')).map((n) => ({ n, t: statSync(join(p, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  return files[0]?.n.replace(/\.jsonl$/, '') || '';
}

const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

// One row per transcript: who it is and what its API messages used.
export function meter(session, root = projectsDir()) {
  const files = sessionFiles(session, root);
  if (!files) return null;
  const seen = new Set();
  const rows = [];
  for (const file of [files.main, ...files.agents].filter(Boolean)) {
    const m = file === files.main ? { agentType: 'main session' } : meta(file);
    const byId = new Map();
    let first = '', last = '', tools = 0;
    for (const d of lines(file)) {
      if (d.timestamp) { first ||= d.timestamp; last = d.timestamp; }
      const msg = d.type === 'assistant' ? d.message : null;
      if (!msg?.usage || !msg.id || msg.model === '<synthetic>') continue;
      tools += (msg.content || []).filter((c) => c.type === 'tool_use').length;
      if (seen.has(msg.id) && !byId.has(msg.id)) continue;
      const u = msg.usage, prev = byId.get(msg.id);
      const take = (k) => Math.max(u[k] || 0, prev?.[k] || 0);
      byId.set(msg.id, { input_tokens: take('input_tokens'), cache_creation_input_tokens: take('cache_creation_input_tokens'), cache_read_input_tokens: take('cache_read_input_tokens'), output_tokens: take('output_tokens'), model: msg.model });
    }
    for (const id of byId.keys()) seen.add(id);
    const sum = (k) => [...byId.values()].reduce((n, u) => n + u[k], 0);
    const peakContext = Math.max(0, ...[...byId.values()].map((u) => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens));
    const input = sum('input_tokens'), cacheWrite = sum('cache_creation_input_tokens'), cacheRead = sum('cache_read_input_tokens'), output = sum('output_tokens');
    rows.push({
      agent: m.agentType || 'agent', label: m.description || '', agentId: file === files.main ? session : (file.match(/agent-([^/]+)\.jsonl$/)?.[1] || ''),
      models: [...new Set([...byId.values()].map((u) => u.model))], messages: byId.size, toolCalls: tools, peakContext,
      input, cacheWrite, output, cacheRead, fresh: input + cacheWrite + output, first, last, file,
    });
  }
  return rows;
}

export const total = (rows) => rows.reduce((t, r) => ({ fresh: t.fresh + r.fresh, cacheRead: t.cacheRead + r.cacheRead, messages: t.messages + r.messages }), { fresh: 0, cacheRead: 0, messages: 0 });
