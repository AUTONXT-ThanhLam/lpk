// /lpk-waive: the owner releases what an lpk gate or tripwire holds, with the reason, in their own
// words. Only a line typed at the prompt counts: the engine stamps that origin, and neither the
// model nor another plugin can raise it, so the record says the owner decided.
import type { CommandRunInput, CommandRunResult, PluginOptions } from 'claude-code'

import { type Host, lpkRoot, run, runLpk, runStatus, words } from './lpk'

const USAGE =
  'Usage: /lpk-waive <id>[,<id>...] --why <reason>. An id is a gate row (verify, findings, reviews, scenarios, requirements, ci) or the id a deny named (`gate:commit`, `connector:<tool>`, "git:reset --hard"). Example: /lpk-waive ci --why "the CI runner is down"'

// The gate rows lpk's delivery gate prints; a waiver of one is recorded as `gate:<row>`, the id
// the gate looks for. Every other id is recorded exactly as typed, as the deny that named it said.
const GATE_ROWS = new Set(['verify', 'findings', 'reviews', 'scenarios', 'requirements', 'ci', 'plan'])

export function parseWaive(args: string): { ids: string[]; why: string } | undefined {
  const parts = words(args)
  const at = parts.indexOf('--why')
  if (at < 0) return undefined
  const ids = parts
    .slice(0, at)
    .flatMap((p) => p.split(','))
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (GATE_ROWS.has(r) ? `gate:${r}` : r))
  const why = parts.slice(at + 1).join(' ').trim()
  return ids.length && why ? { ids: [...new Set(ids)], why } : undefined
}

export async function waive($: Host, e: CommandRunInput, options: PluginOptions): Promise<CommandRunResult> {
  if (e.origin.kind !== 'composer')
    return { text: '/lpk-waive is the owner\'s own command; only a line typed at the prompt records a waiver. Nothing was recorded.' }
  const asked = parseWaive(e.args)
  if (!asked) return { text: USAGE }
  const { ids, why } = asked
  const findings = ids.filter((id) => /^F\d+$/.test(id))
  if (findings.length)
    return { text: `${findings.join(', ')}: a finding id is not waived; the findings gate is \`/lpk-waive findings\`. Nothing was recorded.` }
  const root = await lpkRoot($, options)
  if (!root) return { text: 'lpk is not installed, or the mod\'s lpkRoot setting names no lpk; nothing was recorded.' }
  const cwd = await $.session.cwd()
  const said = [`The owner waived ${ids.join(', ')} for this lpk run by typing /lpk-waive. Reason: ${why}`]

  // lpk's own verb when it has one: it knows the ids and keeps the records.
  if (await $.fs.exists(`${root}/lib/cmd/waive.mjs`)) {
    const r = await runLpk($, root, ['waive', ...ids, '--why', why, '--via', '/lpk-waive'], { cwd })
    const out = (r.stdout + r.stderr).trim()
    return r.exitCode === 0
      ? { text: out || `Waived ${ids.join(', ')}: ${why}`, context: said }
      : { text: `lpk waive failed (exit ${r.exitCode}): ${out}` }
  }

  // Without the verb, one record per id through lpk's records library, which stamps the run's id
  // and the time: the shape the gates read (`kind: 'waiver'`, `what`).
  if (!(await $.fs.exists(`${root}/lib/records.mjs`)))
    return { text: `The lpk at ${root} keeps no waiver records (no lib/records.mjs); nothing was recorded.` }
  if (!(await runStatus($, root, cwd)).isRun) return { text: 'No lpk run in this repo, so there is nothing to waive; nothing was recorded.' }
  const top = (await run($, ['git', 'rev-parse', '--show-toplevel'], { cwd })).stdout.trim() || cwd
  const session = await $.session.id()
  const recs = ids.map((what) => ({ kind: 'waiver', what, why, by: 'owner', via: '/lpk-waive', session, exit: 0 }))
  const script = `import { appendRecord } from ${JSON.stringify(`file://${root}/lib/records.mjs`)};\nfor (const rec of JSON.parse(process.argv[2])) appendRecord(process.argv[1], rec);`
  const r = await run($, ['node', '--input-type=module', '-e', script, top, JSON.stringify(recs)], { cwd })
  if (r.exitCode !== 0) return { text: `Could not write the waiver records (exit ${r.exitCode}): ${r.stderr.trim()}` }
  return { text: `Waived ${ids.join(', ')}: ${why}\nRecorded in the run's records.jsonl through lpk's records library.`, context: said }
}
