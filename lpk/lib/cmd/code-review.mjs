// `lpk code-review`: one headless /code-review (or /security-review) child on one range of the
// change. It adds what the child found to the run's findings ledger itself, keeps the child's
// output and a record of the run under the run directory, and ends with one line naming the
// record and the ledger ids, which is all a workflow relay returns.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeReview, resolveRange, reviewRules, securityReview } from '../codereview.mjs';
import { addFinding, readLedger } from '../findings.mjs';
import { git } from '../git.mjs';
import { baseOf, outDir, parseArgs, repoOf } from '../out.mjs';
import { requirementsOf } from '../proof.mjs';
import { appendRecord, readDecisions } from '../records.mjs';
import { readRun } from '../run.mjs';
import { headTree, treeOf } from '../tree.mjs';

const USAGE = `usage: lpk code-review [--repo <dir>] [--range <from>..<to> | --base <ref>] [--security | --slice]
         [--model sonnet] [--fallback-model <model>] [--effort high] [--level high] [--timeout <s>]
  Reviews the run's reviewed range (\`lpk review start\`), else <merge base>..HEAD.
  --range    a fix delta: only <from>..<to>, told which findings the ledger already holds
  --security /security-review instead of /code-review
  --slice    a builder's self-review, before it commits: <merge base with --base>..the working tree
             (uncommitted and untracked code included); findings are printed, not added to the ledger`;

const DECISIONS_SHOWN = 40;
const OTHER = { sonnet: 'opus', opus: 'sonnet' };
// The categories /code-review's own output contract names for cleanup rather than defects.
const CLEANUP = ['simplification', 'efficiency', 'reuse'];

// What the ledger already holds on this change, so a fix-delta review does not raise it again.
function alreadyRaised(repo) {
  const rows = readLedger(repo).findings.map((f) => `- ${f.id} ${f.file || ''}${f.line ? `:${f.line}` : ''} (${f.state}): ${f.claim}`);
  return rows.length ? `These findings were already raised on this change; review the fix delta, and report one of them again only if the delta did not fix it:\n${rows.join('\n')}` : '';
}

function intended(repo) {
  const run = readRun(repo);
  if (!run) return '';
  let reqs = [];
  try { reqs = requirementsOf(repo, run).requirements; } catch { reqs = []; }
  const rows = [
    ...reqs.filter((r) => r.text).map((r) => `- ${r.id}: ${r.text}`),
    ...readDecisions(repo, { run: run.id }).slice(-DECISIONS_SHOWN).map((d) => `- decided: ${d.what} (${d.why})`),
  ];
  return rows.length ? `This change is meant to do the following; behaviour these lines state is not a defect:\n${rows.join('\n')}` : '';
}

// A slice is reviewed before its commit, so its change is the working tree (the tree `lpk verify`
// ids) against where the slice started. That start is the base the builder was given: the run's
// target would also take in the commits of slices merged before this one.
function sliceRange(repo, ref) {
  if (!ref) return { error: '--slice needs --base <the commit your slice started from>' };
  const base = baseOf(repo, ref);
  if (!base) return { error: `no merge base between ${ref} and HEAD` };
  const tree = treeOf(repo).id;
  if (tree === headTree(repo, base)) return { error: `nothing to review: the working tree is the same as ${ref}` };
  return { a: base, b: tree, range: `${base}..${tree}` };
}

function rangeOf(repo, a, slice) {
  if (slice) return a.opt('--range') ? { error: '--slice reviews the working tree against --base; it takes no --range' } : sliceRange(repo, a.opt('--base'));
  if (a.opt('--range')) return resolveRange(repo, a.opt('--range'));
  const reviewed = readRun(repo)?.reviewRange;
  if (reviewed) return resolveRange(repo, reviewed);
  const base = baseOf(repo, a.opt('--base'));
  return base ? resolveRange(repo, `${base}..HEAD`) : { error: 'no reviewed range in the run and no merge base found; pass --range or --base' };
}

// The ledger row of one child finding. A finding the child left without a summary is still a
// finding: its scenario says what is wrong.
function row(f, { kind, from, at }) {
  const security = kind === 'security-review';
  return {
    from, at, claim: f.claim || f.repro, repro: f.repro || f.claim, ...(f.file ? { file: f.file } : {}), ...(f.line ? { line: f.line } : {}),
    kind: f.category === 'test-coverage' ? 'test-gap' : 'defect',
    severity: f.severity || (CLEANUP.includes(f.category) ? 'nit' : 'important'),
    ...(security ? { area: 'security' } : {}),
  };
}

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--range', '--base', '--model', '--fallback-model', '--effort', '--level', '--timeout'], ['--security', '--slice']);
  if (a.error || a.words.length) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const security = a.flags.has('--security'), slice = a.flags.has('--slice');
  if (security && slice) { console.error(`lpk: --security and --slice do not go together\n${USAGE}`); return 2; }
  const r = rangeOf(repo, a, slice);
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  const kind = security ? 'security-review' : slice ? 'self-review' : 'code-review';
  const model = a.opt('--model') || 'sonnet', effort = a.opt('--effort') || 'high', level = a.opt('--level') || 'high';
  const delta = Boolean(a.opt('--range'));
  const timeoutMs = Number(a.opt('--timeout') || 540) * 1000;
  if (!(timeoutMs > 0)) { console.error('lpk: --timeout is a number of seconds'); return 2; }

  const name = `${kind}-${model}-${r.a.slice(0, 8)}-${r.b.slice(0, 8)}-${process.pid}`;
  const dir = outDir(repo);
  const recordFile = join(dir, `${name}.json`);
  const append = [reviewRules(repo, r.a), intended(repo), delta ? alreadyRaised(repo) : ''].filter(Boolean).join('\n\n');
  const run = { repo, a: r.a, b: r.b, level, model, fallbackModel: a.opt('--fallback-model') || OTHER[model], effort, appendSystemPrompt: append, timeoutMs, rawFile: join(dir, `${name}.stream.jsonl`) };
  const res = await (security ? securityReview(run) : codeReview(run));

  const from = `${kind}:${model}`;
  const ids = [], refused = [];
  if (!res.error && !slice) {
    for (const f of res.findings) {
      const added = addFinding(repo, row(f, { kind, from, at: r.range }));
      if (added.error) refused.push({ file: f.file, ...(f.line ? { line: f.line } : {}), claim: f.claim, repro: f.repro, error: added.error }); else ids.push(added.finding.id);
    }
  }
  // The record's exit says whether the review ran, which is what makes the lens owed again; a
  // finding the ledger refused is kept in the record and named on stderr, and lpk exits 1 for it.
  const lost = refused.length ? `${refused.length} finding(s) could not be added to the ledger: ${refused.map((x) => `${x.file}${x.line ? `:${x.line}` : ''}: ${x.error}`).join('; ')}` : '';
  const error = res.error || lost;
  const rec = {
    kind, range: r.range, tree: git(['rev-parse', `${r.b}^{tree}`], repo).trim(), model, effort, level, delta,
    account: res.account, ran: res.ran, via: res.via, exit: res.error ? 1 : 0, ...(error ? { error } : {}), ...(refused.length ? { refused } : {}),
    findings: res.findings ? res.findings.length : 0, ids, out: recordFile, stream: run.rawFile,
    durationMs: res.durationMs, tokens: res.tokens,
  };
  writeFileSync(recordFile, JSON.stringify({ ...rec, list: res.findings || [] }, null, 1));
  appendRecord(repo, rec);

  if (slice && res.findings) for (const f of res.findings) console.log(`- ${f.file}${f.line ? `:${f.line}` : ''}: ${f.claim}\n  scenario: ${f.repro}`);
  if (error) console.error(`lpk ${kind}: ${error}`);
  console.log(`lpk ${kind} (${model}) on ${r.a.slice(0, 12)}..${slice ? 'the working tree' : r.b.slice(0, 12)}: ${rec.findings} finding(s)${ids.length ? ` added as ${ids.join(' ')}` : ''}; record ${recordFile}`);
  return error ? 1 : 0;
}
