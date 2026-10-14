// The rule catalog, which rules a change loads, and the literal candidates `lpk check` reports.
// Every answer is an exact fact about the diff; whether a candidate is a defect is the agent's call.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, superproject, VENDORED } from './git.mjs';

// The plugin's rules: catalog.md, then every other file in rules/ in name order.
export const CATALOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules');
export const LEARNED = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'lpk', 'rules');
// Tests and what only tests use (fixtures, mocks, test data, e2e scripts), in any common language.
export const TEST = /(^|\/)([Tt]ests?|__tests__|__mocks__|__fixtures__|fixtures|testdata|test-utils|specs?|e2e|cypress|[\w.-]+\.Tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*|conftest)\.py$|_test\.(py|go|exs|dart|c|cc|cpp)$|_spec\.rb$|Tests?\.(java|kt|scala|cs|fs|swift|php)$|(^|\/)[^/]*e2e[^/]*\.(sh|[cm]?[jt]s)$/;
// Source code in any common language: what the verify gate, the push guard and mutate act on.
export const CODE = /\.([cm]?[jt]sx?|py|go|rs|java|kt|kts|scala|groovy|rb|php|cs|fs|vue|svelte|swift|m|mm|c|h|cc|cpp|cxx|hpp|ex|exs|erl|dart|lua|clj|hs|ml|jl|r|sh|bash|zsh|ps1|sql)$/i;
const NOT_CODE = /\.(md|txt|rst|json|lock|snap|svg|png|jpe?g|gif|ico|csv)$/i;
const code = (re) => re.match(/`(.+)`/)?.[1];
// Patterns that do not compile or are not in the expected form are skipped and listed here, so one bad learned rule
// cannot stop every command.
export const broken = [];
const compile = (src, flags, where) => {
  try { return new RegExp(src, flags); } catch (e) { broken.push(`${where}: \`${src}\` (${e.message})`); return null; }
};

// Rules from one markdown file: `### id: title` blocks with `- key: value` lines.
export function parseRules(text, source) {
  const rules = [];
  let area = '';
  for (const block of text.split(/^(?=##+ )/m)) {
    const head = block.match(/^(##+) (.+)$/m);
    if (!head) continue;
    if (head[1] === '##') { area = head[2].trim(); continue; }
    const colon = head[2].indexOf(':');
    const id = colon < 0 ? head[2] : head[2].slice(0, colon);
    const r = { raw: block, id: id.trim(), title: colon < 0 ? '' : head[2].slice(colon + 1).trim(), area, source, blocks: 'medium', when: [], find: [], rule: '', check: '' };
    for (const m of block.matchAll(/^- (blocks|when|find|rule|check): (.+)$/gm)) {
      const [, k, v] = m;
      if (k === 'when') {
        const [kind] = v.split(/\s/);
        const re = code(v);
        if (kind === 'always' || kind === 'removed') r.when.push({ kind, src: '' });
        else if ((kind === 'added' || kind === 'path') && re) {
          const rx = compile(re, 'i', `${source} ${r.id}`);
          if (rx) r.when.push({ kind, re: rx, src: re });
        } else broken.push(`${source} ${r.id}: \`when: ${v.trim()}\` (a trigger is always, removed, added \`regex\` or path \`regex\`)`);
      } else if (k === 'find') {
        // `find: \`line regex\`` or `find: \`line regex\` in path \`path regex\``.
        const m = v.trim().match(/^`(.+?)`(?:\s+in path `(.+)`)?$/);
        if (!m) broken.push(`${source} ${r.id}: \`find: ${v.trim()}\` (the pattern goes in backticks)`);
        const rx = m && compile(m[1], '', `${source} ${r.id}`);
        const at = m && m[2] ? compile(m[2], '', `${source} ${r.id}`) : undefined;
        if (rx && at !== null) r.find.push(Object.assign(rx, { at }));
      } else r[k] = v.trim();
    }
    rules.push(r);
  }
  return rules;
}

// A block under an existing id extends that rule: its triggers and patterns are added, and only
// the fields it states replace the original's.
function merge(rules, more) {
  for (const r of more) {
    const same = rules.find((x) => x.id === r.id);
    if (!same) { rules.push(r); continue; }
    same.when.push(...r.when);
    same.find.push(...r.find);
    for (const k of ['title', 'rule', 'check']) if (r[k]) same[k] = r[k];
    if (/^- blocks: /m.test(r.raw)) same.blocks = r.blocks;
    same.extendedBy = [...(same.extendedBy || []), r.source];
  }
}

// The plugin's rules plus learned rules: `all.md` for every repo and `<repo>.md` for this one.
export function loadRules(repo) {
  const rules = [];
  const own = readdirSync(CATALOG).filter((n) => n.endsWith('.md')).sort((a, b) => (b === 'catalog.md') - (a === 'catalog.md') || a.localeCompare(b));
  for (const f of own) merge(rules, parseRules(readFileSync(join(CATALOG, f), 'utf8'), f === 'catalog.md' ? 'catalog' : `catalog/${f}`));
  if (existsSync(LEARNED)) {
    const name = basename(repo || '');
    for (const f of readdirSync(LEARNED).filter((n) => n === 'all.md' || n === `${name}.md`).sort())
      merge(rules, parseRules(readFileSync(join(LEARNED, f), 'utf8'), join(LEARNED, f)));
  }
  return rules;
}

// The change as files with their added lines (number and text): base to the working tree,
// including staged, unstaged and untracked files, so it works before the first commit too.
export function changeOf(repo, base) {
  const files = new Map();
  const get = (path) => files.get(path) || files.set(path, { path, added: [], removed: 0, status: 'modified' }).get(path);
  // Header lines (`+++ b/x`, `--- a/x`) come only before a file's first hunk; inside a hunk
  // a line `++i` is the added line `++i`.
  let cur = null, line = 0, inHunk = false;
  for (const l of git(['diff', '--find-renames', '-U0', '--no-color', base, '--'], repo).split('\n')) {
    const h = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (h) { cur = get(h[2]); inHunk = false; continue; }
    if (!cur) continue;
    const hunk = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { line = Number(hunk[1]); inHunk = true; continue; }
    if (!inHunk) {
      if (l.startsWith('new file')) cur.status = 'added';
      else if (l.startsWith('deleted file')) cur.status = 'deleted';
      continue;
    }
    if (l.startsWith('+')) cur.added.push({ n: line++, text: l.slice(1) });
    else if (l.startsWith('-')) cur.removed++;
  }
  for (const p of git(['ls-files', '--others', '--exclude-standard'], repo).split('\n').filter(Boolean)) {
    let text = '';
    try { text = readFileSync(join(repo, p), 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    const f = get(p);
    f.status = 'added';
    f.added = text.split('\n').map((t, i) => ({ n: i + 1, text: t }));
  }
  return [...files.values()].filter((f) => !VENDORED.test(f.path) && !/-lock\.json$|\.lock$|lock\.yaml$/.test(f.path));
}

const isSource = (f) => !TEST.test(f.path) && !NOT_CODE.test(f.path);

// Why each rule applies to this change: the first fact that loads it, or none.
export function triggered(rules, files) {
  const src = files.filter(isSource);
  const out = [];
  for (const r of rules) {
    let why = '';
    for (const w of r.when) {
      if (w.kind === 'always' && src.length) why = 'always (source code changed)';
      else if (w.kind === 'removed') { const f = src.find((x) => x.removed > 0); if (f) why = `removed or changed lines in ${f.path}`; }
      else if (w.kind === 'path') { const f = files.find((x) => w.re.test(x.path)); if (f) why = `changed path ${f.path} matches \`${w.src}\``; }
      else if (w.kind === 'added') {
        for (const f of src) { const a = f.added.find((x) => w.re.test(x.text)); if (a) { why = `${f.path}:${a.n} \`${a.text.trim().slice(0, 100)}\``; break; } }
      }
      if (why) break;
    }
    if (why) out.push({ rule: r, why });
  }
  return out;
}

// Literal candidates: every added line that matches a rule's `find` pattern, in the paths it names.
export function candidates(rules, files) {
  const out = [];
  for (const r of rules) for (const re of r.find) for (const f of files) {
    if (NOT_CODE.test(f.path) && !/\.ya?ml$/.test(f.path)) continue;
    if (re.at && !re.at.test(f.path)) continue;
    // A pattern may span two added lines (`except Exception:` then `pass`): it is reported on the first.
    f.added.forEach((a, k) => {
      const next = f.added[k + 1]?.n === a.n + 1 ? f.added[k + 1].text : null;
      if (re.test(a.text) || (next !== null && !re.test(next) && re.test(`${a.text}\n${next}`))) out.push({ id: r.id, path: f.path, n: a.n, text: a.text.trim().slice(0, 160) });
    });
  }
  return out;
}

const ENV_READ = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g, /process\.env\[['"]([A-Z][A-Z0-9_]+)['"]\]/g, /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
  /os\.environ(?:\.get)?\(\s*['"]([A-Z][A-Z0-9_]+)/g, /os\.environ\[['"]([A-Z][A-Z0-9_]+)/g, /getenv\(\s*['"]([A-Z][A-Z0-9_]+)/g,
  /Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]+)/g, /\b(?:Getenv|LookupEnv|GetEnvironmentVariable|env::var(?:_os)?)\(\s*['"]([A-Z][A-Z0-9_]+)/g,
  /\bENV(?:\.fetch\(\s*|\[\s*)['"]([A-Z][A-Z0-9_]+)/g,
];
// Env names one line of code reads, in the forms above.
export const envReads = (text) => ENV_READ.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));
// `const { A, B: b = 'x' } = process.env` names A and B.
const DESTRUCTURE = /\{([^}]*)\}\s*=\s*(?:process\.env|import\.meta\.env|Deno\.env\.toObject\(\))/;
const DEPLOY = /(^|\/)((docker-)?compose[^/]*\.ya?ml|\.env[^/]*|Dockerfile[^/]*|Containerfile|Procfile|[^/]*platform[^/]*\.ya?ml|values[^/]*\.ya?ml|[^/]*\.tf(vars)?|fly\.toml|render\.ya?ml|vercel\.json|netlify\.toml|app\.ya?ml|serverless\.ya?ml|wrangler\.toml)$|(^|\/)(helm|k8s|kubernetes|deploy|deployment|charts|infra|terraform|\.github\/workflows)\//i;

// Env names that added code reads, with every deploy file (this repo, its siblings and the
// superproject) that mentions them. An empty `seen` list is the fact `deploy-wiring` asks about.
export function envWiring(repo, files, sibs = []) {
  const names = new Map();
  const note = (name, at) => { if (!names.has(name)) names.set(name, at); };
  for (const f of files.filter(isSource)) for (const a of f.added) {
    for (const name of envReads(a.text)) note(name, `${f.path}:${a.n}`);
    const d = a.text.match(DESTRUCTURE);
    if (d) for (const part of d[1].split(',')) { const n = part.trim().match(/^([A-Z][A-Z0-9_]+)\b/); if (n) note(n[1], `${f.path}:${a.n}`); }
  }
  if (!names.size) return [];
  const { sup } = superproject(repo);
  const roots = [repo, ...sibs, ...(sup ? [sup] : [])];
  const deploy = [];
  for (const root of roots) {
    const tracked = git(['ls-files', '--cached', '--others', '--exclude-standard'], root).split('\n').filter((p) => DEPLOY.test(p));
    for (const p of tracked) { try { deploy.push({ path: root === repo ? p : join(root, p), text: readFileSync(join(root, p), 'utf8') }); } catch { /* listed but absent on disk */ } }
  }
  return [...names].map(([name, at]) => ({
    name, at,
    seen: deploy.filter((d) => new RegExp(`\\b${name}\\b`).test(d.text)).map((d) => d.path),
  }));
}
