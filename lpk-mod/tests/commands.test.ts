import { expect, test } from 'claude-code/testing'

import { CWD, LPK, PRESENT, git, installedLpk, world } from './world'

const OWNER = { kind: 'composer' } as const
const STATUS = '* cc1 work     5-hour  97% (resets 14:00)  weekly  60%\n  cc2 home     5-hour   3% (resets 15:00)  weekly  10%\n'

test('a waiver typed by the owner runs lpk waive with the rows and the reason', async ($, on) => {
  const w = world(on, { files: installedLpk({ [`${LPK}/lib/cmd/waive.mjs`]: '' }), reply: (a) => (a[2] === 'waive' ? { stdout: 'waived ci, reviews' } : undefined) })
  const r = await $.command.run({ command: 'lpk-waive', args: 'ci,reviews --why "the CI runner is down"', origin: OWNER, presentation: PRESENT })
  expect(w.ran).toContainEqual(['node', `${LPK}/bin/lpk`, 'waive', 'gate:ci', 'gate:reviews', '--why', 'the CI runner is down', '--via', '/lpk-waive'])
  expect(r.text).toBe('waived ci, reviews')
  expect(r.context?.[0]).toContain('the CI runner is down')
})

test('a waiver the owner did not type records nothing', async ($, on) => {
  const w = world(on, { files: installedLpk({ [`${LPK}/lib/cmd/waive.mjs`]: '' }) })
  for (const origin of [{ kind: 'sdk' }, { kind: 'plugin', name: 'other' }, { kind: 'bridge' }] as const) {
    const r = await $.command.run({ command: 'lpk-waive', args: 'ci --why because', origin, presentation: PRESENT })
    expect(r.text).toContain('owner\'s own command')
  }
  expect(w.ran).toEqual([])
})

test('without lpk waive, one record per id goes through lpk\'s records library in the shape the gates read', async ($, on) => {
  const w = world(on, {
    files: installedLpk({ [`${LPK}/lib/records.mjs`]: '' }),
    reply: (a) => git(a) ?? (a[2] === 'run' ? { stdout: '{"base":"abc"}' } : undefined),
  })
  const r = await $.command.run({ command: 'lpk-waive', args: 'findings,"git:reset --hard" --why owner accepts it', origin: OWNER, presentation: PRESENT })
  const node = w.ran.find((a) => a[0] === 'node' && a[1] === '--input-type=module')
  expect(node?.[3]).toContain(`file://${LPK}/lib/records.mjs`)
  expect(node?.[4]).toBe(CWD)
  const rec = { kind: 'waiver', why: 'owner accepts it', by: 'owner', via: '/lpk-waive', session: 'session-1', exit: 0 }
  expect(JSON.parse(node?.[5] ?? '[]')).toEqual([{ ...rec, what: 'gate:findings' }, { ...rec, what: 'git:reset --hard' }])
  expect(r.text).toContain('Waived gate:findings, git:reset --hard: owner accepts it')
})

test('a waiver with no lpk run records nothing', async ($, on) => {
  const w = world(on, { files: installedLpk({ [`${LPK}/lib/records.mjs`]: '' }), reply: (a) => (a[2] === 'run' ? { stdout: 'no lpk run in this repo' } : undefined) })
  const r = await $.command.run({ command: 'lpk-waive', args: 'ci --why because', origin: OWNER, presentation: PRESENT })
  expect(r.text).toContain('No lpk run')
  expect(w.ran.some((a) => a[1] === '--input-type=module')).toBe(false)
})

test('a finding id is refused, since no finding waits on a waiver', async ($, on) => {
  const w = world(on, { files: installedLpk({ [`${LPK}/lib/cmd/waive.mjs`]: '' }) })
  const r = await $.command.run({ command: 'lpk-waive', args: 'ci,F3 --why ok', origin: OWNER, presentation: PRESENT })
  expect(r.text).toContain('Nothing was recorded')
  expect(w.ran).toEqual([])
})

test('a waiver with no reason is refused with the usage', async ($, on) => {
  const w = world(on, { files: installedLpk() })
  const r = await $.command.run({ command: 'lpk-waive', args: 'ci', origin: OWNER, presentation: PRESENT })
  expect(r.text).toContain('Usage: /lpk-waive')
  expect(w.ran).toEqual([])
})

test('lpk-switch writes the state card, moves cc-switch and tells the owner to /exit and claude -c', async ($, on) => {
  const w = world(on, {
    files: installedLpk(),
    agents: [{ id: 'a1', description: 'review the slice', type: 'lpk:techlead', status: 'running' }],
    reply: (a) =>
      git(a) ??
      (a[0] === 'cc-switch' && a[1] === 'status' ? { stdout: STATUS } : undefined) ??
      (a[0] === 'cc-switch' ? { stdout: 'Now on cc2 (home). In a running session: /exit, then claude -c.\n' } : undefined) ??
      (a[2] === 'run' ? { stdout: '{"base":"abc"}' } : undefined) ??
      (a[2] === 'hook' ? { stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'lpk: you are inside an lpk run' } }) } : undefined),
  })
  const r = await $.command.run({ command: 'lpk-switch', args: 'home', origin: OWNER, presentation: PRESENT })
  const card = w.written[`${CWD}/.git/lpk/state-card.md`] ?? ''
  expect(card).toContain('{"base":"abc"}')
  expect(card).toContain('lpk: you are inside an lpk run')
  expect(card).toContain('lpk:techlead: review the slice (a1, running)')
  expect(w.ran).toContainEqual(['cc-switch', 'cc2'])
  expect(r.text).toContain('Now on cc2')
  expect(r.text).toContain('/exit, then run `claude -c`')
  expect(r.text).toContain('1 agent(s) still at work')
  expect(r.context?.[0]).toContain(card.trim())
})

const UNDER_LAUNCHER = { CC_SWAP_LAUNCHER: '4242', CC_SWAP_REQUEST: '/run/user/1000/cc-swap.x' }
const swapReply = (a: readonly string[]) => git(a) ?? (a[0] === 'cc-switch' && a[1] === 'status' ? { stdout: STATUS } : undefined) ?? flippedAny(a)
const flippedAny = (a: readonly string[]) => (a[0] === 'cc-switch' ? { stdout: `Now on ${a[1]} (x).\n` } : undefined)

test('lpk-switch under the claude launcher writes the card and restarts the same conversation on the other account', async ($, on) => {
  const w = world(on, { env: UNDER_LAUNCHER, files: installedLpk(), reply: swapReply })
  const r = await $.command.run({ command: 'lpk-switch', args: 'home', origin: OWNER, presentation: PRESENT })
  expect(w.ran).toContainEqual(['setsid', '-f', 'bash', '-c', 'sleep 3; exec cc-switch swap "$1"', '_', 'cc2'])
  expect(w.ran).not.toContainEqual(['cc-switch', 'cc2'])
  expect(w.written[`${CWD}/.git/lpk/state-card.md`]).toContain('lpk state card')
  expect(r.text).toContain('restarts on the same conversation')
  expect(r.text).not.toContain('claude -c')
  expect(r.context?.[0]).toContain('lpk state card')
})

test('lpk-switch with agents still at work leaves the restart to the owner even under the launcher', async ($, on) => {
  const w = world(on, {
    env: UNDER_LAUNCHER,
    agents: [{ id: 'a1', description: 'review the slice', type: 'lpk:techlead', status: 'running' }],
    reply: swapReply,
  })
  const r = await $.command.run({ command: 'lpk-switch', args: 'home', origin: OWNER, presentation: PRESENT })
  expect(w.ran.some((a) => a[0] === 'setsid')).toBe(false)
  expect(w.ran).toContainEqual(['cc-switch', 'cc2'])
  expect(r.text).toContain('1 agent(s) still at work')
})

test('lpk-switch with no account moves to the next one after the active', async ($, on) => {
  const w = world(on, {
    reply: (a) =>
      (a[0] === 'cc-switch' && a[1] === 'status' ? { stdout: `${STATUS}  cc3 third    5-hour   0% (resets 16:00)  weekly   5%\n` } : undefined) ??
      (a[0] === 'cc-switch' ? { stdout: 'Now on cc2 (home). In a running session: /exit, then claude -c.\n' } : undefined),
  })
  const r = await $.command.run({ command: 'lpk-switch', args: '', origin: OWNER, presentation: PRESENT })
  expect(w.ran).toContainEqual(['cc-switch', 'cc2'])
  expect(r.text).toContain('Now on cc2')
})

test('lpk-switch leaves the session\'s own account when cc-switch\'s pointer was moved by another terminal', async ($, on) => {
  const w = world(on, {
    env: { LPK_ACCOUNT: 'cc2' },
    reply: (a) =>
      (a[0] === 'cc-switch' && a[1] === 'status' ? { stdout: STATUS } : undefined) ??
      (a[0] === 'cc-switch' ? { stdout: 'Now on cc1 (work).\n' } : undefined),
  })
  const r = await $.command.run({ command: 'lpk-switch', args: '', origin: OWNER, presentation: PRESENT })
  expect(w.ran).not.toContainEqual(['cc-switch', 'cc2'])
  expect(r.text).toContain('This session runs on cc2 (home)')
  expect(r.text).toContain('cc-switch already points at cc1')
  const again = await $.command.run({ command: 'lpk-switch', args: 'cc2', origin: OWNER, presentation: PRESENT })
  expect(again.text).toContain('already runs on cc2')
})

const LIMITED = '  cc2 full     5-hour   0% (resets 16:00)  weekly 100%  LIMITED\n'
const ON_CC1 = '* cc1 work     5-hour  97% (resets 14:00)  weekly  60%\n'
const flipped = (a: readonly string[]) => (a[0] === 'cc-switch' ? { stdout: `Now on ${a[1]} (x).\n` } : undefined)

test('lpk-switch with no account skips an account at its limit', async ($, on) => {
  const status = `${ON_CC1}${LIMITED}  cc3 third    5-hour   0% (resets 16:00)  weekly   5%\n`
  const w = world(on, { env: { LPK_ACCOUNT: 'cc1' }, reply: (a) => (a[1] === 'status' ? { stdout: status } : flipped(a)) })
  await $.command.run({ command: 'lpk-switch', args: '', origin: OWNER, presentation: PRESENT })
  expect(w.ran).toContainEqual(['cc-switch', 'cc3'])
})

test('lpk-switch with no account stops when every other account is at its limit', async ($, on) => {
  const w = world(on, { env: { LPK_ACCOUNT: 'cc1' }, reply: (a) => (a[1] === 'status' ? { stdout: `${ON_CC1}${LIMITED}` } : flipped(a)) })
  const r = await $.command.run({ command: 'lpk-switch', args: '', origin: OWNER, presentation: PRESENT })
  expect(w.ran).toEqual([['cc-switch', 'status']])
  expect(r.text).toContain('Every other account is at its limit')
})

test('lpk-switch with one account says there is no other account', async ($, on) => {
  const w = world(on, { env: { LPK_ACCOUNT: 'cc1' }, reply: (a) => (a[1] === 'status' ? { stdout: ON_CC1 } : flipped(a)) })
  const r = await $.command.run({ command: 'lpk-switch', args: '', origin: OWNER, presentation: PRESENT })
  expect(w.ran).toEqual([['cc-switch', 'status']])
  expect(r.text).toContain('Only one account exists')
})

test('lpk-switch to an unknown account switches nothing', async ($, on) => {
  const w = world(on, { reply: (a) => (a[0] === 'cc-switch' ? { stdout: STATUS } : undefined) })
  const r = await $.command.run({ command: 'lpk-switch', args: 'cc9', origin: OWNER, presentation: PRESENT })
  expect(r.text).toContain('no account "cc9"')
  expect(w.ran).toEqual([['cc-switch', 'status']])
})

test('lpk-switch the owner did not type changes nothing', async ($, on) => {
  const w = world(on)
  const r = await $.command.run({ command: 'lpk-switch', args: 'cc2', origin: { kind: 'sdk' }, presentation: PRESENT })
  expect(r.text).toContain('owner\'s own command')
  expect(w.ran).toEqual([])
})
