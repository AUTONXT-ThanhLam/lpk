import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeReview, roleBody } from '../codereview.mjs';
import { addFinding, readLedger } from '../findings.mjs';
import { git } from '../git.mjs';
import { baseOf, outDir, parseArgs, repoOf } from '../out.mjs';
import { requirementsOf } from '../proof.mjs';
import { resolveRange } from '../range.mjs';
import { appendRecord, readDecisions } from '../records.mjs';
import { readRun } from '../run.mjs';

const USAGE = `usage: lpk code-review [--repo <dir>] [--range <from>..<to> | --base <ref>]
         [--model sonnet] [--fallback-model <model>] [--effort high] [--level high] [--timeout <s>]
  Runs Claude Code's /code-review, with the code-reviewer role in its system prompt, as a headless
  child on the run's reviewed range (\`lpk review start\`), else <merge base>..HEAD, and adds what it
  finds to the run's findings ledger.
  --range    a fix delta: only <from>..<to>, told which findings the ledger already holds`;

const DECISIONS_SHOWN = 40;
const OTHER = { sonnet: 'opus', opus: 'sonnet' };
const CLEANUP = ['simplification', 'efficiency', 'reuse', 'altitude'];

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
  return rows.length ? `The request this change implements; behaviour these lines state is not a defect:\n${rows.join('\n')}` : '';
}

function rangeOf(repo, a) {
  if (a.opt('--range')) return resolveRange(repo, a.opt('--range'));
  const reviewed = readRun(repo)?.reviewRange;
  if (reviewed) return resolveRange(repo, reviewed);
  const base = baseOf(repo, a.opt('--base'));
  return base ? resolveRange(repo, `${base}..HEAD`) : { error: 'no reviewed range in the run and no merge base found; pass --range or --base' };
}

const row = (f, from, at) => ({
  from, at, claim: f.claim || f.repro, repro: f.repro || f.claim, ...(f.file ? { file: f.file } : {}), ...(f.line ? { line: f.line } : {}),
  kind: f.category === 'test-coverage' ? 'test-gap' : 'defect',
  severity: CLEANUP.includes(f.category) ? 'nit' : 'important',
});

export async function main(argv) {
  const a = parseArgs(argv, ['--repo', '--range', '--base', '--model', '--fallback-model', '--effort', '--level', '--timeout']);
  if (a.error || a.words.length) { console.error(a.error ? `lpk: ${a.error}\n${USAGE}` : USAGE); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  const r = rangeOf(repo, a);
  if (r.error) { console.error(`lpk: ${r.error}`); return 2; }
  const model = a.opt('--model') || 'sonnet', effort = a.opt('--effort') || 'high', level = a.opt('--level') || 'high';
  const delta = Boolean(a.opt('--range'));
  const timeoutMs = Number(a.opt('--timeout') || 540) * 1000;
  if (!(timeoutMs > 0)) { console.error('lpk: --timeout is a number of seconds'); return 2; }

  const name = `code-review-${model}-${r.a.slice(0, 8)}-${r.b.slice(0, 8)}-${process.pid}`;
  const dir = outDir(repo);
  const recordFile = join(dir, `${name}.json`), rawFile = join(dir, `${name}.stream.jsonl`);
  const append = [roleBody(), intended(repo), delta ? alreadyRaised(repo) : ''].filter(Boolean).join('\n\n');
  const res = await codeReview({ repo, a: r.a, b: r.b, level, model, fallbackModel: a.opt('--fallback-model') || OTHER[model], effort, appendSystemPrompt: append, timeoutMs, rawFile });

  const from = `code-review:${model}`;
  const ids = [], refused = [];
  for (const f of res.findings || []) {
    const added = addFinding(repo, row(f, from, r.range));
    if (added.error) refused.push({ file: f.file, ...(f.line ? { line: f.line } : {}), claim: f.claim, repro: f.repro, error: added.error }); else ids.push(added.finding.id);
  }
  const lost = refused.length ? `${refused.length} finding(s) could not be added to the ledger: ${refused.map((x) => `${x.file}${x.line ? `:${x.line}` : ''}: ${x.error}`).join('; ')}` : '';
  const error = res.error || lost;
  const rec = {
    kind: 'code-review', range: r.range, tree: git(['rev-parse', `${r.b}^{tree}`], repo).trim(), model, effort, level, delta,
    ran: res.ran, via: res.via, exit: res.error ? 1 : 0, ...(error ? { error } : {}), ...(refused.length ? { refused } : {}),
    findings: res.findings ? res.findings.length : 0, ids, out: recordFile, stream: rawFile,
    durationMs: res.durationMs, costUsd: res.costUsd, tokens: res.tokens,
  };
  writeFileSync(recordFile, JSON.stringify({ ...rec, list: res.findings || [] }, null, 1));
  appendRecord(repo, rec);

  if (error) console.error(`lpk code-review: ${error}`);
  console.log(`lpk code-review (${model}) on ${r.a.slice(0, 12)}..${r.b.slice(0, 12)}: ${rec.findings} finding(s)${ids.length ? ` added as ${ids.join(' ')}` : ''}; record ${recordFile}`);
  return error ? 1 : 0;
}
