// The run at a glance: a band above the prompt while an lpk run is open in the session's repo (its
// step, how long it worked, what waits on the owner, the team at work), the same in short on the
// status line, and /lpk-status, a pane with the whole picture. Every fact comes from
// `lpk status --json`; the mod only draws. It never blocks: hooks mark the status due and a timer
// runs the CLI, one call at a time.
import { atom, read, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import type { LpkStatus } from '../types'
import { type Host, lpkRoot, runDir, runLpk } from './lpk'

const status = atom({ plugin: 'lpk-mod', key: 'status' } as const, null)
const full = atom({ plugin: 'lpk-mod', key: 'full' } as const, null)
export const PANE = 'lpk-status'
const TICK_MS = 1000
const EVERY_MS = 3000
const MAX_ROWS = 6
const minutes = (ms: number) => `${Math.round(ms / 60_000)}m`

// What the timer keeps between ticks; a reload of the module starts it over.
let busy = false
let due = true
let last = 0
// The session invoked /lpk; until `lpk run start` writes run.json only the CLI can tell it is open.
let invoked = false
// The repo's run directory for the session's directory, asked of git once per directory.
let dirOf: { cwd: string; dir: string | undefined } = { cwd: '', dir: undefined }

async function refresh($: Host, options: PluginOptions): Promise<void> {
  const now = await $.clock.now()
  if (busy || (!due && now - last < EVERY_MS)) return
  busy = true
  due = false
  last = now
  try {
    const cwd = await $.session.cwd()
    if (dirOf.cwd !== cwd) dirOf = { cwd, dir: await runDir($, cwd) }
    const dir = dirOf.dir
    const files = dir ? (await $.fs.exists(`${dir}/run.json`)) || (await $.fs.exists(`${dir}/brief.md`)) : false
    if (!files && !invoked) return await clear($)
    const root = await lpkRoot($, options)
    if (!root) return await clear($)
    const pane = (await $.ui.panes()).some((p) => p.id === PANE)
    const args = ['status', '--json', '--session', await $.session.id(), '--repo', cwd, ...(pane ? ['--gates'] : [])]
    const r = await runLpk($, root, args, { cwd, timeoutMs: 20_000 })
    const s = JSON.parse(r.stdout) as LpkStatus
    if (!s.open) {
      if (!files) invoked = false
      return await clear($)
    }
    await update($, status, () => s)
    if (pane) await update($, full, () => s)
    $.ui.status(s.view.line)
  } catch (err) {
    $.ui.log(`lpk status skipped: ${String(err)}`, { to: 'debug' })
  } finally {
    busy = false
  }
}

async function clear($: Host): Promise<void> {
  if ((await read($, status)) === null && (await read($, full)) === null) return
  await update($, status, () => null)
  await update($, full, () => null)
  $.ui.status(undefined)
}

// A new agent may move the run: the next tick reads it at once (register.ts's agent.spawn hook).
export function markDue(): void {
  due = true
}

// Called from the session's start: registers /lpk-status and starts the timer.
export async function startStatus($: Host, options: PluginOptions): Promise<void> {
  await $.command.register({ name: PANE, description: "Show the lpk run's steps, slices, gates, team and findings in a pane" })
  $.clock.every(TICK_MS, () => void refresh($, options))
}

export function registerStatus(on: On): void {
  // A tool call may move the run: the next tick reads it at once.
  on('tool.call', async ($, e, next) => {
    due = true
    if (e.tool === 'Skill' && /^(lpk:)?lpk$/.test(String((e as { skill?: unknown }).skill ?? ''))) invoked = true
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    if (/^\/(lpk:)?lpk(\s|$)/.test(e.text)) invoked = true
    due = true
    return next(e)
  })

  on('command.run', { command: PANE }, async ($) => {
    due = true
    await $.ui.open({ id: PANE, title: 'lpk run' })
    return { text: 'The lpk run pane is open.' }
  }).catch(() => ({ text: '/lpk-status could not open its pane.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, status)
    if (e.props.hasSurvey || !s?.open) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const v = s.view
    const rows = v.rows.slice(0, MAX_ROWS)
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {v.track.map((step, i) => (
            <Text>
              {i ? <Text dimColor> › </Text> : null}
              {step.state === 'current' ? <Text bold>{step.name}</Text> : <Text dimColor={step.state === 'visited'}>{step.name}</Text>}
            </Text>
          ))}
          {v.quiet ? <Text>{`  ${v.quiet}`}</Text> : null}
          {v.waits ? <Text color="warning">{`  waits on you: ${v.waits}`}</Text> : null}
          <Text dimColor>{`  ${v.head}`}</Text>
        </Text>
        {v.detail ? <Text dimColor wrap="truncate-end">{v.detail}</Text> : null}
        {rows.map((r) => (
          <Text wrap="truncate-end">
            {`  ${r.title}`}
            <Text dimColor>{`  ${[r.what, r.note, r.elapsed].filter(Boolean).join('  ')}`}</Text>
          </Text>
        ))}
        {v.rows.length > MAX_ROWS ? <Text dimColor>{`  +${v.rows.length - MAX_ROWS} more`}</Text> : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = (await read($, full)) ?? (await read($, status))
    if (!s?.open) return <Text dimColor>No lpk run is open in this session's repo.</Text>
    const f = s.findings
    return (
      <Box flexDirection="column">
        <Text bold>{s.view.track.map((t) => t.name).join(' › ')}</Text>
        <Text dimColor>{`went through: ${s.phasesVisited.join(', ')} · ${s.view.head}`}</Text>
        {s.view.waits ? <Text color="warning">{`waits on you: ${s.waits.map((w) => `${w.what} (${w.why})`).join('; ')}`}</Text> : null}
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
        <Text dimColor>{`  ${f.total ?? 0} raised · ${f.open ?? 0} open · ${f.confirmed ?? 0} confirmed · ${f.fixed ?? 0} fixed · ${f.dropped ?? 0} dropped · ${f.unsettled ?? 0} unsettled · ${f.needsOwner ?? 0} need you`}</Text>
      </Box>
    )
  })
}
