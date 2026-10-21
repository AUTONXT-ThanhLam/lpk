// Long Bash output of an lpk agent: kept whole in a file, and shown to the agent as its head, its
// tail, the lines that match a fixed list of failure words, and the file's path. A 30k-line test log
// then costs the agent a page instead of its context.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { top } from './git.mjs';
import { outDir } from './out.mjs';

export const LIMIT = 8000;
const HEAD = 30, TAIL = 40, MATCHES = 40, WIDE = 400;
export const FAILURE_WORDS = ['FAIL', 'Error', 'error:', '✗', 'assert', 'panic', 'Traceback'];

// The trimmed view of `text` kept whole in `file`, or null when it is short enough to show as is.
export function trimText(text, file) {
  if (text.length <= LIMIT) return null;
  const lines = text.split('\n');
  const cut = (l) => (l.length > WIDE ? `${l.slice(0, WIDE)} …` : l);
  const head = lines.slice(0, HEAD), tail = lines.slice(Math.max(HEAD, lines.length - TAIL));
  const middle = lines.slice(HEAD, Math.max(HEAD, lines.length - TAIL)).map((l, i) => ({ n: HEAD + i + 1, l }));
  const hits = middle.filter(({ l }) => FAILURE_WORDS.some((w) => l.includes(w)));
  return [
    `[lpk: ${lines.length} lines, ${text.length} characters; all of it is in ${file}. Shown: the first ${head.length} lines, ${Math.min(hits.length, MATCHES)} of the ${hits.length} middle lines that hold ${FAILURE_WORDS.map((w) => `\`${w}\``).join(', ')}, and the last ${tail.length} lines. Read the file for the rest.]`,
    ...head.map(cut),
    ...(hits.length ? [`[lpk: matching lines from the middle, by line number]`, ...hits.slice(0, MATCHES).map(({ n, l }) => `${n}: ${cut(l)}`)] : []),
    ...(hits.length > MATCHES ? [`[lpk: ${hits.length - MATCHES} more matching lines in ${file}]`] : []),
    `[lpk: last ${tail.length} lines]`,
    ...tail.map(cut),
  ].join('\n');
}

// The PostToolUse answer for one Bash call of an `lpk:*` agent, or null. The tool's own result keeps
// its shape; stdout carries the view and stderr is folded into the saved file.
export function trimBash(input) {
  if (input.tool_name !== 'Bash' || !String(input.agent_type || '').startsWith('lpk:')) return null;
  const r = input.tool_response;
  if (!r || typeof r !== 'object' || typeof r.stdout !== 'string') return null;
  const all = r.stderr ? `${r.stdout}\n--- stderr ---\n${r.stderr}` : r.stdout;
  if (all.length <= LIMIT) return null;
  const file = join(outDir(top(input.cwd || '.')), `${String(input.tool_use_id || Date.now()).replace(/[^\w.-]/g, '_')}.log`);
  writeFileSync(file, all);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: { ...r, stdout: trimText(all, file), stderr: '' } } };
}
