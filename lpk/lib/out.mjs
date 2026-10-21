// How every lpk verb prints: at most 60 rows on stdout, the whole list in a named file under the
// run directory, so an agent reads a summary and opens the file only when it needs the rest.
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultBranch, mergeBase, top } from './git.mjs';
import { currentBranch, readRun, runDir } from './run.mjs';

export const MAX_ROWS = 60;

// The run directory's `out/` (shared by every worktree of the repo), else the user's cache.
export function outDir(repo) {
  const run = repo ? runDir(repo) : '';
  const dir = run ? join(run, 'out') : join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'lpk', 'out');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// `head` lines always print; `rows` print up to the cap, and when they pass it all of them go to
// `<out>/<name>.txt` and the last line says how many were cut and where they are.
export function capped(repo, name, head, rows) {
  if (rows.length <= MAX_ROWS - head.length) return [...head, ...rows].join('\n');
  const file = join(outDir(repo), `${name}.txt`);
  writeFileSync(file, `${[...head, ...rows].join('\n')}\n`);
  const keep = Math.max(1, MAX_ROWS - head.length - 1);
  return [...head, ...rows.slice(0, keep), `... ${rows.length - keep} more rows; all ${rows.length} in ${file}`].join('\n');
}

// Words after `--` as one bash command: a single word is a command line as typed (`-- "make &&
// make test"`); several are an argv, each quoted so bash hands it to the program unchanged.
export function commandOf(words) {
  if (words.length === 1) return words[0];
  return words.map((w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replaceAll("'", `'\\''`)}'`)).join(' ');
}

// A verb's arguments: `--name value` options (the names in `valued`), bare flags (the names in
// `bare`), positional words, and everything after `--` as one command (commandOf). Any other `--x`
// is an error, so a mistyped option never runs as if it were absent.
export function parseArgs(argv, valued = [], bare = []) {
  const at = argv.indexOf('--');
  const own = at < 0 ? argv : argv.slice(0, at);
  const opts = {}, flags = new Set(), words = [];
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (valued.includes(a)) { if (own[i + 1] === undefined) return { error: `${a} needs a value` }; (opts[a] ||= []).push(own[++i]); }
    else if (bare.includes(a)) flags.add(a);
    else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else words.push(a);
  }
  const opt = (k) => opts[k]?.at(-1);
  return { opt, all: (k) => opts[k] || [], flags, words, cmd: at < 0 ? '' : commandOf(argv.slice(at + 1)) };
}

// The checkout a verb works on: `--repo`, else the current directory.
export const repoOf = (p) => top(resolve(p || '.'));

// Where the change starts: the merge base of HEAD with `ref`, else with the run's target, else with
// the default branch.
export function baseOf(repo, ref) {
  const target = targetOf(repo, ref);
  return target ? mergeBase(repo, target) : '';
}

// The branch the change merges into: `ref`, else the run's target, else the default branch. The run
// is shared by every worktree of the repo, so a checkout on a branch the run never noted is not its.
export function targetOf(repo, ref) {
  if (ref) return ref;
  const run = readRun(repo);
  const branch = currentBranch(repo);
  const own = run && (!branch || [run.branch, ...(run.branches || [])].includes(branch));
  return (own && (run.target || run.base)) || defaultBranch(repo);
}
