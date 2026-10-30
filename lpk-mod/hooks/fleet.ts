import type { FleetMember } from '../types'
import { type Host, lpkRoot, run, runLpk } from './lpk'
import { type Line, readPr, readTail, transcriptPath } from './transcript'

export type Member = FleetMember

export type Listed = { id?: string; sessionId: string; cwd: string; kind: 'interactive' | 'background'; name?: string; status?: string; state?: string }

const STATES: Record<string, string> = { busy: 'working', running: 'working', completed: 'done' }
const state = (l: Listed) => {
  const s = l.status ?? l.state ?? 'unknown'
  return STATES[s] ?? s
}

export async function checkouts($: Host, cwd: string): Promise<string[]> {
  const r = await run($, ['git', 'worktree', 'list', '--porcelain'], { cwd })
  return r.stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9))
}

const inside = (cwd: string, dirs: readonly string[]) => dirs.some((d) => cwd === d || cwd.startsWith(`${d}/`))

export async function listed($: Host): Promise<Listed[]> {
  const r = await run($, ['claude', 'agents', '--json'], { timeoutMs: 15_000 })
  try {
    return JSON.parse(r.stdout) as Listed[]
  } catch {
    return []
  }
}

export async function repoSessions($: Host): Promise<Listed[]> {
  const dirs = await checkouts($, await $.session.cwd())
  return (await listed($)).filter((l) => inside(l.cwd, dirs))
}

async function home($: Host): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
}

export async function lastLines($: Host, l: Listed, limit: number): Promise<Line[]> {
  return readTail($, transcriptPath(await home($), l.cwd, l.sessionId), limit)
}

export async function readFleet($: Host, options: Parameters<typeof lpkRoot>[1], sessions: Listed[]): Promise<Member[]> {
  const me = await $.session.id()
  const root = await lpkRoot($, options)
  const dir = await home($)
  return Promise.all(
    sessions.map(async (l): Promise<Member> => {
      const path = transcriptPath(dir, l.cwd, l.sessionId)
      const [branch, lines, pr, step] = await Promise.all([
        run($, ['git', 'branch', '--show-current'], { cwd: l.cwd }),
        readTail($, path, 40),
        readPr($, path),
        root ? runLpk($, root, ['status', '--json', '--session', l.sessionId, '--repo', l.cwd], { cwd: l.cwd, timeoutMs: 20_000 }) : undefined,
      ])
      let phase = ''
      try {
        const s = JSON.parse(step?.stdout ?? '') as { open?: boolean; view?: { track?: { name: string; state: string }[] } }
        if (s.open) phase = s.view?.track?.find((t) => t.state === 'current')?.name ?? ''
      } catch {
       
      }
      const said = [...lines].reverse().find((x) => x.who === 'claude')?.text ?? ''
      return { id: l.sessionId, name: l.name ?? l.id ?? l.sessionId.slice(0, 8), cwd: l.cwd, kind: l.kind, state: state(l), me: l.sessionId === me, branch: branch.stdout.trim(), pr, step: phase, said }
    }),
  )
}

export function findMember(members: readonly { id: string; name: string }[], word: string): { id: string; name: string }[] {
  const w = word.toLowerCase()
  const exact = members.filter((m) => m.name.toLowerCase() === w || m.id === w)
  return exact.length ? exact : members.filter((m) => m.name.toLowerCase().startsWith(w) || m.id.startsWith(w))
}
