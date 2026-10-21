// What the PreToolUse hook on the lpk finding tools writes into a call before it runs: the repo and
// run the session works in, who raises or rules (the agent type, or `main` for the session itself),
// the agent's id and the range under review. Whatever the agent put in those fields is replaced, so
// the ledger records who called, not who the caller said it was.
import { top } from './git.mjs';
import { readRun } from './run.mjs';

export const FINDING_TOOL = /^mcp__plugin_lpk_lpk__finding_(add|list|get|verdict|fixed)$/;
const STAMPED = ['repo', 'run', 'from', 'agentId', 'at', 'by'];

// The call's input with the stamps in place, or null for a tool that is not a finding tool. Outside
// an lpk run of this session only the repo is stamped, so the server refuses to add or rule and
// says why.
export function stampFinding(input) {
  const tool = FINDING_TOOL.exec(input?.tool_name ?? '');
  if (!tool) return null;
  const out = { ...(input.tool_input ?? {}) };
  for (const k of STAMPED) delete out[k];
  const repo = input.cwd ? top(input.cwd) : '';
  if (!repo) return out;
  out.repo = repo;
  const run = readRun(repo);
  if (!run?.id || (run.session && run.session !== input.session_id)) return out;
  out.run = run.id;
  const who = input.agent_type || 'main';
  if (tool[1] === 'add') {
    out.from = who;
    if (input.agent_id) out.agentId = input.agent_id;
    if (run.reviewRange) out.at = run.reviewRange;
  }
  if (tool[1] === 'verdict' || tool[1] === 'fixed') out.by = who;
  return out;
}

// The hook's answer on stdout: the stamped input, or nothing for a tool it does not stamp.
export function stampHookOutput(input) {
  const updatedInput = stampFinding(input);
  return updatedInput ? { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } } : null;
}
