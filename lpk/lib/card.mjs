// The cards lpk hands the model at the start: the run card each `lpk:*` agent gets when it starts
// (SubagentStart), and the resume card the session gets after `claude -c` or a compaction
// (SessionStart). Each line is a fact read from the run's files, git or the transcripts on disk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseOf, runOf } from './hooks.mjs';
import { changeOf, loadRules, triggered } from './rules.mjs';
import { CREDENTIALS, GIT_TRIPS, READ_ONLY, REPRO } from './safety.mjs';
import { treeOf } from './run.mjs';

const SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'lpk', 'SKILL.md');
export const LEDGER_TOOLS = ['add', 'list', 'get', 'verdict', 'fixed'].map((t) => `mcp__plugin_lpk_lpk__finding_${t}`);
const RULES_SHOWN = 25;

// What an agent of this type may not touch; the first line is every lpk agent's.
function limits(type) {
  const all = `Never read the owner's tokens (${CREDENTIALS.map((c) => `\`${c}\``).join(', ')}) and never run git ${GIT_TRIPS.map((t) => `\`${t.id}\``).join(', ')}.`;
  const role = READ_ONLY.test(type) ? `You never edit a checkout; scratch files go under /tmp.${/verifier$/.test(type) ? ` Repro tests go in the repro worktrees under ${REPRO}/.` : ''}`
    : /builder$/.test(type) ? 'Edit only the files of your slice, in your own worktree: not the main checkout, not another slice\'s files.'
      : /test-author$/.test(type) ? 'Edit only tests, fixtures and e2e scripts; production code is the builders\'.'
        : /env$/.test(type) ? 'Never edit tracked files; stop only what you started.' : '';
  return [all, role].filter(Boolean).join(' ');
}

// The run card for one `lpk:*` agent, or null outside a run.
export function runCard(input) {
  const type = input.agent_type || '';
  if (!type.startsWith('lpk:')) return null;
  const { repo, run } = runOf(input, false);
  if (!run) return null;
  const base = baseOf(repo, run);
  const dir = dirname(run.marker);
  const rules = base ? triggered(loadRules(repo), changeOf(repo, base)).map((t) => t.rule.id) : [];
  const text = [
    `lpk run card for ${type}, from the run in ${repo}:`,
    `- Base: ${base ? base.slice(0, 12) : 'not resolved'}${run.reviewRange ? `; range under review: ${run.reviewRange}` : ''}.`,
    ...['brief.md', 'brief.json'].filter((f) => existsSync(join(dir, f))).map((f) => `- Design Brief: ${join(dir, f)}`),
    rules.length ? `- Rules that apply to the change so far (\`lpk rules --id <id>\` prints one): ${rules.slice(0, RULES_SHOWN).join(', ')}${rules.length > RULES_SHOWN ? `, and ${rules.length - RULES_SHOWN} more (\`lpk rules\`)` : ''}.` : '- No rule applies to the change so far.',
    `- ${limits(type)}`,
    `- The findings ledger tools are deferred: load them before the first call with ToolSearch, query \`select:${LEDGER_TOOLS.join(',')}\`.`,
  ].join('\n');
  return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: text } };
}

// The session's newest workflow run, from the files Claude Code keeps beside the transcript: its id,
// name, status, and the agents that finished and that did not.
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
export async function resumeCard(input) {
  const { repo, run } = runOf(input, false);
  if (!run) return null;
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
    `Checks: ${(run.verify ?? []).map((c) => `\`${c}\``).join(', ')}. Last \`lpk verify\`: ${last}.`,
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
