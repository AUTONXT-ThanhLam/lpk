import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join, relative, resolve } from 'node:path';
import { gitPath } from './git.mjs';
import { candidates, CATALOG, LEARNED, NOT_CODE, TEST } from './rules.mjs';

export const AST_DIRS = [['plugin', join(CATALOG, 'ast')], ['learned', join(LEARNED, 'ast')]];
export const LEARNED_AST = AST_DIRS[1][1];
export const INSTALL = 'npm i -g @ast-grep/cli@0.51.0';
export const MISSING = `ast-grep: not installed, so only the regex patterns ran; install it with \`${INSTALL}\``;
const ARG_MAX = 100000;

export function ruleFiles(dir) {
  try { return readdirSync(dir).filter((n) => /\.ya?ml$/.test(n) && !/^sgconfig\.ya?ml$/.test(n)).sort().map((n) => join(dir, n)); } catch { return []; }
}

export const baseId = (id) => id.replace(/\.[a-z]+$/i, '');
export const idsOf = (file) => [...new Set([...readFileSync(file, 'utf8').matchAll(/^id:\s*(\S+)/gm)].map((m) => baseId(m[1])))];

export function astGrepBin(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return 'ast-grep';
  for (const dir of (env.PATH || env.Path || '').split(delimiter).filter(Boolean)) {
    for (const exe of [join(dir, 'ast-grep.exe'), join(dir, 'node_modules', '@ast-grep', 'cli', 'ast-grep.exe')]) if (existsSync(exe)) return exe;
  }
  return 'ast-grep';
}

const sg = (args, cwd) => spawnSync(astGrepBin(), args, { cwd, encoding: 'utf8', maxBuffer: 256 * 2 ** 20, env: { ...process.env, NO_COLOR: '1' } });
const reason = (stderr) => (stderr.split('\n').filter((l) => l.startsWith('╰▻')).at(-1) || stderr.trim().split('\n')[0] || 'failed').replace(/^╰▻\s*/, '');

function scanWith(repo, files, paths) {
  const text = files.map((f) => readFileSync(f, 'utf8').replace(/^---[ \t]*\r?\n/, '')).join('\n---\n');
  const r = sg(['scan', '--inline-rules', text, '--json=stream', '--', ...paths], repo);
  if (r.error?.code === 'ENOENT') return { missing: true };
  if (r.error) return { error: r.error.message };
  if (r.status !== 0 && !(r.status === 1 && r.stdout.trim())) return { error: reason(r.stderr) };
  return { hits: r.stdout.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) };
}

function batches(files) {
  const out = [[]];
  let size = 0;
  for (const f of files) {
    const n = readFileSync(f, 'utf8').length;
    if (size + n > ARG_MAX && out.at(-1).length) { out.push([]); size = 0; }
    out.at(-1).push(f);
    size += n;
  }
  return out;
}

export function astScan(repo, paths) {
  const files = AST_DIRS.flatMap(([, dir]) => ruleFiles(dir));
  const res = { hits: [], broken: [], missing: false, rules: files.length };
  if (!files.length || !paths.length) return res;
  for (const batch of batches(files)) {
    const r = scanWith(repo, batch, paths);
    if (r.missing) return { ...res, missing: true };
    if (r.hits) { res.hits.push(...r.hits); continue; }
    for (const f of batch) {
      const one = scanWith(repo, [f], paths);
      if (one.hits) res.hits.push(...one.hits);
      else res.broken.push(`${f}: ${one.error}`);
    }
  }
  return res;
}

const TEST_RULES = new Set(['tests-prove', 'no-comments']);

export function astCandidates(repo, files, only) {
  const live = files.filter((f) => f.status !== 'deleted' && f.added.length
    && (!NOT_CODE.test(f.path) || /\.ya?ml$/.test(f.path)) && (!only || only.includes(f.path)) && existsSync(join(repo, f.path)));
  const s = astScan(repo, live.map((f) => f.path));
  const byPath = new Map(live.map((f) => [f.path, f]));
  const seen = new Set();
  const cands = [];
  for (const h of s.hits) {
    const f = byPath.get(h.file) || byPath.get(gitPath(relative(repo, resolve(repo, h.file))));
    const a = f?.added.find((x) => x.n >= h.range.start.line + 1 && x.n <= h.range.end.line + 1);
    const id = baseId(h.ruleId);
    if (f && TEST.test(f.path) && !TEST_RULES.has(id)) continue;
    const key = a &&`${id}|${f.path}|${a.n}`;
    if (!a || seen.has(key)) continue;
    seen.add(key);
    cands.push({ id, path: f.path, n: a.n, text: a.text.trim().slice(0, 160) });
  }
  return { cands, missing: s.missing, broken: s.broken };
}

const keyOf = (c) => `${c.id}|${c.path}|${c.n}`;
export function allCandidates(repo, rules, files, only) {
  const ast = astCandidates(repo, files, only);
  const keys = new Set(ast.cands.map(keyOf));
  const cands = [...candidates(rules, files).filter((c) => !keys.has(keyOf(c))), ...ast.cands]
    .sort((a, b) => a.path.localeCompare(b.path) || a.n - b.n || a.id.localeCompare(b.id));
  return { cands, missing: ast.missing, broken: ast.broken };
}

export const astNotes = ({ missing, broken }) => [
  ...(missing ? [MISSING] : []),
  ...(broken.length ? ['', 'ast rules skipped because ast-grep could not load them:', ...broken.map((b) => `  ${b}`)] : []),
];

const LEARNED_CONFIG = 'ruleDirs:\n  - .\ntestConfigs:\n  - testDir: tests\n';
const LEARNED_IGNORE = 'sgconfig.yml\ntests/\ndisabled/\n';

export function astTest() {
  const lines = [];
  let ok = true;
  for (const [name, dir] of AST_DIRS) {
    if (!ruleFiles(dir).length) { lines.push(`${name} ast rules (${dir}): none`); continue; }
    if (dir === LEARNED_AST && !existsSync(join(dir, 'sgconfig.yml'))) {
      writeFileSync(join(dir, 'sgconfig.yml'), LEARNED_CONFIG);
      if (!existsSync(join(dir, '.ignore'))) writeFileSync(join(dir, '.ignore'), LEARNED_IGNORE);
      lines.push(`${name} ast rules: wrote ${join(dir, 'sgconfig.yml')}`);
    }
    const untested = ruleFiles(dir).flatMap((f) => idsOf(f).filter((id) => !['yml', 'yaml'].some((e) => existsSync(join(dir, 'tests', `${id}-test.${e}`)))).map((id) => `${id} (in ${f})`));
    if (untested.length) { ok = false; lines.push(`${name} ast rules (${dir}): FAIL, no tests/<id>-test.yml for: ${untested.join(', ')}`); continue; }
    const r = sg(['test', '--skip-snapshot-tests'], dir);
    if (r.error?.code === 'ENOENT') return { ok: false, text: [...lines, MISSING.replace('so only the regex patterns ran', 'so no ast rule can be tested')].join('\n') };
    if (r.status !== 0) ok = false;
    lines.push(`${name} ast rules (${dir}): ${r.status === 0 ? 'PASS' : `FAIL (exit ${r.status ?? r.error?.message})`}`, ...`${r.stdout}${r.stderr}`.trim().split('\n').map((l) => `  ${l}`));
  }
  return { ok, text: lines.join('\n') };
}
