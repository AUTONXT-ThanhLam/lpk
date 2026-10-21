// The owner's waiver: one AskUserQuestion the session asks with `metadata.source: "lpk:waive"`, each
// option labelled with the id of what it releases (`gate:commit`, `connector:createJiraIssue`,
// `git:reset --hard`, a finding id). The PostToolUse hook records each option the owner picked as a
// waiver record of the run; what the owner did not pick, and a dialog that closed on its own while
// the owner was away, records nothing.
import { records } from './hooks.mjs';

export const WAIVE_SOURCE = 'lpk:waive';

// The way out a deny names: the exact label to put on the waiver question's option.
export const waiverHow = (id) => `The owner can release it: ask with AskUserQuestion, \`metadata: { source: "${WAIVE_SOURCE}" }\`, an option labelled exactly \`${id}\`; their pick is recorded and this check lets it through.`;

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

// Records the picks against the session's run; returns how many were recorded.
export async function recordWaiver(input, run) {
  const got = picks(input.tool_input, input.tool_response);
  if (!run || !got.length) return 0;
  const { appendRecord } = await records();
  for (const p of got) appendRecord(run.repo, { kind: 'waiver', what: p.what, question: p.question, run: run.id, session: input.session_id, exit: 0 });
  return got.length;
}

// Whether the owner waived `id` in this run.
export async function waived(run, id) {
  return Boolean(run) && (await records()).waived(run.repo, run.id, id);
}
