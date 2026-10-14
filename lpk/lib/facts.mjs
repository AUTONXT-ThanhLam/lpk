// The review bundle for one change: per-group diffs, base versions, every place a touched
// identifier is used outside the diff, the commits and the commands CI runs. Facts only.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ciCommands, commits, git, VENDORED } from './git.mjs';
import { envReads } from './rules.mjs';

const SKIP = /package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|Cargo\.lock$|\.min\.(js|css)$|\.snap$/;

export function splitDiff(raw) {
  const files = [];
  for (const sec of raw.split(/^(?=diff --git )/m).filter(Boolean)) {
    const m = sec.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    if (!m) continue;
    const path = m[2];
    const status = /^new file/m.test(sec) ? 'added' : /^deleted file/m.test(sec) ? 'deleted' : /^rename from/m.test(sec) ? 'renamed' : 'modified';
    let added = 0, removed = 0;
    for (const l of sec.split('\n')) {
      if (l.startsWith('+') && !l.startsWith('+++')) added++;
      else if (l.startsWith('-') && !l.startsWith('---')) removed++;
    }
    const from = sec.match(/^rename from (.+)$/m)?.[1] || path;
    files.push({ path, from, status, added, removed, skipped: /^Binary files /m.test(sec) || VENDORED.test(path) || SKIP.test(path), text: sec });
  }
  return files;
}

// Path-sorted neighbours, at most 5 files and maxLines changed lines per group; maxLines grows
// with the change so a large one still yields about 12 groups. A file over twice that is split
// at hunk boundaries.
export function group(files) {
  const live = files.filter((f) => !f.skipped);
  const total = live.reduce((n, f) => n + f.added + f.removed, 0);
  const maxLines = Math.min(1500, Math.max(500, Math.ceil(total / 12)));
  const units = [];
  for (const f of live) {
    const size = f.added + f.removed;
    if (size <= 2 * maxLines) { units.push({ files: [f.path], lines: size, text: f.text }); continue; }
    const [head, ...hunks] = f.text.split(/^(?=@@ )/m);
    let cur = [], n = 0, part = 1;
    const flush = () => { if (cur.length) units.push({ files: [`${f.path}#part${part++}`], lines: n, text: head + cur.join('') }); cur = []; n = 0; };
    for (const h of hunks) {
      const k = h.split('\n').filter((l) => /^[+-]/.test(l)).length;
      if (n + k > maxLines) flush();
      cur.push(h); n += k;
    }
    flush();
  }
  const groups = [];
  for (const u of units) {
    const g = groups[groups.length - 1];
    if (g && g.files.length < 5 && g.lines + u.lines <= maxLines && u.lines <= maxLines) { g.files.push(...u.files); g.lines += u.lines; g.text += u.text; }
    else groups.push({ ...u, files: [...u.files] });
  }
  return groups.map((g, i) => ({ id: `g${i + 1}`, ...g }));
}

const DECL = [
  /\b(?:function|class|interface|type|enum|def|fn|struct|trait)\s+([A-Za-z_]\w{2,})/g,
  /\b(?:const|let|var)\s+([A-Za-z_]\w{2,})\s*[=:]/g,
  /^\s*(?:export\s+)?(?:async\s+)?([A-Za-z_]\w{2,})\s*\([^)]*\)\s*[:{]/g,
  /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_]\w{2,})/g,
  /\b(?:func|fun)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w{2,})\s*[(<]/g,
  /^\s*(?:(?:public|private|protected|internal|static|final|override|virtual|abstract|synchronized|async)\s+)+[\w<>[\],.?]+\s+([A-Za-z_]\w{2,})\s*\(/g,
];
const ROUTE = /['"`](\/(?:api|v\d)\/[A-Za-z0-9_\-/:{}.]+)['"`]/g;
// A key of an object, a JSON or YAML map, a type or a struct: removed, every reader of it breaks.
const FIELD = /^\s*['"]?([A-Za-z_]\w{2,})['"]?\??\s*:(?!:)/;
const COMMON = new Set(['constructor', 'render', 'useEffect', 'useState', 'async', 'await', 'return', 'function', 'const', 'default', 'props', 'value', 'error', 'result', 'data', 'test', 'describe']);
const specific = (n) => n.length >= 4 && (/[A-Z_]/.test(n.slice(1)) || /^[A-Z]/.test(n) || n.length >= 8);
const KEYWORD = /^(if|for|while|switch|catch|return|elif|else|with|match|function|foreach|until|unless)$/;
const PATHS = ['--', '.', ':!*.md', ':!*.lock', ':!*.snap', ':!*-lock.json'];

// Identifiers, routes and env keys the change declares or removes, ranked removed-first.
// `bodies` names the functions whose body the change edits, with the file each is in.
export function touched(files, bodies = []) {
  const ids = new Map();
  const note = (name, kind, side, path) => {
    const e = ids.get(name) || { name, kind, sides: new Set(), paths: new Set() };
    e.sides.add(side); e.paths.add(path); ids.set(name, e);
  };
  for (const [name, path] of bodies) note(name, 'symbol', 'body', path);
  for (const f of files.filter((x) => !x.skipped)) for (const l of f.text.split('\n')) {
    if (!/^[+-]/.test(l) || /^(\+\+\+|---)/.test(l)) continue;
    const side = l[0] === '+' ? 'added' : 'removed';
    for (const re of DECL) for (const m of l.slice(1).matchAll(re)) note(m[1], 'symbol', side, f.path);
    for (const m of l.matchAll(ROUTE)) note(m[1], 'route', side, f.path);
    for (const name of envReads(l)) note(name, 'env', side, f.path);
    const key = side === 'removed' && l.slice(1).match(FIELD);
    if (key && !ids.has(key[1])) note(key[1], 'field', side, f.path);
  }
  const rank = (e) => (e.sides.size === 1 && e.sides.has('removed') ? 0 : e.kind !== 'symbol' ? 1 : 2);
  const kept = [...ids.values()].filter((e) => !['symbol', 'field'].includes(e.kind) || (!COMMON.has(e.name) && (specific(e.name) || (e.sides.has('body') && e.name.length >= 4))))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  // Forty names, and up to eighty when more than twenty of them were removed: a removal is what breaks a reader.
  const removed = kept.filter((e) => rank(e) === 0).length;
  return kept.slice(0, Math.min(80, Math.max(40, removed + 20)));
}

// For each changed line, the nearest declaration above it in the changed file: the function whose
// body changed, whose callers matter even when no declaration line changed.
function bodiesOf(repo, files, at) {
  const out = [];
  for (const f of files.filter((x) => !x.skipped && x.status !== 'deleted')) {
    const lines = git(['show', `${at}:${f.path}`], repo).split('\n');
    for (const h of f.text.matchAll(/^@@ -\S+ \+(\d+)/gm)) {
      for (let i = Math.min(Number(h[1]), lines.length) - 1; i >= 0; i--) {
        const m = DECL.flatMap((re) => [...lines[i].matchAll(re)]).find((x) => !KEYWORD.test(x[1]));
        if (m) { out.push([m[1], f.path]); break; }
      }
    }
  }
  return out;
}

// Each sibling is searched where `refs` says (siblingRefs): a branch, or its folder ('').
function impact(repo, files, sibs, refs, bodies) {
  const changed = new Set(files.map((f) => f.path));
  const lines = ['# Where the touched identifiers are used outside the diff', ''];
  for (const e of touched(files, bodies)) {
    const sides = [...e.sides].filter((x) => x !== 'body');
    const label = sides.length === 2 ? 'changed' : sides[0] ?? 'body changed';
    lines.push(`## ${e.name} (${e.kind}, ${label} in ${[...e.paths].join(', ')})`);
    const hits = git(['grep', '-n', '-w', '-F', '-I', e.name, ...PATHS], repo).split('\n').filter(Boolean);
    const outside = hits.filter((h) => !changed.has(h.split(':')[0]));
    lines.push(`- this repo: ${hits.length - outside.length} hits in changed files, ${outside.length} elsewhere`);
    if (outside.length > 60) lines.push('  - (too common to list)');
    else for (const h of outside.slice(0, 12)) lines.push(`  - ${h.slice(0, 220)}`);
    for (const s of sibs) {
      const ref = refs.get(s) || '';
      const sh = git(['grep', '-n', '-w', '-F', '-I', e.name, ...(ref ? [ref] : []), ...PATHS], s).split('\n').filter(Boolean).map((h) => (ref ? h.slice(ref.length + 1) : h));
      const where = `${s} at ${ref || 'its working tree'}`;
      if (sh.length > 60) lines.push(`- ${where}: ${sh.length} hits (too common to list)`);
      else if (sh.length) { lines.push(`- ${where}: ${sh.length} hits`); for (const h of sh.slice(0, 8)) lines.push(`  - ${h.slice(0, 220)}`); }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// Writes the bundle under `out` and returns its summary. `base` is a commit; with `cached`
// the staged changes are the change, otherwise base..HEAD.
export function buildBundle({ repo, base, out, cached = false, sibs = [], refs = new Map() }) {
  const range = cached ? ['--cached', base] : [base, 'HEAD'];
  const raw = git(['diff', '--find-renames', '-U5', ...range], repo);
  const files = splitDiff(raw);
  const groups = group(files);
  mkdirSync(join(out, 'base'), { recursive: true });
  for (const g of groups) writeFileSync(join(out, `${g.id}.diff`), g.text);
  for (const f of files.filter((x) => !x.skipped && x.status !== 'added')) {
    const dest = join(out, 'base', f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, git(['show', `${base}:${f.from}`], repo));
  }
  writeFileSync(join(out, 'full.diff'), raw);
  writeFileSync(join(out, 'impact.md'), impact(repo, files, sibs, refs, bodiesOf(repo, splitDiff(git(['diff', '--find-renames', '-U0', ...range], repo)), cached ? '' : 'HEAD')));
  const summary = {
    repo, base, out, siblings: sibs,
    files: files.map(({ path, status, added, removed, skipped }) => ({ path, status, added, removed, skipped })),
    groups: groups.map(({ id, files: fs, lines }) => ({ id, files: fs, lines, diff: join(out, `${id}.diff`) })),
    commits: cached ? [] : commits(repo, `${base}..HEAD`),
    ci: ciCommands(repo),
  };
  writeFileSync(join(out, 'bundle.json'), JSON.stringify(summary, null, 1));
  return summary;
}
