import type { CommandRunInput, CommandRunResult, PluginOptions, PromptSubmitInput } from 'claude-code'

import { findTarget, repoSessions } from './fleet'
import { openFleet } from './fleet-ui'
import { type Host, run, words } from './lpk'

const AT = /^@(\S[\s\S]*)$/
const NAME = /^[a-z0-9][a-z0-9._-]*$/i

const isOwner = (origin: { kind: string } | undefined) => origin === undefined || origin.kind === 'composer'

export async function sendAt($: Host, e: PromptSubmitInput): Promise<string | undefined> {
  const m = AT.exec(e.text.trim())
  if (!m || e.command || e.isMeta || !isOwner(e.origin)) return undefined
  const sessions = await repoSessions($)
  const me = await $.session.id()
  const found = findTarget(sessions.filter((s) => s.sessionId !== me).map((s) => ({ id: s.sessionId, name: s.name ?? s.sessionId.slice(0, 8) })), m[1] ?? '')
  if (!found.length) return undefined
  const names = [...new Set(found.map((x) => x.member.id))].map((id) => found.find((x) => x.member.id === id)!.member.name)
  if (names.length > 1) return `"@${m[1]?.split(/\s+/)[0]}" names ${names.length} sessions: ${names.join(', ')}. Nothing was sent.`
  const { member, body } = found[0]!
  const sent = await $.session.send({ to: { sessionId: member.id }, text: `Message from the owner, sent from the repo's main session: ${body}` })
  return sent.isDelivered ? `Sent to ${member.name}.` : `Not delivered to ${member.name}: ${sent.reason}`
}

async function baseRef($: Host, cwd: string): Promise<string> {
  const head = await run($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd })
  const ref = head.exitCode === 0 ? head.stdout.trim() : 'origin/main'
  await run($, ['git', 'fetch', '-q', 'origin', ref.replace(/^origin\//, '')], { cwd, timeoutMs: 60_000 })
  return ref
}

export async function spawn($: Host, e: CommandRunInput, options: PluginOptions): Promise<CommandRunResult> {
  if (e.origin.kind !== 'composer') return { text: "/lpk-spawn is the owner's own command; only a line typed at the prompt starts a session. Nothing started." }
  const [name = '', ...rest] = e.args.trim().split(/\s+/)
  const task = e.args.trim().slice(name.length).trim()
  if (!NAME.test(name) || !rest.length) return { text: 'Usage: /lpk-spawn <name> <task>   (the name is a branch and folder name: letters, digits, . _ -)' }
  const cwd = await $.session.cwd()
  const first = (await run($, ['git', 'worktree', 'list', '--porcelain'], { cwd })).stdout.split('\n')[0]?.slice(9)
  if (!first) return { text: 'This folder is not inside a git repository. Nothing started.' }
  const parent = first.slice(0, first.lastIndexOf('/'))
  const dir = `${parent}/${first.slice(first.lastIndexOf('/') + 1)}-wt/${name}`
  const made = await run($, ['git', 'worktree', 'add', '--no-track', '-b', name, dir, await baseRef($, cwd)], { cwd })
  if (made.exitCode !== 0) return { text: `git worktree add failed, nothing started: ${(made.stderr || made.stdout).trim()}` }
  const extra = typeof options.spawnArgs === 'string' ? words(options.spawnArgs) : []
  const started = await run($, ['claude', '--bg', '-n', name, ...extra, '--', task], { cwd: dir, timeoutMs: 60_000 })
  if (started.exitCode !== 0) return { text: `The worktree ${dir} is ready but claude did not start: ${(started.stderr || started.stdout).trim()}` }
  await openFleet($)
  return { text: `Started ${name} in ${dir} on branch ${name}. ${started.stdout.trim()}` }
}
