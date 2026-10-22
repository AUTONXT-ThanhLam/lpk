// Plain-text output of `lpk rules`, `lpk check`, `lpk map` and `lpk mutate`, for an agent to read.
import { census, routes } from './map.mjs';
import { allCandidates, astNotes } from './ast.mjs';
import { mutate } from './mutate.mjs';
import { precedent } from './reviews.mjs';
import { broken, changeOf, envWiring, loadRules, triggered } from './rules.mjs';
import { teamFiles } from './team.mjs';

const ORDER = { high: 0, medium: 1, low: 2 };
const skippedPatterns = () => (broken.length ? ['', 'patterns skipped because they do not compile or are not in backticks:', ...broken.map((b) => `  ${b}`)] : []);
// The team's rule files: a rule they state binds like a catalog rule.
const teamText = (repo, changed) => {
  if (!repo) return [];
  const t = teamFiles(repo, changed);
  if (!t.files.length) return ['', 'Team rule files: none (no CLAUDE.md, AGENTS.md, CONTRIBUTING.md or copilot instructions here or in a superproject).'];
  return ['', 'Team rule files (the repo\'s, its changed folders\', the superproject\'s and the files they link), each with the line that links it and the names of this change it mentions. Read in full each one that names the change, states rules, or covers what the change touches; a rule one states binds like a catalog rule.',
    ...t.files.flatMap((f) => [`  ${f.path} (${f.lines} lines${f.from ? `, ${f.from}` : ''})${f.names.length ? `  names: ${f.names.join(', ')}` : ''}`, ...(f.at ? [`      ${f.at}`] : [])]),
    ...(t.more ? [`  ... and ${t.more} more linked files: open the links in the files above`] : [])];
};
const full = (r, why) => [
  `### ${r.id}: ${r.title} (blocks: ${r.blocks}${r.source === 'catalog' ? '' : `; from ${r.source}`})`,
  ...(why ? [`loaded by: ${why}`] : []),
  `rule: ${r.rule}`,
  `check: ${r.check}`,
  `when: ${r.when.map((w) => (w.src ? `${w.kind} \`${w.src}\`` : w.kind)).join('; ') || 'never'}`,
  ...(r.find.length ? [`find: ${r.find.map((x) => `\`${x.source}\`${x.at ? ` in path \`${x.at.source}\`` : ''}`).join('; ')}`] : []),
  ...(r.extendedBy ? [`extended by: ${r.extendedBy.join(', ')}`] : []),
  '',
].join('\n');

// `mode` is 'diff' (rules this change loads), 'all' (every rule in full), 'list' (one line each)
// or 'id' (the rules named in `ids`, in full; `missing` lists ids no rule has).
export function rulesText({ repo, base, mode = 'diff', ids = [] }) {
  const rules = loadRules(repo);
  if (mode === 'id') {
    const missing = ids.filter((id) => !rules.some((r) => r.id === id));
    return { missing, text: missing.length ? '' : ids.map((id) => full(rules.find((r) => r.id === id))).join('\n').trimEnd() };
  }
  if (mode === 'list') return [...rules.map((r) => `${r.id} (${r.blocks}): ${r.title}`), ...skippedPatterns(), ...teamText(repo, [])].join('\n');
  if (mode === 'all') return [...rules.map((r) => full(r)), ...skippedPatterns(), ...teamText(repo, [])].join('\n');
  const files = changeOf(repo, base);
  const hit = triggered(rules, files).sort((a, b) => ORDER[a.rule.blocks] - ORDER[b.rule.blocks]);
  const skipped = rules.filter((r) => !hit.some((h) => h.rule === r)).map((r) => r.id);
  return [
    `${hit.length} of ${rules.length} rules apply to this change (${files.length} files against ${base.slice(0, 12)}). One rule's full text: \`lpk rules --id <id>[,<id>]\`.`,
    ...hit.map((h) => `  ${h.rule.id} (${h.rule.blocks}): ${h.rule.title}`),
    '',
    ...hit.map((h) => full(h.rule, h.why)),
    `not loaded (no trigger in the diff): ${skipped.join(', ') || 'none'}`,
    ...skippedPatterns(),
    ...teamText(repo, files.map((f) => f.path)),
  ].join('\n');
}

export function checkText({ repo, base, sibs }) {
  const rules = loadRules(repo);
  const files = changeOf(repo, base);
  const ast = allCandidates(repo, rules, files);
  const cands = ast.cands;
  const env = envWiring(repo, files, sibs);
  const lines = [`Candidates on added lines (${files.length} files against ${base.slice(0, 12)}). Each is a place to look, not a verdict.`, ''];
  if (!cands.length) lines.push('patterns: no added line matches a rule pattern');
  for (const c of cands) lines.push(`${c.id}  ${c.path}:${c.n}  ${c.text}`);
  lines.push('', 'env names read by added code, and the deploy files that mention them:');
  if (!env.length) lines.push('  (no env read in a form lpk recognizes: process.env, import.meta.env, os.environ, getenv/Getenv/LookupEnv, Deno.env.get, env::var, ENV[...] / ENV.fetch, GetEnvironmentVariable)');
  for (const e of env) lines.push(`  ${e.name}  read at ${e.at}  ${e.seen.length ? `mentioned in ${e.seen.join(', ')}` : 'MENTIONED IN NO DEPLOY FILE'}`);
  return [...lines, ...skippedPatterns(), ...astNotes(ast)].join('\n');
}

export function mapText({ roots, refs = new Map(), names, routeMode, guards }) {
  const at = (root) => (refs.get(root) ? ` at ${refs.get(root)}` : '');
  const out = [];
  if (routeMode) {
    for (const root of roots) {
      const rs = routes(root, guards, refs.get(root));
      out.push(`# Routes and tools in ${root}${at(root)}: ${rs.length}${guards.length ? `; guard names: ${guards.join(', ')}` : ''}`);
      if (!rs.length) out.push('(lpk recognises call registrations like `app.get("/x", ...)`, decorators and annotations; a server that dispatches inside one handler, such as `do_GET` comparing paths, has its routes there: read it)');
      for (const r of rs) {
        const g = guards.map((n) => {
          const x = r.guard[n];
          return `${n}: ${x.inHandler ? 'in handler' : x.fileHooks.length ? `file hook line ${x.fileHooks.join(',')}` : 'NOT SEEN'}`;
        });
        out.push(`${r.path}:${r.n}  ${r.method} ${r.target}${g.length ? `  [${g.join('; ')}]` : ''}`);
      }
      out.push('');
    }
    out.push('"in handler" means the name appears inside the registration itself: its call arguments, or the decorated function or method. A handler passed by name, or a guard applied where the router is mounted, shows as NOT SEEN: follow it once before calling it a gap.');
  }
  for (const name of names) for (const root of roots) {
    const files = census(root, name, refs.get(root));
    out.push(`# ${name} in ${root}${at(root)}: ${files.reduce((n, f) => n + f.lines.length, 0)} lines in ${files.length} files`);
    for (const f of files) {
      out.push(`${f.path}${f.test ? ' (test)' : `  tests by package, name or import: ${f.testedBy.length ? f.testedBy.join(', ') : 'none'}`}`);
      for (const l of f.lines.slice(0, 8)) out.push(`  ${l.n}: ${l.text}`);
      if (f.lines.length > 8) out.push(`  ... ${f.lines.length - 8} more`);
    }
    out.push('');
  }
  return out.join('\n');
}

// The tech lead's past comments on the files of this change, then on their neighbours.
export function precedentText({ repo, paths }) {
  const p = precedent(repo, paths);
  if (!p.slug) return 'lpk precedent: the repo has no GitHub origin, so there are no past reviews to match.';
  if (!p.count) return `lpk precedent: no reviews stored for ${p.slug}; fetch them with \`lpk reviews fetch --reviewer <login>\`.`;
  const one = (c) => `- #${c.pr} ${c.path}${c.line ? `:${c.line}` : ''}  ${c.body.replace(/\s+/g, ' ').slice(0, 280)}\n  ${c.url}`;
  return [
    `${p.count} stored review comments for ${p.slug}. On the files of this change (${paths.length}): ${p.same.length}.`,
    ...p.same.map(one),
    '', `On files in the same directories or with the same names: ${p.near.length}${p.near.length > 15 ? ' (newest 15)' : ''}.`,
    ...p.near.slice(-15).map(one),
    '', 'Each is what the tech lead said about this code before. Read the ones that touch what you change.',
  ].join('\n');
}

export async function mutateText(args) {
  const r = await mutate(args);
  const lines = [];
  if (r.baseline) lines.push(`baseline (the change as it is): exit ${r.baseline.exit} in ${Math.round(r.baseline.ms / 1000)}s`);
  if (r.error) { lines.push(`lpk mutate: ${r.error}`); if (r.baseline) lines.push(r.baseline.tail); return { text: lines.join('\n'), code: 1 }; }
  if (!r.files.length) lines.push('no changed non-test code file to undo');
  for (const f of r.files) {
    const verdict = f.exit === 'not applied' ? 'NOT APPLIED: the patch does not fit the change; fix the patch'
      : f.exit === 0 ? (f.undo === 'mutant' ? 'TESTS STILL PASS: no test catches this mutant' : 'TESTS STILL PASS: no test depends on this file\'s change')
        : f.timedOut ? 'timed out' : `tests fail (exit ${f.exit})`;
    lines.push(`\n${f.path} (${f.undo}): ${verdict}, ${Math.round(f.ms / 1000)}s`);
    if (f.exit !== 0) lines.push(f.tail.split('\n').map((l) => `  | ${l}`).join('\n'));
  }
  if (r.skipped) lines.push(`\n${r.skipped} more undo(s) not run: the cap of test runs was reached. Narrow with --file.`);
  lines.push('\nA failure for the wrong reason (an import of a symbol the undone file no longer exports, a syntax error) does not prove the behaviour; read the tail.');
  return { text: lines.join('\n'), code: 0 };
}
