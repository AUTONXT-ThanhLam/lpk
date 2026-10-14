// The facts the status page shows for each live lpk run: git, the last verify and the owner's
// messages. The narrative (what the agent is doing) is summary.mjs's, read
// here as written.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feed } from './feed.mjs';
import { git } from './git.mjs';
import { ACTIVE, promptsOf, readMarker, runId, treeOf } from './run.mjs';

const HOUR = 3600 * 1000;
export const STATUS = join(ACTIVE, '..', 'status');
const ENDED = join(STATUS, 'ended');
const SERVER = join(STATUS, 'server.json');
export const PORT = Number(process.env.LPK_STATUS_PORT) || 9339;
const LPK = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'lpk');

export const narrativeOf = (marker) => join(marker, '..', 'status.json');
export const ticksOf = (marker) => join(marker, '..', 'ticks');
export const transcriptOf = (marker) => join(marker, '..', 'transcript');
const readJson = (p, fallback = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
const lines = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

export function liveRuns() {
  let names = [];
  try { names = readdirSync(ACTIVE); } catch { return []; }
  return names.map((n) => readMarker(lines(join(ACTIVE, n))[0])).filter(Boolean);
}

// Whether the tree still matches the last verify costs a `git add -A` into a scratch index, so it
// is computed at most once per run every 15 seconds however often the page asks.
const treeCache = new Map();
function currentTree(repo) {
  const c = treeCache.get(repo);
  if (c && Date.now() - c.at < 15000) return c.tree;
  const tree = treeOf(repo).tree;
  treeCache.set(repo, { at: Date.now(), tree });
  return tree;
}

export function snapshot(r) {
  const { repo, base, marker } = r;
  const v = r.verified;
  const commits = git(['log', '--format=%x1e%h%x1f%cI%x1f%s', '--shortstat', '-n', '40', `${base}..HEAD`], repo).split('\x1e').filter(Boolean).map((c) => {
    const [head, stat = ''] = c.split('\n').filter(Boolean);
    const [h, t, s] = head.split('\x1f');
    return { h, t, s, added: Number(stat.match(/(\d+) insertion/)?.[1] || 0), removed: Number(stat.match(/(\d+) deletion/)?.[1] || 0) };
  });
  const stat = git(['diff', '--shortstat', base], repo);
  const [files, added, removed] = ['file', 'insertion', 'deletion'].map((w) => Number((stat.match(new RegExp(`(\\d+) ${w}`)) || [])[1] || 0));
  const said = lines(promptsOf(marker)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const brief = join(marker, '..', 'brief.md');
  return {
    id: runId(marker), repo, name: basename(repo), session: r.session || null,
    branch: git(['branch', '--show-current'], repo).trim() || git(['rev-parse', '--short', 'HEAD'], repo).trim(),
    base: base.slice(0, 12), started: r.started, checks: r.verify,
    verify: v ? { green: v.green, at: v.at, current: v.tree === currentTree(repo), results: v.results.map(({ cmd, exit, ms }) => ({ cmd, exit, ms })) } : null,
    commits, diff: { files, added, removed },
    dirty: git(['status', '--porcelain'], repo).split('\n').filter(Boolean).length,
    owner: { count: said.length, last: said.at(-1) ? { at: said.at(-1).at, text: String(said.at(-1).prompt).slice(0, 600) } : null },
    brief: existsSync(brief) ? lines(brief).find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 160) || 'Design Brief' : null,
    activity: Math.max(mtime(ticksOf(marker)), mtime(marker)) || r.started,
    project: existsSync(join(repo, '.lpk', 'status', 'index.html')),
    narrative: readJson(narrativeOf(marker)),
    feed: feed(lines(transcriptOf(marker))[0]),
  };
}

// What `lpk run end` leaves for the page: the run's last snapshot, shown for a day.
export function keepEnded(r, reason) {
  try {
    mkdirSync(ENDED, { recursive: true });
    writeFileSync(join(ENDED, `${runId(r.marker)}.json`), JSON.stringify({ ...snapshot(r), ended: Date.now(), reason: reason || '' }));
  } catch { /* the page simply misses it */ }
}

export function endedRuns() {
  let names = [];
  try { names = readdirSync(ENDED); } catch { return []; }
  return names.map((n) => {
    const s = readJson(join(ENDED, n));
    if (s && Date.now() - s.ended < 24 * HOUR) return s;
    rmSync(join(ENDED, n), { force: true });
    return null;
  }).filter(Boolean).sort((a, b) => b.ended - a.ended);
}

// The address the owner opens: `LPK_STATUS_URL` when they gave the page a name of their own (a hosts
// entry forwarded to this port), else `lpk.localhost`, which every browser resolves to this machine.
export const urlOf = (port = PORT) => process.env.LPK_STATUS_URL || `http://lpk.localhost:${port}/`;

// The page's server, started on first need and left running until no run has been live for half
// an hour. Its pid file says where it listens; a dead pid means start again.
export function serverUrl() {
  const s = readJson(SERVER);
  if (!s || s.port !== PORT) return '';
  try { process.kill(s.pid, 0); return urlOf(s.port); } catch { return ''; }
}

export function ensureServer() {
  const up = serverUrl();
  if (up) return up;
  mkdirSync(STATUS, { recursive: true });
  spawn(process.execPath, [LPK, 'status', 'serve'], { detached: true, stdio: 'ignore', env: process.env }).unref();
  return urlOf();
}

export function writeServer(pid, port) {
  mkdirSync(STATUS, { recursive: true });
  writeFileSync(SERVER, JSON.stringify({ pid, port, started: Date.now() }));
}
