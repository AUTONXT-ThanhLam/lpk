// The outside tools lpk uses, so a teammate who installs the plugin has them too: gitleaks is
// fetched once, at a pinned version checked against its release checksums, into lpk's own bin
// directory; OpenCodeReview runs through npx at a pinned version; the rest are reported.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const GITLEAKS = '8.30.1';
export const BIN = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'lpk', 'bin');
const WIN = process.platform === 'win32';
export const OWN_GITLEAKS = join(BIN, WIN ? 'gitleaks.exe' : 'gitleaks');

const runs = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore', timeout: 20000 }).status === 0;

// The gitleaks to run: the one on PATH, else lpk's own, else none.
export function gitleaks() {
  if (runs('gitleaks', ['version'])) return 'gitleaks';
  return existsSync(OWN_GITLEAKS) ? OWN_GITLEAKS : null;
}

export function installGitleaks() {
  const have = gitleaks();
  if (have) return { path: have };
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[process.platform];
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch];
  if (!os || !arch) return { error: `no gitleaks build for ${process.platform}/${process.arch}` };
  const name = `gitleaks_${GITLEAKS}_${os}_${arch}.${WIN ? 'zip' : 'tar.gz'}`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS}`;
  mkdirSync(BIN, { recursive: true });
  const tmp = mkdtempSync(join(BIN, '.download-'));
  try {
    const get = (file, out) => runs('curl', ['-fsSL', '--max-time', '120', '-o', join(tmp, out), `${url}/${file}`]);
    if (!get(name, 'tgz') || !get(`gitleaks_${GITLEAKS}_checksums.txt`, 'sums')) return { error: `could not download ${url}/${name}` };
    const want = readFileSync(join(tmp, 'sums'), 'utf8').split('\n').find((l) => l.endsWith(`  ${name}`))?.split(' ')[0];
    const got = createHash('sha256').update(readFileSync(join(tmp, 'tgz'))).digest('hex');
    if (!want || want !== got) return { error: `${name} does not match its published checksum` };
    const tar = WIN ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    if (!runs(tar, [WIN ? '-xf' : '-xzf', join(tmp, 'tgz'), '-C', tmp, basename(OWN_GITLEAKS)])) return { error: `could not unpack ${name}` };
    renameSync(join(tmp, basename(OWN_GITLEAKS)), OWN_GITLEAKS);
    return { path: OWN_GITLEAKS };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// One line per tool: ready, or what is missing and what lpk loses without it.
export function setup() {
  const g = installGitleaks();
  const chrome = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].some((c) => runs(c, ['--version']))
    || existsSync('/Applications/Google Chrome.app');
  return [
    ['git', runs('git', ['--version']), 'required'],
    ['gh', runs('gh', ['auth', 'status']), 'install it and run `gh auth login`: PR, CI and review commands need it'],
    ['gitleaks', !g.error, `the push guard cannot look for committed secrets (${g.error})`],
    ['npx', runs('npx', ['--version']), 'OpenCodeReview and the Chrome DevTools server run through it'],
    ['chrome', chrome, 'proof on a running web app needs Google Chrome or Chromium'],
  ].map(([name, ok, why]) => `${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `: ${why}`}`);
}
