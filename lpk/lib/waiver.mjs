// The owner's waiver: one AskUserQuestion the session asks with `metadata.source: "lpk:waive"`, each
// option labelled with the id of what it releases (`gate:commit`, `connector:createJiraIssue`,
// `git:reset --hard`). The PostToolUse hook records each option the owner picked as a
// waiver record of the run; what the owner did not pick, and a dialog that closed on its own while
// the owner was away, records nothing.
import { top } from './git.mjs';
import { records } from './hooks.mjs';
import { leadMay, WAIVE_SOURCE } from './records.mjs';
import { endedRuns, sessionRuns } from './run.mjs';
import { CONNECTOR_WRITES, GIT_TRIPS } from './safety.mjs';

export { leadMay, WAIVE_SOURCE };

export const GATES = ['verify', 'findings', 'reviews', 'scenarios', 'requirements', 'ci', 'learn', 'tests-first', 'design', 'error', 'brief-check', 'commit', 'pre', 'stamp'];
const GIT_IDS = GIT_TRIPS.map((t) => `git:${t.id}`);
const CONNECTOR_IDS = CONNECTOR_WRITES.map((t) => `connector:${t}`);
export function isWaiverId(s) {
  const id = String(s ?? '');
  if (id.startsWith('gate:')) return GATES.includes(id.slice(5));
  if (id.startsWith('git:')) return GIT_IDS.includes(id);
  if (id.startsWith('connector:')) return CONNECTOR_IDS.includes(id);
  return /^pr:https?:\/\/\S+$/.test(id);
}
export const ID_FORMS = `\`gate:<name>\` (<name> one of ${GATES.join(', ')}), \`${GIT_IDS.join('\`, \`')}\`, \`connector:<tool>\` (<tool> one of ${CONNECTOR_WRITES.join(', ')}) or \`pr:<url>\``;

// The way out a deny names: the lead's command for a gate, the owner's waiver question for the rest.
export const waiverHow = (id) => (leadMay(id)
  ? `When no agent can fix it, the lead waives it, without asking the owner: \`lpk waive ${id} --why "<what stays unproved, and why going on is right>"\`.`
  : `Only the owner releases it: ask with AskUserQuestion, \`metadata: { source: "${WAIVE_SOURCE}" }\`, an option labelled exactly \`${id}\`; their pick is recorded and this check lets it through.`);

// The labels the owner picked, per question. A multi-select answer comes back comma-joined, and a
// label may itself hold a comma, so each offered label is looked for as one whole item of the answer.
export function picks(toolInput, toolResponse) {
  if (toolInput?.metadata?.source !== WAIVE_SOURCE || !toolResponse || toolResponse.afkTimeoutMs) return [];
  const answers = toolResponse.answers ?? toolInput.answers ?? {};
  return (toolInput.questions ?? []).flatMap((q) => {
    const a = answers[q.question];
    if (typeof a !== 'string' || !a.trim()) return [];
    const items = `,${a.split(',').map((s) => s.trim()).join(',')},`;
    return (q.options ?? []).map((o) => o.label).filter((l) => l && items.includes(`,${l.split(',').map((s) => s.trim()).join(',')},`))
      .map((what) => ({ question: q.question, what }));
  });
}

// The run a waiver belongs to: the one in the repo the call runs in, else the session's only run,
// else the newest run this session ended in that repo, whose gates stay on its branches.
export function waiverRun(input) {
  const held = sessionRuns(input.session_id);
  const here = input.cwd ? held.find((r) => r.repo === top(input.cwd)) : null;
  if (here || held.length) return here || (held.length === 1 ? held[0] : null);
  const repo = input.cwd && top(input.cwd);
  return (repo && endedRuns(repo).find((r) => r.session === input.session_id)) || null;
}

// Records the picks against the session's run; returns how many were recorded.
export async function recordWaiver(input, run) {
  const got = picks(input.tool_input, input.tool_response).filter((p) => isWaiverId(p.what));
  if (!run || !got.length) return 0;
  const { appendRecord } = await records();
  for (const p of got) appendRecord(run.repo, { kind: 'waiver', what: p.what, question: p.question, run: run.id, session: input.session_id, exit: 0 });
  return got.length;
}

// Whether `id` is waived in this run: the owner's record, or the lead's for a gate the lead may waive.
export async function waived(run, id) {
  return Boolean(run) && (await records()).waived(run.repo, run.id, id);
}
