// The safety tripwires lpk's PreToolUse hook applies. Each is a match on a fixed literal list, never a
// detector: a command that reaches the same thing another way passes, and the deny says it is a
// tripwire. What decides whether a call is inside a run is the caller's; these functions read only
// the call.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { git } from './git.mjs';

export const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `lpk: ${reason}` } });
export const hint = (text) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `lpk: ${text}` } });

// Where the owner's subscription tokens live, and the command that prints one. Matched as literal
// text anywhere in the call's input, so `~/`, `$HOME/` and an absolute home all match.
export const CREDENTIALS = ['.claude/.credentials.json', '.config/lpk/accounts', 'cc-switch token'];
export function credentialTrip(input) {
  if (!/^(Bash|Read|Grep)$/.test(input.tool_name || '')) return null;
  const text = JSON.stringify(input.tool_input ?? {});
  const hit = CREDENTIALS.find((c) => text.includes(c));
  return hit ? deny(`this call names \`${hit}\`, where the owner's account tokens are. No agent reads a token; the lpk CLI hands one to the processes that need it. This is a tripwire on that literal text: if the owner asked for this, they run it themselves.`) : null;
}

// The owner's waiver is theirs alone: it comes from /lpk-waive or the waiver question, never from an
// agent running `lpk waive` or writing the run's records. A tripwire on that literal text.
export const WAIVER_TEXT = ['lpk waive', 'cmd/waive.mjs', 'records.jsonl'];
const READ_ONLY_WORDS = /^(cat|head|tail|wc|ls|grep)(\s|$)/;
export function readsOnly(command) {
  if (/[;<>`\n]|\$\(/.test(command)) return false;
  const parts = command.split(/&&|\|\||\|/).map((p) => p.trim());
  return parts.every((p) => !p.includes('&') && (/^cd\s+\S+$/.test(p) || (READ_ONLY_WORDS.test(p))));
}
export function waiverTrip(input) {
  const t = input.tool_input ?? {};
  const command = String(t.command || '');
  const hits = input.tool_name === 'Bash' ? WAIVER_TEXT.filter((c) => command.includes(c))
    : /^(Write|Edit|MultiEdit)$/.test(input.tool_name || '') && String(t.file_path || '').endsWith('/lpk/records.jsonl') ? ['records.jsonl'] : [];
  const hit = hits.length === 1 && hits[0] === 'records.jsonl' && input.tool_name === 'Bash' && readsOnly(command) ? null : hits[0];
  return hit ? deny(`this call names \`${hit}\`. A waiver is the owner's act: ask them with the waiver question, or they type /lpk-waive.`) : null;
}

// A page opened from a file in the lpk Chrome reads the local disk with the owner's browser profile.
export const BROWSER_OPEN = /^mcp__plugin_lpk_chrome-devtools__(navigate_page|new_page)$/;
export function fileUrl(input) {
  if (!BROWSER_OPEN.test(input.tool_name || '')) return null;
  return /^\s*file:/i.test(String(input.tool_input?.url ?? '')) ? deny('the lpk Chrome never opens a `file:` URL: it runs with the owner\'s signed-in profile. Serve the file over http from a local server you start, and open that.') : null;
}

// Jira and Confluence calls that change what other people read. The server's name differs per
// install (a name or an id), so the tool's own name after the last `__` is matched.
export const CONNECTOR_WRITES = ['createJiraIssue', 'editJiraIssue', 'addOrEditJiraIssueComment', 'addCommentToJiraIssue',
  'transitionJiraIssue', 'createIssueLink', 'addWorklogToJiraIssue', 'createConfluenceContent', 'updateConfluenceContent',
  'createConfluencePage', 'updateConfluencePage', 'createConfluenceFooterComment', 'createConfluenceInlineComment',
  'executeWrite', 'executeDestructive', 'addGraphContext'];
export const connectorTool = (name) => {
  const m = /^mcp__.+__([A-Za-z]+)$/.exec(name || '');
  return m && CONNECTOR_WRITES.includes(m[1]) ? m[1] : '';
};

// Git commands that discard work or skip the repo's own checks. Quoted text and here-document
// bodies are blanked first, so a commit message that mentions one does not trip it.
const bare = (cmd) => String(cmd || '').replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, '\n').replace(/"(\\.|[^"\\])*"|'[^']*'/g, '""');
const GIT = String.raw`(^|[;&|(\x60\s])git((\s+-[Cc]\s+\S+)|(\s+--?[\w-]+(=\S+)?))*\s+`;
export const GIT_TRIPS = [
  { id: 'reset --hard', re: new RegExp(`${GIT}reset\\b[^;&|\\n]*\\s--hard\\b`) },
  { id: 'clean -f', re: new RegExp(`${GIT}clean\\b[^;&|\\n]*\\s(-[a-zA-Z]*f[a-zA-Z]*|--force)\\b`) },
  { id: '--no-verify', re: new RegExp(`${GIT}[\\w-]+\\b[^;&|\\n]*\\s--no-verify\\b`) },
  { id: 'stash drop', re: new RegExp(`${GIT}stash\\s+drop\\b`) },
  { id: 'checkout -- .', re: new RegExp(`${GIT}checkout\\s+--\\s+\\.(\\s|$|[;&|)])`) },
];
export function gitTrip(input) {
  if (input.tool_name !== 'Bash') return '';
  const cmd = bare(input.tool_input?.command);
  return GIT_TRIPS.find((t) => t.re.test(cmd))?.id || '';
}

// The roles that review and never edit a checkout. The verifier writes its repro tests in the
// shared repro worktrees under ~/.cache/lpk/repro/ and nowhere else inside a checkout.
export const READ_ONLY = /^(lpk:)?(techlead|claims|verifier|design-critic|prover|mutant|ocr|regression|bug-hunter|security|perf|a11y|ui-reviewer)$/;
export const REPRO = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lpk', 'repro');
const WRITES = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

// The checkout a path is in: its top, git directory and common git directory, or null outside one.
function checkoutOf(file) {
  let dir = dirname(file);
  while (dir.length > 1 && !existsSync(dir)) dir = dirname(dir);
  const [repo, gitDir, common] = git(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], dir).trim().split('\n');
  return repo ? { repo, gitDir, common } : null;
}

// A read-only role writing inside a checkout is denied. A builder outside its own worktree is told so
// and goes on: the review reads what it did.
export function writeGuard(input) {
  const type = input.agent_type || '';
  const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!WRITES.test(input.tool_name || '') || !file) return null;
  if (/^(lpk:)?architect$/.test(type)) {
    const at = checkoutOf(file);
    if (!at || [at.gitDir, at.common].some((d) => `${file}/`.startsWith(`${d}/`))) return null;
    return deny(`${type} writes only in its own directory under the run's git directory, and ${file} is in ${at.repo}.`);
  }
  const ro = READ_ONLY.test(type);
  if (!ro && !/^(lpk:)?(builder|designer)$/.test(type)) return null;
  if (ro && /verifier$/.test(type) && `${file}/`.startsWith(`${REPRO}/`)) return null;
  const at = checkoutOf(file);
  if (!at) return null;
  if (ro) return deny(`${type} never edits a checkout, and ${file} is in ${at.repo}.${/verifier$/.test(type) ? ` Write repro tests in the repro worktree under ${REPRO}/ (\`lpk repro\` makes it).` : ''} Write scratch files under /tmp.`);
  return at.gitDir === at.common ? hint(`a builder works in its own worktree, and ${file} is in the main checkout. Unless the brief says otherwise, create one from the branch head (\`lpk run worktree <slice> HEAD --branch <branch>-<slice>\`) and write there.`) : null;
}

// An `lpk:*` agent runs on the model its role sets; a model named on the spawn is dropped so the role
// table holds. The rest of the input is passed on unchanged.
export function stripModel(input) {
  if (!/^(Agent|Task)$/.test(input.tool_name || '')) return null;
  const ti = input.tool_input ?? {};
  if (!String(ti.subagent_type || '').startsWith('lpk:') || !('model' in ti)) return null;
  const { model, ...rest } = ti;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: rest, additionalContext: `lpk: the model \`${model}\` was removed from this ${ti.subagent_type} spawn; it runs on the model its role sets.` } };
}

// Settings that send agents to another endpoint or swap the model a role asks for, so the role
// table no longer says what runs. Printed by preflight and doctor, never enforced.
export const REMAP = ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL'];
export function remapWarning(env = process.env) {
  const set = [...REMAP, ...Object.keys(env).filter((k) => /^ANTHROPIC_DEFAULT_\w+_MODEL$/.test(k)).sort()].filter((k) => env[k]);
  return set.length ? `model remap: ${set.map((k) => `${k}=${env[k]}`).join(', ')}; agents may not run on the model their role names` : '';
}
