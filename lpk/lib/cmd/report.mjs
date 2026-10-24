// `lpk report`: the numbers of the run's report, every one from code, after the gates ran. The
// verdict line says "deliverable" only when every delivery gate holds on the HEAD it names; the
// session adds the verdict in words, the decisions it took alone and the weakest point.
import { counts } from '../findings-text.mjs';
import { BORN, needsOwner, stateOf } from '../findings.mjs';
import { failing, gates, gatesText } from '../gates.mjs';
import { git } from '../git.mjs';
import { evidence, ledgerFor } from '../owed.mjs';
import { capped, parseArgs, repoOf } from '../out.mjs';
import { proofsOf, trace } from '../proof.mjs';
import { readDecisions, readRecords } from '../records.mjs';
import { runRow } from '../runs.mjs';
import { runHere } from './gates.mjs';

// A finding the owner reads in the report: its ruling (for an unsettled one, the ruling asked and
// the protected area that kept it open), who made it, the claim and the evidence.
const asked = (f) => [f.asked && `asked ${f.asked}${f.basis ? `: ${f.basis}` : ''}`, f.area && `area ${f.area}`].filter(Boolean).join(', ');
const ruling = (f) => (f.state === 'fixed'
  ? `- ${f.id} fixed by ${f.fixedBy}: ${f.claim} — ${f.fixEvidence}`
  : `- ${f.id} ${f.state === 'duplicate' ? `duplicate of ${f.primary}` : f.state}${f.state === 'unsettled' && asked(f) ? ` (${asked(f)})` : ''}${f.by ? ` by ${f.by}` : ''}: ${f.claim} — ${f.evidence}`);
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export async function main(argv) {
  const a = parseArgs(argv, ['--repo']);
  if (a.error || a.words.length) { console.error(`lpk: ${a.error || 'unexpected arguments'}\nusage: lpk report [--repo <dir>]`); return 2; }
  const repo = repoOf(a.opt('--repo'));
  if (!repo) { console.error('lpk: not inside a git repository'); return 2; }
  let run;
  try { run = runHere(repo); } catch (e) { console.error(`lpk: ${e.message}`); return 1; }
  if (!run) { console.error('lpk: no lpk run delivers this branch'); return 1; }
  const rows = await gates(repo, run);
  const bad = failing(rows);
  const head = git(['rev-parse', '--short=12', 'HEAD'], repo).trim();
  const out = [
    bad.length ? `NOT deliverable at ${head}: ${bad.map((r) => r.gate).join(', ')} do not hold` : `deliverable at ${head}: every delivery gate holds`,
    `run ${run.id}, ${run.lane} lane${run.laneWhy ? ` (${run.laneWhy})` : ''}, branch ${run.branch || 'none'}, wall ${Math.round(((run.endedAt || Date.now()) - run.started) / 60000)} min`,
    '', 'Gates:', gatesText(rows),
  ];
  const facts = [];
  try {
    const ledger = ledgerFor(repo, run);
    const c = counts(ledger);
    facts.push(`Findings: ${c.total} raised; ${['confirmed', 'fixed', 'deferred', 'dropped', 'preexisting', 'unsettled', 'open'].map((s) => `${c[s]} ${s}`).join(', ')}, ${c.duplicate} duplicate; ${ledger.filter((f) => f.kind === 'test-gap').length} test gaps`);
    const born = BORN.map((b) => [b, ledger.filter((f) => f.born === b && ['confirmed', 'fixed', 'deferred'].includes(stateOf(f, ledger))).length]).filter(([, n]) => n);
    if (born.length) facts.push(`Confirmed defects by the step they began in: ${born.map(([b, n]) => `${b} ${n}`).join(', ')}`);
    const deferred = ledger.filter((f) => f.state === 'deferred');
    if (deferred.length) facts.push(['Known limits, not fixed (for the PR body):', ...deferred.map((f) => `- ${f.id} ${f.kind}/${f.severity}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}: ${f.claim} — ${f.deferEvidence}`)].join('\n'));
    const toRead = ledger.filter(needsOwner);
    if (toRead.length) facts.push(['For the owner to read, not blocking:', ...toRead.map(ruling)].join('\n'));
    const ran = {};
    for (const i of evidence(repo, run, ledger).items) { const k = i.model ? `${i.key} (${i.model})` : i.key; ran[k] = (ran[k] || 0) + 1; }
    facts.push(`Lenses that ran: ${Object.entries(ran).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'}`);
  } catch (e) { facts.push(`Findings and lenses could not be read: ${e.message}`); }
  const recs = readRecords(repo, { run: run.id });
  for (const s of run.scenarios || []) {
    const last = proofsOf(recs, s).at(-1);
    facts.push(`Scenario ${s.id}: ${s.cmd ? `\`${s.cmd}\` ${last ? `${last.pass ? 'pass' : 'FAIL'} on ${String(last.tree).slice(0, 12)}` : 'never proved'}` : `(agent-judged) ${s.agentJudged}`}`);
  }
  // R -> proof as a Markdown table, so the PR body can carry it as it stands.
  try {
    const t = trace(repo, run, recs);
    const cell = (x) => String(x).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    facts.push(t.rows.length ? [`Requirements (${t.from}):`, '| R | Requirement | Source | Proof |', '|---|---|---|---|',
      ...t.rows.map((r) => `| ${r.id} | ${cell(r.text)} | ${cell(r.source)} | ${cell(r.proofs.join('; ') || `UNPROVED: ${r.notes.join('; ') || 'nothing names it'}`)} |`)].join('\n') : 'Requirements: none numbered');
  } catch (e) { facts.push(`Requirements could not be traced: ${e.message}`); }
  facts.push(`Verify runs: ${recs.filter((r) => r.kind === 'verify').length}; reviewed ranges: ${recs.filter((r) => r.kind === 'review-start').map((r) => r.range).join(', ') || 'none recorded'}`);
  try {
    const row = run.ended ? null : runRow(repo);
    if (row) facts.push(`Tokens by job: ${Object.entries(row.agents).map(([k, v]) => `${k} ${fmt(v.fresh)} fresh, ${fmt(v.cacheRead)} cache reads`).join('; ') || 'none measured'}`);
  } catch (e) { facts.push(`Tokens could not be measured: ${e.message}`); }
  const decided = readDecisions(repo, { run: run.id });
  console.log(capped(repo, `report-${run.id}`, [...out, '', ...facts, '', `Decided without the owner (${decided.length}):`], decided.map((d) => `- ${d.what}: ${d.why}`)));
  return bad.length ? 1 : 0;
}
