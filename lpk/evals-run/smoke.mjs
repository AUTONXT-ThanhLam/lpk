import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const smokePrompt = 'Call the Workflow tool once, with a script that starts one agent asked to reply with the single word done. The workflow runs in the background: wait for its task notification, then reply with the result it reports.';

export const smokeFixture = 'set -euo pipefail; git init -q -b main .; git config user.name fixture; git config user.email fixture@example.com; echo smoke > README.md; git add -A; git commit -q -m smoke';

function jsonl(dir, deep) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: deep }).filter((d) => d.isFile() && d.name.endsWith('.jsonl')).map((d) => join(d.parentPath, d.name));
}

const sessions = (projects) => readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => jsonl(join(projects, d.name), false));

export function mentionsHidden(projects, hiddenReal, names) {
  const marks = [`${hiddenReal}${sep}`, ...names];
  return jsonl(projects, true).some((f) => { const text = readFileSync(f, 'utf8'); return marks.some((m) => text.includes(m)); });
}

const text = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text : '')).join('\n') : '');
const notifications = (entry) => (entry.type === 'user' ? text(entry.message?.content).match(/<task-notification>[\s\S]*?<\/task-notification>/g) || [] : []);
const workflowCalls = (entry) => (entry.type === 'assistant' && Array.isArray(entry.message?.content) ? entry.message.content.filter((c) => c.type === 'tool_use' && c.name === 'Workflow').map((c) => c.id) : []);

function passes(file) {
  const entries = readFileSync(file, 'utf8').split('\n').flatMap((l) => { try { const e = JSON.parse(l); return e && typeof e === 'object' ? [e] : []; } catch { return []; } });
  const last = entries.findLastIndex((e) => e.type === 'assistant');
  return entries.some((e, i) => workflowCalls(e).some((id) => entries.slice(i + 1, last).some((later) => notifications(later).some((n) => n.includes(`<tool-use-id>${id}</tool-use-id>`) && n.includes('<status>completed</status>')))));
}

export const smokeVerdict = (projects) => (existsSync(projects) && sessions(projects).some(passes) ? 'pass' : 'fail');
