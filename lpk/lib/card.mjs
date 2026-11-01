// The cards lpk hands the model at the start: the run card each `lpk:*` agent gets when it starts
// (SubagentStart), and the resume card the session gets when its host carries it on — after a restart
// or a compaction (SessionStart). Each line is a fact read from the run's files, git or the
// transcripts on disk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pluginRoot } from './host.mjs';
import { baseOf, runOf } from './hooks.mjs';
import { changeOf, loadRules, triggered } from './rules.mjs';
import { READ_ONLY, REPRO } from './safety.mjs';
import { top } from './git.mjs';
import { endedHere } from './reopen.mjs';
import { currentBranch, treeOf } from './run.mjs';
import { heirs } from './sessions.mjs';
import { ensureRegistered, sweepStale } from './stale-runs.mjs';

// The skill the resume card sends the model back to, in the plugin the host launched.
const SKILL = join(pluginRoot(), 'skills', 'lpk', 'SKILL.md');
export const LEDGER_TOOLS = ['add', 'list', 'get', 'verdict', 'fixed'].map((t) => `mcp__plugin_lpk_lpk__finding_${t}`);
const ledgerHint = () => `- Ledger tools are deferred; load them first with ToolSearch \`select:${LEDGER_TOOLS.join(',')}\`.`;

// What an agent of this type may not touch; the hooks refuse the credentials, the git commands and
// the container removals themselves, so the card names the rule and not each case.
function limits(type) {
  const all = "Never read the owner's tokens or run a git command the hooks refuse.";
  const role = READ_ONLY.test(type) ? `Never edit a checkout; scratch files go under /tmp${/verifier$/.test(type) ? `, repro tests under ${REPRO}/` : ''}.`
    : /(builder|designer)$/.test(type) ? 'Edit only the files of your slice, in your own worktree.'
      : /env$/.test(type) ? 'Never edit tracked files; stop only what you started.' : '';
  return [role, all].filter(Boolean).join(' ');
}

// The run card for one `lpk:*` agent, or null outside a run.
export function runCard(input) {
  const type = input.agent_type || '';
  if (!type.startsWith('lpk:')) return null;
  const { repo, run } = runOf(input, false);
  if (!run) return null;
  const base = baseOf(repo, run);
  const dir = dirname(run.marker);
  const rules = base ? triggered(loadRules(repo), changeOf(repo, base)).length : 0;
  const brief = ['brief.md', 'brief.json'].map((f) => join(dir, f)).find(existsSync);
  const text = [
    `lpk run card for ${type} (run in ${repo}):`,
    `- Base: ${base ? base.slice(0, 12) : 'not resolved'}${run.reviewRange ? `; range under review: ${run.reviewRange}` : ''}${brief ? `; Design Brief: ${brief}` : ''}.`,
    `- Rules that apply to the change so far: ${rules} (\`lpk rules\`).`,
    `- ${limits(type)}`,
    ledgerHint(),
  ].join('\n');
  return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text } };
}

// The session's newest workflow run, from the files the host keeps beside the transcript: its id,
// name, status, and the agents that finished and that did not. Workflows are Claude Code's; a session
// that ran none reads as null, which the card says out loud.
export function lastWorkflow(transcriptPath) {
  const dir = transcriptPath ? join(transcriptPath.replace(/\.jsonl$/, ''), 'workflows') : '';
  if (!dir || !existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /^wf_.*\.json$/.test(f)).map((f) => join(dir, f));
  if (!files.length) return null;
  const file = files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const wf = JSON.parse(readFileSync(file, 'utf8'));
  const agents = (wf.workflowProgress ?? []).filter((p) => p.type === 'workflow_agent');
  return { id: wf.runId, name: wf.workflowName, status: wf.status, done: agents.filter((a) => a.state === 'done').map((a) => a.label), notDone: agents.filter((a) => a.state !== 'done').map((a) => `${a.label} (${a.state})`) };
}

// Open findings of the ledger: those no verifier ruled on, and confirmed ones not yet fixed.
async function openFindings(repo) {
  const { readLedger } = await import('./findings.mjs');
  return readLedger(repo).findings.filter((f) => ['open', 'confirmed', 'unsettled'].includes(f.state));
}

// Apps `lpk spawn` started for this run that still run.
async function liveApps(repo) {
  const { records, alive } = await import('./spawn.mjs');
  return records(repo).filter(alive);
}

const said = async (what, fn) => { try { return await fn(); } catch (e) { return `${what} could not be read: ${String(e.message || e).split('\n')[0]}`; } };

// The resume card, or null outside a run.
function idleCard(input) {
  const repo = top(input.cwd || '.');
  if (!repo) return null;
  const left = heirs(input.session_id, repo);
  const ended = endedHere(repo);
  const lines = [
    ...(left.length ? [`lpk: ${left.length} open run${left.length > 1 ? 's' : ''} here lost the session that held ${left.length > 1 ? 'them' : 'it'}: ${left.map((r) => `${r.id} (${r.lane} lane, branch ${r.branch || 'none noted'}, in ${r.repo})`).join('; ')}. If the owner's request continues one, ask them once which (AskUserQuestion, one option per run), then run \`lpk run take --repo <dir>\` yourself; do not ask them to type it.`] : []),
    ...(ended ? [`lpk: ${currentBranch(repo)} was delivered by run ${ended.id} (${ended.lane} lane, ended ${ended.ended}${ended.abandon ? `, abandoned: ${ended.abandon}` : ''}). Its gates still act when this branch is pushed or handed over. If the owner's request continues the work on this branch, run \`lpk run take\` yourself: the run reopens with its scenarios, findings and the owner's waivers, and \`lpk gates\` shows where it stands. For a different change, \`lpk run start\`.`] : []),
  ];
  return lines.length ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') } } : null;
}

export async function resumeCard(input) {
  sweepStale();
  ensureRegistered(input);
  const { repo, run } = runOf(input, false);
  if (!run) return idleCard(input);
  const v = run.verified;
  const now = treeOf(repo).tree;
  const base = baseOf(repo, run);
  const brief = join(dirname(run.marker), 'brief.md');
  const last = !v ? 'never ran' : `${v.green ? 'green' : 'RED'} on ${v.tree === now ? 'the current tree' : 'an older tree (files changed since)'}`;
  const wf = await said('the last workflow run', () => lastWorkflow(input.transcript_path));
  const open = await said('the findings ledger', () => openFindings(repo));
  const apps = await said('the apps lpk spawn started', () => liveApps(repo));
  const list = (xs, n = 12) => `${xs.slice(0, n).join(', ')}${xs.length > n ? `, and ${xs.length - n} more` : ''}`;
  const text = [
    `lpk: you are inside an lpk run in ${repo}, started ${new Date(run.started).toISOString()}, base ${base ? base.slice(0, 12) : 'not resolved'}.`,
    `Checks: ${(run.verify ?? []).map((c) => `\`${c}\``).join(', ')}.${run.verifyFinal?.length ? ` Final checks (\`lpk verify --final\`): ${run.verifyFinal.map((c) => `\`${c}\``).join(', ')}.` : ''} Last \`lpk verify\`: ${last}.`,
    ...(run.reviewRange ? [`Range under review: ${run.reviewRange}.`] : []),
    ...(existsSync(brief) ? [`Design Brief: ${brief}; read it again before going on.`] : []),
    typeof wf === 'string' ? wf : !wf ? 'No workflow run in this session.'
      : `Last workflow run: ${wf.id} (${wf.name}, ${wf.status}); finished: ${wf.done.length ? list(wf.done) : 'none'}${wf.notDone.length ? `; not finished: ${list(wf.notDone)}` : ''}.`,
    typeof open === 'string' ? open : open.length ? `Open findings (${open.length}): ${list(open.map((f) => `${f.id} ${f.state}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}`))}; \`lpk finding list\` shows them.` : 'No open finding in the ledger.',
    typeof apps === 'string' ? apps : apps.length ? `Apps still running from \`lpk spawn\`: ${list(apps.map((a) => `port ${a.port} (pid ${a.pid}, ${a.dirty ? 'uncommitted tree' : `commit ${String(a.commit).slice(0, 12)}`}): \`${a.cmd}\``))}; reuse them.` : 'No app from `lpk spawn` is running.',
    `Carry on with the lpk skill from the step you were in; re-read ${SKILL} if the summary does not say which. The gates stay on until \`lpk run end\`.`,
  ].join('\n');
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}
