// /lpk-switch: move a running lpk session to the other subscription account. The session keeps
// the account it started with, so the switch is: write the state card, point cc-switch at the
// other account, and have the owner restart the same conversation with `/exit` then `claude -c`.
// The run itself lives on disk and survives the restart; the card is what the lead reads first.
import type { CommandRunInput, CommandRunResult, PluginOptions } from 'claude-code'

import { type Host, lpkRoot, run, runDir, runLpk, runStatus, words } from './lpk'

const ACTIVE = new Set(['pending', 'running', 'waiting'])

export type Account = { id: string; name: string; isActive: boolean; quota: string }

// `cc-switch status` prints one line an account: `* cc1 name   5-hour 40% ...`, `*` on the active.
export function parseAccounts(text: string): Account[] {
  const out: Account[] = []
  for (const line of text.split('\n')) {
    const m = /^([* ]) (\S+) (\S+)\s*(.*)$/.exec(line)
    if (m) out.push({ isActive: m[1] === '*', id: m[2] ?? '', name: m[3] ?? '', quota: (m[4] ?? '').trim() })
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
  const from = accounts.find((a) => a.isActive)
  const wanted = words(e.args)[0]?.toLowerCase()
  if (!from) return { text: `No account is marked active:\n${listed(accounts)}\nType /lpk-switch <account> to choose one.` }
  const to = wanted
    ? accounts.find((a) => a.id.toLowerCase() === wanted || a.name.toLowerCase() === wanted)
    : accounts[(accounts.indexOf(from) + 1) % accounts.length]
  if (!to) return { text: `no account "${wanted}". The accounts:\n${listed(accounts)}` }

  const cwd = await $.session.cwd()
  const card = await stateCard($, options, cwd, to)
  const dir = await runDir($, cwd)
  let where = 'not written to disk: this folder is not inside a git repository'
  if (dir) {
    const made = await run($, ['mkdir', '-p', dir])
    const path = `${dir}/state-card.md`
    where = made.exitCode === 0 ? await $.fs.write(path, `${card.text}\n`).then(() => path, (err: unknown) => `not written: ${String(err)}`) : `not written: ${made.stderr.trim()}`
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
  const busy = card.agents.length
    ? `\n${card.agents.length} agent(s) still at work: /exit ends them and their unfinished work is lost. Wait for their notifications first unless they are failing on quota.`
    : ''
  return {
    text: `${moved}\nState card: ${where}${busy}\nThis session keeps the account it started on until it restarts. Next: type /exit, then run \`claude -c\` in this folder.`,
    context: [`The owner is moving this session to the account ${to.id} with /lpk-switch. After the restart, agents and workflows that were running here are gone: continue their unfinished work with new agents or a new workflow, not by messaging old agent ids. The state card, read it first after the restart:\n\n${card.text}`],
  }
}
