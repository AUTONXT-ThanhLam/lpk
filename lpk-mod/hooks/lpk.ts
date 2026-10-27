// What every part of the mod needs from the host: where lpk is, how to run it, and where the
// repo's run directory lives. Each answer is a fact the CLI or git prints; nothing here guesses.
import type { EngineInterface, PluginOptions, ProcessRunResult } from 'claude-code'

export type Host = EngineInterface

// lpk's folder: the one the owner named in the mod's settings, else the installed lpk plugin's.
// Undefined when neither exists, and every caller then says so instead of failing.
export async function lpkRoot($: Host, options: PluginOptions): Promise<string | undefined> {
  const named = typeof options.lpkRoot === 'string' ? options.lpkRoot.trim() : ''
  if (named) return (await $.fs.exists(`${named}/bin/lpk`)) ? named : undefined
  const home = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  const list = `${home}/plugins/installed_plugins.json`
  if (!(await $.fs.exists(list))) return undefined
  try {
    const installed = JSON.parse(String(await $.fs.read(list))) as {
      plugins?: Record<string, { installPath?: string }[]>
    }
    const entry = Object.entries(installed.plugins ?? {}).find(([key]) => key.startsWith('lpk@'))
    const root = entry?.[1]?.[0]?.installPath
    return root && (await $.fs.exists(`${root}/bin/lpk`)) ? root : undefined
  } catch {
    return undefined
  }
}

export type Ran = { exitCode: number; stdout: string; stderr: string }

// Runs one lpk verb with node, never the `lpk` on PATH, which may be another version. A child
// that cannot start or outlives its timeout reads as exit 1 with the reason, so callers report it.
export async function runLpk(
  $: Host,
  root: string,
  args: readonly string[],
  init: { cwd?: string; stdin?: string; timeoutMs?: number } = {},
): Promise<Ran> {
  return run($, ['node', `${root}/bin/lpk`, ...args], init)
}

export async function run(
  $: Host,
  argv: readonly string[],
  init: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number } = {},
): Promise<Ran> {
  try {
    const r: ProcessRunResult = await $.process.run(argv, { timeoutMs: 30_000, ...init })
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
  } catch (err) {
    return { exitCode: 1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }
  }
}

// The run directory of this checkout: its own `<git-dir>/lpk`, a linked run's, else `<git-common-dir>/lpk`.
export async function runDir($: Host, cwd: string): Promise<string | undefined> {
  const r = await run($, ['git', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], { cwd })
  const [dir, common] = r.stdout.trim().split('\n')
  if (r.exitCode !== 0 || !dir || !common) return undefined
  if (dir === common || (await $.fs.exists(`${dir}/lpk`))) return `${dir}/lpk`
  const link = (await $.fs.exists(`${dir}/lpk-run`)) ? String(await $.fs.read(`${dir}/lpk-run`)).trim() : ''
  return link || `${common}/lpk`
}

// `lpk run status` as the CLI prints it, and whether it names a run.
export async function runStatus(
  $: Host,
  root: string,
  cwd: string,
): Promise<{ isRun: boolean; text: string }> {
  const r = await runLpk($, root, ['run', 'status', '--repo', cwd], { cwd, timeoutMs: 15_000 })
  const text = (r.stdout || r.stderr).trim()
  return { isRun: r.exitCode === 0 && text !== '' && !text.startsWith('no lpk run'), text }
}

// A command line split as a shell splits it: spaces part words, and quotes, anywhere in a word,
// keep spaces inside it, so `ci,"git:reset --hard"` and `--why "the CI box is down"` read whole.
export function words(line: string): string[] {
  const out: string[] = []
  let word: string | undefined
  let quote: string | undefined
  for (const c of line) {
    if (quote) {
      if (c === quote) quote = undefined
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      word ??= ''
    } else if (/\s/.test(c)) {
      if (word !== undefined) out.push(word)
      word = undefined
    } else word = (word ?? '') + c
  }
  if (word !== undefined) out.push(word)
  return out
}
