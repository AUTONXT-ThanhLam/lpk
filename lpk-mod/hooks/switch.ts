// /lpk-switch: move a running lpk session to the other subscription account. The session keeps
// the account it started with, so the switch is: write the state card, point cc-switch at the
// other account, and have the owner restart the same conversation with `/exit` then `claude -c`.
// The run itself lives on disk and survives the restart; the card is what the lead reads first.
import type { CommandRunInput, CommandRunResult, PluginOptions } from 'claude-code'

import { type Host, lpkRoot, run, runDir, runLpk, runStatus, words } from './lpk'

const ACTIVE = new Set(['pending', 'running', 'waiting'])

export type Account = { id: string; name: string; isActive: boolean; quota: string; limited: boolean }

// `cc-switch status` prints one line an account: `* cc1 name   5-hour 40% ...`, `*` on the active.
export function parseAccounts(text: string): Account[] {
  const out: Account[] = []
  for (const line of text.split('\n')) {
    const m = /^([* ]) (\S+) (\S+)\s*(.*)$/.exec(line)
    if (m) out.push({ isActive: m[1] === '*', id: m[2] ?? '', name: m[3] ?? '', quota: (m[4] ?? '').trim(), limited: /\bLIMITED\b/.test(m[4] ?? '') })
  }
  return out
}

const listed = (accounts: Account[]) =>
  accounts.map((a) => `- ${a.id} (${a.name})${a.isActive ? ', active' : ''}: ${a.quota}`).join('\n')

// The state card: the run's status and resume card as lpk prints them, and the agents still at work.
async function stateCard($: Host, options: PluginOptions, cwd: string, to: Account) {
  const root = await lpkRoot($, options)
  const parts = [`# lpk state card\nWritten by /lpk-switch at ${new Date(await $.clock.now()).toISOString()}, moving the session to ${to.id} (${to.name}).\nRepo: ${cwd}`]
  if (root) {
    parts.push(`## lpk run status\n${(await runStatus($, root, cwd)).text || '(no output)'}`)
    const input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'resume', session_id: await $.session.id(), cwd })
    const r = await runLpk($, root, ['hook', 'start'], { cwd, stdin: input, timeoutMs: 30_000 })
    let resume = r.stdout.trim()
    try {
      resume = (JSON.parse(resume) as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? resume
    } catch {
      /* not JSON: kept as printed */
    }
    parts.push(`## Resume card\n${resume || '(lpk printed none: no run in this repo)'}`)
  } else parts.push('## lpk\nlpk is not installed, or the mod\'s lpkRoot setting names no lpk: no run status.')
  const agents = (await $.agent.list()).filter((a) => ACTIVE.has(a.status))
  parts.push(
    `## Agents still at work when the card was written\n${
      agents.length ? agents.map((a) => `- ${a.type}: ${a.description} (${a.id}, ${a.status})`).join('\n') : '- none listed'
    }\nA workflow's agents are not listed here; \`lpk run status\` and the resume card name the workflow run.`,
  )
  return { text: parts.join('\n\n'), agents }
}

export async function lpkSwitch($: Host, e: CommandRunInput, options: PluginOptions): Promise<CommandRunResult> {
  if (e.origin.kind !== 'composer')
    return { text: '/lpk-switch is the owner\'s own command; only a line typed at the prompt switches accounts. Nothing changed.' }
  const status = await run($, ['cc-switch', 'status'], { timeoutMs: 60_000 })
  const accounts = parseAccounts(status.stdout)
  if (status.exitCode !== 0 || accounts.length === 0)
    return { text: `\`cc-switch status\` did not list the accounts (exit ${status.exitCode}): ${(status.stderr || status.stdout).trim()}` }
  const ownId = ((await $.env.get('LPK_ACCOUNT')) ?? '').trim()
  const own = accounts.find((a) => a.id === ownId)
  const from = own ?? accounts.find((a) => a.isActive)
  const wanted = words(e.args)[0]?.toLowerCase()
  if (!from) return { text: `No account is marked active:\n${listed(accounts)}\nType /lpk-switch <account> to choose one.` }
  const others = [...accounts.slice(accounts.indexOf(from) + 1), ...accounts.slice(0, accounts.indexOf(from))]
  const to = wanted
    ? accounts.find((a) => a.id.toLowerCase() === wanted || a.name.toLowerCase() === wanted)
    : others.find((a) => !a.limited)
  if (wanted && !to) return { text: `no account "${wanted}". The accounts:\n${listed(accounts)}` }
  if (!to && !others.length) return { text: `Only one account exists (${from.id}, ${from.name}), so there is nowhere to move this session. Nothing changed.\n${listed(accounts)}` }
  if (!to) return { text: `Every other account is at its limit, so there is nowhere to move this session:\n${listed(accounts)}\nNothing changed.` }
  if (own && to.id === own.id) return { text: `This session already runs on ${own.id} (${own.name}). Nothing changed.\n${listed(accounts)}` }

  const cwd = await $.session.cwd()
  const card = await stateCard($, options, cwd, to)
  const dir = await runDir($, cwd)
  let where = 'not written to disk: this folder is not inside a git repository'
  let cardPath = ''
  if (dir) {
    const made = await run($, ['mkdir', '-p', dir])
    const path = `${dir}/state-card-${await $.session.id()}.md`
    if (made.exitCode === 0) await run($, ['find', dir, '-maxdepth', '1', '-name', 'state-card-*.md', '-mtime', '+7', '-delete'])
    where = made.exitCode === 0 ? await $.fs.write(path, `${card.text}\n`).then(() => path, (err: unknown) => `not written: ${String(err)}`) : `not written: ${made.stderr.trim()}`
    if (where === path) cardPath = path
  }

  const swappable = card.agents.length === 0 && Boolean(await $.env.get('CC_SWAP_LAUNCHER')) && Boolean(await $.env.get('CC_SWAP_REQUEST'))
  if (swappable) {
    const started = await run($, ['setsid', '-f', 'bash', '-c', 'sleep 3; exec cc-switch swap "$1"', '_', to.id], { env: { CLAUDE_CODE_SESSION_ID: await $.session.id(), CC_SWAP_CARD: cardPath } })
    if (started.exitCode !== 0) return { text: `Could not start the restart (exit ${started.exitCode}): ${started.stderr.trim()}\nState card: ${where}` }
    return {
      text: `Moving this session to ${to.id} (${to.name}); claude restarts on the same conversation in a few seconds.\nState card: ${where}${to.limited ? `\n${to.id} is at its limit: the next turn there stops on quota.` : ''}`,
      context: [`The owner moved this session to the account ${to.id} with /lpk-switch and claude restarts on it. Agents and workflows that were running here are gone: continue their unfinished work with new agents or a new workflow, not by messaging old agent ids. The state card, read it first after the restart:\n\n${card.text}`],
    }
  }

  let moved = `cc-switch already points at ${to.id} (${to.name}); nothing was switched.`
  if (!to.isActive) {
    const flip = await run($, ['cc-switch', to.id], { timeoutMs: 90_000 })
    if (flip.exitCode !== 0 || !flip.stdout.includes(`Now on ${to.id}`))
      return { text: `cc-switch did not move to ${to.id} (exit ${flip.exitCode}):\n${(flip.stdout + flip.stderr).trim()}\nState card: ${where}` }
    // cc-switch's first line says where it moved; its account lines are redrawn as a list.
    const after = parseAccounts(flip.stdout)
    moved = `${flip.stdout.split('\n')[0]?.trim()}${after.length ? `\n${listed(after)}` : ''}`
  }
  const ownLine = own ? `This session runs on ${own.id} (${own.name}). ` : `This session's own account is not known (it was not started through \`claude\` with LPK_ACCOUNT), so ${from.id} is the one cc-switch had active. `
  if (to.limited) moved += `\n${to.id} (${to.name}) is at its limit: the next claude start there stops on quota.`
  const busy = card.agents.length
    ? `\n${card.agents.length} agent(s) still at work: /exit ends them and their unfinished work is lost. Wait for their notifications first unless they are failing on quota.`
    : ''
  return {
    text: `${ownLine}${moved}\nState card: ${where}${busy}\nThis session keeps the account it started on until it restarts. Next: type /exit, then run \`claude -c\` in this folder.`,
    context: [`The owner is moving this session to the account ${to.id} with /lpk-switch. After the restart, agents and workflows that were running here are gone: continue their unfinished work with new agents or a new workflow, not by messaging old agent ids. The state card, read it first after the restart:\n\n${card.text}`],
  }
}
