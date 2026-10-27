// The floor under a quick run: exact facts of the diff that owe the full-lane net, and the facts
// that owe each conditional lens. Every list here is a fixed literal tripwire, never a detector: a
// match is printed with its place, and a miss proves nothing.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { CODE, TEST } from './rules.mjs';

// Words split at camelCase humps, so `getSessionId` and `get_session_id` both show `session`.
const AUTH = /(^|[^a-z])(auth|authn|authz|authenticat\w*|authori[sz]\w*|login|logout|sign_?in|password|passwd|jwt|oauth2?|csrf|xsrf|sessions?|permissions?|rbac|saml|sso|bearer|api_?key|access_?token|refresh_?token|set-cookie|cookies?)([^a-z]|$)/i;
const CREDENTIAL = /(^|\/)(\.env(\.[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|\.pgpass|id_(rsa|ed25519|ecdsa)(\.pub)?|credentials(\.json)?|secrets?\.(ya?ml|json|toml)|kubeconfig)$|\.(pem|key|p12|pfx|jks|keystore)$/i;
const MIGRATION = /(^|\/)(migrations?|migrate|alembic|flyway|liquibase)\/|(^|\/)V\d+(_\d+)*__\w+\.sql$|\.migration\.[cm]?[jt]s$|(^|\/)schema\.prisma$/i;
export const MANIFEST = /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|pyproject\.toml|requirements[\w.-]*\.txt|Pipfile(\.lock)?|poetry\.lock|uv\.lock|Gemfile(\.lock)?|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|composer\.(json|lock)|[\w.-]+\.csproj)$/;
const ROUTE = /\.(get|post|put|patch|delete|route|all)\(\s*['"`]|@(Get|Post|Put|Patch|Delete|Request)Mapping|@\w+\.(route|get|post|put|patch|delete)\(|HandleFunc\(|\b(GET|POST|PUT|PATCH|DELETE)\(\s*['"`]|\.route\(\{|\bpath\(\s*['"]/;
const EXPORT = /^\s*export\s|module\.exports|^\s*pub\s+(fn|struct|enum|trait|mod|const|type)\s|__all__\s*=/;
const SCHEMA_PATH = /schema|\.(proto|graphql|gql|avsc)$|openapi|swagger/i;
const SCHEMA_LINE = /\bz\.object\(|new Schema\(|\bCREATE TABLE\b|\bALTER TABLE\b|\bDROP TABLE\b/i;
const DOC_PATH = /\.(md|mdx|rst|adoc|txt)$|(^|\/)docs?\//i;
export const COMMENT = /^\s*(\/\/|\/\*|\*|#(?!include|!|\[)|--\s|<!--|""")/;
const MESSAGE = /new \w*Error\(|console\.(log|warn|error|info)\(|\blogger?\.(debug|info|warn|warning|error|fatal)\(|\braise \w+\(|\bpanic\(|fmt\.Errorf\(|errors\.New\(|\blog\.(Print|Fatal)|\btoast\b|\balert\(|usage:/;
const SCREEN = /\.(tsx|jsx|vue|svelte|html?|css|scss|sass|less|astro)$|(^|\/)(components|pages|screens|views|layouts|templates)\/[^/]+\.[cm]?[jt]s$/;
const QUERY = /\bSELECT\b|\bINSERT INTO\b|\bDELETE FROM\b|\bUPDATE\s+\w+\s+SET\b|\.(find|findOne|findMany|findAll|aggregate|query|raw|where|whereIn|join|populate)\(|\bprisma\.|\bknex\b|\.objects\./;
const RENDER = /\buse(Effect|Memo|Callback|State|Selector|LayoutEffect)\(|\.map\(|\bv-for\b|\{#each\b|\*ngFor|\brender\(/;

const words = (t) => t.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

// Changed lines from base to the working tree, both sides, with untracked files as all-added.
export function diffLines(repo, base) {
  const files = new Map();
  let cur = null, n = 0;
  for (const l of git(['diff', '-U0', '--no-color', '--no-renames', base, '--'], repo).split('\n')) {
    const h = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (h) { cur = { path: h[2], lines: [] }; files.set(cur.path, cur); continue; }
    const m = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (m) { n = Number(m[1]); continue; }
    if (!cur || /^(\+\+\+|---) /.test(l)) continue;
    if (l.startsWith('+')) cur.lines.push({ n: n++, text: l.slice(1), side: '+' });
    else if (l.startsWith('-')) cur.lines.push({ n, text: l.slice(1), side: '-' });
  }
  for (const p of git(['ls-files', '--others', '--exclude-standard'], repo).split('\n').filter(Boolean)) {
    let text = '';
    try { text = readFileSync(join(repo, p), 'utf8'); } catch { continue; }
    files.set(p, { path: p, lines: text.includes('\0') ? [] : text.split('\n').map((t, i) => ({ n: i + 1, text: t, side: '+' })) });
  }
  return [...files.values()];
}

// The globs a repo's SENSITIVE.md lists (as on base, plus any the change adds), as path tests.
export function sensitiveGlobs(repo, base) {
  const text = ['SENSITIVE.md', '.github/SENSITIVE.md'].flatMap((p) => [git(['show', `${base}:${p}`], repo), (() => { try { return readFileSync(join(repo, p), 'utf8'); } catch { return ''; } })()]).join('\n');
  const globs = new Set();
  for (const l of text.split('\n')) {
    const item = l.match(/^\s*[-*]\s+(.+)$/)?.[1].trim();
    const glob = item && (item.match(/^`([^`]+)`/)?.[1] || (/\s/.test(item) ? '' : item));
    if (glob) globs.add(glob);
  }
  return [...globs].map((g) => ({ glob: g, re: globRe(g) }));
}

function globRe(g) {
  const body = g.replace(/^\.?\//, '').replace(/\/$/, '/**').split(/(\*\*\/?|\*|\?)/).map((p) => (p === '**/' ? '(.*/)?' : p === '**' ? '.*' : p === '*' ? '[^/]*' : p === '?' ? '[^/]' : p.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(g.includes('/') ? `^${body}$` : `(^|/)${body}$`);
}

// { full, why, lenses, lensWhy } for the change from `base` to the working tree.
export function floor(repo, base) {
  const files = diffLines(repo, base);
  const why = [], lensWhy = {};
  let sensitive = false;
  const lens = (name, fact) => { lensWhy[name] ||= fact; };
  if (files.length > 3) why.push(`${files.length} files changed (more than 3)`);
  const counted = why.length;
  if (files.length > 10) lens('ocr', `${files.length} files changed (more than 10)`);
  const globs = sensitiveGlobs(repo, base);
  for (const f of files) {
    const p = f.path;
    if (CREDENTIAL.test(p)) { why.push(`credential path ${p}`); sensitive = true; }
    if (MIGRATION.test(p)) { why.push(`migration ${p}`); sensitive = true; }
    if (MANIFEST.test(p)) why.push(`manifest ${p}`);
    for (const g of globs) if (g.re.test(p)) { why.push(`${p} matches SENSITIVE.md \`${g.glob}\``); sensitive = true; }
    const auth = words(p).match(AUTH);
    if (auth) { why.push(`auth marker \`${auth[2]}\` in the path ${p}`); sensitive = true; }
    // In lines, only source code counts: prose about a login is not a login.
    const lineAuth = CODE.test(p) && !TEST.test(p) && f.lines.find((l) => AUTH.test(words(l.text)));
    if (lineAuth) { why.push(`auth marker \`${words(lineAuth.text).match(AUTH)[2]}\` at ${p}:${lineAuth.n}`); sensitive = true; }
    const at = (re) => f.lines.find((l) => re.test(l.text));
    const where = (l) => `${p}:${l.n}${l.side === '-' ? ' (removed)' : ''}`;
    if (TEST.test(p)) { lens('mutant', `test file ${p}`); continue; }
    let l;
    if ((l = at(ROUTE))) { lens('regression', `route at ${where(l)}`); lens('perf', `route at ${where(l)}`); }
    if ((l = at(EXPORT))) lens('regression', `export at ${where(l)}`);
    if (SCHEMA_PATH.test(p) || MIGRATION.test(p)) lens('regression', `schema file ${p}`);
    else if ((l = at(SCHEMA_LINE))) lens('regression', `schema at ${where(l)}`);
    if (DOC_PATH.test(p)) lens('claims', `doc ${p}`);
    else if ((l = at(COMMENT))) lens('claims', `comment at ${where(l)}`);
    if ((l = at(MESSAGE))) lens('claims', `message at ${where(l)}`);
    if (SCREEN.test(p)) { lens('ui-reviewer', `screen file ${p}`); lens('a11y', `screen file ${p}`); }
    if ((l = at(QUERY))) lens('perf', `query at ${where(l)}`);
    if (SCREEN.test(p) && (l = at(RENDER))) lens('perf', `render at ${where(l)}`);
  }
  const order = ['mutant', 'regression', 'claims', 'ocr', 'ui-reviewer', 'a11y', 'perf'];
  const docsOnly = files.length > 0 && why.length === counted && files.every((f) => DOC_PATH.test(f.path) && !CODE.test(f.path));
  return { full: why.length > 0, sensitive, docsOnly, why, lenses: order.filter((k) => lensWhy[k]), lensWhy, files: files.map((f) => f.path) };
}
