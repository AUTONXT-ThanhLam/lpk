import type { FleetLine } from '../types'
import { type Host, run } from './lpk'

export type Line = FleetLine

const TAIL_BYTES = 200_000

export const transcriptPath = (home: string, cwd: string, id: string) => `${home}/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function toolLine(b: { name?: string; input?: Record<string, unknown> }): string {
  const input = b.input ?? {}
  const arg = input.command ?? input.file_path ?? input.pattern ?? input.description ?? Object.values(input).find((v) => typeof v === 'string')
  return `${b.name ?? 'tool'} ${typeof arg === 'string' ? oneLine(arg, 160) : ''}`.trim()
}

type Row = { type?: string; isMeta?: boolean; message?: { content?: string | { type?: string; text?: string; name?: string; input?: Record<string, unknown> }[] } }

export function parseLines(raw: string, limit: number): Line[] {
  const out: Line[] = []
  for (const text of raw.split('\n').slice(1)) {
    let row: Row
    try {
      row = JSON.parse(text) as Row
    } catch {
      continue
    }
    if ((row.type !== 'user' && row.type !== 'assistant') || row.isMeta) continue
    const content = row.message?.content
    for (const b of typeof content === 'string' ? [{ type: 'text', text: content }] : (content ?? [])) {
      if (b.type === 'text' && b.text?.trim()) {
        if (row.type === 'user' && b.text.trimStart().startsWith('<')) continue
        out.push({ who: row.type === 'user' ? 'owner' : 'claude', text: oneLine(b.text, 400) })
      } else if (b.type === 'tool_use') out.push({ who: 'tool', text: toolLine(b) })
    }
  }
  return out.slice(-limit)
}

export async function readTail($: Host, path: string, limit: number): Promise<Line[]> {
  const r = await run($, ['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: 10_000 })
  return r.exitCode === 0 ? parseLines(r.stdout, limit) : []
}

export async function readPr($: Host, path: string): Promise<string> {
  const r = await run($, ['grep', '-a', '-o', '"prUrl":"[^"]*"', path], { timeoutMs: 10_000 })
  const url = /"prUrl":"([^"]*)"/.exec(r.stdout.trim().split('\n').at(-1) ?? '')?.[1] ?? ''
  const n = /\/pull\/(\d+)$/.exec(url)?.[1]
  return n ? `#${n}` : ''
}
