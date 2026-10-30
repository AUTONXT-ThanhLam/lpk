import { atom, read, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import type { FleetView } from '../types'
import { type Host } from './lpk'
import { findMember, lastLines, readFleet, repoSessions } from './fleet'

const fleet = atom({ plugin: 'lpk-mod', key: 'fleet' } as const, null)
export const FLEET = 'lpk-fleet'
export const VIEW = 'fleet-view-'
const TICK_MS = 1000
const EVERY_MS = 4000
const VIEW_LINES = 80

let busy = false
let due = true
let last = 0

async function refresh($: Host, options: PluginOptions): Promise<void> {
  const now = await $.clock.now()
  if (busy || (!due && now - last < EVERY_MS)) return
  busy = true
  try {
    const ids = (await $.ui.panes()).map((p) => p.id)
    const overview = ids.includes(FLEET)
    const views = ids.filter((id) => id.startsWith(VIEW))
    if (!overview && !views.length) return
    due = false
    last = now
    const sessions = await repoSessions($)
    const members = overview ? await readFleet($, options, sessions) : []
    const shown: FleetView['views'] = {}
    for (const id of views) {
      const l = sessions.find((s) => s.sessionId === id.slice(VIEW.length))
      if (l) shown[id] = { name: l.name ?? l.sessionId.slice(0, 8), state: l.status ?? l.state ?? '', lines: await lastLines($, l, VIEW_LINES) }
    }
    await update($, fleet, () => ({ members, views: shown }))
  } catch (err) {
    $.ui.log(`lpk fleet skipped: ${String(err)}`, { to: 'debug' })
  } finally {
    busy = false
  }
}

export function markFleetDue(): void {
  due = true
}

export async function openView($: Host, id: string, name: string): Promise<void> {
  due = true
  await $.ui.open({ id: `${VIEW}${id}`, title: name })
}

export async function openFleet($: Host): Promise<void> {
  due = true
  await $.ui.open({ id: FLEET, title: 'sessions' })
}

export async function startFleet($: Host, options: PluginOptions): Promise<void> {
  await $.command.register({ name: 'lpk-fleet', description: "Show the sessions working in this repo, each with its branch, pull request and lpk step" })
  await $.command.register({ name: 'lpk-view', description: "Watch one session of this repo in its own tab: what it says and runs", argumentHint: '<session>' })
  $.clock.every(TICK_MS, () => void refresh($, options))
}

const DOT: Record<string, string> = { working: '◐', waiting: '●', blocked: '▲', idle: '○', done: '✓' }

export function registerFleet(on: On): void {
  on('command.run', { command: 'lpk-fleet' }, async ($) => {
    await openFleet($)
    return { text: 'The sessions pane is open. `@name text` sends a message to one; /lpk-view name watches it.' }
  }).catch(() => ({ text: '/lpk-fleet could not open its pane.' }))

  on('command.run', { command: 'lpk-view' }, async ($, e) => {
    const word = e.args.trim()
    if (!word) return { text: 'Usage: /lpk-view <session>' }
    const found = findMember((await repoSessions($)).map((s) => ({ id: s.sessionId, name: s.name ?? s.sessionId.slice(0, 8) })), word)
    if (found.length !== 1) return { text: found.length ? `"${word}" names ${found.length} sessions: ${found.map((m) => m.name).join(', ')}.` : `No session named "${word}" works in this repo.` }
    await openView($, found[0]!.id, found[0]!.name)
    return { text: `Watching ${found[0]!.name} in its own tab.` }
  }).catch(() => ({ text: '/lpk-view could not open its pane.' }))

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== FLEET && !e.requestId.startsWith(VIEW)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, fleet)
    if (e.requestId === FLEET) {
      if (!s) return <Text dimColor>reading…</Text>
      if (!s.members.length) return <Text dimColor>No session works in this repo.</Text>
      return (
        <Box flexDirection="column">
          <Text dimColor>@name text sends a message · /lpk-view name watches · /lpk-spawn name task starts one</Text>
          {s.members.map((m) => (
            <Box flexDirection="column">
              <Text wrap="truncate-end"><Text bold>{`${DOT[m.state] ?? '·'} ${m.name}${m.me ? ' (this session)' : ''}`}</Text>{`  ${[m.state, m.branch, m.pr, m.step].filter(Boolean).join(' · ')}`}</Text>
              {m.said ? <Text dimColor wrap="truncate-end">{`   ${m.said}`}</Text> : null}
            </Box>
          ))}
        </Box>
      )
    }
    const v = s?.views[e.requestId]
    if (!v) return <Text dimColor>reading…</Text>
    const room = Math.max(1, (e.viewport?.rows ?? 30) - 3)
    return (
      <Box flexDirection="column">
        <Text bold>{`${v.name}  `}<Text dimColor>{v.state}</Text></Text>
        {v.lines.slice(-room).map((l) => (l.who === 'tool' ? <Text dimColor wrap="truncate-end">{`  ${l.text}`}</Text> : <Text bold={l.who === 'owner'}>{`${l.who === 'owner' ? '› ' : ''}${l.text}`}</Text>))}
      </Box>
    )
  })
}
