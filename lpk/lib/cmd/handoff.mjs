// `lpk handoff <slice>`: the state a fresh builder needs to take over a stuck slice: the files it
// owns, its worktree, the commits and uncommitted edits there, the last verify, and the findings
// on its files. Facts only; what is left to do is the builder's reading of them and the brief.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readLedger } from '../findings.mjs';
import { git } from '../git.mjs';
import { baseOf, capped, parseArgs, repoOf } from '../out.mjs';
import { readRecords } from '../records.mjs';
import { readRun, runDir } from '../run.mjs';

const USAGE = 'usage: lpk handoff <slice name or number> [--worktree <dir>] [--repo <dir>]';
const nameOf = (s, i) => String(s.id ?? s.name ?? s.title ?? i + 1);

// The slice's worktree: the one named, else the one whose folder or branch carries the slice name.
function worktreeOf(repo, slice, given) {
  const trees = [];
  let cur = null;
  for (const l of git(['worktree', 'list', '--porcelain'], repo).split('\n')) {
    if (l.startsWith('worktree ')) trees.push((cur = { path: l.slice(9), branch: '' }));
    else if (l.startsWith('branch ') && cur) cur.branch = l.slice(7).replace('refs/heads/', '');
  }
  if (given) return trees.find((t) => t.path === given) || { path: given, branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], given).trim() };
  const key = slice.toLowerCase();
  return trees.slice(1).find((t) => basename(t.path).toLowerCase().includes(key) || t.branch.toLowerCase().includes(key)) || null;
}

export async function main(argv) {
  const a = parseArgs(argv, ['--worktree', '--repo']);
  if (a.error || a.words.length !== 1) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const dir = runDir(repo), want = a.words[0];
  const briefJson = join(dir, 'brief.json');
  let slices = [];
  try { slices = existsSync(briefJson) ? JSON.parse(readFileSync(briefJson, 'utf8')).slices || [] : []; } catch (e) { console.error(`lpk: ${briefJson} is not JSON (${e.message})`); return 2; }
  const i = slices.findIndex((s, k) => nameOf(s, k) === want);
  const slice = slices[i];
  const files = slice?.files || [];
  const head = [
    slice ? `slice ${want}: owns ${files.join(', ') || 'no files listed'} (${briefJson})` : `slice ${want}: not in ${existsSync(briefJson) ? briefJson : 'any brief.json'} (slices: ${slices.map(nameOf).join(', ') || 'none'})`,
    ...['brief.md', 'brief.json'].filter((f) => existsSync(join(dir, f))).map((f) => `brief: ${join(dir, f)}`),
  ];
  const rows = [];
  const wt = worktreeOf(repo, want, a.opt('--worktree'));
  if (!wt) rows.push(`worktree: none whose folder or branch names "${want}" (give --worktree)`);
  else {
    const base = baseOf(wt.path) || baseOf(repo);
    rows.push(`worktree: ${wt.path} on ${wt.branch || 'a detached HEAD'} at ${git(['rev-parse', '--short=12', 'HEAD'], wt.path).trim()}, base ${base.slice(0, 12)}`);
    const log = git(['log', '--format=%h %s', `${base}..HEAD`], wt.path).split('\n').filter(Boolean);
    rows.push(`commits since base: ${log.length}`, ...log.map((l) => `  ${l}`));
    const dirty = git(['status', '--porcelain'], wt.path).split('\n').filter(Boolean);
    rows.push(`uncommitted: ${dirty.length} path(s)`, ...dirty.map((l) => `  ${l}`));
    const touched = git(['diff', '--name-only', base], wt.path).split('\n').filter(Boolean);
    const beyond = files.length ? touched.filter((f) => !files.includes(f)) : [];
    if (beyond.length) rows.push(`changed beyond the slice's files: ${beyond.join(', ')}`);
  }
  const run = readRun(repo);
  const verify = readRecords(repo, run ? { run: run.id } : {}).filter((r) => r.kind === 'verify').at(-1);
  rows.push(verify ? `last lpk verify: ${verify.green ? 'green' : 'RED'} on tree ${String(verify.tree || '').slice(0, 12)} at ${verify.at}${verify.green ? '' : `; failing: ${(verify.results || []).filter((x) => x.exit !== 0).map((x) => `\`${x.cmd}\``).join(', ')}`}` : 'last lpk verify: none in this run');
  let findings = [];
  try { findings = readLedger(repo).findings; } catch { /* no ledger yet */ }
  const mine = findings.filter((f) => !files.length || files.includes(f.file)).filter((f) => !['dropped', 'duplicate', 'fixed', 'preexisting'].includes(f.state));
  rows.push(`findings still to act on${files.length ? ' on these files' : ''}: ${mine.length}`, ...mine.map((f) => `  ${f.id} ${f.state} ${f.file}:${f.line} ${String(f.claim || '').split('\n')[0].slice(0, 120)}`));
  console.log(capped(repo, `handoff-${want.replace(/[^\w.-]/g, '-')}`, head, rows));
  return 0;
}
