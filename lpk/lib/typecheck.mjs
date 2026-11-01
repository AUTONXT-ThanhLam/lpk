import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const TS = /\.(ts|tsx|mts|cts)$/;
const limitMs = () => Number(process.env.LPK_TYPECHECK_MS) || 5000;
const MAX_LINES = 30;

function climb(from, found) {
  for (let dir = from; ; dir = dirname(dir)) {
    const hit = found(dir);
    if (hit) return hit;
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) return null;
  }
}

export function afterTsEdit(input) {
  const given = input.tool_input?.file_path;
  if (!given || !TS.test(given)) return null;
  const file = resolve(input.cwd || '.', given);
  if (!climb(dirname(file), (d) => existsSync(join(d, '.git')) && d)) return null;
  const project = climb(dirname(file), (d) => existsSync(join(d, 'tsconfig.json')) && d);
  if (!project) return null;
  const tsc = climb(project, (d) => existsSync(join(d, 'node_modules', 'typescript', 'bin', 'tsc')) && join(d, 'node_modules', 'typescript', 'bin', 'tsc'));
  if (!tsc) return null;
  const cache = join(tmpdir(), 'lpk-tsc', `${createHash('sha1').update(project).digest('hex').slice(0, 12)}.tsbuildinfo`);
  const ran = spawnSync(process.execPath, [tsc, '--noEmit', '--incremental', '--tsBuildInfoFile', cache, '--pretty', 'false', '-p', join(project, 'tsconfig.json')], { cwd: project, encoding: 'utf8', timeout: limitMs(), killSignal: 'SIGKILL' });
  const name = relative(input.cwd || '.', file);
  const say = (text) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });
  if (ran.error?.code === 'ETIMEDOUT') return say(`lpk: \`tsc --noEmit -p ${relative(input.cwd || '.', join(project, 'tsconfig.json'))}\` did not finish in ${limitMs() / 1000}s, so ${name} was not type-checked this time.`);
  if (ran.error) return null;
  const lines = [];
  let mine = false;
  for (const line of String(ran.stdout).split('\n')) {
    const at = /^(.+?)\(\d+,\d+\): /.exec(line);
    if (at) mine = resolve(project, at[1]) === file;
    else if (!/^\s/.test(line)) mine = false;
    if (mine) lines.push(line);
  }
  if (!lines.length) return null;
  const shown = lines.slice(0, MAX_LINES).join('\n');
  const more = lines.length > MAX_LINES ? `\n(${lines.length - MAX_LINES} more lines not shown)` : '';
  return say(`lpk: \`tsc --noEmit -p ${relative(input.cwd || '.', join(project, 'tsconfig.json'))}\` reports on ${name}:\n${shown}${more}`);
}
