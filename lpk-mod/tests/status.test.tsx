import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { CWD, LPK, PRESENT, git, installedLpk } from './world'

const PANE = {
  plugin: 'lpk-mod', component: 'Pane', requestId: 'lpk-status', surface: 'terminal',
  props: { title: 'lpk run', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const STATUS = {
  open: true, phase: 'review', phasesVisited: ['understand', 'design', 'build', 'review'], lane: 'full', run: { id: 'r1', lane: 'full' },
  slices: [{ name: 'api', files: ['src/api.ts'], state: 'landed' }, { name: 'ui', files: ['src/kpi.tsx'], state: 'building' }],
  gates: { holding: 1, total: 2, rows: [{ gate: 'verify', holds: true, read: 'HEAD^{tree} abc', why: '' }, { gate: 'reviews', holds: false, read: 'owed lenses', why: 'techlead on a..b (has not run on it)' }] },
  findings: { total: 3, open: 1, confirmed: 1, fixed: 0, dropped: 1, unsettled: 0, needsOwner: 0 },
  waits: [], team: [{ id: 't1', title: 'Tech lead', what: 'techlead', state: 'running', elapsedMs: 180_000, action: 'Read kpi.tsx' }],
  view: { track: [{ name: 'Understand', state: 'visited' }, { name: 'Review', state: 'current' }], quiet: '', head: 'worked 18m · 1.2M tokens', detail: '', rows: [], waits: '', line: '',
    doing: ['Review: lenses 0/2', 'Tech lead · techlead · Read kpi.tsx'], done: ['steps: Understand, Design, Build', 'slices landed 1/2: api'], next: ['gate reviews: techlead on a..b (has not run on it)', 'then Fix › Prove › Deliver'] },
}

const BAND = {
  plugin: 'lpk-mod', component: 'AbovePrompt', surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

// A session in a repo, lpk installed, `lpk status` answering `answer`, the pane open or not.
function host(on: On, answer: () => unknown) {
  const state = { ran: [] as string[][], panes: [] as { id: string }[], opened: [] as string[] }
  const files: Record<string, string> = installedLpk()
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'session-1' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/owner' : undefined }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: state.panes as never }))
  on('ui.open', (_, e) => { state.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    state.ran.push([...e.argv])
    const r = git(e.argv) ?? (e.argv[2] === 'status' ? { stdout: JSON.stringify(answer()) } : {})
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  return state
}

async function started($: Engine, on: On, answer: () => unknown) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 21, 12) })
  const state = host(on, answer)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  return { clock, state }
}

test('/lpk-status opens the pane, which shows the steps, slices, gates, team and findings', async ($, on) => {
  const { state, clock } = await started($, on, () => STATUS)
  const r = await $.command.run({ command: 'lpk-status', args: '', origin: { kind: 'composer' }, presentation: PRESENT })
  expect(r.text).toBe('The lpk run pane is open.')
  expect(state.opened).toEqual(['lpk-status'])
  state.panes = [{ id: 'lpk-status' }]
  await clock.advance(1000)
  expect(state.ran).toContainEqual(['node', `${LPK}/bin/lpk`, 'status', '--json', '--gates', '--session', 'session-1', '--repo', CWD])
  const pane = await $.ui.mount(PANE)
  expect(await pane.find({ type: 'Text', text: /went through: understand, design, build, review/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /● api {2}src\/api\.ts/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /DENY  reviews {6}techlead on a\.\.b/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /Tech lead {2}techlead {2}running {2}Read kpi\.tsx {2}3m/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /3 raised · 1 open · 1 confirmed/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /slices landed 1\/2: api/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /then Fix › Prove › Deliver/ })).toBeTruthy()
  await pane.unmount()
})

test('a spawned agent starts the band above the prompt, which shows doing, done and next and goes quiet with the run', async ($, on) => {
  let open = true
  on('agent.spawn', () => ({ model: 'claude-sonnet-5', agentId: 'a1' }))
  const { state, clock } = await started($, on, () => (open ? STATUS : { open: false }))
  await clock.advance(5000)
  expect(state.ran.some((a) => a[2] === 'status')).toBe(false)
  await $.agent.spawn({ tool_use_id: 'toolu_1', prompt: 'p', description: 'Build slice ui', subagent_type: 'lpk:builder' } as never)
  await clock.advance(1000)
  const status = state.ran.find((a) => a[2] === 'status')
  expect(status).toEqual(['node', `${LPK}/bin/lpk`, 'status', '--json', '--session', 'session-1', '--repo', CWD])
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^▶ Review: lenses 0\/2 · Tech lead/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /^✓ steps: Understand, Design, Build · slices landed 1\/2: api/ })).toBeTruthy()
  expect(await band.find({ type: 'Text', text: /^→ gate reviews: .* · then Fix › Prove › Deliver/ })).toBeTruthy()
  await band.unmount()
  open = false
  await clock.advance(30_000)
  const quiet = await $.ui.mount(BAND)
  expect(await quiet.find({ type: 'Text', text: /▶/ })).toBeFalsy()
  await quiet.unmount()
  const calls = state.ran.filter((a) => a[2] === 'status').length
  await clock.advance(20_000)
  expect(state.ran.filter((a) => a[2] === 'status').length).toBe(calls)
})

test('a run that opens after /lpk was submitted still gets its band', async ($, on) => {
  let open = false
  on('prompt.submit', (_, e) => e)
  const { clock } = await started($, on, () => (open ? STATUS : { open: false }))
  await $.prompt.submit({ text: '/lpk go', command: { name: 'lpk', args: 'go' } } as never)
  await clock.advance(1000)
  open = true
  await clock.advance(10_000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^▶ Review/ })).toBeTruthy()
  await band.unmount()
})

test('with the pane closed lpk is never started', async ($, on) => {
  const { state, clock } = await started($, on, () => STATUS)
  await clock.advance(10_000)
  expect(state.ran.some((a) => a[2] === 'status')).toBe(false)
})

test('when the run ends the pane says no run is open', async ($, on) => {
  let open = true
  const { state, clock } = await started($, on, () => (open ? STATUS : { open: false }))
  state.panes = [{ id: 'lpk-status' }]
  await clock.advance(1000)
  open = false
  await clock.advance(3000)
  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ type: 'Text', text: /No lpk run/ }))?.text).toBe("No lpk run is open in this session's repo.")
  await pane.unmount()
})
