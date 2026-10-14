// An lpk run: a marker in the repo's git directory that switches the in-loop hooks on for one
// session, the checks that define "verified", and the tree each green verify was recorded for.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { git } from './git.mjs';
import { CODE, TEST } from './rules.mjs';

const DAY = 24 * 3600 * 1000;
// One file per live run, naming its marker: the hooks' only cost outside a run is listing it, and
// a session working in a submodule of the directory it started in still finds its run.
export const ACTIVE = join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'lpk', 'active');
const activeFile = (marker) => join(ACTIVE, createHash('sha1').update(marker).digest('hex').slice(0, 16));

// Shared by every worktree of the repo, so builders in their own worktrees see the same run.
export function markerOf(repo) {
  const common = git(['rev-parse', '--git-common-dir'], repo).trim();
  return common ? join(isAbsolute(common) ? common : join(repo, common), 'lpk', 'run.json') : '';
}

export function readRun(repo) {
  return readMarker(markerOf(repo));
}

function readMarker(m) {
  if (!m || !existsSync(m)) return null;
  try { return { ...JSON.parse(readFileSync(m, 'utf8')), marker: m }; } catch { return null; }
}

export function writeRun(run) {
  const { marker, ...data } = run;
  mkdirSync(join(marker, '..'), { recursive: true });
  // Written aside and renamed, so a hook reading at the same moment never sees half a file.
  const tmp = `${marker}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 1));
  renameSync(tmp, marker);
}

// The run this hook call belongs to: a marker that is unbound (the first hook binds it to its
// session) or bound to this session. A run bound to a session lasts until `lpk run end`, however
// many days the work takes; an unbound one older than a day is ignored. With `bind` false an
// unbound run is left alone and not returned.
export function runFor(repo, session, bind = true) {
  return claim(readRun(repo), session, bind);
}

function claim(r, session, bind = true) {
  if (!r || (!r.session && Date.now() - r.started > DAY)) return null;
  if (r.session && session && r.session !== session) return null;
  if (!r.session && !bind) return null;
  if (!r.session && session) { r.session = session; writeRun(r); }
  return r;
}

// This session's newest run in any repo, for a hook called from a directory outside it. A run no
// session has claimed yet (started from a terminal) is only claimed from its repo or a directory
// above it, never by another session working elsewhere on the machine.
export function activeRun(session, bind = true, cwd = '') {
  let names = [];
  try { names = readdirSync(ACTIVE); } catch { return null; }
  const runs = names.map((n) => {
    const marker = readFileSync(join(ACTIVE, n), 'utf8').trim();
    const r = readMarker(marker);
    if (r && (r.session || Date.now() - r.started <= DAY)) return r;
    rmSync(join(ACTIVE, n), { force: true });
    return null;
  }).filter(Boolean);
  const above = (r) => cwd && (r.repo === cwd || r.repo.startsWith(`${cwd.replace(/\/$/, '')}/`));
  const mine = runs.filter((r) => (r.session ? r.session === session : above(r))).sort((a, b) => b.started - a.started);
  return claim(bind ? mine[0] : mine.find((r) => r.session), session, bind);
}

export function startRun(repo, { base, verify }) {
  const marker = markerOf(repo);
  if (!marker) return { error: 'not inside a git repository' };
  if (!verify.length) return { error: 'name at least one check with --verify "<command>": the commands CI runs for this change' };
  const open = readMarker(marker), me = process.env.CLAUDE_CODE_SESSION_ID;
  if (open && open.session && open.session !== me) return { error: `a run of session ${open.session} is open in this repo since ${new Date(open.started).toISOString()}; when that session is done with it, \`lpk run end\` ends it, then start again` };
  // Started from a Claude Code session's shell, the run is that session's from the first moment.
  const run = { marker, repo, base, verify, started: Date.now(), seen: [], ...(process.env.CLAUDE_CODE_SESSION_ID ? { session: process.env.CLAUDE_CODE_SESSION_ID } : {}) };
  writeRun(run);
  writeFileSync(promptsOf(marker), '');
  mkdirSync(ACTIVE, { recursive: true });
  writeFileSync(activeFile(marker), marker);
  return { run };
}

// What the owner wrote during the run, one JSON line per message, for lpk:learn to read after
// the run ends. A new run starts the file afresh.
export const promptsOf = (marker) => join(marker, '..', 'prompts.jsonl');

export function notePrompt(run, prompt) {
  appendFileSync(promptsOf(run.marker), `${JSON.stringify({ at: new Date().toISOString(), prompt })}\n`);
}

export function endRun(repo, reason) {
  const r = readRun(repo);
  if (!r) return { error: 'no lpk run in this repo' };
  rmSync(r.marker, { force: true });
  rmSync(join(r.marker, '..', 'brief.md'), { force: true });
  rmSync(activeFile(r.marker), { force: true });
  return { run: r, reason };
}

// Digests of the code files among `blob<TAB>path` lines: `source` for non-test code, `code` for
// all code including tests.
function digests(entries) {
  const code = entries.filter((e) => CODE.test(e.split('\t')[1] || ''));
  const hash = (xs) => createHash('sha1').update(xs.join('\n')).digest('hex');
  return { source: hash(code.filter((e) => !TEST.test(e.split('\t')[1]))), code: hash(code) };
}

// The working tree as git would commit it with everything added, untracked files included and
// ignored files left out, without touching the real index: `tree` for every file, plus digests.
export function treeOf(repo) {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-tree-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  const run = (args) => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    run(['read-tree', 'HEAD']);
    run(['add', '-A']);
    const entries = run(['ls-files', '-s']).stdout.split('\n').filter(Boolean).map((l) => { const [meta, p] = l.split('\t'); return `${meta.split(' ')[1]}\t${p}`; });
    return { tree: run(['write-tree']).stdout.trim(), ...digests(entries) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The same digests for a commit, to compare what a push publishes with what was verified.
export function codeOfCommit(repo, ref) {
  const out = spawnSync('git', ['ls-tree', '-r', ref], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  return digests(out.split('\n').filter(Boolean).map((l) => { const [meta, p] = l.split('\t'); return `${meta.split(' ')[2]}\t${p}`; }));
}

// Runs every check in the repo root and records the result against the tree it ran on.
export function verify(repo, timeout = 1200) {
  const r = readRun(repo);
  if (!r) return { error: 'no lpk run in this repo: start one with `lpk run start --verify "<command>"`' };
  const { tree, source, code } = treeOf(repo);
  const results = r.verify.map((cmd) => {
    const t0 = Date.now();
    const p = spawnSync('bash', ['-c', cmd], { cwd: repo, encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 1 << 26 });
    const out = `${p.stdout || ''}${p.stderr || ''}`.trim().split('\n').slice(-15).join('\n');
    return { cmd, exit: p.status ?? (p.signal ? `killed (${p.signal})` : 1), ms: Date.now() - t0, tail: out };
  });
  // Files the checks write (build info, stamps, caches) do not void the result; a code file that
  // changed while they ran does. The tree recorded is the one the checks left.
  const after = treeOf(repo);
  const moved = git(['diff-tree', '-r', '--name-only', tree, after.tree], repo).split('\n').filter((p) => CODE.test(p));
  r.verified = { tree: after.tree, source, code, at: Date.now(), green: results.every((x) => x.exit === 0) && !moved.length, results };
  writeRun(r);
  return { verified: r.verified, changedDuring: moved };
}

// One short line for the owner's status line: this session's run, its real age and its last verify.
export function statusLine(session) {
  const r = activeRun(session, false);
  if (!r) return '';
  const min = (t) => Math.round((Date.now() - t) / 60000);
  const v = r.verified;
  return `lpk ${min(r.started)}m · ${!v ? 'not verified yet' : `verify ${v.green ? 'green' : 'RED'} ${min(v.at)}m ago`}`;
}
