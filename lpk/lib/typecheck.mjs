import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const TS = /\.(ts|tsx|mts|cts)$/;
export const TIMEOUT_MS = 20000;
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
  const tsc = climb(project, (d) => existsSync(join(d, 'node_modules', '.bin', 'tsc')) && join(d, 'node_modules', '.bin', 'tsc'));
  if (!tsc) return null;
  const ran = spawnSync(tsc, ['--noEmit', '--pretty', 'false', '--listFiles', '-p', join(project, 'tsconfig.json')], { cwd: project, encoding: 'utf8', timeout: TIMEOUT_MS });
  const name = relative(input.cwd || '.', file);
  const say = (text) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } });
  if (ran.error?.code === 'ETIMEDOUT') return say(`lpk: \`tsc --noEmit -p ${relative(input.cwd || '.', join(project, 'tsconfig.json'))}\` did not finish in ${TIMEOUT_MS / 1000}s, so ${name} was not type-checked this time.`);
  if (ran.error) return null;
  const lines = [];
  const listed = new Set();
  let mine = false;
  for (const line of String(ran.stdout).split('\n')) {
    const at = /^(.+?)\(\d+,\d+\): /.exec(line);
    if (at) mine = resolve(project, at[1]) === file;
    else if (!/^\s/.test(line)) mine = false;
    if (mine) lines.push(line);
    else if (isAbsolute(line)) listed.add(line);
  }
  if (!lines.length) {
    const inProgram = listed.has(file) || listed.has(realpathSync(file));
    return [0, 2].includes(ran.status) && !inProgram ? say(`lpk: ${name} is not part of what \`tsc --noEmit -p ${relative(input.cwd || '.', join(project, 'tsconfig.json'))}\` builds (its files, include, exclude or references), so it was not type-checked.`) : null;
  }
  const shown = lines.slice(0, MAX_LINES).join('\n');
  const more = lines.length > MAX_LINES ? `\n(${lines.length - MAX_LINES} more lines not shown)` : '';
  return say(`lpk: \`tsc --noEmit -p ${relative(input.cwd || '.', join(project, 'tsconfig.json'))}\` reports on ${name}:\n${shown}${more}`);
}
