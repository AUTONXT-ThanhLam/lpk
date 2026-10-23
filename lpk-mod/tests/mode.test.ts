import type { AgentSpawnInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { PRESENT, world } from './world'

const OWNER = { kind: 'composer' } as const
const ROUTED = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:18766', LPK_ROUTER_URL: 'http://127.0.0.1:18766' }
const MODE = '/home/owner/.config/lpk/deepseek.mode'
const STATUS = '* cc1 work     5-hour  97% (resets 14:00)  weekly  60%\n  cc2 home     5-hour   3% (resets 15:00)  weekly  10%\n'
const SPAWN: AgentSpawnInput = {
  tool_use_id: 'toolu_1',
  prompt: 'build',
  description: 'build the slice',
  subagentType: 'lpk:builder',
  provider: { plugin: 'engine', tier: 'core' } as never,
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
}

function modelsSpawnedWith(on: Parameters<typeof world>[0]) {
  const seen: Record<string, string | undefined> = {}
  on('agent.spawn', (_, e) => {
    seen[e.subagentType] = e.model
    return { model: e.model ?? 'claude-sonnet-5-5', agentId: 'a1' }
  })
  return seen
}

const ccStatus = (a: readonly string[]) => (a[0] === 'cc-switch' && a[1] === 'status' ? { stdout: STATUS } : undefined)

test('ccd moves the builder and the reviewers to DeepSeek and leaves the other roles on Claude', async ($, on) => {
  const w = world(on, { env: ROUTED, reply: ccStatus })
  const seen = modelsSpawnedWith(on)
  const r = await $.command.run({ command: 'lpk-switch', args: 'ccd', origin: OWNER, presentation: PRESENT })
  expect(r.text).toContain('DeepSeek roles are on')
  expect(w.statuses.at(-1)).toBe('lpk cc1 · ccd (builder and reviewers on DeepSeek)')
  expect(w.written[MODE]).toBe('on\n')
  for (const role of ['builder', 'bug-hunter', 'verifier', 'env']) await $.agent.spawn({ ...SPAWN, subagentType: `lpk:${role}` })
  for (const role of ['techlead', 'architect']) await $.agent.spawn({ ...SPAWN, subagentType: `lpk:${role}` })
  expect(seen).toMatchObject({
    'lpk:builder': 'deepseek-flash',
    'lpk:bug-hunter': 'deepseek-flash',
    'lpk:verifier': 'deepseek-flash',
    'lpk:env': 'deepseek-flash',
  })
  expect(seen['lpk:techlead']).toBeUndefined()
  expect(seen['lpk:architect']).toBeUndefined()
})

test('moving to an account puts the roles back on Claude and says so', async ($, on) => {
  const w = world(on, { env: ROUTED, files: { [MODE]: 'on\n' }, reply: ccStatus })
  const seen = modelsSpawnedWith(on)
  const r = await $.command.run({ command: 'lpk-switch', args: 'cc1', origin: OWNER, presentation: PRESENT })
  await $.agent.spawn(SPAWN)
  expect(w.written[MODE]).toBe('off\n')
  expect(r.text).toContain('DeepSeek roles are off')
  expect(w.statuses.at(-1)).toBe('lpk cc1 · Claude only')
  expect(seen['lpk:builder']).toBeUndefined()
})

test('ccd in a session that does not go through the router changes nothing and says how to start one', async ($, on) => {
  const w = world(on, { reply: ccStatus })
  const seen = modelsSpawnedWith(on)
  const r = await $.command.run({ command: 'lpk-switch', args: 'ccd', origin: OWNER, presentation: PRESENT })
  await $.agent.spawn(SPAWN)
  expect(r.text).toContain('claude-routed')
  expect(w.written[MODE]).toBeUndefined()
  expect(seen['lpk:builder']).toBeUndefined()
})

test('a stale ccd file does not move agents in a session that is not routed', async ($, on) => {
  world(on, { files: { [MODE]: 'on\n' }, reply: ccStatus })
  const seen = modelsSpawnedWith(on)
  await $.agent.spawn(SPAWN)
  expect(seen['lpk:builder']).toBeUndefined()
})

test('in a routed session an account switch is one cc-switch: no state card, no restart', async ($, on) => {
  const w = world(on, {
    env: ROUTED,
    reply: (a) => ccStatus(a) ?? (a[0] === 'cc-switch' ? { stdout: 'Now on cc2 (home). In a running session: /exit, then claude -c.\n' } : undefined),
  })
  const r = await $.command.run({ command: 'lpk-switch', args: 'cc2', origin: OWNER, presentation: PRESENT })
  expect(w.ran).toEqual([['cc-switch', 'status'], ['cc-switch']])
  expect(Object.keys(w.written)).toEqual([])
  expect(r.text).toContain('no restart')
  expect(r.text).not.toContain('claude -c')
})

test('a session behind another local proxy is not a routed session', async ($, on) => {
  const w = world(on, { env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4141' }, reply: ccStatus })
  const seen = modelsSpawnedWith(on)
  const r = await $.command.run({ command: 'lpk-switch', args: 'ccd', origin: OWNER, presentation: PRESENT })
  await $.agent.spawn(SPAWN)
  expect(r.text).toContain('claude-routed')
  expect(w.written[MODE]).toBeUndefined()
  expect(seen['lpk:builder']).toBeUndefined()
})

test('a routed session shows its account and mode in the status line as it starts', async ($, on) => {
  const w = world(on, { env: ROUTED, files: { [MODE]: 'on\n' }, reply: ccStatus })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(w.statuses.at(-1)).toBe('lpk cc1 · ccd (builder and reviewers on DeepSeek)')
})
