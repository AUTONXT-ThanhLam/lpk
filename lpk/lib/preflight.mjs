// What a run needs from the machine, checked at once in under five seconds: the repo and its base,
// the git author, gh, the lpk Chrome, free memory, gitleaks, and settings that remap models. It
// prints facts; it refuses only when there is no repo or no base, since nothing after that can work.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { defaultBranch, git, mergeBase, top } from './git.mjs';
import { astGrepBin, INSTALL } from './ast.mjs';
import { remapWarning } from './safety.mjs';
import { OWN_GITLEAKS } from './tools.mjs';

// A command's exit code (or the error code when it could not start), killed after `ms`.
const exitOf = (cmd, args, cwd, ms) => new Promise((done) => {
  execFile(cmd, args, { cwd, timeout: ms }, (e) => done(!e ? 0 : e.code === 'ENOENT' ? 'missing' : e.killed ? 'timeout' : e.code ?? 1));
});

async function chrome(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
    return r.ok ? `Chrome on ${port}: up` : `Chrome on ${port}: answered ${r.status}`;
  } catch { return `Chrome on ${port}: not running (the prover, designer and ui-reviewer need it; start the lpk Chrome)`; }
}

function memory() {
  let kb = 0;
  try { kb = Number(/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1] || 0); } catch { /* not Linux */ }
  return `free memory: ${((kb ? kb * 1024 : freemem()) / 2 ** 30).toFixed(1)} GiB`;
}

export async function preflight(repo, { target = '', verify = [], env = process.env } = {}) {
  const t0 = Date.now();
  const root = repo ? top(repo) : '';
  if (!root) return { refuse: `${repo || 'this directory'} is not inside a git repository`, lines: [], ms: Date.now() - t0 };
  const ref = target || defaultBranch(root);
  const base = ref ? mergeBase(root, ref) : '';
  if (!base) return { refuse: ref ? `no merge base between ${ref} and HEAD` : 'no target branch given and none found (origin/HEAD, main, master)', lines: [], ms: Date.now() - t0 };
  const [gh, leaks, browser, sg] = await Promise.all([
    exitOf('gh', ['auth', 'status'], root, 3000),
    exitOf('gitleaks', ['version'], root, 3000),
    chrome(env.LPK_CHROME_PORT || 9333),
    exitOf(astGrepBin(), ['--version'], root, 3000),
  ]);
  const dirty = git(['status', '--porcelain'], root).split('\n').filter(Boolean).length;
  const author = ['user.name', 'user.email'].map((k) => git(['config', k], root).trim());
  const remap = remapWarning(env);
  const lines = [
    `repo: ${root}; tree ${dirty ? `has ${dirty} uncommitted path(s)` : 'clean'}`,
    `base: ${base.slice(0, 12)} (merge base with ${ref})`,
    verify.length ? `checks: ${verify.map((c) => `\`${c}\``).join(', ')}` : 'checks: none named',
    author.every(Boolean) ? `git author: ${author[0]} <${author[1]}>` : 'git author: NOT SET (git config user.name / user.email in this repo)',
    `gh: ${gh === 0 ? 'signed in' : gh === 'missing' ? 'not installed' : gh === 'timeout' ? 'did not answer in 3 s' : 'not signed in (`gh auth login`)'}`,
    browser,
    memory(),
    leaks === 0 || existsSync(OWN_GITLEAKS) ? 'gitleaks: installed' : 'gitleaks: missing; the PR body says secrets were not scanned (`lpk setup` fetches it)',
    sg === 0 ? 'ast-grep: installed' : `ast-grep: missing; lpk check runs only the regex patterns (\`${INSTALL}\`)`,
    ...(remap ? [remap] : []),
  ];
  return { refuse: '', lines, ms: Date.now() - t0 };
}
