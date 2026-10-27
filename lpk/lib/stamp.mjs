// What the PreToolUse hook on the lpk finding tools writes into a call before it runs: the repo and
// run the session works in, who raises or rules (the agent type, or `main` for the session itself),
// the agent's id and the range under review. Whatever the agent put in those fields is replaced, so
// the ledger records who called, not who the caller said it was.
import { top } from './git.mjs';
import { exitedRuns, readRun, sessionRuns } from './run.mjs';

// Both hosts name the plugin's MCP tools differently: Claude Code prefixes the plugin
// (`mcp__plugin_lpk_lpk__`), Qoder measured as `mcp__lpk__`. The hook must stamp both.
export const FINDING_TOOL = /^mcp__(?:plugin_lpk_lpk|lpk_lpk|plugin_lpk|lpk)__finding_(add|list|get|verdict|fixed)$/;
const STAMPED = ['repo', 'run', 'from', 'agentId', 'at', 'by'];

// The finding call a hook event carries: the host's own tool name, or — measured on Qoder, where
// deferred MCP tools are reached through one `mcp_call` — the tool that call names and its args.
function findingCall(input) {
  const direct = FINDING_TOOL.exec(input?.tool_name ?? '');
  if (direct) return { tool: direct[1], args: input.tool_input ?? {}, wrapped: false };
  if (input?.tool_name === 'mcp_call') {
    const inner = FINDING_TOOL.exec(String(input.tool_input?.toolName || ''));
    if (inner) return { tool: inner[1], args: input.tool_input?.arguments ?? {}, wrapped: true };
  }
  return null;
}

// The call's input with the stamps in place, or null for a tool that is not a finding tool. The run
// is the one of the repo the call runs in when this session may use it, else the one run this session
// holds wherever it is: an agent starts in the session's directory, which may hold no run (the
// superproject of the submodule the run works in) or another session's. A session holding two runs
// is never guessed between: the call must name the repo of one of them. Outside one run of this session only the repo is stamped, and the hook
// refuses to add or rule and says why.
export function stampFinding(input) {
  const call = findingCall(input);
  if (!call) return null;
  const out = { ...call.args };
  const named = out.repo;
  for (const k of STAMPED) delete out[k];
  const shape = (stamped) => (call.wrapped ? { ...input.tool_input, arguments: stamped } : stamped);
  let repo = input.cwd ? top(input.cwd) : '';
  let run = repo ? readRun(repo, input.session_id) : null;
  const mine = (r) => r?.id && (!r.session || r.session === input.session_id);
  const held = sessionRuns(input.session_id);
  const asked = named ? held.find((r) => r.repo === top(String(named))) : null;
  if (asked) run = asked;
  else if (!mine(run)) run = held.length === 1 ? held[0] : null;
  if (mine(run)) repo = run.repo || repo;
  if (!repo) return shape(out);
  out.repo = repo;
  if (!mine(run)) return shape(out);
  out.run = run.id;
  const who = input.agent_type || 'main';
  if (call.tool === 'add') {
    out.from = who;
    if (input.agent_id) out.agentId = input.agent_id;
    // A builder's own review runs before `lpk review start` records a range, and its findings must
    // still land: name what that reviewer read, the run's base to the tree being committed.
    const base = String(run.base || 'HEAD').slice(0, 12);
    out.at = run.reviewRange || `${base}..staged`;
  }
  if (call.tool === 'verdict' || call.tool === 'fixed') out.by = who;
  return shape(out);
}

// The hook's answer on stdout: the stamped input, a refusal to add or rule outside a run of this
// session, or nothing for a tool it does not stamp.
export function stampHookOutput(input) {
  const updatedInput = stampFinding(input);
  if (!updatedInput) return null;
  const call = findingCall(input);
  const inner = call.wrapped ? updatedInput.arguments : updatedInput;
  if (inner.run || !['add', 'verdict', 'fixed'].includes(call.tool)) return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } };
  const held = sessionRuns(input.session_id);
  if (held.length > 1) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `lpk: session ${input.session_id} holds ${held.length} open lpk runs: ${held.map((r) => `${r.repo} (run ${r.id})`).join(', ')}, and this call runs in ${input.cwd}, which is in none of them. Call again with \`repo\` set to the repo of the run the finding belongs to.` } };
  const exited = exitedRuns(input.session_id, inner.repo);
  const why = `lpk: session ${input.session_id || '(none)'} holds no open lpk run in ${inner.repo || input.cwd} or elsewhere, so the ledger cannot record who ${call.tool === 'add' ? 'raises' : 'rules on'} a finding.${exited.length
    ? ` Open runs whose session has exited: ${exited.map((r) => `${r.repo} (session ${r.session})`).join(', ')}. The main session continues one with \`lpk run take --repo <dir>\`; then call again.`
    : ' The main session starts one with `lpk run start`.'}`;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } };
}
