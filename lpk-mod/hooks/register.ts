// lpk-mod: early-access extras for lpk, never required by it. Two owner-only commands
// (/lpk-switch, /lpk-waive), a hint before a fan-out the machine or the quota cannot carry, and
// compaction instructions that keep an lpk run's state. Every hook lets the session go on when it
// fails: a broken mod costs its own extra, never the owner's turn or an agent's start.
import type { Register } from 'claude-code'

import { compactInstructions } from './compact'
import { type HintMemory, spawnHint } from './spawn-hint'
import { lpkSwitch } from './switch'
import { waive } from './waive'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lpk-switch',
      description: "Save the lpk run's state card and move to another account (then /exit and claude -c)",
      argumentHint: '[account]',
    })
    await $.command.register({
      name: 'lpk-waive',
      description: 'Waive named lpk gate rows for this run, with the reason (owner only)',
      argumentHint: '<row>[,<row>...] --why <reason>',
    })
    return next(e)
  })

  // A command that fails says so in its own output row; it never passes on to anything else.
  on('command.run', { command: 'lpk-switch' }, ($, e) => lpkSwitch($, e, options)).catch(() => ({
    text: '/lpk-switch failed before it switched; run `cc-switch` in a shell instead.',
  }))
  on('command.run', { command: 'lpk-waive' }, ($, e) => waive($, e, options)).catch(() => ({
    text: '/lpk-waive failed; nothing was recorded.',
  }))

  const memory: HintMemory = { workflowStarts: [], lastSaid: {} }
  on('agent.spawn', async ($, e, next) => {
    await spawnHint($, e, options, memory).catch((err: unknown) => $.ui.log(`spawn hint skipped: ${String(err)}`, { to: 'debug' }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const instructions = await compactInstructions($, e, options).catch(() => undefined)
    return next(instructions ? { ...e, instructions } : e)
  }).catch(($, e, next) => next(e))
}
