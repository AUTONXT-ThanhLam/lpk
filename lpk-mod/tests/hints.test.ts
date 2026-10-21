import type { AgentSpawnInput, SessionCompactInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { LPK, installedLpk, world } from './world'

const SPAWN: AgentSpawnInput = {
  tool_use_id: 'toolu_1',
  prompt: 'review',
  description: 'review the slice',
  subagentType: 'lpk:techlead',
  provider: { plugin: 'engine', tier: 'core' } as never,
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
}
const RUNNING = { id: 'a0', description: 'build', type: 'lpk:builder', status: 'running' } as const
const meminfo = (gb: number) => ({ '/proc/meminfo': `MemTotal: 33554432 kB\nMemAvailable: ${gb * 1024 * 1024} kB\n` })

function spawned(on: Parameters<typeof world>[0]) {
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
}

test('a second agent under the memory floor warns the owner and the lead, once per burst', async ($, on) => {
  const w = world(on, { files: meminfo(4), agents: [RUNNING] })
  const rows = mock.session(on)
  spawned(on)
  await $.agent.spawn(SPAWN)
  await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_2' })
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('2 agents at once with 4.0 GB')
  expect(rows.appended().map((r) => JSON.stringify(r.message.content))).toEqual([expect.stringContaining('lpk slot')])
})

test('workflow agents count toward the fan-out though the agent list leaves them out', async ($, on) => {
  const w = world(on, { files: meminfo(4) })
  spawned(on)
  await $.agent.spawn({ ...SPAWN, workflow: { runId: 'wf_1', agentIndex: 1 } })
  expect(w.toasts).toEqual([])
  await $.agent.spawn({ ...SPAWN, workflow: { runId: 'wf_1', agentIndex: 2 } })
  expect(w.toasts[0]).toContain('2 agents at once')
})

test('enough memory, or a lone agent, draws no hint and the spawn goes on', async ($, on) => {
  const w = world(on, { files: meminfo(4) })
  spawned(on)
  expect(await $.agent.spawn(SPAWN)).toEqual({ model: 'claude-sonnet-5', agentId: 'a1' })
  w.files = { ...meminfo(12) }
  w.agents = [RUNNING]
  await $.agent.spawn(SPAWN)
  expect(w.toasts).toEqual([])
})

test('lpk\'s own memory floor wins over the mod\'s', async ($, on) => {
  const w = world(on, { files: meminfo(8), agents: [RUNNING], config: [{ key: 'lpk.memoryFloorGb', value: 10 }] })
  spawned(on)
  await $.agent.spawn(SPAWN)
  expect(w.toasts[0]).toContain('floor 10 GB')
})

test('a rate-limit window under the quota floor warns at the spawn', async ($, on) => {
  const w = world(on, { files: meminfo(30), rateLimits: [{ kind: 'five_hour', percentUsed: 92 }, { kind: 'seven_day', percentUsed: 40 }] })
  spawned(on)
  await $.agent.spawn(SPAWN)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('five-hour quota has 8% left (floor 15%)')
})

const SAID = [{ role: 'user', text: 'build it', toolUses: [] }] as unknown as SessionCompactInput['messages']
const COMPACT: SessionCompactInput = { trigger: 'auto', messages: SAID }

function compacted(on: Parameters<typeof world>[0]) {
  const seen: (string | undefined)[] = []
  on('session.compact', (_, e) => {
    seen.push(e.instructions)
    return { messages: SAID }
  })
  return seen
}

test('compaction in an lpk run keeps the run\'s state and the owner\'s own instructions', async ($, on) => {
  world(on, { files: installedLpk(), reply: (a) => (a[1] === `${LPK}/bin/lpk` ? { stdout: '{"base":"abc123"}' } : undefined) })
  const seen = compacted(on)
  await $.session.compact({ ...COMPACT, trigger: 'manual', instructions: 'keep the API notes' })
  expect(seen[0]).toContain('keep the API notes')
  expect(seen[0]).toContain('What waits on the owner')
  expect(seen[0]).toContain('{"base":"abc123"}')
})

test('compaction outside an lpk run, or of a subagent, is left as it was', async ($, on) => {
  world(on, { files: installedLpk(), reply: () => ({ stdout: 'no lpk run in this repo' }) })
  const seen = compacted(on)
  await $.session.compact(COMPACT)
  await $.session.compact({ ...COMPACT, agentId: 'a1' })
  expect(seen).toEqual([undefined, undefined])
})
