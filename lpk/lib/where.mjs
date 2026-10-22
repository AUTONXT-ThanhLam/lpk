import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { git, top } from './git.mjs';

// One file per live run, naming its marker: the hooks' only cost outside a run is listing it.
export const ACTIVE = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'lpk', 'active');
export const activeFile = (marker) => join(ACTIVE, createHash('sha1').update(marker).digest('hex').slice(0, 16));
export const LINK = 'lpk-run';

// The open run, or why run.json cannot be read: a damaged or 1.x file is an error the delivery
// gates deny on, never "no run".
export function parse(m) {
  if (!m || !existsSync(m)) return { run: null };
  try {
    const run = JSON.parse(readFileSync(m, 'utf8'));
    if (run?.v !== 2 || !run.id) return { run: null, error: `${m} is not an lpk 2 run (\`lpk run end\` clears it)` };
    return { run: { ...run, marker: m } };
  } catch (e) { return { run: null, error: `${m} cannot be read (${e.message}); \`lpk run end\` clears it` }; }
}

export function registered() {
  let names = [];
  try { names = readdirSync(ACTIVE); } catch { return []; }
  return names.flatMap((n) => {
    try { return [{ file: join(ACTIVE, n), ...parse(readFileSync(join(ACTIVE, n), 'utf8').trim()) }]; } catch { return []; }
  });
}

export function worktreeOf(repo, branch) {
  if (!repo || !branch) return '';
  const blocks = git(['worktree', 'list', '--porcelain'], repo).split('\n\n');
  const hit = blocks.find((b) => b.split('\n').includes(`branch refs/heads/${branch}`));
  return hit ? hit.split('\n')[0].replace(/^worktree /, '') : '';
}

export function checkout(repo) {
  const [dir, common] = repo ? git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], repo).trim().split('\n') : [];
  return common ? { repo, common, own: join(dir, 'lpk'), linked: dir !== common, link: join(dir, LINK) } : null;
}

function ofRepo(marker, common) {
  const x = dirname(dirname(marker));
  return x === common || dirname(x) === join(common, 'worktrees');
}

function linked(at) {
  try { const d = readFileSync(at.link, 'utf8').trim(); return d && existsSync(d) ? d : ''; } catch { return ''; }
}

function held(at, session) {
  if (!session) return '';
  const mine = registered().map((x) => x.run).filter((r) => r?.session === session && ofRepo(r.marker, at.common));
  const r = mine.sort((a, b) => b.started - a.started)[0];
  return r ? dirname(r.marker) : '';
}

function legacy(at) {
  const r = parse(join(at.common, 'lpk', 'run.json')).run;
  return r && r.repo === top(at.repo) ? join(at.common, 'lpk') : '';
}

export function runDir(repo, session = process.env.CLAUDE_CODE_SESSION_ID || '') {
  const at = checkout(repo);
  if (!at) return '';
  if (!at.linked || existsSync(at.own)) return at.own;
  return linked(at) || legacy(at) || held(at, session) || join(at.common, 'lpk');
}
export const markerOf = (repo, session) => { const d = runDir(repo, session); return d ? join(d, 'run.json') : ''; };

export function linkWorktree(path, dir) {
  const at = checkout(path);
  if (!at?.linked) return false;
  writeFileSync(at.link, `${dir}\n`);
  return true;
}

export function startDir(repo) {
  const at = checkout(repo);
  return !at ? '' : !at.linked || existsSync(at.own) ? at.own : legacy(at) || at.own;
}
