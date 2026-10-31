import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PLACEHOLDER_KEY = 'lpk-placeholder-start-claude-through-cc-switch-run';
const SHIM = fileURLToPath(new URL('../shim', import.meta.url));

export function writeAccountEnv(env = process.env) {
  if (!env.LPK_ACCOUNT || !env.CLAUDE_ENV_FILE || process.platform === 'win32') return;
  appendFileSync(env.CLAUDE_ENV_FILE, `export PATH='${SHIM.replace(/'/g, "'\\''")}':"$PATH"\n`
    + `if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then export ANTHROPIC_API_KEY=${PLACEHOLDER_KEY}; fi\n`);
}

export function launchAs(bin, args, env = process.env) {
  const session = env.LPK_ACCOUNT;
  if (!session || env.CLAUDE_CODE_OAUTH_TOKEN) return { cmd: bin, args };
  const who = spawnSync('cc-switch', ['run', 'sh', '-c', 'printf %s "$LPK_ACCOUNT"'], { encoding: 'utf8', env });
  if (who.error || who.status !== 0) {
    return { error: `this session runs as ${session} and its shell holds no token, but cc-switch did not run (${who.error?.message || who.stderr.trim()}); claude was not started, because it would use the default account` };
  }
  const active = who.stdout.trim();
  if (active !== session) {
    return { error: `this session runs as ${session} but the active account is ${active}; claude was not started, because cc-switch would hand it ${active}` };
  }
  return { cmd: 'cc-switch', args: ['run', bin, ...args] };
}
