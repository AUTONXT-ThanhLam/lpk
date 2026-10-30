// What `lpk status --json` prints and the /lpk-status pane draws. The CLI computes every fact and
// words the band (`view`); the mod only draws.
export type TrackStep = { name: string; state: 'current' | 'visited' | 'next' }
export type BandRow = { title: string; what: string; note: string; elapsed: string }
export type TeamRow = {
  id: string; title: string; what?: string; state: 'running' | 'finished' | 'failed' | 'stopped' | 'waiting'
  reason?: string; stalledMs?: number; elapsedMs: number; action?: string
}
export type GateRow = { gate: string; holds: boolean; read: string; why: string }
export type LpkStatus = {
  open: boolean
  phase: string
  phasesVisited: string[]
  lane: string
  run: { id: string; lane: string } | null
  slices: { name: string; files: string[]; state: 'landed' | 'building' | 'waiting' }[]
  gates: { holding: number; total: number; rows: GateRow[] } | null
  findings: Record<string, number>
  waits: { what: string; why: string }[]
  team: TeamRow[]
  error?: string
  view: { track: TrackStep[]; quiet: string; head: string; detail: string; rows: BandRow[]; waits: string; line: string }
}

export type FleetMember = {
  id: string; name: string; cwd: string; kind: 'interactive' | 'background'; state: string; me: boolean
  branch: string; pr: string; step: string; said: string
}
export type FleetLine = { who: 'owner' | 'claude' | 'tool'; text: string }
export type FleetView = { members: FleetMember[]; views: Record<string, { name: string; state: string; lines: FleetLine[] }> }

declare module 'claude-code' {
  interface PluginState {
    'lpk-mod': { full: LpkStatus | null; fleet: FleetView | null }
  }
}
