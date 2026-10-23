import type { AgentSpawnInput, CommandRunResult, PluginOptions } from 'claude-code'

import type { Host } from './lpk'

export const DEEPSEEK_MODEL = 'deepseek-flash'

export const DEFAULT_ROLES = ['builder', 'bug-hunter', 'ocr', 'claims', 'security', 'regression', 'perf', 'mutant', 'verifier', 'prover', 'env']

export function rolesOf(options: PluginOptions): string[] {
  const named = typeof options.deepseekRoles === 'string' ? options.deepseekRoles.split(',').map((r) => r.trim()).filter(Boolean) : []
  return named.length ? named : DEFAULT_ROLES
}

async function modeFile($: Host): Promise<string> {
  return `${await $.env.get('HOME')}/.config/lpk/deepseek.mode`
}

export async function deepseekOn($: Host): Promise<boolean> {
  const file = await modeFile($)
  try {
    return (await $.fs.exists(file)) && String(await $.fs.read(file)).trim() === 'on'
  } catch {
    return false
  }
}

export async function routed($: Host): Promise<boolean> {
  const url = (await $.env.get('ANTHROPIC_BASE_URL')) ?? ''
  return url !== '' && url === (await $.env.get('LPK_ROUTER_URL'))
}

export async function roleModel($: Host, e: AgentSpawnInput, options: PluginOptions): Promise<string | undefined> {
  if (e.resume || e.isTeammate || !e.subagentType.startsWith('lpk:')) return undefined
  if (!rolesOf(options).includes(e.subagentType.slice('lpk:'.length))) return undefined
  return (await deepseekOn($)) && (await routed($)) ? DEEPSEEK_MODEL : undefined
}

export async function modeLine($: Host, options: PluginOptions): Promise<string> {
  const on = await deepseekOn($)
  const via = (await routed($)) ? 'this session is routed' : 'this session is not routed, so the roles stay on Claude'
  return on ? `DeepSeek roles: on (${rolesOf(options).join(', ')}) on ${DEEPSEEK_MODEL}; ${via}.` : `DeepSeek roles: off; ${via}.`
}

export async function setDeepseek($: Host, on: boolean, options: PluginOptions): Promise<CommandRunResult> {
  if (on && !(await routed($)))
    return { text: 'This session does not go through lpk-router, so DeepSeek roles would change nothing. Restart it with `lpk-mod/bin/claude-routed -c`; nothing was changed.' }
  await $.fs.write(await modeFile($), on ? 'on\n' : 'off\n')
  const text = on
    ? `DeepSeek roles are on: new ${rolesOf(options).join(', ')} agents run on ${DEEPSEEK_MODEL}; the others and the lead stay on Claude. Agents already running keep their model.`
    : 'DeepSeek roles are off: new agents run on Claude again. Agents already running keep their model.'
  return { text }
}
