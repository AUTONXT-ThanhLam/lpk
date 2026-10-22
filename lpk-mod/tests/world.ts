// The host beneath the mod in a test: files, commands, agents and quota windows, answered from
// memory, and every command line the mod ran, kept in order.
import type { AgentInfo, On, ProcessRunResult, SessionRateLimit } from 'claude-code'

export type World = {
  files: Record<string, string>
  written: Record<string, string>
  ran: string[][]
  toasts: string[]
  agents: AgentInfo[]
  rateLimits: SessionRateLimit[]
  config: { key: string; value: number }[]
  reply: (argv: readonly string[]) => Partial<ProcessRunResult> | undefined
}

export const CWD = '/repo'
export const LPK = '/opt/lpk'

export function world(on: On, w: Partial<World> = {}): World {
  const state: World = {
    files: {},
    written: {},
    ran: [],
    toasts: [],
    agents: [],
    rateLimits: [],
    config: [],
    reply: () => undefined,
    ...w,
  }
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => ({ value: 'session-1' }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 21, 12) }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/owner' : undefined }))
  on('fs.exists', (_, e) => ({ value: e.path in state.files }))
  on('fs.read', (_, e) => {
    const text = state.files[e.path]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    state.written[e.path] = e.text
    return { value: undefined }
  })
  on('agent.list', () => ({ value: state.agents }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { percent: 10 }, rateLimits: state.rateLimits } as never }))
  on('config.list', () => ({ value: state.config as never }))
  on('ui.toast', (_, e) => {
    state.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    state.ran.push([...e.argv])
    const r = state.reply(e.argv) ?? {}
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r } }
  })
  return state
}

// An installed lpk at LPK, found through installed_plugins.json as a session finds it.
export function installedLpk(files: Record<string, string> = {}): Record<string, string> {
  return {
    '/home/owner/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { 'lpk@lpk-dev': [{ installPath: LPK }] } }),
    [`${LPK}/bin/lpk`]: '',
    ...files,
  }
}

export const git = (argv: readonly string[]) =>
  argv[0] === 'git' && argv.includes('--git-common-dir')
    ? { stdout: argv.includes('--git-dir') ? `${CWD}/.git\n${CWD}/.git\n` : `${CWD}/.git\n` }
    : argv[0] === 'git' && argv.includes('--show-toplevel')
      ? { stdout: `${CWD}\n` }
      : undefined

export const PRESENT = { isFullscreen: false, columns: 100 }
