// The hint before a fan-out: when a new agent starts beside others while available memory is under
// the floor, or while a rate-limit window has less left than the quota floor, the owner gets a
// toast and the agent that spawned it a note. It never refuses a spawn: lpk decides what to do.
import type { AgentSpawnInput, PluginOptions } from 'claude-code'

import type { Host } from './lpk'

const ACTIVE = new Set(['pending', 'running', 'waiting'])
// Workflow agents are not in `$.agent.list()`, so the ones started lately count as running.
const WORKFLOW_WINDOW_MS = 10 * 60_000
// One hint of a kind per burst: a fan-out of fourteen agents draws one line, not fourteen.
const QUIET_MS = 2 * 60_000

export type Floors = { memoryGb: number; quotaPercent: number }

// lpk's own userConfig fields win, so the owner sets a floor in one place; the mod's are the fallback.
export async function floors($: Host, options: PluginOptions): Promise<Floors> {
  const pick = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  let memoryGb = pick(options.memoryFloorGb, 6)
  let quotaPercent = pick(options.quotaFloorPercent, 15)
  try {
    for (const row of await $.config.list()) {
      if (row.key === 'lpk.memoryFloorGb') memoryGb = pick(row.value, memoryGb)
      if (row.key === 'lpk.quotaFloorPercent') quotaPercent = pick(row.value, quotaPercent)
    }
  } catch {
    /* the menu cannot be read here: the mod's own values stand */
  }
  return { memoryGb, quotaPercent }
}

// MemAvailable from /proc/meminfo, in GB; undefined where the file is not there (not Linux).
export async function availableGb($: Host): Promise<number | undefined> {
  try {
    const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(String(await $.fs.read('/proc/meminfo')))
    return m ? Number(m[1]) / 1024 / 1024 : undefined
  } catch {
    return undefined
  }
}

// What the hint remembers between spawns: workflow starts it counted and when it last spoke.
export type HintMemory = { workflowStarts: number[]; lastSaid: Record<string, number> }

export async function spawnHint($: Host, e: AgentSpawnInput, options: PluginOptions, memory: HintMemory, offClaude = false): Promise<void> {
  const { workflowStarts, lastSaid } = memory
  if (e.resume) return
  const now = await $.clock.now()
  if (e.workflow) workflowStarts.push(now)
  while (workflowStarts.length && now - (workflowStarts[0] ?? now) > WORKFLOW_WINDOW_MS) workflowStarts.shift()

  const listed = (await $.agent.list()).filter((a) => ACTIVE.has(a.status)).length
  // This agent, the listed ones still at work, and the workflow agents started before it.
  const fanOut = 1 + listed + Math.max(0, workflowStarts.length - (e.workflow ? 1 : 0))
  const floor = await floors($, options)
  const lines: { kind: string; text: string }[] = []

  const gb = await availableGb($)
  if (gb !== undefined && gb < floor.memoryGb && fanOut > 1)
    lines.push({
      kind: 'memory',
      text: `lpk: ${fanOut} agents at once with ${gb.toFixed(1)} GB of memory available (floor ${floor.memoryGb} GB). Run the parts that build, test or start apps one at a time (\`lpk slot -- <cmd>\`); reading agents may go on.`,
    })

  for (const w of offClaude ? [] : (await $.session.usage()).rateLimits) {
    const left = Math.max(0, 100 - w.percentUsed)
    if (left < floor.quotaPercent)
      lines.push({
        kind: `quota:${w.kind}`,
        text: `lpk: the ${w.kind.replace('_', '-')} quota has ${left.toFixed(0)}% left (floor ${floor.quotaPercent}%)${w.resetsAt ? `, resetting at ${w.resetsAt}` : ''}; ${fanOut} agents now may stop mid-run. /lpk-switch moves the run to the other account.`,
      })
  }

  for (const { kind, text } of lines) {
    if (now - (lastSaid[kind] ?? -Infinity) < QUIET_MS) continue
    lastSaid[kind] = now
    $.ui.toast(text)
    await $.session
      .append({
        message: { type: 'user', content: [{ type: 'text', text }] },
        ...(e.parentAgentId ? { agentId: e.parentAgentId } : {}),
      })
      .catch(() => undefined)
  }
}
