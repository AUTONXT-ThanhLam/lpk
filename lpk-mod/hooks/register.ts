// lpk-mod: early-access extras for lpk, never required by it. The lpk run pane (status.tsx), two
// owner-only commands (/lpk-switch, /lpk-waive), a hint before a fan-out the machine or the quota
// cannot carry, and compaction instructions that keep an lpk run's state. Every hook lets the
// session go on when it fails: a broken mod costs its own extra, never the owner's turn or an
// agent's start.
import type { Register } from 'claude-code'

import { compactInstructions } from './compact'
import { pinMode, roleModel } from './mode'
import { type HintMemory, spawnHint } from './spawn-hint'
import { markDue, registerStatus, startStatus } from './status'
import { lpkSwitch } from './switch'
import { waive } from './waive'

export const register: Register = (on, options) => {
  registerStatus(on)

  on('session.start', async ($, e, next) => {
    await startStatus($, options).catch((err: unknown) => $.ui.log(`lpk status band off: ${String(err)}`, { to: 'debug' }))
    await pinMode($).catch(() => undefined)
    await $.command.register({
      name: 'lpk-switch',
      description: "Move to another account at once when the session is routed, else save the lpk run's state card (then /exit and claude -c); ccd puts the builder and reviewers on DeepSeek, an account puts them back on Claude",
      argumentHint: '[cc1|cc2|ccd]',
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
    markDue()
    const model = await roleModel($, e, options).catch(() => undefined)
    await spawnHint($, e, options, memory, model !== undefined).catch((err: unknown) => $.ui.log(`spawn hint skipped: ${String(err)}`, { to: 'debug' }))
    return next(model ? { ...e, model } : e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const instructions = await compactInstructions($, e, options).catch(() => undefined)
    return next(instructions ? { ...e, instructions } : e)
  }).catch(($, e, next) => next(e))
}
