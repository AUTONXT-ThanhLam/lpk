// /lpk-status: a pane with the whole picture of the lpk run in the session's repo (the steps it went
// through, the slices, the gates with what each read, the whole team, the findings). The run's band
// itself is in the status line (`lpk statusline`). Every fact comes from `lpk status --json --gates`;
// the mod only draws. It never blocks: hooks mark the pane due and a timer runs the CLI, one call at
// a time, only while the pane is open or a lpk run was seen in this session.
import { atom, read, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import type { LpkStatus } from '../types'
import { type Host, lpkRoot, runLpk } from './lpk'

const full = atom({ plugin: 'lpk-mod', key: 'full' } as const, null)
export const PANE = 'lpk-status'
const TICK_MS = 1000
const EVERY_MS = 3000
const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`

// What the timer keeps between ticks; a reload of the module starts it over.
let busy = false
let due = true
let last = 0
let armed = false

async function refresh($: Host, options: PluginOptions): Promise<void> {
  const now = await $.clock.now()
  if (busy || (!due && now - last < EVERY_MS)) return
  busy = true
  try {
    const paneOpen = (await $.ui.panes()).some((p) => p.id === PANE)
    if (!paneOpen && !armed) return
    due = false
    last = now
    const cwd = await $.session.cwd()
    const root = await lpkRoot($, options)
    if (!root) return
    const gates = paneOpen ? ['--gates'] : []
    const r = await runLpk($, root, ['status', '--json', ...gates, '--session', await $.session.id(), '--repo', cwd], { cwd, timeoutMs: 20_000 })
    const s = JSON.parse(r.stdout) as LpkStatus
    if (!s.open) armed = false
    await update($, full, () => (s.open ? s : null))
  } catch (err) {
    $.ui.log(`lpk status skipped: ${String(err)}`, { to: 'debug' })
  } finally {
    busy = false
  }
}

// A new agent may move the run: the next tick reads it at once (register.ts's agent.spawn hook).
export function markDue(): void {
  due = true
}

export function arm(): void {
  armed = true
  due = true
}

// Called from the session's start: registers /lpk-status and starts the timer.
export async function startStatus($: Host, options: PluginOptions): Promise<void> {
  await $.command.register({ name: PANE, description: "Show the lpk run's steps, slices, gates, team and findings in a pane" })
  $.clock.every(TICK_MS, () => void refresh($, options))
}

const line = (mark: string, list: string[]) => (list.length ? `${mark} ${list.join(' · ')}` : '')

export function registerStatus(on: On): void {
  on('prompt.submit', async ($, e, next) => {
    if (e.command?.name.startsWith('lpk')) arm()
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, full)
    if (!s?.open || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rows = [line('▶', s.view.doing), line('✓', s.view.done), line('→', s.view.next)].filter(Boolean)
    return (
      <Box flexDirection="column">
        {rows.map((r) => <Text wrap="truncate-end" dimColor>{r}</Text>)}
      </Box>
    )
  })

  // A tool call may move the run: the next tick reads it at once.
  on('tool.call', async ($, e, next) => {
    due = true
    return next(e)
  })

  on('command.run', { command: PANE }, async ($) => {
    due = true
    await $.ui.open({ id: PANE, title: 'lpk run' })
    return { text: 'The lpk run pane is open.' }
  }).catch(() => ({ text: '/lpk-status could not open its pane.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, full)
    if (!s?.open) return <Text dimColor>No lpk run is open in this session's repo.</Text>
    const f = s.findings
    return (
      <Box flexDirection="column">
        <Text bold>{s.view.track.map((t) => t.name).join(' › ')}</Text>
        <Text dimColor>{`went through: ${s.phasesVisited.join(', ')} · ${s.view.head}`}</Text>
        {s.view.waits ? <Text color="warning">{`waits on you: ${s.waits.map((w) => `${w.what} (${w.why})`).join('; ')}`}</Text> : null}
        <Text> </Text>
        <Text bold>Doing</Text>
        {s.view.doing.map((x) => <Text wrap="truncate-end">{`  ${x}`}</Text>)}
        <Text bold>Done</Text>
        {s.view.done.length ? s.view.done.map((x) => <Text wrap="truncate-end">{`  ${x}`}</Text>) : <Text dimColor>  nothing yet</Text>}
        <Text bold>Next</Text>
        {s.view.next.length ? s.view.next.map((x) => <Text wrap="truncate-end">{`  ${x}`}</Text>) : <Text dimColor>  nothing more</Text>}
        <Text> </Text>
        <Text bold>Slices</Text>
        {s.slices.length ? s.slices.map((x) => <Text>{`  ${x.state === 'landed' ? '●' : x.state === 'building' ? '◐' : '○'} ${x.name}  `}<Text dimColor>{x.files.join(', ')}</Text></Text>) : <Text dimColor>  one slice</Text>}
        <Text bold>Gates</Text>
        {s.gates ? s.gates.rows.map((g) => (
          <Text wrap="truncate-end">{`  ${g.holds ? 'holds' : 'DENY '} ${g.gate.padEnd(13)}`}<Text dimColor>{g.why || g.read}</Text></Text>
        )) : <Text dimColor>  reading…</Text>}
        <Text bold>Team</Text>
        {s.team.map((r) => (
          <Text wrap="truncate-end">{`  ${r.title}  `}<Text dimColor>{[r.what, r.state === 'failed' ? `failed: ${r.reason ?? ''}` : r.stalledMs ? `stalled ${minutes(r.stalledMs)}` : r.state, r.action, minutes(r.elapsedMs)].filter(Boolean).join('  ')}</Text></Text>
        ))}
        <Text bold>Findings</Text>
        <Text dimColor>{`  ${f.total ?? 0} raised · ${f.open ?? 0} open · ${f.confirmed ?? 0} confirmed · ${f.fixed ?? 0} fixed · ${f.dropped ?? 0} dropped · ${f.unsettled ?? 0} unsettled · ${f.needsOwner ?? 0} for you to read`}</Text>
      </Box>
    )
  })
}
