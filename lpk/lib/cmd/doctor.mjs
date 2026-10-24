// `lpk doctor`: what this machine and Claude Code's settings give an lpk run: the preflight facts
// of `lpk run start`, a model remap set in a settings file's `env` (the shell's own is in the
// preflight), the auto-compact window, and the outside tools lpk's verbs call.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, repoOf } from '../out.mjs';
import { preflight } from '../preflight.mjs';
import { readRun } from '../run.mjs';
import { remapWarning } from '../safety.mjs';

const USAGE = 'usage: lpk doctor [--repo <dir>]';
const TOOLS = [['git', 'required'], ['node', 'required'], ['gh', 'PR, CI and escape facts'], ['flock', '`lpk slot` and shared repro installs'], ['npx', 'OpenCodeReview'], ['pnpm', 'repro installs in pnpm repos'], ['npm', 'repro installs in npm repos'], ['yarn', 'repro installs in yarn repos']];

// The settings files Claude Code reads, user first, the project's local one last.
function settings(repo) {
  const user = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const files = [join(user, 'settings.json'), ...(repo ? [join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json')] : [])];
  return files.flatMap((f) => { try { return [{ file: f, json: JSON.parse(readFileSync(f, 'utf8')) }]; } catch { return []; } });
}

export async function main(argv) {
  const a = parseArgs(argv, ['--repo']);
  if (a.error || a.words.length) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  const run = repo ? readRun(repo) : null;
  const out = [];
  const pf = repo ? await preflight(repo, { target: run?.target || '', verify: run?.verify || [] }) : { refuse: 'not inside a git repository', lines: [] };
  out.push(...(pf.refuse ? [`preflight: ${pf.refuse}`] : pf.lines));
  const s = settings(repo);
  for (const { file, json } of s) {
    const w = remapWarning(json.env || {});
    if (w) out.push(`${file}: ${w}`);
  }
  const window = s.filter((x) => x.json.autoCompactWindow !== undefined).at(-1);
  const envWindow = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  out.push(`autoCompactWindow: ${window ? `${window.json.autoCompactWindow} (${window.file})` : 'not set in settings (Claude Code default)'}${envWindow ? `; CLAUDE_CODE_AUTO_COMPACT_WINDOW=${envWindow}` : ''}`);
  for (const [tool, why] of TOOLS) {
    const ok = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).status === 0;
    out.push(`${ok ? 'ok     ' : 'MISSING'} ${tool}${ok ? '' : `: ${why}`}`);
  }
  console.log(out.join('\n'));
  return 0;
}
