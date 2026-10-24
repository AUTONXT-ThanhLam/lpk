// Which host launched lpk, and where that host and the other one keep what lpk reads.
//
// lpk runs on Claude Code and on Qoder from one tree, and the owner works on both, so a session's
// transcripts, its live-process files and its settings can sit in either store. Nothing here chooses
// ONE root for a reader: `configDirs()` is the ORDERED list of roots to read, the host that launched
// this process first and the other after it, and a reader walks all of them. Each function reads the
// environment when it is called, so a hook, a CLI run from a session's shell and a test each answer
// for the host they were launched under.
//
// Nothing here writes, and nothing here guesses: a host that set no variable of its own is `other`.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each host's own names for the places it keeps things: `config` the variables it reads for its
// store, `home` the default folder of it, `plugin`/`session`/`project` what it sets for the process
// it launches. Qoder also sets the compatibility CLAUDE_PLUGIN_ROOT and CLAUDE_SESSION_ID, so its own
// name wins whenever both families are present.
const HOSTS = [
  { name: 'qoder', config: ['QODER_CONFIG_DIR'], home: '.qoder', plugin: 'QODER_PLUGIN_ROOT', session: ['QODER_SESSION_ID'], project: 'QODER_PROJECT_DIR' },
  { name: 'claude', config: ['CLAUDE_CONFIG_DIR'], home: '.claude', plugin: 'CLAUDE_PLUGIN_ROOT', session: ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID'], project: 'CLAUDE_PROJECT_DIR' },
];
// The session id in the order lpk trusts it: Qoder's own, then Claude Code's, then the compatibility
// variable Qoder also sets for a Claude Code session. The plugin root and project dir likewise.
const SESSION_VARS = HOSTS.flatMap((h) => h.session);
const PROJECT_VARS = HOSTS.map((h) => h.project);
const PLUGIN_VARS = HOSTS.map((h) => h.plugin);
// The folder each host reads a plugin's manifest from, tried in this order: one tree carries both.
const MANIFEST_DIRS = ['.claude-plugin', '.qoder-plugin'];

const any = (names, env) => names.map((n) => env[n]).find((v) => v) || '';

// Which host launched this process: 'qoder', 'claude', or 'other' when neither of them did.
export function hostName(env = process.env) {
  for (const h of HOSTS) if (any(h.config, env) || any(h.session, env) || env[h.plugin] || env[h.project]) return h.name;
  return 'other';
}

// The candidate store roots, in the order a reader walks them: the host this process runs under
// first, the other after, each its variable's value else its folder in the home. Deduped, so a root
// named twice is read once. Not filtered by existence: this is the list, and `projectsDirs()` below
// is the part of it that is there.
export function configCandidates(env = process.env) {
  const home = env.HOME || homedir();
  const active = hostName(env);
  const order = active === 'other' ? HOSTS : [...HOSTS].sort((a, b) => (a.name === active ? -1 : 1) - (b.name === active ? -1 : 1));
  const out = [];
  for (const h of order) {
    const c = { host: h.name, dir: any(h.config, env) || join(home, h.home) };
    if (!out.some((x) => x.dir === c.dir)) out.push(c);
  }
  return out;
}

export const configDirs = (env = process.env) => configCandidates(env).map((c) => c.dir);
// The root this host itself uses: the first candidate. A reader that measures a run takes `configDirs`
// and walks them; this is for the one place that must name a single store.
export const configDir = (env = process.env) => configCandidates(env)[0].dir;

// The `projects` folder of every candidate that is on disk, in order: where each host keeps the
// transcripts of its sessions, `<root>/projects/<slug>/<session>.jsonl` and the session's subagents
// under `<root>/projects/<slug>/<session>/subagents/`. Both hosts name the project folder the same
// way, so one slug finds a session in either store.
export const projectsDirs = (env = process.env) => configCandidates(env).map((c) => join(c.dir, 'projects')).filter((d) => existsSync(d));
export const projectsDir = (env = process.env) => join(configDir(env), 'projects');
// A project folder's name: its directory, every character but a letter or digit a dash. Claude Code
// names it thus; measured: so does Qoder.
export const slugOf = (dir) => String(dir || '').replace(/[^A-Za-z0-9]/g, '-');

// Every `<root>/projects/<project>/<session>` dir on either host, ordered and deduped. A session may
// have started in a parent of the repo or in a worktree of it, so each project folder is asked; the
// caller keeps whichever of its dirs hold what it reads.
export function sessionDirs(session, env = process.env) {
  const s = String(session || '');
  if (!s) return [];
  const out = [];
  for (const projects of projectsDirs(env)) {
    let names = [];
    try { names = readdirSync(projects); } catch { continue; }
    for (const n of names) {
      const d = join(projects, n, s);
      if (!out.includes(d) && existsSync(d)) out.push(d);
    }
  }
  return out;
}

// The per-process folders of every candidate: Claude Code keeps `<pid>.json` for each running session
// under `<root>/sessions`; a host that keeps none simply has no such folder to read.
export const sessionsDirs = (env = process.env) => configCandidates(env).map((c) => join(c.dir, 'sessions')).filter((d) => existsSync(d));

// Which host's store a path came from, so a fact read from it says where it was measured.
export function hostOf(path, env = process.env) {
  const p = String(path || '');
  for (const c of configCandidates(env)) if (p === c.dir || p.startsWith(`${c.dir}/`)) return c.host;
  return '';
}

// The session this process belongs to, as its host named it. '' outside a session.
export const sessionId = (env = process.env) => any(SESSION_VARS, env);
// The directory the host launched this process in.
export const projectDir = (env = process.env) => any(PROJECT_VARS, env) || process.cwd();
// Where the plugin's own files are: the root the launching host sets, else the tree lib/ was loaded
// from, which is the same directory when lpk runs from its checkout.
export const pluginRoot = (env = process.env) => any(PLUGIN_VARS, env) || join(dirname(fileURLToPath(import.meta.url)), '..');
// The plugin manifest: the version `lpk version` prints and the run's row records as the CLI version.
export const pluginManifest = (root = pluginRoot()) => MANIFEST_DIRS.map((d) => join(root, d, 'plugin.json')).find((f) => existsSync(f)) || join(root, MANIFEST_DIRS[0], 'plugin.json');

// An agent transcript's name on either host: Claude Code writes `agent-<id>.jsonl`, Qoder
// `agent-<type>-<hash>.jsonl`. Beside its transcripts Qoder also writes `task-<id>.json` and a
// `compression-v2/` folder, and Claude Code a workflow journal: none of those is an agent transcript.
export const agentFile = (name) => /^agent-.+\.jsonl$/.test(String(name || ''));
// The id in such a name: everything after `agent-`, dashes and all — Qoder's ids carry the agent's
// type and so name no agent with a bare hex string. '' for a file that is no agent transcript.
export const agentIdOf = (file) => { const n = basename(String(file || '')); return agentFile(n) ? n.slice('agent-'.length, -'.jsonl'.length) : ''; };

// The counts one transcript line carries. MEASURED: Qoder writes all four of these as 0 in its
// transcripts while Claude Code writes real numbers, so a token figure read from a Qoder transcript
// says nothing about the run. `usageRecorded` is the rule every reader goes through, and `recorded`
// is the field it leaves on what it read: false when the host recorded no counts at all.
export const TOKEN_KEYS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
export const TOKENS_UNMEASURED = 'tokens not recorded by this host';
export const usageRecorded = (usage) => TOKEN_KEYS.some((k) => Number(usage?.[k]) > 0);
// A token figure for the report layer: the number when its host recorded it, the words when it did
// not. Only a figure known to be unrecorded is turned into words; a reader that never asked leaves a
// number alone.
export const tokenFigure = (n, recorded) => (recorded === false ? TOKENS_UNMEASURED : n);
