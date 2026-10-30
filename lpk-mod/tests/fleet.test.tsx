import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { CWD, LPK, PRESENT, git, installedLpk } from './world'

const ME = 'aaaaaaaa-0000-0000-0000-000000000001'
const OTHER = 'bbbbbbbb-0000-0000-0000-000000000002'
const WT = '/repo-wt/api'
const AGENTS = [
  { pid: 1, cwd: CWD, kind: 'interactive', sessionId: ME, name: 'main', status: 'busy' },
  { id: 'bbbbbbbb', cwd: WT, kind: 'background', sessionId: OTHER, name: 'api', state: 'blocked' },
  { id: 'dddddddd', cwd: WT, kind: 'background', sessionId: 'dddddddd-0000-0000-0000-000000000004', name: 'fix the retry', state: 'idle' },
  { pid: 3, cwd: '/elsewhere', kind: 'interactive', sessionId: 'cccccccc', name: 'other-repo', status: 'idle' },
]
const row = (type: string, content: unknown) => JSON.stringify({ type, message: { content } })
const TRANSCRIPT = ['{"half":', row('user', 'build the api'), row('assistant', [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }]), row('assistant', [{ type: 'text', text: 'Tests pass, opening the PR.' }])].join('\n')

function host(on: On, extra: (argv: readonly string[]) => Record<string, unknown> | undefined = () => undefined) {
  const state = { ran: [] as string[][], panes: [] as { id: string }[], opened: [] as string[], sent: [] as { to: unknown; text: string }[], delivered: true, filled: [] as string[] }
  const files: Record<string, string> = installedLpk()
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: ME }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/owner' : undefined }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: state.panes as never }))
  on('ui.open', (_, e) => { state.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.send', (_, e) => {
    state.sent.push({ to: e.to, text: e.text })
    return (state.delivered ? { isDelivered: true } : { isDelivered: false, reason: 'the recipient is gone' }) as never
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.read', () => ({ value: { text: '@api  please add the retry test', cursor: 0 } }))
  on('prompt.fill', (_, e) => { state.filled.push(e.text); return { isFilled: true } })
  on('process.run', (_, e) => {
    state.ran.push([...e.argv])
    const a = e.argv
    const r =
      extra(a) ??
      (a[0] === 'git' && a[1] === 'rev-parse' ? { stdout: `${e.init?.cwd === '/elsewhere' ? '/elsewhere/.git' : `${CWD}/.git`}\n` } : undefined) ??
      git(a) ??
      (a[0] === 'git' && a[1] === 'worktree' && a[2] === 'list' ? { stdout: `worktree ${CWD}\nHEAD x\n\nworktree ${WT}\nHEAD y\n` } : undefined) ??
      (a[0] === 'claude' && a[1] === 'agents' ? { stdout: JSON.stringify(AGENTS) } : undefined) ??
      (a[0] === 'git' && a[1] === 'branch' ? { stdout: 'api-branch\n' } : undefined) ??
      (a[0] === 'tail' ? { stdout: TRANSCRIPT } : undefined) ??
      (a[0] === 'grep' ? { stdout: '"prUrl":"https://github.com/o/r/pull/7"\n' } : undefined) ??
      (a[2] === 'status' ? { stdout: JSON.stringify({ open: true, view: { track: [{ name: 'Build', state: 'current' }] } }) } : {})
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  return state
}

async function started($: Engine, on: On, extra?: Parameters<typeof host>[1]) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 21, 12) })
  const state = host(on, extra)
  await $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })
  return { clock, state }
}

const paneOf = (requestId: string) =>
  ({ plugin: 'lpk-mod', component: 'Pane', requestId, surface: 'terminal', props: { title: 't', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } }) as const

const OWNER = { kind: 'composer' } as const
const submit = ($: Engine, text: string, origin: { kind: 'composer' } | { kind: 'bridge' } = OWNER) => $.prompt.submit({ text, origin } as never)

test('the sessions pane lists the sessions of this repo with branch, pull request, lpk step and last words', async ($, on) => {
  const { state, clock } = await started($, on)
  await $.command.run({ command: 'lpk-fleet', args: '', origin: OWNER, presentation: PRESENT })
  expect(state.opened).toEqual(['lpk-fleet'])
  state.panes = [{ id: 'lpk-fleet' }]
  await clock.advance(1000)
  const pane = await $.ui.mount(paneOf('lpk-fleet'))
  expect(await pane.find({ type: 'Text', text: /◐ main \(this session\)/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /api {2}blocked · api-branch · #7 · Build/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /Tests pass, opening the PR\./ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /other-repo/ })).toBeFalsy()
  await pane.unmount()
})

test('with no sessions pane open nothing is read', async ($, on) => {
  const { state, clock } = await started($, on)
  await clock.advance(10_000)
  expect(state.ran.some((a) => a[0] === 'claude' && a[1] === 'agents')).toBe(false)
})

test('/lpk-view opens a tab for one session that shows what it was asked, ran and said', async ($, on) => {
  const { state, clock } = await started($, on)
  const r = await $.command.run({ command: 'lpk-view', args: 'ap', origin: OWNER, presentation: PRESENT })
  expect(r.text).toBe('Watching api in its own tab.')
  expect(state.opened).toEqual([`fleet-view-${OTHER}`])
  state.panes = [{ id: `fleet-view-${OTHER}` }]
  await clock.advance(1000)
  const pane = await $.ui.mount(paneOf(`fleet-view-${OTHER}`))
  expect(await pane.find({ type: 'Text', text: /› build the api/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /Bash npm test/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /Tests pass, opening the PR\./ })).toBeTruthy()
  await pane.unmount()
})

test('@name text sends the owner\'s words to that session, does not start a turn here and clears the typed line', async ($, on) => {
  const { state, clock } = await started($, on)
  const r = await submit($, '@api  please add the retry test')
  expect(state.sent).toEqual([{ to: OTHER, text: "Message from the owner, sent from the repo's main session: please add the retry test" }])
  expect(r.drop).toBe('Sent to api.')
  await clock.advance(200)
  expect(state.filled).toEqual([''])
})

test('@ followed by a name with spaces sends the rest of the line', async ($, on) => {
  const { state } = await started($, on)
  const r = await submit($, '@fix the retry add the test')
  expect(state.sent).toEqual([{ to: 'dddddddd-0000-0000-0000-000000000004', text: "Message from the owner, sent from the repo's main session: add the test" }])
  expect(r.drop).toBe('Sent to fix the retry.')
})

test('an @ that names no session of this repo, or arrives from elsewhere than the owner, goes on untouched', async ($, on) => {
  const { state } = await started($, on)
  expect((await submit($, '@src/index.ts explain this')).drop).toBeUndefined()
  expect((await submit($, '@ap explain this')).drop).toBeUndefined()
  expect((await submit($, '@b explain this')).drop).toBeUndefined()
  expect((await submit($, '@api do it', { kind: 'bridge' })).drop).toBeUndefined()
  expect((await submit($, '@main talk to yourself')).drop).toBeUndefined()
  expect(state.sent).toEqual([])
})

test('a message that is not delivered says why', async ($, on) => {
  const { state } = await started($, on)
  state.delivered = false
  expect((await submit($, '@api hello')).drop).toBe('Not delivered to api: the recipient is gone')
})

test('/lpk-spawn makes a worktree and a branch off the default branch and starts a background session there', async ($, on) => {
  const { state } = await started($, on, (a) => (a[1] === 'symbolic-ref' ? { stdout: 'origin/main\n' } : a[0] === 'claude' && a[1] === '--bg' ? { stdout: 'started 1a2b3c4d' } : undefined))
  const r = await $.command.run({ command: 'lpk-spawn', args: 'ui fix the header', origin: OWNER, presentation: PRESENT })
  expect(state.ran).toContainEqual(['git', 'worktree', 'add', '--no-track', '-b', 'ui', '/repo-wt/ui', 'origin/main'])
  expect(state.ran).toContainEqual(['claude', '--bg', '-n', 'ui', '--', 'fix the header'])
  expect(r.text).toContain('Started ui in /repo-wt/ui on branch ui.')
  expect(state.opened).toEqual(['lpk-fleet'])
})

test('/lpk-spawn refuses what the owner did not type and a name that is no branch name', async ($, on) => {
  const { state } = await started($, on)
  expect((await $.command.run({ command: 'lpk-spawn', args: 'ui task', origin: { kind: 'bridge' }, presentation: PRESENT })).text).toContain("owner's own command")
  expect((await $.command.run({ command: 'lpk-spawn', args: '../x task', origin: OWNER, presentation: PRESENT })).text).toContain('Usage')
  expect(state.ran.some((a) => a[0] === 'git' && a[1] === 'worktree' && a[2] === 'add')).toBe(false)
})
