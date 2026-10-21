// Compaction inside an lpk run: the summarizer is told what the lead cannot work without after it,
// and is handed the run's status as the CLI prints it now, so the summary carries exact facts.
// Outside a run, and for a subagent's own transcript, the owner's compaction is left as it is.
import type { PluginOptions, SessionCompactInput } from 'claude-code'

import { type Host, lpkRoot, runDir, runStatus } from './lpk'

export const KEEP = `This session is the lead of an lpk run. Keep these in the summary, each as its own list, with exact ids, paths, branches and commit hashes:
1. Decisions taken: what was decided, why, and who decided it (the owner, or the lead alone).
2. Workers: every agent and workflow started that has not reported back, with its job title, agent id or workflow run id, worktree or branch, the slice it owns and its last known state.
3. Open findings: id, file:line, the claim, the state (open, confirmed, unsettled) and who must rule on it.
4. What waits on the owner: each question asked and not yet answered, and each approval still needed (push, PR, waiver), word for word.
5. Where the run stands: the step of the lpk skill, the base, the frozen commit, and the last \`lpk verify\` result.
Leave out tool output that a command can print again; name the command instead.`

const STATUS_CAP = 4_000

export async function compactInstructions(
  $: Host,
  e: SessionCompactInput,
  options: PluginOptions,
): Promise<string | undefined> {
  if (e.agentId) return undefined
  const cwd = await $.session.cwd()
  const root = await lpkRoot($, options)
  let status = ''
  if (root) {
    const s = await runStatus($, root, cwd)
    if (!s.isRun) return undefined
    status = s.text.slice(0, STATUS_CAP)
  } else {
    // No lpk to ask: the run file's presence is the one fact left.
    const dir = await runDir($, cwd)
    if (!dir || !(await $.fs.exists(`${dir}/run.json`))) return undefined
  }
  return [
    e.instructions?.trim(),
    KEEP,
    status && `The run's status, as \`lpk run status\` printed it just now:\n${status}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
