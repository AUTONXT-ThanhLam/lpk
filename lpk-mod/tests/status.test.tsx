import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { CWD, LPK, git, installedLpk } from './world'

const BAND = {
  plugin: 'lpk-mod',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const row = (title: string, what: string, note: string) => ({ title, what, note, elapsed: '3m' })
const STATUS = {
  open: true, phase: 'build', phasesVisited: ['understand', 'design', 'build'], lane: 'full', run: { id: 'r1', lane: 'full' },
  slices: [], gates: null, findings: {}, waits: [], team: [],
  view: {
    track: [{ name: 'Understand', state: 'visited' }, { name: 'Design', state: 'visited' }, { name: 'Build', state: 'current' }, { name: 'Review', state: 'next' }],
    quiet: '', head: 'worked 18m · 1.2M tokens · full lane', detail: '● api  ◐ ui  ◐ docs',
    rows: [row('Builder', 'slice ui', 'Edit kpi.tsx'), row('Builder', 'slice docs', 'Bash npx vitest run'), row('Builder', 'slice cli', 'stalled 8m')],
    waits: '', line: 'lpk Build · 18m',
  },
}

// A session in a repo, lpk installed, `lpk status` answering `answer` while run.json is there.
function host(on: On, answer: () => unknown, run = true) {
  const files: Record<string, string> = installedLpk(run ? { [`${CWD}/.git/lpk/run.json`]: '{}' } : {})
  const state = { ran: [] as string[][], status: [] as (string | undefined)[], files, panes: [] as { id: string }[] }
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'session-1' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/owner' : undefined }))
  on('fs.exists', (_, e) => ({ value: e.path in state.files }))
  on('fs.read', (_, e) => ({ value: state.files[e.path] ?? '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: state.panes as never }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', (_, e) => { state.status.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    state.ran.push([...e.argv])
    const r = git(e.argv) ?? (e.argv[2] === 'status' ? { stdout: JSON.stringify(answer()) } : {})
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  // Beneath the mod the engine draws nothing of its own in the band.
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  return state
}

async function started($: Engine, on: On, answer: () => unknown, run = true) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 21, 12) })
  const state = host(on, answer, run)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  return { clock, state }
}

test('while a run is open the band shows the step, the time worked and one row per agent at work', async ($, on) => {
  const { state } = await started($, on, () => STATUS)
  expect(state.ran).toContainEqual(['node', `${LPK}/bin/lpk`, 'status', '--json', '--session', 'session-1', '--repo', CWD])
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /Understand › Design › Build › Review/ }))?.text).toContain('worked 18m · 1.2M tokens · full lane')
  expect(await ui.find({ type: 'Text', text: /● api {2}◐ ui {2}◐ docs/ })).toBeTruthy()
  const rows = (await ui.findAll({ type: 'Text', text: /^ {2}Builder/ })).map((t) => t.text)
  expect(rows).toEqual(['  Builder  slice ui  Edit kpi.tsx  3m', '  Builder  slice docs  Bash npx vitest run  3m', '  Builder  slice cli  stalled 8m  3m'])
  expect(await ui.find({ type: 'Text', text: /waits on you/ })).toBeUndefined()
  expect(state.status.at(-1)).toBe('lpk Build · 18m')
  await ui.unmount()
})

test('without a run the band is the engine\'s and lpk is never started', async ($, on) => {
  const { state, clock } = await started($, on, () => STATUS, false)
  await clock.advance(5000)
  expect(state.ran.some((a) => a[2] === 'status')).toBe(false)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('what waits on the owner shows as the one chip, and a long team ends in a count', async ($, on) => {
  const many = Array.from({ length: 8 }, (_, i) => row('Verifier', `F${i + 1}`, 'Bash lpk repro'))
  await started($, on, () => ({ ...STATUS, waits: [{ what: 'F2', why: 'unsettled' }], view: { ...STATUS.view, waits: 'F2', rows: many } }))
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /waits on you/ }))?.text).toMatch(/Review  waits on you: F2  worked 18m/)
  expect((await ui.findAll({ type: 'Text', text: /^ {2}Verifier/ })).length).toBe(6)
  expect((await ui.find({ type: 'Text', text: /more$/ }))?.text).toBe('  +2 more')
  await ui.unmount()
})

const PANE = {
  plugin: 'lpk-mod', component: 'Pane', requestId: 'lpk-status', surface: 'terminal',
  props: { title: 'lpk run', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('when the run ends the band, the status line and the pane\'s picture go', async ($, on) => {
  let open = true
  const { state, clock } = await started($, on, () => (open ? STATUS : { open: false }))
  state.panes = [{ id: 'lpk-status' }]
  await clock.advance(3000)
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /went through: understand, design, build/ })).toBeTruthy()
  await pane.unmount()
  open = false
  await clock.advance(3000)
  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(state.status.at(-1)).toBeUndefined()
  await ui.unmount()
  const after = await $.ui.mount(PANE)
  expect((await after.find({ type: 'Text', text: /No lpk run/ }))?.text).toBe("No lpk run is open in this session's repo.")
  await after.unmount()
})
