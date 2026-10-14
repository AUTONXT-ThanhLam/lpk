// Census facts for "every path passes the guard": where a name is used, which tests mention
// those files, and every route or tool registration with whether a guard name appears in its
// handler. Untracked files count: the code under review is usually not committed yet.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { git, VENDORED } from './git.mjs';
import { TEST } from './rules.mjs';

const PATHS = ['--', '.', ':!*.md', ':!*.lock', ':!*.snap', ':!*-lock.json', ':!**/dist/**', ':!**/build/**'];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stem = (p) => basename(p).replace(/\.[^.]+$/, '');
// A test file's name without its test affix: x.test.ts, x_test.go, test_x.py, XTest.kt and x_spec.rb are all x.
const testStem = (t) => stem(t).replace(/\.(test|spec)$|_(test|spec)$|^test_|Tests?$|Spec$/, '');
const MANIFEST = /^(package\.json|go\.mod|Cargo\.toml|pyproject\.toml|setup\.py|pom\.xml|build\.gradle(\.kts)?|composer\.json|Gemfile|[^/]*\.csproj)$/;
// A root is read as its folder stands, or at `ref` (a sibling at its default branch).
const files = (root, ref) => [...new Set(git(ref ? ['ls-tree', '-r', '--name-only', ref] : ['ls-files', '--cached', '--others', '--exclude-standard'], root).split('\n').filter(Boolean))];
const read = (root, p, ref) => { if (ref) return git(['show', `${ref}:${p}`], root); try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };

// Every line in `root` that uses `name` as a word, grouped by file, with the tests of each
// non-test file by its language's own convention: Go tests are the package's `_test.go` files in
// the same directory; a Rust file may carry its own `#[cfg(test)]` module and is reached as
// `name::` from `tests/`; elsewhere a test imports the module or quotes its path, or sits beside it
// (or in the mirrored `test` tree) with the same name and a test affix. Whether a test that reaches
// the code another way (over HTTP, through a caller) covers it is the agent's call.
export function census(root, name, ref = '') {
  const hits = git(['grep', ...(ref ? [] : ['--untracked']), '-n', '-w', '-F', '-I', name, ...(ref ? [ref] : []), ...PATHS], root).split('\n').filter(Boolean).map((h) => (ref ? h.slice(ref.length + 1) : h));
  const byFile = new Map();
  for (const h of hits) {
    const [path, n, ...rest] = h.split(':');
    if (VENDORED.test(path)) continue;
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path).push({ n: Number(n), text: rest.join(':').trim().slice(0, 160) });
  }
  const all = files(root, ref);
  const tests = all.filter((p) => TEST.test(p) && !VENDORED.test(p));
  // The package a file belongs to: the nearest directory holding a manifest.
  const roots = new Set(all.filter((p) => MANIFEST.test(basename(p))).map((p) => dirname(p)));
  const pkgOf = (p) => { let d = dirname(p); while (d !== '.' && !roots.has(d)) d = dirname(d); return d; };
  const text = new Map(tests.map((t) => [t, null]));
  const load = (t) => { if (text.get(t) === null) text.set(t, read(root, t, ref)); return text.get(t); };
  const mentions = (file) => {
    const s = stem(file), dir = dirname(file);
    if (file.endsWith('.go')) return tests.filter((t) => t.endsWith('_test.go') && dirname(t) === dir);
    const pkg = pkgOf(file), mine = tests.filter((t) => pkgOf(t) === pkg);
    const own = file.endsWith('.rs') && /#\[cfg\(test\)\]|#\[test\]/.test(read(root, file, ref)) ? [`${file} (its own test module)`] : [];
    const beside = mine.filter((t) => testStem(t).toLowerCase() === s.toLowerCase());
    if (['index', 'mod', 'lib', 'main', '__init__'].includes(s)) return [...own, ...beside];
    // A short name (`kv`) counts only as the last part of an imported path.
    const quoted = `${s.length < 3 ? '/' : `['"/]`}${esc(s)}`;
    const ext = file.slice(file.lastIndexOf('.') + 1);
    const named = s.length < 3 ? '' : `|\\b(from|import|use)\\s+[\\w.:]*\\b${esc(s)}\\b|\\b${esc(s)}::`;
    const re = new RegExp(`${quoted}(\\.[cm]?[jt]sx?|\\.py|\\.${esc(ext)})?['"]${named}`);
    // A Rust test reaches only its own crate's modules by name.
    return [...own, ...new Set([...beside, ...(file.endsWith('.rs') ? mine : tests).filter((t) => re.test(load(t)))])];
  };
  return [...byFile].map(([path, lines]) => ({ path, test: TEST.test(path), lines, testedBy: TEST.test(path) ? [] : mentions(path) }));
}

// Call forms (Express, Fastify, Hono, Go net/http, gin, echo, chi, Laravel, axum) are matched
// without case; decorated forms are NestJS, Spring and ASP.NET.
const METHODS = 'get|post|put|patch|delete|all|any|head|options|handle|handlefunc|route';
// The receiver may sit on the line before (a chained `.route(`); Go 1.22 puts the method in the pattern.
// A handler argument follows the path, so `headers.Get("/")` or `cfg.Get("/etc/x")` is no route.
// TypeScript may type the call (`fastify.get<{ Body: B }>(`); a path may start from a template
// prefix (`${base}/health`) or be the catch-all `*`.
const JS_CALL = new RegExp(`(?:[\\w$)\\]]\\s*|^\\s*)(?:\\.|::)(${METHODS})(?:<[\\s\\S]*?>)?\\(\\s*['"\`](?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\s+)?((?:\\$\\{[^}]*\\})?/[^'"\`]*|\\*)['"\`]\\s*,`, 'i');
const ROUTE_OBJ = /\.route\(\s*\{/;
const PY_DECO = /^\s*@[\w.]+\.(get|post|put|patch|delete|websocket|route|api_route)\(\s*['"](\/[^'"]*)['"]([^\n]*)/;
const DECO = /@(Get|Post|Put|Patch|Delete|All|Request)(?:Mapping\b(?:\(([^)]*)\))?|\(([^)]*)\))|\[Http(Get|Post|Put|Patch|Delete)\b(?:\(([^)]*)\))?\]/;
const TOOL = /\.(tool|registerTool)\(\s*['"`]([^'"`]+)['"`]/;
const START = new RegExp(`(\\.|::)(${METHODS}|tool|registerTool)[(<]|@[\\w.]+\\.(${METHODS}|websocket|api_route)\\(|@(Get|Post|Put|Patch|Delete|All|Request)(Mapping\\b|\\()|\\[Http(Get|Post|Put|Patch|Delete)\\b`, 'i');
const ANY = new Set(['ALL', 'ANY', 'HANDLE', 'HANDLEFUNC', 'ROUTE', 'REQUEST']);
const FILE_HOOK = /\.(use|addHook|register|Use|Group)\(|preHandler|onRequest|Depends\(|dependencies\s*=|before_request|middleware|Middleware/;

// Index just past the bracket that closes the one at `at`, skipping strings and comments.
function closeOf(text, at, open, close) {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { const q = c; for (i++; i < text.length && text[i] !== q; i++) if (text[i] === '\\') i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) return text.length; i++; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return text.length;
}

// One registration found on line `i`, with the character range of its handler.
function registration(path, text, lines, offs, i) {
  const l = lines[i];
  const near = lines.slice(i, i + 15).join('\n');
  if (path.endsWith('.py')) {
    const m = l.match(PY_DECO);
    if (!m) return null;
    const methods = m[3].match(/methods\s*=\s*\[([^\]]*)\]/)?.[1].replace(/['"\s]/g, '');
    let d = i + 1;
    while (d < lines.length && !/^\s*(async\s+)?def\s/.test(lines[d])) d++;
    const indent = (lines[d] || '').search(/\S/);
    let e = d + 1;
    while (e < lines.length && (lines[e].trim() === '' || lines[e].search(/\S/) > indent)) e++;
    return { method: (methods || (m[1] === 'route' ? 'GET' : m[1])).toUpperCase(), target: m[2], from: offs[i], to: offs[Math.min(e, lines.length - 1)] };
  }
  const deco = l.match(DECO);
  if (deco) {
    // The handler span starts at the first annotation stacked above, where an authorization one sits.
    let a = i;
    while (a > 0 && /^\s*[@[]/.test(lines[a - 1])) a--;
    const b = text.indexOf('{', offs[i]);
    const method = (deco[1] || deco[4]).toUpperCase();
    return { method: ANY.has(method) ? 'ANY' : method, target: (deco[2] ?? deco[3] ?? deco[5] ?? '').match(/['"`]([^'"`]*)['"`]/)?.[1] || '(base path)', from: offs[a], to: b < 0 ? text.length : closeOf(text, b, '{', '}') };
  }
  const js = near.match(JS_CALL);
  const call = js ? [js[0], js[2] || js[1], js[3]] : near.match(TOOL);
  if (call && (js ? js.index : call.index) <= l.length) {
    const p = text.indexOf('(', offs[i] + (js ? js.index + js[0].search(/(\.|::)/) : call.index));
    const to = closeOf(text, p, '(', ')');
    let method = call[1] === 'registerTool' ? 'TOOL' : call[1].toUpperCase();
    // axum names the methods inside the call: `.route("/x", get(list).post(create))`.
    if (method === 'ROUTE') method = [...new Set([...text.slice(p, to).matchAll(/\b(get|post|put|patch|delete)\(/g)].map((m) => m[1].toUpperCase()))].join(',') || method;
    return { method: ANY.has(method) ? 'ANY' : method, target: call[2], from: offs[i], to };
  }
  if (ROUTE_OBJ.test(l)) {
    const p = text.indexOf('(', offs[i] + l.search(ROUTE_OBJ));
    const body = text.slice(p, closeOf(text, p, '(', ')'));
    const method = body.match(/method:\s*(\[[^\]]*\]|['"][A-Za-z]+['"])/)?.[1].replace(/[[\]'"\s]/g, '');
    const url = body.match(/(?:url|path):\s*['"`]([^'"`]+)/)?.[1];
    if (method && url) return { method: method.toUpperCase(), target: url, from: offs[i], to: p + body.length };
  }
  return null;
}

// Route and tool registrations in source files. For each guard name: whether it appears inside
// the registration's handler (the call's arguments, the decorated function or method), and
// which file-level hook lines mention it.
export function routes(root, guards = [], ref = '') {
  const out = [];
  for (const path of files(root, ref).filter((p) => /\.([cm]?[jt]sx?|py|go|java|kt|cs|php|rs)$/.test(p) && !TEST.test(p) && !VENDORED.test(p))) {
    const text = read(root, path, ref);
    if (!START.test(text)) continue;
    const lines = text.split('\n');
    const offs = [];
    lines.reduce((o, l, k) => { offs[k] = o; return o + l.length + 1; }, 0);
    const hooks = lines.map((l, k) => ({ n: k + 1, l })).filter((x) => FILE_HOOK.test(x.l));
    lines.forEach((l, i) => {
      if (!START.test(l)) return;
      const r = registration(path, text, lines, offs, i);
      if (!r) return;
      const span = text.slice(r.from, r.to);
      const guard = {};
      for (const g of guards) {
        const re = new RegExp(`\\b${esc(g)}\\b`);
        guard[g] = { inHandler: re.test(span), fileHooks: hooks.filter((h) => re.test(h.l)).map((h) => h.n) };
      }
      out.push({ path, n: i + 1, method: r.method, target: r.target, guard });
    });
  }
  return out;
}
