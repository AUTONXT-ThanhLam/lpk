import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOSTS = [
  { name: 'claude', config: ['CLAUDE_CONFIG_DIR'], home: '.claude', plugin: 'CLAUDE_PLUGIN_ROOT', session: ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID'], project: 'CLAUDE_PROJECT_DIR' },
];
const SESSION_VARS = HOSTS.flatMap((h) => h.session);
const PROJECT_VARS = HOSTS.map((h) => h.project);
const PLUGIN_VARS = HOSTS.map((h) => h.plugin);
const MANIFEST_DIRS = ['.claude-plugin'];

const any = (names, env) => names.map((n) => env[n]).find((v) => v) || '';

export function hostName(env = process.env) {
  for (const h of HOSTS) if (any(h.config, env) || any(h.session, env) || env[h.plugin] || env[h.project]) return h.name;
  return 'other';
}

export function configCandidates(env = process.env) {
  const home = env.HOME || homedir();
  const out = [];
  for (const h of HOSTS) {
    const c = { host: h.name, dir: any(h.config, env) || join(home, h.home) };
    if (!out.some((x) => x.dir === c.dir)) out.push(c);
  }
  return out;
}

export const configDirs = (env = process.env) => configCandidates(env).map((c) => c.dir);
// The root this host itself uses: the first candidate. A reader that measures a run takes `configDirs`
// and walks them; this is for the one place that must name a single store.
export const configDir = (env = process.env) => configCandidates(env)[0].dir;

export const projectsDirs = (env = process.env) => configCandidates(env).map((c) => join(c.dir, 'projects')).filter((d) => existsSync(d));
export const projectsDir = (env = process.env) => join(configDir(env), 'projects');
export const slugOf = (dir) => String(dir || '').replace(/[^A-Za-z0-9]/g, '-');

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

export const agentFile = (name) => /^agent-.+\.jsonl$/.test(String(name || ''));
export const agentIdOf = (file) => { const n = basename(String(file || '')); return agentFile(n) ? n.slice('agent-'.length, -'.jsonl'.length) : ''; };

export const TOKEN_KEYS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
export const TOKENS_UNMEASURED = 'tokens not recorded by this host';
export const usageRecorded = (usage) => TOKEN_KEYS.some((k) => Number(usage?.[k]) > 0);
// A token figure for the report layer: the number when its host recorded it, the words when it did
// not. Only a figure known to be unrecorded is turned into words; a reader that never asked leaves a
// number alone.
export const tokenFigure = (n, recorded) => (recorded === false ? TOKENS_UNMEASURED : n);
