// Shared by the fact-verb tests: a scratch home, git repos with commits, `lpk` run as the agent runs
// it, and a stand-in `gh` that answers from a fixture of argument lines.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const tmp = mkdtempSync(join(tmpdir(), 'lpk-verbs-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const BIN = join(tmp, 'bin');
// `lib/host.mjs` answers for the host whose names the environment carries, so both families are
// dropped from what a child inherits: a suite launched by Qoder would else hand its own
// `QODER_SESSION_ID` to every `lpk` run here, and a test could pass or fail by who started it. The
// helper's own `CLAUDE_*` is what a child runs under.
export const noHost = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(CLAUDE|QODER)_/.test(k)));
export const ENV = {
  ...noHost(process.env), HOME: join(tmp, 'home'), PATH: `${BIN}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: join(tmp, 'claude'), CLAUDE_CODE_SESSION_ID: '',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  XDG_DATA_HOME: join(tmp, 'data'), XDG_STATE_HOME: join(tmp, 'state'), XDG_CACHE_HOME: join(tmp, 'cache'), FAKE_GH: join(tmp, 'gh.json'),
};
delete ENV.NODE_TEST_CONTEXT;
export const sh = (cwd, ...args) => execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
export const write = (dir, path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
export const lpk = (cwd, ...args) => spawnSync('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: ENV, encoding: 'utf8' });
export const lpkAsync = (cwd, ...args) => new Promise((done) => {
  const c = spawn('node', [join(ROOT, 'bin', 'lpk'), ...args], { cwd, env: ENV });
  let out = '';
  c.stdout.on('data', (b) => { out += b; });
  c.stderr.on('data', (b) => { out += b; });
  c.on('close', (status) => done({ status, out }));
});
export const commit = (repo, msg, files) => { for (const [p, t] of Object.entries(files)) write(repo, p, t); sh(repo, 'add', '-A'); sh(repo, 'commit', '-qm', msg); return sh(repo, 'rev-parse', 'HEAD').trim(); };

// A repo on `main` with the given files, switched to a branch `feat`.
export function repoWith(name, files) {
  const repo = join(tmp, name);
  mkdirSync(repo, { recursive: true });
  sh(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'init', files);
  sh(repo, 'switch', '-qc', 'feat');
  return repo;
}

// `gh` answers each call with the fixture's value for its arguments joined by spaces, else fails.
mkdirSync(BIN, { recursive: true });
writeFileSync(join(BIN, 'gh'), `#!/usr/bin/env node
const f = JSON.parse(require('fs').readFileSync(process.env.FAKE_GH, 'utf8'));
const k = process.argv.slice(2).join(' ');
if (!(k in f)) { process.stderr.write('fake gh: no answer for ' + k + '\\n'); process.exit(1); }
process.stdout.write(JSON.stringify(f[k]));
`);
chmodSync(join(BIN, 'gh'), 0o755);
export const ghAnswers = (map) => writeFileSync(ENV.FAKE_GH, JSON.stringify(map));
